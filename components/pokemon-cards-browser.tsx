'use client';

import NativeWantedEntries from '@/components/native-wanted-entries';
import {
  nativeCardConsumers,
  nativeCardState,
  nativeCardLabel,
  nativeTargetPocket,
  nativeWantPocket,
  planNativeAddWant,
  planNativeRemoveWant,
  planNativeSwapIntoPocket,
  type NativeConsumerBinding,
} from '@/lib/collection/native-card-consumers';
import { toast } from '@/components/ui/toast';
import { pickerCandidate, speciesSelectorCard } from '@/lib/slot-picker';
import { browserHostCatalog } from '@/lib/collection/browser-host-catalog';
import { prepareInventoryAction } from '@/lib/inventory-actions';
import CardImage from '@/components/card-image';
import { Button } from '@/components/ui/button';
import CardImageZoom from '@/components/card-image-zoom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, Check, Heart, Loader2, Plus, Search as SearchIcon, X } from 'lucide-react';
import { matchesCatalogCardId } from '@/lib/card-catalog';
import { formatCardFinishLabel, formatCardLanguageLabel } from '@/lib/card-labels';
import { wantedCardKey } from '@/lib/collection/wanted-card-edit';
import { inferCardFinish, formatCardNumber, type SearchCardResult } from '@/lib/pokemon-card-browse';
import { getCardPickerFinishChoices } from '@/lib/card-picker-filters';
import type { QuickCardAction, QuickCardState } from '@/components/quick-card-check';
import {
  CARD_LANGUAGES,
  isCardLanguage,
  type CardFinish,
  type CardLanguage,
  type WantedCard,
} from '@/lib/domain/cards';
import { cardMatchesLanguages, DEFAULT_BINDER_CARD_LANGUAGES, parseLanguageSearch } from '@/lib/card-languages';
import CardsBrowserSheet from '@/components/cards-browser-sheet';
import { loadCardsNamed, peekCardsForPokemon, useCards, type TCGCard } from '@/hooks/use-cards';
import { getCardPriceKey, type CardPriceSnapshot } from '@/hooks/use-card-prices';
import { useRegionalCardPrices } from '@/hooks/use-regional-card-prices';
import { DEFAULT_PRICING_REGION, type PricingRegion } from '@/lib/pricing-region';
import { formatPokemonDisplayName, getOfficialArtworkUrl, formatDexNumber } from '@/lib/pokemon-catalog';
import { formatOwnedIn, type BinderRef } from '@/lib/binders/all-binders';
import { PriceRisingBadge } from '@/components/price-rising-badge';
import { CardHighlights } from '@/components/card-highlights';
import type { InventorySnapshot } from '@/lib/domain/inventory';
import { buildBrowseEntries, type BrowseCardFilter, type BrowseCollectionState } from '@/lib/pokemon-card-browse';

export interface PokemonCardsBrowserProps {
  nativeConsumer?: NativeConsumerBinding;
  pricingEnabled?: boolean;
  /** Null opens an exact non-Pokémon native cardDetails lookup, without a species query. */
  pokemon: { id: number; name: string } | null;
  /** With no Pokémon: every printing with this exact name (a Trainer or Energy), from the catalogue search. */
  cardName?: string | null;
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
  /** The pocket these details were opened from (Similar look in a pocket's details): Add and Swap put the card there. */
  pocketId?: string | null;
  /** Tapping a card opens its own details (native binders want and add from there). */
  onOpenCard?: (card: TCGCard) => void;
  formatPrice: (price: CardPriceSnapshot | undefined) => string | null;
  /** The user's pricing region; printing prices are weighted for it. */
  pricingRegion?: PricingRegion;
  /** The binder's card languages; other printings are hidden unless owned or wanted. Default English. */
  cardLanguages?: readonly CardLanguage[] | null;
}

const FILTERS: Array<{ id: BrowseCardFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'owned', label: 'Owned' },
  { id: 'wanted', label: 'Wanted' },
];

// The card as shown, so a printing the collection didn't hold yet still shows before the next read.
const shownCard = (card: SearchCardResult) => ({
  card: { ...card, language: isCardLanguage(card.language) ? card.language : undefined },
  speciesNames: [],
  pokemonIds: pickerCandidate(card).pokemonIds,
});

