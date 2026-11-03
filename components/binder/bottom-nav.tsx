"use client"

import { Button } from "@/components/ui/button"
import { ChevronDown, ChevronUp, Grid3X3, Heart, Layers3, ListChecks, Search as SearchIcon, Sparkles } from "lucide-react"
import type { Dispatch, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, RefObject, SetStateAction } from "react"
import type { PokemonEntry, PokemonSummary } from "@/lib/pokemon-catalog"
import type { ActiveMainView, CollectionViewFilter } from "@/components/binder/binder-app-model"
import { preloadTabView } from "@/components/binder/lazy-views"

export interface BottomNavContext {
  activeJumpLabel: "Perfect" | "Upgrade" | "Wanted" | "Needed"
  activeJumpPokemonList: PokemonEntry[]
  activeMainView: ActiveMainView
  closeControlsSheet: () => void
  collectionViewFilter: CollectionViewFilter
  handleJumpToNextNeeded: () => void
  isMobileNavExpanded: boolean
  isQuickModeOpen: boolean
  isSearchOpen: boolean
  isShowModeOn: boolean
  lastBrowseViewRef: RefObject<"sets" | "pokemon">
  openExclusively: (open: () => void) => void
  openQuickMode: () => void
  openSearch: () => void
  quickPressFiredRef: RefObject<boolean>
  quickPressHandlers: { onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void; onPointerUp: () => void; onPointerLeave: () => void; onPointerCancel: () => void; onContextMenu: (event: ReactMouseEvent<HTMLButtonElement, MouseEvent>) => void; }
  setIsMobileNavExpanded: Dispatch<SetStateAction<boolean>>
  setSelectedPokemon: Dispatch<SetStateAction<PokemonSummary | null>>
  switchMainView: (view: ActiveMainView) => Promise<void>
}

export function renderBottomNavView(ctx: BottomNavContext) {
  const { activeJumpLabel, activeJumpPokemonList, activeMainView, closeControlsSheet, collectionViewFilter, handleJumpToNextNeeded, isMobileNavExpanded, isQuickModeOpen, isSearchOpen, isShowModeOn, lastBrowseViewRef, openExclusively, openQuickMode, openSearch, quickPressFiredRef, quickPressHandlers, setIsMobileNavExpanded, setSelectedPokemon, switchMainView } = ctx
  return (
    <nav aria-label="Main navigation" data-dock className="fixed inset-x-0 bottom-0 z-[45] max-w-[100vw] overflow-hidden px-2 pb-[var(--dock-inset)] md:hidden">
      <div data-scroll-blur="card" className="mx-auto grid w-full min-w-0 max-w-xl grid-cols-[minmax(0,1fr)_auto] items-center gap-1 rounded-[1.25rem] border border-border/70 bg-card/96 p-1 shadow-[0_18px_52px_-30px_rgba(15,23,42,0.36)] backdrop-blur-xl dark:border-border/50 dark:bg-background/96 dark:shadow-black/10">
        <div className="grid min-w-0 grid-cols-5 items-center rounded-2xl bg-muted/42 dark:bg-muted/35">
          <button
            onClick={() => {
              if (quickPressFiredRef.current) {
                quickPressFiredRef.current = false
                return
              }
              if (isShowModeOn) openQuickMode()
              else openSearch()
            }}
            {...quickPressHandlers}
            aria-label="Search"
            aria-description="Press and hold for Quick mode"
            title="Search (hold for Quick mode)"
            className={`flex h-11 min-w-0 touch-manipulation select-none items-center justify-center rounded-[0.9rem] px-1 transition-[background-color,color,box-shadow] [-webkit-touch-callout:none] ${
                isSearchOpen || isQuickModeOpen ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
              }`}
          >
            <SearchIcon className="h-4 w-4" />
          </button>
          <button
            onClick={() => {
              switchMainView("binder")
            }}
            aria-label="Binder"
            title="Binder"
            className={`flex h-11 min-w-0 items-center justify-center rounded-[0.9rem] px-1 transition-[background-color,color,box-shadow] ${
                !isSearchOpen && activeMainView === "binder" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
              }`}
          >
            <Grid3X3 className="h-4 w-4" />
          </button>
          <button
            // Start fetching the tab's code on press, ahead of the click, in case idle preload hasn't run yet.
            onPointerDown={() => preloadTabView("list")}
            onTouchStart={() => preloadTabView("list")}
            onClick={() => {
              switchMainView("list")
            }}
            aria-label="List"
            title="List"
            className={`flex h-11 min-w-0 items-center justify-center rounded-[0.9rem] px-1 transition-[background-color,color,box-shadow] ${
                !isSearchOpen && activeMainView === "list" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
              }`}
          >
            <ListChecks className="h-4 w-4" />
          </button>
          <button
            onPointerDown={() => preloadTabView("wanted")}
            onTouchStart={() => preloadTabView("wanted")}
            onClick={() => {
              switchMainView("wanted")
            }}
            aria-label="Wanted"
            title="Wanted"
            className={`flex h-11 min-w-0 items-center justify-center rounded-[0.9rem] px-1 transition-[background-color,color,box-shadow] ${
                !isSearchOpen && activeMainView === "wanted" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
              }`}
          >
            <Heart className="h-4 w-4" />
          </button>
          <button
            onPointerDown={() => preloadTabView(lastBrowseViewRef.current)}
            onTouchStart={() => preloadTabView(lastBrowseViewRef.current)}
            onClick={() => {
              switchMainView(lastBrowseViewRef.current)
            }}
            aria-label="Sets"
            title="Sets"
            className={`flex h-11 min-w-0 items-center justify-center rounded-[0.9rem] px-1 transition-[background-color,color,box-shadow] ${
                !isSearchOpen && (activeMainView === "sets" || activeMainView === "pokemon") ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
              }`}
          >
            <Layers3 className="h-4 w-4" />
          </button>
        </div>

          {!isSearchOpen && activeMainView === "binder" && (
            <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="default"
              size="icon"
              className="h-11 w-9 shrink-0 rounded-2xl px-0"
              onClick={handleJumpToNextNeeded}
              disabled={activeJumpPokemonList.length === 0}
              aria-label={`Next ${activeJumpLabel.toLowerCase()}`}
            >
              <Sparkles className="h-3.5 w-3.5" />
            </Button>
            {/* Prices and slot filters live in Controls (filters are also on the binder toolbar), so the dock keeps one
                action besides it. Controls fills in while a slot filter is on, standing in for the old Filter button. */}
            <Button
              variant={collectionViewFilter === "all" ? "outline" : "default"}
              size="icon"
              className="h-11 w-9 shrink-0 rounded-2xl px-0"
              onClick={() => {
                if (isMobileNavExpanded) {
                  closeControlsSheet()
                  return
                }
                openExclusively(() => {
                  setSelectedPokemon(null)
                  setIsMobileNavExpanded(true)
                })
              }}
              aria-label={isMobileNavExpanded ? "Close controls" : "Open controls"}
            >
              {isMobileNavExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </Button>
          </div>
        )}
      </div>
    </nav>
)
}
