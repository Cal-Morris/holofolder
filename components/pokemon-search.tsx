'use client';

import {
  nativeCardConsumers,
  nativeCardState,
  nativeCardLabel,
  type NativeConsumerBinding,
} from '@/lib/collection/native-card-consumers';
import CardImage from '@/components/card-image';
import type React from 'react';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Search, ArrowRight, Star, MapPinned, Layers3, Loader2, Palette, History } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  POKEMON_CATALOG,
  formatPokemonDisplayName,
  getPokemonSummary,
  type PokemonSummary,
} from '@/lib/pokemon-catalog';
import {
  getInitialPokemonSearchFilter,
  getPokemonSearchPageJump,
  matchesPokemonSearchStateFilter,
  searchPokemonItems,
  type PokemonSearchStateFilter,
  type PokemonSearchSlotState,
} from '@/lib/pokemon-search-state';
import { formatCardNumber, type SearchCardResult } from '@/lib/pokemon-card-browse';
import type { BinderHistory } from '@/hooks/use-binder-history';
import RecentSearches from '@/components/recent-searches';
import { toRecentCard, type RecentCard } from '@/lib/recent-cards';
import { SetSymbol } from '@/components/set-symbol';
import { useCardSearch, useIllustratorSearch, useSetSearch } from '@/hooks/use-card-search';
import { formatSetHitMeta } from '@/lib/set-search';
import type { TCGSetSummary } from '@/lib/tcg-set-slots';
import { getCardPriceKey, type CardPriceSnapshot } from '@/hooks/use-card-prices';
import { useRegionalCardPrices } from '@/hooks/use-regional-card-prices';
import { DEFAULT_PRICING_REGION, type PricingRegion } from '@/lib/pricing-region';
import { CARD_STANDING_BADGES, getCardStanding } from '@/lib/show-hunt';

type SearchStateFilter = PokemonSearchStateFilter;

export interface PokemonSearchResultMeta {
  previewImage?: string | null;
  previewFitClass?: string;
  previewToneClass?: string;
  cardPreviewImage?: string | null;
  cardPreviewToneClass?: string;
  stateLabel?: string | null;
  stateToneClass?: string;
  cardLabel?: string | null;
  locationLabel?: string | null;
  pageNumber?: number | null;
  isFavorite?: boolean;
  isSelected?: boolean;
  slotState?: PokemonSearchSlotState;
  /** "Owned in <binder>" when another binder holds this Pokémon. */
  elsewhereLabel?: string | null;
}

interface PokemonSearchProps {
  nativeConsumer?: NativeConsumerBinding;
  history: BinderHistory;
  onSelect: (pokemon: PokemonSummary) => void;
  pokemonList?: { id: number; name: string }[];
  getResultMeta?: (pokemon: { id: number; name: string }) => PokemonSearchResultMeta | null;
  currentPagePokemonList?: { id: number; name: string }[];
  totalPages?: number;
  onJumpToPage?: (page: number) => void;
  /** Open the read-only "all cards" view for a Pokémon, optionally highlighting one printing. */
  onBrowseCards?: (pokemon: { id: number; name: string }, highlightCardId?: string) => void;
  /** Cards available on this device (own cards + cached card data), searched when the card search API can't be reached. */
  getOfflineCards?: () => Promise<SearchCardResult[]>;
  /** Open the read-only view of every card by an illustrator. Enables illustrator results. */
  onBrowseIllustrator?: (name: string) => void;
  /** Open Sets on a set whose name or id matches the search. Enables set results. */
  onBrowseSet?: (set: TCGSetSummary) => void;
  /** Formats a card's headline price in the user's display currency; card hits show no price without it. */
  formatPrice?: (price: CardPriceSnapshot | undefined) => string | null;
  /** The user's pricing region, used to weight card hit prices. */
  pricingRegion?: PricingRegion;
  /** Whether a printing is in the binder or on the want list: card hits get Show mode's Owned / Wanted badge. */
  getCardState?: (card: SearchCardResult, pokemon: { id: number; name: string }) => { owned: boolean; wanted: boolean };
}

