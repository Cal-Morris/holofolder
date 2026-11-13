// Keeps small device prefs (Show mode, settings, the show tally) saveable when localStorage is full.
// The reclaimable entries are per-binder collection snapshots left by the retired legacy collection model;
// nothing reads them any more.

const BINDER_SNAPSHOT_PREFIX = 'pokemon_collection_snapshot_v1:';

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
  const kept = new Set(keep);
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key && key.startsWith(BINDER_SNAPSHOT_PREFIX) && !kept.has(key)) keys.push(key);
  }
  return keys
    .map((key) => ({ key, savedAt: savedAtOf(storage, key) }))
    .sort((a, b) => a.savedAt - b.savedAt)
    .map(({ key }) => key);
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
