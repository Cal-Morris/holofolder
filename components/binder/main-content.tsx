'use client';

import type { BinderDisplaySlot } from '@/lib/binder-display-model';

import CollectionPriceCheck from '@/components/collection-price-check';
import { getCollectionItemPriceKey } from '@/components/binder/binder-app-model';
import {
  CollectionAnalyticsView,
  DashboardBinderPreview,
  DexListView,
  PokemonBrowseView,
  SetPopulationView,
  WantedDashboard,
} from '@/components/binder/lazy-views';
import { getCardPriceKey } from '@/hooks/use-card-prices';
import { PAGE_TURN_MS } from '@/lib/binder-page-turn';
import { TRADING_CARD_ASPECT_RATIO } from '@/lib/page-scan';
import { toCardImageSrc } from '@/lib/card-image-url';
import { formatCardFinishLabel } from '@/lib/card-labels';
import { getPokemonSummary } from '@/lib/pokemon-catalog';
import { LoaderCircle, X } from 'lucide-react';
import type { User } from '@supabase/supabase-js';
import { BinderValue } from '@/components/binder-value';
import type { BinderSettings } from '@/hooks/use-settings';
import type { ResolvedPricingPreferences } from '@/lib/pricing-region';
import type { RegionalCardPriceSnapshot } from '@/lib/regional-price';
import type { CardPriceSnapshot, SupportedCurrency } from '@/hooks/use-card-prices';
import type { CardSelectorMode } from '@/components/card-selector';
import type { TCGSetDexSlot, TCGSetSlotCard, TCGSetSummary } from '@/lib/tcg-set-slots';
import type { PokemonEntry, PokemonSummary } from '@/lib/pokemon-catalog';
import type { ChangeEvent, Dispatch, JSX, RefObject, SetStateAction } from 'react';
import type { BinderCardDisplay } from '@/lib/selected-slot-card-display';
import type { BinderDesign, SurfaceDesign } from '@/lib/binder-design';
import type { WantedDashboardSummary } from '@/lib/wanted-dashboard';
import { rememberBinderScope } from '@/lib/binders/all-binders';
import type { CollectedPokemon, WantedCard } from '@/lib/domain/cards';
import type {
  ActiveMainView,
  CollectionViewFilter,
  DisplaySpreadPage,
  PriceSummary,
} from '@/components/binder/binder-app-model';

