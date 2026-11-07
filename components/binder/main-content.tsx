"use client"

import CollectionPriceCheck from "@/components/collection-price-check"
import { getCollectionItemPriceKey } from "@/components/binder/binder-app-model"
import { CollectionAnalyticsView, DashboardBinderPreview, DexListView, PageScanner, PokemonBrowseView, SetPopulationView, WantedDashboard } from "@/components/binder/lazy-views"
import { Button } from "@/components/ui/button"
import { getCardPriceKey } from "@/hooks/use-card-prices"
import { PAGE_TURN_MS } from "@/lib/binder-page-turn"
import { toCardImageSrc } from "@/lib/card-image-url"
import { formatCardFinishLabel } from "@/lib/card-labels"
import { getPokemonSummary } from "@/lib/pokemon-catalog"
import { Ticket, X } from "lucide-react"
import type { User } from "@supabase/supabase-js"
import { BinderValue } from "@/components/binder-value"
import type { BinderSettings } from "@/hooks/use-settings"
import type { CardScanImageCandidate } from "@/lib/card-scan-evidence"
import type { AggregatedCardScanMatch, CardScanFrameMatch } from "@/lib/card-scan-matching"
import type { ResolvedPricingPreferences } from "@/lib/pricing-region"
import type { RegionalCardPriceSnapshot } from "@/lib/regional-price"
import type { CardPriceSnapshot, SupportedCurrency } from "@/hooks/use-card-prices"
import type { CardSelectorMode } from "@/components/card-selector"
import type { PageScanCardMatchSummary, PageScanSummary } from "@/lib/page-scan"
import type { BinderPageScanResult } from "@/lib/binder-page-scan"
import type { TCGSetDexSlot, TCGSetSlotCard, TCGSetSummary } from "@/lib/tcg-set-slots"
import type { TCGCard } from "@/hooks/use-tcgdex"
import type { PokemonEntry, PokemonSummary } from "@/lib/pokemon-catalog"
import type { ChangeEvent, Dispatch, JSX, RefObject, SetStateAction } from "react"
import type { BinderCardDisplay } from "@/lib/selected-slot-card-display"
import type { BinderDesign, SurfaceDesign } from "@/lib/binder-design"
import type { WantedDashboardSummary } from "@/lib/wanted-dashboard"
import { rememberBinderScope, type AllBindersLookup } from "@/lib/binders/all-binders"
import type { CollectedPokemon, SaveCollectionOptions, WantedCard } from "@/hooks/use-collection"
import type { ActiveMainView, CollectionViewFilter, DisplaySpreadPage, PriceSummary } from "@/components/binder/binder-app-model"

