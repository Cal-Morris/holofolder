import { legacyReviewEntries } from "@/lib/collection/legacy-review"
import { parseCollectionOrigin, sameCollectionOrigin, type CollectionOrigin } from "@/lib/collection/recipient"
import { decodeQueueArray, isLegacyQueueSource, sourceDigest, type LegacyQueueSource } from "@/lib/collection/legacy-source"
import { mergeQueuedAcquisition, type AcquisitionIntent } from "@/lib/partner-push"
// Local-first persistence: the collection snapshot and the queue of pending remote writes,
// both stored in localStorage so edits survive reloads and offline periods.
import { writeLocalCollectedIds } from "@/lib/local-collection"
import { isSlotStatus, type CollectedPokemon } from "@/lib/domain/cards"
import { normalizeCollectionItems } from "@/lib/collection/normalize"
import { mirrorCollectionSnapshot, mirrorPendingOperations, mirrorDurableCollectionSnapshot } from "@/lib/offline-store/collection-mirror"
import { capBinderSnapshots, setItemMakingRoom } from "@/lib/storage/make-room"
import { collectionSnapshotKey, hasOwnOfflineKeys, LEGACY_COLLECTION_SNAPSHOT_KEY, markBinderSavedOnDevice } from "@/lib/binders/offline"

export interface LocalCollectionSnapshot {
  ownerUserId: string | null
  /** The binder the snapshot is of; null for the single-binder layout and snapshots saved before binders. */
  binderId?: string | null
  savedAt: string
  collection: CollectedPokemon[]
}

// `base` is the server row the edit was made against (null: no row). It is what conflict detection compares
// with (see lib/collection/sync.ts). Historical edits without a base remain review evidence.
export type PendingCollectionOperation = {
  intentProtocol?: 1
  amendments?: string[]
  origin?: CollectionOrigin
  original?: { raw: string }
  recipientPause?: string
  deliveryUnknown?: boolean
  recoverySource?: { digest: string; ordinal: number; reviewEpoch?: string }
} & (
  | {
      id: string
      type: "upsert"
      acquisition?: AcquisitionIntent
      importOnly?: true
      pokemonId: number
      item: CollectedPokemon
      compatibilityPause?: { code: "binder_converted_requires_slot_commands"; rawRecord: string }
      billingPause?: string
      queuedAt: string
      base?: CollectedPokemon | null
      binderId?: string | null
    }
  | {
      id: string
      type: "delete"
      pokemonId: number
      compatibilityPause?: { code: "binder_converted_requires_slot_commands"; rawRecord: string }
      billingPause?: string
      queuedAt: string
      base?: CollectedPokemon | null
      binderId?: string | null
    }

)

export type PendingCollectionOperationInput = {
  origin?: CollectionOrigin
  recoverySource?: { digest: string; ordinal: number; reviewEpoch?: string }
} & (
  | {
      type: "upsert"
      acquisition?: AcquisitionIntent
      importOnly?: true
      pokemonId: number
      item: CollectedPokemon
      base?: CollectedPokemon | null
      binderId?: string | null
    }
  | {
      type: "delete"
      pokemonId: number
      base?: CollectedPokemon | null
      binderId?: string | null
    }

)

/** Concrete delivery binder; null is unbound evidence and never resolves to a later default. */
export function pendingOperationBinderId(operation: { binderId?: string | null }) {
  return typeof operation.binderId === "string" && operation.binderId ? operation.binderId : null
}

function sameSlot(operation: { pokemonId: number; binderId?: string | null; origin?: CollectionOrigin }, pokemonId: number, binderId: string | null, origin?: CollectionOrigin | null) {
  return operation.pokemonId === pokemonId && pendingOperationBinderId(operation) === binderId
    && sameCollectionOrigin(operation.origin, origin)
}

/** The default binder's snapshot (and the only one before binders). Other binders use `…:<binderId>`. */
export const LOCAL_COLLECTION_SNAPSHOT_KEY = LEGACY_COLLECTION_SNAPSHOT_KEY
export const LOCAL_COLLECTION_PENDING_OPS_KEY = "pokemon_collection_pending_ops_v1"