export interface MainContentContext {
  nativeWanted?: import('react').ReactNode;
  nativeAnalytics?: import('react').ReactNode;
  listTitle?: string;
  /** Read-only native ownership for the Pokémon-specific views; the legacy collection is empty for native hosts. */
  nativeSpecies?: { bySpecies: Map<number, CollectedPokemon>; rows: CollectedPokemon[] } | null;
  layoutToolbar?: import('react').ReactNode;
  orderedDisplaySlots?: (BinderDisplaySlot | null)[];
  onSelectSlot?: (id: string) => void;
  pendingBinderPage: number | null;
  cancelPageNavigation: () => void;
  assignWantedCard: (pokemonId: number, pokemonName: string, card: WantedCard, people: string[]) => void;
  activeJumpLabel: 'Needed' | 'Perfect' | 'Upgrade' | 'Wanted';
  activeMainView: ActiveMainView;
  binderAppearance: {
    design: BinderDesign;
    uploads: Record<string, Blob>;
    artwork: Record<string, string>;
    loading: boolean;
    revision: number;
    hasSavedDesign: boolean;
    message: string;
    save: (
      nextDesign: BinderDesign,
      nextUploads: Record<string, Blob>,
      baseRevision?: number,
    ) => Promise<{ synced: boolean; revision: number }>;
    refresh: () => Promise<void>;
    loadLatest: () => Promise<
      { design: BinderDesign; uploads: Record<string, Blob>; revision: number; pending: boolean } | null | undefined
    >;
  };
  binderCardDisplay: BinderCardDisplay;
  binderDimension: '2d' | '3d';
  binderFitSize: { width: number; height: number } | null;
  binderPageRef: RefObject<HTMLDivElement | null>;
  onHideBinderValue: () => void;
  collection: CollectedPokemon[];
  collectionByPokemonId: Map<number, CollectedPokemon>;
  collectionViewFilter: CollectionViewFilter;
  currentBinderPage: number;
  dashboardBinderDesign: {
    rows: number;
    cols: number;
    pageCount: number;
    version: 1;
    name: string;
    surfaces: Record<'cover' | 'back' | 'spine' | 'lining', SurfaceDesign>;
    material: 'pebbled' | 'smooth';
    ink: string;
    font: 'sans-serif' | 'serif' | 'monospace';
    textSize: number;
    pageColor: string;
    pageColors: Record<string, string>;
    zip: { teeth: string; tape: string; pull: string; type: 'metal' | 'nylon' };
    stats: 'off' | 'compact' | 'full';
  };
  displayedSpreadPages: DisplaySpreadPage[];
  filteredPokemonList: PokemonEntry[];
  filteredPokemonSummaryList: PokemonSummary[];
  filteredTotalLabel: string;
  handleClearWantedCard: (pokemonId: number, wantedCard: WantedCard) => Promise<void>;
  handleCollectSetCard: (slot: TCGSetDexSlot, card: TCGSetSlotCard) => Promise<void>;
  handleCollectSetCards: (cards: { slot: TCGSetDexSlot; card: TCGSetSlotCard }[]) => Promise<void>;
  handleGotWantedCard: (pokemonId: number, pokemonName: string, wantedCard: WantedCard) => Promise<void>;
  handlePagePhotoSelected: (event: ChangeEvent<HTMLInputElement, JSX.Element>) => Promise<void>;
  handleWantedSelect: (pokemon: PokemonSummary, card: WantedCard) => void;
  handlePokemonSelect: (pokemon: PokemonSummary) => void;
  handleQuickCollect: (pokemon: { id: number; name: string }) => Promise<void>;
  handleSelectSetSlot: (slot: TCGSetDexSlot) => void;
  handleShareWantedList: (scope?: 'binder' | 'all') => Promise<void>;
  handleSlotClick: (pokemon: { id: number; name: string }) => void;
  handleToggleFavorite: (pokemonId: number) => Promise<void>;
  handleWantSetCard: (slot: TCGSetDexSlot, card: TCGSetSlotCard, toggle?: boolean) => Promise<void>;
  handleWantSetCards: (cards: { slot: TCGSetDexSlot; card: TCGSetSlotCard }[]) => Promise<void>;
  hasTrackedCards: boolean;
  initialBinderId: string | null;
  isLoadingPrices: boolean;
  isOnline: boolean;
  pricingEnabled: boolean;
  isPriceMode: boolean;
  isSpreadLayout: boolean;
  jumpToWantedPokemonPage: (pokemon: PokemonSummary | null) => void;
  mainViewRef: RefObject<HTMLDivElement | null>;
  openCardBrowser: (
    pokemon: { id: number; name: string },
    options?: { highlightCardId?: string | null | undefined; fromDetail?: boolean | undefined },
  ) => void;
  openCardSelectorForPokemon: (pokemon: PokemonSummary, mode: CardSelectorMode) => void;
  openPriceLookup: (query: string) => void;
  ownedTotalLabel: string;
  ownedTrackedCards: CollectedPokemon[];
  pagePhotoInputRef: RefObject<HTMLInputElement | null>;
  prefersReducedMotion: boolean;
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
  pricingPreferences: ResolvedPricingPreferences;
  readOnlyMode: boolean;
  renderBinderGridPage: (pageNumber: number, side: 'left' | 'right') => JSX.Element;
  renderSpreadBlankPage: (side: 'left' | 'right') => JSX.Element;
  renderSpreadInfoPage: (side: 'left' | 'right') => JSX.Element;
  requestOwnedRemoval: (pokemon: { id: number; name: string }) => void;
  resolvedCollectionOwnerUserId: string | null;
  setBinderStageRef: (node: HTMLDivElement | null) => void;
  setCurrentBinderPage: Dispatch<SetStateAction<number>>;
  /** A set hit tapped in Search or Quick mode: Sets opens on it (the key remounts Sets for a new pick). */
  setViewRequest: { set: TCGSetSummary; key: number } | null;
  settings: BinderSettings;
  switchMainView: (view: ActiveMainView) => Promise<void>;
  user: User | null;
  viewLoadError: string | null;
  visiblePageLabel: string;
  visiblePagePriceSummary: PriceSummary;
  visiblePageTotalLabel: string;
  wantedCardEntries: { pokemonId: number; pokemonName: string; card: WantedCard }[];
  wantedDashboard: WantedDashboardSummary;
  wantedModeCombinedPriceSummary: PriceSummary;
  wantedModeCombinedTotalLabel: string;
  wantedTotalLabel: string;
}

