'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Palette, Search as SearchIcon, X } from 'lucide-react';
import CardsBrowserSheet from '@/components/cards-browser-sheet';
import {
  ActiveFilterChips,
  CardResultsControls,
  CardResultsGrid,
  CardResultTile,
  CardStandingMark,
} from '@/components/card-results-grid';
import { getCardPriceKey, type CardPriceSnapshot } from '@/hooks/use-card-prices';
import { useCardResultsFilters } from '@/hooks/use-card-results-filters';
import { useRegionalCardPrices } from '@/hooks/use-regional-card-prices';
import type { PricingRegion } from '@/lib/pricing-region';
import { cardResultPriceLabels } from '@/lib/card-results';
import { getCardPickerSortAmount } from '@/lib/card-selector-sort';
import { inferCardFinish } from '@/lib/pokemon-card-browse';
import { loadIllustratorCards } from '@/lib/illustrator-client';
import {
  buildIllustratorEntries,
  countIllustratorEntries,
  ILLUSTRATOR_CARD_FILTERS,
  type IllustratorCard,
  type IllustratorCardFilter,
  type IllustratorCollectionItem,
} from '@/lib/illustrators';

export interface IllustratorCardsBrowserProps {
  pricingEnabled?: boolean;
  illustrator: string;
  collection: readonly IllustratorCollectionItem[];
  isDesktop: boolean;
  /** The user's pricing region; prices are re-weighted for it before sorting and display. */
  pricingRegion: PricingRegion;
  /** Formats a GBP amount in the user's display currency. */
  formatAmount: (amount: number | null | undefined, price?: CardPriceSnapshot) => string | null;
  /** Open one card's own details above this view. Closing them returns here. */
  onOpenCard?: (card: IllustratorCard) => void;
  onClose: () => void;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; cards: IllustratorCard[]; fromDevice: boolean }
  | { status: 'unavailable' };

