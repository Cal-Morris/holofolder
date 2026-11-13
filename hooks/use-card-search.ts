'use client';

// Card and illustrator search shared by the Search sheet and Quick mode: debounced card search against the TCG
// mirror (grouped by Pokémon), falling back to the cards on this device when offline, plus fuzzy illustrator
// matches from the directory (saved on the device after the first load) and set hits from the set search.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CardSearchLanguage } from '@/lib/card-languages';
import { trackGoogleEvent } from '@/lib/google-analytics';
import { getPokemonSummary } from '@/lib/pokemon-catalog';
import {
  groupCardResultsByPokemon,
  parseCardSearchQuery,
  type CardSearchGroup,
  type SearchCardResult,
} from '@/lib/pokemon-card-browse';
import { readOfflineSets, searchOfflineCardsWithCorrection } from '@/lib/offline-card-index';
import { loadIllustratorDirectory } from '@/lib/illustrator-client';
import { normalizeIllustratorText, searchIllustrators, type IllustratorSummary } from '@/lib/illustrators';
import { isSetSearchQuery, rankSetMatches } from '@/lib/set-search';
import type { TCGSetSlotsResponse, TCGSetSummary } from '@/lib/tcg-set-slots';

const CARD_SEARCH_DEBOUNCE_MS = 250;

type CardSearchState = {
  key: string;
  groups: CardSearchGroup[];
  cards: SearchCardResult[];
  loading: boolean;
  offline: boolean;
  correction: string | null;
};

const groupCards = (cards: SearchCardResult[]) =>
  groupCardResultsByPokemon(cards, (dexId) => getPokemonSummary(dexId)?.name ?? null, {
    maxGroups: 10,
    maxCardsPerGroup: 6,
  });

/**
 * Debounced card search against the TCG mirror, grouped by Pokémon. Offline (or when the API can't be
 * reached) it searches the cards on this device instead and says so.
 */
export function useCardSearch(
  query: string,
  enabled: boolean,
  getOfflineCards?: () => Promise<SearchCardResult[]>,
  options?: { language?: CardSearchLanguage; includeNonPokemon?: boolean },
) {
  const [state, setState] = useState<CardSearchState>({
    key: '',
    groups: [],
    cards: [],
    loading: false,
    offline: false,
    correction: null,
  });
  const { language, includeNonPokemon = false } = options ?? {};
  const parsed = parseCardSearchQuery(query);
  const searchText = enabled && (parsed.text.length >= 2 || parsed.cardId) ? query.trim().toLowerCase() : '';
  const key = searchText ? `${language ?? 'en'}:${includeNonPokemon}:${searchText}` : '';
  const offlineCardsRef = useRef<Promise<SearchCardResult[]> | null>(null);
  const getOfflineCardsRef = useRef(getOfflineCards);
  useEffect(() => {
    getOfflineCardsRef.current = getOfflineCards;
    offlineCardsRef.current = null;
  }, [getOfflineCards]);

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    const searchOnDevice = async () => {
      const loader = getOfflineCardsRef.current;
      if (!loader) return null;
      offlineCardsRef.current ??= loader().catch(() => []);
      const cards = await offlineCardsRef.current;
      const eligible = cards.filter(
        (c) =>
          (includeNonPokemon || c.dexIds.length > 0) &&
          (!language || language === 'any' || c.language === undefined || c.language === language),
      );
      const result = searchOfflineCardsWithCorrection(eligible, searchText);
      return { cards: result.cards, groups: groupCards(result.cards), correction: result.correction };
    };
    const trackSearch = (resultCount: number, offline: boolean) =>
      trackGoogleEvent('search', { search_term: searchText.slice(0, 100), result_count: resultCount, offline });
    const showOffline = async () => {
      const result = await searchOnDevice();
      if (controller.signal.aborted) return;
      trackSearch(result?.cards.length ?? 0, true);
      setState({
        key,
        groups: result?.groups ?? [],
        cards: result?.cards ?? [],
        loading: false,
        offline: result !== null,
        correction: result?.correction ?? null,
      });
    };

    const timer = window.setTimeout(() => {
      setState((current) => ({ ...current, key, groups: [], cards: [], loading: true, correction: null }));
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        void showOffline();
        return;
      }
      fetch(
        `/app/api/tcg-card-search?q=${encodeURIComponent(searchText)}${language ? `&language=${language}` : ''}${includeNonPokemon ? '&includeNonPokemon=1' : ''}`,
        { signal: controller.signal },
      )
        .then((response) => {
          if (!response.ok) throw new Error(`Card search failed (${response.status})`);
          return response.json();
        })
        .then((payload: { cards?: SearchCardResult[]; correction?: string | null }) => {
          const cards = Array.isArray(payload?.cards) ? payload.cards : [];
          if (controller.signal.aborted) return;
          trackSearch(cards.length, false);
          setState({
            key,
            groups: groupCards(cards),
            cards,
            loading: false,
            offline: false,
            correction: cards.length && typeof payload.correction === 'string' ? payload.correction : null,
          });
        })
        .catch((error: unknown) => {
          if ((error as { name?: string })?.name === 'AbortError' || controller.signal.aborted) return;
          void showOffline();
        });
    }, CARD_SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [key, searchText, language, includeNonPokemon]);

  if (!key)
    return {
      groups: [] as CardSearchGroup[],
      cards: [] as SearchCardResult[],
      loading: false,
      offline: false,
      correction: null,
    };
  return state.key === key
    ? {
        groups: state.groups,
        cards: state.cards,
        loading: state.loading,
        offline: state.offline,
        correction: state.correction,
      }
    : {
        groups: [] as CardSearchGroup[],
        cards: [] as SearchCardResult[],
        loading: true,
        offline: false,
        correction: null,
      };
}

