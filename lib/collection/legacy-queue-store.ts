import type { AtomicOfflineStore } from "@/lib/offline-store/kv"
import type { PendingCollectionOperationInput } from "@/lib/collection/offline-queue"
import { sameCollectionOrigin, type CollectionOrigin } from "@/lib/collection/recipient"
import { decodeQueueArray, mayDownloadLegacyOriginal, sourceDigest, isLegacyQueueSource, type LegacyQueueSource } from "@/lib/collection/legacy-source"
import { legacyReviewEntries } from "@/lib/collection/legacy-review"
import {
  LEGACY_QUEUE_KEY, LEGACY_QUEUE_SOURCE_KEY, LEGACY_LEASE_MS, failLegacy, freezeLegacyRequest, isRetainedOperation,
  validateLegacyOutcome, legacyToken, makeLegacyOperation, newLegacyEntry, parseLegacyEnvelope, sameLegacySlot, sameLegacyValue, visibleLegacyOrigin,
  type Claim, type DurableLegacyEntry, type LegacyDeliveryOutcome, type LegacyQueueEnvelope, type RetainedLegacySource, type ReviewToken,
} from "@/lib/collection/legacy-queue-record"

export type LegacySourceObservation = { kind: "local-storage"; raw: string | null } | { kind: "collection-mirror"; retainedValue: unknown }
export type LegacyReviewToken = ReviewToken & { session: string; origin: CollectionOrigin }
export type LegacyReviewSelection = { sourceId: string; ordinal: number; input: PendingCollectionOperationInput }

function compatibilityBarrier(entry: DurableLegacyEntry) {
  return !!entry.operation.compatibilityPause || (entry.settlement?.kind === "known-rejection" && entry.settlement.category === "compatibility")
}
function pauseReviewSiblings(envelope: LegacyQueueEnvelope, entry: DurableLegacyEntry) {
  const epoch = entry.operation.recoverySource?.reviewEpoch
  if (!epoch) return
  for (const sibling of envelope.entries) {
    if (sibling.state === "ready" && sameCollectionOrigin(sibling.operation.origin, entry.operation.origin)
      && sibling.operation.recoverySource?.reviewEpoch === epoch) {
      sibling.state = "paused"; sibling.reason = "review_batch_paused"; sibling.revision = envelope.revision + 1
    }
  }
}

function sourceEntries(source: RetainedLegacySource): unknown[] {
  if (source.kind === "local-storage") return decodeQueueArray(source.raw) ?? []
  const value = source.retainedValue
  return value && typeof value === "object" && "pendingOperations" in value && Array.isArray(value.pendingOperations) ? value.pendingOperations : []
}
function appendSource(envelope: LegacyQueueEnvelope, observation: LegacySourceObservation, sourceId: string) {
  if (envelope.sources.some(source => source.kind === observation.kind && (observation.kind === "local-storage"
    ? source.raw === observation.raw : sameLegacyValue(source.retainedValue, observation.retainedValue)))) return false
  const source: RetainedLegacySource = observation.kind === "local-storage"
    ? { sourceId, kind: observation.kind, raw: observation.raw, accepted: [] }
    : { sourceId, kind: observation.kind, raw: null, retainedValue: observation.retainedValue, accepted: [] }
  envelope.sources.push(source)
  sourceEntries(source).forEach((operation, ordinal) => {
    // Projection never normalizes or invents identity. Duplicate request IDs get separate evidence IDs.
    if (isRetainedOperation(operation)) envelope.entries.push(newLegacyEntry(envelope, operation, `${sourceId}:${ordinal}`, { sourceId, ordinal },
      source.kind === "collection-mirror" ? "mirror_delivery_unverified" : operation.origin?.kind === "account" ? "migration_delivery_unverified" : "source_review_required"))
  })
  return true
}
function reviewSource(source: RetainedLegacySource): LegacyQueueSource | null {
  return source.kind === "local-storage" && source.raw !== null
    ? { legacyQueueSource: { version: 1, raw: source.raw, digest: sourceDigest(source.raw), accepted: source.accepted } } : null
}
function sourceVisible(source: RetainedLegacySource, scope: CollectionOrigin | null) {
  let raw = source.raw
  if (source.kind === "collection-mirror") {
    const mirror = source.retainedValue
    if (mirror && typeof mirror === "object" && "ownerUserId" in mirror && typeof mirror.ownerUserId === "string"
      && (scope?.kind !== "account" || mirror.ownerUserId !== scope.ownerUserId)) return false
    // Non-JSON structured evidence remains retained but cannot bypass account export privacy.
    const seen = new Set<object>()
    const jsonShape = (value: unknown): boolean => {
      if (value === null || ["string", "boolean", "number"].includes(typeof value)) return true
      if (!value || typeof value !== "object" || seen.has(value)) return false
      seen.add(value)
      if (Array.isArray(value)) return Object.keys(value).length === value.length && Object.keys(value).every((key, index) => key === String(index)) && value.every(jsonShape)
      return Object.getPrototypeOf(value) === Object.prototype && Object.values(value).every(jsonShape)
    }
    if (!jsonShape(source.retainedValue)) return false
    try { raw = JSON.stringify(source.retainedValue) } catch { return false }
  }
  return typeof raw === "string" && mayDownloadLegacyOriginal(raw, scope?.kind === "account" ? scope.actorUserId : null)
}