function parseSnapshot(stored: string | null): Partial<LocalCollectionSnapshot> | null {
  if (!stored) return null
  const parsed = JSON.parse(stored) as Partial<LocalCollectionSnapshot> | null
  return parsed && Array.isArray(parsed.collection) ? parsed : null
}

/**
 * The saved collection of one binder (default: the original key). A non-default binder with no copy of its own
 * yet falls back to the original key when that still holds this binder (saved there before per-binder keys).
 */
export function readLocalCollectionSnapshot(binderId: string | null = null, isDefault = true) {
  if (typeof window === "undefined") return null

  try {
    let parsed = parseSnapshot(window.localStorage.getItem(collectionSnapshotKey(binderId, isDefault)))
    if (!parsed && hasOwnOfflineKeys(binderId, isDefault)) {
      const legacy = parseSnapshot(window.localStorage.getItem(LOCAL_COLLECTION_SNAPSHOT_KEY))
      parsed = legacy?.binderId === binderId ? legacy : null
    }
    if (!parsed || !Array.isArray(parsed.collection)) {
      return null
    }

    return {
      ownerUserId: typeof parsed.ownerUserId === "string" ? parsed.ownerUserId : null,
      ...(typeof parsed.binderId === "string" ? { binderId: parsed.binderId } : {}),
      savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : new Date(0).toISOString(),
      collection: normalizeCollectionItems(parsed.collection),
    }
  } catch {
    return null
  }
}

export function writeLocalCollectionSnapshot(snapshot: LocalCollectionSnapshot, isDefault = true, durable = false) {
  if (typeof window === "undefined") return
  const binderId = snapshot.binderId ?? null

  // Durable copy in IndexedDB, written even if localStorage is full.
  if (durable) void mirrorDurableCollectionSnapshot(snapshot, isDefault).catch(error => console.error("[holofolder] Snapshot mirror failed:", error))
  else mirrorCollectionSnapshot(snapshot.collection, snapshot.ownerUserId, snapshot.savedAt, undefined, binderId, isDefault)

  const key = collectionSnapshotKey(binderId, isDefault)
  // Bounded: only the few most recently saved other binders keep a localStorage copy (the rest are in IndexedDB).
  capBinderSnapshots(window.localStorage, key)
  try {
    setItemMakingRoom(window.localStorage, key, JSON.stringify(snapshot))
  } catch {
    // Still full: the IndexedDB copy above is the durable one.
  }
  // This binder now opens offline on this device.
  markBinderSavedOnDevice(window.localStorage, snapshot.ownerUserId, binderId)
}

