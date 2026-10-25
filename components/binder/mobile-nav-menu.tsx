"use client"

import { COLLECTION_VIEW_FILTERS, GENERATIONS } from "@/components/binder/binder-app-model"
import dashboardStyles from "@/components/dashboard-binder-preview.module.css"
import { Button } from "@/components/ui/button"
import { BookOpen, Camera, ChevronLeft, ChevronRight, X } from "lucide-react"
import type { PokemonSummary } from "@/lib/pokemon-catalog"
import type { Dispatch, JSX, PointerEvent as ReactPointerEvent, RefObject, SetStateAction } from "react"
import type { ActiveMainView, CollectionViewFilter } from "@/components/binder/binder-app-model"

export interface MobileNavMenuContext {
  activeMainView: ActiveMainView
  binderCardControls: JSX.Element
  binderDisplayControls: JSX.Element
  canFilterCollection: boolean
  closeControlsSheet: () => void
  collectionStats: { collected: number; total: number; percentage: number; }
  collectionViewFilter: CollectionViewFilter
  controlsSheetRef: RefObject<HTMLDivElement | null>
  controlsSheetSwipe: { onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void; onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void; onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void; onPointerCancel: () => void; style: { touchAction: "none"; }; }
  currentPagePokemon: PokemonSummary[]
  handlePhotoButtonClick: () => void
  hasTrackedCards: boolean
  isCompactViewport: boolean
  isDesktopViewport: boolean
  isFilteredBinderLayout: boolean
  isLoadingPrices: boolean
  isMobileNavExpanded: boolean
  isMobileSpreadPreview: boolean
  isPriceMode: boolean
  isScanningPage: boolean
  isSearchOpen: boolean
  readOnlyMode: boolean
  selectedGen: number
  setCollectionViewFilter: Dispatch<SetStateAction<CollectionViewFilter>>
  setIsMobileNavExpanded: Dispatch<SetStateAction<boolean>>
  setIsMobileSpreadPreview: Dispatch<SetStateAction<boolean>>
  setIsPriceMode: Dispatch<SetStateAction<boolean>>
  setSelectedGen: Dispatch<SetStateAction<number>>
  switchMainView: (view: ActiveMainView) => Promise<void>
}