/** Every card by one illustrator, across all sets. Tapping a card opens that card's own details; nothing is edited here. */
export default function IllustratorCardsBrowser({
  pricingEnabled = true,
  illustrator,
  collection,
  isDesktop,
  pricingRegion,
  formatAmount,
  onOpenCard,
  onClose,
}: IllustratorCardsBrowserProps) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [filter, setFilter] = useState<IllustratorCardFilter>('all');
  const [textFilter, setTextFilter] = useState('');

  useEffect(() => {
    let cancelled = false;
    void loadIllustratorCards(illustrator).then((result) => {
      if (cancelled) return;
      setState(
        result.data
          ? { status: 'ready', cards: result.data.cards, fromDevice: result.source === 'device' }
          : { status: 'unavailable' },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [illustrator]);

  const cards = state.status === 'ready' ? state.cards : null;
  const allEntries = useMemo(() => buildIllustratorEntries(cards ?? [], collection), [cards, collection]);
  const counts = useMemo(() => countIllustratorEntries(allEntries), [allEntries]);
  // One batched lookup for every card (served from the on-device cache first, so it also works offline).
  const priceLookups = useMemo(
    () => (cards ?? []).map((card) => ({ cardId: card.id, language: card.language ?? 'en' })),
    [cards],
  );
  const { pricesByCardId, isLoading: isLoadingPrices } = useRegionalCardPrices(
    priceLookups,
    pricingEnabled && priceLookups.length > 0,
    pricingRegion,
  );
  const amountOf = useCallback(
    (card: IllustratorCard) =>
      getCardPickerSortAmount(
        pricesByCardId[getCardPriceKey(card.id, card.language ?? 'en')],
        inferCardFinish(card.rarity, card.variants),
        pricingRegion,
      ),
    [pricesByCardId, pricingRegion],
  );
  const shownEntries = useMemo(
    () => buildIllustratorEntries(cards ?? [], collection, { filter, text: textFilter }),
    [cards, collection, filter, textFilter],
  );
  const shownCards = useMemo(() => shownEntries.map((entry) => entry.card), [shownEntries]);
  const results = useCardResultsFilters(shownCards, amountOf);
  const entryById = useMemo(() => new Map(shownEntries.map((entry) => [entry.card.id, entry])), [shownEntries]);
  const visibleEntries = useMemo(
    () => results.visible.flatMap((card) => entryById.get(card.id) ?? []),
    [entryById, results.visible],
  );
  const isPriceSort = results.sort === 'price-desc' || results.sort === 'price-asc';
  const setCount = useMemo(() => new Set((cards ?? []).map((card) => card.set.id)).size, [cards]);

  return (
    <CardsBrowserSheet
      isDesktop={isDesktop}
      onClose={onClose}
      aria-label={`Cards illustrated by ${illustrator}`}
      phoneHeight="calc(100dvh - env(safe-area-inset-top) - var(--dock-clearance) - 0.375rem - 0.5rem)"
      header={
        <>
          <div className="flex items-center gap-3">
            <div className="from-muted to-muted/30 text-muted-foreground flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br">
              <Palette className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-muted-foreground text-[11px] font-semibold tracking-[0.18em] uppercase">Illustrator</p>
              <h2 className="truncate text-lg leading-tight font-bold">{illustrator}</h2>
              <p className="text-muted-foreground text-xs" data-testid="illustrator-summary">
                {state.status === 'loading'
                  ? 'Loading cards…'
                  : state.status === 'unavailable'
                    ? 'Card list unavailable'
                    : `${counts.all} card${counts.all === 1 ? '' : 's'} · ${setCount} set${setCount === 1 ? '' : 's'} · ${counts.owned} owned · ${counts.wanted} wanted`}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close illustrator cards"
              className="border-border/60 bg-background/70 text-muted-foreground hover:text-foreground flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2" data-no-swipe>
            <div className="flex shrink-0 flex-wrap gap-1.5" role="group" aria-label="Filter cards">
              {ILLUSTRATOR_CARD_FILTERS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={filter === option.id}
                  onClick={() => setFilter(option.id)}
                  className={`h-9 rounded-full border px-3 text-[11px] font-semibold tracking-[0.12em] uppercase transition-colors ${
                    filter === option.id
                      ? 'border-primary/35 bg-primary/12 text-primary'
                      : 'border-border/50 bg-card text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {option.label}
                  <span className="ml-1 opacity-70">{counts[option.id]}</span>
                </button>
              ))}
            </div>
            <label className="relative min-w-[8rem] flex-1">
              <span className="sr-only">Filter by card, set or number</span>
              <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2" />
              <input
                type="search"
                value={textFilter}
                onChange={(event) => setTextFilter(event.target.value)}
                data-overlay-escape="clear"
                placeholder="Card, set…"
                className="border-border/60 bg-background/70 focus:border-primary/50 h-9 w-full min-w-0 rounded-full border pr-3 pl-8 text-base outline-none md:text-sm"
              />
            </label>
            <CardResultsControls results={results} className="h-9 rounded-full" />
          </div>
          <ActiveFilterChips
            chips={results.chips}
            onClear={results.clear}
            onClearAll={results.reset}
            className="mt-2"
          />
        </>
      }
    >
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-3 pb-4">
        {isPriceSort && state.status === 'ready' && visibleEntries.length > 0 ? (
          <p className="text-muted-foreground mb-2 text-[11px]" data-testid="illustrator-price-sort-note">
            {isLoadingPrices ? 'Loading prices…' : 'Cards without a price are listed last.'}
          </p>
        ) : null}
        {state.status === 'ready' && state.fromDevice ? (
          <p className="border-border/50 bg-muted/40 text-muted-foreground mb-2 rounded-xl border px-3 py-2 text-xs">
            Offline: showing the copy saved on this device.
          </p>
        ) : null}
        {state.status === 'loading' ? (
          <div className="text-muted-foreground flex h-40 items-center justify-center text-sm">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading cards…
          </div>
        ) : state.status === 'unavailable' ? (
          <div className="text-muted-foreground flex h-40 items-center justify-center px-6 text-center text-sm">
            Could not load this illustrator&apos;s cards. Offline, only illustrators you opened before are available.
          </div>
        ) : visibleEntries.length === 0 ? (
          <div className="text-muted-foreground flex h-40 items-center justify-center px-6 text-center text-sm">
            {counts.all === 0
              ? 'No mirrored cards found for this illustrator yet.'
              : filter === 'owned'
                ? "You don't own any of these cards yet."
                : filter === 'wanted'
                  ? 'None of these cards are on your wanted list.'
                  : 'No cards match that filter.'}
          </div>
        ) : (
          <section aria-label={`Cards by ${illustrator}`}>
            <CardResultsGrid>
              {visibleEntries.map((entry) => {
                const { card } = entry;
                const price = pricesByCardId[getCardPriceKey(card.id, card.language ?? 'en')];
                return (
                  <CardResultTile
                    key={card.id}
                    data-card-id={card.id}
                    card={card}
                    price={price}
                    priceLabels={cardResultPriceLabels(price, formatAmount)}
                    pricesLoading={isLoadingPrices}
                    aria-label={`${card.name} ${entry.numberLabel} ${card.set.name}${entry.owned ? ', owned' : ''}${entry.wanted ? ', wanted' : ''}`}
                    onClick={onOpenCard && (() => onOpenCard(card))}
                  >
                    {entry.owned || entry.wanted ? (
                      <CardStandingMark standing={entry.owned ? 'owned' : 'wanted'} />
                    ) : undefined}
                  </CardResultTile>
                );
              })}
            </CardResultsGrid>
          </section>
        )}
      </div>
    </CardsBrowserSheet>
  );
}