const operationKeys = ["intentProtocol", "amendments", "origin", "original", "recipientPause", "deliveryUnknown", "recoverySource", "id", "type", "acquisition", "importOnly", "pokemonId", "item", "billingPause", "queuedAt", "base", "binderId", "compatibilityPause"]
const rowKeys = ["id", "pokemon_id", "pokemon_name", "card_id", "card_name", "card_image", "card_set", "card_language", "card_finish", "wanted_cards", "status", "collected_at"]
const wantedKeys = ["card_id", "card_name", "card_image", "card_set", "card_language", "card_finish", "rarity", "local_id", "set_total", "illustrator", "added_at", "wanted_by"]
function boundRow(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  return Object.keys(row).every(key => rowKeys.includes(key)) && Number.isInteger(row.pokemon_id) && typeof row.pokemon_name === "string"
    && isSlotStatus(row.status) && Array.isArray(row.wanted_cards) && row.wanted_cards.every(card => card && typeof card === "object"
      && Object.keys(card).every(key => wantedKeys.includes(key)) && typeof card.card_id === "string" && typeof card.card_name === "string")
}
function boundOperation(value: unknown, entries: unknown[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const op = value as PendingCollectionOperation
  const origin = parseCollectionOrigin(op.origin)
  return op.intentProtocol === 1 && !!origin && Object.keys(op).every(key => operationKeys.includes(key))
    && Object.keys(op.origin!).every(key => (origin.kind === "account" ? ["kind", "actorUserId", "ownerUserId", "binderId"] : ["kind", "workspaceId", "localBinderId"]).includes(key))
    && (origin.kind !== "account" || op.binderId === origin.binderId)
    && typeof op.id === "string" && !!op.id && entries.filter(entry => entry && typeof entry === "object" && "id" in entry && entry.id === op.id).length === 1
    && typeof op.queuedAt === "string" && Number.isInteger(op.pokemonId) && op.pokemonId > 0
    && (!("base" in op) || op.base === null || boundRow(op.base))
    && (op.type === "delete" || (op.type === "upsert" && boundRow(op.item) && op.item.pokemon_id === op.pokemonId))
}

export function readPendingCollectionOperations(): PendingCollectionOperation[] {
  if (typeof window === "undefined") return []

  try {
    const stored = window.localStorage.getItem(LOCAL_COLLECTION_PENDING_OPS_KEY)
    if (!stored) return []

    const parsed = JSON.parse(stored)
    if (!Array.isArray(parsed)) return []

    return parsed.flatMap((operation): PendingCollectionOperation[] => {
      if (!operation || typeof operation !== "object") return []
      const item = operation as Partial<PendingCollectionOperation>
      if (typeof item.id !== "string" || typeof item.type !== "string") return []
      if (typeof item.pokemonId !== "number" || !Number.isInteger(item.pokemonId) || item.pokemonId <= 0) return []

      // Paused intent is evidence, never normalize or rebase it into a different command.
      if (item.compatibilityPause?.code === "binder_converted_requires_slot_commands"
        && (item.type === "delete" || (item.type === "upsert" && item.item))) {
        return [operation as PendingCollectionOperation]
      }

      if (boundOperation(item, parsed)) return [operation as PendingCollectionOperation]
      // Unbound historical records are review evidence, never replayable edits.
      return []
    })
  } catch {
    return []
  }
}

/** Snapshot raw bytes before parsing. Unbound/unknown entries move atomically into evidence in this key. */
export function readLegacyQueueSources(): LegacyQueueSource[] {
  if (typeof window === "undefined") return []
  const raw = window.localStorage.getItem(LOCAL_COLLECTION_PENDING_OPS_KEY)
  const entries = decodeQueueArray(raw)
  const sources = (entries ?? []).filter(isLegacyQueueSource)
  const ordinals = entries?.flatMap((entry, ordinal) => !isLegacyQueueSource(entry) && !boundOperation(entry, entries)
    && !(entry && typeof entry === "object" && (entry as PendingCollectionOperation).compatibilityPause) ? [ordinal] : [])
  if (raw !== null && (entries === null || ordinals?.length))
    sources.push({ legacyQueueSource: { version: 1, raw, digest: sourceDigest(raw), ...(ordinals ? { ordinals } : {}) } })
  return sources
}

export function writePendingCollectionOperations(operations: PendingCollectionOperation[], sources = readLegacyQueueSources()) {
  if (typeof window === "undefined") return
  const records = [...sources, ...operations.filter(op => !isLegacyQueueSource(op) && (parseCollectionOrigin(op.origin) || op.compatibilityPause))]
  // Do not send an edit whose synchronous authority could not be persisted.
  setItemMakingRoom(window.localStorage, LOCAL_COLLECTION_PENDING_OPS_KEY, JSON.stringify(records))
  mirrorPendingOperations(records)
  window.dispatchEvent?.(new Event("holofolder-legacy-queue-changed"))
}

/** Read original record bytes before a send can race a newer local edit. */
export function readPendingCollectionOperationRaw(operationId: string) {
  if (typeof window === "undefined") return
  const stored = window.localStorage.getItem(LOCAL_COLLECTION_PENDING_OPS_KEY)
  if (!stored || !Array.isArray(JSON.parse(stored))) return
  const arrayStart = stored.indexOf("[")
  const records: string[] = []
  let depth = 0, quoted = false, escaped = false, start = arrayStart + 1
  for (let i = arrayStart + 1; i < stored.length; i++) {
    const char = stored[i]
    if (quoted) {
      if (escaped) escaped = false
      else if (char === "\\") escaped = true
      else if (char === '"') quoted = false
    } else if (char === '"') quoted = true
    else if (char === "{" || char === "[") depth++
    else if (depth === 0 && (char === "," || char === "]")) {
      records.push(stored.slice(start, i))
      start = i + 1
    } else if (char === "}" || char === "]") depth--
  }
  return records.find(record => record.trim() && JSON.parse(record)?.id === operationId)
}

/** Pause in the existing queue, keeping the original intent even if a newer edit replaced it in flight. */
export function pauseLegacyCollectionOperation(operationId: string, originalRaw = readPendingCollectionOperationRaw(operationId)) {
  if (typeof window === "undefined" || !originalRaw) return
  const original = JSON.parse(originalRaw)
  if (original.compatibilityPause) return
  const stored = window.localStorage.getItem(LOCAL_COLLECTION_PENDING_OPS_KEY)
  const operations = stored ? JSON.parse(stored) : []
  if (!Array.isArray(operations)) return
  if (operations.some(operation => operation?.id === operationId && operation.compatibilityPause)) return
  const paused = { ...original, compatibilityPause: { code: "binder_converted_requires_slot_commands", rawRecord: originalRaw } }
  const exists = operations.some(operation => operation?.id === operationId)
  writePendingCollectionOperations(exists
    ? operations.map(operation => operation?.id === operationId ? paused : operation)
    : [paused, ...operations])
}

export function createPendingOperationId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function queuePendingCollectionOperation(operation: PendingCollectionOperationInput) {
  const existing = readPendingCollectionOperations()
  if (operation.origin?.kind === "account" && operation.binderId && operation.binderId !== operation.origin.binderId) throw new Error("Edit binder does not match its immutable origin")
  const binderId = operation.origin?.kind === "account" ? operation.origin.binderId : pendingOperationBinderId(operation)
  const replaced = existing.find((queuedOperation) => !queuedOperation.compatibilityPause && !queuedOperation.deliveryUnknown && !queuedOperation.recipientPause && sameSlot(queuedOperation, operation.pokemonId, binderId, operation.origin))
  // One edit per Pokémon: the newest wins, but it keeps the base of the first unsynced edit, because that
  // is the server state all of them were made against.
  const base = replaced ? replaced.base : operation.base
  const nextOperation = {
    ...operation,
    intentProtocol: 1,
    ...(operation.type === "upsert" ? { acquisition: mergeQueuedAcquisition(base, operation.item, operation.acquisition, replaced?.type === "upsert" ? replaced.acquisition : undefined) } : {}),
    base,
    id: createPendingOperationId(),
    queuedAt: new Date().toISOString(),
  } as PendingCollectionOperation
  if (base === undefined) delete nextOperation.base
  if (binderId) nextOperation.binderId = binderId
  else delete nextOperation.binderId
  const operations = existing.filter((queuedOperation) => Boolean(queuedOperation.compatibilityPause || queuedOperation.deliveryUnknown || queuedOperation.recipientPause) || !sameSlot(queuedOperation, operation.pokemonId, binderId, operation.origin))

  const captured = JSON.stringify(nextOperation)
  if (replaced) {
    nextOperation.id = replaced.id
    nextOperation.queuedAt = replaced.queuedAt
    nextOperation.original = replaced.original
    nextOperation.amendments = [...(replaced.amendments ?? []), captured]
  } else nextOperation.original = { raw: captured }
  if (!nextOperation.origin) {
    const raw = JSON.stringify([nextOperation])
    writePendingCollectionOperations(operations, [...readLegacyQueueSources(), { legacyQueueSource: { version: 1, raw, digest: sourceDigest(raw) } }])
  } else writePendingCollectionOperations([...operations, nextOperation])
  return nextOperation
}

export function hasPendingCollectionOperation(pokemonId: number, binderId: string | null = null, origin?: CollectionOrigin | null) {
  return readPendingCollectionOperations().some((operation) => sameSlot(operation, pokemonId, binderId, origin))
}

/** Replace a queued edit in place (after a conflict merge), keeping its position. */
export function replacePendingCollectionOperation(operationId: string, next: PendingCollectionOperation) {
  writePendingCollectionOperations(
    readPendingCollectionOperations().map((operation) => (operation.id === operationId && !operation.compatibilityPause
      ? { ...next, id: operation.id, origin: operation.origin, original: operation.original, amendments: operation.amendments,
        queuedAt: operation.queuedAt, binderId: operation.binderId, intentProtocol: operation.intentProtocol, recoverySource: operation.recoverySource }
      : operation)),
  )
}

/** A newer edit for the same Pokémon is now based on what the server just stored. */
export function rebasePendingCollectionOperation(pokemonId: number, base: CollectedPokemon | null, binderId: string | null = null, origin?: CollectionOrigin | null) {
  const operations = readPendingCollectionOperations()
  if (!operations.some((operation) => sameSlot(operation, pokemonId, binderId, origin))) return
  writePendingCollectionOperations(
    operations.map((operation) => (sameSlot(operation, pokemonId, binderId, origin) && !operation.compatibilityPause && !operation.deliveryUnknown ? { ...operation, base } : operation)),
  )
}

export function removePendingCollectionOperation(operationId: string) {
  writePendingCollectionOperations(
    readPendingCollectionOperations().filter((operation) => operation.id !== operationId || operation.compatibilityPause),
  )
}

export function persistLocalCollectionState(collection: CollectedPokemon[], ownerUserId: string | null, binderId: string | null = null, isDefault = true, durable = false) {
  writeLocalCollectionSnapshot({
    ownerUserId,
    ...(binderId ? { binderId } : {}),
    savedAt: new Date().toISOString(),
    collection,
  }, isDefault, durable)
  // The signed-out "collected ids" list predates binders and stays the default binder's.
  if (!isDefault) return
  writeLocalCollectedIds(
    collection
      .filter((item) => item.status !== "wishlisted")
      .map((item) => item.pokemon_id),
  )
}

export function isOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false
}

