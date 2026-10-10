// Local-first persistence: the collection snapshot and the queue of pending remote writes,
// both stored in localStorage so edits survive reloads and offline periods.
import { writeLocalCollectedIds } from "@/lib/local-collection"
import type { CollectedPokemon } from "@/lib/domain/cards"
import { normalizeCollectionItem, normalizeCollectionItems } from "@/lib/collection/normalize"
import { mirrorCollectionSnapshot, mirrorPendingOperations } from "@/lib/offline-store/collection-mirror"

export interface LocalCollectionSnapshot {
  ownerUserId: string | null
  savedAt: string
  collection: CollectedPokemon[]
}

// `base` is the server row the edit was made against (null: no row). It is what conflict detection compares
// with (see lib/collection/sync.ts). Edits queued before this field existed have no `base` and are written as-is.
export type PendingCollectionOperation =
  | {
      id: string
      type: "upsert"
      pokemonId: number
      item: CollectedPokemon
      queuedAt: string
      base?: CollectedPokemon | null
    }
  | {
      id: string
      type: "delete"
      pokemonId: number
      queuedAt: string
      base?: CollectedPokemon | null
    }

export type PendingCollectionOperationInput =
  | {
      type: "upsert"
      pokemonId: number
      item: CollectedPokemon
      base?: CollectedPokemon | null
    }
  | {
      type: "delete"
      pokemonId: number
      base?: CollectedPokemon | null
    }

function parseBase(operation: object): { base?: CollectedPokemon | null } {
  if (!("base" in operation)) return {}
  const base = (operation as { base?: unknown }).base
  if (base === null) return { base: null }
  if (base && typeof base === "object") return { base: normalizeCollectionItem(base as Partial<CollectedPokemon>) }
  return {}
}

export const LOCAL_COLLECTION_SNAPSHOT_KEY = "pokemon_collection_snapshot_v1"
export const LOCAL_COLLECTION_PENDING_OPS_KEY = "pokemon_collection_pending_ops_v1"
export function readLocalCollectionSnapshot() {
  if (typeof window === "undefined") return null

  try {
    const stored = window.localStorage.getItem(LOCAL_COLLECTION_SNAPSHOT_KEY)
    if (!stored) return null

    const parsed = JSON.parse(stored) as Partial<LocalCollectionSnapshot> | null
    if (!parsed || !Array.isArray(parsed.collection)) {
      return null
    }

    return {
      ownerUserId: typeof parsed.ownerUserId === "string" ? parsed.ownerUserId : null,
      savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : new Date(0).toISOString(),
      collection: normalizeCollectionItems(parsed.collection),
    }
  } catch {
    return null
  }
}

export function writeLocalCollectionSnapshot(snapshot: LocalCollectionSnapshot) {
  if (typeof window === "undefined") return

  // Durable copy in IndexedDB, written even if localStorage is full.
  mirrorCollectionSnapshot(snapshot.collection, snapshot.ownerUserId, snapshot.savedAt)

  try {
    window.localStorage.setItem(LOCAL_COLLECTION_SNAPSHOT_KEY, JSON.stringify(snapshot))
  } catch {
    // ignore quota failures
  }
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

      if (item.type === "delete") {
        return [{
          id: item.id,
          type: "delete",
          pokemonId: item.pokemonId,
          queuedAt: typeof item.queuedAt === "string" ? item.queuedAt : new Date().toISOString(),
          ...parseBase(item),
        }]
      }

      if (item.type === "upsert" && "item" in item && item.item) {
        return [{
          id: item.id,
          type: "upsert",
          pokemonId: item.pokemonId,
          item: normalizeCollectionItem(item.item),
          queuedAt: typeof item.queuedAt === "string" ? item.queuedAt : new Date().toISOString(),
          ...parseBase(item),
        }]
      }

      return []
    })
  } catch {
    return []
  }
}

export function writePendingCollectionOperations(operations: PendingCollectionOperation[]) {
  if (typeof window === "undefined") return

  mirrorPendingOperations(operations)

  try {
    window.localStorage.setItem(LOCAL_COLLECTION_PENDING_OPS_KEY, JSON.stringify(operations))
  } catch {
    // ignore quota failures
  }
}

export function createPendingOperationId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function queuePendingCollectionOperation(operation: PendingCollectionOperationInput) {
  const existing = readPendingCollectionOperations()
  const replaced = existing.find((queuedOperation) => queuedOperation.pokemonId === operation.pokemonId)
  // One edit per Pokémon: the newest wins, but it keeps the base of the first unsynced edit, because that
  // is the server state all of them were made against.
  const base = replaced ? replaced.base : operation.base
  const nextOperation = {
    ...operation,
    base,
    id: createPendingOperationId(),
    queuedAt: new Date().toISOString(),
  } as PendingCollectionOperation
  if (base === undefined) delete nextOperation.base
  const operations = existing.filter((queuedOperation) => queuedOperation.pokemonId !== operation.pokemonId)

  writePendingCollectionOperations([...operations, nextOperation])
  return nextOperation
}

export function hasPendingCollectionOperation(pokemonId: number) {
  return readPendingCollectionOperations().some((operation) => operation.pokemonId === pokemonId)
}

/** Replace a queued edit in place (after a conflict merge), keeping its position. */
export function replacePendingCollectionOperation(operationId: string, next: PendingCollectionOperation) {
  writePendingCollectionOperations(
    readPendingCollectionOperations().map((operation) => (operation.id === operationId ? next : operation)),
  )
}

/** A newer edit for the same Pokémon is now based on what the server just stored. */
export function rebasePendingCollectionOperation(pokemonId: number, base: CollectedPokemon | null) {
  const operations = readPendingCollectionOperations()
  if (!operations.some((operation) => operation.pokemonId === pokemonId)) return
  writePendingCollectionOperations(
    operations.map((operation) => (operation.pokemonId === pokemonId ? { ...operation, base } : operation)),
  )
}

export function removePendingCollectionOperation(operationId: string) {
  writePendingCollectionOperations(
    readPendingCollectionOperations().filter((operation) => operation.id !== operationId),
  )
}

export function persistLocalCollectionState(collection: CollectedPokemon[], ownerUserId: string | null) {
  writeLocalCollectionSnapshot({
    ownerUserId,
    savedAt: new Date().toISOString(),
    collection,
  })
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