/** Production admission remains disabled; the staged runtime uses the loopback synthetic harness only. */
export function createLegacyQueue(store: AtomicOfflineStore, active: () => { session: string; origin: CollectionOrigin } | null) {
  const capture = () => structuredClone(active())
  const current = (context: ReturnType<typeof capture>) => {
    const now = active()
    return !!context && !!now && now.session === context.session && sameCollectionOrigin(now.origin, context.origin)
  }
  const requireActive = (context: ReturnType<typeof capture>, scope: CollectionOrigin) => {
    if (!current(context) || !sameCollectionOrigin(context!.origin, scope)) failLegacy("queue_session_changed")
  }
  const mutate = async <T>(transform: (envelope: LegacyQueueEnvelope) => { result: T; changed: boolean }) => {
    let result: T
    await store.update(LEGACY_QUEUE_KEY, value => {
      const envelope = parseLegacyEnvelope(value), next = transform(envelope)
      if (next.changed) envelope.revision++
      // Validate before put as well as read. No partial transition is ever persisted.
      parseLegacyEnvelope(envelope)
      result = structuredClone(next.result)
      return envelope
    })
    return result!
  }
  return {
    async initialize(storage: Pick<Storage, "getItem">) {
      const raw = storage.getItem(LEGACY_QUEUE_SOURCE_KEY), epoch = crypto.randomUUID(), lsId = crypto.randomUUID(), mirrorId = crypto.randomUUID()
      await store.updateMany([LEGACY_QUEUE_KEY, "collection"], values => {
        const existing = values[LEGACY_QUEUE_KEY]
        const envelope: LegacyQueueEnvelope = existing === undefined
          ? { version: 2, epoch, revision: 0, nextSequence: 0, migrated: true, sources: [], entries: [] }
          : parseLegacyEnvelope(existing)
        let changed = appendSource(envelope, { kind: "local-storage", raw }, lsId)
        if (values.collection !== undefined) changed = appendSource(envelope, { kind: "collection-mirror", retainedValue: values.collection }, mirrorId) || changed
        if (changed) envelope.revision++
        parseLegacyEnvelope(envelope)
        return { writes: changed || existing === undefined ? [[LEGACY_QUEUE_KEY, envelope]] : [], result: undefined }
      })
    },
    async guestOrigin(binderId: string | null, hint: string | null) {
      const allocated = hint || crypto.randomUUID()
      return await mutate(envelope => {
        const changed = !envelope.guestWorkspaceId
        envelope.guestWorkspaceId ??= allocated
        return { result: { kind: "guest" as const, workspaceId: envelope.guestWorkspaceId, localBinderId: binderId ?? "guest-default" }, changed }
      })
    },
    async retainGuestReview() {
      const context = capture(), sourceId = crypto.randomUUID()
      await mutate(envelope => {
        if (context ? !current(context) : active() !== null) failLegacy("queue_session_changed")
        const drafts = envelope.entries.filter(entry => entry.state === "ready" && !entry.request && !entry.source && entry.operation.origin?.kind === "guest")
        if (!drafts.length) return { result: undefined, changed: false }
        appendSource(envelope, { kind: "local-storage", raw: JSON.stringify(drafts.map(entry => entry.operation)) }, sourceId)
        for (const entry of drafts) {
          entry.state = "paused"; entry.reason = "source_review_required"; entry.revision = envelope.revision + 1
        }
        return { result: undefined, changed: true }
      })
    },
    async read(scope: CollectionOrigin | null) {
      scope = structuredClone(scope)
      const context = capture()
      if (scope) requireActive(context, scope)
      else if (context) failLegacy("queue_session_changed")
      const envelope = parseLegacyEnvelope(await store.get(LEGACY_QUEUE_KEY))
      if (scope) requireActive(context, scope)
      else if (active()) failLegacy("queue_session_changed")
      return { token: legacyToken(envelope), entries: envelope.entries.filter(entry => {
        if (!visibleLegacyOrigin(entry.operation.origin, scope)) return false
        // Retained requests and original/amendment strings can contain other accounts' evidence.
        try { return mayDownloadLegacyOriginal(JSON.stringify(entry), scope?.kind === "account" ? scope.actorUserId : null) }
        catch { return false }
      }), sources: envelope.sources.filter(source => sourceVisible(source, scope)) }
    },
    async deliveryScopes(scope: CollectionOrigin) {
      scope = structuredClone(scope)
      const context = capture()
      requireActive(context, scope)
      const envelope = parseLegacyEnvelope(await store.get(LEGACY_QUEUE_KEY))
      requireActive(context, scope)
      if (scope.kind !== "account") return []
      return envelope.entries.flatMap(entry => entry.state !== "completed" && entry.operation.origin?.kind === "account"
        && entry.operation.origin.actorUserId === scope.actorUserId && entry.operation.origin.ownerUserId === scope.ownerUserId
        ? [entry.operation.origin] : []).filter((origin, index, all) => all.findIndex(other => sameCollectionOrigin(origin, other)) === index)
    },
    async enqueue(input: PendingCollectionOperationInput, expected: { epoch: string; entryRevision: number | null }) {
      input = structuredClone(input); expected = structuredClone(expected)
      const context = capture(), id = crypto.randomUUID(), entryId = crypto.randomUUID(), queuedAt = new Date().toISOString()
      // Capture the exact draft and origin before the first await. Never substitute a later account.
      if (input.origin) requireActive(context, input.origin)
      return await mutate(envelope => {
        if (!input.origin) {
          if (envelope.epoch !== expected.epoch || expected.entryRevision !== null) failLegacy("queue_changed")
          const operation = makeLegacyOperation(input, id, queuedAt)
          appendSource(envelope, { kind: "local-storage", raw: JSON.stringify([operation]) }, entryId)
          return { result: operation, changed: true }
        }
        requireActive(context, input.origin)
        const tail = envelope.entries.findLast(entry => entry.state !== "completed" && sameLegacySlot(entry.operation, input))
        if (envelope.epoch !== expected.epoch || (tail?.revision ?? null) !== expected.entryRevision) failLegacy("queue_changed")
        const coalesce = tail?.state === "ready" && tail.request === null && !tail.source && !tail.operation.recoverySource
        const operation = makeLegacyOperation(input, id, queuedAt, coalesce ? tail.operation : undefined)
        if (coalesce) { tail.operation = operation; tail.revision = envelope.revision + 1 }
        else {
          const entry = newLegacyEntry(envelope, operation, entryId)
          entry.revision = envelope.revision + 1
          envelope.entries.push(entry)
        }
        return { result: operation, changed: true }
      })
    },
    async prepareReview(scope: CollectionOrigin): Promise<LegacyReviewToken> {
      const context = capture(); scope = structuredClone(scope)
      return await mutate(envelope => {
        requireActive(context, scope)
        return { result: { ...legacyToken(envelope), session: context!.session, origin: scope }, changed: false }
      })
    },
    async acceptReview(token: LegacyReviewToken, sources: RetainedLegacySource[], selections: LegacyReviewSelection[]) {
      token = structuredClone(token); sources = structuredClone(sources); selections = structuredClone(selections)
      const context = capture(), ids = selections.map(() => ({ operation: crypto.randomUUID(), entry: crypto.randomUUID() })), queuedAt = new Date().toISOString()
      await mutate(envelope => {
        requireActive(context, token.origin)
        if (context!.session !== token.session || !sameLegacyValue(legacyToken(envelope), { epoch: token.epoch, revision: token.revision })
          || !sameLegacyValue(sources, envelope.sources.filter(source => sourceVisible(source, token.origin))) || !selections.length) failLegacy("queue_changed")
        if (envelope.sources.some(source => sourceEntries(source).some(isLegacyQueueSource))) failLegacy("nested_source_reconciliation_required")
        const selected = new Set<string>(), slots = new Set<number>()
        const paused = envelope.entries.filter(compatibilityBarrier).map(entry => entry.operation.binderId ?? null)
        if (token.origin.kind === "account" && paused.includes(token.origin.binderId)) failLegacy("source_review_unresolved")
        selections.forEach(({ sourceId, ordinal, input }, index) => {
          const source = envelope.sources.find(source => source.sourceId === sourceId), projection = source && reviewSource(source)
          if (!source || !projection || selected.has(`${sourceId}:${ordinal}`) || slots.has(input.pokemonId)) failLegacy("source_review_unresolved")
          const eligible = legacyReviewEntries([projection], paused, token.origin.kind === "account" ? token.origin.actorUserId : null).find(entry => entry.ordinal === ordinal)
          // Nested wrappers and divergent copies are evidence only, never flattened or reaccepted.
          const value = sourceEntries(source)[ordinal]
          if (!isRetainedOperation(value)) failLegacy("source_review_unresolved")
          const divergent = envelope.sources.some(other => other.sourceId !== sourceId && sourceEntries(other).some(candidate => {
            if (!candidate || typeof candidate !== "object" || !value || typeof value !== "object" || !("id" in candidate) || !("id" in value)) return false
            if (candidate.id === value.id) return true
            if (!("pokemonId" in candidate) || !("pokemonId" in value) || candidate.pokemonId !== value.pokemonId) return false
            return ("origin" in candidate && "origin" in value && sameCollectionOrigin(candidate.origin as CollectionOrigin, value.origin as CollectionOrigin))
              || (!("origin" in candidate) && !("origin" in value))
          }))
          if (divergent) failLegacy("source_review_unresolved")
          if (!eligible?.operation || eligible.unresolved || !sameCollectionOrigin(input.origin, token.origin) || token.origin.kind !== "account"
            || input.binderId !== token.origin.binderId || !Object.hasOwn(input, "base") || input.type !== eligible.operation.type || input.pokemonId !== eligible.operation.pokemonId
            || (input.type === "upsert" && eligible.operation.type === "upsert" && !sameLegacyValue(input.item, eligible.operation.item))
            || input.recoverySource || (input.type === "upsert" && input.acquisition)) failLegacy("source_review_unresolved")
          const operation = makeLegacyOperation({ ...input, recoverySource: { digest: projection.legacyQueueSource.digest, ordinal, reviewEpoch: `${token.epoch}:${token.revision}` } }, ids[index].operation, queuedAt)
          const entry = newLegacyEntry(envelope, operation, ids[index].entry, { sourceId, ordinal })
          entry.revision = envelope.revision + 1
          source.accepted.push(ordinal); envelope.entries.push(entry)
          selected.add(`${sourceId}:${ordinal}`); slots.add(input.pokemonId)
        })
        return { result: undefined, changed: true }
      })
    },
    async pauseBatch(reviewEpoch: string, origin: CollectionOrigin, reason: string) {
      const context = capture(); origin = structuredClone(origin)
      if (!reason) failLegacy("pause_reason_required")
      await mutate(envelope => {
        requireActive(context, origin)
        let changed = false
        for (const entry of envelope.entries) {
          if (entry.state !== "ready" || !sameCollectionOrigin(entry.operation.origin, origin) || entry.operation.recoverySource?.reviewEpoch !== reviewEpoch) continue
          entry.state = "paused"; entry.reason = reason; entry.revision = envelope.revision + 1; changed = true
        }
        return { result: undefined, changed }
      })
    },
    async claim(scope: CollectionOrigin, session: string, holder: string, now: number): Promise<Claim | null> {
      scope = structuredClone(scope)
      const context = capture(), token = crypto.randomUUID()
      if (!Number.isFinite(now) || !holder) failLegacy("invalid_lease")
      return await mutate(envelope => {
        requireActive(context, scope)
        if (context!.session !== session || scope.kind !== "account") failLegacy("queue_session_changed")
        let changed = false
        for (const entry of envelope.entries) {
          if (sameCollectionOrigin(entry.operation.origin, scope) && entry.state === "sending" && entry.lease!.until <= now) {
            entry.state = "unknown"; entry.reason = "lease_expired_delivery_unknown"; entry.lease = null; entry.revision = envelope.revision + 1; changed = true
            pauseReviewSiblings(envelope, entry)
          }
        }
        if (envelope.entries.some(entry => entry.state !== "completed" && compatibilityBarrier(entry) && entry.operation.binderId === scope.binderId
          && (!entry.operation.origin || (entry.operation.origin.kind === "account" && entry.operation.origin.ownerUserId === scope.ownerUserId)))) return { result: null, changed }
        const entry = envelope.entries.find((entry, index) => entry.state === "ready" && sameCollectionOrigin(entry.operation.origin, scope)
          && !envelope.entries.slice(0, index).some(previous => previous.state !== "completed" && sameLegacySlot(previous.operation, entry.operation)))
        if (!entry) return { result: null, changed }
        entry.request = freezeLegacyRequest(entry.operation, 2); entry.state = "sending"; entry.revision = envelope.revision + 1
        entry.lease = { token, holder, until: now + LEGACY_LEASE_MS, session }
        return { result: { epoch: envelope.epoch, entryId: entry.entryId, entryRevision: entry.revision, token, session, request: entry.request }, changed: true }
      })
    },
    async settle(claim: Claim, outcome: LegacyDeliveryOutcome): Promise<boolean> {
      claim = structuredClone(claim); outcome = structuredClone(outcome)
      const context = capture()
      validateLegacyOutcome(outcome)
      return await mutate(envelope => {
        const entry = envelope.entries.find(entry => entry.entryId === claim.entryId)
        if (!context || !current(context) || context.session !== claim.session || envelope.epoch !== claim.epoch || !entry
          || !sameCollectionOrigin(entry.operation.origin, context.origin) || entry.state !== "sending" || entry.revision !== claim.entryRevision
          || entry.lease?.token !== claim.token || entry.lease.session !== claim.session || !sameLegacyValue(entry.request, claim.request)) return { result: false, changed: false }
        entry.settlement = outcome
        entry.lease = null; entry.revision = envelope.revision + 1
        if (outcome.kind === "acknowledged") {
          if ((entry.operation.type === "delete" && outcome.item !== null) || (entry.operation.type === "upsert" && (!outcome.item || outcome.item.pokemon_id !== entry.operation.pokemonId))) failLegacy("invalid_legacy_ack")
          entry.state = "completed"; entry.outcome = "acknowledged"; entry.reason = null
        } else if (outcome.kind === "known-rejection") {
          if (!outcome.code) failLegacy("invalid_legacy_rejection")
          entry.rejectedRequests.push({ request: entry.request!, code: outcome.code }); entry.state = "paused"; entry.reason = outcome.code
        } else {
          if (outcome.kind !== "unknown" || !outcome.code) failLegacy("invalid_legacy_outcome")
          entry.state = "unknown"; entry.reason = outcome.code
        }
        // A reviewed batch never continues after a failed attempt. Frozen siblings remain untouched.
        if (outcome.kind !== "acknowledged") pauseReviewSiblings(envelope, entry)
        return { result: true, changed: true }
      })
    },
    async observeOldSource(input: LegacySourceObservation) {
      input = structuredClone(input)
      const sourceId = crypto.randomUUID()
      await mutate(envelope => ({ result: undefined, changed: appendSource(envelope, input, sourceId) }))
    },
  }
}
