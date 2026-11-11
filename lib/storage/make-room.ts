// Keeps small device prefs (Show mode, settings, the show tally) saveable when localStorage is full.
// The big reclaimable entries are other binders' collection snapshots: each also has a durable IndexedDB copy
// (lib/offline-store/collection-mirror.ts) that useCollection falls back to, so dropping the localStorage copy
// only costs a slightly slower first paint of that binder. The default binder's snapshot is never evicted:
// the offline shell boots from it synchronously.
import { LEGACY_COLLECTION_SNAPSHOT_KEY } from '@/lib/binders/offline';

/** Other binders' snapshots kept in localStorage at once; older ones live on in IndexedDB only. */
export const MAX_LOCAL_BINDER_SNAPSHOTS = 3;

const BINDER_SNAPSHOT_PREFIX = `${LEGACY_COLLECTION_SNAPSHOT_KEY}:`;

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

export function isQuotaError(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const { name, code } = error as { name?: unknown; code?: unknown };
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22 || code === 1014;
}

function savedAtOf(storage: StorageLike, key: string) {
  try {
    const parsed = JSON.parse(storage.getItem(key) ?? 'null') as { savedAt?: unknown } | null;
    const time = typeof parsed?.savedAt === 'string' ? Date.parse(parsed.savedAt) : NaN;
    return Number.isFinite(time) ? time : 0;
  } catch {
    return 0;
  }
}

/** Other binders' snapshot keys, least recently saved first. */
export function evictableSnapshotKeys(storage: StorageLike, keep: readonly string[] = []) {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key && key.startsWith(BINDER_SNAPSHOT_PREFIX) && !keep.includes(key)) keys.push(key);
  }
  return keys
    .map((key) => ({ key, savedAt: savedAtOf(storage, key) }))
    .sort((a, b) => a.savedAt - b.savedAt)
    .map(({ key }) => key);
}

/** Drops the oldest other-binder snapshots beyond `max` (the one at `keep` is never dropped or counted). */
export function capBinderSnapshots(storage: StorageLike, keep: string | null, max = MAX_LOCAL_BINDER_SNAPSHOTS) {
  const keys = evictableSnapshotKeys(storage, keep ? [keep] : []);
  const room = keep?.startsWith(BINDER_SNAPSHOT_PREFIX) ? max - 1 : max;
  const drop = keys.slice(0, Math.max(0, keys.length - Math.max(0, room)));
  for (const key of drop) {
    try {
      storage.removeItem(key);
    } catch {
      // Nothing more to do.
    }
  }
  return drop;
}

/**
 * `setItem`, but a full storage first gives up other binders' snapshots, oldest first, retrying after each.
 * Throws the original error when nothing reclaimable is left (or for non-quota errors), like `setItem`.
 */
export function setItemMakingRoom(storage: StorageLike, key: string, value: string) {
  try {
    storage.setItem(key, value);
    return;
  } catch (error) {
    if (!isQuotaError(error)) throw error;
    for (const victim of evictableSnapshotKeys(storage, [key])) {
      storage.removeItem(victim);
      try {
        storage.setItem(key, value);
        return;
      } catch (retryError) {
        if (!isQuotaError(retryError)) throw retryError;
      }
    }
    throw error;
  }
}
