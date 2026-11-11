'use client';

import { ActivityButton } from '@/components/collection-activity-context';

import {
  CARD_FINISH_OPTIONS,
  formatCollectedDate,
  getDetailArtwork,
  getWantedCardKey,
} from '@/components/binder/binder-app-model';
import type { CardPriceCheck } from '@/lib/card-price-checks';
import { CardPriceComparison } from '@/components/card-price-comparison';
import { CardPriceEvidence } from '@/components/card-price-evidence';
import { Button } from '@/components/ui/button';
import { getCardPriceKey } from '@/hooks/use-card-prices';
import { toCardImageSrc } from '@/lib/card-image-url';
import { formatCardFinishLabel, formatCardLanguageLabel } from '@/lib/card-labels';
import { toCacheableCardImageUrl } from '@/lib/offline-cache-warmup';
import { formatDexNumber } from '@/lib/pokemon-catalog';
import { Camera, Check, ChevronDown, ChevronLeft, ChevronRight, Heart, Layers3, Palette, Star, X } from 'lucide-react';
import CardImage from '@/components/card-image';
import CardImageZoom from '@/components/card-image-zoom';
import { createPortal } from 'react-dom';
import type { CardPriceSnapshot as PricingCardPriceSnapshot, PricedCardFinish } from '@/lib/card-pricing';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import type { QuickPanelPosition } from '@/components/binder/binder-app-model';
import type { RegionalCardPriceSnapshot } from '@/lib/regional-price';
import type { CardPriceSnapshot, SupportedCurrency } from '@/hooks/use-card-prices';
import type { CollectedPokemon, WantedCard } from '@/lib/domain/cards';
import type { BinderCardDisplay, SelectedSlotDisplayCard } from '@/lib/selected-slot-card-display';
import type { PokemonEntry, PokemonSummary } from '@/lib/pokemon-catalog';

export interface SelectedPokemonQuickPanelContext {
  selectedComparisonMarketGbp: number | null;
  selectedUsesSoldGuide: boolean;
  onSelectedSoldCheck: (check: CardPriceCheck) => void;
  activeJumpPokemonList: PokemonEntry[];
  binderCardDisplay: BinderCardDisplay;
  closeSelectedPokemon: () => void;
  collected: boolean;
  collectionItem: CollectedPokemon | null | undefined;
  handleJumpToNextNeeded: () => void;
  handleJumpToPreviousNeeded: () => void;
  handleOpenCardSelector: () => void;
  handleOpenSelectedSlotScanner: () => void;
  handleOpenWishlistSelector: () => void;
  handleQuickCollectSelectedPokemon: () => Promise<void>;
  handleChangeWantedCard: (card: WantedCard) => void;
  handleClearWantedCard: (pokemonId: number, card: WantedCard) => Promise<void>;
  handleSelectedCardFinishChange: (
    finish:
      | 'normal'
      | 'holo'
      | 'reverse_holo'
      | 'double_rare'
      | 'ultra_rare'
      | 'illustration_rare'
      | 'special_illustration_rare'
      | 'secret_rare'
      | 'hyper_rare'
      | 'radiant_rare'
      | 'ace_spec'
      | 'amazing_rare'
      | 'shiny_rare'
      | 'jumbo',
  ) => Promise<void>;
  handleToggleFavoriteSelectedPokemon: () => Promise<void>;
  isDesktopViewport: boolean;
  pricingEnabled: boolean;
  isLoadingPrices: boolean;
  isMobileQuickPanel: boolean;
  isQuickPanelCovered: boolean;
  isSearchOpen: boolean;
  openCardBrowser: (
    pokemon: { id: number; name: string },
    options?: { highlightCardId?: string | null | undefined; fromDetail?: boolean | undefined },
  ) => void;
  openIllustratorBrowser: (name: string, options?: { fromDetail?: boolean | undefined }) => void;
  priceFormat: {
    label: (price: CardPriceSnapshot | undefined) => string | null;
    amount: (amount: number | null | undefined, price?: CardPriceSnapshot | undefined) => string | null;
    range: (
      low: number | null | undefined,
      high: number | null | undefined,
      price?: CardPriceSnapshot | undefined,
    ) => string | null;
    totals: (gbpTotal: number, originalTotals: Partial<Record<SupportedCurrency, number>>) => string;
  };
  pricesByCardId: Record<string, RegionalCardPriceSnapshot<CardPriceSnapshot>>;
  quickPanelPosition: QuickPanelPosition | null;
  quickPanelRef: RefObject<HTMLDivElement | null>;
  quickPanelSwipe: {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
    style: { touchAction: 'none' };
  };
  readOnlyMode: boolean;
  requestOwnedRemoval: (pokemon: { id: number; name: string }) => void;
  selectedAssignedPriceChipLabel: string | null;
  selectedCollectedDateLabel: string | null;
  selectedConfidenceLabel: string | null;
  selectedCurrentCardPreview: SelectedSlotDisplayCard | null;
  selectedDetailPriceLabel: string | null;
  selectedDetailPriceSnapshot: RegionalCardPriceSnapshot<CardPriceSnapshot> | undefined;
  selectedFinishPrices: Partial<Record<PricedCardFinish, RegionalCardPriceSnapshot<PricingCardPriceSnapshot>>>;
  selectedGoodPriceLabel: string | null;
  selectedHasWantedCard: boolean;
  selectedIllustratorArrivedLate: boolean;
  selectedIllustratorLookupKey: string | null;
  selectedIllustratorName: string | null;
  selectedIllustratorState: string | null;
  selectedMarketPriceLabel: string | null;
  selectedPokemon: PokemonSummary | null;
  selectedPokemonDisplayFit: 'object-contain';
  selectedPokemonDisplayImage: string | null;
  selectedPokemonDisplayName: string;
  selectedPokemonDisplayTone: '' | 'grayscale saturate-[0.8] brightness-[0.92]';
  selectedPokemonHasAssignedCard: boolean;
  selectedPokemonIsFavorite: boolean;
  selectedPriceSourceLabel: string | null;
  selectedPrimaryCardPreview: SelectedSlotDisplayCard | null;
  selectedRangePriceLabel: string | null;
  selectedWantedCardPreview: WantedCard;
  selectedWantedCards: WantedCard[];
}

