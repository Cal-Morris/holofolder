"use client"

import dynamic from "next/dynamic"

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
export const CardSelector = dynamic(() => import("@/components/card-selector"), { ssr: false })
export const PokemonCardsBrowser = dynamic(() => import("@/components/pokemon-cards-browser"), { ssr: false })
export const IllustratorCardsBrowser = dynamic(() => import("@/components/illustrator-cards-browser"), { ssr: false })
// `loading` gives these their own Suspense boundary. Without it, next/dynamic (with SSR) has
// none, so the first switch to List or Sets suspended the whole shell and hid the dock.
export const DexListView = dynamic(() => import("@/components/dex-list-view"), { loading: () => null })
export const CollectionAnalyticsView = dynamic(() => import("@/components/collection-analytics-view"), { loading: () => null })
export const SetPopulationView = dynamic(() => import("@/components/set-population-view"), { loading: () => null })
export const WantedDashboard = dynamic(() => import("@/components/wanted-dashboard"), { loading: () => null })
// The camera scanner only mounts while it is open, so its capture code loads on first use.
export const PageScanner = dynamic(() => import("@/components/page-scanner"), { ssr: false })
export const QuickMode = dynamic(() => import("@/components/quick-mode"), { ssr: false })
export const PokemonBrowseView = dynamic(() => import("@/components/pokemon-browse-view"), { loading: () => null })
