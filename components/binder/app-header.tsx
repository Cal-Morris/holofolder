"use client"

import { HeaderMoreMenu } from "@/components/header-more-menu"
import { Button } from "@/components/ui/button"
import { formatMoney } from "@/lib/regional-price"
import { offlineChipLabel, syncingChipLabel } from "@/lib/connection-chip"
import { ChevronDown, ChevronLeft, ChevronRight, Grid3X3, Heart, Layers3, Link2, ListChecks, Loader2, LogIn, LogOut, Moon, Search as SearchIcon, Settings, SlidersHorizontal, Sparkles, Sun, Ticket, Users } from "lucide-react"
import type { User } from "@supabase/supabase-js"
import type { ShowSessionSummary } from "@/lib/show-session"
import type { Dispatch, JSX, RefObject, SetStateAction } from "react"
import type { ActiveMainView, BeforeInstallPromptEvent } from "@/components/binder/binder-app-model"
import type { PokemonEntry, PokemonSummary } from "@/lib/pokemon-catalog"
import type { Binder } from "@/lib/binders/model"

export interface AppHeaderContext {
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
  commitPageInput: () => void
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
  openExclusively: (open: () => void) => void
  openQuickMode: () => void
  openSearch: () => void
  pageInputValue: string
  readOnlyMode: boolean
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
  const { activeBinder, activeJumpLabel, activeJumpPokemonList, activeMainView, binderDimension, canGoToNextVisiblePage, canGoToPreviousVisiblePage, commitPageInput, currentBinderPage, fullShareUrl, goToNextPage, goToNextSpread, goToPrevPage, goToPrevSpread, handleCopyReadOnlyShareLink, handleEnableReadOnlyShare, handleInstallApp, handleJumpToNextNeeded, handleJumpToPreviousNeeded, handleSignOut, installPromptEvent, isDarkMode, isInstalledApp, isMobileNavExpanded, isOnline, isSearchOpen, isShareEnabled, isShareLoading, isShowModeOn, isSpreadLayout, localPendingSyncCount, openExclusively, openQuickMode, openSearch, pageInputValue, readOnlyMode, setIsAuthOpen, setIsBinderSwitcherOpen, setIsMobileNavExpanded, setIsPartnerOpen, setIsSettingsOpen, setPageInputValue, setSelectedPokemon, setShowMode, shareCopyMessage, shareMessage, shellNavRef, showTally, switchMainView, toggleDarkMode, totalBinderPages } = ctx
  const destinations = [
    { id: "binder", label: "Binder", icon: Grid3X3 },
    { id: "list", label: "List", icon: ListChecks },
    { id: "wanted", label: "Wanted", icon: Heart },
    { id: "sets", label: "Browse", icon: Layers3 },
  ] as const
  const showStatus = showTally.count > 0 && showTally.currency
    ? `${showTally.count} bought · ${formatMoney(showTally.spent, showTally.currency as Parameters<typeof formatMoney>[1])}`
    : null
  const syncStatus = !isOnline ? offlineChipLabel(ctx.user ? localPendingSyncCount : 0)
    : ctx.user && localPendingSyncCount > 0 ? syncingChipLabel(localPendingSyncCount) : null
  return (
    <nav ref={shellNavRef} aria-label="Binder navigation" data-testid="app-header" className="sticky top-0 z-40 mb-1 shrink-0 border-b border-border/40 bg-background pt-[var(--top-inset)]">
      <div data-scroll-blur="card" className="pl-[var(--left-inset)] pr-[var(--right-inset)] sm:px-4">
        {isShowModeOn && (
          <section aria-label="Show mode" className="flex items-center gap-2 bg-amber-400 px-3 py-1 text-black">
            <Ticket className="h-4 w-4 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1 text-xs" data-testid="show-mode-banner-text">
              <span className="font-semibold">Show mode on</span>
              {(showStatus || syncStatus) && <span role="status" className="ml-2">{[showStatus, syncStatus].filter(Boolean).join(" · ")}</span>}
            </div>
            <button type="button" onClick={() => setShowMode(false)} aria-label="Exit show mode" className="min-h-11 shrink-0 rounded-lg px-3 text-xs font-semibold hover:bg-black/10 focus-visible:outline-2 focus-visible:outline-black">Exit</button>
          </section>
        )}
        <div className="flex flex-wrap items-center gap-0 py-1 md:gap-2 md:px-3">
          {activeBinder && !readOnlyMode ? (
            <button type="button" data-testid="binder-switcher-trigger" onClick={() => openExclusively(() => setIsBinderSwitcherOpen(true))} aria-haspopup="dialog" aria-label={`Binders: ${activeBinder.name}`} className="flex min-h-11 min-w-0 flex-1 items-center gap-1 rounded-xl px-1.5 text-left hover:bg-muted/60 xl:flex-none xl:max-w-48">
              <Grid3X3 className="hidden h-4 w-4 shrink-0 text-primary sm:block" aria-hidden />
              <span className="truncate text-sm font-semibold">{activeBinder.name}</span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            </button>
          ) : <span className="min-w-0 flex-1 truncate px-1.5 text-sm font-semibold xl:flex-none">{readOnlyMode ? "Shared binder" : "Holo Folder"}</span>}

          <div className="order-last hidden w-full items-center gap-1 border-t border-border/40 pt-1 md:flex xl:order-none xl:w-auto xl:flex-1 xl:border-0 xl:pt-0">
            {destinations.map(({ id, label, icon: Icon }) => (
              <button key={id} onClick={() => void switchMainView(id === "sets" ? ctx.lastBrowseViewRef.current : id)} aria-pressed={!isSearchOpen && (activeMainView === id || (id === "sets" && activeMainView === "pokemon"))} className={`flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-medium ${!isSearchOpen && (activeMainView === id || (id === "sets" && activeMainView === "pokemon")) ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"}`}>
                <Icon className="h-3.5 w-3.5" aria-hidden />{label}
              </button>
            ))}
            <button onClick={isShowModeOn ? openQuickMode : openSearch} aria-label="Search" aria-pressed={isSearchOpen} className="flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground"><SearchIcon className="h-3.5 w-3.5" aria-hidden />Search</button>
          </div>

          {activeMainView === "binder" && binderDimension === "2d" && (
            <div data-testid="mobile-header-pager" className="flex shrink-0 items-center">
              <Button variant="ghost" size="icon" className="h-11 w-11" onClick={isSpreadLayout ? goToPrevSpread : goToPrevPage} disabled={!canGoToPreviousVisiblePage} aria-label={isSpreadLayout ? "Previous binder spread" : "Previous binder page"}><ChevronLeft className="h-4 w-4" /></Button>
              <input type="number" min={1} max={totalBinderPages} value={pageInputValue} onChange={e => setPageInputValue(e.target.value)} onBlur={commitPageInput} onKeyDown={e => {
                if (e.key === "Enter") { commitPageInput(); e.currentTarget.blur() }
                else if (e.key === "Escape") { setPageInputValue(String(currentBinderPage)); e.currentTarget.blur() }
              }} inputMode="numeric" aria-label="Binder page number" className="h-11 w-11 rounded-lg bg-transparent text-center text-base font-semibold tabular-nums" />
              <span className="hidden pr-1 text-xs tabular-nums text-muted-foreground sm:inline">/ {totalBinderPages}</span>
              <Button variant="ghost" size="icon" className="h-11 w-11" onClick={isSpreadLayout ? goToNextSpread : goToNextPage} disabled={!canGoToNextVisiblePage} aria-label={isSpreadLayout ? "Next binder spread" : "Next binder page"}><ChevronRight className="h-4 w-4" /></Button>
            </div>
          )}
          {activeMainView !== "pokemon" && activeMainView !== "analytics" && (
            <Button variant="ghost" className="h-11 gap-1.5 rounded-xl px-2 text-xs" onClick={() => openExclusively(() => { setSelectedPokemon(null); setIsMobileNavExpanded(true) })} aria-haspopup="dialog" aria-expanded={isMobileNavExpanded}>
              <SlidersHorizontal className="h-4 w-4" aria-hidden />View
            </Button>
          )}
          {!isShowModeOn && <button type="button" onClick={() => setShowMode(true)} aria-label="Show mode" data-testid="header-show-mode" className="flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-xl px-1 text-xs font-semibold text-primary hover:bg-primary/10 md:px-2" aria-pressed={false}><Ticket className="hidden h-4 w-4 md:block" aria-hidden />Show</button>}
          <HeaderMoreMenu message={shareCopyMessage || shareMessage} items={[
            ...(activeMainView === "binder" && binderDimension === "2d" ? [
              { id: "previous-needed", label: `Previous ${activeJumpLabel.toLowerCase()}`, icon: <Sparkles />, onSelect: handleJumpToPreviousNeeded, disabled: activeJumpPokemonList.length === 0 },
              { id: "next-needed", label: `Next ${activeJumpLabel.toLowerCase()}`, icon: <Sparkles />, onSelect: handleJumpToNextNeeded, disabled: activeJumpPokemonList.length === 0 },
            ] : []),
            ...(!readOnlyMode ? [{ id: "analytics", label: "Analytics", icon: <ListChecks />, onSelect: () => { void switchMainView("analytics") } }] : []),
            ...(installPromptEvent && !isInstalledApp ? [{ id: "install", label: "Install app", icon: <Sparkles />, onSelect: () => { void handleInstallApp() } }] : []),
            ...(!readOnlyMode && ctx.user ? [
              { id: "partner", label: "Partner", icon: <Users />, onSelect: () => openExclusively(() => setIsPartnerOpen(true)) },
              { id: "share", label: isShareEnabled ? "Copy share link" : "Create share link", icon: isShareLoading ? <Loader2 className="animate-spin" /> : <Link2 />, disabled: isShareLoading, keepOpen: true, onSelect: () => { if (isShareEnabled && fullShareUrl) void handleCopyReadOnlyShareLink(); else void handleEnableReadOnlyShare() } },
            ] : []),
            { id: "settings", label: "Settings", icon: <Settings />, onSelect: () => openExclusively(() => setIsSettingsOpen(true)) },
            { id: "theme", label: isDarkMode ? "Light mode" : "Dark mode", icon: isDarkMode ? <Sun /> : <Moon />, onSelect: toggleDarkMode },
            ...(!readOnlyMode ? [{ id: "auth", label: ctx.user ? "Sign out" : "Sign in", icon: ctx.user ? <LogOut /> : <LogIn />, onSelect: () => { if (ctx.user) void handleSignOut(); else openExclusively(() => setIsAuthOpen(true)) } }] : []),
          ]} />
        </div>
      </div>
    </nav>
  )
}