/** Card tiles are wide enough to tell printings apart; CardImage picks a sharp width and falls back to the proxy (also offline). */
const CARD_TILE_SIZES = '104px';

const SEARCH_FILTERS: Array<{
  id: SearchStateFilter;
  label: string;
}> = [
  { id: 'all', label: 'All' },
  { id: 'current', label: 'This Page' },
  { id: 'needed', label: 'Needed' },
  { id: 'missing', label: 'Missing' },
  { id: 'upgrade', label: 'Upgrades' },
  { id: 'wanted', label: 'Wanted' },
  { id: 'perfect', label: 'Perfect' },
];

/** Rows mounted at first and per step (fewer while typing, so card hits stay close): every match stays reachable without mounting the whole dex. */
const RESULT_STEP = 60;
const QUERY_RESULT_STEP = 40;
const NO_POKEMON: { id: number; name: string }[] = [];

export default function PokemonSearch({
  nativeConsumer,
  history,
  onSelect,
  pokemonList: propPokemonList,
  getResultMeta,
  currentPagePokemonList = NO_POKEMON,
  totalPages = 0,
  onJumpToPage,
  onBrowseCards,
  getOfflineCards,
  onBrowseIllustrator,
  onBrowseSet,
  formatPrice,
  pricingRegion = DEFAULT_PRICING_REGION,
  getCardState,
}: PokemonSearchProps) {
  const nativeModel = useMemo(() => (nativeConsumer ? nativeCardConsumers(nativeConsumer) : null), [nativeConsumer]);
  const [query, setQuery] = useState('');
  const recentCards = history.cards;
  const { rememberSearch, rememberCard: saveRecentCard } = history;
  const rememberCard = useCallback(
    (card: RecentCard) => {
      rememberSearch(query);
      saveRecentCard(card);
    },
    [query, rememberSearch, saveRecentCard],
  );
  const clearRecentCards = () => history.clear('card');
  const [chosenFilter, setActiveFilter] = useState<SearchStateFilter>(getInitialPokemonSearchFilter);
  // The current-page filter falls back to all Pokémon while the page has none.
  const activeFilter = chosenFilter === 'current' && currentPagePokemonList.length === 0 ? 'all' : chosenFilter;
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const pokemonList = propPokemonList || POKEMON_CATALOG;
  const currentPagePokemonIds = useMemo(
    () => new Set(currentPagePokemonList.map((pokemon) => pokemon.id)),
    [currentPagePokemonList],
  );

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus({ preventScroll: true });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, []);

  const matchesFilter = useCallback(
    (filter: SearchStateFilter, pokemon: { id: number; name: string }) => {
      const meta = getResultMeta?.(pokemon);

      return matchesPokemonSearchStateFilter(filter, {
        slotState: meta?.slotState,
        isCurrentPage: currentPagePokemonIds.has(pokemon.id),
      });
    },
    [currentPagePokemonIds, getResultMeta],
  );

  // Chip counts depend on the collection and current page, not the query: one pass over the catalogue, reused
  // on every keystroke (previously each chip re-filtered the whole list on every render).
  const filterCounts = useMemo(() => {
    const counts = new Map<SearchStateFilter, number>(SEARCH_FILTERS.map((filterOption) => [filterOption.id, 0]));
    for (const pokemon of pokemonList) {
      const meta = getResultMeta?.(pokemon);
      const context = { slotState: meta?.slotState, isCurrentPage: currentPagePokemonIds.has(pokemon.id) };
      for (const filterOption of SEARCH_FILTERS) {
        if (matchesPokemonSearchStateFilter(filterOption.id, context)) {
          counts.set(filterOption.id, (counts.get(filterOption.id) ?? 0) + 1);
        }
      }
    }
    return counts;
  }, [currentPagePokemonIds, getResultMeta, pokemonList]);

  const visibleResults = useMemo(() => {
    const byFilter = pokemonList.filter((pokemon) => matchesFilter(activeFilter, pokemon));
    return query.trim() ? searchPokemonItems(query, byFilter, Infinity) : byFilter;
  }, [activeFilter, matchesFilter, pokemonList, query]);
  // Mounted rows grow as the list is scrolled (or "Show more" / arrowed past the end); a new query or filter starts over.
  const resultsKey = `${activeFilter}\u0000${query}`;
  const resultStep = query.trim() ? QUERY_RESULT_STEP : RESULT_STEP;
  const [shownResults, setShownResults] = useState({ key: resultsKey, count: RESULT_STEP });
  const shownCount = shownResults.key === resultsKey ? shownResults.count : resultStep;
  const renderedResults = visibleResults.slice(0, shownCount);
  const showMoreResults = useCallback(
    (atLeast = 0) => {
      setShownResults({ key: resultsKey, count: Math.max(shownCount + resultStep, atLeast) });
    },
    [resultsKey, resultStep, shownCount],
  );
  // Keyboard selection belongs to one result list: a new list starts on its only match, or on nothing.
  const autoSelectedIndex = visibleResults.length === 1 && query.trim() ? 0 : -1;
  const [selection, setSelection] = useState({ results: visibleResults, query, index: autoSelectedIndex });
  const selectedIndex =
    selection.results === visibleResults && selection.query === query ? selection.index : autoSelectedIndex;
  const setSelectedIndex = useCallback(
    (index: number) => setSelection({ results: visibleResults, query, index }),
    [visibleResults, query],
  );
  const listRef = useRef<HTMLDivElement | null>(null);
  const moreResultsRef = useRef<HTMLButtonElement | null>(null);

  const cardSearch = useCardSearch(query, Boolean(onBrowseCards || nativeConsumer), getOfflineCards, {
    includeNonPokemon: Boolean(nativeConsumer),
  });
  const cardResultCount = nativeConsumer ? cardSearch.cards.length : cardSearch.groups.length;
  // One batched price lookup for every card hit (cached on the device, so offline hits keep their prices).
  const cardPriceLookups = useMemo(
    () =>
      formatPrice
        ? (nativeConsumer ? cardSearch.cards : cardSearch.groups.flatMap((group) => group.cards)).map((card) => ({
            cardId: card.id,
            language: card.language ?? 'en',
          }))
        : [],
    [cardSearch.groups, cardSearch.cards, nativeConsumer, formatPrice],
  );
  const { pricesByCardId: cardPrices } = useRegionalCardPrices(
    cardPriceLookups,
    cardPriceLookups.length > 0,
    pricingRegion,
  );
  const illustratorResults = useIllustratorSearch(query, Boolean(onBrowseIllustrator));
  const setResults = useSetSearch(query, Boolean(onBrowseSet));

  const showRecentCards = Boolean(onBrowseCards) && !query.trim() && recentCards.length > 0;
  const hasTrailingResults =
    setResults.length > 0 || illustratorResults.length > 0 || cardResultCount > 0 || cardSearch.loading;
  const hasMoreResults = visibleResults.length > renderedResults.length;

  // Scrolling to the end of the Pokémon list mounts the next rows. With set, artist or card hits below, it waits for
  // "Show more" instead, so those sections stay a short scroll away.
  useEffect(() => {
    const sentinel = moreResultsRef.current;
    if (!sentinel || hasTrailingResults || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) showMoreResults();
      },
      { root: listRef.current, rootMargin: '0px 0px 600px 0px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMoreResults, hasTrailingResults, showMoreResults]);

  useEffect(() => {
    if (selectedIndex < 0) return;
    listRef.current?.querySelector(`[data-result-index="${selectedIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const pageJump = useMemo(() => {
    if (!onJumpToPage || totalPages < 1) return null;
    return getPokemonSearchPageJump(query, totalPages);
  }, [onJumpToPage, query, totalPages]);

  const handleSelectPokemon = useCallback(
    (pokemon: { id: number; name: string }) => {
      const summary = getPokemonSummary(pokemon.id);
      if (summary) {
        rememberSearch(query);
        onSelect(summary);
      }
      setQuery('');
      setSelectedIndex(-1);
    },
    [onSelect, query, rememberSearch, setSelectedIndex],
  );

  const handleJumpToPage = useCallback(
    (page: number) => {
      if (!onJumpToPage) return;
      onJumpToPage(page);
      setQuery('');
      setSelectedIndex(-1);
    },
    [onJumpToPage, setSelectedIndex],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          if (visibleResults.length === 0) return;
          e.preventDefault();
          {
            const next = Math.min(selectedIndex + 1, visibleResults.length - 1);
            if (next >= shownCount) showMoreResults(next + 1);
            setSelectedIndex(next);
          }
          break;
        case 'ArrowUp':
          if (visibleResults.length === 0) return;
          e.preventDefault();
          setSelectedIndex(selectedIndex > 0 ? selectedIndex - 1 : -1);
          break;
        case 'Enter':
          e.preventDefault();
          if (pageJump) {
            rememberSearch(query);
            handleJumpToPage(pageJump.page);
          } else if (selectedIndex >= 0) {
            handleSelectPokemon(visibleResults[selectedIndex]);
          } else if (visibleResults.length === 1) {
            handleSelectPokemon(visibleResults[0]);
          } else rememberSearch(query);
          break;
        case 'Escape':
          e.preventDefault();
          setQuery('');
          setSelectedIndex(-1);
          break;
      }
    },
    [
      handleJumpToPage,
      handleSelectPokemon,
      pageJump,
      selectedIndex,
      visibleResults,
      rememberSearch,
      query,
      shownCount,
      showMoreResults,
      setSelectedIndex,
    ],
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="relative">
        <Search className="text-muted-foreground absolute top-1/2 left-4 h-5 w-5 -translate-y-1/2" />
        <Input
          ref={searchInputRef}
          type="text"
          aria-label={onBrowseCards ? 'Search Pokémon, cards, sets, artists or dex number' : 'Search Pokémon'}
          placeholder={onBrowseCards ? 'Pokémon, cards, sets, artists…' : 'Search Pokémon…'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          data-overlay-escape="clear"
          className="border-border/70 bg-card focus:border-primary h-11 rounded-2xl border pl-12 text-base"
          autoComplete="off"
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {SEARCH_FILTERS.map((filterOption) => {
          const count = filterCounts.get(filterOption.id) ?? 0;

          if (filterOption.id !== 'all' && count === 0) {
            return null;
          }

          const isActive = activeFilter === filterOption.id;

          return (
            <button
              key={filterOption.id}
              type="button"
              onClick={() => {
                setActiveFilter(filterOption.id);
                setSelectedIndex(-1);
              }}
              aria-pressed={isActive}
              className={`inline-flex min-h-9 items-center rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                isActive
                  ? 'border-primary/35 bg-primary/12 text-primary'
                  : 'border-border/50 bg-card text-muted-foreground hover:border-primary/20 hover:text-foreground'
              }`}
            >
              {filterOption.label}
              <span className="ml-1.5 text-[10px] opacity-70">{count}</span>
            </button>
          );
        })}
      </div>

      {pageJump ? (
        <button
          type="button"
          onClick={() => handleJumpToPage(pageJump.page)}
          className="border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 mt-3 flex w-full items-center justify-between gap-3 rounded-2xl border-2 px-4 py-3 text-left text-sm font-semibold transition-colors"
        >
          <span className="inline-flex min-w-0 items-center gap-2">
            <MapPinned className="h-4 w-4 shrink-0" />
            <span className="truncate">{pageJump.label}</span>
          </span>
          <ArrowRight className="h-4 w-4 shrink-0" />
        </button>
      ) : null}

      <div className="border-border/50 mt-3 min-h-0 flex-1 overflow-hidden border-t">
        {showRecentCards ||
        (!query.trim() && (history.searches.length > 0 || Boolean(history.status))) ||
        visibleResults.length > 0 ||
        setResults.length > 0 ||
        illustratorResults.length > 0 ||
        cardResultCount > 0 ||
        cardSearch.loading ? (
          <div ref={listRef} className="h-full overflow-y-auto">
            {!query.trim() && (
              <>
                {history.status && (
                  <p role="status" className="text-muted-foreground py-1 text-xs">
                    {history.status}
                  </p>
                )}
                <RecentSearches history={history} onSearch={setQuery} />
              </>
            )}
            {showRecentCards ? (
              <section aria-label="Recently viewed cards" className="border-border/50 border-b pb-2">
                <div className="flex items-center justify-between gap-2 px-4 pt-2">
                  <p className="text-muted-foreground inline-flex items-center gap-1.5 text-[11px] font-semibold">
                    <History className="h-3 w-3" />
                    Recently viewed
                  </p>
                  <button
                    type="button"
                    onClick={clearRecentCards}
                    aria-label={
                      history.shared ? 'Clear recently viewed cards for this binder' : 'Clear recently viewed cards'
                    }
                    className="text-muted-foreground hover:text-foreground -mr-2 min-h-9 rounded-full px-3 text-[11px] font-semibold"
                  >
                    {history.shared ? 'Clear for everyone' : 'Clear'}
                  </button>
                </div>
                <div className="flex gap-2 overflow-x-auto px-3 pb-1">
                  {recentCards.map((card) => {
                    return (
                      <button
                        key={card.id}
                        type="button"
                        onClick={() => {
                          // oxlint-disable-next-line react-doctor/rendering-hydration-mismatch-time -- runs in an event handler, never during render
                          rememberCard({ ...card, viewedAt: new Date().toISOString() });
                          onBrowseCards?.({ id: card.dexId, name: card.pokemonName }, card.id);
                        }}
                        aria-label={`${card.name} ${card.number} ${card.setName}`}
                        className="w-[6.5rem] shrink-0 text-left"
                      >
                        <div className="trading-card border-border/50 bg-muted/40 relative w-full overflow-hidden border">
                          {card.image ? (
                            <CardImage src={card.image} alt="" fill sizes={CARD_TILE_SIZES} className="object-cover" />
                          ) : null}
                        </div>
                        <p className="mt-1 truncate text-[10px] font-semibold">{card.name}</p>
                        <p className="text-muted-foreground truncate text-[10px] tabular-nums">{card.number}</p>
                      </button>
                    );
                  })}
                </div>
              </section>
            ) : null}
            {visibleResults.length > 0 &&
            (showRecentCards ||
              setResults.length > 0 ||
              illustratorResults.length > 0 ||
              cardResultCount > 0 ||
              cardSearch.loading) ? (
              <p className="text-muted-foreground px-4 pt-3 pb-1 text-[11px] font-semibold">Pokémon</p>
            ) : null}
            {renderedResults.map((pokemon, index) => {
              const meta = getResultMeta?.(pokemon);
              const isActive = index === selectedIndex;
              const displayName = formatPokemonDisplayName(pokemon.name);

              return (
                <div
                  key={pokemon.id}
                  data-result-index={index}
                  className={`border-border/50 flex w-full items-stretch border-b transition-colors last:border-b-0 ${
                    isActive ? 'bg-primary/20 text-primary' : 'hover:bg-primary/10 text-foreground'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => handleSelectPokemon(pokemon)}
                    className="min-w-0 flex-1 px-4 py-3 text-left"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="relative h-14 w-14 shrink-0">
                        <div className="from-muted to-muted/30 flex h-full w-full items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br">
                          {meta?.previewImage ? (
                            // oxlint-disable-next-line nextjs/no-img-element -- card image from assets.holofolder.com or the image proxy, cached by the service worker for offline use; next/image would bypass that cache
                            <img
                              src={meta.previewImage}
                              alt={displayName}
                              className={`h-full w-full p-1.5 ${meta.previewFitClass || 'object-contain'} ${meta.previewToneClass || ''}`}
                            />
                          ) : (
                            <div className="text-muted-foreground text-[10px]">No preview</div>
                          )}
                        </div>
                        {meta?.cardPreviewImage ? (
                          <div className="trading-card border-card bg-background absolute -right-1 -bottom-1 w-7 border-2 shadow-md">
                            {/* oxlint-disable-next-line nextjs/no-img-element -- card image from assets.holofolder.com or the image proxy, cached by the service worker for offline use; next/image would bypass that cache */}
                            <img
                              src={meta.cardPreviewImage}
                              alt={`${displayName} card preview`}
                              className={`h-full w-full object-cover ${meta.cardPreviewToneClass || ''}`}
                            />
                          </div>
                        ) : null}
                        {meta?.isFavorite ? (
                          <div className="absolute -top-1 -right-1 rounded-full bg-amber-500 p-1 text-white shadow">
                            <Star className="h-2.5 w-2.5 fill-current" />
                          </div>
                        ) : null}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="min-w-0">
                          <div className={`truncate font-semibold ${isActive ? 'text-primary' : ''}`}>
                            {displayName}
                          </div>
                          <div className="text-muted-foreground flex min-w-0 items-center gap-2 text-sm">
                            <span>#{pokemon.id}</span>
                            {meta?.stateLabel ? (
                              <span
                                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${meta.stateToneClass || 'bg-muted text-muted-foreground'}`}
                              >
                                {meta.stateLabel}
                              </span>
                            ) : null}
                          </div>
                        </div>

                        <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                          {meta?.cardLabel ? <span className="truncate">{meta.cardLabel}</span> : null}
                          {meta?.locationLabel ? (
                            <span className="inline-flex items-center gap-1">
                              <MapPinned className="h-3 w-3" />
                              {meta.locationLabel}
                            </span>
                          ) : null}
                          {meta?.elsewhereLabel ? (
                            <span
                              className="text-primary line-clamp-2 min-w-0 font-medium break-words"
                              title={meta.elsewhereLabel}
                              data-testid="owned-elsewhere"
                            >
                              {meta.elsewhereLabel}
                            </span>
                          ) : null}
                        </div>
                      </div>

                      {isActive || meta?.isSelected ? <ArrowRight className="text-primary h-4 w-4 shrink-0" /> : null}
                    </div>
                  </button>

                  {onBrowseCards ? (
                    <div className="flex shrink-0 items-center pr-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          rememberSearch(query);
                          onBrowseCards(pokemon);
                        }}
                        aria-label={`All ${displayName} cards`}
                        title="All cards"
                        className="border-border/60 bg-background/75 text-muted-foreground hover:border-primary/30 hover:bg-primary/10 hover:text-primary inline-flex h-9 w-9 items-center justify-center rounded-full border transition-colors"
                      >
                        <Layers3 className="h-4 w-4" />
                      </button>
                    </div>
                  ) : null}

                  {meta?.pageNumber && onJumpToPage ? (
                    <div className="flex shrink-0 items-center pr-3">
                      <button
                        type="button"
                        onClick={() => handleJumpToPage(meta.pageNumber!)}
                        aria-label={`Go to page ${meta.pageNumber}`}
                        className="border-border/60 bg-background/75 text-muted-foreground hover:border-primary/30 hover:bg-primary/10 hover:text-primary inline-flex h-9 items-center gap-1 rounded-full border px-2.5 text-[10px] font-semibold transition-colors"
                      >
                        <MapPinned className="h-3 w-3" />
                        <span className="hidden sm:inline">Page</span>
                        <span className="tabular-nums">{meta.pageNumber}</span>
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
            {hasMoreResults ? (
              <button
                ref={moreResultsRef}
                type="button"
                onClick={() => showMoreResults()}
                className="border-border/50 text-primary hover:bg-primary/10 min-h-11 w-full border-t px-4 py-2 text-left text-xs font-semibold"
              >
                Show more Pokémon ({visibleResults.length - renderedResults.length} more)
              </button>
            ) : null}
            {setResults.length > 0 ? (
              <section aria-label="Set results" className="border-border/50 border-t px-3 pb-2">
                <p className="text-muted-foreground px-1 pt-3 pb-1 text-[11px] font-semibold">Sets</p>
                <div className="flex flex-col gap-1">
                  {setResults.map((set) => {
                    const meta = formatSetHitMeta(set);
                    return (
                      <button
                        key={set.id}
                        type="button"
                        onClick={() => {
                          rememberSearch(query);
                          onBrowseSet?.(set);
                        }}
                        aria-label={`Open set ${set.name}${meta ? `, ${meta}` : ''}`}
                        className="hover:bg-primary/10 flex min-h-11 w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left"
                      >
                        <SetSymbol set={set} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">{set.name}</span>
                          {meta ? (
                            <span className="text-muted-foreground block truncate text-[11px]">{meta}</span>
                          ) : null}
                        </span>
                        <ArrowRight className="text-primary h-4 w-4 shrink-0" />
                      </button>
                    );
                  })}
                </div>
              </section>
            ) : null}
            {illustratorResults.length > 0 ? (
              <section aria-label="Illustrator results" className="border-border/50 border-t px-3 pb-2">
                <p className="text-muted-foreground px-1 pt-3 pb-1 text-[11px] font-semibold">Illustrators</p>
                <div className="flex flex-col gap-1">
                  {illustratorResults.map((illustrator) => (
                    <button
                      key={illustrator.name}
                      type="button"
                      onClick={() => {
                        rememberSearch(query);
                        onBrowseIllustrator?.(illustrator.name);
                      }}
                      aria-label={`Illustrator ${illustrator.name}, ${illustrator.cardCount} card${illustrator.cardCount === 1 ? '' : 's'}`}
                      className="hover:bg-primary/10 flex min-h-11 w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left"
                    >
                      <span className="bg-muted text-muted-foreground flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
                        <Palette className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{illustrator.name}</span>
                        <span className="text-muted-foreground block text-[11px]">
                          {illustrator.cardCount} card{illustrator.cardCount === 1 ? '' : 's'}
                        </span>
                      </span>
                      <ArrowRight className="text-primary h-4 w-4 shrink-0" />
                    </button>
                  ))}
                </div>
              </section>
            ) : null}
            {cardResultCount > 0 || cardSearch.loading ? (
              <section aria-label="Card results" className="border-border/50 border-t pb-2">
                <p className="text-muted-foreground flex items-center gap-2 px-4 pt-3 pb-1 text-[11px] font-semibold">
                  Cards
                  {cardSearch.loading ? (
                    <Loader2 className="h-3 w-3 animate-spin" aria-label="Searching cards" />
                  ) : null}
                  {cardSearch.offline ? (
                    <span className="font-normal tracking-normal normal-case">
                      · offline: your cards and saved sets
                    </span>
                  ) : null}
                </p>
                {cardSearch.correction ? (
                  <p role="status" className="text-muted-foreground px-4 py-1 text-xs">
                    Showing cards for {cardSearch.correction}
                  </p>
                ) : null}
                {nativeConsumer
                  ? cardSearch.cards.map((card) => {
                      const state = nativeCardState(nativeModel, card);
                      const label = nativeCardLabel(state);
                      return (
                        <button
                          key={`${card.id}:${card.language}`}
                          type="button"
                          onClick={() => nativeConsumer.openCard(card)}
                          aria-label={`${card.name} ${formatCardNumber(card)} ${card.set.name}, ${label}`}
                          className="active:bg-muted flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left"
                        >
                          <span className="trading-card border-border/50 bg-muted/40 relative w-14 shrink-0 overflow-hidden rounded-md border">
                            {card.image && (
                              <CardImage src={card.image} alt="" fill sizes="56px" className="object-cover" />
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold">{card.name}</span>
                            <span className="text-muted-foreground block truncate text-xs">
                              {card.set.name} · {formatCardNumber(card)}
                            </span>
                          </span>
                          <span className="max-w-[45%] text-right text-xs font-semibold">{label}</span>
                        </button>
                      );
                    })
                  : cardSearch.groups.map((group) => {
                      const groupName = formatPokemonDisplayName(group.name);
                      return (
                        <div key={group.dexId} className="px-3 py-2" data-card-group={group.dexId}>
                          <button
                            type="button"
                            onClick={() => {
                              rememberSearch(query);
                              onBrowseCards?.({ id: group.dexId, name: group.name });
                            }}
                            className="hover:bg-primary/10 flex w-full items-center justify-between gap-2 rounded-xl px-1 py-1 text-left"
                            aria-label={`${groupName}: ${group.cards.length} matching card${group.cards.length === 1 ? '' : 's'}, show all cards`}
                          >
                            <span className="min-w-0 truncate text-sm font-semibold">
                              {groupName} <span className="text-muted-foreground font-normal">#{group.dexId}</span>
                            </span>
                            <span className="text-primary inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold">
                              All cards <ArrowRight className="h-3 w-3" />
                            </span>
                          </button>
                          <div className="mt-1.5 flex gap-2 overflow-x-auto pb-1">
                            {group.cards.map((card) => {
                              const price =
                                formatPrice?.(cardPrices[getCardPriceKey(card.id, card.language ?? 'en')])?.split(
                                  ' (',
                                )[0] ?? null;
                              const standing = getCardState
                                ? getCardStanding(getCardState(card, { id: group.dexId, name: group.name }))
                                : null;
                              const badge = standing && standing !== 'missing' ? CARD_STANDING_BADGES[standing] : null;
                              return (
                                <button
                                  key={card.id}
                                  type="button"
                                  onClick={() => {
                                    rememberCard(toRecentCard(card, { id: group.dexId, name: group.name }));
                                    onBrowseCards?.({ id: group.dexId, name: group.name }, card.id);
                                  }}
                                  aria-label={`${card.name} ${formatCardNumber(card)} ${card.set.name}${badge ? `, ${badge.label}` : ''}`}
                                  data-standing={standing ?? undefined}
                                  className="w-[6.5rem] shrink-0 text-left"
                                >
                                  <div
                                    className={`trading-card bg-muted/40 relative w-full border ${standing === 'owned' ? 'border-emerald-500/60' : standing === 'wanted' ? 'border-rose-500/60' : 'border-border/50'}`}
                                  >
                                    {card.image ? (
                                      <CardImage
                                        src={card.image}
                                        alt=""
                                        fill
                                        sizes={CARD_TILE_SIZES}
                                        className="object-cover"
                                      />
                                    ) : null}
                                    {badge ? (
                                      <span
                                        aria-hidden
                                        className={`absolute inset-x-1 bottom-1 truncate rounded-full px-1 py-0.5 text-center text-[9px] leading-none font-bold text-white shadow-sm ${standing === 'owned' ? 'bg-emerald-600' : 'bg-rose-600'}`}
                                      >
                                        {badge.label}
                                      </span>
                                    ) : null}
                                  </div>
                                  <p className="mt-1 truncate text-[10px] font-semibold">{card.set.name}</p>
                                  <p className="text-muted-foreground truncate text-[10px] tabular-nums">
                                    {formatCardNumber(card)}
                                  </p>
                                  {price ? (
                                    <p
                                      className="truncate text-[11px] font-bold tabular-nums"
                                      data-testid="search-card-price"
                                    >
                                      {price}
                                    </p>
                                  ) : null}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
              </section>
            ) : null}
          </div>
        ) : (
          <div className="text-muted-foreground px-4 py-6 text-sm">
            {pageJump
              ? 'Press Enter or tap the page jump above.'
              : query.trim()
                ? cardSearch.offline
                  ? 'No matches in your saved cards. Try a card name or set you have saved.'
                  : 'No matches. Try a Pokémon name, a set, or both, like Abra 151.'
                : 'Nothing in this filter yet. Try another view or search by name.'}
          </div>
        )}
      </div>
    </div>
  );
}
