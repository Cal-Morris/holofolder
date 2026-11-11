"use client"

import dynamic from "next/dynamic"

// Loaders shared by the dynamic views below and the preload helpers at the end of this file.
// With Turbopack, an inline import() inside dynamic() gets its own chunk copy, so a separate
// import() elsewhere wouldn't warm it. Sharing one loader means a preload is the same fetch
// the view makes on first render.
const loadCardSelector = () => import("@/components/card-selector")
const loadNativeSlotFlow = () => import("@/components/binder/native-slot-flow")
const loadDexListView = () => import("@/components/dex-list-view")
const loadCollectionAnalyticsView = () => import("@/components/collection-analytics-view")
const loadSetPopulationView = () => import("@/components/set-population-view")
const loadWantedDashboard = () => import("@/components/wanted-dashboard")
const loadPokemonBrowseView = () => import("@/components/pokemon-browse-view")

// Modals and secondary views are only shown on demand or in non-default tabs, so they
// load in their own chunks instead of the main bundle. CardPriceEvidence stays a static
// import: it renders inside the card detail sheet, and loading it late shifts the sheet's
// actions on phones. Its chart is the exception: it loads in its own chunk behind a
// placeholder of the same height (see card-price-evidence.tsx).
export const DashboardBinderPreview = dynamic(() => import("@/components/dashboard-binder-preview"), { ssr: false, loading: () => <p role="status" className="p-4 text-sm text-muted-foreground">Opening your binder…</p> })
export const SettingsModal = dynamic(() => import("@/components/settings-modal"), { ssr: false })
export const AuthModal = dynamic(() => import("@/components/auth-modal"), { ssr: false })
export const PartnerModal = dynamic(() => import("@/components/partner-modal"), { ssr: false })
export const BinderSwitcherSheet = dynamic(() => import("@/components/binder-switcher-sheet"), { ssr: false })
export const CardSelector = dynamic(loadCardSelector, { ssr: false })
// What a pocket tap opens (card details or the selector). Preloaded first below so the first tap doesn't wait on it.
export const NativeSlotFlow = dynamic(loadNativeSlotFlow, { ssr: false })
export const PokemonCardsBrowser = dynamic(() => import("@/components/pokemon-cards-browser"), { ssr: false })
export const IllustratorCardsBrowser = dynamic(() => import("@/components/illustrator-cards-browser"), { ssr: false })
// `loading` gives these their own Suspense boundary. Without it, next/dynamic (with SSR) has
// none, so the first switch to List or Sets suspended the whole shell and hid the dock.
export const DexListView = dynamic(loadDexListView, { loading: () => null })
export const CollectionAnalyticsView = dynamic(loadCollectionAnalyticsView, { loading: () => null })
export const SetPopulationView = dynamic(loadSetPopulationView, { loading: () => null })
export const WantedDashboard = dynamic(loadWantedDashboard, { loading: () => null })
// The camera scanner only mounts while it is open, so its capture code loads on first use.
export const QuickMode = dynamic(() => import("@/components/quick-mode"), { ssr: false })
export const PokemonBrowseView = dynamic(loadPokemonBrowseView, { loading: () => null })

// Preload helpers for the dock tabs. Each one calls the matching view's own loader, so its
// first render reuses the fetched chunk instead of waiting on the network. They only fetch
// code; the views render exactly as before.
export type PreloadableTab = "list" | "wanted" | "sets" | "pokemon" | "analytics"

const tabPreloaders: Record<PreloadableTab, () => Promise<unknown>> = {
  list: loadDexListView,
  wanted: loadWantedDashboard,
  sets: loadSetPopulationView,
  pokemon: loadPokemonBrowseView,
  analytics: loadCollectionAnalyticsView,
}
const preloadedTabs = new Set<string>()

function preloadOnce(key: string, load: () => Promise<unknown>) {
  if (preloadedTabs.has(key)) return
  preloadedTabs.add(key)
  // A failed fetch (offline, deploy in flight) is retried by the view's own import later.
  load().catch(() => { preloadedTabs.delete(key) })
}

export function preloadTabView(tab: PreloadableTab | string) {
  const load = tabPreloaders[tab as PreloadableTab]
  if (load) preloadOnce(tab, load)
}

export function preloadCardSelector() {
  preloadOnce("card-selector", loadCardSelector)
}

// Fetch the pocket detail, the dock-tab chunks and the card selector (what the first slot taps open) once the
// browser is idle after the binder has painted. Returns a cancel function for effect cleanup.
export function scheduleIdleViewPreload(): () => void {
  if (typeof window === "undefined") return () => undefined
  const queue: Array<() => void> = [
    () => preloadOnce("native-slot-flow", loadNativeSlotFlow),
    () => preloadTabView("list"),
    () => preloadTabView("sets"),
    () => preloadTabView("wanted"),
    () => preloadTabView("pokemon"),
    () => preloadTabView("analytics"),
    preloadCardSelector,
  ]
  let idleHandle: number | null = null
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null
  let cancelled = false
  // One chunk per idle slot keeps each callback short so it never competes with input.
  const runNext = () => {
    idleHandle = null
    timeoutHandle = null
    if (cancelled) return
    queue.shift()?.()
    if (queue.length > 0) schedule()
  }
  const schedule = () => {
    if (typeof window.requestIdleCallback === "function") idleHandle = window.requestIdleCallback(runNext, { timeout: 4000 })
    else timeoutHandle = setTimeout(runNext, 1500)
  }
  schedule()
  return () => {
    cancelled = true
    if (idleHandle !== null && typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(idleHandle)
    if (timeoutHandle !== null) clearTimeout(timeoutHandle)
  }
}
