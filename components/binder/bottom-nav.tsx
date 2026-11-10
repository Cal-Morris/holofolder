"use client"

import { Button } from "@/components/ui/button"
import { Grid3X3, Heart, Layers3, ListChecks, Search as SearchIcon, Sparkles } from "lucide-react"
import type { Dispatch, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, RefObject, SetStateAction } from "react"
import type { PokemonEntry, PokemonSummary } from "@/lib/pokemon-catalog"
import type { ActiveMainView, CollectionViewFilter } from "@/components/binder/binder-app-model"
import { preloadTabView } from "@/components/binder/lazy-views"

export interface BottomNavContext {
  inventoryNavigation?: { active: boolean; open: () => void }
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
  const { activeJumpLabel, activeJumpPokemonList, activeMainView, handleJumpToNextNeeded, isQuickModeOpen, isSearchOpen, isShowModeOn, lastBrowseViewRef, openQuickMode, openSearch, quickPressFiredRef, quickPressHandlers, switchMainView } = ctx
  // Native Inventory also renders under the "binder" main view; only one dock tab is ever pressed.
  const binderActive = !isSearchOpen && !isQuickModeOpen && activeMainView === "binder" && !ctx.inventoryNavigation?.active
  return (
    <nav aria-label="Main navigation" data-dock className="fixed inset-x-0 bottom-0 z-[45] max-w-[100vw] overflow-hidden border-t border-border/40 bg-background pl-[var(--left-inset)] pr-[var(--right-inset)] pb-[var(--dock-inset)] md:hidden">
      <div data-scroll-blur="card" className="mx-auto grid h-[calc(var(--dock-bar)-1px)] w-full min-w-0 max-w-xl grid-cols-[minmax(0,1fr)_auto] items-center gap-1">
        <div className="grid min-w-0 grid-cols-5 items-center">
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
            aria-pressed={isSearchOpen || isQuickModeOpen}
            aria-description="Press and hold for Quick mode"
            title="Search (hold for Quick mode)"
            className={`flex h-11 flex-col gap-0.5 min-w-0 touch-manipulation select-none items-center justify-center rounded-full px-1 transition-colors [-webkit-touch-callout:none] ${
                isSearchOpen || isQuickModeOpen ? "holo-selected text-primary [&>svg]:stroke-[2.5] [&>span]:font-semibold" : "text-muted-foreground"
              }`}
          >
            <SearchIcon className="h-4 w-4" aria-hidden />
            <span className="text-[10px] font-medium">Search</span>
          </button>
          <button
            onClick={() => void switchMainView("binder")}
            aria-label="Binder"
            aria-pressed={binderActive}
            title="Binder"
            className={`flex h-11 flex-col gap-0.5 min-w-0 items-center justify-center rounded-full px-1 transition-colors ${
                binderActive ? "holo-selected text-primary [&>svg]:stroke-[2.5] [&>span]:font-semibold" : "text-muted-foreground"
              }`}
          >
            <Grid3X3 className="h-4 w-4" aria-hidden />
            <span className="text-[10px] font-medium">Binder</span>
          </button>
          <button
            // Start fetching the tab's code on press, ahead of the click, in case idle preload hasn't run yet.
            onPointerDown={() => preloadTabView("list")}
            onTouchStart={() => preloadTabView("list")}
            onClick={() => {
              if (ctx.inventoryNavigation) ctx.inventoryNavigation.open()
              else void switchMainView("list")
            }}
            aria-label={ctx.inventoryNavigation ? "Inventory" : "List"}
            aria-pressed={!isSearchOpen && !isQuickModeOpen && (ctx.inventoryNavigation ? ctx.inventoryNavigation.active : activeMainView === "list")}
            title="List"
            className={`flex h-11 flex-col gap-0.5 min-w-0 items-center justify-center rounded-full px-1 transition-colors ${
                !isSearchOpen && !isQuickModeOpen && (ctx.inventoryNavigation ? ctx.inventoryNavigation.active : activeMainView === "list") ? "holo-selected text-primary [&>svg]:stroke-[2.5] [&>span]:font-semibold" : "text-muted-foreground"
              }`}
          >
            <ListChecks className="h-4 w-4" aria-hidden />
            <span className="text-[10px] font-medium">{ctx.inventoryNavigation ? "Inventory" : "List"}</span>
          </button>
          <button
            onPointerDown={() => preloadTabView("wanted")}
            onTouchStart={() => preloadTabView("wanted")}
            onClick={() => {
              switchMainView("wanted")
            }}
            aria-label="Wanted"
            aria-pressed={!isSearchOpen && !isQuickModeOpen && activeMainView === "wanted"}
            title="Wanted"
            className={`flex h-11 flex-col gap-0.5 min-w-0 items-center justify-center rounded-full px-1 transition-colors ${
                !isSearchOpen && !isQuickModeOpen && activeMainView === "wanted" ? "holo-selected text-primary [&>svg]:stroke-[2.5] [&>span]:font-semibold" : "text-muted-foreground"
              }`}
          >
            <Heart className="h-4 w-4" aria-hidden />
            <span className="text-[10px] font-medium">Wanted</span>
          </button>
          <button
            onPointerDown={() => preloadTabView(lastBrowseViewRef.current)}
            onTouchStart={() => preloadTabView(lastBrowseViewRef.current)}
            onClick={() => {
              switchMainView(lastBrowseViewRef.current)
            }}
            aria-label="Browse"
            aria-pressed={!isSearchOpen && !isQuickModeOpen && (activeMainView === "sets" || activeMainView === "pokemon")}
            title="Browse"
            className={`flex h-11 flex-col gap-0.5 min-w-0 items-center justify-center rounded-full px-1 transition-colors ${
                !isSearchOpen && !isQuickModeOpen && (activeMainView === "sets" || activeMainView === "pokemon") ? "holo-selected text-primary [&>svg]:stroke-[2.5] [&>span]:font-semibold" : "text-muted-foreground"
              }`}
          >
            <Layers3 className="h-4 w-4" aria-hidden />
            <span className="text-[10px] font-medium">Browse</span>
          </button>
        </div>

          {!isSearchOpen && activeMainView === "binder" && (
            <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-11 w-11 shrink-0 rounded-lg px-0"
              onClick={handleJumpToNextNeeded}
              disabled={activeJumpPokemonList.length === 0}
              aria-label={`Next ${activeJumpLabel.toLowerCase()}`}
            >
              <Sparkles className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>
    </nav>
)
}
