import type { AtomicOfflineStore } from "@/lib/offline-store/kv"
import { createLegacyQueue, type LegacyReviewSelection, type LegacyReviewToken } from "@/lib/collection/legacy-queue-store"
import { sameCollectionOrigin, type CollectionOrigin } from "@/lib/collection/recipient"
import { sameLegacySlot, type LegacyDeliveryOutcome } from "@/lib/collection/legacy-queue-record"
import type { PendingCollectionOperationInput } from "@/lib/collection/offline-queue"
import { normalizeCollectionItem } from "@/lib/collection/normalize"
import { isSlotStatus } from "@/lib/domain/cards"
import { sourceDigest, type LegacyQueueSource } from "@/lib/collection/legacy-source"
import { RECIPIENT_RETENTION_CODES } from "@/lib/collection/recipient"

type Context = { session: string; origin: CollectionOrigin }
export type View = Awaited<ReturnType<ReturnType<typeof createLegacyQueue>["read"]>>
export type DurableReview = { token: LegacyReviewToken; entries: View["entries"]; sources: View["sources"]; projections: DurableReviewSource[] }

export type DurableReviewSource = LegacyQueueSource & { sourceId: string; mirrorEvidence?: true }
export function legacyReviewProjections(sources: View["sources"]): DurableReviewSource[] {
  return sources.flatMap(source => {
    if (source.kind === "collection-mirror" && source.retainedValue && typeof source.retainedValue === "object") {
      const mirror = source.retainedValue as Record<string, unknown>
      if (Array.isArray(mirror.pendingOperations) && !mirror.pendingOperations.length) return []
      if (Array.isArray(mirror.collection) && !Object.hasOwn(mirror, "pendingOperations")) return []
    }
    const raw = source.kind === "local-storage" ? source.raw : JSON.stringify(source.retainedValue)
    return raw === null || raw === undefined ? [] : [{ sourceId: source.sourceId, ...(source.kind === "collection-mirror" ? { mirrorEvidence: true as const } : {}),
      legacyQueueSource: { version: 1 as const, raw, digest: sourceDigest(raw), accepted: source.accepted } }]
  })
}

