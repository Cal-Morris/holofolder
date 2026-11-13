'use client';

import type { NativeConsumerBinding } from '@/lib/collection/native-card-consumers';
import { getDetailArtwork } from '@/components/binder/binder-app-model';
import type { BinderHistory } from '@/hooks/use-binder-history';
import PokemonSearch from '@/components/pokemon-search';
import { Button } from '@/components/ui/button';
import { toCardImageSrc } from '@/lib/card-image-url';
import { formatDexNumber } from '@/lib/pokemon-catalog';
import { X, Zap } from 'lucide-react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { useSwipeToDismiss } from '@/hooks/use-overlay';
import type { ResolvedPricingPreferences } from '@/lib/pricing-region';
import type { CardPriceSnapshot, SupportedCurrency } from '@/hooks/use-card-prices';
import type { PokemonSearchResultMeta } from '@/components/pokemon-search';
import type { SearchCardResult } from '@/lib/pokemon-card-browse';
import type { PokemonEntry, PokemonSummary } from '@/lib/pokemon-catalog';
import type { TCGSetSummary } from '@/lib/tcg-set-slots';
import type { BinderCardDisplay, SelectedSlotDisplayCard } from '@/lib/selected-slot-card-display';

export interface SearchOverlayContext {
  nativeConsumer?: NativeConsumerBinding;
  history: BinderHistory;
  binderCardDisplay: BinderCardDisplay;
  closeSearch: () => void;
  collected: boolean;
  currentPagePokemon: PokemonSummary[];
  filteredPokemonList: PokemonEntry[];
  getOfflineSearchCards: () => Promise<SearchCardResult[]>;
  getCardState: (card: SearchCardResult, pokemon: { id: number; name: string }) => { owned: boolean; wanted: boolean };
  getSearchResultMeta: (pokemon: { id: number; name: string }) => PokemonSearchResultMeta;
  handlePokemonSelect: (pokemon: PokemonSummary) => void;
  handleSearchJumpToPage: (page: number) => void;
  isSearchOpen: boolean;
  openCardBrowser: (
    pokemon: { id: number; name: string },
    options?: { highlightCardId?: string | null | undefined; fromDetail?: boolean | undefined },
  ) => void;
  openIllustratorBrowser: (name: string, options?: { fromDetail?: boolean | undefined }) => void;
  openQuickMode: () => void;
  openSetFromSearch: (set: TCGSetSummary) => void;
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
  pricingPreferences: ResolvedPricingPreferences;
  readOnlyMode: boolean;
  searchDialogRef: RefObject<HTMLDivElement | null>;
  searchSwipe: ReturnType<typeof useSwipeToDismiss>;
  selectedHasWantedCard: boolean;
  selectedPokemon: PokemonSummary | null;
  selectedPokemonDisplayFit: 'object-contain';
  selectedPokemonDisplayImage: string | null;
  selectedPokemonDisplayName: string;
  selectedPokemonDisplayTone: '' | 'grayscale saturate-[0.8] brightness-[0.92]';
  selectedPrimaryCardPreview: SelectedSlotDisplayCard | null;
  setIsSearchOpen: Dispatch<SetStateAction<boolean>>;
  totalBinderPages: number;
}