export function renderSelectedPokemonQuickPanelView(ctx: SelectedPokemonQuickPanelContext) {
  const {
    selectedComparisonMarketGbp,
    selectedUsesSoldGuide,
    onSelectedSoldCheck,
    activeJumpPokemonList,
    binderCardDisplay,
    closeSelectedPokemon,
    collected,
    collectionItem,
    handleJumpToNextNeeded,
    handleJumpToPreviousNeeded,
    handleOpenCardSelector,
    handleOpenSelectedSlotScanner,
    handleOpenWishlistSelector,
    handleQuickCollectSelectedPokemon,
    handleChangeWantedCard,
    handleClearWantedCard,
    handleSelectedCardFinishChange,
    handleToggleFavoriteSelectedPokemon,
    isDesktopViewport,
    isLoadingPrices,
    isMobileQuickPanel,
    isQuickPanelCovered,
    isSearchOpen,
    openCardBrowser,
    openIllustratorBrowser,
    priceFormat,
    pricesByCardId,
    quickPanelPosition,
    quickPanelRef,
    quickPanelSwipe,
    readOnlyMode,
    requestOwnedRemoval,
    selectedAssignedPriceChipLabel,
    selectedCollectedDateLabel,
    selectedConfidenceLabel,
    selectedCurrentCardPreview,
    selectedDetailPriceLabel,
    selectedDetailPriceSnapshot,
    selectedFinishPrices,
    selectedGoodPriceLabel,
    selectedHasWantedCard,
    selectedIllustratorArrivedLate,
    selectedIllustratorLookupKey,
    selectedIllustratorName,
    selectedIllustratorState,
    selectedMarketPriceLabel,
    selectedPokemon,
    selectedPokemonDisplayFit,
    selectedPokemonDisplayImage,
    selectedPokemonDisplayName,
    selectedPokemonDisplayTone,
    selectedPokemonHasAssignedCard,
    selectedPokemonIsFavorite,
    selectedPriceSourceLabel,
    selectedPrimaryCardPreview,
    selectedRangePriceLabel,
    selectedWantedCardPreview,
    selectedWantedCards,
  } = ctx;
  if (!selectedPokemon || isSearchOpen || typeof document === 'undefined') {
    return null;
  }

  const selectedStatusPill = selectedHasWantedCard
    ? { label: 'Wanted', className: 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400' }
    : binderCardDisplay !== 'wanted' && selectedPokemonIsFavorite
      ? { label: 'Perfect', className: 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400' }
      : binderCardDisplay !== 'wanted' && collected
        ? {
            label: 'Owned',
            className: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
          }
        : { label: 'Open Slot', className: 'border-border/60 bg-background/35 text-muted-foreground' };

  const selectedCardSummaryLabel =
    selectedHasWantedCard && selectedPrimaryCardPreview?.cardName
      ? `Wanted card: ${selectedPrimaryCardPreview.cardName}`
      : selectedPrimaryCardPreview?.cardName
        ? selectedPrimaryCardPreview.cardName.toLowerCase() === selectedPokemon.name.toLowerCase()
          ? selectedPokemonHasAssignedCard
            ? 'Assigned card selected'
            : 'Tracked card selected'
          : selectedPrimaryCardPreview.cardName
        : binderCardDisplay === 'wanted'
          ? 'No wanted card selected'
          : collected
            ? 'No card assigned yet'
            : 'Choose how you want to track this slot.';
  const selectedPreviewImage =
    toCardImageSrc(selectedPrimaryCardPreview?.cardImage) ??
    selectedPokemonDisplayImage ??
    getDetailArtwork(selectedPokemon);
  const selectedPreviewAlt = selectedPrimaryCardPreview?.cardName ?? selectedPokemonDisplayName;
  const selectedPreviewIsCard = Boolean(selectedPrimaryCardPreview?.cardImage);
  const selectedPreviewTone = selectedPreviewIsCard ? '' : selectedPokemonDisplayTone;
  const selectedPreviewFit = selectedPreviewIsCard ? 'object-cover' : selectedPokemonDisplayFit;
  const selectedPreviewFrameClass = selectedPreviewIsCard
    ? 'trading-card w-[4.6rem] sm:w-[3.35rem]'
    : 'h-20 w-20 rounded-2xl sm:h-14 sm:w-14';
  const selectedPreviewImageClass = selectedPreviewIsCard
    ? 'absolute inset-0 h-full w-full'
    : 'absolute inset-1 max-w-[calc(100%-0.5rem)] max-h-[calc(100%-0.5rem)] m-auto';
  const selectedPreviewBadgeClass = selectedPreviewIsCard ? '-top-1.5 -right-1.5' : '-top-1 -right-1';
  const selectedPrimarySetLabel = selectedPrimaryCardPreview?.cardSet;
  const selectedPrimaryLanguageLabel = selectedPrimaryCardPreview?.cardLanguage;
  const selectedPrimaryFinishLabel = selectedPrimaryCardPreview?.cardFinish;
  const selectedDetailChips = [
    selectedPrimarySetLabel ? { key: 'set', label: selectedPrimarySetLabel } : null,
    selectedPrimaryLanguageLabel
      ? { key: 'language', label: formatCardLanguageLabel(selectedPrimaryLanguageLabel) }
      : null,
    selectedPrimaryFinishLabel ? { key: 'finish', label: formatCardFinishLabel(selectedPrimaryFinishLabel) } : null,
    collectionItem?.wanted_cards?.length
      ? { key: 'wanted', label: `${collectionItem.wanted_cards.length} wanted` }
      : null,
    selectedDetailPriceLabel ? { key: 'price', label: selectedDetailPriceLabel } : null,
    selectedCollectedDateLabel ? { key: 'collected', label: `Owned since ${selectedCollectedDateLabel}` } : null,
  ].filter((value): value is { key: string; label: string } => Boolean(value));

  const panelHelperText = readOnlyMode
    ? 'This shared binder is read-only. You can browse, search, filter, and view prices, but only the owner can change collection state.'
    : collected
      ? 'Owned and wanted cards are managed separately. Removing a wanted card keeps your owned card.'
      : 'Add an owned card to fill this slot, or add a wanted card to track what you are looking for.';

  const primaryWanted = selectedHasWantedCard ? selectedWantedCardPreview : null;
  const otherWanted = selectedWantedCards.filter(
    (card) => !primaryWanted || getWantedCardKey(card) !== getWantedCardKey(primaryWanted),
  );
  const renderWantedActions = (card: WantedCard) => (
    <div key={getWantedCardKey(card)} className="rounded-2xl border border-amber-400/30 bg-amber-400/5 p-2.5">
      <p className="text-[10px] font-semibold text-amber-700 uppercase dark:text-amber-300">Wanted card</p>
      <p className="text-sm font-semibold break-words">{card.card_name}</p>
      <p className="text-muted-foreground mb-2 text-xs">
        {[card.card_set, formatCardLanguageLabel(card.card_language), formatCardFinishLabel(card.card_finish)]
          .filter(Boolean)
          .join(' · ')}
      </p>
      <div className="grid gap-1.5">
        <Button
          onClick={() => handleChangeWantedCard(card)}
          variant="secondary"
          className="h-auto min-h-10 py-2 text-xs whitespace-normal"
        >
          Change wanted card
        </Button>
        <Button
          onClick={() => void handleClearWantedCard(selectedPokemon.id, card)}
          variant="outline"
          className="text-destructive h-auto min-h-10 py-2 text-xs whitespace-normal"
        >
          Remove from want list
        </Button>
      </div>
    </div>
  );

  const quickPanel = (
    <>
      {!isDesktopViewport && !isQuickPanelCovered ? (
        <div
          aria-hidden="true"
          data-overlay-backdrop
          className="fixed inset-0 z-[35] bg-black/45 backdrop-blur-[2px]"
          onClick={closeSelectedPokemon}
        />
      ) : null}
      <div
        ref={quickPanelRef}
        role="dialog"
        aria-modal={!isDesktopViewport}
        aria-label={`${selectedPokemonDisplayName} details`}
        // Stay mounted (but hidden) under the card selector / all-cards view so focus can return here.
        className={`fixed z-40 ${isQuickPanelCovered ? 'hidden' : 'flex'} max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-1.5rem)] w-[min(calc(100vw-1.5rem),28rem)] flex-col overflow-hidden transition-[top,left,transform] duration-200 ease-out outline-none sm:w-[min(calc(100vw-2rem),24rem)]`}
        style={
          quickPanelPosition
            ? {
                top: quickPanelPosition.top,
                left: quickPanelPosition.left,
                maxHeight: quickPanelPosition.maxHeight,
              }
            : isDesktopViewport
              ? {
                  left: '50%',
                  bottom: '1rem',
                  transform: 'translateX(-50%)',
                }
              : {
                  left: '50%',
                  bottom: 'calc(var(--dock-clearance) + 0.375rem)',
                  transform: 'translateX(-50%)',
                  width: 'min(calc(100vw - 1rem), 28rem)',
                  // Never taller than the space between the status bar and the bottom dock.
                  // Stays below the status bar and below a top banner (offline / sync) when one is shown.
                  maxHeight:
                    'calc(100dvh - max(env(safe-area-inset-top) + 0.5rem, var(--top-banner-bottom, 0px)) - var(--dock-clearance) - 0.375rem)',
                }
        }
      >
        <div className="holo-panel border-border/70 bg-card/96 text-foreground dark:bg-card/96 flex min-h-0 flex-col rounded-[1.35rem] border p-3 shadow-[0_28px_70px_-34px_rgba(15,23,42,0.28)] backdrop-blur-xl sm:rounded-[1.6rem] dark:shadow-[0_28px_70px_-34px_rgba(0,0,0,0.55)]">
          <div className="flex min-h-0 flex-col gap-3">
            <div
              className="shrink-0"
              data-sheet-grabber={isMobileQuickPanel ? '' : undefined}
              {...(isMobileQuickPanel ? quickPanelSwipe : {})}
            >
              {isMobileQuickPanel ? (
                <div aria-hidden="true" className="bg-muted-foreground/30 mx-auto -mt-1 mb-2 h-1.5 w-10 rounded-full" />
              ) : null}
              <div className="flex items-start gap-3">
                <CardImageZoom
                  src={selectedPreviewImage}
                  alt={selectedPreviewAlt}
                  disabled={!selectedPreviewIsCard}
                  className={`border-border/60 bg-background/45 relative mt-0.5 flex shrink-0 items-center justify-center overflow-hidden border shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] dark:border-white/10 dark:bg-white/[0.04] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] ${selectedPreviewFrameClass}`}
                >
                  <CardImage
                    fill
                    sizes="(max-width: 639px) 80px, 56px"
                    src={selectedPreviewImage}
                    alt={selectedPreviewAlt}
                    className={`${selectedPreviewImageClass} ${selectedPreviewFit} ${selectedPreviewTone}`}
                  />
                  {binderCardDisplay !== 'wanted' && collected && !selectedPreviewIsCard && (
                    <div
                      className={`absolute flex h-4 w-4 items-center justify-center rounded-full bg-green-500 shadow ${selectedPreviewBadgeClass}`}
                    >
                      <Check className="h-2.5 w-2.5 text-white" />
                    </div>
                  )}
                </CardImageZoom>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-muted-foreground text-[11px] font-semibold tracking-[0.16em]">
                        {formatDexNumber(selectedPokemon.id)}
                      </p>
                      <h3 className="text-[1.05rem] leading-tight font-bold tracking-tight break-words">
                        {selectedPokemonDisplayName}
                      </h3>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:bg-background/60 hover:text-foreground h-9 shrink-0 gap-1 rounded-xl px-2 text-xs font-semibold dark:hover:bg-white/[0.04]"
                        onClick={() =>
                          openCardBrowser({ id: selectedPokemon.id, name: selectedPokemon.name }, { fromDetail: true })
                        }
                        aria-label={`All ${selectedPokemonDisplayName} cards`}
                      >
                        <Layers3 className="h-4 w-4" />
                        <span className="hidden sm:inline">All cards</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:bg-background/60 hover:text-foreground h-9 w-9 shrink-0 rounded-xl dark:hover:bg-white/[0.04]"
                        onClick={closeSelectedPokemon}
                        aria-label="Close card details"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span
                      className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold tracking-[0.14em] uppercase ${selectedStatusPill.className}`}
                    >
                      {selectedStatusPill.label}
                    </span>
                    {selectedPrimaryCardPreview?.cardName ? (
                      <span className="border-border/60 bg-background/35 text-muted-foreground rounded-full border px-2.5 py-1 text-[10px] font-medium dark:border-white/10 dark:bg-white/[0.04]">
                        {selectedHasWantedCard
                          ? 'Wanted printing'
                          : selectedPokemonHasAssignedCard
                            ? 'Owned printing'
                            : 'Tracked card'}
                      </span>
                    ) : null}
                  </div>
                  <p
                    className={`mt-1.5 min-h-[1rem] text-xs leading-relaxed break-words ${
                      selectedHasWantedCard
                        ? 'text-amber-700 dark:text-amber-400'
                        : collectionItem?.card_name
                          ? 'text-sky-700 dark:text-sky-300'
                          : 'text-muted-foreground'
                    }`}
                  >
                    {selectedCardSummaryLabel}
                  </p>
                </div>
              </div>
            </div>
            <div
              className="-mx-3 -mb-3 flex min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain px-3 pb-3 [&>*]:shrink-0"
              style={{ WebkitOverflowScrolling: 'touch' }}
            >
              {ctx.pricingEnabled &&
              (selectedPrimaryCardPreview?.cardId ||
                selectedMarketPriceLabel ||
                selectedGoodPriceLabel ||
                (isLoadingPrices && (collectionItem?.card_id || selectedWantedCardPreview?.card_id))) ? (
                <div className="border-border/60 bg-background/25 rounded-2xl border p-2.5 dark:border-white/10 dark:bg-white/[0.03]">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="border-border/50 bg-background/45 rounded-xl border px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
                      <p className="text-muted-foreground text-[10px] font-semibold tracking-[0.14em] uppercase">
                        {selectedUsesSoldGuide ? 'Fair range · sold' : 'Low'}
                      </p>
                      <p className="mt-0.5 text-sm font-bold text-emerald-600 tabular-nums dark:text-emerald-300">
                        {selectedGoodPriceLabel ?? (isLoadingPrices ? 'Loading' : 'No price')}
                      </p>
                    </div>
                    <div className="border-border/50 bg-background/45 rounded-xl border px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
                      <p className="text-muted-foreground text-[10px] font-semibold tracking-[0.14em] uppercase">
                        Market
                      </p>
                      <p className="mt-0.5 text-sm font-bold tabular-nums">
                        {selectedMarketPriceLabel ?? (isLoadingPrices ? 'Loading' : 'No price')}
                      </p>
                    </div>
                  </div>
                  {selectedRangePriceLabel || selectedConfidenceLabel ? (
                    <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-1.5 px-1 text-[10px]">
                      {selectedRangePriceLabel ? (
                        <span className="border-border/50 bg-background/35 rounded-full border px-2 py-0.5 dark:border-white/10 dark:bg-white/[0.04]">
                          Range {selectedRangePriceLabel}
                        </span>
                      ) : null}
                      {selectedConfidenceLabel ? (
                        <span className="border-border/50 bg-background/35 rounded-full border px-2 py-0.5 dark:border-white/10 dark:bg-white/[0.04]">
                          {selectedConfidenceLabel}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  {selectedPriceSourceLabel ? (
                    <p className="text-muted-foreground mt-2 px-1 text-xs break-words">{selectedPriceSourceLabel}</p>
                  ) : null}
                  <details open className="group mt-2">
                    <summary className="flex min-h-9 cursor-pointer items-center justify-between text-xs font-semibold">
                      Price details
                      <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                    </summary>
                    {selectedPrimaryCardPreview ? (
                      <CardPriceComparison
                        key={`${selectedPrimaryCardPreview.cardId}:${selectedPrimaryCardPreview.cardLanguage}:${selectedPrimaryCardPreview.cardFinish}`}
                        cardId={selectedPrimaryCardPreview.cardId}
                        searchCard={{
                          name: selectedPrimaryCardPreview.cardName,
                          setName: selectedPrimaryCardPreview.cardSet,
                        }}
                        language={selectedPrimaryCardPreview.cardLanguage}
                        finish={selectedPrimaryCardPreview.cardFinish}
                        catalogMarketGbp={selectedComparisonMarketGbp}
                        onSoldCheck={onSelectedSoldCheck}
                      />
                    ) : null}
                    <CardPriceEvidence price={selectedDetailPriceSnapshot} />
                  </details>
                </div>
              ) : null}
              {selectedIllustratorLookupKey ? (
                // Fixed height in every state (loading, named, not listed) so the sheet never shifts when it arrives.
                <div className="max-sm:order-[-1]" data-testid="detail-illustrator">
                  {selectedIllustratorName ? (
                    <button
                      type="button"
                      onClick={() => openIllustratorBrowser(selectedIllustratorName, { fromDetail: true })}
                      aria-label={`Illustrator ${selectedIllustratorName}: show all their cards`}
                      className="border-border/60 bg-background/25 hover:border-primary/30 hover:bg-primary/10 flex h-12 w-full items-center gap-2.5 rounded-2xl border px-3 text-left transition-colors dark:border-white/10 dark:bg-white/[0.03]"
                    >
                      <Palette className="text-muted-foreground h-4 w-4 shrink-0" />
                      <span
                        className={`min-w-0 flex-1 ${selectedIllustratorArrivedLate ? 'animate-in fade-in duration-200 motion-reduce:animate-none' : ''}`}
                      >
                        <span className="text-muted-foreground block text-[10px] font-semibold tracking-[0.14em] uppercase">
                          Illustrator
                        </span>
                        <span className="text-primary block truncate text-sm font-semibold underline-offset-2 hover:underline">
                          {selectedIllustratorName}
                        </span>
                      </span>
                      <ChevronRight className="text-muted-foreground h-4 w-4 shrink-0" />
                    </button>
                  ) : (
                    <div
                      role={selectedIllustratorState === null ? 'status' : undefined}
                      aria-label={selectedIllustratorState === null ? 'Loading illustrator' : undefined}
                      className="border-border/60 bg-background/25 flex h-12 w-full items-center gap-2.5 rounded-2xl border px-3 dark:border-white/10 dark:bg-white/[0.03]"
                    >
                      <Palette className="text-muted-foreground h-4 w-4 shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="text-muted-foreground block text-[10px] font-semibold tracking-[0.14em] uppercase">
                          Illustrator
                        </span>
                        {selectedIllustratorState === null ? (
                          <span
                            aria-hidden="true"
                            className="bg-muted-foreground/25 mt-1 block h-3.5 w-28 animate-pulse rounded motion-reduce:animate-none"
                          />
                        ) : (
                          <span className="text-muted-foreground block truncate text-sm">Not listed</span>
                        )}
                      </span>
                    </div>
                  )}
                </div>
              ) : null}
              {/* On phones the actions come first so they are reachable without scrolling past prices. */}
              <div data-testid="detail-actions" className="flex flex-col gap-2.5 max-sm:order-first">
                <div className="flex gap-2">
                  <Button
                    onClick={handleJumpToPreviousNeeded}
                    disabled={!activeJumpPokemonList.length}
                    variant="ghost"
                    className="h-9 gap-1"
                  >
                    <ChevronLeft className="h-3 w-3" />
                    Prev
                  </Button>
                  <Button
                    onClick={handleJumpToNextNeeded}
                    disabled={!activeJumpPokemonList.length}
                    variant="ghost"
                    className="h-9 gap-1"
                  >
                    Next
                    <ChevronRight className="h-3 w-3" />
                  </Button>
                </div>
                {!readOnlyMode && <ActivityButton pokemonId={selectedPokemon.id} onOpen={closeSelectedPokemon} />}
                {!readOnlyMode && (
                  <>
                    {primaryWanted && renderWantedActions(primaryWanted)}
                    <section aria-label="Owned card" className="border-border/60 rounded-2xl border p-2.5">
                      <p className="mb-2 text-xs font-semibold">
                        {collected
                          ? `Owned card${collectionItem?.card_name ? `: ${collectionItem.card_name}` : ''}`
                          : 'Owned card'}
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          onClick={handleOpenCardSelector}
                          className="h-auto min-h-11 px-2 py-2 text-xs whitespace-normal"
                        >
                          {collected ? 'Change owned card' : 'Add owned card'}
                        </Button>
                        {collected && (
                          <Button
                            onClick={() => requestOwnedRemoval({ id: selectedPokemon.id, name: selectedPokemon.name })}
                            variant="outline"
                            className="text-destructive h-auto min-h-11 px-2 py-2 text-xs whitespace-normal"
                          >
                            Remove owned card
                          </Button>
                        )}
                      </div>
                    </section>
                    <Button
                      onClick={handleOpenWishlistSelector}
                      variant="outline"
                      className="h-auto min-h-11 py-2 text-xs whitespace-normal"
                    >
                      <Heart className="h-3.5 w-3.5" />
                      {selectedWantedCards.length ? 'Add another wanted card' : 'Add wanted card'}
                    </Button>
                    {otherWanted.length > 0 && (
                      <details className="border-border/60 rounded-2xl border p-2.5">
                        <summary className="min-h-9 cursor-pointer text-xs font-semibold">
                          {primaryWanted ? 'Other wanted cards' : 'Wanted cards'} ({otherWanted.length})
                        </summary>
                        <div className="mt-2 space-y-2">{otherWanted.map(renderWantedActions)}</div>
                      </details>
                    )}
                  </>
                )}
              </div>
              <details className="group border-border/60 rounded-2xl border p-2.5">
                <summary className="flex min-h-9 cursor-pointer items-center justify-between gap-2 text-xs font-semibold">
                  Card & variant
                  <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                </summary>
                <div className="mt-2 space-y-2">
                  {selectedDetailChips.length > 0 ? (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {selectedDetailChips.map((detailChip) => (
                        <span
                          key={detailChip.key}
                          className="border-border/60 bg-background/35 text-muted-foreground max-w-full rounded-full border px-2.5 py-1 text-[11px] font-medium break-words dark:border-white/10 dark:bg-white/[0.04]"
                        >
                          {detailChip.label}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {selectedCurrentCardPreview ? (
                    <div className="border-border/60 bg-background/25 flex items-center gap-2 rounded-2xl border p-2 dark:border-white/10 dark:bg-white/[0.03]">
                      <CardImageZoom
                        src={selectedCurrentCardPreview.cardImage ?? ''}
                        alt={selectedCurrentCardPreview.cardName}
                        disabled={!selectedCurrentCardPreview.cardImage}
                        className="trading-card border-border/60 bg-muted relative w-10 shrink-0 border dark:border-white/10"
                      >
                        {selectedCurrentCardPreview.cardImage ? (
                          <CardImage
                            fill
                            sizes="40px"
                            src={selectedCurrentCardPreview.cardImage}
                            alt={selectedCurrentCardPreview.cardName}
                            className="absolute inset-0 h-full w-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="bg-muted text-muted-foreground flex h-full w-full items-center justify-center text-[9px]">
                            No image
                          </div>
                        )}
                      </CardImageZoom>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-muted-foreground text-[10px] font-semibold tracking-[0.14em] uppercase">
                            Current card
                          </p>
                          {selectedAssignedPriceChipLabel ? (
                            <span className="border-border/60 bg-background/40 text-muted-foreground shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium dark:border-white/10 dark:bg-white/[0.04]">
                              {selectedAssignedPriceChipLabel}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-0.5 text-xs font-semibold break-words">
                          {selectedCurrentCardPreview.cardName}
                        </p>
                        <p className="text-muted-foreground mt-0.5 text-[11px] break-words">
                          {[
                            selectedCurrentCardPreview.cardSet,
                            formatCardLanguageLabel(selectedCurrentCardPreview.cardLanguage),
                            formatCardFinishLabel(selectedCurrentCardPreview.cardFinish),
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      </div>
                    </div>
                  ) : null}
                  {selectedWantedCards.map((card) => {
                    const image = toCacheableCardImageUrl(card.card_image);
                    const savedDate = formatCollectedDate(card.added_at);
                    return (
                      <div
                        key={getWantedCardKey(card)}
                        className="border-border/60 bg-background/25 flex items-center gap-2 rounded-2xl border p-2 dark:border-white/10 dark:bg-white/[0.03]"
                      >
                        <CardImageZoom
                          src={image ?? ''}
                          alt={card.card_name}
                          disabled={!image}
                          className="trading-card border-border/60 bg-muted relative w-10 shrink-0 border dark:border-white/10"
                        >
                          {image ? (
                            <CardImage
                              fill
                              sizes="40px"
                              src={image}
                              alt={card.card_name}
                              className="object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="text-muted-foreground flex h-full w-full items-center justify-center text-[9px]">
                              No image
                            </div>
                          )}
                        </CardImageZoom>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-muted-foreground text-[10px] font-semibold tracking-[0.14em] uppercase">
                              Wanted card
                            </p>
                            <span className="text-muted-foreground text-[10px]">
                              {priceFormat.label(
                                pricesByCardId[getCardPriceKey(card.card_id, card.card_language ?? 'en')],
                              )}
                            </span>
                          </div>
                          <p className="mt-0.5 text-xs font-semibold break-words">{card.card_name}</p>
                          <p className="text-muted-foreground mt-0.5 text-[11px] break-words">
                            {[
                              card.card_set,
                              formatCardLanguageLabel(card.card_language),
                              formatCardFinishLabel(card.card_finish),
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                          {savedDate ? (
                            <p className="text-muted-foreground mt-0.5 text-[11px]">Wanted saved {savedDate}</p>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                  {!readOnlyMode && selectedPokemonHasAssignedCard ? (
                    <div className="border-border/60 bg-background/25 rounded-2xl border p-2 dark:border-white/10 dark:bg-white/[0.03]">
                      <div className="mb-2 flex items-center justify-between gap-2 px-1">
                        <span className="text-muted-foreground text-[10px] font-semibold tracking-[0.14em] uppercase">
                          Owned card variant
                        </span>
                        <span className="text-muted-foreground text-[11px] break-words">
                          {formatCardFinishLabel(collectionItem?.card_finish)}
                        </span>
                      </div>
                      <div className="scrollbar-hide flex gap-1.5 overflow-x-auto pb-0.5">
                        {CARD_FINISH_OPTIONS.map((finishOption) => {
                          const isActive = (collectionItem?.card_finish ?? 'normal') === finishOption.id;
                          const finishPrice =
                            selectedFinishPrices[finishOption.id as keyof typeof selectedFinishPrices];
                          const finishPriceLabel = finishPrice
                            ? (priceFormat.label({ ...finishPrice, fetchedAt: 0 })?.split(' (')[0] ?? null)
                            : null;

                          return (
                            <button
                              key={finishOption.id}
                              type="button"
                              onClick={() => handleSelectedCardFinishChange(finishOption.id)}
                              disabled={isActive}
                              aria-pressed={isActive}
                              aria-label={finishPriceLabel ? `${finishOption.label}, ${finishPriceLabel}` : undefined}
                              className={`h-9 shrink-0 rounded-xl border px-3 text-[11px] font-semibold transition-colors disabled:pointer-events-none ${
                                isActive
                                  ? 'border-primary/55 bg-primary text-primary-foreground shadow-sm'
                                  : 'border-border/60 bg-background/55 text-muted-foreground hover:bg-background/80 hover:text-foreground dark:border-white/10 dark:bg-white/[0.04] dark:hover:bg-white/[0.07]'
                              }`}
                            >
                              {finishOption.label}
                              {finishPriceLabel ? (
                                <span className="ml-1 font-bold tabular-nums opacity-80" data-testid="finish-price">
                                  {finishPriceLabel}
                                </span>
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>
              </details>
              <details className="group border-border/60 rounded-2xl border p-2.5">
                <summary className="flex min-h-9 cursor-pointer items-center justify-between gap-2 text-xs font-semibold">
                  Collection options
                  <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                </summary>
                <div className="mt-2 space-y-2">
                  {!readOnlyMode && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        onClick={handleOpenSelectedSlotScanner}

                        variant="outline"
                        size="sm"
                        className="bg-background/55 text-muted-foreground hover:bg-background/75 hover:text-foreground h-9 shrink-0 gap-1 rounded-xl !border-0 px-3 text-xs shadow-none dark:bg-white/[0.05] dark:hover:bg-white/[0.08]"
                      >
                        <Camera className="h-3 w-3" />
                        Scan card
                      </Button>
                      {!collected && (
                        <Button
                          onClick={handleQuickCollectSelectedPokemon}

                          variant="outline"
                          size="sm"
                          className="bg-background/55 text-muted-foreground hover:bg-background/75 hover:text-foreground h-9 shrink-0 rounded-xl !border-0 px-3 text-xs shadow-none dark:bg-white/[0.05] dark:hover:bg-white/[0.08]"
                        >
                          Mark owned without card
                        </Button>
                      )}
                      {collected && selectedPokemonHasAssignedCard && (
                        <Button
                          onClick={handleToggleFavoriteSelectedPokemon}

                          variant={selectedPokemonIsFavorite ? 'default' : 'outline'}
                          size="sm"
                          className={
                            selectedPokemonIsFavorite
                              ? 'h-9 shrink-0 gap-1 rounded-xl px-3 text-xs'
                              : 'bg-background/55 text-muted-foreground hover:bg-background/75 hover:text-foreground h-9 shrink-0 gap-1 rounded-xl !border-0 px-3 text-xs shadow-none dark:bg-white/[0.05] dark:hover:bg-white/[0.08]'
                          }
                        >
                          <Star className={`h-3 w-3 ${selectedPokemonIsFavorite ? 'fill-current' : ''}`} />
                          {selectedPokemonIsFavorite ? 'Perfect' : 'Fav'}
                        </Button>
                      )}
                    </div>
                  )}
                  <p className="text-muted-foreground/90 px-1 text-[11px] leading-relaxed">{panelHelperText}</p>
                </div>
              </details>
            </div>
          </div>
        </div>
      </div>
    </>
  );

  return createPortal(quickPanel, document.body);
}
