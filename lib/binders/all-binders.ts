// Read-only lookup across every binder of the collection owner (see docs/multiple-binders.md).
// Per-binder status is unchanged: the open binder still owns its slots. This only answers "is it owned or
// wanted anywhere, and where", for the All binders views and the "Owned in <binder>" hints.
import { normalizeCollectionItem } from '@/lib/collection/normalize';
import type { CollectedPokemon } from '@/lib/domain/cards';
import { isBinderId, type Binder } from '@/lib/binders/model';
import type { WantedDashboardEntry } from '@/lib/wanted-dashboard';
import type { OfflineKeyValueStore } from '@/lib/offline-store/kv';

export type BinderScope = 'binder' | 'all';
export interface BinderRef {
  id: string;
  name: string;
}

/** Every binder's slots, keyed by binder id (in switcher order). */
export interface AllBindersLookup {
  binders: BinderRef[];
  collections: Map<string, CollectedPokemon[]>;
  loadedBinderIds?: string[];
}

/** IndexedDB record holding the cached lookup (owner-scoped; read offline). */
export const ALL_BINDERS_CACHE_KEY = 'binders:all-collections';

export interface AllBindersCache {
  ownerUserId: string;
  savedAt: string;
  /** Every binder's rows as last seen on this device. */
  collections: Record<string, CollectedPokemon[]>;
}

/** Groups raw rows (with binder_id) by binder. Rows without a known binder id are dropped. */
export function groupRowsByBinder(rows: readonly Record<string, unknown>[] | null | undefined) {
  const grouped: Record<string, CollectedPokemon[]> = {};
  for (const row of rows ?? []) {
    const binderId = row.binder_id;
    if (!isBinderId(binderId)) continue;
    (grouped[binderId] ??= []).push(normalizeCollectionItem(row as Partial<CollectedPokemon>));
  }
  return grouped;
}

/**
 * The lookup: the open binder's live collection (so local edits show at once), every other binder from the
 * latest server read or the cache. Binders no longer in the list are ignored.
 */
export function buildAllBindersLookup(input: {
  binders: readonly Pick<Binder, 'id' | 'name'>[];
  currentBinderId: string | null;
  currentCollection: readonly CollectedPokemon[];
  others: Record<string, CollectedPokemon[]> | null | undefined;
}): AllBindersLookup {
  const collections = new Map<string, CollectedPokemon[]>();
  for (const binder of input.binders) {
    collections.set(
      binder.id,
      binder.id === input.currentBinderId ? [...input.currentCollection] : [...(input.others?.[binder.id] ?? [])],
    );
  }
  return {
    binders: input.binders.map(({ id, name }) => ({ id, name })),
    collections,
    loadedBinderIds: input.binders
      .filter((binder) => binder.id === input.currentBinderId || Object.hasOwn(input.others ?? {}, binder.id))
      .map((binder) => binder.id),
  };
}

const isOwned = (item: CollectedPokemon) => item.status !== 'wishlisted';

/** Binders other than the open one where this Pokémon's slot is filled. */
export function speciesOwnedElsewhere(
  lookup: AllBindersLookup | null,
  pokemonId: number,
  currentBinderId: string | null,
): BinderRef[] {
  if (!lookup) return [];
  return lookup.binders.filter(
    (binder) =>
      binder.id !== currentBinderId &&
      (lookup.collections.get(binder.id) ?? []).some((item) => item.pokemon_id === pokemonId && isOwned(item)),
  );
}

/** For each card id, the other binders holding that printing in a filled slot. */
export function cardsOwnedElsewhere(lookup: AllBindersLookup | null, currentBinderId: string | null) {
  const byCard = new Map<string, BinderRef[]>();
  if (!lookup) return byCard;
  for (const binder of lookup.binders) {
    if (binder.id === currentBinderId) continue;
    for (const item of lookup.collections.get(binder.id) ?? []) {
      if (!item.card_id || !isOwned(item)) continue;
      const list = byCard.get(item.card_id) ?? [];
      if (!list.some((entry) => entry.id === binder.id)) list.push(binder);
      byCard.set(item.card_id, list);
    }
  }
  return byCard;
}

/** "Owned in Trades", "Owned in Trades and Spare", "Owned in Trades +2"; null when none. */
export function formatOwnedIn(binders: readonly BinderRef[], prefix = 'Owned in') {
  if (binders.length === 0) return null;
  if (binders.length === 1) return `${prefix} ${binders[0].name}`;
  if (binders.length === 2) return `${prefix} ${binders[0].name} and ${binders[1].name}`;
  return `${prefix} ${binders[0].name} +${binders.length - 1}`;
}

/** Every binder's slots in one list (Pokémon repeat across binders), for the All binders analytics. */
export function allBindersCollection(lookup: AllBindersLookup) {
  return lookup.binders.flatMap((binder) => lookup.collections.get(binder.id) ?? []);
}

/** Wanted printings of every binder, each tagged with its binder. The same printing wanted in two binders shows once per binder. */
export function allBindersWantedEntries(lookup: AllBindersLookup): WantedDashboardEntry[] {
  return lookup.binders.flatMap((binder) =>
    (lookup.collections.get(binder.id) ?? []).flatMap((item) =>
      (item.wanted_cards ?? []).map((card) => ({
        pokemonId: item.pokemon_id,
        pokemonName: item.pokemon_name,
        card,
        binderId: binder.id,
        binderName: binder.name,
      })),
    ),
  );
}

export async function readAllBindersCache(
  store: OfflineKeyValueStore | null | undefined,
  ownerUserId: string | null,
): Promise<AllBindersCache | null> {
  if (!store || !ownerUserId) return null;
  try {
    const parsed = await store.get<Partial<AllBindersCache>>(ALL_BINDERS_CACHE_KEY);
    if (!parsed || parsed.ownerUserId !== ownerUserId || !parsed.collections || typeof parsed.collections !== 'object')
      return null;
    const collections: Record<string, CollectedPokemon[]> = {};
    for (const [binderId, items] of Object.entries(parsed.collections)) {
      if (isBinderId(binderId) && Array.isArray(items))
        collections[binderId] = items.map((item) => normalizeCollectionItem(item));
    }
    return { ownerUserId, savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : '', collections };
  } catch {
    return null;
  }
}

/** Saves every binder's rows for offline use. Storage errors are ignored (the lookup is a nicety). */
export async function writeAllBindersCache(store: OfflineKeyValueStore | null | undefined, cache: AllBindersCache) {
  if (!store) return;
  try {
    await store.set(ALL_BINDERS_CACHE_KEY, cache);
  } catch {
    // Quota or private mode: the lookup still works for this visit.
  }
}

const SCOPE_KEY_PREFIX = 'binderdex:binder-scope:';

/** The This binder / All binders choice, remembered per view on this device. */
export function readBinderScope(view: 'analytics' | 'wanted'): BinderScope {
  try {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem(SCOPE_KEY_PREFIX + view) : null;
    return saved === 'all' || (saved === null && view === 'wanted') ? 'all' : 'binder';
  } catch {
    return view === 'wanted' ? 'all' : 'binder';
  }
}

export function rememberBinderScope(view: 'analytics' | 'wanted', scope: BinderScope) {
  try {
    window.localStorage.setItem(SCOPE_KEY_PREFIX + view, scope);
  } catch {
    // Storage blocked: the choice applies for this visit.
  }
}
