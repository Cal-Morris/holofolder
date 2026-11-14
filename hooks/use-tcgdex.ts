'use client';

import { useState, useCallback } from 'react';
import { filterAndRankCards } from '@/lib/card-search';
import { matchesCatalogCardId } from '@/lib/card-catalog';

import type { CardLanguage, TCGCard } from '@/lib/domain/cards';

export type { CardLanguage, TCGCard } from '@/lib/domain/cards';

export interface CardFilters {
  set?: string;
  rarity?: string;
  /** National Dex id; any-card search only, applied by the card selector (results carry dexIds). */
  pokemon?: number;
  variant?: string;
  searchQuery?: string;
}

const CARDS_CACHE_TTL_MS = 5 * 60 * 1000;
const CARDS_CACHE_MAX_ENTRIES = 300;

type CardsCacheEntry = { promise: Promise<TCGCard[]>; settledAt: number | null; cards?: TCGCard[] };

// Shared across hook instances: the binder slot previews, card selector and all-cards browser ask for
// the same Pokémon lists, and an effect re-run used to drop an in-flight batch and fetch it again.
const cardsCache = new Map<string, CardsCacheEntry>();

async function requestCardsForPokemon(dexId: number, language: CardLanguage): Promise<TCGCard[]> {
  const response = await fetch(`/app/api/tcgdex-cache?pokemonId=${dexId}&language=${encodeURIComponent(language)}`);
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || `API error: ${response.status}`);
  }

  const data = await response.json();
  return Array.isArray(data.cards) ? data.cards.map((card: TCGCard) => ({ ...card, language })) : [];
}

/** A Pokémon's card list if it is already loaded (no request), so a view can render it on the first paint. */
export function peekCardsForPokemon(dexId: number, language: CardLanguage = 'en'): TCGCard[] | null {
  return cardsCache.get(`${dexId}:${language}`)?.cards ?? null;
}

/** Fetch a Pokémon's card list, sharing in-flight requests and reusing results for a few minutes. Failures are not cached. */
export function loadCardsForPokemon(
  dexId: number,
  language: CardLanguage = 'en',
  now = Date.now(),
): Promise<TCGCard[]> {
  const key = `${dexId}:${language}`;
  const cached = cardsCache.get(key);
  if (cached && (cached.settledAt === null || now - cached.settledAt < CARDS_CACHE_TTL_MS)) {
    // Refresh recency for the LRU order.
    cardsCache.delete(key);
    cardsCache.set(key, cached);
    return cached.promise;
  }

  const entry: CardsCacheEntry = { promise: Promise.resolve([]), settledAt: null };
  entry.promise = requestCardsForPokemon(dexId, language).then(
    (cards) => {
      entry.settledAt = Date.now();
      entry.cards = cards;
      return cards;
    },
    (error) => {
      if (cardsCache.get(key) === entry) cardsCache.delete(key);
      throw error;
    },
  );
  cardsCache.set(key, entry);

  while (cardsCache.size > CARDS_CACHE_MAX_ENTRIES) {
    const oldestKey = cardsCache.keys().next().value;
    if (oldestKey === undefined) break;
    cardsCache.delete(oldestKey);
  }

  return entry.promise;
}

/** Test helper. */
export function clearCardsForPokemonCache() {
  cardsCache.clear();
  catalogCardCache.clear();
  settledCatalogCards.clear();
}

/** How long the single-card request may take before falling back to the Pokémon's (offline-warmed) list. */
const CATALOG_CARD_TIMEOUT_MS = 5000;
const catalogCardCache = new Map<string, Promise<TCGCard | undefined>>();
const settledCatalogCards = new Map<string, TCGCard | undefined>();

async function requestCatalogCard(cardId: string, language: CardLanguage): Promise<TCGCard | undefined> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('offline');
  const response = await fetch(
    `/app/api/tcg-card-search?ids=${encodeURIComponent(cardId)}&language=${encodeURIComponent(language)}`,
    { signal: AbortSignal.timeout(CATALOG_CARD_TIMEOUT_MS) },
  );
  if (!response.ok) throw new Error(`API error: ${response.status}`);
  const data = await response.json();
  const card = Array.isArray(data.cards)
    ? (data.cards as TCGCard[]).find((c) => matchesCatalogCardId(c, cardId))
    : undefined;
  if (!card) throw new Error('not found');
  return { ...card, language };
}

/** One card if it is already loaded (its own lookup or its Pokémon's list); undefined when not known yet. */
export function peekCatalogCard(
  dexId: number,
  cardId: string,
  language: CardLanguage = 'en',
): TCGCard | null | undefined {
  const key = `${language}:${cardId}`;
  if (settledCatalogCards.has(key)) return settledCatalogCards.get(key) ?? null;
  const list = peekCardsForPokemon(dexId, language);
  return list ? (list.find((card) => matchesCatalogCardId(card, cardId)) ?? null) : undefined;
}

/**
 * One card's catalog details (illustrator, variants) without loading every printing of its Pokémon. The small
 * by-id lookup is used online; offline, on a slow network or a miss it falls back to the Pokémon's list, which the
 * service worker warms for collected Pokémon. Resolves undefined when the card isn't found.
 */
export function loadCatalogCard(dexId: number, cardId: string, language: CardLanguage = 'en') {
  const key = `${language}:${cardId}`;
  const cached = catalogCardCache.get(key);
  if (cached) return cached;
  const loaded = peekCardsForPokemon(dexId, language);
  const promise = (
    loaded
      ? Promise.resolve(loaded.find((card) => matchesCatalogCardId(card, cardId)))
      : requestCatalogCard(cardId, language).catch(() =>
          loadCardsForPokemon(dexId, language).then((cards) =>
            cards.find((card) => matchesCatalogCardId(card, cardId)),
          ),
        )
  ).then(
    (card) => {
      settledCatalogCards.set(key, card);
      return card;
    },
    (error) => {
      catalogCardCache.delete(key);
      throw error;
    },
  );
  catalogCardCache.set(key, promise);
  while (catalogCardCache.size > CARDS_CACHE_MAX_ENTRIES) {
    const oldestKey = catalogCardCache.keys().next().value;
    if (oldestKey === undefined) break;
    catalogCardCache.delete(oldestKey);
    settledCatalogCards.delete(oldestKey);
  }
  return promise;
}

export function useTCGdex() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCardsForPokemon = useCallback(async (dexId: number, language: CardLanguage = 'en'): Promise<TCGCard[]> => {
    setIsLoading(true);
    setError(null);

    try {
      // Copy so a caller sorting or filtering in place cannot affect the shared cached list.
      const cards = [...(await loadCardsForPokemon(dexId, language))];

      setIsLoading(false);
      return cards;
    } catch (err) {
      setError((err as Error).message || 'Failed to fetch cards');
      setIsLoading(false);
      return [];
    }
  }, []);

  const filterCards = useCallback((cards: TCGCard[], filters: CardFilters): TCGCard[] => {
    return filterAndRankCards(cards, filters);
  }, []);

  return { fetchCardsForPokemon, filterCards, isLoading, error };
}
