'use client';

import NativeWantedEntries from '@/components/native-wanted-entries';
import {
  nativeCardConsumers,
  nativeCardState,
  nativeCardLabel,
  type NativeConsumerBinding,
} from '@/lib/collection/native-card-consumers';
import CardImage from '@/components/card-image';
import CardImageZoom from '@/components/card-image-zoom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Heart, Loader2, Plus, Search as SearchIcon, X } from 'lucide-react';
import { matchesCatalogCardId } from '@/lib/card-catalog';
import { formatCardFinishLabel, formatCardLanguageLabel } from '@/lib/card-labels';
import { wantedCardKey } from '@/lib/collection/wanted-card-edit';
import { inferCardFinish, formatCardNumber, type SearchCardResult } from '@/lib/pokemon-card-browse';
import { getCardPickerFinishChoices } from '@/lib/card-picker-filters';
import type { QuickCardAction, QuickCardState } from '@/components/quick-card-check';
import { isCardLanguage, type CardFinish, type WantedCard } from '@/lib/domain/cards';
import { useOverlay, useSwipeToDismiss } from '@/hooks/use-overlay';
import { useTCGdex, type TCGCard } from '@/hooks/use-tcgdex';
import { getCardPriceKey, type CardPriceSnapshot } from '@/hooks/use-card-prices';
import { useRegionalCardPrices } from '@/hooks/use-regional-card-prices';
import { DEFAULT_PRICING_REGION, type PricingRegion } from '@/lib/pricing-region';
import { formatPokemonDisplayName, getOfficialArtworkUrl, formatDexNumber } from '@/lib/pokemon-catalog';
import { formatOwnedIn, type BinderRef } from '@/lib/binders/all-binders';
import { PriceRisingBadge } from '@/components/price-rising-badge';
import { CardHighlights } from '@/components/card-highlights';
import { buildBrowseEntries, type BrowseCardFilter, type BrowseCollectionState } from '@/lib/pokemon-card-browse';

export interface PokemonCardsBrowserProps {
  nativeConsumer?: NativeConsumerBinding;
  pricingEnabled?: boolean;
  /** Null opens an exact non-Pokémon native cardDetails lookup, without a species query. */
  pokemon: { id: number; name: string } | null;
  collectionItem?: (Omit<BrowseCollectionState, 'wanted_cards'> & { wanted_cards?: WantedCard[] }) | null;
  /** Printings other binders hold, by card id ("In <binder>" badge). */
  ownedElsewhereByCard?: ReadonlyMap<string, readonly BinderRef[]>;
  /** Card to scroll to and highlight (e.g. the hit picked in global search). */
  highlightCardId?: string | null;
  cardDetails?: {
    card: SearchCardResult;
    finish: CardFinish;
    getState: (finish: CardFinish) => QuickCardState;
    onAction: (action: QuickCardAction, finish: CardFinish) => Promise<void>;
    onRemoveOwned: () => void;
    onJumpToSlot: (finish: CardFinish) => void;
  };
  isDesktop: boolean;
  readOnly?: boolean;
  onClose: () => void;
  /** Optional secondary actions; the view itself never enters the edit flow. */
  onWantCard?: (card: TCGCard, isWanted: boolean, wanted?: WantedCard) => void | Promise<void>;
  onAddCard?: (card: TCGCard) => void | Promise<void>;
  formatPrice: (price: CardPriceSnapshot | undefined) => string | null;
  /** The user's pricing region; printing prices are weighted for it. */
  pricingRegion?: PricingRegion;
}

const FILTERS: Array<{ id: BrowseCardFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'owned', label: 'Owned' },
  { id: 'wanted', label: 'Wanted' },
];

function thumbnailUrl(image?: string) {
  if (!image) return null;
  return image.endsWith('/high.webp') ? image.replace(/\/high\.webp$/, '/low.webp') : image;
}

