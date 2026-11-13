// Boot data for the offline app shell (/app-shell): everything comes from this device, nothing from the network.
import type { CollectedPokemon } from '@/lib/domain/cards';
import type { Binder } from '@/lib/binders/model';
import { offlineAvailableBinderIds, pickOfflineBinder, readDeviceBinders } from '@/lib/binders/offline';
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

/** Builds BinderApp's initial props from stored settings and the theme cookie. The collection comes from native storage. */
export function readOfflineShellState(storage: StorageLike, cookie: string, userId: string | null): OfflineShellState {
  const settingsKeys = userId
    ? [`pokemon_binder_settings:${userId}`, 'pokemon_binder_settings', 'pokemon_binder_settings:anon']
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
  return { collection: [], collectionOwnerUserId: userId, settings, darkMode };
}

export type OfflineBinderBoot = OfflineShellState & {
  binders: Binder[];
  binderId: string | null;
  /** A binder the URL asked for that isn't saved on this device (the default or last opened one opens instead). */
  unavailableBinderName: string | null;
};

/**
 * The offline shell with multiple binders: opens the requested binder (`?binder=`) when this device has a saved
 * copy of it, else the last opened saved one, else the default. The binder list is the one this device last saw for
 * this account and `ownerUserId` (its own collection, or its partner's: `savedCollectionOwner` in lib/binder-start).
 */
export function readOfflineBinderBoot(
  storage: StorageLike,
  cookie: string,
  userId: string | null,
  ownerUserId: string | null,
  requestedBinderId: string | null,
  lastOpenedBinderId: string | null,
): OfflineBinderBoot {
  const base = { ...readOfflineShellState(storage, cookie, userId), collectionOwnerUserId: userId && ownerUserId };
  const device = readDeviceBinders(storage, userId, ownerUserId);
  const binders = device?.binders ?? [];
  if (binders.length === 0) return { ...base, binders: [], binderId: null, unavailableBinderName: null };

  const available = offlineAvailableBinderIds(storage, userId, ownerUserId, binders);
  const { binder, unavailable } = pickOfflineBinder(binders, available, requestedBinderId, lastOpenedBinderId);
  const binderSettings = binder
    ? readJson(storage, `pokemon_binder_settings:${ownerUserId}:binder:${binder.id}`)
    : null;
  const settings = binder
    ? normalizeBinderSettings(binderSettings as StoredBinderSettings, {
        ...base.settings,
        binderRows: binder.rows ?? base.settings.binderRows,
        binderCols: binder.cols ?? base.settings.binderCols,
      })
    : base.settings;
  return {
    ...base,
    settings,
    binders,
    binderId: binder?.id ?? null,
    unavailableBinderName: unavailable?.name ?? null,
  };
}
