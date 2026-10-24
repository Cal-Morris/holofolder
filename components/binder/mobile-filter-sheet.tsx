"use client"

import { COLLECTION_VIEW_FILTERS } from "@/components/binder/binder-app-model"
import { Button } from "@/components/ui/button"
import { Check, X } from "lucide-react"
import type { Dispatch, PointerEvent as ReactPointerEvent, RefObject, SetStateAction } from "react"
import type { PokemonEntry } from "@/lib/pokemon-catalog"
import type { CollectionViewFilter } from "@/components/binder/binder-app-model"

export interface MobileFilterSheetContext {
  closeFilterSheet: () => void
  collectionViewFilter: CollectionViewFilter
  filteredPokemonList: PokemonEntry[]
  filterSheetRef: RefObject<HTMLDivElement | null>
  filterSheetSwipe: { onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void; onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void; onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void; onPointerCancel: () => void; style: { touchAction: "none"; }; }
  isMobileFilterSheetOpen: boolean
  isSearchOpen: boolean
  setCollectionViewFilter: Dispatch<SetStateAction<CollectionViewFilter>>
  setIsMobileFilterSheetOpen: Dispatch<SetStateAction<boolean>>
}

export function renderMobileFilterSheetView(ctx: MobileFilterSheetContext) {
  const { closeFilterSheet, collectionViewFilter, filteredPokemonList, filterSheetRef, filterSheetSwipe, isMobileFilterSheetOpen, isSearchOpen, setCollectionViewFilter, setIsMobileFilterSheetOpen } = ctx
  return (
    isMobileFilterSheetOpen && !isSearchOpen && (
      <div data-overlay-backdrop className="fixed inset-0 z-40 bg-black/55 backdrop-blur-sm md:hidden" onClick={closeFilterSheet}>
        <div
          ref={filterSheetRef}
          role="dialog"
          aria-modal="true"
          aria-label="Binder View"
          className="absolute inset-x-0 bottom-0 overflow-y-auto overscroll-contain rounded-t-[1.75rem] border-t border-border/65 bg-card/96 px-4 pb-[calc(var(--dock-clearance)+1rem)] pt-4 outline-none shadow-[0_-24px_64px_-32px_rgba(15,23,42,0.35)] dark:border-border/50 dark:bg-background/96 dark:shadow-2xl"
          onClick={(event) => event.stopPropagation()}
          style={{
            maxHeight: "calc(100dvh - var(--top-inset) - 0.25rem)",
            WebkitOverflowScrolling: "touch",
            touchAction: "pan-y",
          }}
        >
          <div data-sheet-grabber className="-mx-4 -mt-4 px-4 pt-4" {...filterSheetSwipe}>
          <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-border/60" />
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">Binder View</p>
              <p className="text-xs text-muted-foreground">{filteredPokemonList.length} visible</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0 rounded-full"
              onClick={closeFilterSheet}
              aria-label="Close binder view"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          </div>

          <div className="space-y-2">
            {COLLECTION_VIEW_FILTERS.map((filterOption) => {
              const isActive = collectionViewFilter === filterOption.id

              return (
                <button
                  key={filterOption.id}
                  onClick={() => {
                    setCollectionViewFilter(filterOption.id)
                    setIsMobileFilterSheetOpen(false)
                  }}
                  className={`w-full rounded-2xl border px-4 py-3 text-left transition-all ${
                      isActive
                        ? "border-primary/35 bg-primary/12 shadow-sm"
                        : "border-border/60 bg-card/78 dark:border-border/40 dark:bg-card/60"
                    }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">{filterOption.label}</p>
                    </div>
                    <div
                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                          isActive ? "bg-primary text-primary-foreground" : "border border-border/50"
                        }`}
                    >
                      {isActive ? <Check className="h-3 w-3" /> : null}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    )
)
}