export function renderMainContentView(ctx: MainContentContext) {
  const {
    pendingBinderPage,
    cancelPageNavigation,
    onHideBinderValue,
    assignWantedCard,
    activeJumpLabel,
    activeMainView,
    binderAppearance,
    binderCardDisplay,
    binderDimension,
    binderFitSize,
    binderPageRef,
    collection,
    collectionByPokemonId,
    collectionViewFilter,
    currentBinderPage,
    dashboardBinderDesign,
    displayedSpreadPages,
    filteredPokemonList,
    filteredPokemonSummaryList,
    filteredTotalLabel,
    handleClearWantedCard,
    handleCollectSetCard,
    handleCollectSetCards,
    handleGotWantedCard,
    handlePagePhotoSelected,
    handlePokemonSelect,
    handleWantedSelect,
    handleQuickCollect,
    handleSelectSetSlot,
    handleShareWantedList,
    handleSlotClick,
    handleToggleFavorite,
    handleWantSetCard,
    handleWantSetCards,
    hasTrackedCards,
    initialBinderId,
    isLoadingPrices,
    isOnline,
    isPriceMode,
    isSpreadLayout,
    jumpToWantedPokemonPage,
    mainViewRef,
    openCardBrowser,
    openCardSelectorForPokemon,
    openPriceLookup,
    ownedTotalLabel,
    ownedTrackedCards,
    pagePhotoInputRef,
    prefersReducedMotion,
    priceFormat,
    pricesByCardId,
    pricingPreferences,
    readOnlyMode,
    renderBinderGridPage,
    renderSpreadBlankPage,
    renderSpreadInfoPage,
    requestOwnedRemoval,
    resolvedCollectionOwnerUserId,
    setBinderStageRef,
    setCurrentBinderPage,
    setViewRequest,
    settings,
    switchMainView,
    user,
    viewLoadError,
    visiblePageLabel,
    visiblePagePriceSummary,
    visiblePageTotalLabel,
    wantedCardEntries,
    wantedDashboard,
    wantedModeCombinedPriceSummary,
    wantedModeCombinedTotalLabel,
    wantedTotalLabel,
  } = ctx;
  const speciesById = ctx.nativeSpecies?.bySpecies ?? collectionByPokemonId;
  return (
    <div
      data-testid="main-content"
      className={`mx-auto flex min-h-0 w-full max-w-[100vw] flex-1 flex-col overflow-hidden px-2 pb-[calc(var(--dock-clearance)+0.5rem)] sm:px-4 md:pb-4 ${activeMainView === 'binder' ? 'max-w-none' : 'max-w-7xl'}`}
    >
      {!ctx.orderedDisplaySlots && ctx.layoutToolbar}
      <input
        ref={pagePhotoInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handlePagePhotoSelected}
      />

      {activeMainView === 'binder' && !readOnlyMode && collection.length === 0 && (
        <p className="text-muted-foreground shrink-0 px-2 py-2 text-center text-sm">
          Tap a pocket to add your first card
        </p>
      )}

      {activeMainView === 'binder' && binderAppearance.message && (
        <span role="status" className="text-muted-foreground text-[10px]">
          {binderAppearance.message}
        </span>
      )}

      <div
        id="collection-browser-scroll"
        ref={mainViewRef}
        className={`flex min-h-0 flex-1 flex-col space-y-2 ${
          activeMainView === 'binder'
            ? binderDimension === '3d'
              ? 'overflow-x-hidden overflow-y-auto'
              : 'overflow-x-hidden overflow-y-auto md:overflow-visible'
            : 'overflow-hidden'
        }`}
      >
        {ctx.orderedDisplaySlots && ctx.layoutToolbar}
        {viewLoadError ? (
          <p role="alert" className="border-border/55 bg-card/70 shrink-0 rounded-2xl border p-3 text-sm">
            {viewLoadError}
          </p>
        ) : null}
        {activeMainView === 'binder' && !readOnlyMode && settings.showBinderValue !== false && (
          <BinderValue
            onDismiss={onHideBinderValue}
            collection={collection}
            prices={pricesByCardId}
            loading={isLoadingPrices}
            onOpen={() => {
              rememberBinderScope('analytics', 'binder');
              void switchMainView('analytics');
            }}
          />
        )}
        {activeMainView === 'pokemon' || activeMainView === 'sets' ? (
          <div role="group" aria-label="Browse perspective" className="flex shrink-0 gap-2 px-1 py-1">
            {(['pokemon', 'sets'] as const).map((view) => (
              <button
                key={view}
                type="button"
                aria-pressed={activeMainView === view}
                onClick={() => switchMainView(view)}
                className={`min-h-9 rounded-full border px-4 text-xs font-semibold ${activeMainView === view ? 'border-primary/45 bg-primary text-primary-foreground' : 'border-border/55 bg-card/70'}`}
              >
                {view === 'pokemon' ? 'Pokémon' : 'Sets'}
              </button>
            ))}
          </div>
        ) : null}
        {!readOnlyMode && (activeMainView === 'list' || (activeMainView === 'wanted' && !ctx.nativeWanted)) && (
          <CollectionPriceCheck
            ownerId={user ? (resolvedCollectionOwnerUserId ?? null) : null}
            key={activeMainView}
            collection={collection}
            kind={activeMainView === 'wanted' ? 'wanted' : 'owned'}
            isOnline={isOnline}
          />
        )}
        {activeMainView === 'pokemon' ? (
          <PokemonBrowseView
            collectionByPokemonId={speciesById}
            onBrowsePokemon={(pokemon) => openCardBrowser(pokemon)}
          />
        ) : activeMainView === 'analytics' ? (
          (ctx.nativeAnalytics ?? (
            <CollectionAnalyticsView
              collection={collection}
              pricesByKey={pricesByCardId}
              ownerId={user ? resolvedCollectionOwnerUserId : null}
              readOnly={readOnlyMode}
              isOnline={isOnline}
              isLoadingPrices={isLoadingPrices}
              onBrowsePokemon={openCardBrowser}
            />
          ))
        ) : activeMainView === 'list' ? (
          <DexListView
            title={ctx.listTitle}
            pokemonList={filteredPokemonSummaryList}
            collectionByPokemonId={speciesById}
            pricesByKey={pricesByCardId}
            getPriceKey={getCollectionItemPriceKey}
            formatPrice={priceFormat.label}
            onSelectPokemon={handlePokemonSelect}
            onToggleOwned={handleQuickCollect}
            onRemoveOwned={requestOwnedRemoval}
            onAddCard={(pokemon) => openCardSelectorForPokemon(pokemon, 'collect')}
            onAddWanted={(pokemon) => openCardSelectorForPokemon(pokemon, 'wishlist')}
            onTogglePerfect={handleToggleFavorite}
            onBrowseCards={(pokemon) => openCardBrowser({ id: pokemon.id, name: pokemon.name })}
            readOnly={readOnlyMode}
          />
        ) : activeMainView === 'wanted' ? (
          ctx.nativeWanted ? (
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{ctx.nativeWanted}</div>
          ) : (
            <WantedDashboard
              user={readOnlyMode ? null : user}
              isOnline={isOnline}
              onAssignWanted={assignWantedCard}
              wantedDashboard={wantedDashboard}
              currentBinderId={initialBinderId}
              priceFormat={priceFormat}
              isLoadingPrices={isLoadingPrices}
              readOnlyMode={readOnlyMode}
              handleShareWantedList={handleShareWantedList}
              handleGotWantedCard={handleGotWantedCard}
              handleClearWantedCard={handleClearWantedCard}
              handlePokemonSelect={handleWantedSelect}
              jumpToWantedPokemonPage={jumpToWantedPokemonPage}
              onCheckAnyCardPrice={openPriceLookup}
            />
          )
        ) : activeMainView === 'sets' ? (
          <SetPopulationView
            pricingEnabled={ctx.pricingEnabled}
            key={setViewRequest?.key ?? 'sets'}
            initialSet={setViewRequest?.set ?? null}
            collectionByPokemonId={speciesById}
            collectionRows={ctx.nativeSpecies?.rows}
            formatPrice={priceFormat.label}
            pricingRegion={pricingPreferences.region}
            onSelectSlot={handleSelectSetSlot}
            onBrowseCard={(slot, card) =>
              openCardBrowser({ id: slot.dexId, name: slot.pokemonName }, { highlightCardId: card.id })
            }
            onCollectCard={handleCollectSetCard}
            onWantCard={(slot, card) => handleWantSetCard(slot, card, true)}
            onCollectCards={handleCollectSetCards}
            onWantCards={handleWantSetCards}
            readOnly={readOnlyMode}
          />
        ) : binderDimension === '3d' ? (
          <DashboardBinderPreview
            displaySlots={ctx.orderedDisplaySlots}
            onSelectSlot={ctx.onSelectSlot}
            onSelectPokemon={(pokemon) => {
              handlePokemonSelect(pokemon);
              handleSlotClick(pokemon);
            }}
            appearance={dashboardBinderDesign}
            page={currentBinderPage}
            onPageChange={setCurrentBinderPage}
            artwork={binderAppearance.artwork}
            loading={binderAppearance.loading}
            collection={collection}
            cardDisplay={binderCardDisplay}
            enabled={Boolean(user) && !readOnlyMode}
          />
        ) : (
          <>
            {collectionViewFilter === 'wanted' && (
              <div className="shrink-0 rounded-xl border border-amber-400/25 bg-amber-400/8 p-1.5 sm:p-2">
                <div className="mb-1.5 grid grid-cols-2 gap-1.5 sm:mb-2 sm:grid-cols-3 sm:gap-2">
                  <div className="bg-card/78 hidden rounded-lg border border-amber-400/18 px-3 py-2 sm:block">
                    <p className="text-muted-foreground text-[10px] font-semibold tracking-[0.14em] uppercase">
                      All tracked
                    </p>
                    <p className="mt-0.5 text-sm font-semibold tabular-nums">
                      {wantedModeCombinedTotalLabel || (isLoadingPrices ? 'Loading prices' : 'No prices yet')}
                    </p>
                    <p className="text-muted-foreground mt-0.5 text-[10px]">
                      {ownedTrackedCards.length + wantedCardEntries.length} cards, owned and wanted
                    </p>
                  </div>
                  <div className="bg-card/78 min-w-0 rounded-lg border border-emerald-400/18 px-2.5 py-2 sm:px-3">
                    <p className="text-muted-foreground text-[10px] font-semibold tracking-[0.14em] uppercase">
                      Owned value
                    </p>
                    <p className="mt-0.5 truncate text-[13px] font-semibold tabular-nums sm:text-sm">
                      {ownedTotalLabel || (isLoadingPrices ? 'Loading' : 'No prices')}
                    </p>
                    <p className="text-muted-foreground mt-0.5 truncate text-[10px]">
                      {ownedTrackedCards.length} owned card{ownedTrackedCards.length === 1 ? '' : 's'}
                    </p>
                  </div>
                  <div className="bg-card/78 min-w-0 rounded-lg border border-amber-400/22 px-2.5 py-2 sm:px-3">
                    <p className="text-muted-foreground text-[10px] font-semibold tracking-[0.14em] uppercase">
                      To buy
                    </p>
                    <p className="mt-0.5 truncate text-[13px] font-semibold text-amber-600 tabular-nums sm:text-sm dark:text-amber-300">
                      {wantedTotalLabel || (isLoadingPrices ? 'Loading' : 'No prices')}
                    </p>
                    <p className="text-muted-foreground mt-0.5 text-[10px]">
                      {wantedCardEntries.length} wanted card{wantedCardEntries.length === 1 ? '' : 's'}
                      {wantedModeCombinedPriceSummary.unpricedCount > 0
                        ? `, ${wantedModeCombinedPriceSummary.unpricedCount} unpriced`
                        : ''}
                    </p>
                  </div>
                </div>
                <div className="scrollbar-hide overflow-x-auto">
                  <div className="flex min-w-max gap-2">
                    {wantedCardEntries.length === 0 ? (
                      <div className="text-muted-foreground px-2 py-1 text-xs">No wanted cards yet</div>
                    ) : (
                      wantedCardEntries.map(({ pokemonId, pokemonName, card }) => {
                        const priceKey = getCardPriceKey(card.card_id, card.card_language ?? 'en');
                        const priceLabel = priceFormat.label(pricesByCardId[priceKey]);

                        return (
                          <button
                            key={`${pokemonId}-${card.card_id}-${card.card_finish ?? 'normal'}`}
                            onClick={() => {
                              const pokemon = getPokemonSummary(pokemonId);
                              if (pokemon) {
                                handlePokemonSelect(pokemon);
                              }
                            }}
                            className="bg-card/82 flex w-44 shrink-0 items-center gap-2 rounded-lg border border-amber-400/20 p-1.5 text-left sm:w-56 sm:p-2"
                          >
                            {card.card_image ? (
                              <img
                                src={toCardImageSrc(card.card_image) ?? undefined}
                                alt={card.card_name}
                                className="trading-card w-8 object-cover sm:w-10"
                                loading="lazy"
                              />
                            ) : (
                              <div className="bg-muted h-12 w-8 rounded sm:h-14 sm:w-10" />
                            )}
                            <div className="min-w-0">
                              <p className="truncate text-xs font-semibold">{card.card_name}</p>
                              <p className="text-muted-foreground truncate text-[10px]">
                                {pokemonName} · {formatCardFinishLabel(card.card_finish)}
                              </p>
                              <p className="mt-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-300">
                                {priceLabel ?? (isLoadingPrices ? 'Loading price' : 'No price')}
                              </p>
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            )}

            {(settings.binderRows > 4 || settings.binderCols > 4) && (
              <p className="text-muted-foreground shrink-0 text-center text-xs">
                Scroll inside the page to see every pocket. Use the arrows to turn pages.
              </p>
            )}
            {/* Binder Grid */}
            <div
              ref={setBinderStageRef}
              // Native controls share the scrollport, so a short screen cannot crush the pockets.
              style={{
                minHeight: ctx.orderedDisplaySlots
                  ? Math.min(settings.binderRows, 4) * (36 / TRADING_CARD_ASPECT_RATIO + 6) + 32
                  : undefined,
              }}
              className={`relative flex min-h-0 flex-1 ${settings.binderRows > 4 || settings.binderCols > 4 ? 'touch-auto' : 'touch-pan-y'} items-center justify-center overflow-hidden overscroll-x-contain`}
            >
              {pendingBinderPage !== null && (
                <div
                  role="status"
                  aria-label="Page loading"
                  className="pointer-events-none absolute top-2 left-1/2 z-20 -translate-x-1/2"
                >
                  <div className="holo-loading flex items-center gap-2 rounded-full px-3 py-1 text-sm whitespace-nowrap shadow-lg">
                    <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                    <span>Opening page {pendingBinderPage}…</span>
                    <button
                      type="button"
                      aria-label="Cancel page change"
                      onClick={cancelPageNavigation}
                      className="hover:bg-muted pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              )}
              <div
                ref={binderPageRef}
                data-page-turn-ms={prefersReducedMotion ? 0 : PAGE_TURN_MS}
                className="relative max-h-full max-w-full"
                style={{
                  width: binderFitSize ? `${binderFitSize.width}px` : '100%',
                  height: binderFitSize ? `${binderFitSize.height}px` : 'auto',
                }}
              >
                <div className={`grid h-full w-full ${isSpreadLayout ? 'grid-cols-2 gap-3 xl:gap-4' : 'grid-cols-1'}`}>
                  {displayedSpreadPages.map((page) => {
                    if (page.kind === 'info') {
                      return renderSpreadInfoPage(page.side);
                    }

                    if (page.kind === 'blank') {
                      return renderSpreadBlankPage(page.side);
                    }

                    return renderBinderGridPage(page.pageNumber, page.side);
                  })}
                </div>
              </div>
            </div>

            {/* Page Info Footer */}
            <div className="text-muted-foreground/70 hidden shrink-0 flex-col items-center justify-center gap-1 text-[10px] md:hidden">
              {isPriceMode && hasTrackedCards && (
                <p className="text-primary/85 text-center text-[10px] font-medium">
                  {visiblePageLabel} {visiblePageTotalLabel || 'No page prices'}
                  {filteredTotalLabel ? ` · Filter total ${filteredTotalLabel}` : ''}
                  {visiblePagePriceSummary.unpricedCount > 0
                    ? ` · ${visiblePagePriceSummary.unpricedCount} unpriced in view`
                    : ''}
                </p>
              )}
              <div className="flex items-center justify-center gap-3">
                <span className="tabular-nums">
                  {settings.binderRows}x{settings.binderCols} Binder
                </span>
                <span className="bg-border/50 h-3 w-px" />
                <span className="tabular-nums">{visiblePageLabel}</span>
                <span className="bg-border/50 h-3 w-px sm:block" />
                <span className="tabular-nums">
                  {ctx.orderedDisplaySlots
                    ? `${ctx.orderedDisplaySlots.filter(Boolean).length} slots`
                    : `${filteredPokemonList.length} Pokemon`}
                </span>
                <span className="bg-border/50 hidden h-3 w-px sm:block" />
                <span className="hidden sm:block">
                  {isSpreadLayout
                    ? `Swipe, trackpad, or arrows move a spread; N / Shift+N still jump through ${activeJumpLabel.toLowerCase()} slots`
                    : `Swipe, trackpad, arrows, or N / Shift+N to jump through ${activeJumpLabel.toLowerCase()} slots`}
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