export interface MainContentContext {
  assignWantedCard: (pokemonId: number, pokemonName: string, card: WantedCard, people: string[]) => void
  activeJumpLabel: "Needed" | "Perfect" | "Upgrade" | "Wanted"
  activeMainView: ActiveMainView
  addToCollection: (pokemonId: number, pokemonName: string, cardId?: string | undefined, cardName?: string | undefined, cardImage?: string | undefined, cardSet?: string | undefined, cardLanguage?: "en" | "fr" | "de" | "es" | "it" | "pt-br" | "ja" | "ko", status?: "collected" | "finalized" | "considering" | "wishlisted", options?: SaveCollectionOptions) => Promise<{ data?: CollectedPokemon | undefined; queued?: boolean | undefined; error?: string | undefined; }>
  allBinders: AllBindersLookup | null
  allBindersOwned: CollectedPokemon[] | null
  allBindersWantedDashboard: WantedDashboardSummary | null
  binderAppearance: { design: BinderDesign; uploads: Record<string, Blob>; artwork: Record<string, string>; loading: boolean; revision: number; hasSavedDesign: boolean; message: string; save: (nextDesign: BinderDesign, nextUploads: Record<string, Blob>, baseRevision?: number) => Promise<{ synced: boolean; revision: number; }>; refresh: () => Promise<void>; loadLatest: () => Promise<{ design: BinderDesign; uploads: Record<string, Blob>; revision: number; pending: boolean; } | null | undefined>; }
  binderCardDisplay: BinderCardDisplay
  binderDimension: "2d" | "3d"
  binderFitSize: { width: number; height: number; } | null
  pendingBinderPage: number | null
  binderPageRef: RefObject<HTMLDivElement | null>
  closeBurstScanner: () => void
  onHideBinderValue: () => void
  collection: CollectedPokemon[]
  collectionByPokemonId: Map<number, CollectedPokemon>
  collectionViewFilter: CollectionViewFilter
  currentBinderPage: number
  currentPageSlots: (PokemonEntry | null)[]
  dashboardBinderDesign: { rows: number; cols: number; pageCount: number; version: 1; name: string; surfaces: Record<"cover" | "back" | "spine" | "lining", SurfaceDesign>; material: "pebbled" | "smooth"; ink: string; font: "sans-serif" | "serif" | "monospace"; textSize: number; pageColor: string; pageColors: Record<string, string>; zip: { teeth: string; tape: string; pull: string; type: "metal" | "nylon"; }; stats: "off" | "compact" | "full"; }
  displayedSpreadPages: DisplaySpreadPage[]
  filteredPokemonList: PokemonEntry[]
  filteredPokemonSummaryList: PokemonSummary[]
  filteredTotalLabel: string
  getCollectionItem: (pokemonId: number) => CollectedPokemon | undefined
  getPageScanCardsForPokemon: (pokemonId: number) => Promise<TCGCard[]>
  handleClearWantedCard: (pokemonId: number, wantedCard: WantedCard) => Promise<void>
  handleCollectSetCard: (slot: TCGSetDexSlot, card: TCGSetSlotCard) => Promise<void>
  handleCollectSetCards: (cards: { slot: TCGSetDexSlot; card: TCGSetSlotCard; }[]) => Promise<void>
  handleGotWantedCard: (pokemonId: number, pokemonName: string, wantedCard: WantedCard) => Promise<void>
  handlePagePhotoSelected: (event: ChangeEvent<HTMLInputElement, JSX.Element>) => Promise<void>
  handleWantedSelect: (pokemon: PokemonSummary, card: WantedCard) => void
  handlePokemonSelect: (pokemon: PokemonSummary) => void
  handleQuickCollect: (pokemon: { id: number; name: string; }) => Promise<void>
  handleSelectSetSlot: (slot: TCGSetDexSlot) => void
  handleShareWantedList: (scope?: "binder" | "all") => Promise<void>
  handleSlotClick: (pokemon: { id: number; name: string; }) => void
  handleToggleFavorite: (pokemonId: number) => Promise<void>
  handleWantSetCard: (slot: TCGSetDexSlot, card: TCGSetSlotCard, toggle?: boolean) => Promise<void>
  handleWantSetCards: (cards: { slot: TCGSetDexSlot; card: TCGSetSlotCard; }[]) => Promise<void>
  hasTrackedCards: boolean
  initialBinderId: string | null
  isBurstScannerOpen: boolean
  isCollected: (pokemonId: number) => boolean
  isFilteredBinderLayout: boolean
  isLoadingPrices: boolean
  isOnline: boolean
  isPriceMode: boolean
  isShowModeOfferVisible: boolean
  isSpreadLayout: boolean
  jumpToWantedPokemonPage: (pokemon: PokemonSummary | null) => void
  mainViewRef: RefObject<HTMLDivElement | null>
  matchPageScanCards: (results: BinderPageScanResult[]) => Promise<PageScanCardMatchSummary[]>
  openCardBrowser: (pokemon: { id: number; name: string; }, options?: { highlightCardId?: string | null | undefined; fromDetail?: boolean | undefined; }) => void
  openCardSelectorForPokemon: (pokemon: PokemonSummary, mode: CardSelectorMode) => void
  openPriceLookup: (query: string) => void
  ownedElsewhereLabel: (pokemonId: number) => string | null
  ownedTotalLabel: string
  ownedTrackedCards: CollectedPokemon[]
  pagePhotoInputRef: RefObject<HTMLInputElement | null>
  pageScanError: string | null
  pageScanSummary: PageScanSummary | null
  prefersReducedMotion: boolean
  priceFormat: { label: (price: CardPriceSnapshot | undefined) => string | null; amount: (amount: number | null | undefined, price?: CardPriceSnapshot | undefined) => string | null; range: (low: number | null | undefined, high: number | null | undefined, price?: CardPriceSnapshot | undefined) => string | null; totals: (gbpTotal: number, originalTotals: Partial<Record<SupportedCurrency, number>>) => string; }
  pricesByCardId: Record<string, RegionalCardPriceSnapshot<CardPriceSnapshot>>
  pricingPreferences: ResolvedPricingPreferences
  rankPageSlotMatchesWithText: (matches: AggregatedCardScanMatch<TCGCard>[], cardImageCandidates?: CardScanImageCandidate[] | undefined, candidateCards?: TCGCard[] | undefined) => Promise<AggregatedCardScanMatch<TCGCard>[]>
  readOnlyMode: boolean
  renderBinderGridPage: (pageNumber: number, side: "left" | "right") => JSX.Element
  renderSpreadBlankPage: (side: "left" | "right") => JSX.Element
  renderSpreadInfoPage: (side: "left" | "right") => JSX.Element
  requestOwnedRemoval: (pokemon: { id: number; name: string; }) => void
  resolvedCollectionOwnerUserId: string | null
  scannerStartSlotIndex: number
  scorePageScanSlotCard: (cardImageDataUrl: string, pokemon: { id: number; name: string; }) => Promise<CardScanFrameMatch<TCGCard>[]>
  setBinderStageRef: (node: HTMLDivElement | null) => void
  setCurrentBinderPage: Dispatch<SetStateAction<number>>
  setIsScanningPage: Dispatch<SetStateAction<boolean>>
  setPageScanError: Dispatch<SetStateAction<string | null>>
  setPageScanSummary: Dispatch<SetStateAction<PageScanSummary | null>>
  setShowMode: (on: boolean) => void
  /** A set hit tapped in Search or Quick mode: Sets opens on it (the key remounts Sets for a new pick). */
  setViewRequest: { set: TCGSetSummary; key: number } | null
  settings: BinderSettings
  snoozeShowModePrompt: () => void
  switchMainView: (view: ActiveMainView) => Promise<void>
  user: User | null
  viewLoadError: string | null
  visiblePageLabel: string
  visiblePagePriceSummary: PriceSummary
  visiblePageTotalLabel: string
  wantedCardEntries: { pokemonId: number; pokemonName: string; card: WantedCard; }[]
  wantedDashboard: WantedDashboardSummary
  wantedModeCombinedPriceSummary: PriceSummary
  wantedModeCombinedTotalLabel: string
  wantedShareMessage: string | null
  wantedTotalLabel: string
}

