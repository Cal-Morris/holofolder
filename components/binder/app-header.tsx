"use client"

import { HeaderMoreMenu } from "@/components/header-more-menu"
import { Button } from "@/components/ui/button"
import { formatMoney } from "@/lib/regional-price"
import { offlineChipLabel, syncingChipLabel } from "@/lib/connection-chip"
import { BookOpen, ChevronDown, ChevronLeft, ChevronRight, Copy, Grid3X3, Heart, Layers3, Link2, ListChecks, Loader2, LogIn, LogOut, Moon, MoreHorizontal, Search as SearchIcon, Settings, SlidersHorizontal, Sparkles, Sun, Ticket, Users } from "lucide-react"
import type { User } from "@supabase/supabase-js"
import type { ShowSessionSummary } from "@/lib/show-session"
import type { Dispatch, JSX, RefObject, SetStateAction } from "react"
import type { ActiveMainView, BeforeInstallPromptEvent } from "@/components/binder/binder-app-model"
import type { PokemonEntry, PokemonSummary } from "@/lib/pokemon-catalog"
import type { Binder } from "@/lib/binders/model"

// Mouse-and-keyboard screens (no touch as the main pointer) vs phones and tablets.
const FINE_POINTER_HIDDEN = "[@media(hover:hover)_and_(pointer:fine)]:hidden"
const FINE_POINTER_ONLY = "hidden [@media(hover:hover)_and_(pointer:fine)]:inline"

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
  const { activeBinder, activeJumpLabel, activeJumpPokemonList, activeMainView, binderCardControls, binderDimension, binderDisplayControls, binders, canFilterCollection, canGoToNextVisiblePage, canGoToPreviousVisiblePage, collectionCount, collectionStats, commitPageInput, currentBinderPage, fullShareUrl, goToNextPage, goToNextSpread, goToPrevPage, goToPrevSpread, handleCopyReadOnlyShareLink, handleEnableReadOnlyShare, handleInstallApp, handleJumpToNextNeeded, handleJumpToPreviousNeeded, handleSignOut, installPromptEvent, isDarkMode, isDesktopActionsOpen, isInstalledApp, isMobileNavExpanded, isOnline, isSearchOpen, isShareEnabled, isShareLoading, isShowModeOn, isSpreadLayout, localPendingSyncCount, openExclusively, openQuickMode, openSearch, pageInputValue, readOnlyMode, setIsAuthOpen, setIsBinderSwitcherOpen, setIsDesktopActionsOpen, setIsMobileNavExpanded, setIsPartnerOpen, setIsSettingsOpen, setPageInputValue, setSelectedPokemon, setShowMode, shareCopyMessage, shareMessage, shellNavRef, showTally, switchMainView, toggleDarkMode, totalBinderPages, user, visiblePageLabel } = ctx
  return (
    <nav ref={shellNavRef} data-testid="app-header" className="sticky top-0 z-40 mb-1 shrink-0 pl-[var(--left-inset)] pr-[var(--right-inset)] pt-[var(--top-inset)] sm:px-4">
      <div className="mx-auto w-full max-w-7xl md:max-w-none">
        {isShowModeOn && (
          <section
            aria-label="Show mode"
            className="mb-1.5 flex items-center gap-2 rounded-2xl bg-amber-400 py-0.5 pl-3 pr-0.5 text-black shadow-[0_12px_32px_-18px_rgba(217,119,6,0.9)]"
          >
            <Ticket className="h-5 w-5 shrink-0" aria-hidden />
            {/* Two lines so the tally isn't cut off next to Search and Exit on a 375–390px phone. */}
            <p className="flex min-w-0 flex-1 flex-col py-1 text-sm leading-tight" data-testid="show-mode-banner-text">
              <span className="truncate font-bold">Show mode on</span>
              <span role="status" className="line-clamp-2 text-xs font-medium leading-snug text-black/70">
                {showTally.count > 0 && showTally.currency
                  ? `${showTally.count} bought · ${formatMoney(showTally.spent, showTally.currency as Parameters<typeof formatMoney>[1])}${isOnline ? (user && localPendingSyncCount > 0 ? ` · ${localPendingSyncCount} syncing` : "") : " · offline"}`
                  : isOnline
                  ? user && localPendingSyncCount > 0 ? syncingChipLabel(localPendingSyncCount) : (
                    <>
                      {/* Keeping the screen on is for a phone at a show; with a mouse and keyboard the shortcut helps more. */}
                      <span className={FINE_POINTER_HIDDEN}>Screen stays on</span>
                      <span className={FINE_POINTER_ONLY}>Ctrl / ⌘ K to search</span>
                    </>
                  )
                  : offlineChipLabel(user ? localPendingSyncCount : 0)}
              </span>
            </p>
            <button
              type="button"
              onClick={openQuickMode}
              title="Search cards (Ctrl / ⌘ K)"
              className="flex h-12 shrink-0 cursor-pointer items-center gap-1.5 rounded-xl bg-black/85 px-3 text-sm font-semibold text-amber-300 transition-colors hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 focus-visible:ring-offset-amber-400"
            >
              <SearchIcon className="h-4 w-4" aria-hidden />
              Search
            </button>
            <button
              type="button"
              onClick={() => setShowMode(false)}
              aria-label="Exit show mode"
              title="Exit show mode"
              className="flex h-12 shrink-0 cursor-pointer items-center rounded-xl border border-black/25 px-3 text-sm font-semibold transition-colors hover:border-black/45 hover:bg-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black"
            >
              Exit
            </button>
          </section>
        )}
        <div data-scroll-blur="card" className="rounded-2xl border border-border/70 bg-card/96 shadow-[0_18px_50px_-26px_rgba(15,23,42,0.24)] md:bg-card/86 md:backdrop-blur-xl dark:border-border/50 dark:bg-background dark:shadow-black/5 dark:md:bg-background/88">
        <div className="flex items-center justify-between gap-2 px-2.5 py-1 md:px-2.5 md:py-1.5">
          {activeBinder && !readOnlyMode ? (
            <button
              type="button"
              data-testid="binder-switcher-trigger"
              onClick={() => setIsBinderSwitcherOpen(true)}
              aria-haspopup="dialog"
              aria-label={`Binders: ${activeBinder.name}`}
              className="-my-1 -ml-1 flex min-h-11 min-w-11 items-center gap-2 rounded-xl px-1 text-left hover:bg-muted/60"
            >
              <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary shadow-sm md:h-6 md:w-6">
                <Grid3X3 className="h-3.5 w-3.5 text-primary-foreground md:h-3 md:w-3" />
                <ChevronDown aria-hidden="true" className={`absolute -bottom-1 -right-1 h-3.5 w-3.5 rounded-full bg-card text-foreground shadow-sm ring-1 ring-border/60 ${activeMainView === "binder" ? "md:hidden" : "hidden"}`} />
              </span>
              <span className={`min-w-0 ${activeMainView === "binder" ? "max-md:hidden" : ""}`}>
                <span className="flex items-center gap-0.5">
                  <span className="block max-w-[11rem] truncate text-sm font-bold tracking-tight md:text-[13px]">{activeBinder.name}</span>
                  <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </span>
                <span className="hidden text-[10px] text-muted-foreground sm:block md:hidden">
                  {binders.length === 1 ? "Tap to add a binder" : `${binders.length} binders`}
                </span>
              </span>
            </button>
          ) : (
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary shadow-sm md:h-6 md:w-6">
              <Grid3X3 className="h-3.5 w-3.5 text-primary-foreground md:h-3 md:w-3" />
            </div>
            <div className={`min-w-0 ${activeMainView === "binder" ? "max-md:hidden" : ""}`}>
              <p className="truncate text-sm font-bold tracking-tight md:text-[13px]">BinderDex</p>
              <p className="hidden text-[10px] text-muted-foreground sm:block md:hidden">National Dex binder tracking</p>
            </div>
          </div>
          )}

          {activeMainView === "binder" && binderDimension === "2d" && (
            <div data-testid="mobile-header-pager" className="flex min-w-0 items-center gap-0.5 rounded-xl border border-border/50 bg-card/72 md:hidden dark:border-border/30 dark:bg-muted/35">
              <Button variant="ghost" size="icon" className="h-11 w-11 disabled:pointer-events-none disabled:opacity-35" onClick={isSpreadLayout ? goToPrevSpread : goToPrevPage} disabled={!canGoToPreviousVisiblePage} aria-label={isSpreadLayout ? "Previous binder spread" : "Previous binder page"}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <input
                type="number"
                min={1}
                max={totalBinderPages}
                value={pageInputValue}
                onChange={(e) => {
                  setPageInputValue(e.target.value)
                }}
                onBlur={commitPageInput}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    commitPageInput()
                    e.currentTarget.blur()
                  } else if (e.key === "Escape") {
                    setPageInputValue(String(currentBinderPage))
                    e.currentTarget.blur()
                  }
                }}
                inputMode="numeric"
                aria-label="Binder page number"
                className="h-11 w-11 rounded-lg border border-border/30 bg-background/70 text-center text-base font-semibold tabular-nums"
              />
              <span className="hidden whitespace-nowrap pr-0.5 text-xs text-muted-foreground tabular-nums min-[390px]:inline">/ {totalBinderPages}</span>
              <Button variant="ghost" size="icon" className="h-11 w-11 disabled:pointer-events-none disabled:opacity-35" onClick={isSpreadLayout ? goToNextSpread : goToNextPage} disabled={!canGoToNextVisiblePage} aria-label={isSpreadLayout ? "Next binder spread" : "Next binder page"}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}

          <div className="flex items-center gap-1">
            {canFilterCollection && (
              <div className="hidden items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-primary sm:flex">
                <span className="text-xs font-bold tabular-nums">{collectionCount}</span>
                <span className="text-[10px] text-primary/60 tabular-nums">/ {collectionStats.total}</span>
              </div>
            )}

            {readOnlyMode ? (
              <div className="hidden md:flex items-center gap-1 rounded-full border border-border/50 bg-card/72 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground dark:border-border/30 dark:bg-muted/35">
                Shared View
              </div>
            ) : !user ? (
              <Button size="sm" onClick={() => openExclusively(() => setIsAuthOpen(true))} className="h-11 min-w-11 gap-1 rounded-full px-3 md:h-7 md:min-w-0 md:px-2.5" aria-label="Sign in">
                <LogIn className="h-3.5 w-3.5" />
                <span className="hidden md:inline text-[11px]">Sign In</span>
              </Button>
            ) : null}


            <div className="relative hidden md:block" onClick={(event) => event.stopPropagation()}>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 rounded-full px-2"
                onClick={() => {
                  setIsDesktopActionsOpen((current) => !current)
                }}
                aria-expanded={isDesktopActionsOpen}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
                <span className="text-[11px]">More</span>
              </Button>

              {isDesktopActionsOpen && (
                <div className="absolute right-0 top-[calc(100%+0.45rem)] z-50 w-56 overflow-hidden rounded-xl border border-border/60 bg-card/96 p-1.5 text-sm shadow-[0_18px_44px_-24px_rgba(15,23,42,0.34)] backdrop-blur-xl dark:border-border/45 dark:bg-background/96">
                  {!readOnlyMode && <button className="flex min-h-9 w-full items-center rounded-lg px-2.5 py-2 text-left text-xs font-medium hover:bg-muted" onClick={() => { setIsDesktopActionsOpen(false); void switchMainView("analytics") }}>Analytics</button>}
                  {installPromptEvent && !isInstalledApp ? (
                    <button
                      onClick={() => {
                        setIsDesktopActionsOpen(false)
                        handleInstallApp()
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] font-medium text-foreground hover:bg-muted/70"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      Install app
                    </button>
                  ) : null}

                  {!readOnlyMode && user ? (
                    <button
                      onClick={() => {
                        setIsDesktopActionsOpen(false)
                        setIsPartnerOpen(true)
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] font-medium text-foreground hover:bg-muted/70"
                    >
                      <Users className="h-3.5 w-3.5" />
                      Partner
                    </button>
                  ) : null}

                  {!readOnlyMode && user ? (
                    <button
                      onClick={() => {
                        if (isShareEnabled && fullShareUrl) {
                          void handleCopyReadOnlyShareLink()
                          return
                        }

                        void handleEnableReadOnlyShare()
                      }}
                      disabled={isShareLoading}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] font-medium text-foreground hover:bg-muted/70 disabled:cursor-not-allowed disabled:opacity-55"
                    >
                      {isShareLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : isShareEnabled ? <Copy className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
                      {isShareEnabled ? "Copy share link" : "Create share link"}
                    </button>
                  ) : null}

                  <button
                    onClick={() => {
                      setIsDesktopActionsOpen(false)
                      setIsSettingsOpen(true)
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] font-medium text-foreground hover:bg-muted/70"
                  >
                    <Settings className="h-3.5 w-3.5" />
                    Settings
                  </button>
                  <button
                    onClick={() => {
                      setIsDesktopActionsOpen(false)
                      toggleDarkMode()
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] font-medium text-foreground hover:bg-muted/70"
                  >
                    {isDarkMode ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
                    {isDarkMode ? "Light mode" : "Dark mode"}
                  </button>

                  {(shareCopyMessage || shareMessage) && !readOnlyMode && user ? (
                    <p className="px-2.5 py-1 text-[10px] leading-snug text-primary">
                      {shareCopyMessage || shareMessage}
                    </p>
                  ) : null}

                  {!readOnlyMode && user ? (
                    <>
                      <div className="my-1 h-px bg-border/50" />
                      <button
                        onClick={() => {
                          setIsDesktopActionsOpen(false)
                          void handleSignOut()
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] font-medium text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                      >
                        <LogOut className="h-3.5 w-3.5" />
                        Sign out
                      </button>
                    </>
                  ) : null}
                </div>
              )}
            </div>

            {/* Phones: one More menu keeps the header to switcher, pager, More and Show. */}
            <HeaderMoreMenu
              items={[
                ...(activeMainView === "binder" && binderDimension === "2d"
                  ? [{
                      id: "previous-needed",
                      label: `Previous ${activeJumpLabel.toLowerCase()}`,
                      icon: <Sparkles className="h-4 w-4 -scale-x-100" />,
                      onSelect: handleJumpToPreviousNeeded,
                      disabled: activeJumpPokemonList.length === 0,
                    }]
                  : []),
                {
                  id: "controls",
                  label: "Binder controls",
                  icon: <SlidersHorizontal className="h-4 w-4" />,
                  onSelect: () => openExclusively(() => {
                    setSelectedPokemon(null)
                    setIsMobileNavExpanded(true)
                  }),
                },
                { id: "settings", label: "Settings", icon: <Settings className="h-4 w-4" />, onSelect: () => openExclusively(() => setIsSettingsOpen(true)) },
                { id: "theme", label: isDarkMode ? "Light mode" : "Dark mode", icon: isDarkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />, onSelect: toggleDarkMode },
              ]}
            />
            {/* Always-visible Show mode switch, on every main view. */}
            <button
              type="button"
              onClick={() => setShowMode(!isShowModeOn)}
              aria-pressed={isShowModeOn}
              aria-label="Show mode"
              title={isShowModeOn ? "Show mode is on: tap to exit" : "Card show mode"}
              data-testid="header-show-mode"
              className={`flex h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-full border px-2.5 md:min-w-0 text-xs font-semibold transition-colors md:h-7 md:text-[11px] ${
                  isShowModeOn
                    ? "border-amber-400 bg-amber-400 text-black"
                    : "border-primary/35 bg-primary/10 text-primary hover:bg-primary/15"
                }`}
            >
              <Ticket className="h-4 w-4 md:h-3.5 md:w-3.5" aria-hidden />
              {/* Signed out, a narrow 2D binder header also holds Sign in and the pager, so the pill drops its
                  text there; the "At a card show?" card below spells it out. */}
              <span className={!user && activeMainView === "binder" && binderDimension === "2d" ? "max-md:sr-only" : ""}>Show</span>
            </button>
          </div>
        </div>

        <div className="hidden border-t border-border/40 px-2 py-1 md:block">
            <div className="flex flex-wrap items-center gap-1.5 whitespace-nowrap">
              <div className="flex shrink-0 items-center gap-0.5">
              <button
                // Like the dock's Search: in Show mode it opens Quick mode's finder and deal check.
                onClick={isShowModeOn ? openQuickMode : openSearch}
                aria-label="Search"
                className={`flex min-h-9 min-w-9 items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-medium transition-[background-color,color,box-shadow] ${
                    isSearchOpen ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
              >
                <SearchIcon className="h-3 w-3" />
                <span className="hidden lg:inline">Search</span>
              </button>
              <button
                onClick={() => {
                  switchMainView("binder")
                }}
                className={`flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-medium transition-[background-color,color,box-shadow] ${
                    !isSearchOpen && activeMainView === "binder" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
              >
                <Grid3X3 className="h-3 w-3" />
                <span>Binder</span>
                </button>
              <button
                onClick={() => {
                  switchMainView("list")
                }}
                className={`flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-medium transition-[background-color,color,box-shadow] ${
                    !isSearchOpen && activeMainView === "list" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
              >
                <ListChecks className="h-3 w-3" />
                <span>List</span>
              </button>
              <button
                onClick={() => {
                  switchMainView("wanted")
                }}
                className={`flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-medium transition-[background-color,color,box-shadow] ${
                    !isSearchOpen && activeMainView === "wanted" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
              >
                <Heart className="h-3 w-3" />
                <span>Wanted</span>
              </button>
              <button
                onClick={() => switchMainView("pokemon")}
                aria-pressed={!isSearchOpen && activeMainView === "pokemon"}
                className={`flex min-h-9 items-center gap-1 rounded-lg px-2 text-[11px] font-medium transition-[background-color,color,box-shadow] ${!isSearchOpen && activeMainView === "pokemon" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                <BookOpen className="h-3 w-3" />
                <span>Pokémon</span>
              </button>
              <button
                onClick={() => {
                  switchMainView("sets")
                }}
                className={`flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-medium transition-[background-color,color,box-shadow] ${
                    !isSearchOpen && activeMainView === "sets" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
              >
                <Layers3 className="h-3 w-3" />
                <span>Sets</span>
              </button>
              </div>

            {activeMainView !== "pokemon" && activeMainView !== "analytics" && (
              <Button
                variant="outline"
                size="sm"
                className="ml-auto h-9 gap-1.5 rounded-xl px-3 text-xs"
                onClick={() => openExclusively(() => {
                  setIsDesktopActionsOpen(false)
                  setIsMobileNavExpanded(true)
                })}
                aria-haspopup="dialog"
                aria-expanded={isMobileNavExpanded}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                View
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
            )}

            {activeMainView === "binder" && binderDimension === "2d" && (
              <div className="flex shrink-0 items-center gap-1.5">
                <div className="flex items-center gap-0.5">
                  <Button variant="ghost" size="icon" className="h-9 w-9 disabled:pointer-events-none disabled:opacity-35" onClick={isSpreadLayout ? goToPrevSpread : goToPrevPage} disabled={!canGoToPreviousVisiblePage} aria-label={isSpreadLayout ? "Previous binder spread" : "Previous binder page"}>
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  {isSpreadLayout && (
                    <span className="hidden px-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground xl:inline-flex">
                      {visiblePageLabel}
                    </span>
                  )}
                  <input
                    type="number"
                    min={1}
                    max={totalBinderPages}
                    value={pageInputValue}
                    onChange={(e) => {
                      setPageInputValue(e.target.value)
                    }}
                    onBlur={commitPageInput}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        commitPageInput()
                        e.currentTarget.blur()
                      } else if (e.key === "Escape") {
                        setPageInputValue(String(currentBinderPage))
                        e.currentTarget.blur()
                      }
                    }}
                    aria-label="Binder page number"
                    className="h-8 w-10 rounded-lg border border-border/30 bg-background/70 text-center text-[11px] pointer-coarse:text-base font-semibold tabular-nums"
                  />
                  <span className="pr-1 text-[11px] text-muted-foreground">/ {totalBinderPages}</span>
                  <Button variant="ghost" size="icon" className="h-9 w-9 disabled:pointer-events-none disabled:opacity-35" onClick={isSpreadLayout ? goToNextSpread : goToNextPage} disabled={!canGoToNextVisiblePage} aria-label={isSpreadLayout ? "Next binder spread" : "Next binder page"}>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 w-9 rounded-lg px-0"
                  onClick={handleJumpToPreviousNeeded}
                  disabled={activeJumpPokemonList.length === 0}
                  aria-label={`Previous ${activeJumpLabel.toLowerCase()}`}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 min-w-9 gap-1.5 rounded-lg px-2 text-[11px]"
                  onClick={handleJumpToNextNeeded}
                  aria-label={`Next ${activeJumpLabel}`}
                  disabled={activeJumpPokemonList.length === 0}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span className="hidden lg:inline">Next {activeJumpLabel}</span>
                </Button>
              </div>
            )}
          </div>
        </div>
        </div>
      </div>
      {activeMainView === "binder" && <div className="flex items-center justify-between px-1 pt-1 md:hidden">
        {binderCardControls}
        {binderDisplayControls}
      </div>}
    </nav>
)
}
