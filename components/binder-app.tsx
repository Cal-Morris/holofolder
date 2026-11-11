"use client"
import { toast } from "@/components/ui/toast"
import { CHECKED_STARTUP_TIMEOUT_MS, CHECKED_STARTUP_TIMEOUT_ERROR, resetStartupCaches, STARTUP_RESET_KEY } from "@/lib/startup-cache-reset"

import { nativeSpeciesCollection, type NativeConsumerBinding } from "@/lib/collection/native-card-consumers"

import { CollectionActivityProvider } from "@/components/collection-activity-context"

import dynamic from "next/dynamic"
import { useGoogleAnalytics } from "@/components/google-analytics"
import { appPath } from "@/lib/app-path"
import { createBinderBackup, downloadBinderBackup } from "@/lib/binder-backup"
import { useCollectorAppOpen } from "@/components/collector-funnel"
import type { Binder } from "@/lib/binders/model"
import { binderHref, rememberBinderGrid, rememberLastOpenedBinder } from "@/lib/binders/client"
import { offlineAvailableBinderIds, rememberDeviceBinders } from "@/lib/binders/offline"
import { showBudgetStorageKey } from "@/lib/show-budget"
import { revisitStorageKey } from "@/lib/show-revisit"
import { getQuickCardState as resolveQuickCardState } from "@/lib/quick-card-state"
import { matchesCatalogCardId } from "@/lib/card-catalog"