export function renderMobileNavMenuView(ctx: MobileNavMenuContext) {
  const { activeMainView, binderCardControls, binderDisplayControls, canFilterCollection, closeControlsSheet, collectionStats, collectionViewFilter, controlsSheetRef, controlsSheetSwipe, currentPagePokemon, handlePhotoButtonClick, hasTrackedCards, isCompactViewport, isDesktopViewport, isFilteredBinderLayout, isLoadingPrices, isMobileNavExpanded, isMobileSpreadPreview, isPriceMode, isScanningPage, isSearchOpen, readOnlyMode, selectedGen, setCollectionViewFilter, setIsMobileNavExpanded, setIsMobileSpreadPreview, setIsPriceMode, setSelectedGen, switchMainView } = ctx
  return (
    isMobileNavExpanded && !isSearchOpen && (
      <div data-overlay-backdrop className="fixed inset-0 z-40 bg-black/45" onClick={closeControlsSheet}>
        <div
          ref={controlsSheetRef}
          role="dialog"
          aria-modal="true"
          aria-label={isDesktopViewport ? "View options" : "Controls"}
          className={`${dashboardStyles.viewOptions} absolute inset-x-0 bottom-0 flex flex-col overflow-hidden outline-none rounded-t-[1.75rem] border-t border-border/65 bg-card px-4 pb-[calc(var(--dock-clearance)+1rem)] pt-3 shadow-[0_-24px_64px_-32px_rgba(15,23,42,0.35)] dark:border-border/50 dark:bg-background dark:shadow-2xl md:inset-x-auto md:bottom-auto md:right-4 md:top-24 md:w-80 md:rounded-2xl md:border md:pb-3`}
          onClick={(event) => event.stopPropagation()}
          style={{
            maxHeight: isDesktopViewport ? "calc(100dvh - 7rem)" : "calc(100dvh - var(--top-inset) - 0.25rem)",
            WebkitOverflowScrolling: "touch",
            touchAction: "pan-y",
          }}
        >
          <div data-sheet-grabber className="-mx-4 -mt-3 shrink-0 px-4 pt-3" {...controlsSheetSwipe}>
          <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-border/60 md:hidden" />
          <div className="mb-3 flex items-center justify-between gap-3 md:mb-2">
            <div>
              <p className="text-sm font-semibold">{isDesktopViewport ? "View options" : "Controls"}</p>
              <p className="text-xs text-muted-foreground md:hidden">{collectionStats.percentage}% complete</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0 rounded-full"
              onClick={closeControlsSheet}
              aria-label={isDesktopViewport ? "Close view options" : "Close controls"}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          </div>

          <div className="min-h-0 space-y-3 overflow-y-auto overscroll-contain md:space-y-2">
            {!readOnlyMode && <button className="min-h-10 md:hidden w-full rounded-xl border border-border px-3 py-2 text-left text-sm font-medium" onClick={() => void switchMainView("analytics")}>Analytics</button>}
            {activeMainView !== "pokemon" && activeMainView !== "analytics" && <>
            {activeMainView === "binder" && <div className="hidden space-y-2 md:block">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-medium text-muted-foreground">Cards</p>
                {binderCardControls}
              </div>
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-medium text-muted-foreground">Display</p>
                {binderDisplayControls}
              </div>
            </div>}
            <div className="space-y-3 md:grid md:grid-cols-[4.5rem_1fr] md:items-center md:gap-2 md:space-y-0">
            <label htmlFor="binder-generation" className="block text-xs font-medium text-muted-foreground">Generation</label>
            <div className="grid grid-cols-[auto_1fr_auto] items-center gap-1 rounded-2xl md:rounded-lg border border-border/60 bg-background/62 p-1 dark:border-border/40 dark:bg-muted/35">
              <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl md:rounded-md" onClick={() => setSelectedGen(prev => prev > 0 ? prev - 1 : GENERATIONS.length - 1)} aria-label="Previous generation">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <select
                id="binder-generation"
                value={selectedGen}
                onChange={(e) => setSelectedGen(Number(e.target.value))}
                className="h-9 min-w-0 bg-transparent text-center text-sm md:text-xs font-semibold cursor-pointer focus:outline-none"
              >
                {GENERATIONS.map((gen) => (
                  <option key={gen.id} value={gen.id}>
                    {gen.id === 0 ? "All generations" : `Gen ${gen.id}${gen.region ? ` ${gen.region}` : ""}`}
                  </option>
                ))}
              </select>
              <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl md:rounded-md" onClick={() => setSelectedGen(prev => prev < GENERATIONS.length - 1 ? prev + 1 : 0)} aria-label="Next generation">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            </div>

            {isCompactViewport && (
              <button
                onClick={() => setIsMobileSpreadPreview((current) => !current)}
                aria-pressed={isMobileSpreadPreview}
                className={`flex h-11 w-full items-center justify-between rounded-2xl border px-4 text-sm font-semibold transition-[background-color,border-color,color] ${
                    isMobileSpreadPreview
                      ? "border-primary/30 bg-primary/12 text-primary"
                      : "border-border/60 bg-background/62 text-foreground dark:border-border/40 dark:bg-muted/35"
                  }`}
              >
                <span className="flex items-center gap-2">
                  <BookOpen className="h-4 w-4" />
                  Spread preview
                </span>
                <span className="text-xs text-muted-foreground">{isMobileSpreadPreview ? "On" : "Off"}</span>
              </button>
            )}

            {canFilterCollection && (
              <div>
              <p className="mb-2 hidden text-xs font-medium text-muted-foreground md:block">Show slots</p>
              <div role="group" aria-label="Slot filters" className="grid grid-cols-2 gap-2 md:flex md:flex-wrap md:gap-1">
                {COLLECTION_VIEW_FILTERS.map((filterOption) => {
                  const isActive = collectionViewFilter === filterOption.id

                  return (
                    <button
                      key={filterOption.id}
                      onClick={() => {
                        setCollectionViewFilter(filterOption.id)
                        setIsMobileNavExpanded(false)
                      }}
                      aria-pressed={isActive}
                      className={`h-11 rounded-2xl border md:h-9 md:flex-[1_0_28%] md:rounded-lg md:px-2.5 md:text-xs px-3 text-sm font-semibold transition-[background-color,border-color,color] ${
                          isActive
                            ? "border-primary/35 bg-primary/12 text-primary"
                            : "border-border/60 bg-background/62 text-muted-foreground dark:border-border/40 dark:bg-muted/35"
                        }`}
                    >
                      {filterOption.mobileLabel}
                    </button>
                  )
                })}
              </div>
              </div>
            )}

            <div className={`grid gap-2 md:flex md:flex-col md:gap-0 md:border-t md:border-border/60 md:pt-1 ${hasTrackedCards ? "grid-cols-2" : "grid-cols-1"}`}>
              {hasTrackedCards && (
                <button
                  onClick={() => setIsPriceMode((current) => !current)}
                  aria-pressed={isPriceMode}
                  className={`h-11 rounded-2xl border md:flex md:h-9 md:items-center md:justify-between md:rounded-lg md:border-0 md:bg-transparent md:px-2 md:text-xs md:hover:bg-muted dark:md:bg-transparent px-3 text-sm font-semibold transition-[background-color,border-color,color] ${
                      isPriceMode
                        ? "border-primary/35 bg-primary/12 text-primary"
                        : "border-border/60 bg-background/62 text-muted-foreground dark:border-border/40 dark:bg-muted/35"
                    }`}
                >
                  <span>{isLoadingPrices && isPriceMode ? "Loading prices" : "Prices"}</span>
                  <span className="hidden text-muted-foreground md:inline">{isPriceMode ? "On" : "Off"}</span>
                </button>
              )}
              <button
                onClick={() => { closeControlsSheet(); handlePhotoButtonClick() }}
                disabled={isScanningPage || isFilteredBinderLayout || currentPagePokemon.length === 0}
                className="h-11 rounded-2xl border md:flex md:h-9 md:items-center md:justify-between md:rounded-lg md:border-0 md:bg-transparent md:px-2 md:text-xs md:hover:bg-muted dark:md:bg-transparent border-border/60 bg-background/62 px-3 text-sm font-semibold text-muted-foreground transition-[background-color,border-color,color,opacity] disabled:opacity-45 dark:border-border/40 dark:bg-muted/35"
              >
                <span>{isScanningPage ? "Scanning" : "Scan page"}</span>
                <Camera aria-hidden="true" className="hidden h-3.5 w-3.5 md:block" />
              </button>
            </div>
            </>}
          </div>
        </div>
      </div>
    )
)
}