export default function PokemonCardsBrowser({
  nativeConsumer,
  pricingEnabled = true,
  pokemon,
  collectionItem,
  ownedElsewhereByCard,
  highlightCardId,
  cardDetails,
  isDesktop,
  readOnly = false,
  onClose,
  onWantCard,
  onAddCard,
  formatPrice,
  pricingRegion = DEFAULT_PRICING_REGION,
}: PokemonCardsBrowserProps) {
  const nativeModel = useMemo(() => (nativeConsumer ? nativeCardConsumers(nativeConsumer) : null), [nativeConsumer]);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const { fetchCardsForPokemon, error: fetchError } = useTCGdex();
  const [cards, setCards] = useState<TCGCard[] | null>(() =>
    nativeConsumer && !pokemon && cardDetails
      ? [
          {
            ...cardDetails.card,
            language: isCardLanguage(cardDetails.card.language) ? cardDetails.card.language : undefined,
          },
        ]
      : null,
  );
  const [loadError, setLoadError] = useState(false);
  const [filter, setFilter] = useState<BrowseCardFilter>('all');
  const [textFilter, setTextFilter] = useState('');
  const [pendingCardId, setPendingCardId] = useState<string | null>(null);
  const displayName = pokemon ? formatPokemonDisplayName(pokemon.name) : (cardDetails?.card.name ?? 'Card');
  const [detailFinish, setDetailFinish] = useState<CardFinish>(cardDetails?.finish ?? 'normal');
  const [confirmedReplacement, setConfirmedReplacement] = useState<string | null>(null);
  const detailState: QuickCardState | undefined = cardDetails
    ? nativeConsumer
      ? nativeCardState(nativeModel, cardDetails.card, detailFinish)
      : cardDetails.getState(detailFinish)
    : undefined;
  const replacementKey = detailState?.replacing ? `${detailFinish}:${detailState.replacing}` : null;
  const runDetailAction = async (action: QuickCardAction) => {
    if (!cardDetails || pendingCardId || readOnly || nativeConsumer) return;
    setPendingCardId(cardDetails.card.id);
    try {
      await cardDetails.onAction(action, detailFinish);
    } finally {
      setPendingCardId(null);
    }
  };

  useOverlay(true, onClose, { containerRef: dialogRef });
  const swipe = useSwipeToDismiss(dialogRef, onClose, !isDesktop);

  const pokemonId = pokemon?.id;
  useEffect(() => {
    if (pokemonId === undefined) return;
    let cancelled = false;
    void fetchCardsForPokemon(pokemonId).then((result) => {
      if (cancelled) return;
      setCards(result);
      setLoadError(result.length === 0);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchCardsForPokemon, pokemonId]);

  const allEntries = useMemo(
    () =>
      buildBrowseEntries(cards ?? [], nativeConsumer ? null : collectionItem).map((entry) =>
        nativeConsumer ? { ...entry, ...nativeCardState(nativeModel, entry.card) } : entry,
      ),
    [cards, collectionItem, nativeConsumer, nativeModel],
  );
  const counts = useMemo(
    () => ({
      all: allEntries.length,
      owned: nativeModel
        ? nativeModel.copies.filter(
            (copy) =>
              copy.card &&
              allEntries.some(
                (e) =>
                  matchesCatalogCardId(e.card, copy.card!.canonicalId ?? copy.card!.id) &&
                  e.card.language === copy.card!.language,
              ),
          ).length
        : allEntries.filter((entry) => entry.owned).length,
      wanted: allEntries.filter((entry) => entry.wanted && !entry.owned).length,
    }),
    [allEntries, nativeModel],
  );
  const visibleEntries = useMemo(() => {
    const byState = allEntries.filter(
      (entry) => filter === 'all' || (filter === 'owned' ? entry.owned : entry.wanted && !entry.owned),
    );
    const needle = textFilter.trim().toLowerCase();
    if (!needle) return byState;
    return byState.filter((entry) =>
      [
        entry.card.name,
        entry.card.set.name,
        entry.card.set.id,
        entry.numberLabel,
        entry.card.rarity ?? '',
        ...entry.variantLabels,
      ].some((value) => value.toLowerCase().includes(needle)),
    );
  }, [allEntries, filter, textFilter]);

  const priceLookups = useMemo(
    () => allEntries.map((entry) => ({ cardId: entry.card.id, language: entry.card.language ?? 'en' })),
    [allEntries],
  );
  const { pricesByCardId } = useRegionalCardPrices(
    priceLookups,
    pricingEnabled && priceLookups.length > 0,
    pricingRegion,
  );
  const detailSnapshot = cardDetails
    ? pricesByCardId[getCardPriceKey(cardDetails.card.id, cardDetails.card.language ?? 'en')]
    : undefined;
  const detailChoices = cardDetails
    ? getCardPickerFinishChoices(
        cardDetails.card.variants,
        inferCardFinish(cardDetails.card.rarity, cardDetails.card.variants),
        'any',
        detailSnapshot?.finishPrices,
      )
    : [];
  const highlightCards = useMemo(
    () =>
      allEntries.map((entry) => ({
        id: entry.card.id,
        language: entry.card.language,
        name: entry.card.name,
        numberLabel: entry.numberLabel,
        setName: entry.card.set.name,
        image: entry.card.image,
        rarity: entry.card.rarity,
      })),
    [allEntries],
  );
  const showBreakout = filter === 'all' && !textFilter.trim();

  const scrollToCard = useCallback((cardId: string) => {
    const target = bodyRef.current?.querySelector<HTMLElement>(`li[data-card-id="${CSS.escape(cardId)}"]`);
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, []);

  useEffect(() => {
    if (!highlightCardId || !cards || cardDetails) return;
    const frame = window.requestAnimationFrame(() => {
      const target = bodyRef.current?.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(highlightCardId)}"]`);
      target?.scrollIntoView({ block: 'center' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [cards, highlightCardId, cardDetails]);

  const runAction = useCallback(async (cardId: string, action: () => void | Promise<void>) => {
    setPendingCardId(cardId);
    try {
      await action();
    } finally {
      setPendingCardId(null);
    }
  }, []);

  const showActions = !readOnly && Boolean(onWantCard || onAddCard);

  const content = (
    <>
      <div data-overlay-backdrop aria-hidden="true" className="fixed inset-0 z-[43] bg-black/55" onClick={onClose} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`All ${displayName} cards`}
        className="border-border/70 bg-card dark:border-border/50 dark:bg-background fixed z-[44] flex flex-col overflow-hidden rounded-[1.6rem] border shadow-[0_28px_80px_-30px_rgba(15,23,42,0.6)] outline-none"
        style={
          isDesktop
            ? {
                left: '50%',
                top: '50%',
                transform: 'translate(-50%, -50%)',
                width: 'min(calc(100vw - 2rem), 52rem)',
                maxHeight: 'min(85vh, 56rem)',
              }
            : {
                left: '0.5rem',
                right: '0.5rem',
                // Sits above the bottom dock (which stays usable) and never under the status bar.
                bottom: 'calc(var(--dock-clearance) + 0.375rem)',
                height:
                  'calc(100dvh - max(env(safe-area-inset-top) + 0.5rem, var(--top-banner-bottom, 0px)) - var(--dock-clearance) - 0.375rem)',
              }
        }
      >
        <div
          data-sheet-grabber
          className="border-border/50 shrink-0 border-b px-4 pt-2 pb-3"
          {...(isDesktop ? {} : swipe)}
        >
          {!isDesktop ? (
            <div className="bg-muted-foreground/30 mx-auto mb-2 h-1.5 w-10 rounded-full" aria-hidden="true" />
          ) : null}
          <div className="flex items-center gap-3">
            {pokemon && (
              <div className="from-muted to-muted/30 flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={getOfficialArtworkUrl(pokemon.id)} alt="" className="h-full w-full object-contain p-1" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              {pokemon && (
                <p className="text-muted-foreground text-[11px] font-semibold tracking-[0.18em] uppercase">
                  {formatDexNumber(pokemon.id)}
                </p>
              )}
              <h2 className="truncate text-lg leading-tight font-bold">
                {displayName}
                {pokemon ? ' cards' : ''}
              </h2>
              <p className="text-muted-foreground text-xs">
                {nativeConsumer && !nativeModel
                  ? 'Storage evidence unavailable'
                  : cards === null
                    ? 'Loading cards…'
                    : fetchError
                      ? 'Card catalogue unavailable'
                      : `${counts.all} card${counts.all === 1 ? '' : 's'} · ${counts.owned} owned${nativeConsumer ? ' copies' : ''} · ${counts.wanted} wanted`}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close all cards"
              className="border-border/60 bg-background/70 text-muted-foreground hover:text-foreground flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2" data-no-swipe>
            <div className="flex shrink-0 gap-1.5" role="group" aria-label="Filter cards">
              {FILTERS.map((option) => (
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
            <label className="relative min-w-[10rem] flex-1">
              <span className="sr-only">Filter by set, number or variant</span>
              <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2" />
              <input
                type="search"
                value={textFilter}
                onChange={(event) => setTextFilter(event.target.value)}
                data-overlay-escape="clear"
                placeholder="Set, number…"
                className="border-border/60 bg-background/70 focus:border-primary/50 h-9 w-full min-w-0 rounded-full border pr-3 pl-8 text-base outline-none md:text-sm"
              />
            </label>
          </div>
        </div>

        <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-3 pb-4">
          {cardDetails && detailState && (
            <section
              aria-label="Card details"
              className="border-primary/30 bg-primary/5 mb-4 space-y-3 rounded-2xl border p-3"
            >
              <div className="flex items-start gap-3">
                {cardDetails.card.image && (
                  <CardImageZoom src={cardDetails.card.image} alt={cardDetails.card.name} className="w-20 shrink-0">
                    <CardImage
                      sizes="80px"
                      src={cardDetails.card.image}
                      alt={cardDetails.card.name}
                      className="trading-card w-20 object-contain"
                    />
                  </CardImageZoom>
                )}
                <div className="min-w-0">
                  <h3 className="text-base font-bold break-words">{cardDetails.card.name}</h3>
                  <p className="text-muted-foreground text-xs">
                    {cardDetails.card.set.name} · {formatCardNumber(cardDetails.card)}
                  </p>
                  <p className="mt-1 text-xs">
                    {formatCardLanguageLabel(cardDetails.card.language)} · {formatCardFinishLabel(detailFinish)}
                  </p>
                  <p className="mt-1 text-xs font-semibold">
                    {nativeConsumer
                      ? nativeCardLabel(nativeCardState(nativeModel, cardDetails.card, detailFinish))
                      : `${detailState.owned ? 'Owned' : 'Not owned'} · ${detailState.wanted ? 'Wanted' : 'Not wanted'}`}
                  </p>
                </div>
              </div>
              {nativeConsumer && (
                <NativeWantedEntries
                  binding={readOnly ? { ...nativeConsumer, editingAvailable: false } : nativeConsumer}
                  card={cardDetails.card}
                  finish={detailFinish}
                />
              )}
              {detailChoices.length > 1 && (
                <div role="group" aria-label="Card detail variant" className="flex flex-wrap gap-2">
                  {detailChoices.map((choice) => (
                    <button
                      key={choice.finish}
                      type="button"
                      aria-pressed={detailFinish === choice.finish}
                      onClick={() => setDetailFinish(choice.finish)}
                      className="border-border/60 aria-pressed:bg-primary aria-pressed:text-primary-foreground min-h-9 rounded-xl border px-3 text-xs font-semibold"
                    >
                      {choice.label}
                    </button>
                  ))}
                </div>
              )}
              {!nativeConsumer && (
                <button
                  type="button"
                  onClick={() => cardDetails.onJumpToSlot(detailFinish)}
                  className="border-primary/30 min-h-11 w-full rounded-xl border px-3 py-2 text-sm font-semibold"
                >
                  Jump to binder slot
                </button>
              )}
              {!readOnly && !nativeConsumer && (
                <>
                  {detailState.replacing && (
                    <label className="flex min-h-11 items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={replacementKey === confirmedReplacement}
                        onChange={(event) => setConfirmedReplacement(event.target.checked ? replacementKey : null)}
                      />
                      <span>Replace {detailState.replacing} in this binder</span>
                    </label>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    {detailState.owned ? (
                      <button
                        type="button"
                        disabled={Boolean(pendingCardId)}
                        onClick={cardDetails.onRemoveOwned}
                        className="border-destructive/30 text-destructive min-h-11 rounded-xl border px-2 py-2 text-sm font-semibold"
                      >
                        Remove owned card
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={
                          Boolean(pendingCardId) || Boolean(replacementKey && replacementKey !== confirmedReplacement)
                        }
                        onClick={() => void runDetailAction('add-owned')}
                        className="bg-primary text-primary-foreground min-h-11 rounded-xl px-2 py-2 text-sm font-semibold disabled:opacity-50"
                      >
                        Add to owned
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={Boolean(pendingCardId)}
                      onClick={() => void runDetailAction(detailState.wanted ? 'remove-wanted' : 'want')}
                      className={`min-h-11 rounded-xl border px-2 py-2 text-sm font-semibold ${detailState.wanted ? 'border-destructive/30 text-destructive' : 'border-border/60'}`}
                    >
                      {detailState.wanted ? 'Remove from want list' : 'Add to want list'}
                    </button>
                  </div>
                </>
              )}
            </section>
          )}

          {cards === null ? (
            <div className="text-muted-foreground flex h-40 items-center justify-center text-sm">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading cards…
            </div>
          ) : visibleEntries.length === 0 ? (
            <div className="text-muted-foreground flex h-40 items-center justify-center px-6 text-center text-sm">
              {loadError
                ? fetchError
                  ? 'Could not load cards. Offline, only previously opened Pokémon card lists are available.'
                  : 'No mirrored cards found for this Pokémon yet.'
                : filter === 'owned'
                  ? "You don't own any of these cards yet."
                  : filter === 'wanted'
                    ? 'No wanted cards yet.'
                    : 'No cards match that filter.'}
            </div>
          ) : (
            <>
              {showBreakout ? (
                <CardHighlights
                  name={displayName}
                  cards={highlightCards}
                  prices={pricesByCardId}
                  formatPrice={formatPrice}
                  onSelectCard={scrollToCard}
                />
              ) : null}
              <ul
                className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4"
                aria-label={`${displayName} cards`}
              >
                {visibleEntries.map((entry) => {
                  const { card } = entry;
                  const priceSnapshot = pricesByCardId[getCardPriceKey(card.id, card.language ?? 'en')];
                  const price = formatPrice(priceSnapshot);
                  const image = thumbnailUrl(card.image);
                  const isHighlighted = card.id === highlightCardId;
                  const isPending = pendingCardId === card.id;
                  const wantedPrintings =
                    collectionItem?.wanted_cards?.filter(
                      (wanted) =>
                        matchesCatalogCardId(card, wanted.card_id) &&
                        (wanted.card_language ?? 'en') === (card.language ?? 'en'),
                    ) ?? [];
                  return (
                    <li
                      key={card.id}
                      data-card-id={card.id}
                      aria-label={`${card.name} ${entry.numberLabel} ${card.set.name}${nativeConsumer ? `, ${nativeCardLabel(nativeCardState(nativeModel, card))}` : ''}${entry.owned ? ', owned' : ''}${entry.wanted ? ', wanted' : ''}`}
                      className={`bg-background/60 flex min-w-0 flex-col overflow-hidden rounded-2xl border ${
                        isHighlighted
                          ? 'border-primary/70 ring-primary/40 ring-2'
                          : entry.owned
                            ? 'border-emerald-400/45'
                            : entry.wanted
                              ? 'border-amber-400/45'
                              : 'border-border/50'
                      }`}
                    >
                      <div className="trading-card bg-muted/40 relative w-full">
                        {image ? (
                          <CardImage
                            sizes="(max-width: 639px) 45vw, 180px"
                            src={image}
                            alt={`${card.name} – ${card.set.name} ${entry.numberLabel}`}
                            loading="lazy"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="text-muted-foreground flex h-full items-center justify-center p-2 text-center text-[11px]">
                            No image
                          </div>
                        )}
                        <div className="absolute top-1.5 left-1.5 flex flex-col gap-1">
                          {entry.owned ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/90 px-2 py-0.5 text-[10px] font-bold tracking-[0.1em] text-white uppercase shadow">
                              <Check className="h-3 w-3" /> Owned
                              {nativeConsumer ? ` ×${nativeCardState(nativeModel, card).ownedCount}` : ''}
                            </span>
                          ) : null}
                          {!nativeConsumer &&
                          !entry.owned &&
                          formatOwnedIn(ownedElsewhereByCard?.get(card.id) ?? [], 'In') ? (
                            <span
                              className="inline-flex max-w-full items-center gap-1 truncate rounded-full bg-sky-600/90 px-2 py-0.5 text-[10px] font-bold text-white shadow"
                              data-testid="card-owned-elsewhere"
                            >
                              {formatOwnedIn(ownedElsewhereByCard?.get(card.id) ?? [], 'In')}
                            </span>
                          ) : null}
                          {entry.wanted ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/90 px-2 py-0.5 text-[10px] font-bold tracking-[0.1em] text-white uppercase shadow">
                              <Heart className="h-3 w-3 fill-current" /> Wanted
                              {nativeConsumer ? ` ×${nativeCardState(nativeModel, card).wantedCount}` : ''}
                            </span>
                          ) : null}
                        </div>
                        <PriceRisingBadge price={priceSnapshot} className="absolute top-1.5 right-1.5" />
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col gap-1 p-2">
                        <p className="truncate text-xs font-semibold" title={card.set.name}>
                          {card.set.name}
                        </p>
                        <div className="text-muted-foreground flex items-center justify-between gap-1 text-[11px]">
                          <span className="tabular-nums">{entry.numberLabel}</span>
                          {price ? (
                            <span className="text-foreground truncate font-semibold">{price.split(' (')[0]}</span>
                          ) : null}
                        </div>
                        {entry.variantLabels.length > 0 || card.rarity ? (
                          <p className="text-muted-foreground truncate text-[10px]">
                            {[card.rarity, ...entry.variantLabels].filter(Boolean).join(' · ')}
                          </p>
                        ) : null}
                        {showActions && !nativeConsumer ? (
                          <div className="mt-auto grid grid-cols-2 gap-1 pt-1">
                            {onWantCard && wantedPrintings.length > 0 ? (
                              wantedPrintings.map((wanted) => (
                                <button
                                  key={wantedCardKey(wanted)}
                                  type="button"
                                  disabled={isPending}
                                  aria-label={`Remove from want list: ${card.name} ${entry.numberLabel}, ${formatCardLanguageLabel(wanted.card_language)}, ${formatCardFinishLabel(wanted.card_finish)}`}
                                  onClick={() => void runAction(card.id, () => onWantCard(card, true, wanted))}
                                  className="col-span-2 min-h-9 rounded-xl border border-amber-400/50 px-2 py-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300"
                                >
                                  Remove wanted · {formatCardFinishLabel(wanted.card_finish)}
                                </button>
                              ))
                            ) : onWantCard ? (
                              <button
                                type="button"
                                disabled={isPending}
                                aria-pressed={false}
                                aria-label={`Want ${card.name} ${entry.numberLabel}`}
                                onClick={() => void runAction(card.id, () => onWantCard(card, false))}
                                className={`flex h-9 items-center justify-center gap-1 rounded-xl border text-[11px] font-bold disabled:opacity-50 ${
                                  entry.wanted
                                    ? 'border-amber-400/50 bg-amber-500/15 text-amber-600 dark:text-amber-300'
                                    : 'border-border/55 bg-muted/40 text-muted-foreground hover:text-foreground'
                                }`}
                              >
                                <Heart className={`h-3.5 w-3.5 ${entry.wanted ? 'fill-current' : ''}`} />
                                Want
                              </button>
                            ) : null}
                            {onAddCard ? (
                              <button
                                type="button"
                                disabled={isPending || entry.owned}
                                aria-label={
                                  entry.owned
                                    ? `${card.name} ${entry.numberLabel} is in your binder`
                                    : `Add ${card.name} ${entry.numberLabel} to binder`
                                }
                                onClick={() => void runAction(card.id, () => onAddCard(card))}
                                className="flex h-9 items-center justify-center gap-1 rounded-xl border border-emerald-400/35 bg-emerald-500/10 text-[11px] font-bold text-emerald-600 disabled:opacity-50 dark:text-emerald-300"
                              >
                                {entry.owned ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                                {entry.owned ? 'Owned' : 'Add'}
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      </div>
    </>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(content, document.body);
}