function thumbnailUrl(image?: string) {
  if (!image) return null;
  return image.endsWith('/high.webp') ? image.replace(/\/high\.webp$/, '/low.webp') : image;
}

export default function PokemonCardsBrowser({
  nativeConsumer,
  pricingEnabled = true,
  pokemon,
  cardName,
  collectionItem,
  ownedElsewhereByCard,
  highlightCardId,
  cardDetails,
  isDesktop,
  readOnly = false,
  onClose,
  onWantCard,
  onAddCard,
  onOpenCard,
  pocketId,
  formatPrice,
  pricingRegion = DEFAULT_PRICING_REGION,
  cardLanguages,
  // oxlint-disable-next-line react-doctor/prefer-useReducer -- independent pieces of UI state; React batches the updates and one reducer would not be clearer
}: PokemonCardsBrowserProps) {
  const binderLanguages = cardLanguages ?? DEFAULT_BINDER_CARD_LANGUAGES;
  const nativeModel = useMemo(() => (nativeConsumer ? nativeCardConsumers(nativeConsumer) : null), [nativeConsumer]);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const { fetchCardsForPokemon, error: fetchError } = useCards();
  const [cards, setCards] = useState<TCGCard[] | null>(() =>
    nativeConsumer && !pokemon && cardDetails
      ? [
          {
            ...cardDetails.card,
            language: isCardLanguage(cardDetails.card.language) ? cardDetails.card.language : undefined,
          },
        ]
      : // Already loaded (the slot previews and card selector share this cache): paint it now, not a spinner.
        pokemon
        ? peekCardsForPokemon(pokemon.id)
        : null,
  );
  const [loadError, setLoadError] = useState(false);
  const [filter, setFilter] = useState<BrowseCardFilter>('all');
  const [textFilter, setTextFilter] = useState('');
  const [languageFilter, setLanguageFilter] = useState<CardLanguage | 'all'>('all');
  const [pendingCardId, setPendingCardId] = useState<string | null>(null);
  const displayName = pokemon ? formatPokemonDisplayName(pokemon.name) : (cardName ?? cardDetails?.card.name ?? 'Card');
  const [detailFinish, setDetailFinish] = useState<CardFinish>(cardDetails?.finish ?? 'normal');
  // A native grid opens a tapped card's details in place, above the grid, instead of stacking a second sheet.
  const [focused, setFocused] = useState<SearchCardResult | null>(null);
  const detailCard = cardDetails?.card ?? focused;
  // The tile whose swap is being confirmed, and whether the card it swaps out stays in the collection.
  const [swapping, setSwapping] = useState<{ cardId: string; keep: boolean } | null>(null);
  const [keepSwapped, setKeepSwapped] = useState(true);
  const [confirmedReplacement, setConfirmedReplacement] = useState<string | null>(null);
  const detailState: QuickCardState | undefined = detailCard
    ? nativeConsumer
      ? nativeCardState(nativeModel, detailCard, detailFinish)
      : cardDetails?.getState(detailFinish)
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

  // Native wants live on a pocket: a new one goes on the open binder's pocket for this card (see nativeWantPocket).
  const nativeSnapshot =
    nativeConsumer && nativeConsumer.read.evidence.kind !== 'unavailable'
      ? nativeConsumer.read.evidence.snapshot
      : null;
  const nativeWantFor = (card: SearchCardResult, finish?: CardFinish) =>
    nativeModel?.wants.find(
      (w) =>
        w.card &&
        matchesCatalogCardId(card, w.card.canonicalId ?? w.card.id) &&
        w.card.language === card.language &&
        (finish === undefined || w.finish === finish),
    );
  const nativeWantEntry = detailCard ? nativeWantFor(detailCard, detailFinish) : undefined;
  const nativeCanWant = Boolean(
    detailCard &&
    nativeSnapshot &&
    nativeWantPocket(nativeSnapshot, nativeConsumer?.collectionId, detailCard, pocketId),
  );
  // The device queue's admission: works offline and behind queued edits, like every binder edit.
  const acquireNative = () => {
    const admission = nativeConsumer?.acquire?.();
    if (!admission || admission.read.evidence.kind === 'unavailable') throw new Error('collection-unavailable');
    return { admission, snapshot: admission.read.evidence.snapshot };
  };
  const toggleNativeWant = async (card: SearchCardResult, finish: CardFinish, entry = nativeWantFor(card, finish)) => {
    if (!nativeConsumer || pendingCardId) return;
    setPendingCardId(card.id);
    try {
      const { admission, snapshot } = acquireNative();
      const draft = entry
        ? planNativeRemoveWant(snapshot, entry.destination, admission.context())
        : planNativeAddWant(
            snapshot,
            nativeConsumer.collectionId,
            card,
            finish,
            admission.context(),
            new Date().toISOString(),
            pocketId,
          );
      if (!draft) throw new Error('no-pocket');
      await admission.receive(draft, undefined, shownCard(card));
      toast(entry ? 'Removed from your want list' : 'Added to your want list');
    } catch {
      toast('Could not update your want list. Your binder may have changed, so check it and try again.', 'error');
    } finally {
      setPendingCardId(null);
    }
  };
  /**
   * Put the card in a pocket: the one given (where its details were opened from), else its one clear pocket. Not
   * keeping the card it swaps out removes it as a further queued edit.
   */
  const placeNative = async (card: SearchCardResult, keep: boolean, slotId?: string, finish?: CardFinish) => {
    const collectionId = nativeConsumer?.collectionId;
    if (!collectionId || pendingCardId) return;
    setPendingCardId(card.id);
    setSwapping(null);
    try {
      const { admission, snapshot } = acquireNative();
      const pocket = nativeTargetPocket(snapshot, collectionId, card, slotId)?.id;
      if (!pocket) throw new Error('no-pocket');
      const plan = planNativeSwapIntoPocket(
        snapshot,
        collectionId,
        pocket,
        card,
        finish ?? inferCardFinish(card.rarity, card.variants),
        () => admission.context(),
        browserHostCatalog(admission.read.catalog),
        crypto.randomUUID(),
      );
      // In order: each draft was planned on the one before it.
      // oxlint-disable-next-line react-doctor/async-await-in-loop
      for (const draft of plan.drafts) await admission.receive(draft, plan.resolver, plan.picked);
      if (plan.swappedOut && !keep) {
        // Planned on the swap's own result: the device read may not include the swap yet.
        try {
          const removal = prepareInventoryAction(
            plan.after,
            { kind: 'removeOwned', itemId: plan.swappedOut },
            admission.context(),
            plan.resolver,
          );
          await admission.receive({ scope: plan.drafts[0].scope, intent: removal.intent });
        } catch {
          toast('Swapped. The old card could not be removed, so it is still in your collection.', 'error');
          return;
        }
      }
      toast(plan.swappedOut ? 'Swapped into your binder' : 'Added to your binder');
    } catch {
      toast('Could not update your binder. It may have changed, so check it and try again.', 'error');
    } finally {
      setPendingCardId(null);
    }
  };
  // Where the details' Add or Swap goes: the pocket they were opened from, else the card's one clear pocket.
  const detailPocket =
    detailCard && nativeSnapshot
      ? nativeTargetPocket(nativeSnapshot, nativeConsumer?.collectionId, detailCard, pocketId)
      : null;
  const detailHeld = detailPocket?.inventoryItemId
    ? nativeSnapshot?.items.find((i) => i.id === detailPocket.inventoryItemId)
    : null;
  const detailHeldThis =
    detailCard && detailHeld?.identity.kind === 'card' && matchesCatalogCardId(detailCard, detailHeld.identity.cardId);
  const focusCard = (card: SearchCardResult) => {
    setFocused(card);
    setDetailFinish(inferCardFinish(card.rarity, card.variants));
    bodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };
  // A grid of printings: a Pokémon's, or every printing of a Trainer or Energy by name.
  const isGrid = Boolean(pokemon || cardName);
  const tileOpens = Boolean((nativeConsumer && isGrid) || onOpenCard);

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

  useEffect(() => {
    if (pokemonId !== undefined || !cardName) return;
    let cancelled = false;
    void loadCardsNamed(cardName).then((named) => {
      if (cancelled) return;
      setCards(named);
      setLoadError(named.length === 0);
    });
    return () => {
      cancelled = true;
    };
  }, [cardName, pokemonId]);

  const catalogEntries = useMemo(
    () =>
      buildBrowseEntries(cards ?? [], nativeConsumer ? null : collectionItem).map((entry) =>
        nativeConsumer ? { ...entry, ...nativeCardState(nativeModel, entry.card) } : entry,
      ),
    [cards, collectionItem, nativeConsumer, nativeModel],
  );
  // The binder's languages hide catalogue noise only: owned, wanted and the card being looked at always show.
  const allEntries = useMemo(
    () =>
      catalogEntries.filter(
        (entry) =>
          entry.owned ||
          entry.wanted ||
          entry.card.id === highlightCardId ||
          cardMatchesLanguages(entry.card, binderLanguages),
      ),
    [binderLanguages, catalogEntries, highlightCardId],
  );
  const hiddenCount = catalogEntries.length - allEntries.length;
  const shownLanguages = useMemo(
    () =>
      CARD_LANGUAGES.filter(
        (language) =>
          binderLanguages.includes(language) && allEntries.some((entry) => entry.card.languages?.includes(language)),
      ),
    [allEntries, binderLanguages],
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
    const search = parseLanguageSearch(textFilter);
    const languages =
      search.languages.length > 0 ? search.languages : languageFilter === 'all' ? null : [languageFilter];
    const byLanguage = languages ? byState.filter((entry) => cardMatchesLanguages(entry.card, languages)) : byState;
    const needle = search.text.toLowerCase();
    if (!needle) return byLanguage;
    return byLanguage.filter((entry) =>
      [
        entry.card.name,
        entry.card.set.name,
        entry.card.set.id,
        entry.numberLabel,
        entry.card.rarity ?? '',
        ...entry.variantLabels,
      ].some((value) => value.toLowerCase().includes(needle)),
    );
  }, [allEntries, filter, languageFilter, textFilter]);

  const priceLookups = useMemo(
    () => allEntries.map((entry) => ({ cardId: entry.card.id, language: entry.card.language ?? 'en' })),
    [allEntries],
  );
  const { pricesByCardId } = useRegionalCardPrices(
    priceLookups,
    pricingEnabled && priceLookups.length > 0,
    pricingRegion,
  );
  const detailSnapshot = detailCard
    ? pricesByCardId[getCardPriceKey(detailCard.id, detailCard.language ?? 'en')]
    : undefined;
  const detailChoices = detailCard
    ? getCardPickerFinishChoices(
        detailCard.variants,
        inferCardFinish(detailCard.rarity, detailCard.variants),
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
  const showBreakout = filter === 'all' && languageFilter === 'all' && !textFilter.trim();

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
  // Gated on the device queue, not live editing, so tile edits work offline and queue like every binder edit.
  // Every tile gets Want, Add and Swap, the one-card lookup (Similar look, search) included.
  const nativeTileActions = Boolean(nativeConsumer?.acquire && nativeSnapshot && (isGrid || cardDetails));

  return (
    <CardsBrowserSheet
      isDesktop={isDesktop}
      onClose={onClose}
      aria-label={`All ${displayName} cards`}
      className="dark:bg-background"
      phoneHeight="calc(100dvh - max(env(safe-area-inset-top) + 0.5rem, var(--top-banner-bottom, 0px)) - var(--dock-clearance) - 0.375rem)"
      header={
        <>
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
                {isGrid ? ' cards' : ''}
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
              <span className="sr-only">Filter by set, number, variant or language (eng, jpn)</span>
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
          {shownLanguages.length > 1 && (
            <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Filter by language" data-no-swipe>
              {(['all', ...shownLanguages] as const).map((language) => (
                <button
                  key={language}
                  type="button"
                  aria-pressed={languageFilter === language}
                  onClick={() => setLanguageFilter(language)}
                  className={`h-9 rounded-full border px-3 text-xs font-semibold transition-colors ${
                    languageFilter === language
                      ? 'border-primary/35 bg-primary/12 text-primary'
                      : 'border-border/50 bg-card text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {language === 'all' ? 'All languages' : formatCardLanguageLabel(language)}
                </button>
              ))}
            </div>
          )}
        </>
      }
    >
      <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-3 pb-4">
        {detailCard && detailState && (
          <section
            aria-label="Card details"
            className="border-primary/30 bg-primary/5 mb-4 space-y-3 rounded-2xl border p-3"
          >
            <div className="flex items-start gap-3">
              {detailCard.image && (
                <CardImageZoom src={detailCard.image} alt={detailCard.name} className="w-20 shrink-0">
                  <CardImage
                    sizes="80px"
                    src={detailCard.image}
                    alt={detailCard.name}
                    className="trading-card w-20 object-contain"
                  />
                </CardImageZoom>
              )}
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-bold break-words">{detailCard.name}</h3>
                <p className="text-muted-foreground text-xs">
                  {detailCard.set.name} · {formatCardNumber(detailCard)}
                </p>
                <p className="mt-1 text-xs">
                  {formatCardLanguageLabel(detailCard.language)} · {formatCardFinishLabel(detailFinish)}
                </p>
                <p className="mt-1 text-xs font-semibold">
                  {nativeConsumer
                    ? nativeCardLabel(nativeCardState(nativeModel, detailCard, detailFinish))
                    : `${detailState.owned ? 'Owned' : 'Not owned'} · ${detailState.wanted ? 'Wanted' : 'Not wanted'}`}
                </p>
              </div>
              {focused && !cardDetails && (
                <button
                  type="button"
                  onClick={() => setFocused(null)}
                  aria-label="Close card details"
                  className="border-border/60 bg-background/70 text-muted-foreground hover:text-foreground flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            {!readOnly && nativeConsumer?.acquire && detailPocket && (
              <div className="space-y-1">
                {detailHeld && !detailHeldThis && !detailHeld.grading && (
                  <label className="flex min-h-9 items-center gap-2 text-xs font-medium">
                    <input
                      type="checkbox"
                      checked={keepSwapped}
                      onChange={(event) => setKeepSwapped(event.target.checked)}
                      className="h-4 w-4"
                    />
                    Keep old card in collection
                  </label>
                )}
                <Button
                  disabled={Boolean(pendingCardId) || Boolean(detailHeldThis)}
                  onClick={() =>
                    void placeNative(
                      detailCard,
                      Boolean(detailHeld?.grading) || keepSwapped,
                      detailPocket.id,
                      detailFinish,
                    )
                  }
                  className="min-h-11 w-full rounded-xl text-sm font-semibold"
                >
                  {detailHeldThis
                    ? 'In this pocket'
                    : detailHeld
                      ? pocketId
                        ? 'Swap into this pocket'
                        : 'Swap into its pocket'
                      : pocketId
                        ? 'Put in this pocket'
                        : 'Add to binder'}
                </Button>
              </div>
            )}
            {/* Gated on the device queue, not live editing, so wanting works offline and queues like every binder edit. */}
            {nativeConsumer?.acquire && (
              <div className="space-y-1">
                <button
                  type="button"
                  disabled={Boolean(pendingCardId) || (!nativeWantEntry && !nativeCanWant)}
                  onClick={() => void toggleNativeWant(detailCard, detailFinish, nativeWantEntry)}
                  className={`min-h-11 w-full rounded-xl border px-3 py-2 text-sm font-semibold disabled:opacity-50 ${nativeWantEntry ? 'border-destructive/30 text-destructive' : 'border-border/60'}`}
                >
                  {nativeWantEntry ? 'Remove from want list' : 'Add to want list'}
                </button>
                {!nativeWantEntry && !nativeCanWant && !detailPocket && (
                  <p className="text-muted-foreground text-xs">
                    This binder has no pocket for this card. Open a binder with one to want it.
                  </p>
                )}
              </div>
            )}
            {nativeConsumer && (
              <NativeWantedEntries
                binding={readOnly ? { ...nativeConsumer, editingAvailable: false } : nativeConsumer}
                card={detailCard}
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
                onClick={() => cardDetails?.onJumpToSlot(detailFinish)}
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
                      onClick={cardDetails?.onRemoveOwned}
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
            <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4" aria-label={`${displayName} cards`}>
              {visibleEntries.map((entry) => {
                const { card } = entry;
                const priceSnapshot = pricesByCardId[getCardPriceKey(card.id, card.language ?? 'en')];
                const price = formatPrice(priceSnapshot);
                const image = thumbnailUrl(card.image);
                const isHighlighted = card.id === highlightCardId;
                const isPending = pendingCardId === card.id;
                // Native edits need the printing with its Pokémon, like the slot picker's species cards.
                const speciesCard = pokemon
                  ? speciesSelectorCard(card, pokemon.id)
                  : cardName
                    ? ({ ...card, dexIds: [] } as SearchCardResult)
                    : // The lookup's one card, with its own Pokémon.
                      cardDetails?.card.id === card.id
                      ? cardDetails.card
                      : null;
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
                    className={`bg-background/60 relative flex min-w-0 flex-col overflow-hidden rounded-2xl border ${
                      tileOpens ? 'focus-within:border-primary/60 hover:border-primary/45 transition-colors ' : ''
                    }${
                      isHighlighted
                        ? 'border-primary/70 ring-primary/40 ring-2'
                        : entry.owned
                          ? 'border-emerald-400/45'
                          : entry.wanted
                            ? 'border-amber-400/45'
                            : 'border-border/50'
                    }`}
                  >
                    {/* One button over the whole tile, so the exact card tapped is the one that opens. */}
                    {tileOpens ? (
                      <button
                        type="button"
                        aria-label={`Open ${card.name}, ${card.set.name} ${entry.numberLabel}`}
                        onClick={() => (nativeConsumer && speciesCard ? focusCard(speciesCard) : onOpenCard?.(card))}
                        className="focus-visible:ring-primary/70 absolute inset-0 z-[1] rounded-2xl focus-visible:ring-2 focus-visible:outline-none"
                      />
                    ) : null}
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
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/90 px-2 py-0.5 text-[10px] font-bold tracking-[0.1em] text-white uppercase shadow-sm">
                            <Check className="h-3 w-3" /> Owned
                            {nativeConsumer ? ` ×${nativeCardState(nativeModel, card).ownedCount}` : ''}
                          </span>
                        ) : null}
                        {!nativeConsumer &&
                        !entry.owned &&
                        formatOwnedIn(ownedElsewhereByCard?.get(card.id) ?? [], 'In') ? (
                          <span
                            className="inline-flex max-w-full items-center gap-1 truncate rounded-full bg-sky-600/90 px-2 py-0.5 text-[10px] font-bold text-white shadow-sm"
                            data-testid="card-owned-elsewhere"
                          >
                            {formatOwnedIn(ownedElsewhereByCard?.get(card.id) ?? [], 'In')}
                          </span>
                        ) : null}
                        {entry.wanted ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/90 px-2 py-0.5 text-[10px] font-bold tracking-[0.1em] text-white uppercase shadow-sm">
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
                        <div className="relative z-[2] mt-auto grid grid-cols-2 gap-1 pt-1">
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
                      {nativeTileActions && speciesCard ? (
                        <NativeTileActions
                          card={speciesCard}
                          snapshot={nativeSnapshot!}
                          collectionId={nativeConsumer!.collectionId}
                          pocketId={pocketId}
                          wanted={Boolean(nativeWantFor(speciesCard))}
                          pending={isPending}
                          swapping={swapping?.cardId === card.id ? swapping : null}
                          onWant={() =>
                            void toggleNativeWant(
                              speciesCard,
                              inferCardFinish(card.rarity, card.variants),
                              nativeWantFor(speciesCard),
                            )
                          }
                          onPlace={(keep) => void placeNative(speciesCard, keep, pocketId ?? undefined)}
                          onSwapping={(keep) => setSwapping(keep === null ? null : { cardId: card.id, keep })}
                        />
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {cards !== null && hiddenCount > 0 && (
          <p className="text-muted-foreground mt-4 px-2 text-center text-xs">
            {hiddenCount} {hiddenCount === 1 ? 'printing' : 'printings'} in other languages hidden. Choose this binder’s
            card languages in Binders → Edit.
          </p>
        )}
      </div>
    </CardsBrowserSheet>
  );
}

/**
 * A native grid tile's quick edits: Want (on the card's pocket, see nativeWantPocket), and Add or Swap when the grid
 * was opened from a pocket or the open binder has one clear pocket for the card (see nativeTargetPocket). Swap asks first, keeping the swapped-out card by default.
 */
const tileButton = 'h-9 gap-1 rounded-xl px-2 text-[11px] font-bold';

function NativeTileActions({
  card,
  snapshot,
  collectionId,
  pocketId,
  wanted,
  pending,
  swapping,
  onWant,
  onPlace,
  onSwapping,
}: {
  card: SearchCardResult;
  snapshot: InventorySnapshot;
  collectionId: string | undefined;
  /** The pocket the grid was opened from: Add and Swap go there instead of the card's own pocket. */
  pocketId?: string | null;
  wanted: boolean;
  pending: boolean;
  swapping: { keep: boolean } | null;
  onWant: () => void;
  onPlace: (keep: boolean) => void;
  onSwapping: (keep: boolean | null) => void;
}) {
  const canWant = wanted || Boolean(nativeWantPocket(snapshot, collectionId, card, pocketId));
  const pocket = nativeTargetPocket(snapshot, collectionId, card, pocketId);
  const held = pocket?.inventoryItemId ? snapshot.items.find((i) => i.id === pocket.inventoryItemId) : null;
  const heldThis = held?.identity.kind === 'card' && matchesCatalogCardId(card, held.identity.cardId);
  // A graded copy can't be removed here, so swapping one out always keeps it.
  const heldGraded = Boolean(held?.grading);
  if (!canWant && !pocket) return null;
  if (swapping)
    return (
      <div className="relative z-[2] mt-auto space-y-1.5 pt-1" data-no-swipe>
        <label className="flex min-h-9 items-center gap-2 text-[11px] font-medium">
          <input
            type="checkbox"
            checked={heldGraded || swapping.keep}
            disabled={heldGraded}
            onChange={(event) => onSwapping(event.target.checked)}
            className="h-4 w-4"
          />
          Keep old card in collection
        </label>
        <div className="grid grid-cols-2 gap-1">
          <Button variant="outline" onClick={() => onSwapping(null)} className={tileButton}>
            Cancel
          </Button>
          <Button disabled={pending} onClick={() => onPlace(heldGraded || swapping.keep)} className={tileButton}>
            Swap
          </Button>
        </div>
      </div>
    );
  return (
    <div className="relative z-[2] mt-auto grid grid-cols-2 gap-1 pt-1">
      {canWant ? (
        <Button
          variant="outline"
          disabled={pending}
          aria-pressed={wanted}
          aria-label={`${wanted ? 'Remove from want list' : 'Want'} ${card.name} ${card.set.name} ${card.localId}`}
          onClick={onWant}
          className={`${tileButton} aria-pressed:border-primary/35 aria-pressed:bg-primary/12 aria-pressed:text-primary ${pocket ? '' : 'col-span-2'}`}
        >
          <Heart className={`size-3.5 ${wanted ? 'fill-current' : ''}`} />
          {wanted ? 'Wanted' : 'Want'}
        </Button>
      ) : null}
      {pocket ? (
        <Button
          variant="outline"
          disabled={pending || heldThis}
          aria-label={
            heldThis
              ? `${card.name} ${card.set.name} ${card.localId} is in its pocket`
              : `${held ? 'Swap' : 'Add'} ${card.name} ${card.set.name} ${card.localId} ${held ? 'into' : 'to'} its pocket`
          }
          onClick={() => (held ? onSwapping(true) : onPlace(true))}
          className={`${tileButton} border-highlight/35 bg-highlight-surface text-highlight ${canWant ? '' : 'col-span-2'}`}
        >
          {heldThis ? (
            <Check className="size-3.5" />
          ) : held ? (
            <ArrowLeftRight className="size-3.5" />
          ) : (
            <Plus className="size-3.5" />
          )}
          {heldThis ? 'In binder' : held ? 'Swap' : 'Add'}
        </Button>
      ) : null}
    </div>
  );
}