export function renderSearchOverlayView(ctx: SearchOverlayContext) {
  const {
    nativeConsumer,
    history,
    binderCardDisplay,
    closeSearch,
    collected,
    currentPagePokemon,
    filteredPokemonList,
    getCardState,
    getOfflineSearchCards,
    getSearchResultMeta,
    handlePokemonSelect,
    handleSearchJumpToPage,
    isSearchOpen,
    openCardBrowser,
    openIllustratorBrowser,
    openQuickMode,
    openSetFromSearch,
    priceFormat,
    pricingPreferences,
    readOnlyMode,
    searchDialogRef,
    searchSwipe,
    selectedHasWantedCard,
    selectedPokemon,
    selectedPokemonDisplayFit,
    selectedPokemonDisplayImage,
    selectedPokemonDisplayName,
    selectedPokemonDisplayTone,
    selectedPrimaryCardPreview,
    setIsSearchOpen,
    totalBinderPages,
  } = ctx;
  return (
    isSearchOpen && (
      <div
        data-overlay-backdrop
        role="presentation"
        className="fixed inset-0 z-40 bg-black/65 backdrop-blur-sm"
        onClick={closeSearch}
      >
        <div className="mx-auto flex h-full w-full max-w-2xl flex-col px-3 pt-[calc(var(--top-inset)+0.25rem)] pb-[calc(var(--dock-clearance)+0.75rem)] sm:px-4 md:pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- only stops taps inside the sheet reaching the backdrop's close handler */}
          <div
            ref={searchDialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Search Pokemon"
            onClick={(event) => event.stopPropagation()}
            className="holo-panel border-border/65 bg-card/96 dark:border-border/50 flex min-h-0 flex-1 flex-col overflow-hidden rounded-[1.75rem] border shadow-[0_30px_80px_-36px_rgba(15,23,42,0.35)] dark:shadow-2xl"
          >
            <div
              data-sheet-grabber
              {...searchSwipe}
              className="border-border/40 relative grid shrink-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-1 gap-y-1 border-b px-4 py-3"
            >
              <span
                aria-hidden="true"
                className="bg-muted-foreground/30 pointer-events-none absolute top-1 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full sm:hidden"
              />
              <div className="min-w-0">
                <p className="text-sm font-semibold">Search</p>
              </div>
              <Button
                variant="outline"
                className="mr-1 ml-auto h-9 shrink-0 gap-1.5 rounded-full px-3 text-xs font-semibold"
                onClick={openQuickMode}
              >
                <Zap className="h-3.5 w-3.5" aria-hidden />
                Quick mode
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0 rounded-full"
                onClick={closeSearch}
                aria-label="Close search"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
              <PokemonSearch
                nativeConsumer={nativeConsumer}
                history={history}
                onSelect={(pokemon) => {
                  handlePokemonSelect(pokemon);
                  setIsSearchOpen(false);
                }}
                pokemonList={filteredPokemonList}
                currentPagePokemonList={currentPagePokemon}
                getResultMeta={getSearchResultMeta}
                totalPages={totalBinderPages}
                onJumpToPage={handleSearchJumpToPage}
                onBrowseCards={(pokemon, highlightCardId) => openCardBrowser(pokemon, { highlightCardId })}
                getOfflineCards={getOfflineSearchCards}
                onBrowseIllustrator={(name) => openIllustratorBrowser(name)}
                onBrowseSet={openSetFromSearch}
                formatPrice={priceFormat.label}
                pricingRegion={pricingPreferences.region}
                getCardState={getCardState}
              />
              {selectedPokemon && (
                <div className="border-border/50 mt-4 border-t pt-4">
                  <div className="flex items-center gap-3">
                    <div
                      className={`bg-muted/40 relative flex shrink-0 items-center justify-center ${selectedPrimaryCardPreview?.cardImage ? 'trading-card w-11' : 'h-16 w-16 rounded-xl'}`}
                    >
                      <img
                        src={
                          toCardImageSrc(selectedPrimaryCardPreview?.cardImage) ??
                          selectedPokemonDisplayImage ??
                          getDetailArtwork(selectedPokemon)
                        }
                        alt={selectedPrimaryCardPreview?.cardName ?? selectedPokemonDisplayName}
                        className={
                          selectedPrimaryCardPreview?.cardImage
                            ? 'absolute inset-0 h-full w-full object-cover'
                            : `absolute inset-2 m-auto max-h-[calc(100%-1rem)] max-w-[calc(100%-1rem)] ${selectedPokemonDisplayFit} ${selectedPokemonDisplayTone}`
                        }
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-muted-foreground text-xs font-semibold">
                        {formatDexNumber(selectedPokemon.id)}
                      </p>
                      <h2 className="truncate text-lg font-bold">{selectedPokemonDisplayName}</h2>
                      {selectedHasWantedCard && selectedPrimaryCardPreview?.cardName ? (
                        <p className="truncate text-xs text-amber-500">Wanted: {selectedPrimaryCardPreview.cardName}</p>
                      ) : selectedPrimaryCardPreview?.cardName ? (
                        <p className="text-primary truncate text-xs">{selectedPrimaryCardPreview.cardName}</p>
                      ) : binderCardDisplay === 'wanted' ? (
                        <p className="text-muted-foreground text-xs">No wanted card selected</p>
                      ) : collected ? (
                        <p className="text-muted-foreground text-xs">Collected, no card assigned</p>
                      ) : readOnlyMode ? (
                        <p className="text-muted-foreground text-xs">
                          Browse this shared slot and use filters to inspect the binder.
                        </p>
                      ) : (
                        <p className="text-muted-foreground text-xs">Jump to this slot to collect or pick a card.</p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  );
}
