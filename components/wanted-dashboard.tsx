'use client';

import { appPath } from '@/lib/app-path';

import type { User } from '@supabase/supabase-js';
import { usePartner } from '@/hooks/use-partner';
import { wantedPeopleLabel } from '@/lib/wanted-people';
import { runAfterOverlayHistory } from '@/hooks/use-overlay';
import { binderHref, rememberLastOpenedBinder } from '@/lib/binders/client';
import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { toCardImageSrc } from '@/lib/card-image-url';
import { Check, ChevronDown, Heart, MoreHorizontal, Search, Share2, SlidersHorizontal, X } from 'lucide-react';
import type { CardPriceSnapshot } from '@/hooks/use-card-prices';
import type { WantedCard } from '@/lib/domain/cards';
import { PriceDropBadge } from '@/components/price-drop-badge';
import { PriceRisingBadge } from '@/components/price-rising-badge';
import { getPokemonSummary, type PokemonSummary } from '@/lib/pokemon-catalog';
import { getRisingMomentum } from '@/lib/price-momentum';
import {
  EMPTY_WANTED_FILTERS,
  WANTED_SORTS,
  applyWantedFilters,
  countWantedFilters,
  countWantedPriceDrops,
  filterWantedDashboardEntries,
  groupWantedByPokemon,
  hasWantedPriceDrop,
  sortWantedDashboardEntries,
  type buildWantedDashboardSummary,
  type WantedDashboardPriceBandId,
  type WantedDashboardSort,
  type WantedFilters,
  readRememberedWantedView,
  WANTED_VIEW_STORAGE_KEY,
} from '@/lib/wanted-dashboard';
import { formatCardFinishLabel, formatCardLanguageLabel } from '@/lib/card-labels';
import { readBinderScope, rememberBinderScope, type BinderScope } from '@/lib/binders/all-binders';
import { BinderScopeToggle } from '@/components/binder-scope-toggle';

const WantedFiltersSheet = dynamic(() => import('@/components/wanted-filters-sheet'), { loading: () => null });
const WantedRowActionsSheet = dynamic(() => import('@/components/wanted-row-actions-sheet'), { loading: () => null });

type WantedDashboardSummary = ReturnType<typeof buildWantedDashboardSummary>;
type WantedDashboardEntry = WantedDashboardSummary['cards'][number];

type PriceFormat = {
  label: (price: CardPriceSnapshot | undefined) => string | null;
  amount: (amount: number | null | undefined, price?: CardPriceSnapshot) => string | null;
  range: (low: number | null | undefined, high: number | null | undefined, price?: CardPriceSnapshot) => string | null;
};

export type WantedDashboardProps = {
  user?: User | null;
  isOnline?: boolean;
  loadedBinderCount?: number;
  binderCount?: number;
  onAssignWanted?: (pokemonId: number, pokemonName: string, card: WantedCard, ids: string[]) => void;
  wantedDashboard: WantedDashboardSummary;
  /** Every binder's wanted cards (two or more binders only); enables the This binder / All binders toggle. */
  allBindersDashboard?: WantedDashboardSummary | null;
  currentBinderId?: string | null;
  priceFormat: PriceFormat;
  isLoadingPrices: boolean;
  readOnlyMode: boolean;
  handleShareWantedList: (scope?: 'binder' | 'all') => void;
  handleGotWantedCard: (pokemonId: number, pokemonName: string, wantedCard: WantedCard) => void;
  handleClearWantedCard: (pokemonId: number, wantedCard: WantedCard) => void;
  handlePokemonSelect: (pokemon: PokemonSummary, card: WantedCard) => void;
  jumpToWantedPokemonPage: (pokemon: PokemonSummary | null) => void;
  /** Look up any card's price (not just wanted ones), starting from this search. */
  onCheckAnyCardPrice?: (query: string) => void;
};

const BAND_DOT: Record<WantedDashboardPriceBandId, string> = {
  'under-5': 'bg-emerald-500',
  'five-to-15': 'bg-sky-500',
  'fifteen-to-50': 'bg-violet-500',
  'over-50': 'bg-rose-500',
  unpriced: 'bg-slate-400',
};

export { WANTED_VIEW_STORAGE_KEY };

