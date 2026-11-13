'use client';

import { Grid3X3, Heart, Layers3, ListChecks, Search as SearchIcon } from 'lucide-react';
import type {
  Dispatch,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
  SetStateAction,
} from 'react';
import type { PokemonSummary } from '@/lib/pokemon-catalog';
import type { ActiveMainView } from '@/components/binder/binder-app-model';
import { preloadTabView } from '@/components/binder/lazy-views';

export interface BottomNavContext {
  /** Native storage: Inventory replaces List, and Binder stands for the collection in any presentation (binder pages or List). */
  inventoryNavigation?: {
    active: boolean;
    open: () => void;
    collectionActive: boolean;
    /** The binder's own pages are on screen, so its page controls apply. */ binderOpen: boolean;
  };
  activeMainView: ActiveMainView;
  closeControlsSheet: () => void;
  isMobileNavExpanded: boolean;
  isQuickModeOpen: boolean;
  isSearchOpen: boolean;
  isShowModeOn: boolean;
  lastBrowseViewRef: RefObject<'sets' | 'pokemon'>;
  openExclusively: (open: () => void) => void;
  openQuickMode: () => void;
  openSearch: () => void;
  quickPressFiredRef: RefObject<boolean>;
  quickPressHandlers: {
    onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
    onPointerUp: () => void;
    onPointerLeave: () => void;
    onPointerCancel: () => void;
    onContextMenu: (event: ReactMouseEvent<HTMLButtonElement, MouseEvent>) => void;
  };
  setIsMobileNavExpanded: Dispatch<SetStateAction<boolean>>;
  setSelectedPokemon: Dispatch<SetStateAction<PokemonSummary | null>>;
  switchMainView: (view: ActiveMainView) => Promise<void>;
}

