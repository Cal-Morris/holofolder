import { readBillingCache } from '@/lib/billing-cache';
// Local-first binder start: which device data `/` may paint before the server's collection arrives.
import type { Binder } from '@/lib/binders/model';
import { matchBinder } from '@/lib/binders/url';
import { readOfflineShellState, type OfflineShellState } from '@/lib/offline-shell';

/** The account, collection owner and binder the server last opened on this device. */
export const BINDER_START_MARKER_KEY = 'binderdex_start_v1';

type StorageLike = Pick<Storage, 'getItem'>;
type WritableStorage = Pick<Storage, 'setItem'>;

export interface BinderStartMarker {
  userId: string;
  ownerUserId: string;
  binderId: string | null;
  binders: Binder[];
  /** Cached display pointer only. Never authenticated scope or a complete read. */
  native?: { version: 1; deviceId: string; authSessionId: string };
}

export type LocalBinderStart = OfflineShellState & { binderId: string | null; binders: Binder[] };

export function readBinderStartMarker(storage: StorageLike): BinderStartMarker | null {
  try {
    const parsed = JSON.parse(storage.getItem(BINDER_START_MARKER_KEY) ?? 'null') as Partial<BinderStartMarker> | null;
    if (!parsed || typeof parsed.userId !== 'string' || typeof parsed.ownerUserId !== 'string') return null;
    return {
      userId: parsed.userId,
      ownerUserId: parsed.ownerUserId,
      binderId: typeof parsed.binderId === 'string' && parsed.binderId ? parsed.binderId : null,
      native:
        parsed.native?.version === 1 &&
        typeof parsed.native.deviceId === 'string' &&
        typeof parsed.native.authSessionId === 'string'
          ? parsed.native
          : undefined,
      binders: Array.isArray(parsed.binders)
        ? parsed.binders.filter((binder): binder is Binder => typeof binder?.id === 'string')
        : [],
    };
  } catch {
    return null;
  }
}

export function writeBinderStartMarker(storage: WritableStorage & Partial<StorageLike>, marker: BinderStartMarker) {
  try {
    const previous = storage.getItem ? readBinderStartMarker(storage as StorageLike) : null;
    const native =
      marker.native ??
      (previous?.userId === marker.userId && previous.ownerUserId === marker.ownerUserId ? previous.native : undefined);
    storage.setItem(BINDER_START_MARKER_KEY, JSON.stringify({ ...marker, native }));
  } catch {
    // Quota or private mode: the next start just waits for the server.
  }
}

/**
 * The collection `userId` last opened on this device: the partner's when the start marker says so and the cached
 * billing still lets partners in, else the account's own. Another account's marker never names an owner.
 */
export function savedCollectionOwner(storage: StorageLike, userId: string) {
  const marker = readBinderStartMarker(storage);
  if (!marker || marker.userId !== userId || marker.ownerUserId === userId) return userId;
  const access = readBillingCache(storage, userId, marker.ownerUserId);
  return access && !(access.enforced && access.tier !== 'paid') ? marker.ownerUserId : userId;
}

/**
 * The binder to paint straight away for `userId`, or null to wait for the server. Only when the server
 * already opened this account, owner and binder on this device with native storage, and the URL does not ask
 * for another binder. A different account on a shared device, a first
 * visit, or a link to another binder waits for the server.
 */
export function readLocalBinderStart(
  storage: StorageLike,
  cookie: string,
  userId: string,
  requestedBinderId: string | null = null,
): LocalBinderStart | null {
  const marker = readBinderStartMarker(storage);
  if (!marker || marker.userId !== userId || savedCollectionOwner(storage, userId) !== marker.ownerUserId) return null;
  if (requestedBinderId && matchBinder(marker.binders, requestedBinderId)?.id !== marker.binderId) return null;
  // A native marker is a display pointer only. IDB/JWT checks happen in CachedNativeStartup.
  if (!marker.native) return null;
  return {
    ...readOfflineShellState(storage, cookie, userId),
    collectionOwnerUserId: marker.ownerUserId,
    binderId: marker.binderId,
    binders: marker.binders,
  };
}
