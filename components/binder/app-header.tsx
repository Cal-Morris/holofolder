"use client"

import Image from "next/image"
import { HeaderMoreMenu } from "@/components/header-more-menu"
import { Button } from "@/components/ui/button"
import { formatMoney } from "@/lib/regional-price"
import { offlineChipLabel, syncingChipLabel } from "@/lib/connection-chip"
import { ChevronDown, ChevronLeft, ChevronRight, Grid3X3, Heart, Layers3, Link2, ListChecks, Loader2, LogIn, LogOut, Moon, Paintbrush, Search as SearchIcon, Settings, SlidersHorizontal, Sparkles, Sun, Ticket, Users } from "lucide-react"
import type { User } from "@supabase/supabase-js"
import type { ShowSessionSummary } from "@/lib/show-session"
import type { Dispatch, JSX, RefObject, SetStateAction } from "react"
import type { ActiveMainView, BeforeInstallPromptEvent } from "@/components/binder/binder-app-model"
import type { PokemonEntry, PokemonSummary } from "@/lib/pokemon-catalog"
import type { Binder } from "@/lib/binders/model"
import type { BottomNavContext } from "@/components/binder/bottom-nav"

export interface AppHeaderContext {
  inventoryNavigation?: BottomNavContext["inventoryNavigation"]
  activeBinder: Binder | null
  activeJumpLabel: "Perfect" | "Upgrade" | "Wanted" | "Needed"
  activeJumpPokemonList: PokemonEntry[]
  activeMainView: ActiveMainView
  binderCardControls: JSX.Element
  binderDimension: "2d" | "3d"
  binderDisplayControls: JSX.Element
  binders: Binder[]
  canFilterCollection: boolean
  canGoToNextVisiblePage: boolean
  canGoToPreviousVisiblePage: boolean
  collectionCount: number
  collectionStats: { collected: number; total: number; percentage: number; }
  commitPageInput: (value?: string) => void
  currentBinderPage: number
  fullShareUrl: string | null
  goToNextPage: () => void
  goToNextSpread: () => void
  goToPrevPage: () => void
  goToPrevSpread: () => void
  handleCopyReadOnlyShareLink: () => Promise<void>
  handleEnableReadOnlyShare: () => Promise<void>
  handleInstallApp: () => Promise<void>
  handleJumpToNextNeeded: () => void
  handleJumpToPreviousNeeded: () => void
  handleSignOut: () => Promise<void>
  installPromptEvent: BeforeInstallPromptEvent | null
  isDarkMode: boolean
  isDesktopActionsOpen: boolean
  isInstalledApp: boolean
  isMobileNavExpanded: boolean
  isOnline: boolean
  isSearchOpen: boolean
  isShareEnabled: boolean
  isShareLoading: boolean
  isShowModeOn: boolean
  isSpreadLayout: boolean
  lastBrowseViewRef: RefObject<"sets" | "pokemon">
  localPendingSyncCount: number
  onJoin: () => void
  openExclusively: (open: () => void) => void
  openQuickMode: () => void
  openSearch: () => void
  pageInputValue: string
  readOnlyMode: boolean
  /** Native storage: collection choice and view live in the storage toolbar, not legacy filters or shares. */
  nativeStorage?: boolean
  /** Signed-in owner/partner may manage the current collection's public link (independent of readOnlyMode). */
  canManageShare?: boolean
  onNationalDex?: () => void
  setIsAuthOpen: Dispatch<SetStateAction<boolean>>
  setIsBinderSwitcherOpen: Dispatch<SetStateAction<boolean>>
  setIsDesktopActionsOpen: Dispatch<SetStateAction<boolean>>
  setIsMobileNavExpanded: Dispatch<SetStateAction<boolean>>
  setIsPartnerOpen: Dispatch<SetStateAction<boolean>>
  setIsSettingsOpen: Dispatch<SetStateAction<boolean>>
  setPageInputValue: Dispatch<SetStateAction<string>>
  setSelectedPokemon: Dispatch<SetStateAction<PokemonSummary | null>>
  setShowMode: (on: boolean) => void
  shareCopyMessage: string | null
  shareMessage: string | null
  shellNavRef: RefObject<HTMLElement | null>
  showTally: ShowSessionSummary
  switchMainView: (view: ActiveMainView) => Promise<void>
  toggleDarkMode: () => void
  totalBinderPages: number
  user: User | null
  visiblePageLabel: string
}

