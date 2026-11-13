'use client';

import { COLLECTION_VIEW_FILTERS, GENERATIONS } from '@/components/binder/binder-app-model';
import dashboardStyles from '@/components/dashboard-binder-preview.module.css';
import { Button } from '@/components/ui/button';
import { OverlayDialog } from '@/components/ui/overlay-dialog';
import { BookOpen, Camera, ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { PokemonSummary } from '@/lib/pokemon-catalog';
import type { Dispatch, JSX, SetStateAction } from 'react';
import type { ActiveMainView, CollectionViewFilter } from '@/components/binder/binder-app-model';

export interface MobileNavMenuContext {
  activeMainView: ActiveMainView;
  binderDisplayControls: JSX.Element;
  canFilterCollection: boolean;
  closeControlsSheet: () => void;
  collectionStats: { collected: number; total: number; percentage: number };
  collectionViewFilter: CollectionViewFilter;
  currentPagePokemon: PokemonSummary[];
  handlePhotoButtonClick: () => void;
  hasTrackedCards: boolean;
  isCompactViewport: boolean;
  isDesktopViewport: boolean;
  isFilteredBinderLayout: boolean;
  isLoadingPrices: boolean;
  isMobileNavExpanded: boolean;
  isMobileSpreadPreview: boolean;
  pricingEnabled: boolean;
  isPriceMode: boolean;
  isSearchOpen: boolean;
  readOnlyMode: boolean;
  selectedGen: number;
  setCollectionViewFilter: Dispatch<SetStateAction<CollectionViewFilter>>;
  setIsMobileNavExpanded: Dispatch<SetStateAction<boolean>>;
  setIsMobileSpreadPreview: Dispatch<SetStateAction<boolean>>;
  setIsPriceMode: Dispatch<SetStateAction<boolean>>;
  setSelectedGen: Dispatch<SetStateAction<number>>;
  switchMainView: (view: ActiveMainView) => Promise<void>;
}

export function renderMobileNavMenuView(ctx: MobileNavMenuContext) {
  const {
    activeMainView,
    binderDisplayControls,
    canFilterCollection,
    closeControlsSheet,
    collectionViewFilter,
    currentPagePokemon,
    handlePhotoButtonClick,
    hasTrackedCards,
    isCompactViewport,
    isDesktopViewport,
    isFilteredBinderLayout,
    isLoadingPrices,
    isMobileNavExpanded,
    isMobileSpreadPreview,
    isPriceMode,
    isSearchOpen,
    selectedGen,
    setCollectionViewFilter,
    setIsMobileNavExpanded,
    setIsMobileSpreadPreview,
    setIsPriceMode,
    setSelectedGen,
  } = ctx;
  return (
    isMobileNavExpanded &&
    !isSearchOpen && (
      <OverlayDialog
        modal={false}
        portal={false}
        onClose={closeControlsSheet}
        swipe={!isDesktopViewport}
        layerClassName="z-40"
        backdropProps={{ className: 'bg-black/45' }}
        aria-label="View options"
        className={`${dashboardStyles.viewOptions} border-border/65 bg-card dark:border-border/50 absolute inset-x-0 bottom-0 flex flex-col overflow-hidden rounded-t-[1.75rem] border-t px-4 pt-3 pb-[calc(var(--dock-clearance)+1rem)] shadow-[0_-24px_64px_-32px_rgba(15,23,42,0.35)] outline-none md:inset-x-auto md:top-24 md:right-4 md:bottom-auto md:w-80 md:rounded-2xl md:border md:pb-3 dark:shadow-2xl`}
        style={{
          maxHeight: isDesktopViewport ? 'calc(100dvh - 7rem)' : 'calc(100dvh - var(--top-inset) - 0.25rem)',
          WebkitOverflowScrolling: 'touch',
          touchAction: 'pan-y',
        }}
      >
        <div data-sheet-grabber className="-mx-4 -mt-3 shrink-0 px-4 pt-3">
          <div className="bg-border/60 mx-auto mb-3 h-1.5 w-12 rounded-full md:hidden" />
          <div className="mb-3 flex items-center justify-between gap-3 md:mb-2">
            <div>
              <p className="text-sm font-semibold">View options</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0 rounded-full"
              onClick={closeControlsSheet}
              aria-label="Close view options"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="min-h-0 space-y-3 overflow-y-auto overscroll-contain md:space-y-2">
          {activeMainView !== 'pokemon' && activeMainView !== 'analytics' && (
            <>
              {activeMainView === 'binder' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-muted-foreground text-xs font-medium">Display</p>
                    {binderDisplayControls}
                  </div>
                </div>
              )}
              <div className="space-y-3 md:grid md:grid-cols-[4.5rem_1fr] md:items-center md:gap-2 md:space-y-0">
                <label htmlFor="binder-generation" className="text-muted-foreground block text-xs font-medium">
                  Generation
                </label>
                <div className="border-border/60 bg-background/62 dark:border-border/40 dark:bg-muted/35 grid grid-cols-[auto_1fr_auto] items-center gap-1 rounded-2xl border p-1 md:rounded-lg">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 rounded-xl md:rounded-md"
                    onClick={() => setSelectedGen((prev) => (prev > 0 ? prev - 1 : GENERATIONS.length - 1))}
                    aria-label="Previous generation"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <select
                    id="binder-generation"
                    value={selectedGen}
                    onChange={(e) => setSelectedGen(Number(e.target.value))}
                    className="h-9 min-w-0 cursor-pointer bg-transparent text-center text-base font-semibold focus:outline-none md:text-xs"
                  >
                    {GENERATIONS.map((gen) => (
                      <option key={gen.id} value={gen.id}>
                        {gen.id === 0 ? 'All generations' : `Gen ${gen.id}${gen.region ? ` ${gen.region}` : ''}`}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 rounded-xl md:rounded-md"
                    onClick={() => setSelectedGen((prev) => (prev < GENERATIONS.length - 1 ? prev + 1 : 0))}
                    aria-label="Next generation"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {isCompactViewport && (
                <button
                  type="button"
                  onClick={() => setIsMobileSpreadPreview((current) => !current)}
                  aria-pressed={isMobileSpreadPreview}
                  className={`flex h-11 w-full items-center justify-between rounded-2xl border px-4 text-sm font-semibold transition-[background-color,border-color,color] ${
                    isMobileSpreadPreview
                      ? 'border-primary/30 bg-primary/12 text-primary'
                      : 'border-border/60 bg-background/62 text-foreground dark:border-border/40 dark:bg-muted/35'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <BookOpen className="h-4 w-4" />
                    Spread preview
                  </span>
                  <span className="text-muted-foreground text-xs">{isMobileSpreadPreview ? 'On' : 'Off'}</span>
                </button>
              )}

              {canFilterCollection && (
                <div>
                  <p className="text-muted-foreground mb-2 text-xs font-medium">Show slots</p>
                  <div
                    role="group"
                    aria-label="Slot filters"
                    className="grid grid-cols-3 gap-1 md:flex md:flex-wrap md:gap-1"
                  >
                    {COLLECTION_VIEW_FILTERS.map((filterOption) => {
                      const isActive = collectionViewFilter === filterOption.id;

                      return (
                        <button
                          type="button"
                          key={filterOption.id}
                          onClick={() => {
                            setCollectionViewFilter(filterOption.id);
                            setIsMobileNavExpanded(false);
                          }}
                          aria-pressed={isActive}
                          className={`h-11 rounded-lg border border-transparent px-3 text-sm font-semibold transition-[background-color,border-color,color] md:h-9 md:flex-[1_0_28%] md:rounded-lg md:px-2.5 md:text-xs ${
                            isActive
                              ? 'bg-primary/12 text-primary border-transparent'
                              : 'bg-muted/40 text-muted-foreground border-transparent'
                          }`}
                        >
                          {filterOption.mobileLabel}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div
                className={`md:border-border/60 grid gap-2 md:flex md:flex-col md:gap-0 md:border-t md:pt-1 ${hasTrackedCards && ctx.pricingEnabled ? 'grid-cols-2' : 'grid-cols-1'}`}
              >
                {hasTrackedCards && ctx.pricingEnabled && (
                  <button
                    type="button"
                    onClick={() => setIsPriceMode((current) => !current)}
                    aria-pressed={isPriceMode}
                    className={`md:hover:bg-muted h-11 rounded-2xl border px-3 text-sm font-semibold transition-[background-color,border-color,color] md:flex md:h-9 md:items-center md:justify-between md:rounded-lg md:border-0 md:bg-transparent md:px-2 md:text-xs dark:md:bg-transparent ${
                      isPriceMode
                        ? 'bg-primary/12 text-primary border-transparent'
                        : 'bg-muted/40 text-muted-foreground border-transparent'
                    }`}
                  >
                    <span>{isLoadingPrices && isPriceMode ? 'Loading prices' : 'Prices'}</span>
                    <span className="text-muted-foreground hidden md:inline">{isPriceMode ? 'On' : 'Off'}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    closeControlsSheet();
                    handlePhotoButtonClick();
                  }}
                  disabled={isFilteredBinderLayout || currentPagePokemon.length === 0}
                  className="md:hover:bg-muted border-border/60 bg-background/62 text-muted-foreground dark:border-border/40 dark:bg-muted/35 h-11 rounded-2xl border px-3 text-sm font-semibold transition-[background-color,border-color,color,opacity] disabled:opacity-45 md:flex md:h-9 md:items-center md:justify-between md:rounded-lg md:border-0 md:bg-transparent md:px-2 md:text-xs dark:md:bg-transparent"
                >
                  <span>Scan page</span>
                  <Camera aria-hidden="true" className="hidden h-3.5 w-3.5 md:block" />
                </button>
              </div>
            </>
          )}
        </div>
      </OverlayDialog>
    )
  );
}