function useRememberedWantedView() {
  // The want list only renders on the client (it is loaded after the binder shell), so reading
  // storage in the initialiser is safe and avoids a flash of the default order.
  const [sort, setSort] = useState<WantedDashboardSort>(() => readRememberedWantedView().sort);
  const [filters, setFilters] = useState<WantedFilters>(() => readRememberedWantedView().filters);

  useEffect(() => {
    try {
      window.localStorage.setItem(WANTED_VIEW_STORAGE_KEY, JSON.stringify({ sort, filters }));
    } catch {
      // Storage full or blocked: the choice still applies for this visit.
    }
  }, [filters, sort]);

  return { sort, setSort, filters, setFilters };
}

type ActiveChip = { key: string; label: string; remove: (filters: WantedFilters) => WantedFilters };

function getActiveFilterChips(filters: WantedFilters, bandLabels: Map<string, string>): ActiveChip[] {
  const without =
    <K extends Exclude<keyof WantedFilters, 'risingOnly' | 'dropsOnly'>>(key: K, value: string) =>
    (current: WantedFilters) => ({ ...current, [key]: (current[key] as string[]).filter((item) => item !== value) });
  return [
    ...filters.bands.map((band) => ({
      key: `band:${band}`,
      label: bandLabels.get(band) ?? band,
      remove: without('bands', band),
    })),
    ...(filters.dropsOnly
      ? [{ key: 'drops', label: 'Price drops', remove: (current: WantedFilters) => ({ ...current, dropsOnly: false }) }]
      : []),
    ...(filters.risingOnly
      ? [
          {
            key: 'rising',
            label: 'Rising only',
            remove: (current: WantedFilters) => ({ ...current, risingOnly: false }),
          },
        ]
      : []),
    ...filters.sets.map((set) => ({ key: `set:${set}`, label: set, remove: without('sets', set) })),
    ...filters.finishes.map((finish) => ({
      key: `finish:${finish}`,
      label: formatCardFinishLabel(finish),
      remove: without('finishes', finish),
    })),
    ...filters.languages.map((language) => ({
      key: `language:${language}`,
      label: formatCardLanguageLabel(language),
      remove: without('languages', language),
    })),
  ];
}

function cardNumberLabel(card: WantedCard) {
  if (!card.local_id) return null;
  return `#${card.local_id}${card.set_total ? `/${card.set_total}` : ''}`;
}