/** Fuzzy illustrator matches from the directory (loaded once; offline it uses the copy saved on this device). */
export function useIllustratorSearch(query: string, enabled: boolean) {
  const [directory, setDirectory] = useState<IllustratorSummary[] | null>(null);
  const active = enabled && normalizeIllustratorText(query).length >= 2;

  useEffect(() => {
    if (!active || directory) return;
    let cancelled = false;
    void loadIllustratorDirectory().then((result) => {
      if (!cancelled && result.data) setDirectory(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [active, directory]);

  return useMemo(
    () => (active && directory ? searchIllustrators(directory, query, 5) : []),
    [active, directory, query],
  );
}

type SetSearchState = { key: string; sets: TCGSetSummary[] };

/**
 * Mirrored sets whose name, id or release year match the query (the Sets view's search API), best match first. Offline it
 * matches the set lists saved on this device; nothing saved means no set rows, never a guess.
 */
export function useSetSearch(query: string, enabled: boolean, limit?: number) {
  const [state, setState] = useState<SetSearchState>({ key: '', sets: [] });
  const key = enabled && isSetSearchQuery(query) ? query.trim().replace(/\s+/g, ' ').toLowerCase() : '';

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    const showSaved = async () => {
      const saved = await readOfflineSets().catch(() => [] as TCGSetSummary[]);
      if (!controller.signal.aborted) setState({ key, sets: rankSetMatches(saved, key, limit) });
    };
    const timer = window.setTimeout(() => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        void showSaved();
        return;
      }
      fetch(`/app/api/tcg-set-slots?${new URLSearchParams({ query: key }).toString()}`, { signal: controller.signal })
        .then((response) => {
          if (!response.ok) throw new Error(`Set search failed (${response.status})`);
          return response.json() as Promise<Partial<TCGSetSlotsResponse>>;
        })
        .then((payload) => {
          const sets = Array.isArray(payload?.sets) ? payload.sets : [];
          if (!controller.signal.aborted) setState({ key, sets: rankSetMatches(sets, key, limit) });
        })
        .catch((error: unknown) => {
          if ((error as { name?: string })?.name === 'AbortError' || controller.signal.aborted) return;
          void showSaved();
        });
    }, CARD_SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [key, limit]);

  return useMemo(() => (key && state.key === key ? state.sets : []), [key, state]);
}
