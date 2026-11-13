// Multiple binders offline: where each binder's saved copy lives on this device, and which binders it can open
// without a connection. The default binder keeps the original keys, so data saved before binders stays valid;
// every other binder gets its own `…:<binderId>` keys (see docs/multiple-binders.md).
import type { Binder } from '@/lib/binders/model';
import { matchBinder } from '@/lib/binders/url';

/** The owner's binder list as this device last saw it, plus the binders saved here. */
export const DEVICE_BINDERS_KEY = 'binderdex_device_binders_v1';

type ReadableStorage = Pick<Storage, 'getItem'>;
type WritableStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** The IndexedDB record key of a binder's collection copy. Pending edits stay in the default record (one queue). */
export function collectionRecordKey(binderId: string | null | undefined, isDefault: boolean) {
  return binderId && !isDefault ? `collection:${binderId}` : 'collection';
}

export interface DeviceBinders {
  ownerUserId: string;
  binders: Binder[];
  /** Binders with a saved copy on this device: they open offline. */
  savedBinderIds: string[];
  savedAt: string;
}

function isBinderLike(value: unknown): value is Binder {
  const binder = value as Partial<Binder> | null;
  return Boolean(binder) && typeof binder!.id === 'string' && typeof binder!.name === 'string';
}

export function readDeviceBinders(storage: ReadableStorage, ownerUserId?: string | null): DeviceBinders | null {
  try {
    const parsed = JSON.parse(storage.getItem(DEVICE_BINDERS_KEY) ?? 'null') as Partial<DeviceBinders> | null;
    if (!parsed || typeof parsed.ownerUserId !== 'string') return null;
    if (ownerUserId && parsed.ownerUserId !== ownerUserId) return null;
    return {
      ownerUserId: parsed.ownerUserId,
      binders: Array.isArray(parsed.binders) ? parsed.binders.filter(isBinderLike) : [],
      savedBinderIds: Array.isArray(parsed.savedBinderIds)
        ? parsed.savedBinderIds.filter((id): id is string => typeof id === 'string')
        : [],
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

function writeDeviceBinders(storage: WritableStorage, value: DeviceBinders) {
  try {
    storage.setItem(DEVICE_BINDERS_KEY, JSON.stringify(value));
  } catch {
    // Quota or private mode: offline switching just falls back to the default binder.
  }
}

/** Remember the owner's binder list on this device. Saved copies of binders that no longer exist are forgotten. */
export function rememberDeviceBinders(
  storage: WritableStorage,
  ownerUserId: string,
  binders: readonly Binder[],
  now = new Date(),
) {
  if (!ownerUserId || binders.length === 0) return;
  const existing = readDeviceBinders(storage, ownerUserId);
  const ids = new Set(binders.map((binder) => binder.id));
  const next: DeviceBinders = {
    ownerUserId,
    binders: binders.map(
      ({ id, ownerUserId: owner, name, color, sortOrder, isDefault, rows, cols, createdAt, updatedAt }) => ({
        id,
        ownerUserId: owner,
        name,
        color,
        sortOrder,
        isDefault,
        rows,
        cols,
        createdAt,
        updatedAt,
      }),
    ),
    savedBinderIds: (existing?.savedBinderIds ?? []).filter((id) => ids.has(id)),
    savedAt: now.toISOString(),
  };
  if (existing && JSON.stringify({ ...existing, savedAt: '' }) === JSON.stringify({ ...next, savedAt: '' })) return;
  writeDeviceBinders(storage, next);
}

/** Note that this device now holds a saved copy of a binder (called when its collection snapshot is written). */
export function markBinderSavedOnDevice(
  storage: WritableStorage,
  ownerUserId: string | null,
  binderId: string | null | undefined,
  now = new Date(),
) {
  if (!ownerUserId || !binderId) return;
  const existing = readDeviceBinders(storage, ownerUserId);
  if (existing?.savedBinderIds.includes(binderId)) return;
  writeDeviceBinders(storage, {
    ownerUserId,
    binders: existing?.binders ?? [],
    savedBinderIds: [...(existing?.savedBinderIds ?? []), binderId],
    savedAt: now.toISOString(),
  });
}

/** Binders this device can open without a connection: the ones it has a saved copy of. */
export function offlineAvailableBinderIds(
  storage: ReadableStorage,
  ownerUserId: string | null,
  binders: readonly Binder[],
) {
  const saved = new Set((ownerUserId ? readDeviceBinders(storage, ownerUserId) : null)?.savedBinderIds ?? []);
  return new Set(binders.flatMap((binder) => (saved.has(binder.id) ? [binder.id] : [])));
}

/**
 * The binder the offline app opens: the requested one if it is saved here, else the last opened one if saved,
 * else the default. `unavailable` names a requested binder that had to be skipped.
 */
export function pickOfflineBinder(
  binders: readonly Binder[],
  available: ReadonlySet<string>,
  requestedId: string | null,
  lastOpenedId: string | null,
): { binder: Binder | null; unavailable: Binder | null } {
  const requested = requestedId ? (matchBinder(binders, requestedId) ?? null) : null;
  if (requested && available.has(requested.id)) return { binder: requested, unavailable: null };
  const lastOpened = binders.find((binder) => binder.id === lastOpenedId && available.has(binder.id));
  const fallback = lastOpened ?? binders.find((binder) => binder.isDefault) ?? binders[0] ?? null;
  return { binder: fallback, unavailable: requested && requested.id !== fallback?.id ? requested : null };
}