export function renderBottomNavView(ctx: BottomNavContext) {
  const {
    activeMainView,
    isQuickModeOpen,
    isSearchOpen,
    isShowModeOn,
    lastBrowseViewRef,
    openQuickMode,
    openSearch,
    quickPressFiredRef,
    quickPressHandlers,
    switchMainView,
  } = ctx;
  // Native Inventory also renders under the "binder" main view; only one dock tab is ever pressed.
  const binderActive =
    !isSearchOpen &&
    !isQuickModeOpen &&
    (ctx.inventoryNavigation ? ctx.inventoryNavigation.collectionActive : activeMainView === 'binder');
  return (
    <nav
      aria-label="Main navigation"
      data-dock
      className="border-border/40 bg-background fixed inset-x-0 bottom-0 z-[45] max-w-[100vw] overflow-hidden border-t pr-[var(--right-inset)] pb-[var(--dock-inset)] pl-[var(--left-inset)] md:hidden"
    >
      <div data-scroll-blur="card" className="mx-auto h-[calc(var(--dock-bar)-1px)] w-full max-w-xl min-w-0">
        <div className="grid h-full min-w-0 grid-cols-5 items-center">
          <button
            type="button"
            onClick={() => {
              if (quickPressFiredRef.current) {
                quickPressFiredRef.current = false;
                return;
              }
              if (isShowModeOn) openQuickMode();
              else openSearch();
            }}
            {...quickPressHandlers}
            aria-label="Search"
            aria-pressed={isSearchOpen || isQuickModeOpen}
            aria-description="Press and hold for Quick mode"
            title="Search (hold for Quick mode)"
            className={`flex h-11 min-w-0 touch-manipulation flex-col items-center justify-center gap-0.5 rounded-full px-1 transition-colors select-none [-webkit-touch-callout:none] ${
              isSearchOpen || isQuickModeOpen
                ? 'holo-selected text-primary [&>span]:font-semibold [&>svg]:stroke-[2.5]'
                : 'text-muted-foreground'
            }`}
          >
            <SearchIcon className="h-4 w-4" aria-hidden />
            <span className="text-[10px] font-medium">Search</span>
          </button>
          <button
            type="button"
            onClick={() => void switchMainView('binder')}
            aria-label="Binder"
            aria-pressed={binderActive}
            title="Binder"
            className={`flex h-11 min-w-0 flex-col items-center justify-center gap-0.5 rounded-full px-1 transition-colors ${
              binderActive
                ? 'holo-selected text-primary [&>span]:font-semibold [&>svg]:stroke-[2.5]'
                : 'text-muted-foreground'
            }`}
          >
            <Grid3X3 className="h-4 w-4" aria-hidden />
            <span className="text-[10px] font-medium">Binder</span>
          </button>
          <button
            type="button"
            // Start fetching the tab's code on press, ahead of the click, in case idle preload hasn't run yet.
            onPointerDown={() => preloadTabView('list')}
            onTouchStart={() => preloadTabView('list')}
            onClick={() => {
              if (ctx.inventoryNavigation) ctx.inventoryNavigation.open();
              else void switchMainView('list');
            }}
            aria-label={ctx.inventoryNavigation ? 'Inventory' : 'List'}
            aria-pressed={
              !isSearchOpen &&
              !isQuickModeOpen &&
              (ctx.inventoryNavigation ? ctx.inventoryNavigation.active : activeMainView === 'list')
            }
            title="List"
            className={`flex h-11 min-w-0 flex-col items-center justify-center gap-0.5 rounded-full px-1 transition-colors ${
              !isSearchOpen &&
              !isQuickModeOpen &&
              (ctx.inventoryNavigation ? ctx.inventoryNavigation.active : activeMainView === 'list')
                ? 'holo-selected text-primary [&>span]:font-semibold [&>svg]:stroke-[2.5]'
                : 'text-muted-foreground'
            }`}
          >
            <ListChecks className="h-4 w-4" aria-hidden />
            <span className="text-[10px] font-medium">{ctx.inventoryNavigation ? 'Inventory' : 'List'}</span>
          </button>
          <button
            type="button"
            onPointerDown={() => preloadTabView('wanted')}
            onTouchStart={() => preloadTabView('wanted')}
            onClick={() => {
              switchMainView('wanted');
            }}
            aria-label="Wanted"
            aria-pressed={!isSearchOpen && !isQuickModeOpen && activeMainView === 'wanted'}
            title="Wanted"
            className={`flex h-11 min-w-0 flex-col items-center justify-center gap-0.5 rounded-full px-1 transition-colors ${
              !isSearchOpen && !isQuickModeOpen && activeMainView === 'wanted'
                ? 'holo-selected text-primary [&>span]:font-semibold [&>svg]:stroke-[2.5]'
                : 'text-muted-foreground'
            }`}
          >
            <Heart className="h-4 w-4" aria-hidden />
            <span className="text-[10px] font-medium">Wanted</span>
          </button>
          <button
            type="button"
            onPointerDown={() => preloadTabView(lastBrowseViewRef.current)}
            onTouchStart={() => preloadTabView(lastBrowseViewRef.current)}
            onClick={() => {
              switchMainView(lastBrowseViewRef.current);
            }}
            aria-label="Browse"
            aria-pressed={
              !isSearchOpen && !isQuickModeOpen && (activeMainView === 'sets' || activeMainView === 'pokemon')
            }
            title="Browse"
            className={`flex h-11 min-w-0 flex-col items-center justify-center gap-0.5 rounded-full px-1 transition-colors ${
              !isSearchOpen && !isQuickModeOpen && (activeMainView === 'sets' || activeMainView === 'pokemon')
                ? 'holo-selected text-primary [&>span]:font-semibold [&>svg]:stroke-[2.5]'
                : 'text-muted-foreground'
            }`}
          >
            <Layers3 className="h-4 w-4" aria-hidden />
            <span className="text-[10px] font-medium">Browse</span>
          </button>
        </div>
      </div>
    </nav>
  );
}