export function renderAppHeaderView(ctx: AppHeaderContext) {
  const { activeBinder, activeJumpLabel, activeJumpPokemonList, activeMainView, binderDimension, canGoToNextVisiblePage, canGoToPreviousVisiblePage, commitPageInput, currentBinderPage, fullShareUrl, goToNextPage, goToNextSpread, goToPrevPage, goToPrevSpread, handleCopyReadOnlyShareLink, handleEnableReadOnlyShare, handleInstallApp, handleJumpToNextNeeded, handleJumpToPreviousNeeded, handleSignOut, installPromptEvent, isDarkMode, isInstalledApp, isMobileNavExpanded, isOnline, isSearchOpen, isShareEnabled, isShareLoading, isShowModeOn, isSpreadLayout, localPendingSyncCount, onJoin, openExclusively, openQuickMode, openSearch, pageInputValue, readOnlyMode, setIsAuthOpen, setIsBinderSwitcherOpen, setIsMobileNavExpanded, setIsPartnerOpen, setIsSettingsOpen, setPageInputValue, setSelectedPokemon, setShowMode, shareCopyMessage, shareMessage, shellNavRef, showTally, switchMainView, toggleDarkMode, totalBinderPages } = ctx
  const inventory = ctx.inventoryNavigation
  const destinations = [
    { id: "binder", label: "Binder", icon: Grid3X3 },
    { id: inventory ? "inventory" : "list", label: inventory ? "Inventory" : "List", icon: ListChecks },
    { id: "wanted", label: "Wanted", icon: Heart },
    { id: "sets", label: "Browse", icon: Layers3 },
  ] as const
  // Same contract as the dock: native Inventory renders under the "binder" main view, so only one destination is pressed.
  const isActive = (id: (typeof destinations)[number]["id"]) => !isSearchOpen && (id === "inventory" ? Boolean(inventory?.active)
    : id === "binder" ? (inventory ? inventory.collectionActive : activeMainView === "binder")
    : activeMainView === id || (id === "sets" && activeMainView === "pokemon"))
  const showStatus = showTally.count > 0 && showTally.currency
    ? `${showTally.count} bought · ${formatMoney(showTally.spent, showTally.currency as Parameters<typeof formatMoney>[1])}`
    : null
  const syncStatus = !isOnline ? offlineChipLabel(ctx.user ? localPendingSyncCount : 0)
    : ctx.user && localPendingSyncCount > 0 ? syncingChipLabel(localPendingSyncCount) : null
  return (
    <nav ref={shellNavRef} aria-label="Binder navigation" data-testid="app-header" className={`sticky top-0 z-40 mb-1 shrink-0 border-b pt-[var(--top-inset)] ${isShowModeOn ? "border-amber-400/40 bg-amber-50 dark:bg-amber-950" : "border-border/40 bg-background"}`}>
      <div data-scroll-blur="card" className="pl-[var(--left-inset)] pr-[var(--right-inset)] sm:px-4">
        <section aria-label={isShowModeOn ? "Show mode" : undefined} className="flex flex-wrap items-center gap-0 py-1 md:gap-2 md:px-3">
          {isShowModeOn && <span className="sr-only">Show mode on</span>}
          {activeBinder && !readOnlyMode ? (
            <button type="button" data-testid="binder-switcher-trigger" onClick={() => openExclusively(() => setIsBinderSwitcherOpen(true))} aria-haspopup="dialog" aria-label={`Binders: ${activeBinder.name}`} className="flex min-h-11 min-w-0 flex-1 items-center gap-1 rounded-xl px-1.5 text-left hover:bg-muted/60 xl:flex-none xl:max-w-48">
              <Grid3X3 className="hidden h-4 w-4 shrink-0 text-primary sm:block" aria-hidden />
              <span className="truncate text-sm font-semibold">{activeBinder.name}</span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            </button>
          ) : (
            // Brand is home: back to this scope's binder (a share stays in its own read-only binder).
            <div className="flex min-w-0 flex-1 xl:flex-none">
              <button type="button" data-testid="header-brand-home" onClick={() => void switchMainView("binder")} aria-label={`${readOnlyMode ? "Shared binder" : "Holo Folder"}: back to binder`} className={`flex min-h-11 min-w-0 items-center gap-1.5 rounded-xl text-left hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${ctx.user ? "px-1.5" : "md:px-1.5"}`}>
                <Image src="/app/holofolder-mark.png" alt="" width={20} height={20} unoptimized className="h-5 w-5 shrink-0" />
                <span className="truncate text-sm font-semibold">{readOnlyMode ? "Shared binder" : "Holo Folder"}</span>
              </button>
            </div>
          )}

          <div className="order-last hidden w-full items-center gap-1 border-t border-border/40 pt-1 md:flex xl:order-none xl:w-auto xl:flex-1 xl:border-0 xl:pt-0">
            {destinations.map(({ id, label, icon: Icon }) => (
              <button key={id} onClick={() => { if (id === "inventory") inventory?.open(); else void switchMainView(id === "sets" ? ctx.lastBrowseViewRef.current : id) }} aria-pressed={isActive(id)} className={`flex min-h-9 items-center gap-1.5 rounded-full px-2 text-xs font-medium ${isActive(id) ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"}`}>
                <Icon className="h-3.5 w-3.5" aria-hidden />{label}
              </button>
            ))}
            <button onClick={isShowModeOn ? openQuickMode : openSearch} aria-label="Search" aria-pressed={isSearchOpen} className="flex min-h-9 items-center gap-1.5 rounded-full px-2 text-xs font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground"><SearchIcon className="h-3.5 w-3.5" aria-hidden />Search</button>
          </div>

          {activeMainView === "binder" && binderDimension === "2d" && (
            <div data-testid="mobile-header-pager" className="flex shrink-0 items-center">
              <Button variant="ghost" size="icon" className={`h-11 ${ctx.user ? "w-11" : "w-9 md:w-11"}`} onClick={isSpreadLayout ? goToPrevSpread : goToPrevPage} disabled={!canGoToPreviousVisiblePage} aria-label={isSpreadLayout ? "Previous binder spread" : "Previous binder page"}><ChevronLeft className="h-4 w-4" /></Button>
              <input type="number" min={1} max={totalBinderPages} value={pageInputValue} onChange={e => {
                setPageInputValue(e.target.value)
                // Native number steppers emit plain events; text edits emit InputEvents.
                if (!(e.nativeEvent instanceof InputEvent)) commitPageInput(e.target.value)
              }} onBlur={() => commitPageInput()} onKeyDown={e => {
                if (e.key === "Enter") { commitPageInput(); e.currentTarget.blur() }
                else if (e.key === "Escape") { setPageInputValue(String(currentBinderPage)); e.currentTarget.blur() }
              }} inputMode="numeric" aria-label="Binder page number" className={`h-11 rounded-lg bg-transparent text-center text-base font-semibold tabular-nums ${ctx.user ? "w-11" : "w-9 md:w-11"}`} />
              <span className="hidden pr-1 text-xs tabular-nums text-muted-foreground sm:inline">/ {totalBinderPages}</span>
              <Button variant="ghost" size="icon" className={`h-11 ${ctx.user ? "w-11" : "w-9 md:w-11"}`} onClick={isSpreadLayout ? goToNextSpread : goToNextPage} disabled={!canGoToNextVisiblePage} aria-label={isSpreadLayout ? "Next binder spread" : "Next binder page"}><ChevronRight className="h-4 w-4" /></Button>
            </div>
          )}
          {!ctx.nativeStorage && activeMainView !== "pokemon" && activeMainView !== "analytics" && (
            <Button variant="ghost" aria-label="View" className="h-11 min-w-9 gap-1.5 rounded-xl px-2 text-xs" onClick={() => openExclusively(() => { setSelectedPokemon(null); setIsMobileNavExpanded(true) })} aria-haspopup="dialog" aria-expanded={isMobileNavExpanded}>
              <SlidersHorizontal className="h-4 w-4" aria-hidden /><span className={ctx.user ? undefined : "hidden md:inline"}>View</span>
            </Button>
          )}
          {!ctx.user ? <Button type="button" className="h-11 rounded-xl px-2 text-xs" onClick={onJoin}>Join now</Button> : isShowModeOn ? <button type="button" onClick={() => setShowMode(false)} aria-label="Exit show mode" className="flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-xl px-1 text-xs font-semibold text-amber-900 hover:bg-amber-200/60 dark:text-amber-100 dark:hover:bg-amber-800/60 md:px-2"><Ticket className="hidden h-4 w-4 md:block" aria-hidden /><span className="hidden md:inline">Show ·</span>Exit</button> : ctx.collectionCount > 0 ? <button type="button" onClick={() => setShowMode(true)} aria-label="Show mode" data-testid="header-show-mode" className="flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-xl px-1 text-xs font-semibold text-primary hover:bg-primary/10 md:px-2" aria-pressed={false}><Ticket className="hidden h-4 w-4 md:block" aria-hidden />Show</button> : null}
          <HeaderMoreMenu message={shareCopyMessage || shareMessage} items={[
            ...(!ctx.user || ctx.collectionCount === 0 ? [{ id: "show-mode", label: isShowModeOn ? "Exit show mode" : "Show mode", icon: <Ticket />, onSelect: () => setShowMode(!isShowModeOn) }] : []),
            ...(!readOnlyMode ? [{ id: "studio", label: "Binder Studio", icon: <Paintbrush />, href: "/studio" }] : []),
            ...(activeMainView === "binder" && binderDimension === "2d" ? [
              { id: "previous-needed", label: `Previous ${activeJumpLabel.toLowerCase()}`, icon: <Sparkles />, onSelect: handleJumpToPreviousNeeded, disabled: activeJumpPokemonList.length === 0 },
              { id: "next-needed", label: `Next ${activeJumpLabel.toLowerCase()}`, icon: <Sparkles />, onSelect: handleJumpToNextNeeded, disabled: activeJumpPokemonList.length === 0 },
            ] : []),
            ...(ctx.onNationalDex ? [{ id: "national-dex", label: "National Dex", icon: <ListChecks />, onSelect: ctx.onNationalDex }] : []),
            ...(!readOnlyMode ? [{ id: "analytics", label: "Analytics", icon: <ListChecks />, onSelect: () => { void switchMainView("analytics") } }] : []),
            ...(installPromptEvent && !isInstalledApp ? [{ id: "install", label: "Install app", icon: <Sparkles />, onSelect: () => { void handleInstallApp() } }] : []),
            ...(!readOnlyMode && ctx.user ? [
              { id: "partner", label: "Partner", icon: <Users />, onSelect: () => openExclusively(() => setIsPartnerOpen(true)) },
              ...(!ctx.canManageShare ? [] : [{ id: "share", label: isShareEnabled ? "Copy share link" : "Create share link", icon: isShareLoading ? <Loader2 className="animate-spin" /> : <Link2 />, disabled: isShareLoading, keepOpen: true, onSelect: () => { if (isShareEnabled && fullShareUrl) void handleCopyReadOnlyShareLink(); else void handleEnableReadOnlyShare() } }]),
            ] : []),
            { id: "settings", label: "Settings", icon: <Settings />, onSelect: () => openExclusively(() => setIsSettingsOpen(true)) },
            { id: "theme", label: isDarkMode ? "Light mode" : "Dark mode", icon: isDarkMode ? <Sun /> : <Moon />, onSelect: toggleDarkMode },
            ...(!readOnlyMode ? [{ id: "auth", label: ctx.user ? "Sign out" : "Sign in", icon: ctx.user ? <LogOut /> : <LogIn />, onSelect: () => { if (ctx.user) void handleSignOut(); else openExclusively(() => setIsAuthOpen(true)) } }] : []),
          ]} />
          {isShowModeOn && (showStatus || syncStatus) && <div role="status" className="order-last w-full px-1.5 pb-1 text-xs text-amber-900 dark:text-amber-100">{[showStatus, syncStatus].filter(Boolean).join(" · ")}</div>}
        </section>
      </div>
    </nav>
  )
}