import { useState, useMemo, useEffect, useEffectEvent, useLayoutEffect, useRef, useCallback, type CSSProperties, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from "react"
import dashboardStyles from "@/components/dashboard-binder-preview.module.css"
import { BillingContext, useBilling } from "@/hooks/use-billing"
import { CardDataAttribution } from "@/components/card-data-attribution"
import { useRouter } from "next/navigation"
import { WifiOff } from "lucide-react"
import { type PokemonSearchResultMeta } from "@/components/pokemon-search"
import { closeAllOverlays, runAfterOverlayHistory, useOverlay, useSwipeToDismiss } from "@/hooks/use-overlay"
import { inferCardFinish } from "@/lib/pokemon-card-browse"
import { getCardPriceKey, useCardPrices, type CardPriceLookup, type CardPriceSnapshot, type SupportedCurrency } from "@/hooks/use-card-prices"
import { PartnerPushPrompt } from "@/components/partner-push-prompt"
import { usePartnerPush } from "@/hooks/use-partner-push"
import { clearPushDevice } from "@/lib/push-device-client"
import { type CardFinish, type WantedCard } from "@/lib/domain/cards"
import { useBinderAppearance } from "@/hooks/use-binder-appearance"
import { useSettings, type BinderSettings } from "@/hooks/use-settings"
import { usePricingPreferences } from "@/hooks/use-pricing-preferences"
import { formatDisplayAmount, formatDisplayRange, formatDisplayTotals, formatRegionalPriceLabel, getRegionalFinishPrices, regionalizeCardPrices, type PriceDisplayContext } from "@/lib/regional-price"
import { normalizeCollectionItems } from "@/lib/collection/normalize"
import { useTouchGestures } from "@/hooks/use-touch-gestures"
import { loadCardsForPokemon } from "@/hooks/use-tcgdex"
import { POKEMON_CATALOG, formatPokemonDisplayName, getPokemonSummary, type PokemonSummary } from "@/lib/pokemon-catalog"
import { getBinderColorPreset, type BinderColorId } from "@/lib/binder-colors"
import { activeBinderEffects } from "@/lib/binder-effects"
import { buildBinderShareUrl, shareManagementTarget } from "@/lib/binder-share"
import { shouldClearSelectedPokemonForPage } from "@/lib/binder-selection-state"
import { getSelectedSlotCardDisplay, getBinderDisplayCard, type BinderCardDisplay } from "@/lib/selected-slot-card-display"
import { OFFLINE_CACHE_WARMUP_MESSAGE_TYPE, buildOfflineCacheWarmupUrls, getOfflineCacheWarmupSignature, shouldPostOfflineCacheWarmup } from "@/lib/offline-cache-warmup"
import { buildPokemonSearchPreview } from "@/lib/pokemon-search-preview"
import { buildWantedDashboardSummary } from "@/lib/wanted-dashboard"
import { buildWantedListText } from "@/lib/wanted-share"
import { TRADING_CARD_ASPECT_RATIO } from "@/lib/page-scan"
import { formatPriceConfidenceLabel, formatPriceSourceLabel } from "@/lib/card-labels"
import type { TCGSetDexSlot, TCGSetSummary } from "@/lib/tcg-set-slots"
import type { User } from "@supabase/supabase-js"
import { TopBannerSlot } from "@/components/top-banner-slot"
import { registerServiceWorker } from "@/lib/service-worker-registration"
import { ADJACENT_PREFETCH_DELAY_MS, getAdjacentPageNumbers } from "@/lib/binder-page-turn"
import { BinderSlotImages } from "@/lib/binder-slot-images"
import { useNavigationTransition } from "@/hooks/use-navigation-transition"
import { useViewScrollRestoration } from "@/hooks/use-view-scroll-restoration"
import { useEdgeSwipeBack } from "@/hooks/use-edge-swipe-back"
import { usePressFeedback } from "@/hooks/use-press-feedback"
import { useFreezeBlurOnScroll } from "@/hooks/use-freeze-blur-on-scroll"
import { QUICK_LONG_PRESS_MS, type QuickDestinationId } from "@/lib/quick-mode"
import { useShowMode } from "@/hooks/use-show-mode"
import { useShowSession } from "@/hooks/use-show-session"
import { useBinderHistory } from "@/hooks/use-binder-history"
import { useShowPurchaseSync } from "@/hooks/use-show-purchase-sync"
import { summarizeShowSession } from "@/lib/show-session"
import type { SearchCardResult } from "@/lib/pokemon-card-browse"
import { clampGlareValue, getPokemonOfficialArtworkUrl, resolveSlotImageUrl } from "@/components/binder/pokemon-slot"
import { type ActiveMainView, BINDER_PAGE_QUERY_PARAM, type BeforeInstallPromptEvent, COLLECTION_VIEW_FILTERS, type CollectionViewFilter, DEFAULT_SLOT_GLARE_STATE, type DeviceMotionWithPermission, type DeviceOrientationPermissionState, type DeviceOrientationWithPermission, type DisplaySpreadPage, GENERATIONS, type InitialCollectionRow, type MotionGlintStatus, type QuickPanelPosition, type SlotGlareState, THEME_COLOR_DARK, THEME_COLOR_LIGHT, binderShareUrl, combinePriceSummaries, formatCollectedDate, getCollectionItemPriceKey, getDetailArtwork, getDisplayArtworkTone, getKnownCardIllustrator, getPokemonArtwork, getSlotGlareState, getWantedCardKey, summarizeOwnedCardPrices, sumPriceSnapshots } from "@/components/binder/binder-app-model"
import type { PricedCardFinish } from "@/lib/card-pricing"
import type { CardPriceCheck } from "@/lib/card-price-checks"
import { buildSoldPriceGuide } from "@/lib/sold-price-guide"
import { readDealThresholds } from "@/lib/deal-check"
import { renderSelectedPokemonQuickPanelView } from "@/components/binder/selected-pokemon-quick-panel"
import { renderMobileSlotActionBarView } from "@/components/binder/mobile-slot-action-bar"
import { renderSpreadInfoPageView } from "@/components/binder/spread-info-page"
import { renderSpreadBlankPageView } from "@/components/binder/spread-blank-page"
import { renderBinderGridPageView, useBinderSlotActions } from "@/components/binder/binder-grid-page"
import { AuthModal, BinderSwitcherSheet, IllustratorCardsBrowser, NativeSlotFlow, PartnerModal, PokemonCardsBrowser, QuickMode, scheduleIdleViewPreload, SettingsModal } from "@/components/binder/lazy-views"
import { renderAppHeaderView } from "@/components/binder/app-header"
import { renderMainContentView } from "@/components/binder/main-content"
import { renderSearchOverlayView } from "@/components/binder/search-overlay"
import { renderMobileNavMenuView } from "@/components/binder/mobile-nav-menu"
import { renderBottomNavView } from "@/components/binder/bottom-nav"

import type { SlotCommandSink } from "@/lib/binder-slot-editing"
import type { InventoryCatalogResolver } from "@/lib/domain/inventory"
import type { LayoutSessionStart, LayoutTap } from "@/components/binder/layout-editor"
import type { WantedDashboardCard } from "@/lib/wanted-dashboard"
import { pocketPlace } from "@/lib/pocket-labels"
import { CollectionFilterBar } from "@/components/binder/collection-filter-bar"
import { displaySlotFilterFacts, legacyItemFilterFacts, matchesCollectionViewFilter } from "@/lib/collection-view-filter"
import { NativeBinderTotals } from "@/components/binder-value"
import { rememberBinderScope } from "@/lib/binders/all-binders"
import { buildSlotDisplay, displaySlotImageUrl, displaySlotPriceLookup, nativeBinderCoverStats, paginateDisplaySlots, resolveDisplaySelection, speciesPocket, type SlotDisplayInput } from "@/lib/binder-display-model"

import { useBrowserCollectionScope } from "@/hooks/use-browser-collection-scope"
import CachedNativeStartup from "@/components/cached-native-startup"
import { BinderSkeleton } from "@/components/binder-skeleton"
import NativeStartupRecorder from "@/components/collection-navigation/native-startup-recorder"
import { browserHostAdmission } from "@/lib/collection/browser-host-admission"
import type { BrowserSurfaceBinding } from "@/components/collection-navigation/browser-session"
import type { PublicReadIndex } from "@/lib/public-binder-display"
import type { ReactNode } from "react"
const NativeBinderScanner = dynamic(() => import("@/components/binder/native-scanner"), { ssr: false })
const BrowserCollectionSession = dynamic(() => import("@/components/collection-navigation/browser-session"), { ssr: false })

const NativeWantedEntries = dynamic(() => import("@/components/native-wanted-entries"), { loading: () => null })
const NativeCollectionAnalytics = dynamic(() => import("@/components/native-collection-analytics"), { ssr: false })

const CollectionSlotList = dynamic(() => import("@/components/collection-navigation/slot-list"), { ssr: false })

const LayoutToolbar = dynamic(() => import("@/components/binder/layout-editor").then(module => module.LayoutToolbar), { ssr: false })
const PocketMenu = dynamic(() => import("@/components/binder/pocket-menu"), { ssr: false })

interface BinderAppProps {
  /** Minted only by the server-gated loopback harness. Production bootstrap never supplies this. */
  localBrowserHost?: boolean
  browserSurface?: BrowserSurfaceBinding
  browserHeader?: ReactNode
  onBrowserSignOut?: () => Promise<void>
  /** Staged read-only injection: the session-less public share adapter or internal harnesses. Never the owner bootstrap. */
  stagedSlotDisplay?: SlotDisplayInput
  /** Public share navigation built from the public projection alone. Only used with stagedSlotDisplay and no browser session. */
  publicIndex?: PublicReadIndex
  /** Internal owner-only draft sink. No production caller or transport is enabled. */
  onStagedSlotCommandIntent?: SlotCommandSink
  stagedSlotSessionId?: string
  stagedSlotLocalDurable?: boolean
  stagedSlotCatalog?: InventoryCatalogResolver
  initialUser: User | null
  initialCollection: InitialCollectionRow[]
  initialCollectionOwnerUserId: string | null
  initialSettings: BinderSettings
  initialHasStoredSettings?: boolean
  initialDarkMode: boolean
  pricingEnabled?: boolean
  initialPriceMode?: boolean
  readOnlyMode?: boolean
  shareViewToken?: string | null
  initialSharePath?: string | null
  /** The owner's binders and the one this page shows (null before migration 039). */
  initialBinders?: Binder[]
  initialBinderId?: string | null
  /** Pockets per page of the binder this device opened last: the starting skeleton's grid. */
  startGrid?: { rows: number; cols: number }
}

/** Authenticated lifetimes never mount the writable legacy collection hook. */
export default function BinderApp(props: BinderAppProps) {
  const nativeHost = Boolean(props.initialUser && !props.readOnlyMode && !props.shareViewToken && !props.stagedSlotDisplay && !props.browserSurface)
  const browserScope = useBrowserCollectionScope(props.initialUser?.id ?? null, props.initialCollectionOwnerUserId ?? null, nativeHost)
  const [host, setHost] = useState<string | null>(null)
  useEffect(() => { queueMicrotask(() => setHost(location.host)) }, [])
  // Fetch the session's code while the account check runs, not after it.
  useEffect(() => { if (nativeHost) void import("@/components/collection-navigation/browser-session") }, [nativeHost])
  const scope = browserScope.scope
  const [completedSession, setCompletedSession] = useState<string | null>(null)
  const [displayedSession, setDisplayedSession] = useState<string | null>(null)
  const [startupError, setStartupError] = useState("")
  const [resetting, setResetting] = useState(false)
  const [startupOnline, setStartupOnline] = useState(true)
  const opened = Boolean(scope && completedSession === scope.sessionId)
  // A failed membership or billing read is retried from the page below, never by clearing offline data.
  const accessRetry = browserScope.accessCheckFailed && startupOnline
  const failStartup = useCallback((reason: string) => {
    if (!navigator.onLine) return
    setStartupError(reason)
    try {
      if (sessionStorage.getItem(STARTUP_RESET_KEY)) return
      sessionStorage.setItem(STARTUP_RESET_KEY, "1")
    } catch { return } // Without a durable guard, never risk a reload loop.
    setResetting(true)
    let deadline: ReturnType<typeof setTimeout>
    void Promise.race([
      resetStartupCaches(),
      new Promise<void>((_, reject) => { deadline = setTimeout(() => reject(new Error("offline_cache_reset_timed_out")), 3000) }),
    ]).catch(() => {}).finally(() => { clearTimeout(deadline); window.location.reload() })
  }, [])
  useEffect(() => {
    const update = () => setStartupOnline(navigator.onLine)
    update()
    window.addEventListener("online", update); window.addEventListener("offline", update)
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update) }
  }, [])
  useEffect(() => {
    if (!nativeHost || opened || accessRetry || !startupOnline || !navigator.onLine) return
    const timer = setTimeout(() => failStartup(CHECKED_STARTUP_TIMEOUT_ERROR), CHECKED_STARTUP_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [nativeHost, opened, accessRetry, startupOnline, failStartup])
  useEffect(() => {
    if (!nativeHost || opened || !browserScope.error || browserScope.accessCheckFailed) return
    const timer = setTimeout(() => failStartup(browserScope.error!), 0)
    return () => clearTimeout(timer)
  }, [nativeHost, opened, browserScope.error, browserScope.accessCheckFailed, failStartup])
  if (!nativeHost) return <BinderAppSurface {...props} />
  if (startupError && startupOnline && !opened) return <main className="flex min-h-dvh flex-col gap-3 bg-background px-4 pb-[var(--dock-clearance)] pt-[calc(env(safe-area-inset-top,0px)+1rem)] text-foreground">
    <p role="alert">{resetting ? "Clearing offline data and reopening storage…" : `Could not open storage: ${startupError}`}</p>
    {!resetting && <button type="button" className="min-h-10 self-start rounded-lg border px-3" onClick={() => window.location.reload()}>Retry opening storage</button>}
  </main>
  const admission = browserHostAdmission(Boolean(props.localBrowserHost), "1", false, host, scope)
  // Only an actual failed check gets a page of its own; it says what to do next.
  const failed = browserScope.error ? <main className="flex min-h-dvh flex-col gap-3 bg-background px-4 pb-[var(--dock-clearance)] pt-[calc(env(safe-area-inset-top,0px)+1rem)] text-foreground">
    <p role="status">{accessRetry ? "Could not check your collection access. Try again in a moment. Saved copies and pending edits are retained."
      : browserScope.cachedFallbackAllowed ? "Could not check your account. Connect and try again. Saved copies and pending edits are retained."
      : "Saved storage is paused. Connect to check your account and collection access. Pending edits are retained."}</p>
    <button type="button" className="min-h-10 self-start rounded-lg border px-3" onClick={() => window.location.reload()}>Try again</button>
    <a className="flex min-h-10 items-center self-start underline" href={appPath("/auth/logout")}>Sign out</a>
  </main> : null
  // While the check runs: the binder's skeleton, or this device's saved copy when the first check allows it.
  const loading = failed ?? <BinderSkeleton rows={props.startGrid?.rows ?? props.initialSettings.binderRows} cols={props.startGrid?.cols ?? props.initialSettings.binderCols} />
  const placeholder = browserScope.cachedFallbackAllowed && !accessRetry ? <CachedNativeStartup legacyProps={props} whileChecking>{loading}</CachedNativeStartup> : loading
  const session = scope && admission.admitted ? scope : null
  // The placeholder keeps its place (and its saved copy) until the session has something to paint,
  // so a reload goes skeleton or saved copy → binder once, never saved copy → skeleton → binder.
  const sessionDisplayed = Boolean(session && displayedSession === session.sessionId)
  return <>{!sessionDisplayed && placeholder}{session && <BrowserCollectionSession displayed={sessionDisplayed}
    onReady={() => setCompletedSession(session.sessionId)} onDisplay={setDisplayedSession} onStartupFailure={failStartup} scope={session} currentScope={browserScope.currentScope} initialBinderId={props.initialBinderId ?? null} binders={props.initialBinders}
    localHarness={admission.evidence === "synthetic-local-only"} renderFallback={() => <p role="status">Device storage is unavailable. Enable storage and reopen the app. Pending edits have not been removed.</p>}
    renderSurface={binding => {
      const context = binding.surface.state.main === "collection" ? binding.surface.collection : null
      const layout = context?.read.layouts.find(l => l.collectionId === context.collectionId && l.layoutRevision === binding.display?.binder.layoutRevision)
      return <><NativeStartupRecorder scope={session} /><BinderAppSurface {...props}
        key={JSON.stringify([session.sessionId, binding.surface.visit, binding.surface.state.main, binding.surface.state.dexView, context?.collectionId, context?.state.view])}
        localBrowserHost={false} browserSurface={binding} browserHeader={<>{browserScope.partnerPaused && <p role="status" className="px-4 text-sm">
          Shared collection paused: partners need the owner on Premium. You&apos;re in your own collection; edits saved for the shared one stay on this device.</p>}{binding.surface.header}</>}
        onBrowserSignOut={async () => { await clearPushDevice().catch(() => undefined); window.location.assign(appPath("/auth/logout")) }}
        initialCollectionOwnerUserId={session.ownerUserId} initialCollection={[]}
        initialBinderId={context?.collectionId ?? null}
        initialSettings={{ ...props.initialSettings, ...(layout ? { binderRows: layout.rows, binderCols: layout.cols } : {}) }}
        stagedSlotDisplay={binding.surface.state.main === "collection" ? binding.display : undefined}
        stagedSlotSessionId={session.sessionId} stagedSlotLocalDurable stagedSlotCatalog={binding.catalog}
        onStagedSlotCommandIntent={binding.surface.state.main === "collection" && binding.display ? binding.receive : undefined} /></>
    }} />}</>
}

function BinderAppSurface(props: BinderAppProps) {
  const {
  localBrowserHost = false, browserSurface, browserHeader, onBrowserSignOut,
  stagedSlotDisplay,
  onStagedSlotCommandIntent,
  stagedSlotCatalog,
  stagedSlotSessionId,
  stagedSlotLocalDurable,
  initialUser,
  initialCollection,
  initialCollectionOwnerUserId,
  initialSettings,
  initialHasStoredSettings = false,
  initialDarkMode,
  pricingEnabled = true,
  initialPriceMode = false,
  readOnlyMode: legacyReadOnlyMode = false,
  shareViewToken = null,
  initialSharePath = null,
  initialBinders = [],
  initialBinderId = null,
} = props
  const publicIndex = stagedSlotDisplay && !browserSurface ? props.publicIndex : undefined
  const readOnlyMode = legacyReadOnlyMode || Boolean(stagedSlotDisplay) || Boolean(browserSurface)
  const accountSettingsReadOnly = legacyReadOnlyMode || Boolean(shareViewToken) || (Boolean(stagedSlotDisplay) && !browserSurface)
  const router = useRouter()
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null)
  const closeSlotDetail = useCallback(() => setSelectedSlotId(null), [])
  const orderedDisplaySlots = useMemo(() => stagedSlotDisplay ? buildSlotDisplay(stagedSlotDisplay.binder, stagedSlotDisplay.inventory, stagedSlotDisplay.resolveCard ?? (id => stagedSlotDisplay.catalog[id])) : undefined, [stagedSlotDisplay])
  const nativeCoverStats = useMemo(() => stagedSlotDisplay ? nativeBinderCoverStats(stagedSlotDisplay.binder) : undefined, [stagedSlotDisplay])
  const selectedDisplaySlot = orderedDisplaySlots ? resolveDisplaySelection(orderedDisplaySlots, selectedSlotId) : null
  const [selectedPokemon, setSelectedPokemon] = useState<PokemonSummary | null>(null)
  const [wantedDetail, setWantedDetail] = useState<{ pokemonId: number; card: WantedCard } | null>(null)
  const [isDarkMode, setIsDarkMode] = useState(initialDarkMode)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isAuthOpen, setIsAuthOpen] = useState(false)
  const [authInitialMode, setAuthInitialMode] = useState<"sign-in" | "sign-up">("sign-in")
  const [isPartnerOpen, setIsPartnerOpen] = useState(false)
  const [isBinderSwitcherOpen, setIsBinderSwitcherOpen] = useState(false)
  const [binders, setBinders] = useState<Binder[]>(initialBinders)
  const activeBinder = binders.find((binder) => binder.id === initialBinderId) ?? null
  const [themeCookieChoice, setThemeCookieChoice] = useState<"dark" | "light" | null>(null)
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [isQuickModeOpen, setIsQuickModeOpen] = useState(false)
  // The want list's "Check price of any card": Quick mode as a price lookup (deal checker) outside Show mode.
  const [quickLookup, setQuickLookup] = useState<{ query: string } | null>(null)
  const { isShowModeOn, setShowMode } = useShowMode()
  const showSession = useShowSession()
  const quickPressTimerRef = useRef<number | null>(null)
  const quickPressFiredRef = useRef(false)
  const [isPriceMode, setIsPriceMode] = useState(pricingEnabled && initialPriceMode)
  const [activeMainView, setActiveMainView] = useState<ActiveMainView>(browserSurface?.surface.state.main === "collection" ? browserSurface.surface.collection?.state.view === "list" ? "list" : "binder" : browserSurface?.surface.state.main === "dex" ? browserSurface.surface.state.dexView ?? "list" : "binder")
  const trackGoogleEvent = useGoogleAnalytics()
  useEffect(() => {
    trackGoogleEvent("screen_view", { screen_name: activeMainView, show_mode: isShowModeOn, read_only: readOnlyMode })
  }, [activeMainView, isShowModeOn, readOnlyMode, trackGoogleEvent])
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("view") === "wanted") queueMicrotask(() => setActiveMainView("wanted"))
  }, [])
  const lastBrowseViewRef = useRef<"pokemon" | "sets">("sets")
  const [viewLoadError, setViewLoadError] = useState<string | null>(null)
  const [selectedGen, setSelectedGen] = useState(0)
  const [currentBinderPage, setCurrentBinderPage] = useState(browserSurface?.surface.collection?.state.page ?? 1)
  const [pageNavigation, setPageNavigation] = useState<{ page: number; direction: "left" | "right" } | null>(null)
  const pendingBinderPage = pageNavigation?.page ?? null
  const [pageInputValue, setPageInputValue] = useState("1")
  const [collectionViewFilter, setCollectionViewFilter] = useState<CollectionViewFilter>("all")
  const [isMobileNavExpanded, setIsMobileNavExpanded] = useState(false)
  const [isDesktopActionsOpen, setIsDesktopActionsOpen] = useState(false)
  const [longPressedPokemon, setLongPressedPokemon] = useState<{ id: number; name: string } | null>(null)
  // Read-only "all cards for this Pokémon" view. `nested` = opened from the card detail (returns to it).
  const [nativeLookup, setNativeLookupState] = useState<{ card: SearchCardResult; finish?: CardFinish } | null>(null)
  const setNativeLookup = useCallback((card: SearchCardResult | null, finish?: CardFinish) => setNativeLookupState(card ? { card, finish } : null), [])
  const [cardBrowser, setCardBrowser] = useState<{ pokemon: { id: number; name: string }; highlightCardId?: string | null; focusedCard?: SearchCardResult; finish?: CardFinish; nested: boolean } | null>(null)
  const [illustratorBrowser, setIllustratorBrowser] = useState<{ name: string; nested: boolean } | null>(null)
  // A set hit tapped in Search or Quick mode; Sets opens on it until he leaves Sets.
  const [setViewRequest, setSetViewRequest] = useState<{ set: TCGSetSummary; key: number } | null>(() => {
    const set = browserSurface?.surface.state.requestedSet
    return set ? { set, key: 0 } : null
  })
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false)
  const transitionContent = useNavigationTransition(prefersReducedMotion)
  usePressFeedback()
  useFreezeBlurOnScroll()
  const mainViewRef = useRef<HTMLDivElement>(null)
  useViewScrollRestoration(mainViewRef, activeMainView)
  const viewRequestRef = useRef(0)
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return
    const query = window.matchMedia("(prefers-reduced-motion: reduce)")
    const update = () => setPrefersReducedMotion(query.matches)
    update()
    query.addEventListener?.("change", update)
    return () => query.removeEventListener?.("change", update)
  }, [])
  // Once the binder has painted, fetch the other tabs' code in idle time so the first switch
  // doesn't wait on a download. The frame callback pushes the idle wait past that first paint.
  useEffect(() => {
    let cancelPreload: (() => void) | null = null
    const frame = window.requestAnimationFrame(() => { cancelPreload = scheduleIdleViewPreload() })
    return () => {
      window.cancelAnimationFrame(frame)
      cancelPreload?.()
    }
  }, [])
  const [shareIdentityRevision, setShareIdentityRevision] = useState(0)
  const handlePublicIdentityChange = useCallback(() => setShareIdentityRevision(value => value + 1), [])
  const [sharePath, setSharePath] = useState<string | null>(initialSharePath ?? (shareViewToken ? `/app/share/${shareViewToken}` : null))
  const [isShareEnabled, setIsShareEnabled] = useState(Boolean(shareViewToken))
  const [shareShowPrices, setShareShowPrices] = useState(false)
  const [isShareLoading, setIsShareLoading] = useState(false)
  const [isRefreshingPrices, setIsRefreshingPrices] = useState(false)
  const [priceRefreshMessage, setPriceRefreshMessage] = useState<string | null>(null)
  const [isOnline, setIsOnline] = useState(true)
  const [isInstalledApp, setIsInstalledApp] = useState(false)
  const [installPromptEvent, setInstallPromptEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [pwaStatusMessage, setPwaStatusMessage] = useState<string | null>(null)
  const [isDesktopViewport, setIsDesktopViewport] = useState(false)
  const [isCompactViewport, setIsCompactViewport] = useState(false)
  const [isWideBinderSpread, setIsWideBinderSpread] = useState(false)
  const [binderCardDisplay, setBinderCardDisplay] = useState<BinderCardDisplay>("mixed")
  const [binderDimension, setBinderDimension] = useState<"2d" | "3d">("2d")
  const [isMobileSpreadPreview, setIsMobileSpreadPreview] = useState(false)
  const [slotGlareState, setSlotGlareState] = useState(DEFAULT_SLOT_GLARE_STATE)
  const [motionGlintStatus, setMotionGlintStatus] = useState<MotionGlintStatus>("fallback")
  const [motionGlintMessage, setMotionGlintMessage] = useState<string | null>(null)
  const [motionSensorVersion, setMotionSensorVersion] = useState(0)
  const [quickPanelPosition, setQuickPanelPosition] = useState<QuickPanelPosition | null>(null)
  const [binderStageSize, setBinderStageSize] = useState({ width: 0, height: 0 })
  const pagePhotoInputRef = useRef<HTMLInputElement | null>(null)
  const hasHydratedPageFromQueryRef = useRef(false)
  const quickPanelRef = useRef<HTMLDivElement | null>(null)
  const binderStageRef = useRef<HTMLDivElement | null>(null)
  const binderPageRef = useRef<HTMLDivElement | null>(null)
  const slotButtonRefs = useRef(new Map<number, HTMLButtonElement>())
  const shellNavRef = useRef<HTMLElement | null>(null)
  const motionSensorsEnabledRef = useRef(false)
  const hasAutoRequestedMotionPermissionRef = useRef(false)
  const isRequestingMotionPermissionRef = useRef(false)
  const lastOfflineCacheWarmupSignatureRef = useRef<string | null>(null)

  const pokemonList = POKEMON_CATALOG
  // The collection on screen is what the host passed in: native lifetimes and shares bring their own
  // storage, and signed-out guests can only look. Nothing here writes a collection.
  const user = initialUser
  const collection = useMemo(() => normalizeCollectionItems(initialCollection), [initialCollection])
  const resolvedCollectionOwnerUserId = user ? initialCollectionOwnerUserId : null
  // Owned cards in the collection on screen, which decides whether Show sits in the header or in More.
  // A signed-in binder is native and its legacy rows are always empty, so it counts the occupied pockets
  // of the binder in view, or every owned card when there is no binder to look at.
  const nativeBinderInView = browserSurface?.display?.binder, nativeEvidence = browserSurface?.nativeConsumer?.read.evidence
  const collectionCount = useMemo(() => !browserSurface ? collection.filter((item) => item.status !== "wishlisted").length
    : nativeBinderInView ? nativeBinderCoverStats(nativeBinderInView).collected
    : nativeEvidence && nativeEvidence.kind !== "unavailable" ? nativeEvidence.snapshot.items.length : 0,
  [browserSurface, collection, nativeBinderInView, nativeEvidence])
  const getCollectionItem = useCallback((pokemonId: number) => collection.find((item) => item.pokemon_id === pokemonId), [collection])
  const isCollected = useCallback((pokemonId: number) => collection.some((item) => item.pokemon_id === pokemonId && item.status !== "wishlisted"), [collection])
  const isWishlisted = useCallback((pokemonId: number) => collection.some((item) => item.pokemon_id === pokemonId && (item.status === "wishlisted" || item.wanted_cards.length > 0)), [collection])
  // Signed-in editing is native (browserSurface or staged slots); a signed-out visitor on their own surface is a guest.
  const guest = !readOnlyMode && !user && !shareViewToken
  const requireAccount = useCallback(async (..._edit: unknown[]) => {
    if (!guest) return
    closeAllOverlays()
    runAfterOverlayHistory(() => { setAuthInitialMode("sign-up"); setIsAuthOpen(true) })
  }, [guest])

  // The binder on screen is this device's last opened one (the server reads the cookie on the next visit).
  useEffect(() => {
    if (!readOnlyMode) rememberLastOpenedBinder(initialBinderId)
  }, [initialBinderId, readOnlyMode])
  // The binder list stays on this device, so the switcher still works offline (lib/binders/offline.ts).
  useEffect(() => {
    if (readOnlyMode || !user || !resolvedCollectionOwnerUserId || binders.length === 0) return
    rememberDeviceBinders(window.localStorage, resolvedCollectionOwnerUserId, binders)
  }, [binders, readOnlyMode, resolvedCollectionOwnerUserId, user])
  useEffect(() => { queueMicrotask(closeSlotDetail) }, [stagedSlotDisplay?.inventory.ownerUserId, stagedSlotDisplay?.binder.collectionId, user?.id, closeSlotDetail])
  const historyScope = useMemo(() => readOnlyMode ? null : user
    ? resolvedCollectionOwnerUserId ? { accountId: user.id, ownerId: resolvedCollectionOwnerUserId, binderId: initialBinderId ?? "local" } : null
    : undefined, [readOnlyMode, user, resolvedCollectionOwnerUserId, initialBinderId])
  const history = useBinderHistory(historyScope)
  const refreshHistory = history.refresh
  useEffect(() => {
    if (isSearchOpen || isQuickModeOpen) refreshHistory()
  }, [isSearchOpen, isQuickModeOpen, refreshHistory])

  // Show purchases go to the collection owner's account (queued while offline), so a partner sees them too.
  useShowPurchaseSync({ ownerUserId: user && !readOnlyMode ? resolvedCollectionOwnerUserId ?? null : null, isOnline, isShowModeOn })

  const [pendingBinderSwitch, setPendingBinderSwitch] = useState<string | null>(null)
  const switchBinder = useCallback((binderId: string) => {
    setIsBinderSwitcherOpen(false)
    if (binderId === initialBinderId) return
    rememberLastOpenedBinder(binderId)
    setPendingBinderSwitch(binderId)
  }, [initialBinderId])
  // Navigate after the sheet has closed and its history entry is popped (BinderApp remounts per binder).
  useEffect(() => {
    if (!pendingBinderSwitch || isBinderSwitcherOpen) return
    runAfterOverlayHistory(() => {
      const href = binderHref(pendingBinderSwitch, window.location.href, binders.find(b => b.id === pendingBinderSwitch)?.slug)
      // Offline, a full load lets the service worker open that binder's saved copy from the app shell.
      if (typeof navigator !== "undefined" && navigator.onLine === false) window.location.assign(appPath(href))
      else router.push(href)
    })
  }, [binders, isBinderSwitcherOpen, pendingBinderSwitch, router])
  const closeBinderSwitcher = useCallback(() => setIsBinderSwitcherOpen(false), [])
  const { settings, updateSettings: updateLegacySettings } = useSettings({
    binderId: initialBinderId,
    initialSettings,
    initialUser,
    settingsOwnerUserId: initialCollectionOwnerUserId,
    readOnly: accountSettingsReadOnly,
    readOnlyLayout: Boolean(browserSurface),
    hasRemoteSettings: initialHasStoredSettings,
  })
  const binderAppearance = useBinderAppearance({
    owner: resolvedCollectionOwnerUserId,
    settings,
    enabled: Boolean(user && resolvedCollectionOwnerUserId) && !readOnlyMode,
    legacyKey: user && resolvedCollectionOwnerUserId ? `owner:${user.id}:${resolvedCollectionOwnerUserId}` : undefined,
  })
  const updateSettings = useCallback(async (updates: Partial<BinderSettings>, appearancePageColors?: Record<string, string>) => {
    await updateLegacySettings(updates)
    if (initialBinderId && (updates.binderRows !== undefined || updates.binderCols !== undefined)) {
      setBinders(current => current.map(binder => binder.id === initialBinderId ? { ...binder, rows: updates.binderRows ?? binder.rows, cols: updates.binderCols ?? binder.cols } : binder))
    }
    if (!binderAppearance.hasSavedDesign || readOnlyMode) return
    if (updates.binderColorId === undefined && updates.binderPageColors === undefined && (initialBinderId || (updates.binderRows === undefined && updates.binderCols === undefined))) return
    const design = binderAppearance.design
    const rows = initialBinderId ? design.rows : updates.binderRows ?? design.rows
    const cols = initialBinderId ? design.cols : updates.binderCols ?? design.cols
    let pageColors = appearancePageColors ?? design.pageColors
    if (appearancePageColors === undefined && updates.binderPageColors !== undefined) {
      pageColors = Object.keys(updates.binderPageColors).length === 0 ? {} : { ...design.pageColors }
      for (const page of Object.keys(settings.binderPageColors)) {
        if (!(page in updates.binderPageColors)) delete pageColors[page]
      }
      for (const [page, color] of Object.entries(updates.binderPageColors)) {
        if (color !== settings.binderPageColors[page] || pageColors[page] === undefined) pageColors[page] = getBinderColorPreset(color).swatch[0]
      }
    }
    await binderAppearance.save({
      ...design,
      rows,
      cols,
      pageCount: Math.max(design.pageCount, Math.ceil(1025 / (rows * cols))),
      pageColor: updates.binderColorId === undefined ? design.pageColor : getBinderColorPreset(updates.binderColorId).swatch[0],
      pageColors,
    }, binderAppearance.uploads).catch(() => {})
  }, [initialBinderId, updateLegacySettings, binderAppearance, readOnlyMode, settings.binderPageColors])

  const canEditBinder = !readOnlyMode
  // Share management is an owner/partner permission, separate from legacy write suppression (see shareManagementTarget).
  const nativeShareContext = browserSurface ? browserSurface.surface.state.main === "collection" ? browserSurface.surface.collection : null : undefined
  const shareTarget = shareManagementTarget({
    userId: user?.id ?? null, ownerUserId: initialCollectionOwnerUserId, publicView: legacyReadOnlyMode || Boolean(shareViewToken),
    legacyBinderId: initialBinderId, legacyWritable: !readOnlyMode,
    native: nativeShareContext === undefined ? undefined : nativeShareContext && { accountUserId: nativeShareContext.read.scope.accountUserId, ownerUserId: nativeShareContext.read.scope.ownerUserId, collectionId: nativeShareContext.collectionId, evidence: nativeShareContext.read.evidence },
  })
  const canManageShare = Boolean(shareTarget)
  const shareBinderId = shareTarget?.binderId ?? null
  const shareScopeKey = canManageShare ? JSON.stringify([user?.id, initialCollectionOwnerUserId, shareBinderId]) : null
  const shareScopeRef = useRef(shareScopeKey)
  useEffect(() => { shareScopeRef.current = shareScopeKey }, [shareScopeKey])
  const canFilterCollection = readOnlyMode || Boolean(user)
  const canInstallApp = Boolean(installPromptEvent)
  const binderEffectSettings = useMemo(() => activeBinderEffects(settings, { view: activeMainView, searchOpen: isSearchOpen, quickModeOpen: isQuickModeOpen }), [settings, activeMainView, isSearchOpen, isQuickModeOpen])
  const motionGlintEffectsEnabled = binderEffectSettings.binderSlotGlareEnabled || binderEffectSettings.cardFinishEffectsEnabled
  const fullShareUrl = useMemo(() => {
    if (!sharePath) return null
    if (typeof window === "undefined") return sharePath

    return buildBinderShareUrl(window.location.origin, sharePath)
  }, [sharePath])
  const [pushSettingsRequested, setPushSettingsRequested] = useState(false)
  useCollectorAppOpen(user?.id ?? null, !readOnlyMode)
  const requestUpgrade = useCallback(() => {
    closeAllOverlays()
    setSelectedPokemon(null)
    setPushSettingsRequested(true)
    runAfterOverlayHistory(() => setIsSettingsOpen(true))
  }, [setIsSettingsOpen, setPushSettingsRequested, setSelectedPokemon])
  const billing = useBilling(accountSettingsReadOnly ? null : user?.id ?? null, resolvedCollectionOwnerUserId, requestUpgrade)
  useEffect(() => {
    const upgrade = () => requestUpgrade()
    const signIn = () => { closeAllOverlays(); runAfterOverlayHistory(() => setIsAuthOpen(true)) }
    window.addEventListener("holofolder-upgrade", upgrade)
    window.addEventListener("holofolder-sign-in", signIn)
    return () => { window.removeEventListener("holofolder-upgrade", upgrade); window.removeEventListener("holofolder-sign-in", signIn) }
  }, [requestUpgrade])

  usePartnerPush(user?.id ?? null, !readOnlyMode, isShowModeOn)
  const handleSignOut = useCallback(async () => {
    await clearPushDevice().catch(() => undefined)
    router.push("/auth/logout")
  }, [router])
  const collectionByPokemonId = useMemo(
    () => new Map(collection.map((item) => [item.pokemon_id, item] as const)),
    [collection],
  )


  const slotsPerPage = settings.binderRows * settings.binderCols
  const currentPageBinderColorId = settings.binderPageColors[String(currentBinderPage)] ?? settings.binderColorId
  const isSpreadLayout = isWideBinderSpread || (isCompactViewport && isMobileSpreadPreview)
  const getBinderThemeForPage = useCallback((pageNumber?: number | null) => {
    const binderColorId =
      pageNumber && pageNumber > 0
        ? settings.binderPageColors[String(pageNumber)] ?? settings.binderColorId
        : settings.binderColorId
    const binderColor = getBinderColorPreset(binderColorId)

    const theme = isDarkMode ? binderColor.dark : binderColor.light
    if (!binderAppearance.hasSavedDesign) return theme
    const savedColor = pageNumber && pageNumber > 0
      ? binderAppearance.design.pageColors[String(pageNumber)] || binderAppearance.design.pageColor
      : binderAppearance.design.pageColor
    return { ...theme, background: `linear-gradient(145deg, ${savedColor}, color-mix(in srgb, ${savedColor} 85%, black))`, border: `color-mix(in srgb, ${savedColor} 60%, white)` }
  }, [isDarkMode, settings.binderColorId, settings.binderPageColors, binderAppearance.hasSavedDesign, binderAppearance.design])

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }

    const desktopMediaQuery = window.matchMedia("(min-width: 640px)")
    const compactMediaQuery = window.matchMedia("(max-width: 767px)")
    const spreadMediaQuery = window.matchMedia("(min-width: 1280px)")
    const updateViewportMode = () => {
      setIsDesktopViewport(desktopMediaQuery.matches)
      setIsCompactViewport(compactMediaQuery.matches)
      setIsWideBinderSpread(spreadMediaQuery.matches)
    }

    updateViewportMode()

    if (
      typeof desktopMediaQuery.addEventListener === "function"
      && typeof compactMediaQuery.addEventListener === "function"
      && typeof spreadMediaQuery.addEventListener === "function"
    ) {
      desktopMediaQuery.addEventListener("change", updateViewportMode)
      compactMediaQuery.addEventListener("change", updateViewportMode)
      spreadMediaQuery.addEventListener("change", updateViewportMode)
      return () => {
        desktopMediaQuery.removeEventListener("change", updateViewportMode)
        compactMediaQuery.removeEventListener("change", updateViewportMode)
        spreadMediaQuery.removeEventListener("change", updateViewportMode)
      }
    }

    desktopMediaQuery.addListener(updateViewportMode)
    compactMediaQuery.addListener(updateViewportMode)
    spreadMediaQuery.addListener(updateViewportMode)
    return () => {
      desktopMediaQuery.removeListener(updateViewportMode)
      compactMediaQuery.removeListener(updateViewportMode)
      spreadMediaQuery.removeListener(updateViewportMode)
    }
  }, [])

  useEffect(() => {
    if (!isCompactViewport && isMobileSpreadPreview) {
      setIsMobileSpreadPreview(false)
    }
  }, [isCompactViewport, isMobileSpreadPreview])

  useEffect(() => {
    const stage = binderStageRef.current
    if (!stage || typeof ResizeObserver === "undefined") {
      return
    }

    let frame = 0
    const updateStageSize = () => {
      const rect = stage.getBoundingClientRect()
      const width = Math.floor(rect.width)
      const height = Math.floor(rect.height)

      setBinderStageSize((current) => {
        if (current.width === width && current.height === height) {
          return current
        }

        return { width, height }
      })
    }
    const observer = new ResizeObserver(() => {
      if (frame) {
        window.cancelAnimationFrame(frame)
      }

      frame = window.requestAnimationFrame(updateStageSize)
    })

    updateStageSize()
    observer.observe(stage)

    return () => {
      if (frame) {
        window.cancelAnimationFrame(frame)
      }
      observer.disconnect()
    }
  }, [activeMainView, binderDimension])

  const handleRequestMotionGlint = useCallback(async () => {
    if (typeof window === "undefined") {
      setMotionGlintStatus("unsupported")
      setMotionGlintMessage("Motion glint is not available in this browser.")
      return
    }

    if (!motionGlintEffectsEnabled) {
      setMotionGlintStatus("disabled")
      setMotionGlintMessage("Turn on binder slot glare or card finish glints first.")
      return
    }

    if (isRequestingMotionPermissionRef.current) {
      return
    }

    isRequestingMotionPermissionRef.current = true
    hasAutoRequestedMotionPermissionRef.current = true

    try {
      const orientationApi = window.DeviceOrientationEvent as DeviceOrientationWithPermission | undefined
      const motionApi = window.DeviceMotionEvent as DeviceMotionWithPermission | undefined
      const requests: Array<Promise<DeviceOrientationPermissionState>> = []

      if (orientationApi && typeof orientationApi.requestPermission === "function") {
        requests.push(orientationApi.requestPermission().catch(() => "denied"))
      }

      if (motionApi && typeof motionApi.requestPermission === "function") {
        requests.push(motionApi.requestPermission().catch(() => "denied"))
      }

      if (requests.length === 0) {
        motionSensorsEnabledRef.current = Boolean(orientationApi || motionApi)
        setMotionSensorVersion((version) => version + 1)
        setMotionGlintStatus(motionSensorsEnabledRef.current ? "fallback" : "unsupported")
        setMotionGlintMessage(
          motionSensorsEnabledRef.current
            ? "Listening for device motion. Pointer movement stays on as fallback."
            : "This browser is using pointer movement because motion sensors are not exposed.",
        )
        return
      }

      setMotionGlintStatus("requesting")
      setMotionGlintMessage(null)

      const results = await Promise.all(requests)
      if (results.some((result) => result === "granted")) {
        motionSensorsEnabledRef.current = true
        setMotionSensorVersion((version) => version + 1)
        setMotionGlintStatus("active")
        setMotionGlintMessage("Motion glint is enabled. Tilt the phone to move the shine.")
        return
      }

      motionSensorsEnabledRef.current = false
      setMotionSensorVersion((version) => version + 1)
      setMotionGlintStatus("denied")
      setMotionGlintMessage("Motion permission was denied. Touch and pointer movement still drive the shine.")
    } finally {
      isRequestingMotionPermissionRef.current = false
    }
  }, [motionGlintEffectsEnabled])

  useEffect(() => {
    if (
      typeof window === "undefined"
      || !motionGlintEffectsEnabled
      || motionGlintStatus !== "needs-permission"
      || hasAutoRequestedMotionPermissionRef.current
    ) {
      return
    }

    const orientationApi = window.DeviceOrientationEvent as DeviceOrientationWithPermission | undefined
    const motionApi = window.DeviceMotionEvent as DeviceMotionWithPermission | undefined
    const canRequestPermission =
      Boolean(orientationApi && typeof orientationApi.requestPermission === "function")
      || Boolean(motionApi && typeof motionApi.requestPermission === "function")

    if (!canRequestPermission) {
      return
    }

    const requestFromGesture = () => {
      if (hasAutoRequestedMotionPermissionRef.current) {
        return
      }

      hasAutoRequestedMotionPermissionRef.current = true
      void handleRequestMotionGlint()
    }

    window.addEventListener("click", requestFromGesture, { capture: true, once: true })
    window.addEventListener("touchend", requestFromGesture, { capture: true, once: true })

    return () => {
      window.removeEventListener("click", requestFromGesture, true)
      window.removeEventListener("touchend", requestFromGesture, true)
    }
  }, [handleRequestMotionGlint, motionGlintStatus, motionGlintEffectsEnabled])

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }

    setSlotGlareState(DEFAULT_SLOT_GLARE_STATE)

    if (!motionGlintEffectsEnabled) {
      // Pausing rendering does not revoke an iOS motion permission already granted.
      setMotionGlintStatus("disabled")
      setMotionGlintMessage(null)
      return
    }

    let frameId = 0
    let nextState = DEFAULT_SLOT_GLARE_STATE
    let lastSensorUpdateAt = 0
    let hasBoundSensorListeners = false
    let sensorFallbackTimer = 0
    const orientationApi = window.DeviceOrientationEvent as DeviceOrientationWithPermission | undefined
    const motionApi = window.DeviceMotionEvent as DeviceMotionWithPermission | undefined
    const needsExplicitPermission =
      Boolean(orientationApi && typeof orientationApi.requestPermission === "function")
      || Boolean(motionApi && typeof motionApi.requestPermission === "function")
    const hasSensorApi = Boolean(orientationApi || motionApi)

    const flush = () => {
      frameId = 0
      setSlotGlareState(nextState)
    }

    const queueState = (state: SlotGlareState, source: "sensor" | "fallback" = "fallback") => {
      nextState = state
      if (source === "sensor") {
        lastSensorUpdateAt = Date.now()
        if (sensorFallbackTimer) {
          window.clearTimeout(sensorFallbackTimer)
          sensorFallbackTimer = 0
        }
        setMotionGlintStatus((status) => (status === "active" ? status : "active"))
        setMotionGlintMessage(null)
      }

      if (!frameId) {
        frameId = window.requestAnimationFrame(flush)
      }
    }

    const handleOrientation = (event: DeviceOrientationEvent) => {
      if (typeof event.gamma !== "number" || typeof event.beta !== "number") {
        return
      }

      const gamma = Math.max(-35, Math.min(35, event.gamma))
      const beta = Math.max(-15, Math.min(70, event.beta))
      const screenAngle = typeof window.screen?.orientation?.angle === "number"
        ? window.screen.orientation.angle
        : typeof (window as Window & { orientation?: number }).orientation === "number"
          ? (window as Window & { orientation?: number }).orientation ?? 0
          : 0
      const portraitTiltX = gamma / 32
      const portraitTiltY = (beta - 35) / 38
      const isLandscape = Math.abs(screenAngle) === 90 || Math.abs(screenAngle) === 270
      const tiltX = isLandscape ? portraitTiltY * Math.sign(screenAngle || 1) : portraitTiltX
      const tiltY = isLandscape ? -portraitTiltX * Math.sign(screenAngle || 1) : portraitTiltY

      queueState(getSlotGlareState(
        clampGlareValue(tiltX, -1, 1) * 34 - 18,
        clampGlareValue(tiltY, -1, 1) * 28 - 12,
        clampGlareValue(tiltX, -1, 1) * 24 - clampGlareValue(tiltY, -1, 1) * 10 - 24,
        1
      ), "sensor")
    }

    const handleOrientationAbsolute = (event: DeviceOrientationEvent) => {
      handleOrientation(event)
    }

    const handleMotion = (event: DeviceMotionEvent) => {
      const acceleration = event.accelerationIncludingGravity
      if (
        !acceleration ||
        typeof acceleration.x !== "number" ||
        typeof acceleration.y !== "number"
      ) {
        return
      }

      const accelX = Math.max(-8, Math.min(8, acceleration.x))
      const accelY = Math.max(-8, Math.min(8, acceleration.y))

      queueState(
        getSlotGlareState(
          accelX * 4.6 - 24,
          accelY * -3.2 - 18,
          accelX * 5.2 - accelY * 1.3 - 26,
          1
        ),
        "sensor"
      )
    }

    const bindSensorListeners = () => {
      if (hasBoundSensorListeners) {
        return
      }

      hasBoundSensorListeners = true
      if (orientationApi) {
        window.addEventListener("deviceorientation", handleOrientation, true)
        window.addEventListener("deviceorientationabsolute", handleOrientationAbsolute as EventListener, true)
      }
      if (motionApi) {
        window.addEventListener("devicemotion", handleMotion, true)
      }

      sensorFallbackTimer = window.setTimeout(() => {
        if (lastSensorUpdateAt === 0) {
          setMotionGlintStatus("fallback")
          setMotionGlintMessage("Motion sensors did not send data yet. Touch and pointer movement are active.")
        }
      }, 1800)
    }

    const unbindSensorListeners = () => {
      if (!hasBoundSensorListeners) {
        return
      }

      hasBoundSensorListeners = false
      if (sensorFallbackTimer) {
        window.clearTimeout(sensorFallbackTimer)
        sensorFallbackTimer = 0
      }
      if (orientationApi) {
        window.removeEventListener("deviceorientation", handleOrientation, true)
        window.removeEventListener("deviceorientationabsolute", handleOrientationAbsolute as EventListener, true)
      }
      if (motionApi) {
        window.removeEventListener("devicemotion", handleMotion, true)
      }
    }

    const canUseFallbackInput = () => Date.now() - lastSensorUpdateAt >= 900

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") {
        return
      }
      if (!canUseFallbackInput()) {
        return
      }

      const normalizedX = ((event.clientX / window.innerWidth) - 0.5) * 2
      const normalizedY = ((event.clientY / window.innerHeight) - 0.5) * 2

      queueState(getSlotGlareState(
        normalizedX * 26 - 24,
        normalizedY * 16 - 18,
        normalizedX * 18 + normalizedY * 5 - 26,
        1
      ))
    }

    const handlePointerLeave = () => {
      if (!canUseFallbackInput()) {
        return
      }
      queueState(DEFAULT_SLOT_GLARE_STATE)
    }

    const handleTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0]
      if (!touch) {
        return
      }
      if (!canUseFallbackInput()) {
        return
      }

      const normalizedX = ((touch.clientX / window.innerWidth) - 0.5) * 2
      const normalizedY = ((touch.clientY / window.innerHeight) - 0.5) * 2

      queueState(getSlotGlareState(
        normalizedX * 26 - 24,
        normalizedY * 16 - 18,
        normalizedX * 18 + normalizedY * 8 - 26,
        1
      ))
    }

    const handleTouchEnd = () => {
      if (!canUseFallbackInput()) {
        return
      }
      queueState(DEFAULT_SLOT_GLARE_STATE)
    }

    window.addEventListener("pointermove", handlePointerMove, true)
    window.addEventListener("pointerleave", handlePointerLeave, true)
    window.addEventListener("touchmove", handleTouchMove, { passive: true, capture: true })
    window.addEventListener("touchend", handleTouchEnd, true)
    window.addEventListener("touchcancel", handleTouchEnd, true)

    if (!hasSensorApi) {
      motionSensorsEnabledRef.current = false
      setMotionGlintStatus("unsupported")
      setMotionGlintMessage("Motion sensors are not exposed here. Touch and pointer movement still move the shine.")
    } else if (needsExplicitPermission && !motionSensorsEnabledRef.current) {
      setMotionGlintStatus((status) => (status === "denied" ? status : "needs-permission"))
      setMotionGlintMessage((message) => message ?? "Tap Enable motion glint in settings, then tilt the phone.")
    } else {
      motionSensorsEnabledRef.current = true
      bindSensorListeners()
      setMotionGlintStatus((status) => (status === "active" ? status : "fallback"))
    }

    return () => {
      unbindSensorListeners()
      window.removeEventListener("pointermove", handlePointerMove, true)
      window.removeEventListener("pointerleave", handlePointerLeave, true)
      window.removeEventListener("touchmove", handleTouchMove, true)
      window.removeEventListener("touchend", handleTouchEnd, true)
      window.removeEventListener("touchcancel", handleTouchEnd, true)
      if (frameId) {
        window.cancelAnimationFrame(frameId)
      }
    }
  }, [motionSensorVersion, motionGlintEffectsEnabled])

  const glintX = clampGlareValue(50 + slotGlareState.offsetX * 1.15, 6, 94)
  const glintY = clampGlareValue(50 + slotGlareState.offsetY * 1.35, 6, 94)
  const slotGlareOverlayStyle = useMemo(() => ({
    "--glint-x": `${glintX}%`,
    "--glint-y": `${glintY}%`,
    "--glint-angle": `${slotGlareState.angle}deg`,
    "--glint-opacity": String(slotGlareState.opacity),
    transform: `translate3d(${slotGlareState.offsetX}px, ${slotGlareState.offsetY}px, 0) rotate(${slotGlareState.angle}deg) scale(1.14)`,
    opacity: slotGlareState.opacity,
  }) as CSSProperties, [glintX, glintY, slotGlareState])
  const cardFinishEffectStyle = useMemo(() => ({
    "--glint-x": `${glintX}%`,
    "--glint-y": `${glintY}%`,
    "--glint-angle": `${slotGlareState.angle}deg`,
    "--glint-opacity": String(slotGlareState.opacity),
    "--glint-shift-x": `${(glintX - 50) * 0.34}%`,
    "--glint-shift-y": `${(glintY - 50) * 0.2}%`,
    "--glint-streak-x": `${(glintX - 50) * 0.42}%`,
  }) as CSSProperties, [glintX, glintY, slotGlareState])
  const cardFinishGlint = useMemo(() => ({
    x: glintX / 100,
    y: glintY / 100,
    angle: slotGlareState.angle,
  }), [glintX, glintY, slotGlareState.angle])

  const generationFilteredPokemonList = useMemo(() => {
    let list = pokemonList

    if (selectedGen !== 0) {
      const gen = GENERATIONS[selectedGen]
      list = list.filter(p => p.id >= gen.start && p.id <= gen.end)
    }

    return list
  }, [pokemonList, selectedGen])

  const filteredPokemonList = useMemo(() => {
    if (collectionViewFilter === "all") {
      return generationFilteredPokemonList
    }

    return generationFilteredPokemonList.filter((pokemon) =>
      matchesCollectionViewFilter(legacyItemFilterFacts(collection.find((entry) => entry.pokemon_id === pokemon.id)), collectionViewFilter))
  }, [collection, collectionViewFilter, generationFilteredPokemonList])

  const filteredPokemonSummaryList = useMemo(
    () =>
      filteredPokemonList
        .map((pokemon) => getPokemonSummary(pokemon.id))
        .filter((pokemon): pokemon is PokemonSummary => Boolean(pokemon)),
    [filteredPokemonList],
  )

  const filteredPokemonIds = useMemo(
    () => new Set(filteredPokemonList.map((pokemon) => pokemon.id)),
    [filteredPokemonList],
  )

  const totalBinderPages = Math.max(1, Math.ceil((orderedDisplaySlots?.length ?? pokemonList.length) / slotsPerPage))
  const dashboardBinderDesign = useMemo(() => ({
    ...binderAppearance.design, rows: settings.binderRows, cols: settings.binderCols, pageCount: totalBinderPages,
  }), [binderAppearance.design, settings.binderRows, settings.binderCols, totalBinderPages])
  const firstNonEmptyPage = useMemo(() => {
    if (filteredPokemonList.length === 0) return 1

    const firstMatchIndex = pokemonList.findIndex(
      (pokemon) => pokemon.id === filteredPokemonList[0].id,
    )

    if (firstMatchIndex === -1) return 1
    return Math.ceil((firstMatchIndex + 1) / slotsPerPage)
  }, [filteredPokemonList, pokemonList, slotsPerPage])

  useEffect(() => {
    if (localBrowserHost || browserSurface || hasHydratedPageFromQueryRef.current || typeof window === "undefined") {
      return
    }

    const pageParam = new URLSearchParams(window.location.search).get(BINDER_PAGE_QUERY_PARAM)
    const parsedPage = Number.parseInt(pageParam || "", 10)
    hasHydratedPageFromQueryRef.current = true

    if (!Number.isInteger(parsedPage)) {
      return
    }

    const nextPage = Math.min(Math.max(parsedPage, 1), totalBinderPages)
    if (nextPage !== currentBinderPage) {
      setCurrentBinderPage(nextPage)
    }
  }, [localBrowserHost, browserSurface, currentBinderPage, totalBinderPages])

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }

    if (localBrowserHost || browserSurface) return
    const url = new URL(window.location.href)

    if (currentBinderPage <= 1) {
      url.searchParams.delete(BINDER_PAGE_QUERY_PARAM)
    } else {
      url.searchParams.set(BINDER_PAGE_QUERY_PARAM, String(currentBinderPage))
    }

    window.history.replaceState(window.history.state, "", url)
  }, [localBrowserHost, browserSurface, currentBinderPage])

  useEffect(() => {
    setPageInputValue(String(currentBinderPage))
    setPageNavigation(null)
  }, [currentBinderPage])

  const orderedDisplayPages = useMemo(() => orderedDisplaySlots ? paginateDisplaySlots(orderedDisplaySlots, settings.binderRows, settings.binderCols, slot => {
    if (selectedGen !== 0 && (!slot.pokemon || slot.pokemon.id < GENERATIONS[selectedGen].start || slot.pokemon.id > GENERATIONS[selectedGen].end)) return false
    return matchesCollectionViewFilter(displaySlotFilterFacts(slot, stagedSlotDisplay?.binder.slots.find(s => s.id === slot.id)?.status), collectionViewFilter)
  }) : undefined, [orderedDisplaySlots, settings.binderRows, settings.binderCols, selectedGen, collectionViewFilter, stagedSlotDisplay])
  useEffect(() => {
    if (browserSurface?.surface.state.main === "collection" && browserSurface.surface.collection?.state.page !== currentBinderPage)
      browserSurface.surface.collection?.onChange({ page: currentBinderPage })
  }, [browserSurface, currentBinderPage])
  const layoutScopeKey = JSON.stringify([stagedSlotSessionId, user?.id, stagedSlotDisplay?.inventory.ownerUserId, stagedSlotDisplay?.binder.collectionId, initialBinderId, activeMainView, collectionViewFilter, selectedGen, binderDimension, isSpreadLayout, settings.binderRows, settings.binderCols])
  const [layoutSession, setLayoutSession] = useState<{ scope: string; id: string; start?: LayoutSessionStart } | null>(null)
  // Drawn on the pockets themselves; the bar owns the selection and reports it here.
  const [layoutMarks, setLayoutMarks] = useState<{ ids: ReadonlySet<string>; moving: boolean }>({ ids: new Set(), moving: false })
  const layoutTap = useRef<LayoutTap | null>(null)
  const registerLayoutTap = useCallback((tap: LayoutTap | null) => { layoutTap.current = tap }, [])
  const [pocketMenu, setPocketMenu] = useState<{ slotId: string; point: { x: number; y: number } } | null>(null)
  const reportLayoutSelection = useCallback((ids: readonly string[], moving: boolean) => setLayoutMarks({ ids: new Set(ids), moving }), [])
  const canEditLayout = Boolean((!browserSurface || browserSurface.editingAvailable) && !legacyReadOnlyMode && !shareViewToken && user && stagedSlotDisplay && stagedSlotCatalog && onStagedSlotCommandIntent
    && activeMainView === "binder" && collectionViewFilter === "all" && selectedGen === 0)
  const editingLayout = canEditLayout && layoutSession?.scope === layoutScopeKey
  useEffect(() => {
    queueMicrotask(() => { setLayoutSession(null); setPocketMenu(null); closeSlotDetail() })
  }, [layoutScopeKey, canEditLayout, closeSlotDetail])
  const layoutBoundary = canEditLayout && stagedSlotDisplay && stagedSlotCatalog && onStagedSlotCommandIntent ? {
    snapshot: stagedSlotDisplay.inventory,
    scope: { ownerUserId: stagedSlotDisplay.inventory.ownerUserId, collectionId: stagedSlotDisplay.binder.collectionId, slotId: null },
    catalog: stagedSlotCatalog,
    onCommandIntent: onStagedSlotCommandIntent,
    localDurable: stagedSlotLocalDurable,
    bulkFill: browserSurface?.bulkFill,
    removal: browserSurface?.bulkFill,
    resolveCard: stagedSlotDisplay.resolveCard ?? ((id: string) => stagedSlotDisplay.catalog[id]),
  } : undefined
  const startLayoutEditing = (start?: LayoutSessionStart) => { closeSlotDetail(); setPocketMenu(null); setLayoutMarks({ ids: new Set(start?.ids), moving: Boolean(start?.moving) }); setLayoutSession({ scope: layoutScopeKey, id: crypto.randomUUID(), start }) }
  const layoutToolbar = layoutBoundary ? <LayoutToolbar key={`${layoutScopeKey}:${layoutSession?.id ?? "browse"}`} editing={editingLayout} boundary={layoutBoundary}
    host={{ rows: settings.binderRows, cols: settings.binderCols }} start={layoutSession?.start} onTap={registerLayoutTap} onSelection={reportLayoutSelection}
    onToggle={() => { if (editingLayout) { closeSlotDetail(); setLayoutSession(null) } else startLayoutEditing() }} /> : undefined
  const slotPickerBoundary = (slotId: string) => !legacyReadOnlyMode && !shareViewToken && user && stagedSlotDisplay && stagedSlotCatalog && onStagedSlotCommandIntent
    ? { snapshot: stagedSlotDisplay.inventory, scope: { ownerUserId: stagedSlotDisplay.inventory.ownerUserId, collectionId: stagedSlotDisplay.binder.collectionId, slotId }, catalog: stagedSlotCatalog, onCommandIntent: onStagedSlotCommandIntent, localDurable: stagedSlotLocalDurable } : undefined
  const slotPlace = (slotId: string) => {
    const index = orderedDisplaySlots?.findIndex(slot => slot.id === slotId) ?? -1
    return index < 0 ? undefined : pocketPlace(index, settings.binderRows, settings.binderCols)
  }
  const pocketMenuSlot = pocketMenu && orderedDisplaySlots ? resolveDisplaySelection(orderedDisplaySlots, pocketMenu.slotId) : null
  const getDisplayPageSlots = orderedDisplayPages ? (page: number) => orderedDisplayPages[page - 1] ?? Array.from({ length: slotsPerPage }, () => null) : undefined

  // A share's search/jump destination opens after the page or view change that would otherwise close it.
  const pendingPublicSlotRef = useRef<string | null>(null)
  useEffect(() => {
    queueMicrotask(() => {
      const pending = pendingPublicSlotRef.current
      pendingPublicSlotRef.current = null
      if (pending) setSelectedSlotId(pending)
      else closeSlotDetail()
    })
  }, [currentBinderPage, binderDimension, activeMainView, collectionViewFilter, selectedGen, closeSlotDetail])
  // The next start's skeleton shows this binder's grid. Only an owner's binder on screen counts.
  const binderGridShown = !shareViewToken && !publicIndex && (browserSurface ? browserSurface.surface.state.main === "collection" && Boolean(stagedSlotDisplay) : !stagedSlotDisplay)
  useEffect(() => { if (binderGridShown) rememberBinderGrid(settings.binderRows, settings.binderCols) }, [binderGridShown, settings.binderRows, settings.binderCols])
  // Arriving from a search result or Quick mode elsewhere in the app: open that pocket once its page is up.
  const arrivingSlot = browserSurface?.surface.collection?.highlight
  const arrivingSlotId = arrivingSlot?.open ? arrivingSlot.slotId : null
  useEffect(() => {
    if (!arrivingSlotId) return
    const timer = setTimeout(() => setSelectedSlotId(arrivingSlotId), 0)
    return () => clearTimeout(timer)
  }, [arrivingSlotId])
  // Where a Pokémon lives in the binder being viewed. Collections keep their own pocket order, not dex order.
  const nativeDisplay = browserSurface?.display, nativeCatalog = browserSurface?.nativeConsumer?.read.catalog, nativeLayouts = browserSurface?.nativeConsumer?.read.layouts
  const nativePocket = useMemo(() => {
    const layout = nativeDisplay && nativeLayouts?.find(l => l.collectionId === nativeDisplay.binder.collectionId && l.layoutRevision === nativeDisplay.binder.layoutRevision)
    if (!nativeDisplay || !nativeCatalog || !layout) return null
    const cardSpecies = new Map(nativeCatalog.map(c => [c.card.id, c.pokemonIds ?? []]))
    return (pokemonId: number) => {
      const pocket = speciesPocket(nativeDisplay, pokemonId, id => cardSpecies.get(id))
      return pocket && { ...pocket, page: Math.floor(pocket.index / (layout.rows * layout.cols)) + 1, place: pocketPlace(pocket.index, layout.rows, layout.cols) }
    }
  }, [nativeDisplay, nativeCatalog, nativeLayouts])
  const nativeBinderOpen = browserSurface?.surface.state.main === "collection" && browserSurface.surface.collection?.state.view === "binder" && activeMainView === "binder"

  const getPageSlots = useCallback((pageNumber: number) => {
    if (pageNumber < 1) {
      return Array.from({ length: slotsPerPage }, () => null as PokemonSummary | null)
    }

    const startIdx = (pageNumber - 1) * slotsPerPage
    return Array.from({ length: slotsPerPage }, (_, slotIndex) => {
      const pokemon = pokemonList[startIdx + slotIndex]
      if (!pokemon) return null
      return filteredPokemonIds.has(pokemon.id) ? pokemon : null
    })
  }, [filteredPokemonIds, pokemonList, slotsPerPage])

  const currentPageSlots = useMemo(
    () => getPageSlots(currentBinderPage),
    [currentBinderPage, getPageSlots],
  )

  const currentPagePokemon = useMemo(
    () => currentPageSlots.filter((pokemon): pokemon is PokemonSummary => Boolean(pokemon)),
    [currentPageSlots],
  )

  const adjustPageForFilters = useEffectEvent(() => {
    setCurrentBinderPage(current => {
      const page = Math.min(current, totalBinderPages)
      if (orderedDisplayPages) return orderedDisplayPages[page - 1]?.some(Boolean) ? page : Math.max(1, orderedDisplayPages.findIndex(p => p.some(Boolean)) + 1)
      return getPageSlots(page).some(Boolean) ? page : firstNonEmptyPage
    })
  })

  useEffect(() => {
    adjustPageForFilters()
  }, [selectedGen, collectionViewFilter, settings.binderRows, settings.binderCols, firstNonEmptyPage, totalBinderPages])

  const collectionStats = useMemo(() => {
    const gen = GENERATIONS[selectedGen]
    const genPokemon = pokemonList.filter(p => p.id >= gen.start && p.id <= gen.end)
    const collected = genPokemon.filter(p => isCollected(p.id)).length
    return { collected, total: genPokemon.length, percentage: Math.round((collected / genPokemon.length) * 100) || 0 }
  }, [pokemonList, selectedGen, isCollected])

  const ownedTrackedCards = useMemo(
    () =>
      collection.filter(
        (item) => Boolean(item.card_id) && item.status !== "wishlisted",
      ),
    [collection],
  )
  const ownedPriceLookups = useMemo<CardPriceLookup[]>(
    () =>
      ownedTrackedCards
        .map<CardPriceLookup | null>((item) => item.card_id ? { cardId: item.card_id, language: item.card_language ?? "en" } : null)
        .filter((item): item is CardPriceLookup => item !== null),
    [ownedTrackedCards],
  )
  const filteredTrackedCards = useMemo(
    () =>
      collection.filter(
        (item) => Boolean(item.card_id) && item.status !== "wishlisted" && filteredPokemonIds.has(item.pokemon_id),
      ),
    [collection, filteredPokemonIds],
  )
  const trackedPriceLookups = useMemo<CardPriceLookup[]>(
    () =>
      filteredTrackedCards
        .map<CardPriceLookup | null>((item) => item.card_id ? { cardId: item.card_id, language: item.card_language ?? "en" } : null)
        .filter((item): item is CardPriceLookup => item !== null),
    [filteredTrackedCards],
  )
  // Ordered pockets (native binders and shares) price each owned copy by its exact printing.
  const displayPriceLookups = useMemo(() => (orderedDisplaySlots ?? []).flatMap(slot => displaySlotPriceLookup(slot) ?? []), [orderedDisplaySlots])
  const selectedDisplayPriceLookup = useMemo(() => selectedDisplaySlot ? displaySlotPriceLookup(selectedDisplaySlot) : null, [selectedDisplaySlot])
  const wantedCardEntries = useMemo(
    () => publicIndex ? publicIndex.wantEntries : collection.flatMap((item) =>
      (item.wanted_cards ?? []).map((card) => ({
        pokemonId: item.pokemon_id,
        pokemonName: item.pokemon_name,
        card,
      })),
    ),
    [collection, publicIndex],
  )
  const wantedPriceLookups = useMemo<CardPriceLookup[]>(
    () => wantedCardEntries.map(({ card }) => ({ cardId: card.card_id, language: card.card_language ?? "en" })),
    [wantedCardEntries],
  )
  const selectedTrackedCardItem = selectedPokemon ? getCollectionItem(selectedPokemon.id) ?? null : null
  const selectedTrackedPriceLookup = useMemo<CardPriceLookup | null>(
    () => selectedTrackedCardItem?.card_id
      ? { cardId: selectedTrackedCardItem.card_id, language: selectedTrackedCardItem.card_language ?? "en" }
      : null,
    [selectedTrackedCardItem],
  )
  const selectedWantedPriceLookups = useMemo<CardPriceLookup[]>(
    () => (selectedTrackedCardItem?.wanted_cards ?? []).map((card) => ({
      cardId: card.card_id,
      language: card.card_language ?? "en",
    })),
    [selectedTrackedCardItem],
  )
  const shouldLoadCollectionPriceLookups = isPriceMode || collectionViewFilter === "wanted" || activeMainView === "list" || activeMainView === "wanted" || activeMainView === "sets" || activeMainView === "analytics"
  const priceLookupCards = useMemo(
    () => {
      const byKey = new Map<string, CardPriceLookup>()

      for (const lookup of ownedPriceLookups) {
        byKey.set(getCardPriceKey(lookup.cardId, lookup.language), lookup)
      }

      for (const lookup of wantedPriceLookups) {
        byKey.set(getCardPriceKey(lookup.cardId, lookup.language), lookup)
      }

      if (shouldLoadCollectionPriceLookups) {
        for (const lookup of [...trackedPriceLookups, ...(isPriceMode ? displayPriceLookups : [])]) {
          byKey.set(getCardPriceKey(lookup.cardId, lookup.language), lookup)
        }
      }

      if (selectedDisplayPriceLookup) {
        byKey.set(getCardPriceKey(selectedDisplayPriceLookup.cardId, selectedDisplayPriceLookup.language), selectedDisplayPriceLookup)
      }

      if (selectedTrackedPriceLookup) {
        byKey.set(getCardPriceKey(selectedTrackedPriceLookup.cardId, selectedTrackedPriceLookup.language), selectedTrackedPriceLookup)
      }

      for (const lookup of selectedWantedPriceLookups) {
        byKey.set(getCardPriceKey(lookup.cardId, lookup.language), lookup)
      }

      return [...byKey.values()]
    },
    [displayPriceLookups, isPriceMode, ownedPriceLookups, selectedDisplayPriceLookup, selectedTrackedPriceLookup, selectedWantedPriceLookups, shouldLoadCollectionPriceLookups, trackedPriceLookups, wantedPriceLookups],
  )
  const hasTrackedCards = trackedPriceLookups.length > 0 || wantedPriceLookups.length > 0 || displayPriceLookups.length > 0
  const shouldLoadCardPrices = ownedPriceLookups.length > 0 || wantedPriceLookups.length > 0 || shouldLoadCollectionPriceLookups || Boolean(selectedTrackedPriceLookup) || Boolean(selectedDisplayPriceLookup) || selectedWantedPriceLookups.length > 0
  const { pricesByCardId: rawPricesByCardId, isLoading: isLoadingPrices, fxRates } = useCardPrices(priceLookupCards, pricingEnabled && shouldLoadCardPrices)
  const pricingPreferences = usePricingPreferences(settings)
  // Region-grounded prices: re-weight each card's source evidence for the user's market.
  const pricesByCardId = useMemo(
    () => pricingEnabled ? regionalizeCardPrices(rawPricesByCardId, pricingPreferences.region) : {},
    [pricingEnabled, pricingPreferences.region, rawPricesByCardId],
  )
  const priceFormat = useMemo(() => {
    const context: PriceDisplayContext = { currency: pricingPreferences.currency, fxRates }
    return {
      label: (price: CardPriceSnapshot | undefined) => pricingEnabled ? formatRegionalPriceLabel(price, context) : null,
      amount: (amount: number | null | undefined, price?: CardPriceSnapshot) => pricingEnabled ? formatDisplayAmount(amount, context, price) : null,
      range: (low: number | null | undefined, high: number | null | undefined, price?: CardPriceSnapshot) => pricingEnabled ? formatDisplayRange(low, high, context, price) : null,
      totals: (gbpTotal: number, originalTotals: Partial<Record<SupportedCurrency, number>>, estimatedFinishCount = 0) => {
        if (!pricingEnabled) return ""
        const label = formatDisplayTotals(gbpTotal, originalTotals, context)
        return label && estimatedFinishCount > 0 ? `${label} · ${estimatedFinishCount} finish estimate${estimatedFinishCount === 1 ? "" : "s"}` : label
      },
    }
  }, [fxRates, pricingEnabled, pricingPreferences.currency])
  const filteredPriceSummary = useMemo(
    () => summarizeOwnedCardPrices(filteredTrackedCards, pricesByCardId),
    [filteredTrackedCards, pricesByCardId],
  )
  const filteredTotalLabel = useMemo(
    () => priceFormat.totals(filteredPriceSummary.gbpTotal, filteredPriceSummary.originalTotals, filteredPriceSummary.estimatedFinishCount),
    [priceFormat, filteredPriceSummary],
  )
  const ownedPriceSummary = useMemo(
    () => summarizeOwnedCardPrices(ownedTrackedCards, pricesByCardId),
    [ownedTrackedCards, pricesByCardId],
  )
  const ownedTotalLabel = useMemo(
    () => priceFormat.totals(ownedPriceSummary.gbpTotal, ownedPriceSummary.originalTotals, ownedPriceSummary.estimatedFinishCount),
    [priceFormat, ownedPriceSummary],
  )
  const wantedPriceSummary = useMemo(
    () => sumPriceSnapshots(wantedCardEntries.map(({ card }) => {
      const priceKey = getCardPriceKey(card.card_id, card.card_language ?? "en")
      return pricesByCardId[priceKey]
    })),
    [pricesByCardId, wantedCardEntries],
  )
  const wantedTotalLabel = useMemo(
    () => priceFormat.totals(wantedPriceSummary.gbpTotal, wantedPriceSummary.originalTotals),
    [priceFormat, wantedPriceSummary.gbpTotal, wantedPriceSummary.originalTotals],
  )
  const wantedModeCombinedPriceSummary = useMemo(
    () => combinePriceSummaries([ownedPriceSummary, wantedPriceSummary]),
    [ownedPriceSummary, wantedPriceSummary],
  )
  const wantedModeCombinedTotalLabel = useMemo(
    () => priceFormat.totals(wantedModeCombinedPriceSummary.gbpTotal, wantedModeCombinedPriceSummary.originalTotals, ownedPriceSummary.estimatedFinishCount),
    [priceFormat, wantedModeCombinedPriceSummary.gbpTotal, wantedModeCombinedPriceSummary.originalTotals, ownedPriceSummary.estimatedFinishCount],
  )
  const wantedDashboard = useMemo(
    () => buildWantedDashboardSummary(wantedCardEntries, pricesByCardId),
    [pricesByCardId, wantedCardEntries],
  )
  useEffect(() => {
    if (!hasTrackedCards && isPriceMode) {
      setIsPriceMode(false)
    }
  }, [hasTrackedCards, isPriceMode])

  const neededPokemonList = useMemo(
    () => generationFilteredPokemonList.filter((pokemon) => !isCollected(pokemon.id)),
    [generationFilteredPokemonList, isCollected],
  )

  const favoritePokemonList = useMemo(
    () => generationFilteredPokemonList.filter((pokemon) => getCollectionItem(pokemon.id)?.status === "finalized"),
    [generationFilteredPokemonList, getCollectionItem],
  )

  const upgradeablePokemonList = useMemo(
    () =>
      generationFilteredPokemonList.filter((pokemon) => {
        const item = getCollectionItem(pokemon.id)
        return Boolean(item && item.status !== "wishlisted" && item.status !== "finalized")
      }),
    [generationFilteredPokemonList, getCollectionItem],
  )

  const wantedPokemonList = useMemo(
    () => generationFilteredPokemonList.filter((pokemon) => Boolean(getCollectionItem(pokemon.id)?.wanted_cards?.length)),
    [generationFilteredPokemonList, getCollectionItem],
  )

  const activeJumpPokemonList = useMemo(() => {
    if (collectionViewFilter === "favorite") return favoritePokemonList
    if (collectionViewFilter === "upgradeable") return upgradeablePokemonList
    if (collectionViewFilter === "wanted") return wantedPokemonList
    return neededPokemonList
  }, [collectionViewFilter, favoritePokemonList, neededPokemonList, upgradeablePokemonList, wantedPokemonList])

  const activeJumpLabel = useMemo(() => {
    if (collectionViewFilter === "favorite") return "Perfect"
    if (collectionViewFilter === "upgradeable") return "Upgrade"
    if (collectionViewFilter === "wanted") return "Wanted"
    return "Needed"
  }, [collectionViewFilter])

  const activeCollectionFilterOption = useMemo(
    () => COLLECTION_VIEW_FILTERS.find((filterOption) => filterOption.id === collectionViewFilter) ?? COLLECTION_VIEW_FILTERS[0],
    [collectionViewFilter],
  )

  const isFilteredBinderLayout = collectionViewFilter !== "all"
  const displayedSpreadPages = useMemo<DisplaySpreadPage[]>(() => {
    if (!isSpreadLayout) {
      return [{ kind: "binder", pageNumber: currentBinderPage, side: "right" }]
    }

    if (currentBinderPage <= 1) {
      return [
        { kind: "info", side: "left" },
        { kind: "binder", pageNumber: 1, side: "right" },
      ]
    }

    if (currentBinderPage % 2 === 0) {
      return [
        { kind: "binder", pageNumber: currentBinderPage, side: "left" },
        currentBinderPage + 1 <= totalBinderPages
          ? { kind: "binder", pageNumber: currentBinderPage + 1, side: "right" }
          : { kind: "blank", side: "right" },
      ]
    }

    return [
      { kind: "binder", pageNumber: currentBinderPage - 1, side: "left" },
      { kind: "binder", pageNumber: currentBinderPage, side: "right" },
    ]
  }, [currentBinderPage, isSpreadLayout, totalBinderPages])
  const visibleBinderPageNumbers = useMemo(
    () => displayedSpreadPages.flatMap((page) => (page.kind === "binder" ? [page.pageNumber] : [])),
    [displayedSpreadPages],
  )
  const visiblePagePokemonIds = useMemo(() => {
    const ids = new Set<number>()

    visibleBinderPageNumbers.forEach((pageNumber) => {
      getPageSlots(pageNumber).forEach((pokemon) => {
        if (pokemon) {
          ids.add(pokemon.id)
        }
      })
    })

    return ids
  }, [getPageSlots, visibleBinderPageNumbers])
  useEffect(() => {
    if (!shouldClearSelectedPokemonForPage(selectedPokemon?.id, visiblePagePokemonIds)) {
      return
    }

    const frameId = window.requestAnimationFrame(() => {
      setSelectedPokemon(null)
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [selectedPokemon?.id, visiblePagePokemonIds])

  const binderFitSize = useMemo(() => {
    // Leave room for the active page's 2px outline inside the clipped stage.
    const outlineClearance = 4
    if (!isDesktopViewport && (settings.binderRows > 4 || settings.binderCols > 4)) {
      return { width: Math.max(1, binderStageSize.width - outlineClearance), height: Math.max(1, binderStageSize.height - outlineClearance) }
    }
    const padding = isDesktopViewport ? 16 : 8
    const gap = 6
    const pages = isSpreadLayout ? 2 : 1
    const spreadGap = isSpreadLayout ? (isWideBinderSpread ? 16 : 12) : 0
    const horizontalChrome = padding * 2 + gap * (settings.binderCols - 1)
    const verticalChrome = padding * 2 + gap * (settings.binderRows - 1)
    const slotHeight = Math.min(
      (binderStageSize.height - outlineClearance - verticalChrome) / settings.binderRows,
      ((binderStageSize.width - outlineClearance - spreadGap) / pages - horizontalChrome) / settings.binderCols / TRADING_CARD_ASPECT_RATIO,
    )
    if (slotHeight <= 0) return null

    return {
      width: pages * (slotHeight * TRADING_CARD_ASPECT_RATIO * settings.binderCols + horizontalChrome) + spreadGap,
      height: slotHeight * settings.binderRows + verticalChrome,
    }
  }, [binderStageSize, isDesktopViewport, isSpreadLayout, isWideBinderSpread, settings.binderCols, settings.binderRows])

  const binderSlotImageSizes = binderFitSize
    ? `${Math.max(settings.binderRows > 4 || settings.binderCols > 4 ? 64 : 0, Math.ceil((binderFitSize.height - (isDesktopViewport ? 32 : 16) - 6 * (settings.binderRows - 1)) / settings.binderRows * TRADING_CARD_ASPECT_RATIO))}px`
    : `${100 / (settings.binderCols * (isSpreadLayout ? 2 : 1))}vw`

  // Resolve the same printing for the grid and adjacent-page image prefetch.
  const getSlotCardImage = useCallback((pokemonId: number) => {
    const item = collectionByPokemonId.get(pokemonId)
    const displayCard = getBinderDisplayCard(item, binderCardDisplay)
    return displayCard?.card_image
  }, [binderCardDisplay, collectionByPokemonId])

  const [slotImages] = useState(() => new BinderSlotImages())
  // Native pages render OrderedSlot images; the legacy list is empty there and would only fetch unseen artwork.
  const slotImageUrlsForPages = useCallback((pages: number[]) => pages.flatMap((page) => orderedDisplayPages
    ? (orderedDisplayPages[page - 1] ?? []).flatMap(slot => { const url = slot && displaySlotImageUrl(slot, binderCardDisplay); return url ? [url] : [] })
    : getPageSlots(page).flatMap((pokemon) => pokemon ? [resolveSlotImageUrl(pokemon.id, getSlotCardImage(pokemon.id))] : []),
  ), [binderCardDisplay, getPageSlots, getSlotCardImage, orderedDisplayPages])
  const requestedBinderPage = useRef(currentBinderPage)
  useLayoutEffect(() => {
    requestedBinderPage.current = currentBinderPage
  }, [currentBinderPage])
  useEffect(() => () => {
    slotImages.retain(new Set())
  }, [slotImages])

  const pendingFirstPage = pendingBinderPage && isSpreadLayout && pendingBinderPage > 1 ? pendingBinderPage - pendingBinderPage % 2 : pendingBinderPage
  const pendingPages = pendingFirstPage === null ? [] : isSpreadLayout && pendingFirstPage > 1
    ? [pendingFirstPage, pendingFirstPage + 1].filter(page => page <= totalBinderPages)
    : [pendingFirstPage]
  const pendingSlotUrls = JSON.stringify(slotImageUrlsForPages(pendingPages))
  const adjacentSlotUrls = JSON.stringify(slotImageUrlsForPages(getAdjacentPageNumbers(visibleBinderPageNumbers, totalBinderPages, isSpreadLayout ? 2 : 1)))
  const visibleSlotUrls = JSON.stringify(slotImageUrlsForPages(visibleBinderPageNumbers))
  useEffect(() => {
    slotImages.retain(new Set([...JSON.parse(adjacentSlotUrls), ...JSON.parse(visibleSlotUrls), ...JSON.parse(pendingSlotUrls)]))
  }, [slotImages, adjacentSlotUrls, visibleSlotUrls, pendingSlotUrls])
  useEffect(() => {
    const timer = window.setTimeout(() => {
      // Let the browser schedule the whole next page; one slow decode must not gate later slots.
      for (const url of new Set<string>(JSON.parse(adjacentSlotUrls))) {
        void slotImages.load(url, "low", binderSlotImageSizes)
      }
    }, ADJACENT_PREFETCH_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [slotImages, adjacentSlotUrls, binderSlotImageSizes])
  const offlineCacheWarmupUrls = useMemo(
    () => buildOfflineCacheWarmupUrls({
      collection,
      selectedPokemonId: selectedPokemon?.id ?? null,
      visiblePokemonIds: [...visiblePagePokemonIds],
    }),
    [collection, selectedPokemon, visiblePagePokemonIds],
  )
  const offlineCacheWarmupSignature = useMemo(
    () => getOfflineCacheWarmupSignature(offlineCacheWarmupUrls),
    [offlineCacheWarmupUrls],
  )
  const visiblePageItemIds = useMemo(
    () => visibleBinderPageNumbers.flatMap(page => orderedDisplayPages?.[page - 1] ?? []).flatMap(slot => slot?.item ? [slot.item.id] : []),
    [orderedDisplayPages, visibleBinderPageNumbers],
  )
  const visiblePageTrackedCards = useMemo(
    () => collection.flatMap((item) => {
      if (!visiblePagePokemonIds.has(item.pokemon_id)) return []
      const card = getBinderDisplayCard(item, binderCardDisplay)
      return card ? [card] : []
    }),
    [binderCardDisplay, collection, visiblePagePokemonIds],
  )
  const visiblePagePriceSummary = useMemo(
    () => sumPriceSnapshots(visiblePageTrackedCards.map((item) => {
      const priceKey = getCollectionItemPriceKey(item)
      return priceKey ? pricesByCardId[priceKey] : undefined
    })),
    [pricesByCardId, visiblePageTrackedCards],
  )
  const visiblePageTotalLabel = useMemo(
    () => priceFormat.totals(visiblePagePriceSummary.gbpTotal, visiblePagePriceSummary.originalTotals),
    [priceFormat, visiblePagePriceSummary.gbpTotal, visiblePagePriceSummary.originalTotals],
  )
  const visiblePageLabel = useMemo(() => {
    if (displayedSpreadPages.length === 1 && displayedSpreadPages[0]?.kind === "binder") {
      return `Page ${displayedSpreadPages[0].pageNumber}`
    }

    const binderPages = displayedSpreadPages.flatMap((page) => (page.kind === "binder" ? [page.pageNumber] : []))
    if (displayedSpreadPages.some((page) => page.kind === "info") && binderPages[0] === 1) {
      return "Info + Page 1"
    }

    if (binderPages.length === 2) {
      return `Pages ${binderPages[0]}-${binderPages[1]}`
    }

    if (binderPages.length === 1) {
      return `Page ${binderPages[0]}`
    }

    return "Binder Spread"
  }, [displayedSpreadPages])
  const cancelPageNavigation = useCallback(() => {
    requestedBinderPage.current = currentBinderPage
    setPageNavigation(null)
    setPageInputValue(String(currentBinderPage))
  }, [currentBinderPage])

  useEffect(() => {
    if (!pageNavigation) return
    let cancelled = false
    const { page, direction } = pageNavigation
    const urls: string[] = JSON.parse(pendingSlotUrls)
    void Promise.all(urls.map(url => slotImages.load(url, "high", binderSlotImageSizes))).then(() => {
      if (cancelled || requestedBinderPage.current !== page) return
      setPageNavigation(null)
      if (page > totalBinderPages) return
      transitionContent(binderPageRef.current, () => setCurrentBinderPage(page), direction)
    })
    return () => { cancelled = true }
  }, [pageNavigation, pendingSlotUrls, binderSlotImageSizes, slotImages, totalBinderPages, transitionContent])

  const navigateToPage = useCallback((page: number, direction: "left" | "right") => {
    if (page < 1 || page > totalBinderPages || page === requestedBinderPage.current) return
    if (page === currentBinderPage) {
      cancelPageNavigation()
      return
    }
    requestedBinderPage.current = page
    setPageInputValue(String(page))
    setPageNavigation({ page, direction })
  }, [cancelPageNavigation, currentBinderPage, totalBinderPages])

  const goToNextPage = useCallback(() => {
    if (requestedBinderPage.current < totalBinderPages) {
      navigateToPage(requestedBinderPage.current + 1, "left")
    }
  }, [totalBinderPages, navigateToPage])

  const goToPrevPage = useCallback(() => {
    if (requestedBinderPage.current > 1) {
      navigateToPage(requestedBinderPage.current - 1, "right")
    }
  }, [navigateToPage])

  const goToNextSpread = useCallback(() => {
    if (!isSpreadLayout) {
      goToNextPage()
      return
    }

    const page = requestedBinderPage.current
    const leftPage = page <= 1 ? 0 : page % 2 === 0 ? page : page - 1
    const nextPage = leftPage === 0 ? 2 : leftPage + 2

    if (nextPage <= totalBinderPages) {
      navigateToPage(nextPage, "left")
    }
  }, [goToNextPage, isSpreadLayout, navigateToPage, totalBinderPages])

  const goToPrevSpread = useCallback(() => {
    if (!isSpreadLayout) {
      goToPrevPage()
      return
    }

    const page = requestedBinderPage.current
    if (page <= 1) return

    const leftPage = page % 2 === 0 ? page : page - 1
    const previousPage = leftPage <= 2 ? 1 : leftPage - 2
    navigateToPage(previousPage, "right")
  }, [goToPrevPage, isSpreadLayout, navigateToPage])

  const lastVisibleBinderPageNumber = visibleBinderPageNumbers[visibleBinderPageNumbers.length - 1] ?? 0
  const canGoToPreviousVisiblePage = (pendingBinderPage ?? currentBinderPage) > 1
  const canGoToNextVisiblePage = (pendingPages.at(-1) ?? lastVisibleBinderPageNumber) < totalBinderPages

  const commitPageInput = useCallback((value = pageInputValue) => {
    const trimmedValue = value.trim()

    if (!trimmedValue) {
      setPageInputValue(String(currentBinderPage))
      return
    }

    const parsedPage = Number.parseInt(trimmedValue, 10)
    if (!Number.isInteger(parsedPage) || parsedPage < 1 || parsedPage > totalBinderPages) {
      setPageInputValue(String(currentBinderPage))
      return
    }

    if (parsedPage === currentBinderPage) {
      setPageInputValue(String(currentBinderPage))
    }

    navigateToPage(parsedPage, parsedPage > currentBinderPage ? "left" : "right")
  }, [currentBinderPage, navigateToPage, pageInputValue, totalBinderPages])

  const handleSetGlobalBinderColor = useCallback((binderColorId: BinderColorId) => {
    if (readOnlyMode) return
    updateSettings({
      binderColorId,
      binderPageColors: {},
    })
  }, [readOnlyMode, updateSettings])

  const handleSetCurrentPageBinderColor = useCallback((binderColorId: BinderColorId) => {
    if (readOnlyMode) return
    updateSettings({
      binderPageColors: {
        ...settings.binderPageColors,
        [String(currentBinderPage)]: binderColorId,
      },
    }, { ...binderAppearance.design.pageColors, [String(currentBinderPage)]: getBinderColorPreset(binderColorId).swatch[0] })
  }, [currentBinderPage, readOnlyMode, settings.binderPageColors, updateSettings, binderAppearance.design.pageColors])

  const handleSetBinderColorForPageRange = useCallback((binderColorId: BinderColorId, endPage: number) => {
    if (readOnlyMode) return

    const safeEndPage = Math.min(Math.max(endPage, 1), totalBinderPages)
    const nextPageColors = { ...settings.binderPageColors }

    for (let page = 1; page <= safeEndPage; page += 1) {
      nextPageColors[String(page)] = binderColorId
    }

    const appearancePageColors = { ...binderAppearance.design.pageColors }
    for (let page = 1; page <= safeEndPage; page += 1) appearancePageColors[String(page)] = getBinderColorPreset(binderColorId).swatch[0]
    updateSettings({ binderPageColors: nextPageColors }, appearancePageColors)
  }, [readOnlyMode, settings.binderPageColors, totalBinderPages, updateSettings, binderAppearance.design.pageColors])

  const handleClearCurrentPageBinderColor = useCallback(() => {
    if (readOnlyMode) return
    const nextPageColors = { ...settings.binderPageColors }
    delete nextPageColors[String(currentBinderPage)]
    const appearancePageColors = { ...binderAppearance.design.pageColors }
    delete appearancePageColors[String(currentBinderPage)]
    updateSettings({ binderPageColors: nextPageColors }, appearancePageColors)
  }, [currentBinderPage, readOnlyMode, settings.binderPageColors, updateSettings, binderAppearance.design.pageColors])

  const { ref: binderRef, isSwiping, didSwipe } = useTouchGestures<HTMLDivElement>({
    onSwipeLeft: isSpreadLayout ? goToNextSpread : goToNextPage,
    onSwipeRight: isSpreadLayout ? goToPrevSpread : goToPrevPage,
    swipeThreshold: 45,
  })
  const setBinderStageRef = useCallback((node: HTMLDivElement | null) => {
    binderStageRef.current = node
    binderRef(settings.binderRows > 4 || settings.binderCols > 4 ? null : node)
  }, [binderRef, settings.binderRows, settings.binderCols])

  const handleOpenCardSelector = requireAccount

  // Guests browse read-only: every collection edit asks them to join instead.
  const handleOpenWishlistSelector = requireAccount
  const handleOpenSelectedSlotScanner = requireAccount
  const openCardSelectorForPokemon = requireAccount
  const handleQuickCollectSelectedPokemon = requireAccount
  const handleChangeWantedCard = requireAccount
  const requestOwnedRemoval = requireAccount
  const handleQuickCollect = requireAccount
  const handleClearWantedCard = requireAccount
  const handleCollectSetCard = requireAccount
  const handleWantSetCard = requireAccount
  const handleGotWantedCard = requireAccount
  const handleCollectSetCards = requireAccount
  const handleWantSetCards = requireAccount
  const handleSelectedCardFinishChange = requireAccount
  const handleToggleFavorite = requireAccount
  const handleToggleFavoriteSelectedPokemon = requireAccount


  // A share opens the exact pocket: species results go to its first needed/wanted pocket, wants to their own pocket.
  const openPublicLocation = useCallback((location: { page: number; slotId: string } | null) => {
    cancelPageNavigation()
    setIsSearchOpen(false)
    setActiveMainView("binder")
    if (!location) return
    if (location.page !== currentBinderPage || activeMainView !== "binder") pendingPublicSlotRef.current = location.slotId
    setCurrentBinderPage(location.page)
    setSelectedSlotId(location.slotId)
  }, [cancelPageNavigation, currentBinderPage, activeMainView])
  const handlePokemonSelect = useCallback((pokemon: PokemonSummary) => {
    if (publicIndex) return openPublicLocation(publicIndex.speciesLocation(pokemon.id))
    if (browserSurface) {
      const pocket = nativePocket?.(pokemon.id)
      setIsSearchOpen(false)
      if (!pocket) {
        // No pocket for it in this binder: its cards are the useful place to land.
        cancelPageNavigation(); closeAllOverlays()
        return setCardBrowser({ pokemon: { id: pokemon.id, name: pokemon.name }, highlightCardId: null, nested: false })
      }
      const page = (nativeBinderOpen ? orderedDisplayPages?.findIndex(slots => slots.some(slot => slot?.id === pocket.slotId)) : undefined) ?? -1
      // From another view, or when a filter hides the pocket, the host opens the binder on that page.
      return page < 0 ? browserSurface.surface.onSlot(pocket.slotId, pocket.page) : openPublicLocation({ page: page + 1, slotId: pocket.slotId })
    }
    cancelPageNavigation()
    viewRequestRef.current += 1
    transitionContent(null, () => {})
    setWantedDetail(null)
    setSelectedPokemon(pokemon)
    setActiveMainView("binder")
    setIsSearchOpen(false)
    const idx = pokemonList.findIndex(p => p.id === pokemon.id)
    if (idx !== -1) {
      const targetPage = Math.ceil((idx + 1) / slotsPerPage)
      setCurrentBinderPage(targetPage)
    }
  }, [pokemonList, slotsPerPage, transitionContent, cancelPageNavigation, publicIndex, openPublicLocation, browserSurface, nativePocket, nativeBinderOpen, orderedDisplayPages, setCardBrowser])

  const handleWantedSelect = (pokemon: PokemonSummary, card: WantedCard) => {
    if (publicIndex) return openPublicLocation(publicIndex.wantLocation(card))
    handlePokemonSelect(pokemon)
    setWantedDetail({ pokemonId: pokemon.id, card })
  }

  const handleSearchJumpToPage = useCallback((page: number) => {
    if (page < 1 || page > totalBinderPages) return

    setSelectedPokemon(null)
    setIsSearchOpen(false)
    navigateToPage(page, page > currentBinderPage ? "left" : "right")
  }, [currentBinderPage, navigateToPage, totalBinderPages])

  const handleSelectSetSlot = useCallback((slot: TCGSetDexSlot) => {
    const pokemon = getPokemonSummary(slot.dexId)
    if (!pokemon) return
    handlePokemonSelect(pokemon)
  }, [handlePokemonSelect])

  const getSearchResultMeta = useCallback((pokemon: { id: number; name: string }): PokemonSearchResultMeta => {
    if (publicIndex) return publicIndex.searchMeta(pokemon.id)
    const summary = getPokemonSummary(pokemon.id)
    if (browserSurface) {
      const pocket = nativePocket?.(pokemon.id)
      const owned = pocket?.item?.identity.kind === "card" ? nativeDisplay?.resolveCard?.(pocket.item.identity.cardId, pocket.item.identity.language) : undefined
      return {
        ...buildPokemonSearchPreview({ pokemonArtwork: summary ? getPokemonArtwork(summary) : getPokemonOfficialArtworkUrl(pokemon.id), cardImage: pocket?.want?.card_image ?? owned?.image, status: pocket?.want ? "wishlisted" : undefined }),
        stateLabel: pocket?.item ? "Owned" : pocket?.want ? "Wanted" : null,
        stateToneClass: pocket?.item ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-500",
        cardLabel: pocket?.want ? `Wanted: ${pocket.want.card_name}` : owned?.name ?? null,
        locationLabel: pocket?.place ?? null,
        // The page shortcut only means something while the binder itself is on screen.
        pageNumber: nativeBinderOpen ? pocket?.page ?? null : null,
        isSelected: Boolean(pocket && pocket.slotId === selectedSlotId),
        slotState: pocket?.item ? "owned" : pocket?.want ? "wanted" : "open",
      }
    }
    const item = getCollectionItem(pokemon.id)
    const preview = buildPokemonSearchPreview({
      pokemonArtwork: summary ? getPokemonArtwork(summary) : getPokemonOfficialArtworkUrl(pokemon.id),
      cardImage: item?.card_image,
      status: item?.status,
    })
    const slotIndex = pokemonList.findIndex((entry) => entry.id === pokemon.id)
    const page = slotIndex >= 0 ? Math.ceil((slotIndex + 1) / slotsPerPage) : null
    const slotPosition = slotIndex >= 0 ? slotIndex % slotsPerPage : -1
    const row = slotPosition >= 0 ? Math.floor(slotPosition / settings.binderCols) : -1
    const col = slotPosition >= 0 ? slotPosition % settings.binderCols : -1
    const slotLabel =
      row >= 0 && col >= 0 ? `${String.fromCharCode(65 + row)}${col + 1}` : null

    let stateLabel: string | null = null
    let stateToneClass = ""
    let slotState: PokemonSearchResultMeta["slotState"] = "open"
    if (item?.status === "wishlisted") {
      stateLabel = "Wanted"
      stateToneClass = "bg-amber-500/15 text-amber-500"
      slotState = "wanted"
    } else if (item?.status === "finalized") {
      stateLabel = "Perfect"
      stateToneClass = "bg-amber-500/15 text-amber-500"
      slotState = "perfect"
    } else if (item?.status === "considering") {
      stateLabel = "Upgrade"
      stateToneClass = "bg-blue-500/15 text-blue-400"
      slotState = "upgrade"
    } else if (item) {
      stateLabel = "Owned"
      stateToneClass = "bg-emerald-500/15 text-emerald-400"
      slotState = "owned"
    }

    return {
      previewImage: preview.previewImage,
      previewFitClass: preview.previewFitClass,
      previewToneClass: preview.previewToneClass,
      cardPreviewImage: preview.cardPreviewImage,
      cardPreviewToneClass: preview.cardPreviewToneClass,
      stateLabel,
      stateToneClass,
      cardLabel: item?.card_name
        ? item.status === "wishlisted"
          ? `Wanted: ${item.card_name}`
          : item.card_name
        : null,
      locationLabel: page && slotLabel ? `Page ${page} • ${slotLabel}` : null,
      pageNumber: page,
      isFavorite: item?.status === "finalized",
      isSelected: selectedPokemon?.id === pokemon.id,
      slotState,
    }
  }, [getCollectionItem, pokemonList, selectedPokemon?.id, settings.binderCols, slotsPerPage, publicIndex, browserSurface, nativePocket, nativeDisplay, nativeBinderOpen, selectedSlotId])

  const handleJumpBetweenTargets = useCallback((direction: "next" | "prev") => {
    if (publicIndex && orderedDisplaySlots) {
      const selected = orderedDisplaySlots.findIndex(slot => slot.id === selectedSlotId)
      const from = selected >= 0 ? selected : (currentBinderPage - 1) * slotsPerPage - (direction === "next" ? 1 : 0)
      const filter = collectionViewFilter === "favorite" || collectionViewFilter === "upgradeable" || collectionViewFilter === "wanted" ? collectionViewFilter : "needed"
      return openPublicLocation(publicIndex.jump(filter, from, direction))
    }
    if (activeJumpPokemonList.length === 0 || generationFilteredPokemonList.length === 0) return

    const anchorId = selectedPokemon?.id ?? currentPagePokemon[0]?.id
    const anchorIndex = anchorId
      ? generationFilteredPokemonList.findIndex((pokemon) => pokemon.id === anchorId)
      : -1

    let nextPokemon = activeJumpPokemonList[direction === "next" ? 0 : activeJumpPokemonList.length - 1]

    if (anchorIndex >= 0) {
      for (let offset = 1; offset <= generationFilteredPokemonList.length; offset += 1) {
        const step = direction === "next" ? offset : -offset
        const candidateIndex =
          (anchorIndex + step + generationFilteredPokemonList.length) % generationFilteredPokemonList.length
        const candidate = generationFilteredPokemonList[candidateIndex]
        if (activeJumpPokemonList.some((pokemon) => pokemon.id === candidate.id)) {
          nextPokemon = candidate
          break
        }
      }
    }

    const summary = getPokemonSummary(nextPokemon.id)
    if (summary) {
      handlePokemonSelect(summary)
    }
  }, [activeJumpPokemonList, currentPagePokemon, generationFilteredPokemonList, handlePokemonSelect, selectedPokemon, publicIndex, orderedDisplaySlots, selectedSlotId, currentBinderPage, slotsPerPage, collectionViewFilter, openPublicLocation])

  const handleJumpToNextNeeded = useCallback(() => {
    handleJumpBetweenTargets("next")
  }, [handleJumpBetweenTargets])

  const handleJumpToPreviousNeeded = useCallback(() => {
    handleJumpBetweenTargets("prev")
  }, [handleJumpBetweenTargets])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isSearchOpen) return
      if (event.metaKey || event.ctrlKey || event.altKey) return

      const target = event.target as HTMLElement | null
      if (target?.isContentEditable) return
      if (target && ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName)) return

      if (event.key.toLowerCase() === "n") {
        event.preventDefault()
        if (event.shiftKey) {
          handleJumpToPreviousNeeded()
        } else {
          handleJumpToNextNeeded()
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [handleJumpToNextNeeded, handleJumpToPreviousNeeded, isSearchOpen])

  const handleSlotClick = (pokemon: { id: number; name: string }) => {
    if (isSwiping || didSwipe()) return
    cancelPageNavigation()

    if (longPressedPokemon?.id === pokemon.id) {
      setLongPressedPokemon(null)
      return
    }

    const summary = getPokemonSummary(pokemon.id)
    if (summary) {
      setSelectedPokemon(summary)
    }
  }

  const handleLongPress = (pokemon: { id: number; name: string }) => {
    if (readOnlyMode) return
    cancelPageNavigation()
    setLongPressedPokemon(pokemon)
    if (navigator.vibrate) {
      navigator.vibrate(30)
    }
  }

  const handlePhotoButtonClick = requireAccount

  const handlePagePhotoSelected = requireAccount

  const toggleDarkMode = () => {
    const next = !isDarkMode
    setIsDarkMode(next)
    if (!readOnlyMode) {
      void updateSettings({ darkMode: next })
    }
    document.documentElement.classList.toggle("dark", next)
    setThemeCookieChoice(next ? "dark" : "light")
  }

  // Only a theme the user picked here is saved to the cookie, not one synced from settings.
  useEffect(() => {
    if (!themeCookieChoice) return
    const maxAge = 60 * 60 * 24 * 365
    document.cookie = `binderdex_theme=${themeCookieChoice}; path=/; max-age=${maxAge}; samesite=lax`
  }, [themeCookieChoice])

  useEffect(() => {
    setIsDarkMode(settings.darkMode)
  }, [settings.darkMode])

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDarkMode)

    const head = document.head
    let themeColorMeta = head.querySelector<HTMLMetaElement>('meta[name="theme-color"][data-holofolder-runtime-theme="true"]')

    if (!themeColorMeta) {
      themeColorMeta = document.createElement("meta")
      themeColorMeta.name = "theme-color"
      themeColorMeta.dataset.holofolderRuntimeTheme = "true"
      head.appendChild(themeColorMeta)
    }

    themeColorMeta.content = isDarkMode ? THEME_COLOR_DARK : THEME_COLOR_LIGHT

    let appleStatusMeta = head.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-status-bar-style"]')
    if (!appleStatusMeta) {
      appleStatusMeta = document.createElement("meta")
      appleStatusMeta.name = "apple-mobile-web-app-status-bar-style"
      head.appendChild(appleStatusMeta)
    }

    appleStatusMeta.content = "black-translucent"
  }, [isDarkMode])

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }

    setIsOnline(window.navigator.onLine)
    const standaloneMatch = window.matchMedia("(display-mode: standalone)")
    const updateStandaloneMode = () => {
      const isStandalone =
        standaloneMatch.matches ||
        (typeof window.navigator !== "undefined" && "standalone" in window.navigator && Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone))
      setIsInstalledApp(isStandalone)
    }

    updateStandaloneMode()

    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      setInstallPromptEvent(event as BeforeInstallPromptEvent)
      setPwaStatusMessage("Holo Folder is ready to install for better offline use.")
    }
    const handleAppInstalled = () => {
      setInstallPromptEvent(null)
      setIsInstalledApp(true)
      setPwaStatusMessage("Holo Folder installed. The app shell and cached assets are now available offline.")
    }

    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt)
    window.addEventListener("appinstalled", handleAppInstalled)

    if (typeof standaloneMatch.addEventListener === "function") {
      standaloneMatch.addEventListener("change", updateStandaloneMode)
    }

    registerServiceWorker()

    return () => {
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt)
      window.removeEventListener("appinstalled", handleAppInstalled)

      if (typeof standaloneMatch.removeEventListener === "function") {
        standaloneMatch.removeEventListener("change", updateStandaloneMode)
      }
    }
  }, [])

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in window.navigator)) {
      return
    }

    if (window.navigator.onLine === false || offlineCacheWarmupUrls.length === 0) {
      return
    }

    if (!shouldPostOfflineCacheWarmup(lastOfflineCacheWarmupSignatureRef.current, offlineCacheWarmupUrls)) {
      return
    }

    let cancelled = false
    const warmupSignature = offlineCacheWarmupSignature
    const timeoutId = window.setTimeout(() => {
      void window.navigator.serviceWorker.ready
        .then((registration) => {
          if (cancelled) return

          const targetWorker = registration.active ?? window.navigator.serviceWorker.controller
          if (!targetWorker) return

          targetWorker.postMessage({
            type: OFFLINE_CACHE_WARMUP_MESSAGE_TYPE,
            urls: offlineCacheWarmupUrls,
          })
          lastOfflineCacheWarmupSignatureRef.current = warmupSignature
        })
        .catch((error) => {
          console.error("[holofolder] Failed to warm offline cache:", error)
        })
    }, 1200)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [offlineCacheWarmupSignature, offlineCacheWarmupUrls])

  const handleInstallApp = useCallback(async () => {
    if (!installPromptEvent) {
      setPwaStatusMessage("Use your browser's Add to Home Screen option to install Holo Folder.")
      return
    }

    try {
      await installPromptEvent.prompt()
      const { outcome } = await installPromptEvent.userChoice
      if (outcome === "accepted") {
        setPwaStatusMessage("Install started. Holo Folder will open like an app once added.")
      } else {
        setPwaStatusMessage("Install prompt dismissed.")
      }
    } catch (error) {
      console.error("[holofolder] Failed to install app:", error)
      setPwaStatusMessage("Could not open the install prompt.")
    } finally {
      setInstallPromptEvent(null)
    }
  }, [installPromptEvent])

  useEffect(() => {
    if (!canManageShare) {
      if (!legacyReadOnlyMode && !shareViewToken) {
        setSharePath(null)
        setIsShareEnabled(false)
        setShareShowPrices(false)
        setIsShareLoading(false)
      }
      return
    }

    let cancelled = false

    const loadShareState = async () => {
      setIsShareLoading(true)

      try {
        const response = await fetch(binderShareUrl(shareBinderId), {
          cache: "no-store",
        })
        const payload = await response.json().catch(() => null)

        if (!response.ok) {
          throw new Error(payload?.error || `Failed to load share link (${response.status})`)
        }

        if (cancelled) return

        setSharePath(payload?.share?.path ?? null)
        setIsShareEnabled(Boolean(payload?.share?.is_enabled))
        setShareShowPrices(payload?.share?.show_prices === true)
      } catch (error) {
        if (!cancelled) {
          toast(error instanceof Error ? error.message : "Could not load the share link.", "error")
        }
      } finally {
        if (!cancelled) {
          setIsShareLoading(false)
        }
      }
    }

    loadShareState()

    return () => {
      cancelled = true
    }
  }, [canManageShare, legacyReadOnlyMode, shareBinderId, shareIdentityRevision, shareScopeKey, shareViewToken])

  const handleEnableReadOnlyShare = useCallback(async (showPrices?: boolean) => {
    if (!canManageShare) return
    const scopeKey = shareScopeKey

    setIsShareLoading(true)

    try {
      const response = await fetch("/app/api/binder-share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(shareBinderId ? { binderId: shareBinderId } : {}), ...(typeof showPrices === "boolean" ? { showPrices } : {}) }),
      })
      const payload = await response.json().catch(() => null)
      if (shareScopeRef.current !== scopeKey) return

      if (!response.ok) {
        throw new Error(payload?.error || `Failed to enable share link (${response.status})`)
      }

      setSharePath(payload?.share?.path ?? null)
      setIsShareEnabled(Boolean(payload?.share?.is_enabled))
      setShareShowPrices(payload?.share?.show_prices === true)
      toast(typeof showPrices === "boolean" ? "Share pricing updated" : "Read-only share link is live")
    } catch (error) {
      if (shareScopeRef.current === scopeKey) toast(error instanceof Error ? error.message : "Could not enable the share link", "error")
    } finally {
      if (shareScopeRef.current === scopeKey) setIsShareLoading(false)
    }
  }, [canManageShare, shareBinderId, shareScopeKey])

  const handleCopyReadOnlyShareLink = useCallback(async () => {
    if (!fullShareUrl) {
      toast("Generate a share link first", "error")
      return
    }

    try {
      await navigator.clipboard.writeText(fullShareUrl)
      toast("Share link copied")
    } catch {
      toast("Could not copy the share link", "error")
    }
  }, [fullShareUrl])

  const handleDisableReadOnlyShare = useCallback(async () => {
    if (!canManageShare) return
    const scopeKey = shareScopeKey

    setIsShareLoading(true)

    try {
      const response = await fetch(binderShareUrl(shareBinderId), {
        method: "DELETE",
      })
      const payload = await response.json().catch(() => null)
      if (shareScopeRef.current !== scopeKey) return

      if (!response.ok) {
        throw new Error(payload?.error || `Failed to disable share link (${response.status})`)
      }

      setSharePath(payload?.share?.path ?? sharePath)
      setIsShareEnabled(false)
      toast("Read-only share link disabled")
    } catch (error) {
      if (shareScopeRef.current === scopeKey) toast(error instanceof Error ? error.message : "Could not disable the share link", "error")
    } finally {
      if (shareScopeRef.current === scopeKey) setIsShareLoading(false)
    }
  }, [canManageShare, shareBinderId, shareScopeKey, sharePath])

  const handleRefreshPrices = useCallback(async () => {
    if (readOnlyMode) return
    if (!user) {
      setIsAuthOpen(true)
      return
    }

    setIsRefreshingPrices(true)
    setPriceRefreshMessage(null)

    try {
      const response = await fetch("/app/api/card-prices/refresh", {
        method: "POST",
      })
      const payload = await response.json().catch(() => null)

      if (!response.ok) {
        throw new Error(payload?.error || `Failed to start price refresh (${response.status})`)
      }

      setPriceRefreshMessage("Price refresh started in the background.")
    } catch (error) {
      setPriceRefreshMessage(error instanceof Error ? error.message : "Could not start price refresh.")
    } finally {
      setIsRefreshingPrices(false)
    }
  }, [readOnlyMode, user])

  const collected = selectedPokemon ? isCollected(selectedPokemon.id) : false
  const wishlisted = selectedPokemon ? isWishlisted(selectedPokemon.id) : false
  const collectionItem = selectedPokemon ? getCollectionItem(selectedPokemon.id) : null
  const selectedPokemonHasAssignedCard = Boolean(collectionItem?.card_id)
  const selectedPokemonIsFavorite = collectionItem?.status === "finalized"
  const selectedPokemonDisplayName = selectedPokemon ? formatPokemonDisplayName(selectedPokemon.name) : ""
  const explicitWanted = wantedDetail && wantedDetail.pokemonId === selectedPokemon?.id
    ? collectionItem?.wanted_cards.find(card => getWantedCardKey(card) === getWantedCardKey(wantedDetail.card)) ?? null : null
  const selectedSlotCardDisplay = getSelectedSlotCardDisplay(collectionItem, binderCardDisplay, explicitWanted)
  const selectedPrimaryCardPreview = selectedSlotCardDisplay.primaryCard
  // The illustrator of the card shown in the detail sheet. A wanted card saves it; otherwise it comes from the
  // Pokémon's card list (the same list the card selector uses, prefetched when the slot is pressed, so it is
  // usually already loaded and also works offline). The row keeps a fixed height while it loads so nothing shifts.
  const [selectedCardIllustrator, setSelectedCardIllustrator] = useState<{ key: string; name: string | null } | null>(null)
  const selectedIllustratorLookupKey = selectedPokemon && selectedPrimaryCardPreview?.cardId
    ? `${selectedPokemon.id}:${selectedPrimaryCardPreview.cardId}`
    : null
  const selectedKnownIllustrator = selectedPokemon && selectedPrimaryCardPreview?.cardId
    ? getKnownCardIllustrator(selectedPokemon.id, selectedPrimaryCardPreview.cardId, collectionItem?.wanted_cards)
    : null
  useEffect(() => {
    if (!selectedIllustratorLookupKey || selectedKnownIllustrator !== null) return
    const [pokemonId, ...cardIdParts] = selectedIllustratorLookupKey.split(":")
    const cardId = cardIdParts.join(":")
    let cancelled = false
    loadCardsForPokemon(Number(pokemonId), "en")
      .then((cards) => {
        if (cancelled) return
        const name = cards.find((card) => matchesCatalogCardId(card, cardId))?.illustrator?.trim()
        setSelectedCardIllustrator({ key: selectedIllustratorLookupKey, name: name || null })
      })
      .catch(() => {
        if (!cancelled) setSelectedCardIllustrator({ key: selectedIllustratorLookupKey, name: null })
      })
    return () => {
      cancelled = true
    }
  }, [selectedIllustratorLookupKey, selectedKnownIllustrator])
  const selectedFetchedIllustrator = selectedCardIllustrator?.key === selectedIllustratorLookupKey ? selectedCardIllustrator : null
  // A name; "" when the card has none; null while it is still loading (or when no card is assigned).
  const selectedIllustratorState: string | null = selectedKnownIllustrator ?? (selectedFetchedIllustrator ? selectedFetchedIllustrator.name ?? "" : null)
  const selectedIllustratorName = selectedIllustratorState || null
  const selectedIllustratorArrivedLate = selectedKnownIllustrator === null
  const selectedCurrentCardPreview = selectedSlotCardDisplay.currentCard
  const selectedPokemonDisplayImage = selectedPokemon ? getDetailArtwork(selectedPokemon, selectedPrimaryCardPreview?.cardImage) : null
  const selectedPokemonDisplayFit = "object-contain"
  const selectedPokemonDisplayTone = getDisplayArtworkTone(collectionItem?.status)
  const selectedCardPriceKey = getCollectionItemPriceKey(collectionItem)
  const selectedAssignedPriceSnapshot = selectedCardPriceKey ? pricesByCardId[selectedCardPriceKey] : undefined
  const selectedCardPriceLabel = priceFormat.label(selectedAssignedPriceSnapshot)
  const selectedFinishPrices = useMemo(
    () => getRegionalFinishPrices(selectedAssignedPriceSnapshot, pricingPreferences.region),
    [pricingPreferences.region, selectedAssignedPriceSnapshot],
  )
  const selectedWantedCards = collectionItem?.wanted_cards ?? []
  const selectedWantedCardPreview = explicitWanted ?? selectedWantedCards[0] ?? null
  const selectedHasWantedCard = Boolean(explicitWanted) || binderCardDisplay !== "current" && Boolean(selectedPrimaryCardPreview) && (binderCardDisplay === "wanted" || Boolean(collectionItem?.wanted_cards?.length) || collectionItem?.status === "wishlisted")
  const selectedAssignedPriceChipLabel = selectedCardPriceLabel ?? (isLoadingPrices && collectionItem?.card_id ? "Loading price..." : null)
  const selectedDetailPriceSnapshot = selectedPrimaryCardPreview
    ? pricesByCardId[getCardPriceKey(selectedPrimaryCardPreview.cardId, selectedPrimaryCardPreview.cardLanguage ?? "en")]
    : undefined
  const selectedDetailPriceLabel = selectedPrimaryCardPreview
    ? priceFormat.label(selectedDetailPriceSnapshot) ?? (isLoadingPrices ? "Loading price..." : "No price yet")
    : null
  const selectedComparisonFinishPrices = getRegionalFinishPrices(selectedDetailPriceSnapshot, pricingPreferences.region)
  const selectedComparisonPrice = selectedPrimaryCardPreview
    ? selectedComparisonFinishPrices[selectedPrimaryCardPreview.cardFinish as PricedCardFinish] ?? (selectedPrimaryCardPreview.cardFinish === "reverse_holo" ? undefined : selectedDetailPriceSnapshot)
    : undefined
  const [selectedSoldEvidence, setSelectedSoldEvidence] = useState<{ key: string; check: CardPriceCheck } | null>(null)
  const selectedComparisonKey = `${selectedPrimaryCardPreview?.cardId}:${selectedPrimaryCardPreview?.cardLanguage ?? "en"}:${selectedPrimaryCardPreview?.cardFinish}`
  const onSelectedSoldCheck = (check: CardPriceCheck) => setSelectedSoldEvidence({ key: selectedComparisonKey, check })
  const selectedSoldGuide = billing.premium ? buildSoldPriceGuide(selectedSoldEvidence?.key === selectedComparisonKey ? selectedSoldEvidence.check : null, selectedComparisonPrice?.marketGbpAmount ?? selectedComparisonPrice?.gbpAmount, selectedPrimaryCardPreview?.cardFinish, readDealThresholds(typeof window === "undefined" ? undefined : window.localStorage)) : null
  const selectedUsesSoldGuide = selectedSoldGuide?.referenceGbp != null
  const selectedMarketPriceLabel = priceFormat.amount(selectedComparisonPrice?.marketGbpAmount ?? selectedComparisonPrice?.gbpAmount, selectedDetailPriceSnapshot)
  const selectedGoodPriceLabel = selectedUsesSoldGuide
    ? priceFormat.range(selectedSoldGuide.fairBand.low, selectedSoldGuide.fairBand.high, selectedDetailPriceSnapshot)
    : priceFormat.amount(selectedComparisonPrice?.goodGbpAmount, selectedDetailPriceSnapshot)
  const selectedRangePriceLabel = priceFormat.range(selectedComparisonPrice?.lowGbpAmount, selectedComparisonPrice?.highGbpAmount, selectedDetailPriceSnapshot)
  const selectedConfidenceLabel = formatPriceConfidenceLabel(selectedDetailPriceSnapshot)
  const selectedPriceSourceLabel = formatPriceSourceLabel(selectedDetailPriceSnapshot)
  const selectedCollectedDateLabel = collectionItem?.status !== "wishlisted" ? formatCollectedDate(collectionItem?.collected_at) : null

  const registerSlotButtonRef = useCallback((pokemonId: number, node: HTMLButtonElement | null) => {
    if (node) {
      slotButtonRefs.current.set(pokemonId, node)
      return
    }

    slotButtonRefs.current.delete(pokemonId)
  }, [])

  const updateQuickPanelPosition = useCallback(() => {
    if (typeof window === "undefined" || !selectedPokemon || isSearchOpen) {
      setQuickPanelPosition(null)
      return
    }

    if (!isDesktopViewport) {
      setQuickPanelPosition(null)
      return
    }

    const slotButton = slotButtonRefs.current.get(selectedPokemon.id)
    const quickPanelNode = quickPanelRef.current

    if (!slotButton || !quickPanelNode) {
      return
    }

    const slotRect = slotButton.getBoundingClientRect()
    const panelRect = quickPanelNode.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const navBottom = shellNavRef.current?.getBoundingClientRect().bottom ?? 0
    const edgePadding = 16
    const topClearance = Math.max(16, navBottom + 10)
    const bottomClearance = 16
    const verticalGap = 14
    const maxHeight = Math.max(0, viewportHeight - topClearance - bottomClearance)
    const panelHeight = Math.min(panelRect.height, maxHeight)
    const spaceAbove = slotRect.top - topClearance - verticalGap
    const spaceBelow = viewportHeight - slotRect.bottom - bottomClearance - verticalGap
    const placeBelow = spaceBelow >= panelHeight || spaceBelow > spaceAbove
    const slotCenterX = slotRect.left + slotRect.width / 2

    let left = slotCenterX - panelRect.width / 2
    if (slotCenterX < viewportWidth * 0.32) {
      left = slotRect.left - 4
    } else if (slotCenterX > viewportWidth * 0.68) {
      left = slotRect.right - panelRect.width + 4
    }
    left = Math.max(edgePadding, Math.min(left, viewportWidth - panelRect.width - edgePadding))

    let top = placeBelow
      ? slotRect.bottom + verticalGap
      : slotRect.top - panelHeight - verticalGap
    top = Math.max(topClearance, Math.min(top, viewportHeight - panelHeight - bottomClearance))

    setQuickPanelPosition((current) => {
      if (current && Math.abs(current.top - top) < 1 && Math.abs(current.left - left) < 1 && Math.abs(current.maxHeight - maxHeight) < 1) {
        return current
      }

      return { top, left, maxHeight }
    })
  }, [isDesktopViewport, isSearchOpen, selectedPokemon])

  useEffect(() => {
    if (!selectedPokemon || isSearchOpen || typeof window === "undefined") {
      setQuickPanelPosition(null)
      return
    }

    if (!isDesktopViewport) {
      setQuickPanelPosition(null)
      return
    }

    const frame = window.requestAnimationFrame(() => {
      updateQuickPanelPosition()
    })

    const observer = new ResizeObserver(updateQuickPanelPosition)
    if (quickPanelRef.current) observer.observe(quickPanelRef.current)
    window.addEventListener("resize", updateQuickPanelPosition, { passive: true })
    window.addEventListener("scroll", updateQuickPanelPosition, { passive: true })

    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener("resize", updateQuickPanelPosition)
      window.removeEventListener("scroll", updateQuickPanelPosition)
    }
  }, [
    collectionItem?.card_name,
    collected,
    isDesktopViewport,
    isSearchOpen,
    selectedPokemon?.id,
    selectedCurrentCardPreview?.cardId,
    selectedHasWantedCard,
    selectedPokemonHasAssignedCard,
    selectedPokemonIsFavorite,
    updateQuickPanelPosition,
    wishlisted,
  ])

  const searchDialogRef = useRef<HTMLDivElement | null>(null)
  const controlsSheetRef = useRef<HTMLDivElement | null>(null)
  const mobileActionsRef = useRef<HTMLDivElement | null>(null)
  const closeMobileActions = useCallback(() => setLongPressedPokemon(null), [])
  const closeSelectedPokemon = useCallback(() => { setSelectedPokemon(null); setWantedDetail(null) }, [])
  const closeSearch = useCallback(() => setIsSearchOpen(false), [])
  const closeControlsSheet = useCallback(() => setIsMobileNavExpanded(false), [])
  const isQuickPanelOpen = Boolean(selectedPokemon) && !isSearchOpen
  const isMobileQuickPanel = isQuickPanelOpen && !isDesktopViewport
  // The card selector and the all-cards view open on top of the card detail, which stays mounted but hidden.
  const isQuickPanelCovered = Boolean(cardBrowser?.nested) || Boolean(illustratorBrowser?.nested)

  // Card detail: a popover next to the slot on desktop, a modal bottom sheet on mobile.
  useOverlay(isQuickPanelOpen, closeSelectedPokemon, {
    containerRef: quickPanelRef,
    lockScroll: !isDesktopViewport,
    trapFocus: !isDesktopViewport && !isQuickPanelCovered,
    autoFocus: !isDesktopViewport,
  })
  useOverlay(Boolean(longPressedPokemon) && !isDesktopViewport && !readOnlyMode, closeMobileActions, { containerRef: mobileActionsRef })
  const mobileActionsSwipe = useSwipeToDismiss(mobileActionsRef, closeMobileActions, !isDesktopViewport)
  useOverlay(isSearchOpen, closeSearch, { containerRef: searchDialogRef, autoFocus: false })
  const searchSwipe = useSwipeToDismiss(searchDialogRef, closeSearch, isSearchOpen)
  useOverlay(isMobileNavExpanded && !isSearchOpen, closeControlsSheet, { containerRef: controlsSheetRef })
  const quickPanelSwipe = useSwipeToDismiss(quickPanelRef, closeSelectedPokemon, isMobileQuickPanel)
  const closeCardBrowser = useCallback(() => setCardBrowser(null), [setCardBrowser])
  const closeIllustratorBrowser = useCallback(() => setIllustratorBrowser(null), [])
  const controlsSheetSwipe = useSwipeToDismiss(controlsSheetRef, closeControlsSheet, !isDesktopViewport)

  /** Close every open overlay first so sheets/modals never stack on top of each other. */
  const openExclusively = useCallback((open: () => void) => {
    cancelPageNavigation()
    closeAllOverlays()
    setLongPressedPokemon(null)
    open()
  }, [cancelPageNavigation])

  /** Switch main view (dock tab / desktop tab), closing any open overlay and card detail. */
  const switchMainView = useCallback(async (view: ActiveMainView) => {
    if (browserSurface && (view === "wanted" || view === "sets" || view === "pokemon" || view === "analytics")
      && (browserSurface.surface.state.main !== "dex" || browserSurface.surface.state.dexView !== view)) {
      browserSurface.surface.onLegacyView(view)
      return
    }
    // Binder/home always means the current collection's binder, never the legacy global Dex binder.
    if (browserSurface && view === "binder" && (browserSurface.surface.state.main !== "collection" || browserSurface.surface.collection?.state.view !== "binder")) {
      browserSurface.surface.onBinder()
      return
    }
    cancelPageNavigation()
    const request = ++viewRequestRef.current
    setViewLoadError(null)
    closeAllOverlays()
    setCardBrowser(null)
    setIllustratorBrowser(null)
    setSelectedPokemon(null)
    setLongPressedPokemon(null)
    setIsSearchOpen(false)
    setIsMobileNavExpanded(false)
    if (view !== "sets") setSetViewRequest(null)
    if (view === activeMainView) return
    // Keep the outgoing view visible until a lazy destination is ready.
    try {
      if (view === "analytics") await import("@/components/collection-analytics-view")
      if (view === "list") await import("@/components/dex-list-view")
      if (view === "sets") await import("@/components/set-population-view")
      if (view === "pokemon") await import("@/components/pokemon-browse-view")
    } catch {
      if ((view === "pokemon" || view === "analytics") && request === viewRequestRef.current) {
        setViewLoadError(`${view === "pokemon" ? "Pokémon browsing" : "Analytics"} could not load. Open it once while online to save it on this device.`)
        return
      }
      // Let existing destinations surface their normal loading error.
    }
    if (request !== viewRequestRef.current) return
    if (view === "pokemon" || view === "sets") lastBrowseViewRef.current = view
    transitionContent(mainViewRef.current, () => {
      if (request === viewRequestRef.current) setActiveMainView(view)
    })
  }, [browserSurface, setCardBrowser, activeMainView, transitionContent, cancelPageNavigation])
  useEdgeSwipeBack(activeMainView, switchMainView, "binder")

  /** Open the read-only all-cards view. From the card detail it stacks one level; otherwise it replaces any overlay. */
  // Offline card search: own cards plus card data the service worker has cached (read lazily, per search session).
  const getOfflineSearchCards = useCallback(
    async () => {
      const { buildOfflineCardIndex } = await import("@/lib/offline-card-index")
      const cached = await buildOfflineCardIndex(collection)
      const current = browserSurface?.nativeConsumer?.read.catalog.map(c => ({ ...c.card, dexIds: [...(c.pokemonIds ?? [])] })) ?? []
      return [...current, ...cached.filter(c => !current.some(card => card.id === c.id && card.language === c.language))]
    },
    [collection, browserSurface?.nativeConsumer?.read.catalog],
  )

  const openCardBrowser = useCallback((
    pokemon: { id: number; name: string },
    options: { highlightCardId?: string | null; fromDetail?: boolean; focusedCard?: SearchCardResult; finish?: CardFinish } = {},
  ) => {
    if (options.fromDetail) {
      setCardBrowser({ pokemon, highlightCardId: options.highlightCardId ?? null, nested: true })
      return
    }
    openExclusively(() => {
      setSelectedPokemon(null)
      setCardBrowser({ pokemon, highlightCardId: options.highlightCardId ?? null, focusedCard: options.focusedCard, finish: options.finish, nested: false })
    })
  }, [setCardBrowser, openExclusively])

  const openNativeCard = useCallback((card: SearchCardResult, finish?: CardFinish) => {
    openExclusively(() => { setSelectedPokemon(null); setNativeLookup(card, finish) })
  }, [openExclusively, setNativeLookup, setSelectedPokemon])
  const hasNativeConsumer = Boolean(browserSurface?.nativeConsumer)
  const nativeReadOnly = browserSurface?.nativeConsumer ? !browserSurface.nativeConsumer.editingAvailable : readOnlyMode
  const nativeConsumer: NativeConsumerBinding | undefined = browserSurface?.nativeConsumer
    ? { ...browserSurface.nativeConsumer, openCard: openNativeCard } : undefined
  const nativeSpeciesView = activeMainView === "pokemon" || activeMainView === "sets" || activeMainView === "list"
  const { scope: nativeScope, read: nativeRead, collectionId: nativeCollectionId } = browserSurface?.nativeConsumer ?? {}
  const nativeSpecies = useMemo(() => nativeSpeciesView && nativeScope && nativeRead
    ? nativeSpeciesCollection({ scope: nativeScope, read: nativeRead, collectionId: nativeCollectionId }) : null,
  [nativeSpeciesView, nativeScope, nativeRead, nativeCollectionId])
  // Shares have no browser session: species views use the public index, same shape as nativeSpeciesCollection.
  const speciesCollection = nativeSpecies ?? (publicIndex && nativeSpeciesView ? publicIndex.species : null)

  /** Open every card by an illustrator. From the card detail it stacks one level; otherwise it replaces any overlay. */
  const openIllustratorBrowser = useCallback((name: string, options: { fromDetail?: boolean } = {}) => {
    if (options.fromDetail) {
      setIllustratorBrowser({ name, nested: true })
      return
    }
    openExclusively(() => {
      setSelectedPokemon(null)
      setIllustratorBrowser({ name, nested: false })
    })
  }, [openExclusively])

  /**
   * One card from an illustrator's grid: its own details open above the grid, for exactly that card, and closing
   * them returns to the grid. A card detail the grid was opened from is closed first so only two levels are open.
   */
  const openIllustratorCard = useCallback((card: SearchCardResult) => {
    setIllustratorBrowser(current => current ? { ...current, nested: false } : current)
    setSelectedSlotId(null)
    setSelectedPokemon(null)
    if (hasNativeConsumer) { setNativeLookup(card); return }
    const dexId = card.dexIds[0]
    const pokemon = dexId ? getPokemonSummary(dexId) : null
    if (pokemon) setCardBrowser({ pokemon: { id: pokemon.id, name: pokemon.name }, highlightCardId: card.id, focusedCard: card, nested: true })
  }, [hasNativeConsumer, setCardBrowser, setNativeLookup, setSelectedPokemon])
  /** A pocket's wanted card, opened as its own card in the wanted finish. Its full catalog entry is used when the collection has it. */
  const openWantedCard = useCallback((want: WantedCard) => {
    const known = nativeRead?.catalog.find(entry => matchesCatalogCardId(entry.card, want.card_id) && (!want.card_language || entry.card.language === want.card_language))
    const card: SearchCardResult = known ? { ...known.card, dexIds: [...(known.pokemonIds ?? [])] }
      : { id: want.card_id, localId: "", name: want.card_name, image: want.card_image, language: want.card_language, set: { id: "", name: want.card_set ?? "" }, dexIds: [] }
    openNativeCard(card, want.card_finish ?? undefined)
  }, [nativeRead, openNativeCard])
  // Owned and wanted marks in the illustrator view come from the signed-in collection when there is one.
  const illustratorCollection = useMemo(() => {
    if (!illustratorBrowser || !nativeRead || nativeRead.evidence.kind === "unavailable") return collection
    const snapshot = nativeRead.evidence.snapshot
    return [...snapshot.items.flatMap(item => item.identity.kind === "card" ? [{ card_id: item.identity.cardId, status: "collected" }] : []),
      ...snapshot.binders.flatMap(binder => binder.slots.filter(slot => slot.wantedCards.length > 0).map(slot => ({ wanted_cards: slot.wantedCards.map(want => ({ card_id: want.card_id })) })))]
  }, [illustratorBrowser, nativeRead, collection])

  /** A set hit from Search or Quick mode: open Sets on that set (a fresh Sets view, even if Sets is showing). */
  const openSetFromSearch = useCallback((set: TCGSetSummary) => {
    if (browserSurface) {
      browserSurface.surface.onLegacyView("sets", set)
      return
    }
    setSetViewRequest((current) => ({ set, key: (current?.key ?? 0) + 1 }))
    setIsQuickModeOpen(false)
    void switchMainView("sets")
  }, [browserSurface, switchMainView])

  const openSearch = useCallback(() => {
    trackGoogleEvent("search_opened", { surface: "search" })
    openExclusively(() => {
      setSelectedPokemon(null)
      setIsSearchOpen(true)
    })
  }, [openExclusively, trackGoogleEvent])

  /** Quick mode: the one-handed launcher (long-press Search, the Search sheet's button, or Ctrl/Cmd+K). */
  const openQuickMode = useCallback(() => {
    if (!pricingEnabled) { openSearch(); return }
    trackGoogleEvent("search_opened", { surface: "quick_mode" })
    openExclusively(() => {
      setSelectedPokemon(null)
      setIsSearchOpen(false)
      setQuickLookup(null)
      setIsQuickModeOpen(true)
    })
  }, [openExclusively, openSearch, pricingEnabled, trackGoogleEvent])
  const openPriceLookup = useCallback((query: string) => {
    if (!pricingEnabled) { openSearch(); return }
    trackGoogleEvent("search_opened", { surface: "price_lookup" })
    openExclusively(() => {
      setSelectedPokemon(null)
      setIsSearchOpen(false)
      setQuickLookup({ query })
      setIsQuickModeOpen(true)
    })
  }, [openExclusively, openSearch, pricingEnabled, trackGoogleEvent])
  const closeQuickMode = useCallback(() => setIsQuickModeOpen(false), [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
      event.preventDefault()
      openQuickMode()
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [openQuickMode])

  const cancelQuickPress = useCallback(() => {
    if (quickPressTimerRef.current !== null) window.clearTimeout(quickPressTimerRef.current)
    quickPressTimerRef.current = null
  }, [])
  const quickPressHandlers = useMemo(() => ({
    onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return
      quickPressFiredRef.current = false
      cancelQuickPress()
      quickPressTimerRef.current = window.setTimeout(() => {
        quickPressTimerRef.current = null
        quickPressFiredRef.current = true
        navigator.vibrate?.(20)
        openQuickMode()
      }, QUICK_LONG_PRESS_MS)
    },
    onPointerUp: cancelQuickPress,
    onPointerLeave: cancelQuickPress,
    onPointerCancel: cancelQuickPress,
    onContextMenu: (event: ReactMouseEvent<HTMLButtonElement>) => event.preventDefault(),
  }), [cancelQuickPress, openQuickMode])
  useEffect(() => cancelQuickPress, [cancelQuickPress])

  const getQuickPokemonState = useCallback((pokemonId: number) => {
    const meta = getSearchResultMeta({ id: pokemonId, name: "" })
    // Show mode and the price lookup say "Not in binder", like their card results.
    const missingLabel = isShowModeOn || quickLookup ? "Not in binder" : "Missing"
    return meta.stateLabel ? { label: meta.stateLabel, toneClass: meta.stateToneClass ?? "" } : { label: missingLabel, toneClass: "bg-muted text-muted-foreground" }
  }, [getSearchResultMeta, isShowModeOn, quickLookup])

  // Quick mode's deal checker (components/quick-card-check.tsx): card state; guests are asked to join to act.
  const getQuickCardState = useCallback((card: SearchCardResult, pokemon: { id: number; name: string }, finish?: CardFinish) => {
    if (publicIndex) return publicIndex.quickState(card, pokemon.id, finish)
    const state = resolveQuickCardState(card, getCollectionItem(pokemon.id), finish)
    return { ...state, otherBindersIncomplete: binders.length > 1 && state.otherBindersIncomplete }
  }, [binders.length, getCollectionItem, publicIndex])
  const handleQuickCardAction = requireAccount
  const handleQuickChangeCard = requireAccount
  const handleQuickRemoveOwned = requireAccount
  // The deal check is part of every Quick mode; Show mode (and the price lookup) add the hunt list, bundle and tally.
  const quickCardCheck = useMemo(
    () => ({ currency: pricingPreferences.currency, fxRates, readOnly: nativeReadOnly, destinationName: activeBinder?.name ?? "this binder", revisitKey: revisitStorageKey(user?.id ?? null, resolvedCollectionOwnerUserId ?? null), budgetKey: showBudgetStorageKey(user?.id ?? null, resolvedCollectionOwnerUserId ?? null), getCardState: getQuickCardState, onAction: handleQuickCardAction, onChangeCard: handleQuickChangeCard, onRemoveOwned: handleQuickRemoveOwned, huntItems: collection }),
    [nativeReadOnly, activeBinder?.name, collection, fxRates, getQuickCardState, handleQuickCardAction, handleQuickChangeCard, handleQuickRemoveOwned, pricingPreferences.currency, resolvedCollectionOwnerUserId, user?.id],
  )
  // Outside Show mode Quick still badges each printing Owned / Wanted and lists wanted ones first.
  const quickCardStanding = useMemo(() => ({ getCardState: getQuickCardState, items: collection }), [collection, getQuickCardState])
  const showTally = useMemo(() => summarizeShowSession(showSession.session), [showSession.session])

  const handleQuickNavigate = (destination: QuickDestinationId) => {
    if (destination === "show-mode") {
      // Turning it on keeps Quick mode open (that's where Show mode lives); exiting closes it.
      setShowMode(!isShowModeOn)
      if (isShowModeOn) setIsQuickModeOpen(false)
      return
    }
    if (destination === "settings") {
      openExclusively(() => setIsSettingsOpen(true))
      return
    }
    if (destination === "scan") {
      closeAllOverlays()
      setIsQuickModeOpen(false)
      if (activeMainView !== "binder") void switchMainView("binder")
      handlePhotoButtonClick()
      return
    }
    void switchMainView(destination)
  }
  // Quick mode is memoised, so it gets stable handlers: the navigate handler reads the latest state through a
  // ref instead of being rebuilt (and re-rendering Quick mode and its deal check) on every Binder app render.
  const handleQuickNavigateRef = useRef(handleQuickNavigate)
  useLayoutEffect(() => {
    handleQuickNavigateRef.current = handleQuickNavigate
  })
  const onQuickNavigate = useCallback((destination: QuickDestinationId) => handleQuickNavigateRef.current(destination), [])
  const onQuickSelectPokemon = useCallback((pokemon: PokemonSummary) => {
    closeAllOverlays()
    setIsQuickModeOpen(false)
    handlePokemonSelect(pokemon)
  }, [handlePokemonSelect])
  const onQuickSelectCard = useCallback(
    (card: SearchCardResult, pokemon: { id: number; name: string }, finish?: CardFinish) => openCardBrowser(pokemon, { highlightCardId: card.id, focusedCard: card, finish: finish ?? inferCardFinish(card.rarity, card.variants) }),
    [openCardBrowser],
  )
  const onQuickBrowseIllustrator = useCallback((name: string) => openIllustratorBrowser(name), [openIllustratorBrowser])
  const quickHiddenDestinations = useMemo<QuickDestinationId[]>(() => (readOnlyMode ? ["scan", "analytics", "settings"] : []), [readOnlyMode])

  // Full-screen dialogs replace the card detail instead of stacking on top of it.
  useEffect(() => {
    if (isSettingsOpen || isAuthOpen || isPartnerOpen || isMobileNavExpanded) {
      setSelectedPokemon(null)
      setLongPressedPokemon(null)
    }
  }, [isAuthOpen, isMobileNavExpanded, isPartnerOpen, isSettingsOpen])

  const renderSelectedPokemonQuickPanel = () => stagedSlotDisplay ? null : renderSelectedPokemonQuickPanelView({ pricingEnabled, selectedComparisonMarketGbp: selectedComparisonPrice?.marketGbpAmount ?? selectedComparisonPrice?.gbpAmount ?? null, selectedUsesSoldGuide, onSelectedSoldCheck, activeJumpPokemonList, binderCardDisplay, closeSelectedPokemon, collected, collectionItem, handleJumpToNextNeeded, handleJumpToPreviousNeeded, handleOpenCardSelector, handleOpenSelectedSlotScanner, handleOpenWishlistSelector, handleQuickCollectSelectedPokemon, handleChangeWantedCard, handleClearWantedCard, handleSelectedCardFinishChange, handleToggleFavoriteSelectedPokemon, isDesktopViewport, isLoadingPrices, isMobileQuickPanel, isQuickPanelCovered, isSearchOpen, openCardBrowser, openIllustratorBrowser, priceFormat, pricesByCardId, quickPanelPosition, quickPanelRef, quickPanelSwipe, readOnlyMode, requestOwnedRemoval, selectedAssignedPriceChipLabel, selectedCollectedDateLabel, selectedConfidenceLabel, selectedCurrentCardPreview, selectedDetailPriceLabel, selectedDetailPriceSnapshot, selectedFinishPrices, selectedGoodPriceLabel, selectedHasWantedCard, selectedIllustratorArrivedLate, selectedIllustratorLookupKey, selectedIllustratorName, selectedIllustratorState, selectedMarketPriceLabel, selectedPokemon, selectedPokemonDisplayFit, selectedPokemonDisplayImage, selectedPokemonDisplayName, selectedPokemonDisplayTone, selectedPokemonHasAssignedCard, selectedPokemonIsFavorite, selectedPriceSourceLabel, selectedPrimaryCardPreview, selectedRangePriceLabel, selectedWantedCardPreview, selectedWantedCards })

  const renderMobileSlotActionBar = () => renderMobileSlotActionBarView({ closeMobileActions, getCollectionItem, handleQuickCollect, handleToggleFavorite, isCollected, longPressedPokemon, mobileActionsRef, mobileActionsSwipe, openCardBrowser, openCardSelectorForPokemon, readOnlyMode, requestOwnedRemoval, setLongPressedPokemon, setSelectedPokemon })

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isSearchOpen) return
      if (e.key === "ArrowLeft") {
        if (isSpreadLayout) {
          goToPrevSpread()
        } else {
          goToPrevPage()
        }
      }
      if (e.key === "ArrowRight") {
        if (isSpreadLayout) {
          goToNextSpread()
        } else {
          goToNextPage()
        }
      }
      if (e.key === "Escape") {
        setSelectedPokemon(null)
        setLongPressedPokemon(null)
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [goToNextPage, goToNextSpread, goToPrevPage, goToPrevSpread, isSearchOpen, isSpreadLayout])

  useEffect(() => {
    if (!longPressedPokemon || !isDesktopViewport) return
    const handleClick = () => setLongPressedPokemon(null)
    const timer = setTimeout(() => window.addEventListener("click", handleClick), 0)
    return () => { clearTimeout(timer); window.removeEventListener("click", handleClick) }
  }, [isDesktopViewport, longPressedPokemon])

  useEffect(() => {
    if (!isDesktopActionsOpen) return

    const handleClick = () => {
      setIsDesktopActionsOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsDesktopActionsOpen(false)
      }
    }

    setTimeout(() => window.addEventListener("click", handleClick), 0)
    window.addEventListener("keydown", handleKeyDown)

    return () => {
      window.removeEventListener("click", handleClick)
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [isDesktopActionsOpen])

  const renderSpreadInfoPage = (side: "left" | "right") => renderSpreadInfoPageView({ native: nativeCoverStats ? { name: stagedSlotDisplay!.inventory.collections.find(c => c.id === stagedSlotDisplay!.binder.collectionId)?.name, slotCount: stagedSlotDisplay!.binder.slots.length } : undefined, activeCollectionFilterOption, collectionStats: nativeCoverStats ?? collectionStats, neededCount: nativeCoverStats?.needed ?? neededPokemonList.length, perfectCount: nativeCoverStats?.perfect ?? favoritePokemonList.length, canEditBinder: browserSurface?.editingAvailable ?? canEditBinder, filteredPokemonList, filteredTotalLabel, getBinderThemeForPage, hasTrackedCards, selectedGen, settings, totalBinderPages }, side)

  const renderSpreadBlankPage = (side: "left" | "right") => renderSpreadBlankPageView({ getBinderThemeForPage }, side)

  const slotActions = useBinderSlotActions({ currentBinderPage, handleLongPress, handleQuickCollect, handleSlotClick, handleToggleFavorite, openCardSelectorForPokemon, registerSlotButtonRef, setCurrentBinderPage, setLongPressedPokemon })
  const renderBinderGridPage = (pageNumber: number, side: "left" | "right") => orderedDisplaySlots?.length === 0 ? <div role="status" className="flex h-full items-center justify-center rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">No slots in this binder</div> : renderBinderGridPageView({ displaySlots: getDisplayPageSlots, slotInteractionKey: `${layoutScopeKey}:${layoutSession?.id ?? "browse"}`, selectedSlotId: selectedSlotId ?? browserSurface?.surface.collection?.highlight?.slotId,
    onSelectSlot: editingLayout ? (id: string) => layoutTap.current?.(id) : setSelectedSlotId, layoutMarks: editingLayout ? layoutMarks : undefined,
    onSlotMenu: layoutBoundary ? (slotId: string, point: { x: number; y: number }) => setPocketMenu({ slotId, point }) : undefined, binderSlotImageSizes, binderCardDisplay, cardFinishEffectStyle, cardFinishGlint, currentBinderPage, getBinderThemeForPage, getCollectionItem, getPageSlots, getSlotCardImage, isCollected, isDesktopViewport, isPriceMode, isSpreadLayout, longPressedPokemon, priceFormat, pricesByCardId, readOnlyMode, selectedPokemon, settings: binderEffectSettings, slotActions, slotGlareOverlayStyle, user }, pageNumber, side)

  const handleShareWantedList = async (scope: "binder" | "all" | WantedDashboardCard[] = "binder") => {
    if (!billing.premium) { requestUpgrade(); return }
    // The signed-in want list hands over its own cards, as currently searched, filtered and sorted.
    const cards = Array.isArray(scope) ? scope : wantedDashboard.cards
    const text = buildWantedListText(cards, (card) => priceFormat.amount(card.effectiveGbpAmount, card.price))
    // Phones get the share sheet (Messages, WhatsApp, Notes); everywhere else the list is copied.
    const isTouch = window.matchMedia?.("(pointer: coarse)").matches
    if (isTouch && typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "Want list", text })
        return
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return
      }
    }
    try {
      await navigator.clipboard.writeText(text)
      toast("Want list copied")
    } catch {
      toast("Could not copy the want list", "error")
    }
  }

  const jumpToWantedPokemonPage = (pokemon: PokemonSummary | null) => {
    if (!pokemon) return
    if (publicIndex) return handlePokemonSelect(pokemon)
    const pokemonIndex = pokemonList.findIndex((entry) => entry.id === pokemon.id)
    if (pokemonIndex < 0) return

    const page = Math.ceil((pokemonIndex + 1) / slotsPerPage)
    setActiveMainView("binder")
    handlePokemonSelect(pokemon)
    navigateToPage(page, page > currentBinderPage ? "left" : "right")
  }


  const binderDisplayControls = (
    <div role="group" aria-label="Binder display" className={dashboardStyles.toggle}>
      <button type="button" aria-pressed={binderDimension === "2d"} onClick={() => setBinderDimension("2d")}>2D</button>
      <button type="button" aria-pressed={binderDimension === "3d"} onClick={() => { closeAllOverlays(); setSelectedPokemon(null); setBinderDimension("3d") }}>3D</button>
    </div>
  )
  const binderCardControls = (
    <div role="group" aria-label="Binder cards" className={dashboardStyles.toggle}>
      <button type="button" aria-pressed={binderCardDisplay === "mixed"} onClick={() => setBinderCardDisplay("mixed")}>Mixed</button>
      <button type="button" aria-pressed={binderCardDisplay === "current"} onClick={() => setBinderCardDisplay("current")}>Owned</button>
      <button type="button" aria-pressed={binderCardDisplay === "wanted"} onClick={() => setBinderCardDisplay("wanted")}>Wanted</button>
    </div>
  )

  // Native storage swaps List for Inventory in both the header and the dock.
  const inventoryNavigation = browserSurface ? { active: browserSurface.surface.state.main === "inventory" && activeMainView === "binder", open: browserSurface.surface.onInventory, binderOpen: nativeBinderOpen,
    collectionActive: browserSurface.surface.state.main === "collection" && (activeMainView === "binder" || activeMainView === "list") } : undefined
  const renderAppHeader = () => renderAppHeaderView({ inventoryNavigation, activeBinder: browserSurface ? null : activeBinder, nativeStorage: Boolean(browserSurface), canManageShare, onNationalDex: browserSurface?.surface.onDex, activeJumpLabel, activeJumpPokemonList, activeMainView, binderCardControls, binderDimension, binderDisplayControls, binders, canFilterCollection, canGoToNextVisiblePage, canGoToPreviousVisiblePage, collectionCount, collectionStats, commitPageInput, currentBinderPage, fullShareUrl, goToNextPage, goToNextSpread, goToPrevPage, goToPrevSpread, handleCopyReadOnlyShareLink, handleEnableReadOnlyShare, handleInstallApp, handleJumpToNextNeeded, handleJumpToPreviousNeeded, handleSignOut: onBrowserSignOut ?? handleSignOut, installPromptEvent, isDarkMode, isDesktopActionsOpen, isInstalledApp, isMobileNavExpanded, isOnline, isSearchOpen, isShareEnabled, isShareLoading, isShowModeOn, isSpreadLayout, lastBrowseViewRef, onJoin: () => openExclusively(() => { setAuthInitialMode("sign-up"); setIsAuthOpen(true) }), openExclusively, openQuickMode, openSearch, pageInputValue, readOnlyMode: browserSurface ? legacyReadOnlyMode : readOnlyMode, setIsAuthOpen, setIsBinderSwitcherOpen, setIsDesktopActionsOpen, setIsMobileNavExpanded, setIsPartnerOpen, setIsSettingsOpen, setPageInputValue, setSelectedPokemon, setShowMode, shellNavRef, showTally, switchMainView, toggleDarkMode, totalBinderPages, user, visiblePageLabel })

  const renderMainContent = () => renderMainContentView({ listTitle: browserSurface ? "National Dex" : undefined, nativeSpecies: speciesCollection, nativeWanted: nativeConsumer ? <>
      <NativeWantedEntries presentation="wanted" binding={nativeConsumer} onCheck={nativeConsumer.openCard}
        pricing={pricingEnabled ? { region: pricingPreferences.region, formatAmount: priceFormat.amount } : undefined} onShare={cards => { void handleShareWantedList(cards) }} /></> : undefined, nativeBinderTotals: browserSurface && stagedSlotDisplay && pricingEnabled && settings.showBinderValue !== false ? <NativeBinderTotals analytics={browserSurface.analytics} collectionId={stagedSlotDisplay.binder.collectionId} pageItemIds={visiblePageItemIds} pageLabel={visiblePageLabel} region={pricingPreferences.region}
    priceMode={hasTrackedCards ? { on: isPriceMode, loading: isLoadingPrices, toggle: () => setIsPriceMode(on => !on) } : undefined}
    onOpen={() => { rememberBinderScope("analytics", "binder"); void switchMainView("analytics") }} onDismiss={() => { void updateSettings({ showBinderValue: false }) }} /> : undefined, nativeAnalytics: browserSurface ? <NativeCollectionAnalytics {...browserSurface.analytics} collectionId={browserSurface.surface.state.collectionId ?? undefined} region={pricingPreferences.region} /> : undefined, layoutToolbar: browserSurface && !editingLayout ? undefined : layoutToolbar, orderedDisplaySlots: orderedDisplayPages?.flat(), onSelectSlot: setSelectedSlotId, pricingEnabled, pendingBinderPage, cancelPageNavigation, onHideBinderValue: () => { void updateSettings({ showBinderValue: false }) }, assignWantedCard: requireAccount, activeJumpLabel, activeMainView, binderAppearance, binderCardDisplay, binderDimension, binderFitSize, binderPageRef, collection, collectionByPokemonId, collectionViewFilter, currentBinderPage, dashboardBinderDesign, displayedSpreadPages, filteredPokemonList, filteredPokemonSummaryList, filteredTotalLabel, handleClearWantedCard, handleCollectSetCard, handleCollectSetCards, handleGotWantedCard, handlePagePhotoSelected, handlePokemonSelect, handleWantedSelect, handleQuickCollect, handleSelectSetSlot, handleShareWantedList, handleSlotClick, handleToggleFavorite, handleWantSetCard, handleWantSetCards, hasTrackedCards, initialBinderId, isLoadingPrices, isOnline, isPriceMode, isSpreadLayout, jumpToWantedPokemonPage, mainViewRef, openCardBrowser, openCardSelectorForPokemon, openPriceLookup, ownedTotalLabel, ownedTrackedCards, pagePhotoInputRef, prefersReducedMotion, priceFormat, pricesByCardId, pricingPreferences, readOnlyMode, renderBinderGridPage, renderSpreadBlankPage, renderSpreadInfoPage, requestOwnedRemoval, resolvedCollectionOwnerUserId, setBinderStageRef, setCurrentBinderPage, setViewRequest, settings, switchMainView, user, viewLoadError, visiblePageLabel, visiblePagePriceSummary, visiblePageTotalLabel, wantedCardEntries, wantedDashboard, wantedModeCombinedPriceSummary, wantedModeCombinedTotalLabel, wantedTotalLabel })

  const renderSearchOverlay = () => renderSearchOverlayView({ nativeConsumer, history, binderCardDisplay, closeSearch, collected, currentPagePokemon: publicIndex ? publicIndex.pageSpecies(currentBinderPage) : currentPagePokemon, filteredPokemonList, getCardState: getQuickCardState, getOfflineSearchCards, getSearchResultMeta, handlePokemonSelect, handleSearchJumpToPage, isSearchOpen, openCardBrowser, openIllustratorBrowser, openQuickMode, openSetFromSearch, priceFormat, pricingPreferences, readOnlyMode, searchDialogRef, searchSwipe, selectedHasWantedCard, selectedPokemon, selectedPokemonDisplayFit, selectedPokemonDisplayImage, selectedPokemonDisplayName, selectedPokemonDisplayTone, selectedPrimaryCardPreview, setIsSearchOpen, totalBinderPages })

  const renderMobileNavMenu = () => renderMobileNavMenuView({ pricingEnabled, activeMainView, binderCardControls, binderDisplayControls, canFilterCollection, closeControlsSheet, collectionStats, collectionViewFilter, controlsSheetRef, controlsSheetSwipe, currentPagePokemon, handlePhotoButtonClick, hasTrackedCards, isCompactViewport, isDesktopViewport, isFilteredBinderLayout, isLoadingPrices, isMobileNavExpanded, isMobileSpreadPreview, isPriceMode, isSearchOpen, readOnlyMode, selectedGen, setCollectionViewFilter, setIsMobileNavExpanded, setIsMobileSpreadPreview, setIsPriceMode, setSelectedGen, switchMainView })


  const renderBottomNav = () => renderBottomNavView({ inventoryNavigation, activeMainView, closeControlsSheet, isMobileNavExpanded, isQuickModeOpen, isSearchOpen, isShowModeOn, lastBrowseViewRef, openExclusively, openQuickMode, openSearch, quickPressFiredRef, quickPressHandlers, setIsMobileNavExpanded, setSelectedPokemon, switchMainView })

  // eslint-disable-next-line react-hooks/refs -- the helper only passes refs through as `ref` props
  const legacyMainContent = renderMainContent()
  // eslint-disable-next-line react-hooks/refs -- the helper only passes refs through as `ref` props
  const legacyHeader = renderAppHeader()
  const legacySurface = (
    <BillingContext.Provider value={billing}>
    <CollectionActivityProvider nativeRecovery={browserSurface?.recovery} accountId={browserSurface?.recovery?.scope.actorUserId ?? (readOnlyMode ? null : user?.id ?? null)} ownerId={browserSurface?.recovery?.scope.ownerUserId ?? (readOnlyMode ? null : resolvedCollectionOwnerUserId)} binderId={initialBinderId} binders={binders} collection={collection} pendingCount={browserSurface?.pending ?? 0} isOnline={isOnline} onOpenPokemon={id=>{const pokemon=getPokemonSummary(id);if(pokemon)handlePokemonSelect(pokemon)}}>
    <main className={`${dashboardStyles.shell} relative flex h-[100dvh] max-h-[100dvh] w-full max-w-[100vw] touch-pan-y flex-col overflow-hidden overscroll-none bg-background select-none`}>
      <div
        aria-hidden="true"
        data-testid="status-bar-cover"
        className="pointer-events-none fixed inset-x-0 top-0 z-30 h-[var(--top-inset)] bg-background md:hidden"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-20 h-[env(safe-area-inset-bottom)] bg-background md:hidden"
      />


      {/* One compact connection chip (Show-style copy): offline (+ queued edits), queued edits syncing, or a rollback notice. */}
      {/* In Show mode the header carries offline/sync state; rollback notices float below its controls. */}
      {!isOnline ? (
        !isShowModeOn && (
          <TopBannerSlot>
            <div
              role="status"
              data-testid="connection-chip"
              data-connection="offline"
              className="flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-card/92 px-3 py-1.5 text-xs font-medium text-amber-600 shadow-[0_12px_32px_-20px_rgba(217,119,6,0.65)] backdrop-blur-xl dark:text-amber-300"
            >
              <WifiOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>Offline · using saved cards and prices</span>
            </div>
          </TopBannerSlot>
        )
      ) : null}

      {/* Glass Navigation */}
      {legacyHeader}
      {/* The same row on every view: binder picker first, that view's tools after. Pages carry their own title. */}
      {browserSurface && <div className="flex shrink-0 items-center gap-1 px-3 pb-1 sm:px-4 md:px-7">
        {browserSurface.toolbar}
        {browserSurface.surface.state.main === "collection" && browserSurface.surface.collection?.state.view === "binder"
          && activeMainView === "binder" && !legacyReadOnlyMode && !shareViewToken && !editingLayout && stagedSlotDisplay && stagedSlotCatalog && browserSurface.scan
          && collectionViewFilter === "all" && selectedGen === 0 && <NativeBinderScanner
            key={`${layoutScopeKey}:${currentBinderPage}`} available={browserSurface.scan.available && browserSurface.scan.rows === settings.binderRows && browserSurface.scan.cols === settings.binderCols} online={browserSurface.scan.online}
            admission={{ snapshot: stagedSlotDisplay.inventory, catalog: stagedSlotCatalog,
              view: { ownerUserId: stagedSlotDisplay.inventory.ownerUserId, collectionId: stagedSlotDisplay.binder.collectionId,
                sessionId: browserSurface.scan.sessionId, rows: browserSurface.scan.rows ?? settings.binderRows, cols: browserSurface.scan.cols ?? settings.binderCols,
                pageSlotIds: stagedSlotDisplay.binder.slots.slice((currentBinderPage - 1) * slotsPerPage, currentBinderPage * slotsPerPage).map(s => s.id) },
              detectPage: browserSurface.scan.detectPage, getOfflineCards: browserSurface.scan.getOfflineCards, onCommandIntent: browserSurface.scan.receive }} />}
        {!editingLayout && layoutToolbar}
        {browserSurface.storageMenu}
      </div>}
      {browserSurface?.surface.state.main === "collection" && browserSurface.surface.collection?.state.view === "binder"
        && activeMainView === "binder" && stagedSlotDisplay && !editingLayout && <CollectionFilterBar value={collectionViewFilter} onChange={setCollectionViewFilter} />}
      {browserHeader}
      {isInstalledApp && isShowModeOn && user && !readOnlyMode && <PartnerPushPrompt userId={user.id} onOpen={() => openExclusively(() => { setPushSettingsRequested(true); setIsSettingsOpen(true) })} />}

      {browserSurface && activeMainView === "binder" && (browserSurface.surface.state.main === "inventory" || browserSurface.surface.collection?.state.view === "slabs")
        ? <div id="collection-browser-scroll" className="min-h-0 flex-1 overflow-y-auto pb-[var(--dock-clearance)]">{browserSurface.surface.content}</div>
         : browserSurface?.surface.state.main === "collection" && activeMainView === "list" && orderedDisplaySlots
          ? <CollectionSlotList slots={orderedDisplaySlots} search={browserSurface.surface.collection?.state.search ?? ""}
              onSearch={search => browserSurface.surface.collection?.onChange({ search, scroll: 0 })} onSelect={setSelectedSlotId}
              highlight={browserSurface.surface.collection?.highlight?.slotId} />
         : browserSurface?.surface.state.main === "collection" && !stagedSlotDisplay
          ? <p role="status">Ordered pages unavailable on this device. Open Inventory or National Dex.</p>  : legacyMainContent}

      {/* eslint-disable-next-line react-hooks/refs -- the helper only passes refs through as `ref` props */}
      {renderSelectedPokemonQuickPanel()}
      {/* eslint-disable-next-line react-hooks/refs -- the helper only passes refs through as `ref` props */}
      {renderMobileSlotActionBar()}

      {isQuickModeOpen && (
        <QuickMode
          nativeConsumer={nativeConsumer}
          offlineBinder={{ collection, scope: { ownerUserId: resolvedCollectionOwnerUserId ?? null, binderId: initialBinderId, isDefault: activeBinder?.isDefault !== false } }}
          history={history}
          onClose={closeQuickMode}
          onNavigate={onQuickNavigate}
          onSelectPokemon={onQuickSelectPokemon}
          onSelectCard={onQuickSelectCard}
          onBrowseIllustrator={onQuickBrowseIllustrator}
          onBrowseSet={openSetFromSearch}
          getOfflineCards={getOfflineSearchCards}
          getPokemonState={getQuickPokemonState}
          formatPrice={priceFormat.label}
          pricingRegion={pricingPreferences.region}
          isOnline={isOnline}
          hiddenDestinations={quickHiddenDestinations}
          showModeOn={isShowModeOn}
          cardCheck={quickCardCheck}
          showTools={isShowModeOn || Boolean(quickLookup)}
          cardStanding={quickCardStanding}
          initialQuery={quickLookup?.query}
          lookupOnly={!isShowModeOn && Boolean(quickLookup)}
        />
      )}

      {/* eslint-disable-next-line react-hooks/refs -- the helper only passes refs through as `ref` props */}
      {renderSearchOverlay()}

      {/* eslint-disable-next-line react-hooks/refs -- the helper only passes refs through as `ref` props */}
      {renderMobileNavMenu()}

      {/* eslint-disable-next-line react-hooks/refs -- the helper only passes refs through as `ref` props */}
      {renderBottomNav()}

      {/* Modals */}
      <SettingsModal
        binderId={shareBinderId}
        binderName={browserSurface ? shareTarget?.name : activeBinder?.name}
        onPublicIdentityChange={handlePublicIdentityChange}
        initialTab={pushSettingsRequested ? "account" : undefined}
        backupReady={!readOnlyMode && !binderAppearance.loading}
        onDownloadBackup={async () => {
          if (readOnlyMode) throw new Error("Backups are only available in your own binder.")
          const backup = await createBinderBackup({
            binderId: initialBinderId, binder: activeBinder, collection, settings,
            design: dashboardBinderDesign, uploads: binderAppearance.uploads,
          })
          downloadBinderBackup(backup)
          return backup.missingArtwork.length > 0
            ? "Download started. Some cover artwork is unavailable on this device and is listed as missing in the backup."
            : "Download started. Keep this file somewhere safe."
        }}
        appearance={binderAppearance.hasSavedDesign ? binderAppearance.design : undefined}
        isOpen={isSettingsOpen}
        onClose={() => { setIsSettingsOpen(false); setPushSettingsRequested(false) }}
        user={user}
        settings={settings}
        onUpdateSettings={updateSettings}
        currentBinderPage={currentBinderPage}
        totalBinderPages={totalBinderPages}
        currentPageBinderColorId={currentPageBinderColorId}
        onSetGlobalBinderColor={handleSetGlobalBinderColor}
        onSetCurrentPageBinderColor={handleSetCurrentPageBinderColor}
        onSetBinderColorForPageRange={handleSetBinderColorForPageRange}
        onClearCurrentPageBinderColor={handleClearCurrentPageBinderColor}
        isDarkMode={isDarkMode}
        onToggleDarkMode={toggleDarkMode}
        isSignedIn={Boolean(user)}
        isOnline={isOnline}
        isInstalledApp={isInstalledApp}
        canInstallApp={canInstallApp}
        pwaStatusMessage={pwaStatusMessage}
        onInstallApp={handleInstallApp}
        isReadOnlyView={readOnlyMode}
        isAccountReadOnly={accountSettingsReadOnly}
        canManageShare={canManageShare}
        sharePath={sharePath}
        shareShowPrices={shareShowPrices}
        onShareShowPricesChange={value => { void handleEnableReadOnlyShare(value) }}
        isShareEnabled={isShareEnabled}
        isShareLoading={isShareLoading}
        onEnableReadOnlyShare={() => { void handleEnableReadOnlyShare() }}
        onDisableReadOnlyShare={handleDisableReadOnlyShare}
        trackedCardCount={trackedPriceLookups.length}
        isRefreshingPrices={isRefreshingPrices}
        priceRefreshMessage={priceRefreshMessage}
        onRefreshPrices={handleRefreshPrices}
        motionGlintStatus={motionGlintStatus}
        motionGlintMessage={motionGlintMessage}
        onRequestMotionGlint={handleRequestMotionGlint}
      />
      <AuthModal isOpen={isAuthOpen} initialMode={authInitialMode} onClose={() => { setIsAuthOpen(false); setAuthInitialMode("sign-in") }} />
      {isBinderSwitcherOpen && activeBinder && (
        <BinderSwitcherSheet
          binders={binders}
          activeBinderId={activeBinder.id}
          canManage={!readOnlyMode && Boolean(user)}
          isOnline={isOnline}
          offlineBinderIds={isOnline ? undefined : offlineAvailableBinderIds(window.localStorage, resolvedCollectionOwnerUserId, binders)}
          onSwitch={switchBinder}
          onBindersChange={setBinders}
          onClose={closeBinderSwitcher}
        />
      )}
      {isPartnerOpen ? (
        <PartnerModal isOpen={isPartnerOpen} onClose={() => setIsPartnerOpen(false)} user={user} />
      ) : null}

      {nativeLookup && hasNativeConsumer && <PokemonCardsBrowser
        key={`${nativeLookup.card.id}:${nativeLookup.card.language}:${nativeLookup.finish ?? ""}`} nativeConsumer={nativeConsumer} pokemon={null}
        pricingEnabled={pricingEnabled} highlightCardId={nativeLookup.card.id}
        // A want's own finish when it came from a want; otherwise the finish this printing usually comes in.
        cardDetails={{ card: nativeLookup.card, finish: nativeLookup.finish ?? inferCardFinish(nativeLookup.card.rarity, nativeLookup.card.variants), getState: () => ({ owned: false, wanted: false }),
          onAction: async () => {}, onRemoveOwned: () => {}, onJumpToSlot: () => {} }}
        isDesktop={isDesktopViewport} readOnly={nativeReadOnly} onClose={() => setNativeLookup(null)}
        formatPrice={priceFormat.label} pricingRegion={pricingPreferences.region} />}
      {cardBrowser ? (
        <PokemonCardsBrowser
          nativeConsumer={nativeConsumer}
          pricingEnabled={pricingEnabled}
          key={`${cardBrowser.pokemon.id}:${cardBrowser.highlightCardId ?? ""}`}
          pokemon={cardBrowser.pokemon}
          highlightCardId={cardBrowser.highlightCardId}
          cardDetails={cardBrowser.focusedCard ? {
            card: cardBrowser.focusedCard,
            finish: cardBrowser.finish ?? "normal",
            getState: finish => getQuickCardState(cardBrowser.focusedCard!, cardBrowser.pokemon, finish),
            onAction: requireAccount,
            onRemoveOwned: () => {
              closeAllOverlays()
              setCardBrowser(null)
              requestOwnedRemoval(cardBrowser.pokemon)
            },
            onJumpToSlot: finish => {
              const pokemon = getPokemonSummary(cardBrowser.pokemon.id)
              if (!pokemon) return
              const wanted = getCollectionItem(pokemon.id)?.wanted_cards.find(card => matchesCatalogCardId(cardBrowser.focusedCard!, card.card_id) && (card.card_language ?? "en") === (cardBrowser.focusedCard?.language ?? "en") && (card.card_finish ?? "normal") === finish)
              closeAllOverlays()
              setCardBrowser(null)
              handlePokemonSelect(pokemon)
              if (wanted) setWantedDetail({ pokemonId: pokemon.id, card: wanted })
            },
          } : undefined}
          collectionItem={getCollectionItem(cardBrowser.pokemon.id) ?? null}
          isDesktop={isDesktopViewport}
          readOnly={nativeReadOnly}
          onClose={closeCardBrowser}
          onWantCard={readOnlyMode ? undefined : requireAccount}
          onAddCard={readOnlyMode ? undefined : requireAccount}
          formatPrice={priceFormat.label}
          pricingRegion={pricingPreferences.region}
        />
      ) : null}

      {illustratorBrowser ? (
        <IllustratorCardsBrowser
          pricingEnabled={pricingEnabled}
          key={illustratorBrowser.name}
          illustrator={illustratorBrowser.name}
          collection={illustratorCollection}
          isDesktop={isDesktopViewport}
          pricingRegion={pricingPreferences.region}
          formatPrice={priceFormat.label}
          onOpenCard={openIllustratorCard}
          onClose={closeIllustratorBrowser}
        />
      ) : null}

      {selectedDisplaySlot && !editingLayout && <NativeSlotFlow pricing={{ defaultCardLanguage: pricingPreferences.cardLanguage, pricingRegion: pricingPreferences.region, formatAmount: priceFormat.amount }} key={`${stagedSlotSessionId}:${user?.id}:${stagedSlotDisplay?.inventory.ownerUserId}:${stagedSlotDisplay?.binder.collectionId}:${selectedDisplaySlot.id}`} slot={selectedDisplaySlot} onClose={closeSlotDetail}
        priceLabel={selectedDisplayPriceLookup ? priceFormat.label(pricesByCardId[getCardPriceKey(selectedDisplayPriceLookup.cardId, selectedDisplayPriceLookup.language)]) : null}
        picker={slotPickerBoundary(selectedDisplaySlot.id)}
        host={{ onOpenWant: hasNativeConsumer ? openWantedCard : undefined,
          // Saved prices for the owner's own cards; a share shows only the figure its owner opted in to.
          pricing: !shareViewToken && !publicIndex && pricingEnabled ? { region: pricingPreferences.region, formatAmount: priceFormat.amount, formatRange: priceFormat.range } : undefined,
          onAllCards: (pokemon, cardId) => openCardBrowser(pokemon, { highlightCardId: cardId, fromDetail: true }),
          onIllustrator: name => openIllustratorBrowser(name, { fromDetail: true }),
          onArrange: layoutBoundary ? () => startLayoutEditing({ ids: [selectedDisplaySlot.id], moving: false }) : undefined }} />}
      {pocketMenuSlot && pocketMenu && <PocketMenu key={pocketMenu.slotId} slot={pocketMenuSlot} place={slotPlace(pocketMenuSlot.id) ?? ""} point={pocketMenu.point}
        picker={editingLayout ? undefined : slotPickerBoundary(pocketMenuSlot.id)} layout={layoutBoundary} selected={editingLayout && layoutMarks.ids.has(pocketMenuSlot.id)}
        onClose={() => setPocketMenu(null)}
        onOpen={() => { const id = pocketMenuSlot.id; setPocketMenu(null); if (editingLayout) setLayoutSession(null); setSelectedSlotId(id) }}
        onSelect={() => { const id = pocketMenuSlot.id; setPocketMenu(null); if (editingLayout) layoutTap.current?.(id); else startLayoutEditing({ ids: [id], moving: false }) }}
        onMove={() => startLayoutEditing({ ids: [pocketMenuSlot.id], moving: true })} />}

      <footer className="hidden shrink-0 border-t border-border/20 bg-background/80 px-4 py-1 text-center text-[9px] leading-snug text-muted-foreground/60 md:block safe-area-bottom">
        <CardDataAttribution compact />
      </footer>
    </main>
    </CollectionActivityProvider>
    </BillingContext.Provider>
  )
  return legacySurface

}