/** One staged authority. Cached views are projections, never a write/replay fallback. */
export function createLegacyQueueRuntime(store: AtomicOfflineStore, active: () => Context | null, transport: typeof fetch = fetch, changed: () => void = () => {}) {
  const queue = createLegacyQueue(store, active), holder = crypto.randomUUID()
  let cached: { context: Context | null; value: View } | null = null
  let flushing = false
  const current = (context: Context | null) => {
    const now = active()
    return context === null ? now === null : !!now && now.session === context.session && sameCollectionOrigin(now.origin, context.origin)
  }
  const view = () => cached && current(cached.context) ? cached.value : null
  const refresh = async () => {
    const context = structuredClone(active())
    const value = await queue.read(context?.origin ?? null)
    if (!current(context)) throw new Error("queue_session_changed")
    cached = { context, value }
    return value
  }
  const publish = () => { changed() }
  const reviewQueue = (origin: CollectionOrigin, session: string) => createLegacyQueue(store, () => {
    const context = active()
    if (!context || context.session !== session || context.origin.kind !== "account" || origin.kind !== "account"
      || context.origin.actorUserId !== origin.actorUserId || context.origin.ownerUserId !== origin.ownerUserId) return null
    return { session, origin }
  })
  return {
    queue, view, refresh,
    async initialize(storage: Pick<Storage, "getItem">) {
      await queue.initialize(storage)
      // Capture a racing old writer after the initialization transaction too.
      await queue.observeOldSource({ kind: "local-storage", raw: storage.getItem("pokemon_collection_pending_ops_v1") })
    },
    async observe(storage: Pick<Storage, "getItem">, values: (string | null)[] = []) {
      for (const raw of [...values, storage.getItem("pokemon_collection_pending_ops_v1")]) await queue.observeOldSource({ kind: "local-storage", raw })
      const mirror = await store.get("collection")
      if (mirror !== undefined) await queue.observeOldSource({ kind: "collection-mirror", retainedValue: mirror })
      await refresh(); publish()
    },
    async enqueue(input: PendingCollectionOperationInput) {
      const value = view()
      if (!value || !input.origin) throw new Error("queue_not_ready")
      const tail = value.entries.findLast(entry => entry.state !== "completed" && sameLegacySlot(entry.operation, input))
      const result = await queue.enqueue(input, { epoch: value.token.epoch, entryRevision: tail?.revision ?? null })
      // The enqueue commit is authoritative even if a later view read or session changes.
      try { await refresh() } catch { cached = null }
      publish()
      return result
    },
    async prepareReview(origin: CollectionOrigin): Promise<DurableReview> {
      const context = active()
      if (!context) throw new Error("queue_not_ready")
      const facade = reviewQueue(origin, context.session)
      await facade.retainGuestReview()
      const value = await facade.read(origin), token = await facade.prepareReview(origin)
      if (value.token.epoch !== token.epoch || value.token.revision !== token.revision) throw new Error("queue_changed")
      return { token, entries: value.entries, sources: value.sources, projections: legacyReviewProjections(value.sources) }
    },
    async acceptReview(review: DurableReview, selections: LegacyReviewSelection[]) {
      await reviewQueue(review.token.origin, review.token.session).acceptReview(review.token, review.sources, selections)
      try { await refresh() } catch { cached = null }
      publish()
    },
    async cancelReview(review: DurableReview) {
      await reviewQueue(review.token.origin, review.token.session).pauseBatch(`${review.token.epoch}:${review.token.revision}`, review.token.origin, "cancelled_review_upload")
      try { await refresh() } catch { cached = null }
      publish()
    },
    async flush(onAcknowledged?: (outcome: Extract<LegacyDeliveryOutcome, { kind: "acknowledged" }>, pokemonId: number, origin: CollectionOrigin) => void) {
      const context = structuredClone(active())
      if (flushing || context?.origin.kind !== "account") return
      flushing = true
      try {
        const scopes = await queue.deliveryScopes(context.origin)
        for (const scope of scopes) {
          const sender = reviewQueue(scope, context.session)
          while (current(context)) {
            const claim = await sender.claim(scope, context.session, holder, Date.now())
            if (!claim || !current(context)) break
            let outcome: LegacyDeliveryOutcome
            try {
              const response = await transport(claim.request.url, { method: claim.request.method, headers: claim.request.headers, body: claim.request.body })
              const payload = await response.json().catch(() => null)
              const pokemonId = claim.request.body ? JSON.parse(claim.request.body).pokemonId : Number(new URL(claim.request.url, "http://localhost").searchParams.get("pokemonId"))
              if (response.ok && (claim.request.method === "DELETE" ? payload?.success === true
                : payload?.item && typeof payload.item.id === "string" && payload.item.pokemon_id === pokemonId && typeof payload.item.pokemon_name === "string"
                  && isSlotStatus(payload.item.status) && Array.isArray(payload.item.wanted_cards) && typeof payload.item.collected_at === "string")) {
                outcome = { kind: "acknowledged", item: claim.request.method === "DELETE" ? null : normalizeCollectionItem(payload.item), ...(response.headers.get("X-Activity-Event") ? { activityEventId: response.headers.get("X-Activity-Event")! } : {}) }
              } else if (payload && typeof payload.code === "string" && ((response.status === 503 && payload.retainOnDevice === true && RECIPIENT_RETENTION_CODES.has(payload.code)) || (response.status === 409 && payload.code === "binder_converted_requires_slot_commands"))) {
                outcome = { kind: "known-rejection", category: payload.code === "binder_converted_requires_slot_commands" ? "compatibility" : "recipient", code: payload.code }
              } else if (response.status === 409 && payload && typeof payload === "object" && Object.hasOwn(payload, "item")) {
                outcome = { kind: "known-rejection", category: "conflict", code: "row_conflict", serverItem: payload.item ? normalizeCollectionItem(payload.item) : null }
              } else outcome = { kind: "unknown", code: "delivery_unknown" }
            } catch { outcome = { kind: "unknown", code: "delivery_unknown" } }
            if (!current(context)) break
            const settled = await sender.settle(claim, outcome)
            await refresh(); publish()
            if (!current(context)) break
            if (settled && outcome.kind === "acknowledged") {
              const value = await sender.read(scope)
              const entry = value.entries.find(entry => entry.entryId === claim.entryId)
              if (entry && current(context)) onAcknowledged?.(outcome, entry.operation.pokemonId, scope)
            }
          }
        }
        if (current(context)) { await refresh(); publish() }
      } finally { flushing = false }
    },
  }
}
export type LegacyQueueRuntime = ReturnType<typeof createLegacyQueueRuntime>
