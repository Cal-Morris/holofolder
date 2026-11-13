import { readBillingCache } from '@/lib/billing-cache';
// Boot data for the offline app shell (/app-shell): everything comes from this device, nothing from the network.
import type { CollectedPokemon } from '@/lib/domain/cards';
import type { Binder } from '@/lib/binders/model';
import {
  collectionSnapshotKey,
  LEGACY_COLLECTION_SNAPSHOT_KEY,
  offlineAvailableBinderIds,
  pickOfflineBinder,
  readDeviceBinders,
  storedSnapshotIsOf,
} from '@/lib/binders/offline';
import { normalizeCollectionItems } from '@/lib/collection/normalize';
import {
  getDefaultBinderSettings,
  normalizeBinderSettings,
  type BinderSettings,
  type StoredBinderSettings,
} from '@/lib/settings';

export interface OfflineShellState {
  collection: CollectedPokemon[];
  collectionOwnerUserId: string | null;
  settings: BinderSettings;
  darkMode: boolean;
}

type StorageLike = Pick<Storage, 'getItem'>;

function readJson(storage: StorageLike, key: string): unknown {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function readThemeCookie(cookie: string) {
  const match = cookie.match(/(?:^|;\s*)binderdex_theme=(dark|light)/);
  return match ? match[1] === 'dark' : null;
}

/**
 * Builds BinderApp's initial props from the local collection snapshot, stored settings and theme cookie.
 * `snapshotKey` picks the binder (lib/binders/offline.ts); the default binder's key otherwise.
 */
export function readOfflineShellState(
  storage: StorageLike,
  cookie: string,
  userId: string | null,
  snapshotKey = LEGACY_COLLECTION_SNAPSHOT_KEY,
): OfflineShellState {
  const snapshot = readJson(storage, snapshotKey) as { ownerUserId?: unknown; collection?: unknown } | null;
  const snapshotOwner = typeof snapshot?.ownerUserId === 'string' ? snapshot.ownerUserId : null;
  // Same rule useCollection applies offline: the device's last saved collection is used even when its owner
  // differs from the signed-in user, because in partner mode the binder belongs to the partner.
  const access = snapshotOwner && snapshotOwner !== userId ? readBillingCache(storage, userId, snapshotOwner) : null;
  const permitted =
    !snapshotOwner || snapshotOwner === userId || Boolean(access && (!access.enforced || access.tier === 'paid'));
  const snapshotUsable = Boolean(permitted && snapshot && Array.isArray(snapshot.collection));
  // Guests never get a collection: signed-out visitors browse read-only.
  const collection =
    userId && snapshotUsable ? normalizeCollectionItems(snapshot!.collection as Partial<CollectedPokemon>[]) : [];
  // In partner mode the collection owner differs from the signed-in user; the snapshot remembers it.
  const collectionOwnerUserId = userId ? (snapshotUsable && snapshotOwner ? snapshotOwner : userId) : null;

  const settingsKeys = userId
    ? [
        `pokemon_binder_settings:${collectionOwnerUserId}`,
        `pokemon_binder_settings:${userId}`,
        'pokemon_binder_settings',
        'pokemon_binder_settings:anon',
      ]
    : ['pokemon_binder_settings:anon', 'pokemon_binder_settings'];
  const defaults = getDefaultBinderSettings();
  let settings = defaults;
  for (const key of settingsKeys) {
    const stored = readJson(storage, key);
    if (stored && typeof stored === 'object') {
      settings = normalizeBinderSettings(stored as StoredBinderSettings, defaults);
      break;
    }
  }

  const darkMode = readThemeCookie(cookie) ?? settings.darkMode;
  return { collection, collectionOwnerUserId, settings, darkMode };
}

export type OfflineBinderBoot = OfflineShellState & {
  binders: Binder[];
  binderId: string | null;
  /** A binder the URL asked for that isn't saved on this device (the default or last opened one opens instead). */
  unavailableBinderName: string | null;
};

/**
 * The offline shell with multiple binders: opens the requested binder (`?binder=`) when this device has a saved
 * copy of it, else the last opened saved one, else the default. The binder list is the one this device last saw.
 */
export function readOfflineBinderBoot(
  storage: StorageLike,
  cookie: string,
  userId: string | null,
  requestedBinderId: string | null,
  lastOpenedBinderId: string | null,
): OfflineBinderBoot {
  const base = readOfflineShellState(storage, cookie, userId);
  const device = userId ? readDeviceBinders(storage) : null;
  // Only the binders of the collection this account opens (its own, or its partner's).
  const binders =
    device && (device.ownerUserId === base.collectionOwnerUserId || device.ownerUserId === userId)
      ? device.binders
      : [];
  if (binders.length === 0) return { ...base, binders: [], binderId: null, unavailableBinderName: null };

  const available = offlineAvailableBinderIds(storage, device!.ownerUserId, binders);
  const { binder, unavailable } = pickOfflineBinder(binders, available, requestedBinderId, lastOpenedBinderId);
  const state =
    binder && !binder.isDefault
      ? readOfflineShellState(storage, cookie, userId, collectionSnapshotKey(binder.id, binder.isDefault))
      : base;
  const snapshotMatches = binder ? storedSnapshotIsOf(storage, binder) : false;
  const binderSettings = binder
    ? readJson(
        storage,
        `pokemon_binder_settings:${state.collectionOwnerUserId ?? device!.ownerUserId}:binder:${binder.id}`,
      )
    : null;
  const settings = binder
    ? normalizeBinderSettings(binderSettings as StoredBinderSettings, {
        ...state.settings,
        binderRows: binder.rows ?? state.settings.binderRows,
        binderCols: binder.cols ?? state.settings.binderCols,
      })
    : state.settings;
  return {
    ...state,
    settings,
    // Never show another binder's slots: a binder without a usable copy opens empty.
    collection: snapshotMatches ? state.collection : [],
    collectionOwnerUserId: state.collectionOwnerUserId ?? device!.ownerUserId,
    binders,
    binderId: binder?.id ?? null,
    unavailableBinderName: unavailable?.name ?? null,
  };
}