/**
 * Pending edits saved in IndexedDB but missing from localStorage (cleared or never written because it was
 * full) are put back so they still sync. Only when the localStorage key is absent: "[]" means "all synced".
 */
export function restorePendingCollectionOperations(operations: unknown[]) {
  if (typeof window === "undefined" || operations.length === 0) return 0

  try {
    if (window.localStorage.getItem(LOCAL_COLLECTION_PENDING_OPS_KEY) !== null) return 0
    window.localStorage.setItem(LOCAL_COLLECTION_PENDING_OPS_KEY, JSON.stringify(operations))
  } catch {
    return 0
  }
  return readPendingCollectionOperations().length
}

/** Freeze guest records into the same evidence authority before opening a review. No upload is authorized. */
export function prepareLegacyQueueReview() {
  const raw = window.localStorage.getItem(LOCAL_COLLECTION_PENDING_OPS_KEY)
  const operations = readPendingCollectionOperations()
  const guests = operations.filter(op => op.origin?.kind === "guest" && !op.compatibilityPause)
  const sources = readLegacyQueueSources()
  if (raw && guests.length) {
    const ordinals = (decodeQueueArray(raw) ?? []).flatMap((entry, ordinal) => entry && typeof entry === "object" && "id" in entry && guests.some(op => op.id === entry.id) ? [ordinal] : [])
    const source = sources.find(source => source.legacyQueueSource.raw === raw)
    if (source) source.legacyQueueSource.ordinals = [...new Set([...(source.legacyQueueSource.ordinals ?? []), ...ordinals])].sort((a, b) => a - b)
    else sources.push({ legacyQueueSource: { version: 1, raw, digest: sourceDigest(raw), ordinals } })
  }
  writePendingCollectionOperations(operations.filter(op => !guests.includes(op)), sources)
  return sources
}

