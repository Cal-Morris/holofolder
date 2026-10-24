"use client"

import { getDetailArtwork } from "@/components/binder/binder-app-model"
import PokemonSearch from "@/components/pokemon-search"
import { Button } from "@/components/ui/button"
import { toCardImageSrc } from "@/lib/card-image-url"
import { formatDexNumber } from "@/lib/pokemon-catalog"
import { X, Zap } from "lucide-react"
import type { Dispatch, RefObject, SetStateAction } from "react"
import type { ResolvedPricingPreferences } from "@/lib/pricing-region"
import type { CardPriceSnapshot, SupportedCurrency } from "@/hooks/use-card-prices"
import type { PokemonSearchResultMeta } from "@/components/pokemon-search"
import type { SearchCardResult } from "@/lib/pokemon-card-browse"
import type { PokemonEntry, PokemonSummary } from "@/lib/pokemon-catalog"
import type { BinderCardDisplay, SelectedSlotDisplayCard } from "@/lib/selected-slot-card-display"

export interface SearchOverlayContext {
  binderCardDisplay: BinderCardDisplay
  closeSearch: () => void
  collected: boolean
  currentPagePokemon: PokemonSummary[]
  filteredPokemonList: PokemonEntry[]
  getOfflineSearchCards: () => Promise<SearchCardResult[]>
  getSearchResultMeta: (pokemon: { id: number; name: string; }) => PokemonSearchResultMeta
  handlePokemonSelect: (pokemon: PokemonSummary) => void
  handleSearchJumpToPage: (page: number) => void
  isSearchOpen: boolean
  openCardBrowser: (pokemon: { id: number; name: string; }, options?: { highlightCardId?: string | null | undefined; fromDetail?: boolean | undefined; }) => void
  openIllustratorBrowser: (name: string, options?: { fromDetail?: boolean | undefined; }) => void
  openQuickMode: () => void
  priceFormat: { label: (price: CardPriceSnapshot | undefined) => string | null; amount: (amount: number | null | undefined, price?: CardPriceSnapshot | undefined) => string | null; range: (low: number | null | undefined, high: number | null | undefined, price?: CardPriceSnapshot | undefined) => string | null; totals: (gbpTotal: number, originalTotals: Partial<Record<SupportedCurrency, number>>) => string; }
  pricingPreferences: ResolvedPricingPreferences
  readOnlyMode: boolean
  searchDialogRef: RefObject<HTMLDivElement | null>
  selectedHasWantedCard: boolean
  selectedPokemon: PokemonSummary | null
  selectedPokemonDisplayFit: "object-contain"
  selectedPokemonDisplayImage: string | null
  selectedPokemonDisplayName: string
  selectedPokemonDisplayTone: "" | "grayscale saturate-[0.8] brightness-[0.92]"
  selectedPrimaryCardPreview: SelectedSlotDisplayCard | null
  setIsSearchOpen: Dispatch<SetStateAction<boolean>>
  totalBinderPages: number
}

