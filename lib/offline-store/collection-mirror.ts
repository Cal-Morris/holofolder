// Keeps the IndexedDB copy of the collection and pending edits in step with localStorage.
// localStorage stays the synchronous source the app reads first; IndexedDB is the durable copy
// that survives localStorage quota failures and is readable offline.
import type { CollectedPokemon } from "@/lib/domain/cards"
import { getOfflineStore, type OfflineKeyValueStore } from "@/lib/offline-store/kv"
import { loadCollectionRecord, saveCollectionRecord, type CollectionRecord } from "@/lib/offline-store/records"
import { collectionRecordKey, LEGACY_COLLECTION_RECORD_KEY } from "@/lib/binders/offline"

const MIRROR_DELAY_MS = 400
const MAX_MIGRATION_WAIT_MS = 5000

type CollectionUpdate = { collection: CollectedPokemon[]; ownerUserId: string | null; savedAt: string; binderId: string | null }
// One pending copy per record: the default binder's "collection", and "collection:<binderId>" for the others.
let pendingCollections = new Map<string, CollectionUpdate>()
let pendingOperations: unknown[] | null = null
let timer: ReturnType<typeof setTimeout> | null = null
let flushing: Promise<void> = Promise.resolve()

/**
 * Mirror writes wait for the one-time localStorage migration, so the migration always sees the store as it
 * was before this page load (otherwise a mirror write landing first makes it report "kept-existing").
 */
export function holdCollectionMirrorUntil(ready: Promise<unknown>, maxWaitMs = MAX_MIGRATION_WAIT_MS) {
  // Never hold the durable copy hostage: if the migration stalls, mirror writes go ahead after maxWaitMs.
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, maxWaitMs))
  flushing = flushing.then(() => Promise.race([ready, timeout])).then(() => undefined, () => undefined)
}

async function writeRecord(store: OfflineKeyValueStore, key: string, collectionUpdate: CollectionUpdate | null, operationsUpdate: unknown[] | null) {
  const existing = await loadCollectionRecord(store, key)
  // Pending edits are one queue for every binder, kept in the default record only.
  const isQueueRecord = key === LEGACY_COLLECTION_RECORD_KEY
  const next: CollectionRecord = {
    ownerUserId: collectionUpdate ? collectionUpdate.ownerUserId : existing?.ownerUserId ?? null,
    binderId: collectionUpdate ? collectionUpdate.binderId : existing?.binderId ?? null,
    savedAt: collectionUpdate ? collectionUpdate.savedAt : existing?.savedAt ?? new Date().toISOString(),
    collection: collectionUpdate ? collectionUpdate.collection : existing?.collection ?? [],
    pendingOperations: isQueueRecord ? operationsUpdate ?? existing?.pendingOperations ?? [] : [],
  }
  await saveCollectionRecord(store, next, key)
}

async function writeMirror(store: OfflineKeyValueStore, collectionUpdates: Map<string, CollectionUpdate>, operationsUpdate: unknown[] | null) {
  const keys = new Set(collectionUpdates.keys())
  if (operationsUpdate) keys.add(LEGACY_COLLECTION_RECORD_KEY)
  for (const key of keys) {
    await writeRecord(store, key, collectionUpdates.get(key) ?? null, key === LEGACY_COLLECTION_RECORD_KEY ? operationsUpdate : null)
  }
}

/** Write whatever is queued now (also used on page hide). */
export function flushCollectionMirror(store: OfflineKeyValueStore | null = getOfflineStore()) {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (!store || (pendingCollections.size === 0 && !pendingOperations)) return flushing
  const collectionUpdates = pendingCollections
  const operationsUpdate = pendingOperations
  pendingCollections = new Map()
  pendingOperations = null
  flushing = flushing
    .then(() => writeMirror(store, collectionUpdates, operationsUpdate))
    .catch((error) => console.error("[holofolder] Failed to save collection to IndexedDB:", error))
  return flushing
}

function schedule(store: OfflineKeyValueStore | null) {
  if (!store || timer) return
  timer = setTimeout(() => {
    timer = null
    void flushCollectionMirror(store)
  }, MIRROR_DELAY_MS)
}

export function mirrorCollectionSnapshot(
  collection: CollectedPokemon[],
  ownerUserId: string | null,
  savedAt: string,
  store = getOfflineStore(),
  binderId: string | null = null,
  isDefault = true,
) {
  pendingCollections.set(collectionRecordKey(binderId, isDefault), { collection, ownerUserId, savedAt, binderId })
  schedule(store)
}

export function mirrorPendingOperations(operations: unknown[], store = getOfflineStore()) {
  pendingOperations = operations
  schedule(store)
}

/** Staged snapshot writer preserves old queue fields verbatim; they are evidence, never a projection. */
export async function mirrorDurableCollectionSnapshot(snapshot: { collection: CollectedPokemon[]; ownerUserId: string | null; savedAt: string; binderId?: string | null }, isDefault: boolean, store = getOfflineStore()) {
  if (!store) throw new Error("queue_storage_unavailable")
  await store.update(collectionRecordKey(snapshot.binderId ?? null, isDefault), existing => {
    if (existing !== undefined && (!existing || typeof existing !== "object" || Object.getPrototypeOf(existing) !== Object.prototype)) return existing
    if (existing !== undefined) {
      const record = existing as Record<string, unknown>
      if (!Array.isArray(record.collection) || (Object.hasOwn(record, "pendingOperations") && !Array.isArray(record.pendingOperations))) return existing
    }
    return { ...existing as Record<string, unknown>, ...snapshot }
  })
}