/** One synchronous authority change: keep evidence, mark exact ordinals and enqueue only NEW reviewed actions. */
export function acceptLegacyQueueReview(expectedQueue: string, sources: LegacyQueueSource[], operations: PendingCollectionOperationInput[]) {
  if (window.localStorage.getItem(LOCAL_COLLECTION_PENDING_OPS_KEY) !== expectedQueue) throw new Error("Device changes changed. Reload the destination and review again.")
  const existing = readPendingCollectionOperations()
  const currentSources = readLegacyQueueSources()
  if (sources.length !== currentSources.length || sources.some((source, index) => (source.legacyQueueSource.raw !== currentSources[index].legacyQueueSource.raw || source.legacyQueueSource.digest !== currentSources[index].legacyQueueSource.digest))) throw new Error("Original source changed. Review again.")
  const eligible = legacyReviewEntries(currentSources, existing.filter(op => op.compatibilityPause).map(op => op.binderId ?? null))
  if (!operations.length) throw new Error("Choose at least one reviewed change.")
  for (const input of operations) {
    if (typeof input.recoverySource?.reviewEpoch !== "string" || !input.recoverySource.reviewEpoch || input.recoverySource.reviewEpoch !== operations[0].recoverySource?.reviewEpoch) throw new Error("Review acceptance epoch changed.")
    if (input.origin?.kind !== "account" || input.binderId !== input.origin.binderId || !sameCollectionOrigin(input.origin, operations[0].origin)) throw new Error("Review destination changed.")
    const matches = eligible.filter(entry => entry.source.legacyQueueSource.digest === input.recoverySource?.digest && entry.ordinal === input.recoverySource?.ordinal)
    const entry = matches[0]
    if (matches.length !== 1 || !entry?.operation || entry.unresolved || entry.operation.type !== input.type || entry.operation.pokemonId !== input.pokemonId
      || (input.type === "upsert" && entry.operation.type === "upsert" && JSON.stringify(entry.operation.item) !== JSON.stringify(input.item)) || !("base" in input)) throw new Error("A source entry cannot be accepted as reviewed.")
  }
  for (const [index, source] of sources.entries()) {
    const previous = currentSources[index].legacyQueueSource
    const ordinals = operations.filter(input => input.recoverySource?.digest === previous.digest).map(input => input.recoverySource!.ordinal)
    const expected = [...(previous.accepted ?? []), ...ordinals]
    if (JSON.stringify(source.legacyQueueSource.accepted ?? []) !== JSON.stringify(expected) || new Set(expected).size !== expected.length) throw new Error("Reviewed source entries changed.")
  }
  const next = operations.map(input => {
    const op = { ...input, intentProtocol: 1, id: createPendingOperationId(), queuedAt: new Date().toISOString() } as PendingCollectionOperation
    op.original = { raw: JSON.stringify(op) }
    return op
  })
  writePendingCollectionOperations([...existing, ...next], sources)
  window.dispatchEvent?.(new Event("holofolder-legacy-reviewed"))
}

/** Stop the rest of this accepted batch after a failure; no later reconnect may resume it blindly. */
export function pauseReviewedCollectionBatch(operationId: string, reason: string) {
  const operations = readPendingCollectionOperations()
  const failed = operations.find(op => op.id === operationId)
  if (!failed?.recoverySource) return
  writePendingCollectionOperations(operations.map(op => op.recoverySource && !op.compatibilityPause
    && sameCollectionOrigin(op.origin, failed.origin) && op.recoverySource.reviewEpoch === failed.recoverySource!.reviewEpoch
    ? { ...op, recipientPause: op.id === operationId ? reason : op.recipientPause ?? "review_batch_paused" } : op))
}