export function renderSearchOverlayView(ctx: SearchOverlayContext) {
  const { binderCardDisplay, closeSearch, collected, currentPagePokemon, filteredPokemonList, getOfflineSearchCards, getSearchResultMeta, handlePokemonSelect, handleSearchJumpToPage, isSearchOpen, openCardBrowser, openIllustratorBrowser, openQuickMode, priceFormat, pricingPreferences, readOnlyMode, searchDialogRef, selectedHasWantedCard, selectedPokemon, selectedPokemonDisplayFit, selectedPokemonDisplayImage, selectedPokemonDisplayName, selectedPokemonDisplayTone, selectedPrimaryCardPreview, setIsSearchOpen, totalBinderPages } = ctx
  return (
    isSearchOpen && (
      <div data-overlay-backdrop className="fixed inset-0 z-40 bg-black/65 backdrop-blur-sm" onClick={closeSearch}>
        <div className="mx-auto flex h-full w-full max-w-2xl flex-col px-3 pb-[calc(var(--dock-clearance)+0.75rem)] pt-[calc(var(--top-inset)+0.25rem)] sm:px-4 md:pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          <div
            ref={searchDialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Search Pokemon"
            onClick={(event) => event.stopPropagation()}
            className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[1.75rem] border border-border/65 bg-card/96 shadow-[0_30px_80px_-36px_rgba(15,23,42,0.35)] dark:border-border/50 dark:bg-background/96 dark:shadow-2xl">
            <div className="flex items-center justify-between border-b border-border/40 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold">Search Pokemon</p>
                <p className="text-xs text-muted-foreground">Find a mon and jump straight to its binder slot.</p>
              </div>
              <Button variant="outline" className="ml-auto mr-1 h-9 shrink-0 gap-1.5 rounded-full px-3 text-xs font-semibold" onClick={openQuickMode}>
                <Zap className="h-3.5 w-3.5" aria-hidden />
                Quick mode
              </Button>
              <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 rounded-full" onClick={closeSearch} aria-label="Close search">
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
              <PokemonSearch
                onSelect={(pokemon) => {
                  handlePokemonSelect(pokemon)
                  setIsSearchOpen(false)
                }}
                pokemonList={filteredPokemonList}
                currentPagePokemonList={currentPagePokemon}
                getResultMeta={getSearchResultMeta}
                totalPages={totalBinderPages}
                onJumpToPage={handleSearchJumpToPage}
                onBrowseCards={(pokemon, highlightCardId) => openCardBrowser(pokemon, { highlightCardId })}
                getOfflineCards={getOfflineSearchCards}
                onBrowseIllustrator={(name) => openIllustratorBrowser(name)}
                formatPrice={priceFormat.label}
                pricingRegion={pricingPreferences.region}
              />
              {selectedPokemon && (
                <div className="mt-4 rounded-2xl border border-border/60 bg-card p-4 shadow-sm dark:border-border/50">
                  <div className="flex items-center gap-3">
                    <div className={`relative flex shrink-0 items-center justify-center bg-muted/40 ${selectedPrimaryCardPreview?.cardImage ? "trading-card w-11" : "h-16 w-16 rounded-xl"}`}>
                      <img
                        src={toCardImageSrc(selectedPrimaryCardPreview?.cardImage) ?? selectedPokemonDisplayImage ?? getDetailArtwork(selectedPokemon)}
                        alt={selectedPrimaryCardPreview?.cardName ?? selectedPokemonDisplayName}
                        className={selectedPrimaryCardPreview?.cardImage
                          ? "absolute inset-0 h-full w-full object-cover"
                          : `absolute inset-2 max-w-[calc(100%-1rem)] max-h-[calc(100%-1rem)] m-auto ${selectedPokemonDisplayFit} ${selectedPokemonDisplayTone}`}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-muted-foreground">{formatDexNumber(selectedPokemon.id)}</p>
                      <h2 className="truncate text-lg font-bold">{selectedPokemonDisplayName}</h2>
                      {selectedHasWantedCard && selectedPrimaryCardPreview?.cardName ? (
                        <p className="truncate text-xs text-amber-500">Wanted: {selectedPrimaryCardPreview.cardName}</p>
                      ) : selectedPrimaryCardPreview?.cardName ? (
                        <p className="truncate text-xs text-primary">{selectedPrimaryCardPreview.cardName}</p>
                      ) : binderCardDisplay === "wanted" ? (
                        <p className="text-xs text-muted-foreground">No wanted card selected</p>
                      ) : collected ? (
                        <p className="text-xs text-muted-foreground">Collected, no card assigned</p>
                      ) : readOnlyMode ? (
                        <p className="text-xs text-muted-foreground">Browse this shared slot and use filters to inspect the binder.</p>
                      ) : (
                        <p className="text-xs text-muted-foreground">Jump to this slot to collect or pick a card.</p>
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
)
}
