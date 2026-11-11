import { readBillingCache } from "@/lib/billing-cache"
// Local-first binder start: which device data `/` may paint before the server's collection arrives.
import type { Binder } from "@/lib/binders/model"
import { matchBinder } from "@/lib/binders/url"
import { collectionSnapshotKey, LEGACY_COLLECTION_SNAPSHOT_KEY } from "@/lib/binders/offline"
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
  /** Cached display pointer only. Never authenticated scope or a complete read. */
  native?: { version: 1; deviceId: string; authSessionId: string }
}

export type LocalBinderStart = OfflineShellState & { binderId: string | null; binders: Binder[] }

export function readBinderStartMarker(storage: StorageLike): BinderStartMarker | null {
  try {
    const parsed = JSON.parse(storage.getItem(BINDER_START_MARKER_KEY) ?? "null") as Partial<BinderStartMarker> | null
    if (!parsed || typeof parsed.userId !== "string" || typeof parsed.ownerUserId !== "string") return null
    return {
      userId: parsed.userId,
      ownerUserId: parsed.ownerUserId,
      binderId: typeof parsed.binderId === "string" && parsed.binderId ? parsed.binderId : null,
      native: parsed.native?.version === 1 && typeof parsed.native.deviceId === "string" && typeof parsed.native.authSessionId === "string" ? parsed.native : undefined,
      binders: Array.isArray(parsed.binders) ? parsed.binders.filter((binder): binder is Binder => typeof binder?.id === "string") : [],
    }
  } catch {
    return null
  }
}

export function writeBinderStartMarker(storage: WritableStorage & Partial<StorageLike>, marker: BinderStartMarker) {
  try {
    const previous = storage.getItem ? readBinderStartMarker(storage as StorageLike) : null
    const native = marker.native ?? (previous?.userId === marker.userId && previous.ownerUserId === marker.ownerUserId ? previous.native : undefined)
    storage.setItem(BINDER_START_MARKER_KEY, JSON.stringify({ ...marker, native }))
  } catch {
    // Quota or private mode: the next start just waits for the server.
  }
}

function readSnapshotKey(storage: StorageLike, key: string): { ownerUserId: string | null; binderId: string | null } | null {
  try {
    const snapshot = JSON.parse(storage.getItem(key) ?? "null") as { ownerUserId?: unknown; binderId?: unknown; collection?: unknown } | null
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
  const marker = readBinderStartMarker(storage)
  if (!marker || marker.userId !== userId) return null
  if (marker.ownerUserId !== userId) {
    const access = readBillingCache(storage, userId, marker.ownerUserId)
    if (!access || (access.enforced && access.tier !== "paid")) return null
  }
  if (requestedBinderId && matchBinder(marker.binders, requestedBinderId)?.id !== marker.binderId) return null
  // A native marker is a display pointer only. IDB/JWT checks happen in CachedNativeStartup.
  // Native sessions need no obsolete legacy row snapshot to open their saved storage.
  if (marker.native) {
    const state = readOfflineShellState(storage, cookie, userId)
    return { ...state, collection: [], collectionOwnerUserId: marker.ownerUserId, binderId: marker.binderId, binders: marker.binders }
  }
  // Each binder has its own saved copy; the default binder's is under the original key.
  const isDefault = !marker.binderId || marker.binders.find((binder) => binder.id === marker.binderId)?.isDefault !== false
  let key = collectionSnapshotKey(marker.binderId, isDefault)
  let snapshot = readSnapshotKey(storage, key)
  if (!snapshot && key !== LEGACY_COLLECTION_SNAPSHOT_KEY) {
    // Saved under the original key before binders had their own.
    key = LEGACY_COLLECTION_SNAPSHOT_KEY
    snapshot = readSnapshotKey(storage, key)
  }
  if (!snapshot || snapshot.ownerUserId !== marker.ownerUserId || snapshot.binderId !== marker.binderId) return null
  const state = readOfflineShellState(storage, cookie, userId, key)
  if (state.collectionOwnerUserId !== marker.ownerUserId) return null
  return { ...state, binderId: marker.binderId, binders: marker.binders }
}
