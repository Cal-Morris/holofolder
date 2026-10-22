// Local-first binder start: which device data `/` may paint before the server's collection arrives.
import type { Binder } from "@/lib/binders/model"
import { LOCAL_COLLECTION_SNAPSHOT_KEY } from "@/lib/collection/offline-queue"
import { readOfflineShellState, type OfflineShellState } from "@/lib/offline-shell"

/** The account, collection owner and binder the server last opened on this device. */
export const BINDER_START_MARKER_KEY = "binderdex_start_v1"

type StorageLike = Pick<Storage, "getItem">
type WritableStorage = Pick<Storage, "setItem">

export interface BinderStartMarker {
  userId: string
  ownerUserId: string
  binderId: string | null
  binders: Binder[]
}

export type LocalBinderStart = OfflineShellState & { binderId: string | null; binders: Binder[] }

function readMarker(storage: StorageLike): BinderStartMarker | null {
  try {
    const parsed = JSON.parse(storage.getItem(BINDER_START_MARKER_KEY) ?? "null") as Partial<BinderStartMarker> | null
    if (!parsed || typeof parsed.userId !== "string" || typeof parsed.ownerUserId !== "string") return null
    return {
      userId: parsed.userId,
      ownerUserId: parsed.ownerUserId,
      binderId: typeof parsed.binderId === "string" && parsed.binderId ? parsed.binderId : null,
      binders: Array.isArray(parsed.binders) ? parsed.binders.filter((binder): binder is Binder => typeof binder?.id === "string") : [],
    }
  } catch {
    return null
  }
}

export function writeBinderStartMarker(storage: WritableStorage, marker: BinderStartMarker) {
  try {
    storage.setItem(BINDER_START_MARKER_KEY, JSON.stringify(marker))
  } catch {
    // Quota or private mode: the next start just waits for the server.
  }
}

function readSnapshotKey(storage: StorageLike): { ownerUserId: string | null; binderId: string | null } | null {
  try {
    const snapshot = JSON.parse(storage.getItem(LOCAL_COLLECTION_SNAPSHOT_KEY) ?? "null") as { ownerUserId?: unknown; binderId?: unknown; collection?: unknown } | null
    if (!snapshot || !Array.isArray(snapshot.collection)) return null
    return {
      ownerUserId: typeof snapshot.ownerUserId === "string" ? snapshot.ownerUserId : null,
      binderId: typeof snapshot.binderId === "string" && snapshot.binderId ? snapshot.binderId : null,
    }
  } catch {
    return null
  }
}

/**
 * The binder to paint straight away for `userId`, or null to wait for the server. Only when the server
 * already opened this account, owner and binder on this device, the saved snapshot is of that owner and
 * binder, and the URL does not ask for another binder. A different account on a shared device, a first
 * visit, or a link to another binder waits for the server.
 */
export function readLocalBinderStart(storage: StorageLike, cookie: string, userId: string, requestedBinderId: string | null = null): LocalBinderStart | null {
  const marker = readMarker(storage)
  if (!marker || marker.userId !== userId) return null
  if (requestedBinderId && requestedBinderId !== marker.binderId) return null
  const snapshot = readSnapshotKey(storage)
  if (!snapshot || snapshot.ownerUserId !== marker.ownerUserId || snapshot.binderId !== marker.binderId) return null
  const state = readOfflineShellState(storage, cookie, userId)
  if (state.collectionOwnerUserId !== marker.ownerUserId) return null
  return { ...state, binderId: marker.binderId, binders: marker.binders }
}