export default function WantedDashboard({
  user = null,
  isOnline = true,
  loadedBinderCount = 1,
  binderCount = 1,
  onAssignWanted,
  wantedDashboard: binderDashboard,
  allBindersDashboard = null,
  currentBinderId = null,
  priceFormat,
  isLoadingPrices,
  readOnlyMode,
  handleShareWantedList,
  handleGotWantedCard,
  handleClearWantedCard,
  handlePokemonSelect,
  jumpToWantedPokemonPage,
  onCheckAnyCardPrice,
  // oxlint-disable-next-line react-doctor/prefer-useReducer -- independent pieces of UI state; React batches the updates and one reducer would not be clearer
}: WantedDashboardProps) {
  const { partner } = usePartner({ user });
  const personLabel = (ids: string[] | undefined) =>
    wantedPeopleLabel(ids, user?.id ?? null, partner?.id ?? null, partner?.email ?? 'Partner');
  // oxlint-disable-next-line react-doctor/rerender-state-only-in-handlers -- the navigation effect waits for this and for the actions sheet to close
  const [pendingBinder, setPendingBinder] = useState<string | null>(null);
  const openWantedBinder = (binderId: string) => {
    rememberBinderScope('wanted', 'binder');
    setPendingBinder(binderId);
  };
  const [scope, setScope] = useState<BinderScope>(() => readBinderScope('wanted'));
  const changeScope = (next: BinderScope) => {
    setScope(next);
    rememberBinderScope('wanted', next);
  };
  const isAllBinders = scope === 'all' && allBindersDashboard !== null;
  const wantedDashboard = isAllBinders ? allBindersDashboard : binderDashboard;
  const scopeToggle = allBindersDashboard ? (
    <BinderScopeToggle scope={isAllBinders ? 'all' : 'binder'} onChange={changeScope} />
  ) : null;
  const [query, setQuery] = useState('');
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [actionsFor, setActionsFor] = useState<WantedDashboardEntry | null>(null);
  useEffect(() => {
    if (!pendingBinder || actionsFor) return;
    runAfterOverlayHistory(() => {
      const url = new URL(appPath(binderHref(pendingBinder, window.location.href)), window.location.origin);
      url.searchParams.set('view', 'wanted');
      rememberLastOpenedBinder(pendingBinder);
      window.location.assign(url.href);
    });
  }, [actionsFor, pendingBinder]);
  const { sort, setSort, filters, setFilters } = useRememberedWantedView();
  const sortedCards = useMemo(
    () => sortWantedDashboardEntries(applyWantedFilters(wantedDashboard.cards, filters), sort),
    [filters, sort, wantedDashboard.cards],
  );
  const visibleCards = useMemo(() => filterWantedDashboardEntries(sortedCards, query), [query, sortedCards]);
  // Regrouped after search so a group's order follows what is left in it.
  const pokemonGroups = useMemo(
    () => (sort === 'pokemon' ? groupWantedByPokemon(visibleCards) : null),
    [sort, visibleCards],
  );
  const risingCount = useMemo(
    () => wantedDashboard.cards.filter((card) => getRisingMomentum(card.price) != null).length,
    [wantedDashboard.cards],
  );
  const dropCount = useMemo(() => countWantedPriceDrops(wantedDashboard.cards), [wantedDashboard.cards]);
  const activeChips = getActiveFilterChips(
    filters,
    new Map(wantedDashboard.priceBands.map((band) => [band.id, band.label])),
  );
  const filterCount = countWantedFilters(filters);
  const sortLabel = WANTED_SORTS.find((option) => option.id === sort)?.short ?? 'Sort';
  const totalWantedCount = wantedDashboard.totalCards;
  const isFiltered = filterCount > 0;
  const isSearching = query.trim().length > 0;
  const marketTotalLabel = priceFormat.amount(wantedDashboard.marketTotalGbp);
  const hasAnyPrice = wantedDashboard.pricedCount > 0;

  const incomplete = scope === 'all' && loadedBinderCount < binderCount;
  const coverage = incomplete
    ? `${loadedBinderCount} of ${binderCount} binders loaded. ${isOnline ? 'Other binders are still loading or unavailable.' : 'Offline, showing saved binders only.'}`
    : null;
  const title = readOnlyMode ? 'Wanted cards' : scope === 'all' ? 'Global Wanted' : 'Wanted in this binder';
  const activeActions = actionsFor
    ? (wantedDashboard.cards.find((entry) => entry.key === actionsFor.key) ?? actionsFor)
    : null;
  const actionLocation = activeActions?.locations?.find((location) => location.binderId === currentBinderId);
  const editableAction =
    activeActions && (!isAllBinders || !activeActions.locations?.length) ? activeActions : actionLocation;

  if (totalWantedCount === 0) {
    return (
      <div className="border-border/65 bg-card/88 dark:bg-card/72 flex min-h-0 flex-1 items-center justify-center rounded-[1.35rem] border p-6 text-center dark:border-white/10">
        <div className="max-w-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-300">
            <Heart className="h-5 w-5" />
          </div>
          <h1 className="mt-3 text-xl font-semibold">{title}</h1>
          <p className="mt-3 text-sm font-semibold">
            {incomplete
              ? 'No wanted cards loaded yet'
              : isAllBinders
                ? 'No wanted cards in any binder'
                : 'No wanted cards yet'}
          </p>
          {coverage && (
            <p role="status" className="text-muted-foreground mt-2 text-sm">
              {coverage}
            </p>
          )}
          <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
            Choose Want card on a binder slot to start your list.
          </p>
          {!readOnlyMode && onCheckAnyCardPrice ? (
            <button
              type="button"
              onClick={() => onCheckAnyCardPrice('')}
              className="bg-primary text-primary-foreground mt-4 inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold"
            >
              <Search className="h-4 w-4" aria-hidden="true" />
              Check a card price
            </button>
          ) : null}
          {scopeToggle ? <div className="mt-4 flex justify-center">{scopeToggle}</div> : null}
        </div>
      </div>
    );
  }

  const renderRow = (wantedCard: WantedDashboardEntry) => (
    <WantedRow
      key={wantedCard.key}
      wantedCard={wantedCard}
      priceFormat={priceFormat}
      isLoadingPrices={isLoadingPrices}
      readOnlyMode={readOnlyMode}
      otherBinderName={
        isAllBinders
          ? ((wantedCard.locations &&
              Array.from(new Set(wantedCard.locations.map((location) => location.binderName))).join(', ')) ??
            wantedCard.binderName ??
            null)
          : null
      }
      peopleLabel={personLabel(wantedCard.card.wanted_by)}
      onOpen={isAllBinders ? () => setActionsFor(wantedCard) : handlePokemonSelect}
      onGot={isAllBinders ? () => setActionsFor(wantedCard) : handleGotWantedCard}
      onMore={setActionsFor}
    />
  );

  const summaryPrice = hasAnyPrice
    ? `~${marketTotalLabel} to complete`
    : isLoadingPrices
      ? 'Loading prices…'
      : 'No prices yet';

  return (
    <div
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[calc(var(--dock-clearance)+1rem)] md:pb-3"
      data-testid="wanted-list"
    >
      <div className="mx-auto max-w-3xl space-y-2">
        <h1 className="pt-2 text-2xl font-semibold">{title}</h1>
        {coverage && (
          <p role="status" className="text-muted-foreground text-sm">
            {coverage}
          </p>
        )}
        <div
          data-scroll-blur="background"
          className="bg-background/92 supports-[backdrop-filter]:bg-background/75 sticky top-0 z-10 -mx-1 space-y-2 px-1 pt-1 pb-2 backdrop-blur"
        >
          {scopeToggle ? (
            <div className="flex items-center justify-between gap-2">
              {scopeToggle}
              {isAllBinders ? (
                <p className="text-muted-foreground min-w-0 truncate text-[11px]">Choose a binder to edit its wants</p>
              ) : null}
            </div>
          ) : null}
          <div className="flex items-center gap-2">
            <label className="relative block min-w-0 flex-1">
              <span className="sr-only">Search want list</span>
              <Search
                className="text-muted-foreground pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2"
                aria-hidden="true"
              />
              <input
                type="search"
                inputMode="search"
                enterKeyHint="search"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search cards, sets, artists"
                aria-label="Search want list"
                className="border-border/70 bg-card placeholder:text-muted-foreground/80 focus:border-primary/50 focus:ring-primary/20 h-11 w-full rounded-2xl border pr-11 pl-10 text-base transition outline-none focus:ring-2 sm:text-sm dark:border-white/12 [&::-webkit-search-cancel-button]:hidden"
              />
              {isSearching ? (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                  className="text-muted-foreground hover:text-foreground absolute top-0 right-0 flex h-11 w-11 items-center justify-center rounded-2xl"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </label>
            <button
              type="button"
              onClick={() => void handleShareWantedList(isAllBinders ? 'all' : 'binder')}
              aria-label="Share list"
              className="border-border/60 bg-card hover:border-primary/35 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border text-xs font-semibold transition dark:border-white/10"
            >
              <Share2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <p className="line-clamp-2 min-w-0 flex-1 text-sm leading-snug" data-testid="wanted-summary">
              <span className="font-semibold tabular-nums">{totalWantedCount} wanted</span>
              <span className="text-muted-foreground"> · </span>
              <span className="tabular-nums">{summaryPrice}</span>
              {hasAnyPrice && wantedDashboard.unpricedCount > 0 ? (
                <span className="text-muted-foreground"> · {wantedDashboard.unpricedCount} unpriced</span>
              ) : null}
              {dropCount > 0 ? (
                <span className="font-semibold text-emerald-700 dark:text-emerald-300" data-testid="wanted-drop-count">
                  {' '}
                  · {dropCount} price {dropCount === 1 ? 'drop' : 'drops'}
                </span>
              ) : null}
            </p>
            <button
              type="button"
              onClick={() => setIsSheetOpen(true)}
              aria-label={`Sort and filter, sorted by ${WANTED_SORTS.find((option) => option.id === sort)?.label ?? sort}${filterCount ? `, ${filterCount} ${filterCount === 1 ? 'filter' : 'filters'} on` : ''}`}
              aria-haspopup="dialog"
              data-testid="wanted-sort-filter"
              className="border-border/60 bg-card hover:border-primary/35 inline-flex h-11 shrink-0 items-center gap-1.5 rounded-2xl border pr-3 pl-3 text-xs font-semibold transition dark:border-white/10"
            >
              <SlidersHorizontal className="text-muted-foreground h-3.5 w-3.5" aria-hidden="true" />
              {sortLabel}
              {filterCount > 0 ? (
                <span className="bg-primary text-primary-foreground flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[0.68rem] tabular-nums">
                  {filterCount}
                </span>
              ) : null}
            </button>
          </div>

          {activeChips.length > 0 ? (
            <div
              className="-mx-1 flex [scrollbar-width:none] gap-1.5 overflow-x-auto px-1 pb-0.5"
              data-testid="wanted-active-filters"
            >
              {activeChips.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  onClick={() => setFilters((current) => chip.remove(current))}
                  aria-label={`Remove filter ${chip.label}`}
                  className="border-primary/30 bg-primary/10 text-primary inline-flex h-11 shrink-0 items-center gap-1 rounded-full border px-3.5 text-xs font-semibold"
                >
                  {chip.label}
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              ))}
              {activeChips.length > 1 ? (
                <button
                  type="button"
                  onClick={() => setFilters(EMPTY_WANTED_FILTERS)}
                  className="text-muted-foreground hover:text-foreground inline-flex h-11 shrink-0 items-center rounded-full px-3 text-xs font-semibold"
                >
                  Clear all
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        {visibleCards.length === 0 ? (
          <div className="border-border/60 bg-card/80 rounded-2xl border p-5 text-center dark:border-white/10">
            <p className="text-sm font-semibold">
              {isSearching
                ? `Nothing on your want list matches “${query.trim()}”`
                : 'No wanted cards match this filter'}
            </p>
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setFilters(EMPTY_WANTED_FILTERS);
              }}
              className="border-border/60 mt-3 inline-flex h-11 items-center rounded-2xl border px-4 text-sm font-semibold dark:border-white/10"
            >
              Show all wanted cards
            </button>
            {isSearching && onCheckAnyCardPrice ? (
              <button
                type="button"
                onClick={() => onCheckAnyCardPrice(query.trim())}
                className="bg-primary text-primary-foreground mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-2xl px-4 text-sm font-bold"
              >
                <Search className="h-4 w-4" aria-hidden="true" />
                Check price of any card
              </button>
            ) : null}
          </div>
        ) : pokemonGroups ? (
          <div className="space-y-2" data-testid="wanted-groups">
            {pokemonGroups.map((group) => {
              const topLabel = priceFormat.amount(group.topGbpAmount);
              const countLabel = `${group.cards.length} wanted`;
              return (
                <section
                  key={group.pokemonId}
                  aria-label={`${group.pokemonName} · ${countLabel}`}
                  data-testid="wanted-group"
                  data-pokemon-id={group.pokemonId}
                >
                  <h3 className="flex items-baseline justify-between gap-2 px-1 pb-1 text-xs">
                    <span className="min-w-0 truncate font-semibold capitalize">{group.pokemonName}</span>
                    <span className="text-muted-foreground shrink-0 tabular-nums">
                      {topLabel ? `${countLabel} · top ${topLabel}` : countLabel}
                    </span>
                  </h3>
                  <ul
                    className="divide-border/50 border-border/60 bg-card/85 dark:bg-card/70 divide-y overflow-hidden rounded-2xl border dark:divide-white/10 dark:border-white/10"
                    aria-label={`Wanted ${group.pokemonName} cards`}
                  >
                    {group.cards.map(renderRow)}
                  </ul>
                </section>
              );
            })}
          </div>
        ) : (
          <ul
            className="divide-border/50 border-border/60 bg-card/85 dark:bg-card/70 divide-y overflow-hidden rounded-2xl border dark:divide-white/10 dark:border-white/10"
            aria-label="Wanted cards"
          >
            {visibleCards.map(renderRow)}
          </ul>
        )}
        {(isSearching || isFiltered) && visibleCards.length > 0 ? (
          <p className="text-muted-foreground px-1 text-xs" data-testid="wanted-match-count">
            Showing {visibleCards.length} of {totalWantedCount}
          </p>
        ) : null}
        {isSearching && visibleCards.length > 0 && onCheckAnyCardPrice ? (
          <button
            type="button"
            onClick={() => onCheckAnyCardPrice(query.trim())}
            className="border-border/60 text-primary flex h-11 w-full items-center justify-center gap-2 rounded-2xl border text-sm font-semibold dark:border-white/10"
          >
            <Search className="h-4 w-4" aria-hidden="true" />
            Not here? Check price of any card
          </button>
        ) : null}

        <WantedInsights wantedDashboard={wantedDashboard} priceFormat={priceFormat} />

        {activeActions ? (
          <WantedRowActionsSheet
            cardName={activeActions.card.card_name}
            detail={[
              activeActions.card.card_set,
              cardNumberLabel(activeActions.card),
              formatCardFinishLabel(activeActions.card.card_finish),
            ]
              .filter(Boolean)
              .join(' · ')}
            readOnlyMode={readOnlyMode || !editableAction}
            locations={isAllBinders ? activeActions.locations : undefined}
            onOpenBinder={openWantedBinder}
            peopleLabel={personLabel}
            gotLabel={actionLocation ? `Got it for ${actionLocation.binderName}` : undefined}
            assignment={
              user && editableAction && onAssignWanted && !readOnlyMode
                ? {
                    selected: editableAction.card.wanted_by,
                    viewerId: user.id,
                    partnerId: partner?.id ?? null,
                    partnerLabel: partner?.email ?? 'Partner',
                    onChange: (ids) =>
                      onAssignWanted(editableAction.pokemonId, editableAction.pokemonName, editableAction.card, ids),
                  }
                : undefined
            }
            onGot={() => {
              if (editableAction)
                handleGotWantedCard(editableAction.pokemonId, editableAction.pokemonName, editableAction.card);
            }}
            onShowInBinder={
              editableAction && getPokemonSummary(editableAction.pokemonId)
                ? () => jumpToWantedPokemonPage(getPokemonSummary(editableAction.pokemonId))
                : null
            }
            onRemove={() => {
              if (editableAction) handleClearWantedCard(editableAction.pokemonId, editableAction.card);
            }}
            onClose={() => setActionsFor(null)}
          />
        ) : null}

        {isSheetOpen ? (
          <WantedFiltersSheet
            sort={sort}
            onSortChange={setSort}
            filters={filters}
            onFiltersChange={setFilters}
            priceBands={wantedDashboard.priceBands}
            sets={wantedDashboard.setBreakdown}
            finishes={wantedDashboard.finishBreakdown}
            languages={wantedDashboard.languageBreakdown}
            risingCount={risingCount}
            dropCount={dropCount}
            resultCount={visibleCards.length}
            onReset={() => {
              setSort('highest');
              setFilters(EMPTY_WANTED_FILTERS);
            }}
            onClose={() => setIsSheetOpen(false)}
          />
        ) : null}
      </div>
    </div>
  );
}

function WantedRow({
  wantedCard,
  priceFormat,
  isLoadingPrices,
  readOnlyMode,
  otherBinderName,
  peopleLabel,
  onOpen,
  onGot,
  onMore,
}: {
  wantedCard: WantedDashboardEntry;
  priceFormat: PriceFormat;
  isLoadingPrices: boolean;
  readOnlyMode: boolean;
  /** Set when the row belongs to another binder (All binders view): shown, but changed from that binder. */
  otherBinderName: string | null;
  peopleLabel: string;
  onOpen: (pokemon: PokemonSummary, card: WantedCard) => void;
  onGot: WantedDashboardProps['handleGotWantedCard'];
  onMore: (entry: WantedDashboardEntry) => void;
}) {
  const { pokemonId, pokemonName, card, price } = wantedCard;
  const pokemon = getPokemonSummary(pokemonId);
  const priceLabel = priceFormat.amount(wantedCard.effectiveGbpAmount, price);
  const language =
    card.card_language && card.card_language !== 'en' ? formatCardLanguageLabel(card.card_language) : null;
  const setLine = [card.card_set, cardNumberLabel(card)].filter(Boolean).join(' · ');
  const variantLine = [formatCardFinishLabel(card.card_finish), language].filter(Boolean).join(' · ');
  const showPokemon = pokemonName && !card.card_name.toLowerCase().includes(pokemonName.toLowerCase());
  const priceDropped = hasWantedPriceDrop(wantedCard);

  return (
    <li className="flex items-center gap-2 py-2 pr-1.5 pl-2" data-testid="wanted-row" data-card-id={card.card_id}>
      <button
        type="button"
        onClick={() => pokemon && onOpen(pokemon, card)}
        disabled={!pokemon}
        aria-label={`Open ${card.card_name}${card.card_set ? ` from ${card.card_set}` : ''}${priceDropped ? ', price dropped' : ''}`}
        className="active:bg-primary/5 flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-xl text-left transition"
      >
        <span className="trading-card border-border/55 bg-muted relative w-11 shrink-0 border dark:border-white/10">
          {card.card_image ? (
            // oxlint-disable-next-line nextjs/no-img-element -- card image from assets.holofolder.com or the image proxy, cached by the service worker for offline use; next/image would bypass that cache
            <img
              src={toCardImageSrc(card.card_image) ?? undefined}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
              loading="lazy"
              decoding="async"
            />
          ) : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">
            {card.card_name}
            {showPokemon ? (
              <span className="text-muted-foreground font-normal capitalize"> · {pokemonName}</span>
            ) : null}
          </span>
          <span className="text-muted-foreground block truncate text-xs">{setLine || 'Unknown set'}</span>
          <span className="text-muted-foreground/90 block truncate text-[11px]">{variantLine}</span>
          {/* Assignments are private; read-only views never receive them, so don't print a default. */}
          {!readOnlyMode && (
            <span className="text-muted-foreground block text-sm break-words">Wanted by: {peopleLabel}</span>
          )}
          {otherBinderName ? (
            <span className="text-primary block truncate text-[11px] font-semibold" data-testid="wanted-row-binder">
              In {otherBinderName}
            </span>
          ) : null}
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-sm font-bold tabular-nums" data-testid="wanted-row-price">
            {priceLabel ?? (isLoadingPrices ? '…' : 'No price')}
          </span>
          <PriceRisingBadge price={price} />
          {priceDropped ? <PriceDropBadge price={price} /> : null}
        </span>
      </button>
      <span className="flex shrink-0 items-center">
        {readOnlyMode ? null : (
          <button
            type="button"
            onClick={() => onGot(pokemonId, pokemonName, card)}
            aria-label={`Got it: ${card.card_name}`}
            title="Got it"
            className="flex h-11 w-11 items-center justify-center rounded-xl text-emerald-600 transition hover:bg-emerald-500/10 active:bg-emerald-500/15 dark:text-emerald-300"
          >
            <Check className="h-5 w-5" />
          </button>
        )}
        <button
          type="button"
          onClick={() => onMore(wantedCard)}
          aria-label={`More actions for ${card.card_name}`}
          aria-haspopup="dialog"
          title="More"
          className="text-muted-foreground hover:bg-muted/70 hover:text-foreground flex h-11 w-11 items-center justify-center rounded-xl transition"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </span>
    </li>
  );
}

function WantedInsights({
  wantedDashboard,
  priceFormat,
}: {
  wantedDashboard: WantedDashboardSummary;
  priceFormat: PriceFormat;
}) {
  const averageLabel = priceFormat.amount(wantedDashboard.averageGbp);
  const highest = wantedDashboard.highestCards[0];
  const highestLabel = priceFormat.amount(highest?.effectiveGbpAmount, highest?.price);
  const topSets = wantedDashboard.setBreakdown.slice(0, 5);

  return (
    <details
      className="group border-border/60 bg-card/80 dark:bg-card/65 rounded-2xl border dark:border-white/10"
      data-testid="wanted-insights"
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">
        Insights
        <ChevronDown className="text-muted-foreground h-4 w-4 transition group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="border-border/50 space-y-3 border-t px-3 pt-3 pb-3 text-xs dark:border-white/10">
        <p className="text-muted-foreground">
          {wantedDashboard.pricedCount} of {wantedDashboard.totalCards} priced
          {averageLabel ? ` · average ${averageLabel}` : ''}
          {highest && highestLabel ? ` · top ${highest.card.card_name} ${highestLabel}` : ''}
        </p>
        <ul className="space-y-1" aria-label="Cards by price">
          {wantedDashboard.priceBands.flatMap((band) =>
            band.count > 0
              ? [
                  <li key={band.id} className="flex items-center gap-2">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${BAND_DOT[band.id]}`} aria-hidden="true" />
                    <span className="min-w-0 flex-1">{band.label}</span>
                    <span className="text-muted-foreground tabular-nums">{band.count}</span>
                  </li>,
                ]
              : [],
          )}
        </ul>
        {topSets.length > 1 ? (
          <ul className="border-border/40 space-y-1 border-t pt-2 dark:border-white/10" aria-label="Most wanted sets">
            {topSets.map((set) => (
              <li key={set.label} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">{set.label}</span>
                <span className="text-muted-foreground tabular-nums">{set.count}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </details>
  );
}