export function renderMainContentView(ctx: MainContentContext) {
  const { onHideBinderValue, assignWantedCard, pendingBinderPage, activeJumpLabel, activeMainView, addToCollection, allBinders, allBindersOwned, allBindersWantedDashboard, binderAppearance, binderCardDisplay, binderDimension, binderFitSize, binderPageRef, closeBurstScanner, collection, collectionByPokemonId, collectionViewFilter, currentBinderPage, currentPageSlots, dashboardBinderDesign, displayedSpreadPages, filteredPokemonList, filteredPokemonSummaryList, filteredTotalLabel, getCollectionItem, getPageScanCardsForPokemon, handleClearWantedCard, handleCollectSetCard, handleCollectSetCards, handleGotWantedCard, handlePagePhotoSelected, handlePokemonSelect, handleWantedSelect, handleQuickCollect, handleSelectSetSlot, handleShareWantedList, handleSlotClick, handleToggleFavorite, handleWantSetCard, handleWantSetCards, hasTrackedCards, initialBinderId, isBurstScannerOpen, isCollected, isFilteredBinderLayout, isLoadingPrices, isOnline, isPriceMode, isShowModeOfferVisible, isSpreadLayout, jumpToWantedPokemonPage, mainViewRef, matchPageScanCards, openCardBrowser, openCardSelectorForPokemon, openPriceLookup, ownedElsewhereLabel, ownedTotalLabel, ownedTrackedCards, pagePhotoInputRef, pageScanError, pageScanSummary, prefersReducedMotion, priceFormat, pricesByCardId, pricingPreferences, rankPageSlotMatchesWithText, readOnlyMode, renderBinderGridPage, renderSpreadBlankPage, renderSpreadInfoPage, requestOwnedRemoval, resolvedCollectionOwnerUserId, scannerStartSlotIndex, scorePageScanSlotCard, setBinderStageRef, setCurrentBinderPage, setIsScanningPage, setPageScanError, setPageScanSummary, setShowMode, setViewRequest, settings, snoozeShowModePrompt, switchMainView, user, viewLoadError, visiblePageLabel, visiblePagePriceSummary, visiblePageTotalLabel, wantedCardEntries, wantedDashboard, wantedModeCombinedPriceSummary, wantedModeCombinedTotalLabel, wantedShareMessage, wantedTotalLabel } = ctx
  return (
    <div data-testid="main-content" className={`mx-auto flex min-h-0 w-full max-w-[100vw] flex-1 flex-col overflow-hidden px-2 pb-[calc(var(--dock-clearance)+0.5rem)] sm:px-4 md:pb-4 ${activeMainView === "binder" ? "max-w-none" : "max-w-7xl"}`}>
      <input
        ref={pagePhotoInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handlePagePhotoSelected}
      />


      {isBurstScannerOpen && (
        <PageScanner
          initialSlotIndex={scannerStartSlotIndex}
          currentPageSlots={currentPageSlots}
          currentBinderPage={currentBinderPage}
          binderRows={settings.binderRows}
          binderCols={settings.binderCols}
          readOnlyMode={readOnlyMode}
          addToCollection={addToCollection}
          getCollectionItem={getCollectionItem}
          isCollected={isCollected}
          matchPageScanCards={matchPageScanCards}
          scorePageScanSlotCard={scorePageScanSlotCard}
          getPageScanCardsForPokemon={getPageScanCardsForPokemon}
          rankPageSlotMatchesWithText={rankPageSlotMatchesWithText}
          setIsScanningPage={setIsScanningPage}
          setPageScanSummary={setPageScanSummary}
          setPageScanError={setPageScanError}
          onClose={closeBurstScanner}
        />
      )}

      {isShowModeOfferVisible && (
        <section aria-label="At a card show?" className="mb-2 flex shrink-0 items-center gap-2 rounded-2xl border border-amber-400/45 bg-amber-400/12 py-0.5 pl-3 pr-0.5">
          <Ticket className="h-5 w-5 shrink-0 text-amber-500" aria-hidden />
          <p className="min-w-0 flex-1 truncate text-sm leading-tight">
            <span className="font-bold">At a card show?</span>{" "}
            <span className="text-xs text-muted-foreground">{isOnline ? "Quick search, screen on" : "Offline: Show mode uses saved cards"}</span>
          </p>
          <Button className="h-11 shrink-0 rounded-xl px-3 text-sm font-semibold" onClick={() => setShowMode(true)} aria-label="Turn on Show mode">
            Turn on
          </Button>
          <button type="button" onClick={snoozeShowModePrompt} aria-label="Not now" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </section>
      )}

      {activeMainView === "binder" && binderAppearance.message && (
        <span role="status" className="text-[10px] text-muted-foreground">{binderAppearance.message}</span>
      )}

      <div ref={mainViewRef} className={`flex min-h-0 flex-1 flex-col space-y-2 ${
          activeMainView === "binder"
            ? binderDimension === "3d" ? "overflow-y-auto overflow-x-hidden" : "overflow-y-auto overflow-x-hidden md:overflow-visible"
            : "overflow-hidden"
        }`}>
        {viewLoadError ? <p role="alert" className="shrink-0 rounded-2xl border border-border/55 bg-card/70 p-3 text-sm">{viewLoadError}</p> : null}
        {activeMainView === "binder" && !readOnlyMode && settings.showBinderValue !== false && <BinderValue onDismiss={onHideBinderValue} collection={collection} prices={pricesByCardId} loading={isLoadingPrices} onOpen={() => { rememberBinderScope("analytics", "binder"); void switchMainView("analytics") }} />}
        {(activeMainView === "pokemon" || activeMainView === "sets") ? (
          <div role="group" aria-label="Browse perspective" className="flex shrink-0 gap-2 px-1 py-1">
            {(["pokemon", "sets"] as const).map(view => <button key={view} type="button" aria-pressed={activeMainView === view} onClick={() => switchMainView(view)} className={`min-h-9 rounded-full border px-4 text-xs font-semibold ${activeMainView === view ? "border-primary/45 bg-primary text-primary-foreground" : "border-border/55 bg-card/70"}`}>{view === "pokemon" ? "Pokémon" : "Sets"}</button>)}
          </div>
        ) : null}
        {!readOnlyMode && (activeMainView === "list" || activeMainView === "wanted") && (
          <CollectionPriceCheck key={activeMainView} collection={collection} kind={activeMainView === "wanted" ? "wanted" : "owned"} isOnline={isOnline} />
        )}
        {activeMainView === "pokemon" ? (
          <PokemonBrowseView collectionByPokemonId={collectionByPokemonId} ownedElsewhere={allBinders ? ownedElsewhereLabel : undefined} onBrowsePokemon={pokemon => openCardBrowser(pokemon)} />
        ) : activeMainView === "analytics" ? (
          <CollectionAnalyticsView collection={collection} allBindersCollection={allBindersOwned} pricesByKey={pricesByCardId} ownerId={user ? resolvedCollectionOwnerUserId : null} readOnly={readOnlyMode} isOnline={isOnline} isLoadingPrices={isLoadingPrices} onBrowsePokemon={openCardBrowser} />
        ) : activeMainView === "list" ? (
          <DexListView
            pokemonList={filteredPokemonSummaryList}
            collectionByPokemonId={collectionByPokemonId}
            pricesByKey={pricesByCardId}
            getPriceKey={getCollectionItemPriceKey}
            formatPrice={priceFormat.label}
            onSelectPokemon={handlePokemonSelect}
            onToggleOwned={handleQuickCollect}
            onRemoveOwned={requestOwnedRemoval}
            onAddCard={(pokemon) => openCardSelectorForPokemon(pokemon, "collect")}
            onAddWanted={(pokemon) => openCardSelectorForPokemon(pokemon, "wishlist")}
            onTogglePerfect={handleToggleFavorite}
            onBrowseCards={(pokemon) => openCardBrowser({ id: pokemon.id, name: pokemon.name })}
            readOnly={readOnlyMode}
          />
        ) : activeMainView === "wanted" ? (
          <WantedDashboard
            user={readOnlyMode ? null : user}
            isOnline={isOnline}
            loadedBinderCount={allBinders?.loadedBinderIds?.length ?? 1}
            binderCount={allBinders?.binders.length ?? 1}
            onAssignWanted={assignWantedCard}
            wantedDashboard={wantedDashboard}
            allBindersDashboard={allBindersWantedDashboard}
            currentBinderId={initialBinderId}
            priceFormat={priceFormat}
            isLoadingPrices={isLoadingPrices}
            readOnlyMode={readOnlyMode}
            wantedShareMessage={wantedShareMessage}
            handleShareWantedList={handleShareWantedList}
            handleGotWantedCard={handleGotWantedCard}
            handleClearWantedCard={handleClearWantedCard}
            handlePokemonSelect={handleWantedSelect}
            jumpToWantedPokemonPage={jumpToWantedPokemonPage}
            onCheckAnyCardPrice={openPriceLookup}
          />
        ) : activeMainView === "sets" ? (
          <SetPopulationView
            key={setViewRequest?.key ?? "sets"}
            initialSet={setViewRequest?.set ?? null}
            collectionByPokemonId={collectionByPokemonId}
            formatPrice={priceFormat.label}
            pricingRegion={pricingPreferences.region}
            onSelectSlot={handleSelectSetSlot}
            onBrowseCard={(slot, card) => openCardBrowser({ id: slot.dexId, name: slot.pokemonName }, { highlightCardId: card.id })}
            onCollectCard={handleCollectSetCard}
            onWantCard={(slot, card) => handleWantSetCard(slot, card, true)}
            onCollectCards={handleCollectSetCards}
            onWantCards={handleWantSetCards}
            readOnly={readOnlyMode}
          />
        ) : binderDimension === "3d" ? (
          <DashboardBinderPreview
            onSelectPokemon={pokemon => { handlePokemonSelect(pokemon); handleSlotClick(pokemon) }}
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
          {(pageScanSummary || pageScanError || isFilteredBinderLayout) && (
            <div className="rounded-xl border border-border/60 bg-card/82 px-3 py-2 text-xs text-muted-foreground dark:border-border/50 dark:bg-card/70">
              {pageScanError ? (
                <p>{pageScanError}</p>
              ) : pageScanSummary ? (
                <div className="space-y-1">
                  <p>
                    Page {pageScanSummary.page}: detected {pageScanSummary.detectedOccupied} occupied slot{pageScanSummary.detectedOccupied === 1 ? "" : "s"}, added {pageScanSummary.newCollected} new card{pageScanSummary.newCollected === 1 ? "" : "s"}
                    {pageScanSummary.alreadyCollected > 0 ? `, ${pageScanSummary.alreadyCollected} already collected` : ""}
                    {pageScanSummary.matchedCards > 0 ? `, matched ${pageScanSummary.matchedCards} card${pageScanSummary.matchedCards === 1 ? "" : "s"}` : ""}.
                  </p>
                  {pageScanSummary.cardMatches.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {pageScanSummary.cardMatches.slice(0, 4).map((match) => (
                        <span key={`${match.slotLabel}-${match.cardName}-${match.setName}`} className="rounded-full border border-border/60 bg-background/60 px-2 py-0.5 text-[11px] text-foreground dark:border-border/50 dark:bg-background/40">
                          {match.slotLabel} {match.cardName} · {Math.round(match.confidence * 100)}%
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <p>Scanning is disabled while a card-status filter is on, because those pages no longer match your binder layout.</p>
              )}
              <p className="mt-1 hidden text-[11px] text-muted-foreground/80 sm:block">
                The scanner checks slot occupancy and compares occupied pockets against the closest cards for each slot. Fill the frame with one page and keep the pockets sharp.
              </p>
            </div>
          )}

          {collectionViewFilter === "wanted" && (
            <div className="shrink-0 rounded-xl border border-amber-400/25 bg-amber-400/8 p-1.5 sm:p-2">
              <div className="mb-1.5 grid grid-cols-2 gap-1.5 sm:mb-2 sm:grid-cols-3 sm:gap-2">
                <div className="hidden rounded-lg border border-amber-400/18 bg-card/78 px-3 py-2 sm:block">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">All tracked</p>
                  <p className="mt-0.5 text-sm font-semibold tabular-nums">{wantedModeCombinedTotalLabel || (isLoadingPrices ? "Loading prices" : "No prices yet")}</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">{ownedTrackedCards.length + wantedCardEntries.length} cards, owned and wanted</p>
                </div>
                <div className="min-w-0 rounded-lg border border-emerald-400/18 bg-card/78 px-2.5 py-2 sm:px-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Owned value</p>
                  <p className="mt-0.5 truncate text-[13px] font-semibold tabular-nums sm:text-sm">{ownedTotalLabel || (isLoadingPrices ? "Loading" : "No prices")}</p>
                  <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{ownedTrackedCards.length} owned card{ownedTrackedCards.length === 1 ? "" : "s"}</p>
                </div>
                <div className="min-w-0 rounded-lg border border-amber-400/22 bg-card/78 px-2.5 py-2 sm:px-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">To buy</p>
                  <p className="mt-0.5 truncate text-[13px] font-semibold tabular-nums text-amber-600 dark:text-amber-300 sm:text-sm">{wantedTotalLabel || (isLoadingPrices ? "Loading" : "No prices")}</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {wantedCardEntries.length} wanted card{wantedCardEntries.length === 1 ? "" : "s"}
                    {wantedModeCombinedPriceSummary.unpricedCount > 0 ? `, ${wantedModeCombinedPriceSummary.unpricedCount} unpriced` : ""}
                  </p>
                </div>
              </div>
              <div className="overflow-x-auto scrollbar-hide">
                <div className="flex min-w-max gap-2">
                  {wantedCardEntries.length === 0 ? (
                    <div className="px-2 py-1 text-xs text-muted-foreground">No wanted cards yet</div>
                  ) : wantedCardEntries.map(({ pokemonId, pokemonName, card }) => {
                    const priceKey = getCardPriceKey(card.card_id, card.card_language ?? "en")
                    const priceLabel = priceFormat.label(pricesByCardId[priceKey])

                    return (
                      <button
                        key={`${pokemonId}-${card.card_id}-${card.card_finish ?? "normal"}`}
                        onClick={() => {
                          const pokemon = getPokemonSummary(pokemonId)
                          if (pokemon) {
                            handlePokemonSelect(pokemon)
                          }
                        }}
                        className="flex w-44 shrink-0 items-center gap-2 rounded-lg border border-amber-400/20 bg-card/82 p-1.5 text-left sm:w-56 sm:p-2"
                      >
                        {card.card_image ? (
                          <img src={toCardImageSrc(card.card_image) ?? undefined} alt={card.card_name} className="trading-card w-8 object-cover sm:w-10" loading="lazy" />
                        ) : (
                          <div className="h-12 w-8 rounded bg-muted sm:h-14 sm:w-10" />
                        )}
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold">{card.card_name}</p>
                          <p className="truncate text-[10px] text-muted-foreground">{pokemonName} · {formatCardFinishLabel(card.card_finish)}</p>
                          <p className="mt-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-300">{priceLabel ?? (isLoadingPrices ? "Loading price" : "No price")}</p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Binder Grid */}
          <div ref={setBinderStageRef} className="flex min-h-0 flex-1 touch-pan-y items-center justify-center overflow-hidden overscroll-x-contain">
            <div
              ref={binderPageRef}
              aria-busy={pendingBinderPage !== null}
              data-page-turn-ms={prefersReducedMotion ? 0 : PAGE_TURN_MS}
              className="relative max-h-full max-w-full"
              style={{
                width: binderFitSize ? `${binderFitSize.width}px` : "100%",
                height: binderFitSize ? `${binderFitSize.height}px` : "auto",
              }}
            >
              {pendingBinderPage !== null && <span role="status" className="animate-[fade-in_120ms_ease-out_200ms_both] absolute left-1/2 top-2 z-20 -translate-x-1/2 rounded-full bg-background/90 px-3 py-1 text-xs text-muted-foreground">Loading page {pendingBinderPage}…</span>}
              <div inert={pendingBinderPage !== null} className={`grid h-full w-full ${isSpreadLayout ? "grid-cols-2 gap-3 xl:gap-4" : "grid-cols-1"}`}>
                {displayedSpreadPages.map((page) => {
                  if (page.kind === "info") {
                    return renderSpreadInfoPage(page.side)
                  }

                  if (page.kind === "blank") {
                    return renderSpreadBlankPage(page.side)
                  }

                  return renderBinderGridPage(page.pageNumber, page.side)
                })}
              </div>
            </div>
          </div>

          {/* Page Info Footer */}
          <div className="hidden shrink-0 flex-col items-center justify-center gap-1 text-[10px] text-muted-foreground/70 md:hidden">
            {isPriceMode && hasTrackedCards && (
              <p className="text-center text-[10px] font-medium text-primary/85">
                {visiblePageLabel} {visiblePageTotalLabel || "No page prices"}
                {filteredTotalLabel ? ` · Filter total ${filteredTotalLabel}` : ""}
                {visiblePagePriceSummary.unpricedCount > 0 ? ` · ${visiblePagePriceSummary.unpricedCount} unpriced in view` : ""}
              </p>
            )}
            <div className="flex items-center justify-center gap-3">
            <span className="tabular-nums">{settings.binderRows}x{settings.binderCols} Binder</span>
            <span className="w-px h-3 bg-border/50" />
            <span className="tabular-nums">{visiblePageLabel}</span>
            <span className="w-px h-3 bg-border/50 sm:block" />
            <span className="tabular-nums">{filteredPokemonList.length} Pokemon</span>
            <span className="hidden sm:block w-px h-3 bg-border/50" />
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
)
}
