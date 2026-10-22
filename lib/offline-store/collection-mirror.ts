// Keeps the IndexedDB copy of the collection and pending edits in step with localStorage.
// localStorage stays the synchronous source the app reads first; IndexedDB is the durable copy
// that survives localStorage quota failures and is readable offline.
import type { CollectedPokemon } from "@/lib/domain/cards"
import { getOfflineStore, type OfflineKeyValueStore } from "@/lib/offline-store/kv"
import { loadCollectionRecord, saveCollectionRecord, type CollectionRecord } from "@/lib/offline-store/records"

const MIRROR_DELAY_MS = 400
const MAX_MIGRATION_WAIT_MS = 5000

let pendingCollection: { collection: CollectedPokemon[]; ownerUserId: string | null; savedAt: string; binderId: string | null } | null = null
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

async function writeMirror(store: OfflineKeyValueStore, collectionUpdate: typeof pendingCollection, operationsUpdate: unknown[] | null) {
  const existing = await loadCollectionRecord(store)
  const next: CollectionRecord = {
    ownerUserId: collectionUpdate ? collectionUpdate.ownerUserId : existing?.ownerUserId ?? null,
    binderId: collectionUpdate ? collectionUpdate.binderId : existing?.binderId ?? null,
    savedAt: collectionUpdate ? collectionUpdate.savedAt : existing?.savedAt ?? new Date().toISOString(),
    collection: collectionUpdate ? collectionUpdate.collection : existing?.collection ?? [],
    pendingOperations: operationsUpdate ?? existing?.pendingOperations ?? [],
  }
  await saveCollectionRecord(store, next)
}

/** Write whatever is queued now (also used on page hide). */
export function flushCollectionMirror(store: OfflineKeyValueStore | null = getOfflineStore()) {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (!store || (!pendingCollection && !pendingOperations)) return flushing
  const collectionUpdate = pendingCollection
  const operationsUpdate = pendingOperations
  pendingCollection = null
  pendingOperations = null
  flushing = flushing
    .then(() => writeMirror(store, collectionUpdate, operationsUpdate))
    .catch((error) => console.error("[binderdex] Failed to save collection to IndexedDB:", error))
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
) {
  pendingCollection = { collection, ownerUserId, savedAt, binderId }
  schedule(store)
}

export function mirrorPendingOperations(operations: unknown[], store = getOfflineStore()) {
  pendingOperations = operations
  schedule(store)
}
