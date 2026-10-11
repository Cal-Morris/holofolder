"use client"

import { useState, useMemo, useEffect, useRef, useCallback, type CSSProperties, type SyntheticEvent, type TouchEvent as ReactTouchEvent } from "react"
import dashboardStyles from "@/components/dashboard-binder-preview.module.css"
import { CardDataAttribution } from "@/components/card-data-attribution"
import { useRouter } from "next/navigation"
import dynamic from "next/dynamic"
import { createPortal } from "react-dom"
import { Moon, Sun, Settings, LogIn, LogOut, Grid3X3, Search as SearchIcon, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Users, Sparkles, Check, X, Star, Camera, Loader2, SlidersHorizontal, WifiOff, BookOpen, Heart, ListChecks, Layers3, MoreHorizontal, ArrowUpDown, ShoppingBag, Tag, Languages, Copy, Link2 } from "lucide-react"
import PokemonSearch, { type PokemonSearchResultMeta } from "@/components/pokemon-search"
import type { CardSelectorMode } from "@/components/card-selector"
import CardFinishShader from "@/components/card-finish-shader"
import { closeAllOverlays, useOverlay, useSwipeToDismiss } from "@/hooks/use-overlay"
import { CardPriceEvidence } from "@/components/card-price-evidence"
import { inferCardFinish } from "@/lib/pokemon-card-browse"
import { aggregateCardScanMatches, aggregatePageSlotScanMatches, type AggregatedCardScanMatch, type CardScanFrameMatch } from "@/lib/card-scan-matching"
import type { CardImageDescriptor } from "@/lib/card-image-match"
import { selectCandidateCardsForAssetTextOcr } from "@/lib/card-scan-candidate-text"
import { buildCardMetadataTextSignals, mergeCardTextSignals, type CardTextSignals } from "@/lib/card-scan-text"
import { rankAggregatedCardScanMatchesWithText } from "@/lib/card-scan-ranking"
import { getCardPriceKey, getPriceSourceLabel, useCardPrices, type CardPriceLookup, type CardPriceSnapshot, type SupportedCurrency } from "@/hooks/use-card-prices"
import { useCollection, type CardFinish, type CardLanguage, type SlotStatus, type WantedCard } from "@/hooks/use-collection"
import { useBinderAppearance } from "@/hooks/use-binder-appearance"
import { useSettings, type BinderSettings } from "@/hooks/use-settings"
import { useOfflineStoreSync } from "@/hooks/use-offline-store-sync"
import { getTouchGestureIntent, useTouchGestures } from "@/hooks/use-touch-gestures"
import { useTCGdex, type TCGCard } from "@/hooks/use-tcgdex"
import { Button } from "@/components/ui/button"
import { getBinderGridAspectRatio, scanBinderPageImage, type BinderPageScanResult } from "@/lib/binder-page-scan"
import { aggregateBinderPageScanResults, buildAggregatedBinderPageScanPreview } from "@/lib/binder-page-scan-aggregate"
import { aggregateBinderSlotSweep, getNextSweepSlotIndex, type BinderSlotSweepFrame } from "@/lib/binder-slot-sweep"
import { canAutoAcceptCardScanMatch } from "@/lib/card-scan-acceptance"
import { selectCardScanEvidenceImages, type CardScanImageCandidate } from "@/lib/card-scan-evidence"
import { POKEMON_CATALOG, formatPokemonDisplayName, ARTWORK_DETAIL_WIDTH, getOfficialArtworkUrl, getPokemonSummary, type PokemonSummary } from "@/lib/pokemon-catalog"
import { getBinderColorPreset, type BinderColorId } from "@/lib/binder-colors"
import { buildBinderShareUrl } from "@/lib/binder-share"
import { getBinderSlotQuickActions } from "@/lib/binder-slot-actions"
import { shouldClearSelectedPokemonForPage } from "@/lib/binder-selection-state"
import { getSelectedSlotCardDisplay } from "@/lib/selected-slot-card-display"
import { beginBinderCardSelection } from "@/lib/card-selector-selection-flow"
import { normalizeSlotPreviewImage, pickRepresentativeSlotPreviewCard, type SlotPreviewCard } from "@/lib/slot-preview-card"
import { getSettingsLocalCollectedCount } from "@/lib/settings-collection-sync"
import {
  OFFLINE_CACHE_WARMUP_MESSAGE_TYPE,
  buildOfflineCacheWarmupUrls,
  getOfflineCacheWarmupSignature,
  shouldPostOfflineCacheWarmup,
} from "@/lib/offline-cache-warmup"
import { buildPokemonSearchPreview } from "@/lib/pokemon-search-preview"
import {
  buildWantedDashboardSummary,
  sortWantedDashboardEntries,
  WANTED_PRICE_BAND_LABELS,
  type WantedDashboardPriceBandId,
  type WantedDashboardSort,
} from "@/lib/wanted-dashboard"
import type { TCGSetDexSlot, TCGSetSlotCard } from "@/lib/tcg-set-slots"
import type { User } from "@supabase/supabase-js"
import { registerServiceWorker } from "@/lib/service-worker-registration"
import { ADJACENT_PREFETCH_DELAY_MS, PAGE_TURN_EASING, getAdjacentPageNumbers, getPageTurnTiming } from "@/lib/binder-page-turn"

// Modals and secondary views are only shown on demand or in non-default tabs, so they
// load in their own chunks instead of the main bundle. CardPriceEvidence stays a static
// import: it renders inside the card detail sheet, and loading it late shifts the sheet's
// actions on phones.
const DashboardBinderPreview = dynamic(() => import("@/components/dashboard-binder-preview"), { ssr: false, loading: () => <p role="status" className="p-4 text-sm text-muted-foreground">Opening your binder…</p> })
const SettingsModal = dynamic(() => import("@/components/settings-modal"), { ssr: false })
const AuthModal = dynamic(() => import("@/components/auth-modal"), { ssr: false })
const PartnerModal = dynamic(() => import("@/components/partner-modal"), { ssr: false })
const CardSelector = dynamic(() => import("@/components/card-selector"), { ssr: false })
const PokemonCardsBrowser = dynamic(() => import("@/components/pokemon-cards-browser"), { ssr: false })
// `loading` gives these their own Suspense boundary. Without it, next/dynamic (with SSR) has
// none, so the first switch to List or Sets suspended the whole shell and hid the dock.
const DexListView = dynamic(() => import("@/components/dex-list-view"), { loading: () => null })
const SetPopulationView = dynamic(() => import("@/components/set-population-view"), { loading: () => null })

const GENERATIONS = [
  { id: 0, name: "All Generations", start: 1, end: 1025, region: "" },
  { id: 1, name: "Generation I", start: 1, end: 151, region: "Kanto" },
  { id: 2, name: "Generation II", start: 152, end: 251, region: "Johto" },
  { id: 3, name: "Generation III", start: 252, end: 386, region: "Hoenn" },
  { id: 4, name: "Generation IV", start: 387, end: 493, region: "Sinnoh" },
  { id: 5, name: "Generation V", start: 494, end: 649, region: "Unova" },
  { id: 6, name: "Generation VI", start: 650, end: 721, region: "Kalos" },
  { id: 7, name: "Generation VII", start: 722, end: 809, region: "Alola" },
  { id: 8, name: "Generation VIII", start: 810, end: 905, region: "Galar" },
  { id: 9, name: "Generation IX", start: 906, end: 1025, region: "Paldea" },
]

const TRADING_CARD_ASPECT_RATIO = 63 / 88
const TRADING_CARD_CORNER_RADIUS = "4.76% / 3.41%"
const TRADING_CARD_INNER_CORNER_RADIUS = "4% / 2.86%"
const BINDER_SPREAD_GAP_ASPECT_RATIO = 0.025
const GUIDED_SCAN_FRAME_COUNT = 16
const GUIDED_SCAN_FRAME_DELAY_MS = 800
const GUIDED_SCAN_SLOT_VOTE_RATIO = 0.45
const GUIDED_SCAN_MIN_USABLE_FRAMES = 2
const SLOT_SWEEP_FRAME_COUNT = 8
const SLOT_SWEEP_FRAME_DELAY_MS = 360
const SLOT_SWEEP_MIN_USABLE_FRAMES = 2
const PAGE_SCAN_OCR_BASE_CROP_LIMIT = 2
const PAGE_SCAN_OCR_AMBIGUOUS_CROP_LIMIT = 4
const PAGE_SCAN_CANDIDATE_ASSET_OCR_LIMIT = 18
const GUIDE_FRAME_INSET_X = 0.12
const GUIDE_FRAME_INSET_Y = 0.05
const SLOT_SWEEP_GUIDE_INSET_X = 0.14
const SLOT_SWEEP_GUIDE_INSET_Y = 0.08
const BINDER_PAGE_QUERY_PARAM = "page"
const THEME_COLOR_LIGHT = "#f2f5fb"
const THEME_COLOR_DARK = "#171a22"
type SlotGlareState = {
  offsetX: number
  offsetY: number
  angle: number
  opacity: number
}

type MotionGlintStatus = "disabled" | "needs-permission" | "requesting" | "active" | "fallback" | "denied" | "unsupported"
type PageScannerMode = "slot-sweep" | "page-sweep"
type WantedExplorerFilter =
  | { kind: "all"; label: string }
  | { kind: "band"; label: string; value: WantedDashboardPriceBandId }
  | { kind: "set"; label: string; value: string }
  | { kind: "language"; label: string; value: string }
  | { kind: "finish"; label: string; value: string }

const DEFAULT_SLOT_GLARE_STATE = {
  offsetX: -24,
  offsetY: -18,
  angle: -26,
  opacity: 1,
} satisfies SlotGlareState

function clampGlareValue(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function getSlotGlareState(offsetX: number, offsetY: number, angle: number, opacity = 1): SlotGlareState {
  return { offsetX, offsetY, angle, opacity }
}

type DeviceOrientationPermissionState = "granted" | "denied"

type DeviceOrientationWithPermission = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<DeviceOrientationPermissionState>
}

type DeviceMotionWithPermission = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<DeviceOrientationPermissionState>
}
type CollectionViewFilter = "all" | "needed" | "wanted" | "upgradeable" | "favorite"
type ActiveMainView = "binder" | "list" | "wanted" | "sets"

const COLLECTION_VIEW_FILTERS: Array<{
  id: CollectionViewFilter
  label: string
  mobileLabel: string
  description: string
}> = [
  { id: "all", label: "All", mobileLabel: "All", description: "Show the full binder, including empty, upgradeable, and perfect slots." },
  { id: "needed", label: "Need", mobileLabel: "Need", description: "Only show slots that still need collecting." },
  { id: "wanted", label: "Wanted", mobileLabel: "Wanted", description: "Only show slots with cards on the want list." },
  { id: "upgradeable", label: "Upgrades", mobileLabel: "Upgrades", description: "Show collected slots that are not marked perfect yet." },
  { id: "favorite", label: "Perfect", mobileLabel: "Perfect", description: "Show slots that are done and marked as the perfect card." },
]

const WANTED_SORT_OPTIONS: Array<{ id: WantedDashboardSort; label: string; mobileLabel: string }> = [
  { id: "highest", label: "Highest first", mobileLabel: "High" },
  { id: "unpriced", label: "Unpriced", mobileLabel: "Unpriced" },
  { id: "newest", label: "Newest", mobileLabel: "New" },
  { id: "lowest", label: "Lowest first", mobileLabel: "Low" },
  { id: "set", label: "Set", mobileLabel: "Set" },
  { id: "dex", label: "Dex", mobileLabel: "Dex" },
]

const WANTED_PRICE_BAND_STYLES: Record<WantedDashboardPriceBandId, {
  bar: string
  dot: string
  chip: string
}> = {
  "under-5": {
    bar: "bg-emerald-500",
    dot: "bg-emerald-500",
    chip: "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  "five-to-15": {
    bar: "bg-sky-500",
    dot: "bg-sky-500",
    chip: "border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  },
  "fifteen-to-50": {
    bar: "bg-violet-500",
    dot: "bg-violet-500",
    chip: "border-violet-500/20 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  },
  "over-50": {
    bar: "bg-rose-500",
    dot: "bg-rose-500",
    chip: "border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  },
  unpriced: {
    bar: "bg-slate-400",
    dot: "bg-slate-400",
    chip: "border-slate-500/20 bg-slate-500/10 text-slate-600 dark:text-slate-300",
  },
}

type PageScanSummary = {
  detectedOccupied: number
  newCollected: number
  alreadyCollected: number
  matchedCards: number
  cardMatches: PageScanCardMatchSummary[]
  page: number
}

type PageScanCardMatchSummary = {
  slotIndex: number
  slotLabel: string
  cardId: string
  cardName: string
  setName: string
  cardImage?: string
  similarity: number
  confidence: number
  margin: number
  appearanceRatio: number
}

type QuickPanelPosition = {
  top: number
  left: number
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>
}

type DisplaySpreadPage =
  | { kind: "info"; side: "left" | "right" }
  | { kind: "blank"; side: "left" | "right" }
  | { kind: "binder"; pageNumber: number; side: "left" | "right" }

interface InitialCollectionRow {
  id: string
  pokemon_id: number
  pokemon_name: string
  card_id?: string
  card_name?: string
  card_image?: string
  card_set?: string
  card_language?: CardLanguage
  card_finish?: CardFinish
  wanted_cards?: WantedCard[]
  status: SlotStatus
  collected_at: string
}

interface BinderAppProps {
  initialUser: User | null
  initialCollection: InitialCollectionRow[]
  initialCollectionOwnerUserId: string | null
  initialSettings: BinderSettings
  initialHasStoredSettings?: boolean
  initialDarkMode: boolean
  initialPriceMode?: boolean
  readOnlyMode?: boolean
  shareViewToken?: string | null
}

function getPokemonArtwork(pokemon: PokemonSummary) {
  return pokemon.sprites.other["official-artwork"].front_default
}

// The detail sheet shows the artwork larger than a binder slot.
function getDetailArtwork(pokemon: PokemonSummary, cardImage?: string | null) {
  return cardImage || getOfficialArtworkUrl(pokemon.id, ARTWORK_DETAIL_WIDTH)
}

function getPokemonOfficialArtworkUrl(pokemonId: number) {
  return getOfficialArtworkUrl(pokemonId)
}

function getUsableImageSource(value?: string | null) {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed || trimmed === "null" || trimmed === "undefined") return null
  return trimmed
}

/** The image URL a binder slot renders: its card image, else the Pokémon artwork at grid size. */
function resolveSlotImageUrl(pokemonId: number, cardImage?: string | null) {
  return getUsableImageSource(cardImage) || getPokemonOfficialArtworkUrl(pokemonId)
}

function getDisplayArtworkFit(cardImage?: string | null) {
  return "object-contain"
}

function getDisplayArtworkTone(status?: SlotStatus) {
  return status === "wishlisted" ? "grayscale saturate-[0.8] brightness-[0.92]" : ""
}

function getCardPreviewPose(seed: number) {
  const rotate = (((seed * 37) % 100) / 100 - 0.5) * 0.9
  const skewX = (((seed * 53) % 100) / 100 - 0.5) * 0.35
  const translateX = (((seed * 61) % 100) / 100 - 0.5) * 1.1
  const translateY = (((seed * 71) % 100) / 100 - 0.5) * 0.9
  const scale = 1.048 + (((seed * 29) % 100) / 100) * 0.016

  return `translate(${translateX.toFixed(2)}%, ${translateY.toFixed(2)}%) rotate(${rotate.toFixed(2)}deg) skewX(${skewX.toFixed(2)}deg) scale(${scale.toFixed(3)})`
}

function hashSlotValue(seed: number, salt: number) {
  const value = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453
  return value - Math.floor(value)
}

function getSlotFinishGlint(baseGlint: { x: number; y: number; angle: number }, seed: number) {
  const xMotionScale = 0.72 + hashSlotValue(seed, 1) * 0.64
  const yMotionScale = 0.78 + hashSlotValue(seed, 2) * 0.52
  const angleMotionScale = 0.82 + hashSlotValue(seed, 3) * 0.42
  const xOffset = hashSlotValue(seed, 4) * 0.2 - 0.1
  const yOffset = hashSlotValue(seed, 5) * 0.18 - 0.09
  const angleOffset = hashSlotValue(seed, 6) * 32 - 16
  const phase = hashSlotValue(seed, 7) * 5.8
  const patternSeed = seed * 0.017 + hashSlotValue(seed, 8) * 17
  const intensity = 0.86 + hashSlotValue(seed, 9) * 0.32
  const hueOffset = hashSlotValue(seed, 10) * 0.22 - 0.11
  const patternScale = 0.82 + hashSlotValue(seed, 11) * 0.42
  const centeredX = baseGlint.x - 0.5
  const centeredY = baseGlint.y - 0.5

  return {
    x: clampGlareValue(0.5 + centeredX * xMotionScale + xOffset, 0.04, 0.96),
    y: clampGlareValue(0.5 + centeredY * yMotionScale + yOffset, 0.04, 0.96),
    angle: baseGlint.angle * angleMotionScale + angleOffset,
    phase,
    patternSeed,
    intensity,
    hueOffset,
    patternScale,
  }
}

function formatCurrencyAmount(amount: number, currency: SupportedCurrency) {
  return new Intl.NumberFormat(currency === "GBP" ? "en-GB" : "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: amount >= 100 ? 0 : 2,
  }).format(amount)
}

function formatPriceLabel(price: CardPriceSnapshot | undefined) {
  if (price?.gbpAmount == null) {
    return null
  }

  const primary = formatCurrencyAmount(price.gbpAmount, "GBP")

  if (!price.originalCurrency || price.originalAmount == null) {
    return primary
  }

  return `${primary} (${formatCurrencyAmount(price.originalAmount, price.originalCurrency)} ${price.originalCurrency})`
}

function formatGbpPriceAmount(amount: number | null | undefined) {
  return typeof amount === "number" && Number.isFinite(amount)
    ? formatCurrencyAmount(amount, "GBP")
    : null
}

function formatGbpPriceRange(lowAmount: number | null | undefined, highAmount: number | null | undefined) {
  const low = formatGbpPriceAmount(lowAmount)
  const high = formatGbpPriceAmount(highAmount)

  if (low && high) {
    return low === high ? low : `${low}-${high}`
  }

  return low || high
}

function formatPriceConfidenceLabel(price: CardPriceSnapshot | undefined) {
  if (!price || price.confidence === "unknown") {
    return null
  }

  return `${price.confidence.charAt(0).toUpperCase()}${price.confidence.slice(1)} confidence`
}

function formatPriceSourceLabel(price: CardPriceSnapshot | undefined) {
  if (!price?.source) {
    return null
  }

  const source = getPriceSourceLabel(price.source)
  return price.variantLabel ? `${source}, ${price.variantLabel}` : source
}

function getWantedCardKey(card: WantedCard) {
  return `${card.card_id}:${card.card_language ?? "en"}:${card.card_finish ?? "normal"}`
}

const CARD_LANGUAGE_LABELS: Record<CardLanguage, string> = {
  en: "English",
  fr: "French",
  de: "German",
  es: "Spanish",
  it: "Italian",
  "pt-br": "Portuguese",
  ja: "Japanese",
  ko: "Korean",
}

const CARD_FINISH_LABELS: Record<CardFinish, string> = {
  normal: "Normal",
  holo: "Holo",
  reverse_holo: "Reverse holo",
  double_rare: "Double rare",
  ultra_rare: "Ultra rare",
  illustration_rare: "IR",
  special_illustration_rare: "SIR",
  secret_rare: "Secret",
  hyper_rare: "Hyper",
  radiant_rare: "Radiant",
  ace_spec: "ACE SPEC",
  amazing_rare: "Amazing",
  shiny_rare: "Shiny",
  jumbo: "Jumbo",
}

const CARD_FINISH_OPTIONS: Array<{ id: CardFinish; label: string }> = [
  { id: "normal", label: "Normal" },
  { id: "holo", label: "Holo" },
  { id: "reverse_holo", label: "Reverse" },
  { id: "double_rare", label: "Double" },
  { id: "ultra_rare", label: "Ultra" },
  { id: "illustration_rare", label: "IR" },
  { id: "special_illustration_rare", label: "SIR" },
  { id: "secret_rare", label: "Secret" },
  { id: "hyper_rare", label: "Hyper" },
  { id: "radiant_rare", label: "Radiant" },
  { id: "ace_spec", label: "ACE" },
  { id: "amazing_rare", label: "Amazing" },
  { id: "shiny_rare", label: "Shiny" },
]

function formatCardLanguageLabel(language?: string | null) {
  return CARD_LANGUAGE_LABELS[(language || "en") as CardLanguage] ?? CARD_LANGUAGE_LABELS.en
}

function formatCardFinishLabel(finish?: string | null) {
  return CARD_FINISH_LABELS[(finish || "normal") as CardFinish] ?? CARD_FINISH_LABELS.normal
}

function getCardFinishEffectClass(finish: CardFinish) {
  switch (finish) {
    case "holo":
      return "card-finish-holo"
    case "reverse_holo":
      return "card-finish-reverse-holo"
    case "double_rare":
      return "card-finish-double"
    case "ultra_rare":
      return "card-finish-ultra"
    case "illustration_rare":
      return "card-finish-ir"
    case "special_illustration_rare":
      return "card-finish-sir"
    case "secret_rare":
    case "hyper_rare":
      return "card-finish-secret"
    case "radiant_rare":
      return "card-finish-radiant"
    case "ace_spec":
      return "card-finish-ace"
    case "amazing_rare":
      return "card-finish-amazing"
    case "shiny_rare":
      return "card-finish-shiny"
    case "jumbo":
      return "card-finish-holo"
    case "normal":
    default:
      return "card-finish-normal"
  }
}

function getCollectionItemPriceKey(item?: { card_id?: string | null; card_language?: string | null } | null) {
  return item?.card_id ? getCardPriceKey(item.card_id, item.card_language) : null
}

function getSlotLabel(row: number, col: number) {
  return `${String.fromCharCode(65 + row)}${col + 1}`
}

function formatCollectedDate(value?: string | null) {
  if (!value) {
    return null
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return null
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date)
}

type PriceSummary = {
  gbpTotal: number
  originalTotals: Partial<Record<Exclude<SupportedCurrency, "GBP">, number>>
  unpricedCount: number
}

function sumPriceSnapshots(prices: Array<CardPriceSnapshot | undefined>): PriceSummary {
  let gbpTotal = 0
  const originalTotals: Partial<Record<Exclude<SupportedCurrency, "GBP">, number>> = {}
  let unpricedCount = 0

  for (const price of prices) {
    if (price?.gbpAmount == null) {
      unpricedCount += 1
      continue
    }

    gbpTotal += price.gbpAmount

    if (price.originalCurrency && price.originalAmount != null) {
      originalTotals[price.originalCurrency] = (originalTotals[price.originalCurrency] || 0) + price.originalAmount
    }
  }

  return { gbpTotal, originalTotals, unpricedCount }
}

function combinePriceSummaries(summaries: PriceSummary[]): PriceSummary {
  const combined: PriceSummary = { gbpTotal: 0, originalTotals: {}, unpricedCount: 0 }

  for (const summary of summaries) {
    combined.gbpTotal += summary.gbpTotal
    combined.unpricedCount += summary.unpricedCount

    for (const [currency, amount] of Object.entries(summary.originalTotals)) {
      if (!amount) continue
      const supportedCurrency = currency as Exclude<SupportedCurrency, "GBP">
      combined.originalTotals[supportedCurrency] = (combined.originalTotals[supportedCurrency] || 0) + amount
    }
  }

  return combined
}

function formatPriceTotals(
  gbpTotal: number,
  originalTotals: Partial<Record<Exclude<SupportedCurrency, "GBP">, number>>,
) {
  if (gbpTotal <= 0) {
    return ""
  }

  const primary = formatCurrencyAmount(gbpTotal, "GBP")
  const originalParts: string[] = []

  if (originalTotals.USD) {
    originalParts.push(`${formatCurrencyAmount(originalTotals.USD, "USD")} USD`)
  }

  if (originalTotals.EUR) {
    originalParts.push(`${formatCurrencyAmount(originalTotals.EUR, "EUR")} EUR`)
  }

  return originalParts.length > 0 ? `${primary} (${originalParts.join(" + ")})` : primary
}

function BinderSlotGlare({
  glareStyle,
  innerRadius,
}: {
  glareStyle: CSSProperties
  innerRadius: string
}) {
  return (
    <>
      <div
        className="pointer-events-none absolute inset-[3px] z-[2] mix-blend-screen"
        style={{
          ...glareStyle,
          borderRadius: innerRadius,
          background:
            "radial-gradient(circle at var(--glint-x, 30%) var(--glint-y, 26%), rgba(255,255,255,0.3) 0%, rgba(125,211,252,0.12) 17%, rgba(244,114,182,0.08) 29%, rgba(255,255,255,0) 55%)",
          transform: "none",
          opacity: 0.28,
        } as CSSProperties}
      />
      <div
        className="pointer-events-none absolute inset-[3px] z-[2]"
        style={{
          borderRadius: innerRadius,
          background: "radial-gradient(circle at 18% 14%, rgba(255,255,255,0.24) 0%, rgba(255,255,255,0.09) 20%, rgba(255,255,255,0) 44%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-[3px] z-[3]"
        style={{
          borderRadius: innerRadius,
          background: "linear-gradient(180deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.05) 24%, rgba(255,255,255,0) 58%)",
        }}
      />
      <div
        className="animate-slot-glare-sweep pointer-events-none absolute -inset-x-[40%] -top-[30%] z-[3] h-[92%] rounded-[999px] blur-[1px] shadow-[0_0_12px_rgba(255,255,255,0.12)] transition-[transform,opacity] duration-150 ease-out will-change-transform dark:shadow-[0_0_12px_rgba(255,255,255,0.08)]"
        style={{
          ...glareStyle,
          "--glare-transform": glareStyle.transform,
          background:
            "linear-gradient(132deg, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0.3) 12%, rgba(125,211,252,0.16) 23%, rgba(244,114,182,0.12) 32%, rgba(255,255,255,0.05) 43%, rgba(255,255,255,0) 62%)",
        } as CSSProperties}
      />
      <div
        className="pointer-events-none absolute inset-y-[8%] left-[8%] z-[3] w-[10%] rounded-[999px] blur-[1px]"
        style={{
          background: "linear-gradient(180deg, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0.1) 34%, rgba(255,255,255,0) 100%)",
          opacity: 0.34,
        }}
      />
    </>
  )
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

async function canvasToFile(canvas: HTMLCanvasElement, index: number, prefix = "binder-scan") {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9))
  if (!blob) {
    throw new Error("Could not encode a camera frame.")
  }

  return new File([blob], `${prefix}-${index}.jpg`, { type: "image/jpeg" })
}

function drawVideoCoverFrame(
  video: HTMLVideoElement,
  context: CanvasRenderingContext2D,
  targetWidth: number,
  targetHeight: number,
) {
  const videoWidth = video.videoWidth || 1280
  const videoHeight = video.videoHeight || 720
  const scale = Math.max(targetWidth / videoWidth, targetHeight / videoHeight)
  const drawWidth = videoWidth * scale
  const drawHeight = videoHeight * scale
  const offsetX = (targetWidth - drawWidth) / 2
  const offsetY = (targetHeight - drawHeight) / 2

  context.clearRect(0, 0, targetWidth, targetHeight)
  context.drawImage(video, offsetX, offsetY, drawWidth, drawHeight)
}

function cropCanvasByRatios(
  sourceCanvas: HTMLCanvasElement,
  insetXRatio: number,
  insetYRatio: number,
) {
  const cropX = Math.round(sourceCanvas.width * insetXRatio)
  const cropY = Math.round(sourceCanvas.height * insetYRatio)
  const cropWidth = Math.max(200, Math.round(sourceCanvas.width * (1 - insetXRatio * 2)))
  const cropHeight = Math.max(260, Math.round(sourceCanvas.height * (1 - insetYRatio * 2)))
  const canvas = document.createElement("canvas")
  canvas.width = Math.min(cropWidth, sourceCanvas.width - cropX)
  canvas.height = Math.min(cropHeight, sourceCanvas.height - cropY)
  const context = canvas.getContext("2d")

  if (!context) {
    throw new Error("Could not crop the guided camera frame.")
  }

  context.drawImage(
    sourceCanvas,
    cropX,
    cropY,
    canvas.width,
    canvas.height,
    0,
    0,
    canvas.width,
    canvas.height,
  )

  return canvas
}

async function captureGuidedFrameFile(video: HTMLVideoElement, canvas: HTMLCanvasElement, index: number) {
  const previewWidth = Math.max(360, Math.round((video.clientWidth || 360) * 2))
  const previewHeight = Math.max(640, Math.round((video.clientHeight || 640) * 2))
  canvas.width = previewWidth
  canvas.height = previewHeight
  const context = canvas.getContext("2d")

  if (!context) {
    throw new Error("Could not capture the guided camera frame.")
  }

  drawVideoCoverFrame(video, context, previewWidth, previewHeight)
  const guidedCanvas = cropCanvasByRatios(canvas, GUIDE_FRAME_INSET_X, GUIDE_FRAME_INSET_Y)

  return canvasToFile(guidedCanvas, index, "binder-page-sweep")
}

function cropCanvasToCardGuide(sourceCanvas: HTMLCanvasElement) {
  const availableWidth = sourceCanvas.width * (1 - SLOT_SWEEP_GUIDE_INSET_X * 2)
  const availableHeight = sourceCanvas.height * (1 - SLOT_SWEEP_GUIDE_INSET_Y * 2)
  let cropWidth = availableWidth
  let cropHeight = cropWidth / TRADING_CARD_ASPECT_RATIO

  if (cropHeight > availableHeight) {
    cropHeight = availableHeight
    cropWidth = cropHeight * TRADING_CARD_ASPECT_RATIO
  }

  const cropX = Math.round((sourceCanvas.width - cropWidth) / 2)
  const cropY = Math.round((sourceCanvas.height - cropHeight) / 2)
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(260, Math.round(cropWidth))
  canvas.height = Math.max(360, Math.round(cropHeight))
  const context = canvas.getContext("2d")

  if (!context) {
    throw new Error("Could not crop the slot scanner frame.")
  }

  context.drawImage(
    sourceCanvas,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    0,
    0,
    canvas.width,
    canvas.height,
  )

  return canvas
}

async function captureGuidedSlotFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement, index: number) {
  const previewWidth = Math.max(480, Math.round((video.clientWidth || 360) * 2))
  const previewHeight = Math.max(820, Math.round((video.clientHeight || 640) * 2))
  canvas.width = previewWidth
  canvas.height = previewHeight
  const context = canvas.getContext("2d")

  if (!context) {
    throw new Error("Could not capture the slot scanner frame.")
  }

  drawVideoCoverFrame(video, context, previewWidth, previewHeight)
  const guidedCanvas = cropCanvasToCardGuide(canvas)

  return {
    file: await canvasToFile(guidedCanvas, index, "binder-slot-sweep"),
    previewUrl: guidedCanvas.toDataURL("image/jpeg", 0.82),
  }
}

function getScannerOverlayLayout(result: BinderPageScanResult, rows: number, cols: number) {
  return result.slots.map((slot) => ({
    left: (slot.x / result.width) * 100,
    top: (slot.y / result.height) * 100,
    width: (slot.width / result.width) * 100,
    height: (slot.height / result.height) * 100,
    occupied: slot.occupied,
  }))
}

export default function BinderApp({
  initialUser,
  initialCollection,
  initialCollectionOwnerUserId,
  initialSettings,
  initialHasStoredSettings = false,
  initialDarkMode,
  initialPriceMode = false,
  readOnlyMode = false,
  shareViewToken = null,
}: BinderAppProps) {
  const router = useRouter()
  const [selectedPokemon, setSelectedPokemon] = useState<PokemonSummary | null>(null)
  const [isDarkMode, setIsDarkMode] = useState(initialDarkMode)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isAuthOpen, setIsAuthOpen] = useState(false)
  const [isPartnerOpen, setIsPartnerOpen] = useState(false)
  const [isCardSelectorOpen, setIsCardSelectorOpen] = useState(false)
  const [cardSelectorMode, setCardSelectorMode] = useState<CardSelectorMode>("collect")
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [isPriceMode, setIsPriceMode] = useState(initialPriceMode)
  const [activeMainView, setActiveMainView] = useState<ActiveMainView>("binder")
  const [selectedGen, setSelectedGen] = useState(0)
  const [currentBinderPage, setCurrentBinderPage] = useState(1)
  const [pageInputValue, setPageInputValue] = useState("1")
  const [collectionViewFilter, setCollectionViewFilter] = useState<CollectionViewFilter>("all")
  const [wantedSort, setWantedSort] = useState<WantedDashboardSort>("highest")
  const [wantedExplorerFilter, setWantedExplorerFilter] = useState<WantedExplorerFilter>({ kind: "all", label: "All wanted" })
  const [isMobileNavExpanded, setIsMobileNavExpanded] = useState(false)
  const [isMobileFilterSheetOpen, setIsMobileFilterSheetOpen] = useState(false)
  const [isDesktopActionsOpen, setIsDesktopActionsOpen] = useState(false)
  const [isDesktopFiltersOpen, setIsDesktopFiltersOpen] = useState(false)
  const [longPressedPokemon, setLongPressedPokemon] = useState<{ id: number; name: string } | null>(null)
  // Read-only "all cards for this Pokémon" view. `nested` = opened from the card detail (returns to it).
  const [cardBrowser, setCardBrowser] = useState<{ pokemon: { id: number; name: string }; highlightCardId?: string | null; nested: boolean } | null>(null)
  const [isPageTransitioning, setIsPageTransitioning] = useState(false)
  const [transitionDirection, setTransitionDirection] = useState<"left" | "right" | null>(null)
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false)
  const pageTurnTiming = getPageTurnTiming(prefersReducedMotion)
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return
    const query = window.matchMedia("(prefers-reduced-motion: reduce)")
    const update = () => setPrefersReducedMotion(query.matches)
    update()
    query.addEventListener?.("change", update)
    return () => query.removeEventListener?.("change", update)
  }, [])
  const [isScanningPage, setIsScanningPage] = useState(false)
  const [pageScanSummary, setPageScanSummary] = useState<PageScanSummary | null>(null)
  const [pageScanError, setPageScanError] = useState<string | null>(null)
  const [isBurstScannerOpen, setIsBurstScannerOpen] = useState(false)
  const [pageScannerMode, setPageScannerMode] = useState<PageScannerMode>("slot-sweep")
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [isCameraReady, setIsCameraReady] = useState(false)
  const [isCapturingBurst, setIsCapturingBurst] = useState(false)
  const [isApplyingScanResults, setIsApplyingScanResults] = useState(false)
  const [burstFramesProcessed, setBurstFramesProcessed] = useState(0)
  const [burstUsableFrames, setBurstUsableFrames] = useState(0)
  const [burstPreviewResult, setBurstPreviewResult] = useState<BinderPageScanResult | null>(null)
  const [slotSweepSlotIndex, setSlotSweepSlotIndex] = useState(0)
  const [slotSweepCompletedSlotIndexes, setSlotSweepCompletedSlotIndexes] = useState<number[]>([])
  const [slotSweepMatchedCards, setSlotSweepMatchedCards] = useState<PageScanCardMatchSummary[]>([])
  const [slotSweepPreviewUrl, setSlotSweepPreviewUrl] = useState<string | null>(null)
  const [isSyncingLocalCollection, setIsSyncingLocalCollection] = useState(false)
  const [localCollectionSyncMessage, setLocalCollectionSyncMessage] = useState<string | null>(null)
  const [sharePath, setSharePath] = useState<string | null>(shareViewToken ? `/share/${shareViewToken}` : null)
  const [isShareEnabled, setIsShareEnabled] = useState(Boolean(shareViewToken))
  const [isShareLoading, setIsShareLoading] = useState(false)
  const [shareMessage, setShareMessage] = useState<string | null>(null)
  const [shareCopyMessage, setShareCopyMessage] = useState<string | null>(null)
  const [isRefreshingPrices, setIsRefreshingPrices] = useState(false)
  const [priceRefreshMessage, setPriceRefreshMessage] = useState<string | null>(null)
  const [isOnline, setIsOnline] = useState(true)
  const [isInstalledApp, setIsInstalledApp] = useState(false)
  const [installPromptEvent, setInstallPromptEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [pwaStatusMessage, setPwaStatusMessage] = useState<string | null>(null)
  const [isDesktopViewport, setIsDesktopViewport] = useState(false)
  const [isCompactViewport, setIsCompactViewport] = useState(false)
  const [isWideBinderSpread, setIsWideBinderSpread] = useState(false)
  const [binderDimension, setBinderDimension] = useState<"2d" | "3d">("2d")
  const [isMobileSpreadPreview, setIsMobileSpreadPreview] = useState(false)
  const [slotGlareState, setSlotGlareState] = useState(DEFAULT_SLOT_GLARE_STATE)
  const [motionGlintStatus, setMotionGlintStatus] = useState<MotionGlintStatus>("fallback")
  const [motionGlintMessage, setMotionGlintMessage] = useState<string | null>(null)
  const [motionSensorVersion, setMotionSensorVersion] = useState(0)
  const [quickPanelPosition, setQuickPanelPosition] = useState<QuickPanelPosition | null>(null)
  const [binderStageSize, setBinderStageSize] = useState({ width: 0, height: 0 })
  const pagePhotoInputRef = useRef<HTMLInputElement | null>(null)
  const burstVideoRef = useRef<HTMLVideoElement | null>(null)
  const burstCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const cameraStreamRef = useRef<MediaStream | null>(null)
  const hasHydratedPageFromQueryRef = useRef(false)
  const quickPanelRef = useRef<HTMLDivElement | null>(null)
  const binderStageRef = useRef<HTMLDivElement | null>(null)
  const slotButtonRefs = useRef(new Map<number, HTMLButtonElement>())
  const pageScanCardCandidatesCacheRef = useRef<Map<number, Promise<TCGCard[]>>>(new Map())
  const pageScanCardDescriptorCacheRef = useRef<Map<string, Promise<CardImageDescriptor | null>>>(new Map())
  const pageScanCardTextSignalCacheRef = useRef<Map<string, Promise<CardTextSignals>>>(new Map())
  const slotPreviewCardRequestIdsRef = useRef(new Set<number>())
  const slotPreviewCardMissIdsRef = useRef(new Set<number>())
  const shellNavRef = useRef<HTMLElement | null>(null)
  const motionSensorsEnabledRef = useRef(false)
  const hasAutoRequestedMotionPermissionRef = useRef(false)
  const isRequestingMotionPermissionRef = useRef(false)
  const lastOfflineCacheWarmupSignatureRef = useRef<string | null>(null)

  const pokemonList = POKEMON_CATALOG
  const {
    user,
    isCollected,
    isWishlisted,
    addToCollection,
    addWantedCard,
    removeFromCollection,
    removeWantedCard,
    updateStatus,
    collectionCount,
    signOut,
    isLoading: isCollectionLoading,
    getCollectionItem,
    collection,
    syncLocalCollectionToDatabase,
    localCollectedCount,
    localPendingSyncCount,
    syncStatus,
    syncNotice,
    dismissSyncNotice,
    resolvedCollectionOwnerUserId,
  } = useCollection({ initialUser, initialCollection, initialCollectionOwnerUserId, readOnly: readOnlyMode })
  useOfflineStoreSync(!readOnlyMode)
  const settingsLocalCollectedCount = getSettingsLocalCollectedCount({
    isSignedIn: Boolean(user),
    cloudCollectedCount: collectionCount,
    localCollectedCount,
    localPendingSyncCount,
  })
  const { settings, updateSettings: updateLegacySettings } = useSettings({
    initialSettings,
    initialUser,
    settingsOwnerUserId: initialCollectionOwnerUserId,
    readOnly: readOnlyMode,
    hasRemoteSettings: initialHasStoredSettings,
  })
  const binderAppearance = useBinderAppearance({
    owner: resolvedCollectionOwnerUserId,
    settings,
    enabled: Boolean(user && resolvedCollectionOwnerUserId) && !readOnlyMode,
    legacyKey: user && resolvedCollectionOwnerUserId ? `owner:${user.id}:${resolvedCollectionOwnerUserId}` : undefined,
  })
  const updateSettings = useCallback((updates: Partial<BinderSettings>, appearancePageColors?: Record<string, string>) => {
    updateLegacySettings(updates)
    if (!binderAppearance.hasSavedDesign || readOnlyMode) return
    if (updates.binderColorId === undefined && updates.binderPageColors === undefined && updates.binderRows === undefined && updates.binderCols === undefined) return
    const design = binderAppearance.design
    const rows = updates.binderRows ?? design.rows
    const cols = updates.binderCols ?? design.cols
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
    void binderAppearance.save({
      ...design,
      rows,
      cols,
      pageCount: Math.max(design.pageCount, Math.ceil(1025 / (rows * cols))),
      pageColor: updates.binderColorId === undefined ? design.pageColor : getBinderColorPreset(updates.binderColorId).swatch[0],
      pageColors,
    }, binderAppearance.uploads).catch(() => {})
  }, [updateLegacySettings, binderAppearance, readOnlyMode, settings.binderPageColors])
  const { fetchCardsForPokemon } = useTCGdex()
  const [slotPreviewCardsByPokemonId, setSlotPreviewCardsByPokemonId] = useState<Record<number, SlotPreviewCard>>({})
  const slotPreviewCardsByPokemonIdRef = useRef<Record<number, SlotPreviewCard>>({})

  const canEditBinder = !readOnlyMode
  const canFilterCollection = readOnlyMode || Boolean(user)
  const canInstallApp = Boolean(installPromptEvent)
  const motionGlintEffectsEnabled = settings.binderSlotGlareEnabled || settings.cardFinishEffectsEnabled
  const fullShareUrl = useMemo(() => {
    if (!sharePath) return null
    if (typeof window === "undefined") return sharePath

    return buildBinderShareUrl(window.location.origin, sharePath.replace(/^\/share\//, ""))
  }, [sharePath])
  const handleSignOut = useCallback(async () => {
    await signOut()
    router.push("/auth/logout")
  }, [router, signOut])
  const collectionByPokemonId = useMemo(
    () => new Map(collection.map((item) => [item.pokemon_id, item] as const)),
    [collection],
  )

  useEffect(() => {
    slotPreviewCardsByPokemonIdRef.current = slotPreviewCardsByPokemonId
  }, [slotPreviewCardsByPokemonId])

  const slotsPerPage = settings.binderRows * settings.binderCols
  const binderPageAspectRatio = getBinderGridAspectRatio(settings.binderRows, settings.binderCols)
  const currentPageBinderColorId = settings.binderPageColors[String(currentBinderPage)] ?? settings.binderColorId
  const currentPageBinderColor = getBinderColorPreset(currentPageBinderColorId)
  const currentPageBinderTheme = isDarkMode ? currentPageBinderColor.dark : currentPageBinderColor.light
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
  }, [activeMainView])

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
      motionSensorsEnabledRef.current = false
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

    return generationFilteredPokemonList.filter((pokemon) => {
      const item = collection.find((entry) => entry.pokemon_id === pokemon.id)

      if (collectionViewFilter === "needed") {
        return !item || item.status === "wishlisted"
      }

      if (collectionViewFilter === "wanted") {
        return Boolean(item?.wanted_cards?.length)
      }

      if (!item || item.status === "wishlisted") {
        return false
      }

      if (collectionViewFilter === "favorite") {
        return item.status === "finalized"
      }

      return item.status !== "finalized"
    })
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

  const totalBinderPages = Math.max(1, Math.ceil(pokemonList.length / slotsPerPage))
  const firstNonEmptyPage = useMemo(() => {
    if (filteredPokemonList.length === 0) return 1

    const firstMatchIndex = pokemonList.findIndex(
      (pokemon) => pokemon.id === filteredPokemonList[0].id,
    )

    if (firstMatchIndex === -1) return 1
    return Math.ceil((firstMatchIndex + 1) / slotsPerPage)
  }, [filteredPokemonList, pokemonList, slotsPerPage])

  useEffect(() => {
    if (hasHydratedPageFromQueryRef.current || typeof window === "undefined") {
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
  }, [currentBinderPage, totalBinderPages])

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }

    const url = new URL(window.location.href)

    if (currentBinderPage <= 1) {
      url.searchParams.delete(BINDER_PAGE_QUERY_PARAM)
    } else {
      url.searchParams.set(BINDER_PAGE_QUERY_PARAM, String(currentBinderPage))
    }

    window.history.replaceState(window.history.state, "", url)
  }, [currentBinderPage])

  useEffect(() => {
    setPageInputValue(String(currentBinderPage))
  }, [currentBinderPage])

  useEffect(() => {
    setPageScanSummary(null)
    setPageScanError(null)
  }, [currentBinderPage, selectedGen, collectionViewFilter, settings.binderRows, settings.binderCols])

  useEffect(() => {
    setLocalCollectionSyncMessage(null)
  }, [user])

  useEffect(() => {
    if (isSearchOpen) {
      setIsMobileFilterSheetOpen(false)
    }
  }, [isSearchOpen])

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

  const firstSweepSlotIndex = useMemo(() => {
    const index = currentPageSlots.findIndex(Boolean)
    return index >= 0 ? index : 0
  }, [currentPageSlots])
  const slotSweepCompletedSet = useMemo(
    () => new Set(slotSweepCompletedSlotIndexes),
    [slotSweepCompletedSlotIndexes],
  )
  const slotSweepTargetPokemon = currentPageSlots[slotSweepSlotIndex] ?? null
  const slotSweepTargetLabel = getSlotLabel(
    Math.floor(slotSweepSlotIndex / settings.binderCols),
    slotSweepSlotIndex % settings.binderCols,
  )
  const burstPreviewSlots = useMemo(
    () =>
      burstPreviewResult
        ? getScannerOverlayLayout(burstPreviewResult, settings.binderRows, settings.binderCols)
        : [],
    [burstPreviewResult, settings.binderCols, settings.binderRows],
  )

  useEffect(() => {
    if (currentBinderPage > totalBinderPages) {
      setCurrentBinderPage(totalBinderPages)
      return
    }

    if (currentPageSlots.some(Boolean)) {
      return
    }

    if (currentBinderPage !== firstNonEmptyPage) {
      setCurrentBinderPage(firstNonEmptyPage)
    }
  }, [currentBinderPage, currentPageSlots, firstNonEmptyPage, totalBinderPages])

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
  const wantedCardEntries = useMemo(
    () => collection.flatMap((item) =>
      (item.wanted_cards ?? []).map((card) => ({
        pokemonId: item.pokemon_id,
        pokemonName: item.pokemon_name,
        card,
      })),
    ),
    [collection],
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
  const shouldLoadCollectionPriceLookups = isPriceMode || collectionViewFilter === "wanted" || activeMainView === "list" || activeMainView === "wanted" || activeMainView === "sets"
  const priceLookupCards = useMemo(
    () => {
      const byKey = new Map<string, CardPriceLookup>()

      for (const lookup of ownedPriceLookups) {
        byKey.set(getCardPriceKey(lookup.cardId, lookup.language), lookup)
      }

      for (const lookup of wantedPriceLookups) {
        byKey.set(getCardPriceKey(lookup.cardId, lookup.language), lookup)
      }

      if (shouldLoadCollectionPriceLookups && collectionViewFilter === "wanted") {
        for (const lookup of ownedPriceLookups) {
          byKey.set(getCardPriceKey(lookup.cardId, lookup.language), lookup)
        }
      }

      if (shouldLoadCollectionPriceLookups) {
        for (const lookup of trackedPriceLookups) {
          byKey.set(getCardPriceKey(lookup.cardId, lookup.language), lookup)
        }
      }

      if (selectedTrackedPriceLookup) {
        byKey.set(getCardPriceKey(selectedTrackedPriceLookup.cardId, selectedTrackedPriceLookup.language), selectedTrackedPriceLookup)
      }

      for (const lookup of selectedWantedPriceLookups) {
        byKey.set(getCardPriceKey(lookup.cardId, lookup.language), lookup)
      }

      return [...byKey.values()]
    },
    [collectionViewFilter, ownedPriceLookups, selectedTrackedPriceLookup, selectedWantedPriceLookups, shouldLoadCollectionPriceLookups, trackedPriceLookups, wantedPriceLookups],
  )
  const hasTrackedCards = trackedPriceLookups.length > 0 || wantedPriceLookups.length > 0
  const shouldLoadCardPrices = ownedPriceLookups.length > 0 || wantedPriceLookups.length > 0 || shouldLoadCollectionPriceLookups || Boolean(selectedTrackedPriceLookup) || selectedWantedPriceLookups.length > 0
  const { pricesByCardId, isLoading: isLoadingPrices } = useCardPrices(priceLookupCards, shouldLoadCardPrices)
  const filteredPriceSummary = useMemo(
    () => sumPriceSnapshots(filteredTrackedCards.map((item) => {
      const priceKey = getCollectionItemPriceKey(item)
      return priceKey ? pricesByCardId[priceKey] : undefined
    })),
    [filteredTrackedCards, pricesByCardId],
  )
  const filteredTotalLabel = useMemo(
    () => formatPriceTotals(filteredPriceSummary.gbpTotal, filteredPriceSummary.originalTotals),
    [filteredPriceSummary.gbpTotal, filteredPriceSummary.originalTotals],
  )
  const ownedPriceSummary = useMemo(
    () => sumPriceSnapshots(ownedTrackedCards.map((item) => {
      const priceKey = getCollectionItemPriceKey(item)
      return priceKey ? pricesByCardId[priceKey] : undefined
    })),
    [ownedTrackedCards, pricesByCardId],
  )
  const ownedTotalLabel = useMemo(
    () => formatPriceTotals(ownedPriceSummary.gbpTotal, ownedPriceSummary.originalTotals),
    [ownedPriceSummary.gbpTotal, ownedPriceSummary.originalTotals],
  )
  const wantedPriceSummary = useMemo(
    () => sumPriceSnapshots(wantedCardEntries.map(({ card }) => {
      const priceKey = getCardPriceKey(card.card_id, card.card_language ?? "en")
      return pricesByCardId[priceKey]
    })),
    [pricesByCardId, wantedCardEntries],
  )
  const wantedTotalLabel = useMemo(
    () => formatPriceTotals(wantedPriceSummary.gbpTotal, wantedPriceSummary.originalTotals),
    [wantedPriceSummary.gbpTotal, wantedPriceSummary.originalTotals],
  )
  const wantedModeCombinedPriceSummary = useMemo(
    () => combinePriceSummaries([ownedPriceSummary, wantedPriceSummary]),
    [ownedPriceSummary, wantedPriceSummary],
  )
  const wantedModeCombinedTotalLabel = useMemo(
    () => formatPriceTotals(wantedModeCombinedPriceSummary.gbpTotal, wantedModeCombinedPriceSummary.originalTotals),
    [wantedModeCombinedPriceSummary.gbpTotal, wantedModeCombinedPriceSummary.originalTotals],
  )
  const wantedDashboard = useMemo(
    () => buildWantedDashboardSummary(wantedCardEntries, pricesByCardId),
    [pricesByCardId, wantedCardEntries],
  )
  const filteredWantedDashboardCards = useMemo(() => {
    if (wantedExplorerFilter.kind === "all") {
      return wantedDashboard.cards
    }

    return wantedDashboard.cards.filter((wantedCard) => {
      if (wantedExplorerFilter.kind === "band") {
        return wantedCard.priceBandId === wantedExplorerFilter.value
      }

      if (wantedExplorerFilter.kind === "set") {
        return (wantedCard.card.card_set || "Unknown set") === wantedExplorerFilter.value
      }

      if (wantedExplorerFilter.kind === "language") {
        return (wantedCard.card.card_language ?? "en") === wantedExplorerFilter.value
      }

      if (wantedExplorerFilter.kind === "finish") {
        return (wantedCard.card.card_finish ?? "normal") === wantedExplorerFilter.value
      }

      return true
    })
  }, [wantedDashboard.cards, wantedExplorerFilter])
  const sortedWantedDashboardCards = useMemo(
    () => sortWantedDashboardEntries(filteredWantedDashboardCards, wantedSort),
    [filteredWantedDashboardCards, wantedSort],
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
  const primaryCollectionFilters = useMemo(
    () => COLLECTION_VIEW_FILTERS.filter((filterOption) => filterOption.id === "all" || filterOption.id === "needed"),
    [],
  )
  const secondaryCollectionFilters = useMemo(
    () => COLLECTION_VIEW_FILTERS.filter((filterOption) => filterOption.id === "wanted" || filterOption.id === "upgradeable" || filterOption.id === "favorite"),
    [],
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
  // Once a page has settled, prefetch the neighbouring pages so a swipe renders immediately.
  const [prefetchPagePokemonIds, setPrefetchPagePokemonIds] = useState<number[]>([])
  useEffect(() => {
    if (isPageTransitioning) return
    const timer = window.setTimeout(() => {
      const ids: number[] = []
      getAdjacentPageNumbers(visibleBinderPageNumbers, totalBinderPages, isSpreadLayout ? 2 : 1).forEach((pageNumber) => {
        getPageSlots(pageNumber).forEach((pokemon) => {
          if (pokemon) ids.push(pokemon.id)
        })
      })
      setPrefetchPagePokemonIds(ids)
    }, ADJACENT_PREFETCH_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [getPageSlots, isPageTransitioning, isSpreadLayout, totalBinderPages, visibleBinderPageNumbers])
  // Visible slots first, then the prefetched neighbours.
  const slotPreviewTargetIds = useMemo(
    () => new Set<number>([...visiblePagePokemonIds, ...prefetchPagePokemonIds]),
    [prefetchPagePokemonIds, visiblePagePokemonIds],
  )

  useEffect(() => {
    if (!shouldClearSelectedPokemonForPage(selectedPokemon?.id, visiblePagePokemonIds)) {
      return
    }

    const frameId = window.requestAnimationFrame(() => {
      setSelectedPokemon(null)
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [selectedPokemon?.id, visiblePagePokemonIds])

  useEffect(() => {
    const pokemonIdsToRequest: number[] = []

    slotPreviewTargetIds.forEach((pokemonId) => {
      const item = collectionByPokemonId.get(pokemonId)
      const wantedCardPreview = item?.wanted_cards?.[0] ?? null
      const selectedCardImage = normalizeSlotPreviewImage(
        item?.status === "wishlisted" || Boolean(item?.wanted_cards?.length)
          ? wantedCardPreview?.card_image
          : item?.card_image,
      )

      if (
        selectedCardImage ||
        slotPreviewCardsByPokemonIdRef.current[pokemonId] ||
        slotPreviewCardRequestIdsRef.current.has(pokemonId) ||
        slotPreviewCardMissIdsRef.current.has(pokemonId)
      ) {
        return
      }

      slotPreviewCardRequestIdsRef.current.add(pokemonId)
      pokemonIdsToRequest.push(pokemonId)
    })

    if (pokemonIdsToRequest.length === 0) {
      return
    }

    // Results are cached per Pokémon, so they are applied even if the page changed meanwhile
    // (dropping them would leave in-flight slots without a preview until the next visit).
    void Promise.all(
      pokemonIdsToRequest.map(async (pokemonId) => {
        const cards = await fetchCardsForPokemon(pokemonId, "en")
        return {
          pokemonId,
          previewCard: pickRepresentativeSlotPreviewCard(cards),
        }
      }),
    ).then((results) => {
      results.forEach((result) => {
        slotPreviewCardRequestIdsRef.current.delete(result.pokemonId)
      })

      const previewCardsByPokemonId = results.reduce<Record<number, SlotPreviewCard>>((acc, result) => {
        if (result.previewCard) {
          acc[result.pokemonId] = result.previewCard
        } else {
          slotPreviewCardMissIdsRef.current.add(result.pokemonId)
        }

        return acc
      }, {})

      if (Object.keys(previewCardsByPokemonId).length === 0) {
        return
      }

      setSlotPreviewCardsByPokemonId((currentPreviewCardsByPokemonId) => ({
        ...currentPreviewCardsByPokemonId,
        ...previewCardsByPokemonId,
      }))
    }).catch(() => {
      pokemonIdsToRequest.forEach((pokemonId) => {
        slotPreviewCardRequestIdsRef.current.delete(pokemonId)
      })
    })
  }, [collectionByPokemonId, fetchCardsForPokemon, slotPreviewTargetIds])

  // The card image a slot shows (wanted card, owned card, or a representative printing).
  const getSlotCardImage = useCallback((pokemonId: number) => {
    const item = collectionByPokemonId.get(pokemonId)
    const isWishlisted = item?.status === "wishlisted" || Boolean(item?.wanted_cards?.length)
    const wantedCardPreview = item?.wanted_cards?.[0] ?? null
    const selectedCardImage = isWishlisted && wantedCardPreview?.card_image
      ? wantedCardPreview.card_image
      : item?.card_image
    return selectedCardImage || slotPreviewCardsByPokemonId[pokemonId]?.image
  }, [collectionByPokemonId, slotPreviewCardsByPokemonId])

  // Decode the neighbouring pages' slot images at grid size, using exactly the URLs the grid
  // renders so the browser / service-worker cache serves them when the page turns.
  const decodedSlotImageUrlsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (prefetchPagePokemonIds.length === 0 || typeof Image === "undefined") return
    const decoded = decodedSlotImageUrlsRef.current
    for (const pokemonId of prefetchPagePokemonIds) {
      const url = resolveSlotImageUrl(pokemonId, getSlotCardImage(pokemonId))
      if (decoded.has(url)) continue
      decoded.add(url)
      const image = new Image()
      image.decoding = "async"
      image.src = url
      image.decode?.().catch(() => decoded.delete(url))
    }
    if (decoded.size > 400) {
      decodedSlotImageUrlsRef.current = new Set([...decoded].slice(-200))
    }
  }, [getSlotCardImage, prefetchPagePokemonIds])
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
  const visiblePageTrackedCards = useMemo(
    () =>
      collection.filter(
        (item) => Boolean(item.card_id) && item.status !== "wishlisted" && visiblePagePokemonIds.has(item.pokemon_id),
      ),
    [collection, visiblePagePokemonIds],
  )
  const visiblePagePriceSummary = useMemo(
    () => sumPriceSnapshots(visiblePageTrackedCards.map((item) => {
      const priceKey = getCollectionItemPriceKey(item)
      return priceKey ? pricesByCardId[priceKey] : undefined
    })),
    [pricesByCardId, visiblePageTrackedCards],
  )
  const visiblePageTotalLabel = useMemo(
    () => formatPriceTotals(visiblePagePriceSummary.gbpTotal, visiblePagePriceSummary.originalTotals),
    [visiblePagePriceSummary.gbpTotal, visiblePagePriceSummary.originalTotals],
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
  const displayedBinderAspectRatio = isSpreadLayout
    ? binderPageAspectRatio * 2 + BINDER_SPREAD_GAP_ASPECT_RATIO
    : binderPageAspectRatio
  const binderFitSize = useMemo(() => {
    if (
      binderStageSize.width <= 0
      || binderStageSize.height <= 0
      || !Number.isFinite(displayedBinderAspectRatio)
      || displayedBinderAspectRatio <= 0
    ) {
      return null
    }

    const widthFromStageHeight = binderStageSize.height * displayedBinderAspectRatio
    const width = Math.min(binderStageSize.width, widthFromStageHeight)
    const height = width / displayedBinderAspectRatio

    return {
      width: Math.floor(width),
      height: Math.floor(height),
    }
  }, [binderStageSize.height, binderStageSize.width, displayedBinderAspectRatio])

  const navigateToPage = useCallback((page: number, direction: "left" | "right") => {
    if (page < 1 || page > totalBinderPages || page === currentBinderPage) return

    if (pageTurnTiming.outMs === 0) {
      // Reduced motion: swap immediately, no fade/slide.
      setCurrentBinderPage(page)
      return
    }

    setTransitionDirection(direction)
    setIsPageTransitioning(true)

    setTimeout(() => {
      setCurrentBinderPage(page)
      setTimeout(() => {
        setIsPageTransitioning(false)
        setTransitionDirection(null)
      }, pageTurnTiming.settleMs)
    }, pageTurnTiming.outMs)
  }, [currentBinderPage, pageTurnTiming.outMs, pageTurnTiming.settleMs, totalBinderPages])

  const goToNextPage = useCallback(() => {
    if (currentBinderPage < totalBinderPages) {
      navigateToPage(currentBinderPage + 1, "left")
    }
  }, [currentBinderPage, totalBinderPages, navigateToPage])

  const goToPrevPage = useCallback(() => {
    if (currentBinderPage > 1) {
      navigateToPage(currentBinderPage - 1, "right")
    }
  }, [currentBinderPage, navigateToPage])

  const goToNextSpread = useCallback(() => {
    if (!isSpreadLayout) {
      goToNextPage()
      return
    }

    const leftPage = currentBinderPage <= 1 ? 0 : currentBinderPage % 2 === 0 ? currentBinderPage : currentBinderPage - 1
    const nextPage = leftPage === 0 ? 2 : leftPage + 2

    if (nextPage <= totalBinderPages) {
      navigateToPage(nextPage, "left")
    }
  }, [currentBinderPage, goToNextPage, isSpreadLayout, navigateToPage, totalBinderPages])

  const goToPrevSpread = useCallback(() => {
    if (!isSpreadLayout) {
      goToPrevPage()
      return
    }

    if (currentBinderPage <= 1) {
      return
    }

    const leftPage = currentBinderPage % 2 === 0 ? currentBinderPage : currentBinderPage - 1
    const previousPage = leftPage <= 2 ? 1 : leftPage - 2
    navigateToPage(previousPage, "right")
  }, [currentBinderPage, goToPrevPage, isSpreadLayout, navigateToPage])

  const lastVisibleBinderPageNumber = visibleBinderPageNumbers[visibleBinderPageNumbers.length - 1] ?? 0
  const canGoToPreviousVisiblePage = currentBinderPage > 1
  const canGoToNextVisiblePage = isSpreadLayout
    ? lastVisibleBinderPageNumber < totalBinderPages
    : currentBinderPage < totalBinderPages

  const commitPageInput = useCallback(() => {
    const trimmedValue = pageInputValue.trim()

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
      return
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
    swipeThreshold: 60,
  })

  const handleToggleCollected = async () => {
    if (!selectedPokemon) return
    if (readOnlyMode) return

    if (!user) {
      setIsAuthOpen(true)
      return
    }

    if (isCollected(selectedPokemon.id)) {
      await removeFromCollection(selectedPokemon.id)
    } else {
      setIsCardSelectorOpen(true)
    }
  }

  const handleOpenCardSelector = () => {
    if (!selectedPokemon) return
    if (readOnlyMode) return

    if (!user) {
      setIsAuthOpen(true)
      return
    }

    setCardSelectorMode("collect")
    setIsCardSelectorOpen(true)
  }

  const handleOpenWishlistSelector = () => {
    if (!selectedPokemon) return
    if (readOnlyMode) return

    if (!user) {
      setIsAuthOpen(true)
      return
    }

    setCardSelectorMode("wishlist")
    setIsCardSelectorOpen(true)
  }

  const handleOpenSelectedSlotScanner = () => {
    if (!selectedPokemon) return
    if (readOnlyMode) return

    if (!user) {
      setIsAuthOpen(true)
      return
    }

    if (!window.isSecureContext || !navigator.mediaDevices) {
      setPageScanError("Camera scanning needs a secure browser context.")
      return
    }

    const slotIndex = currentPageSlots.findIndex((pokemon) => pokemon?.id === selectedPokemon.id)
    if (slotIndex < 0) {
      setPageScanError("Open the page containing this slot before scanning it.")
      return
    }

    setCameraError(null)
    setPageScannerMode("slot-sweep")
    setSlotSweepSlotIndex(slotIndex)
    setSlotSweepCompletedSlotIndexes([])
    setSlotSweepMatchedCards([])
    setSlotSweepPreviewUrl(null)
    setBurstFramesProcessed(0)
    setBurstUsableFrames(0)
    setBurstPreviewResult(null)
    setSelectedPokemon(null)
    setIsBurstScannerOpen(true)
  }

  const openCardSelectorForPokemon = useCallback((pokemon: PokemonSummary, mode: CardSelectorMode) => {
    if (readOnlyMode) return

    if (!user) {
      setIsAuthOpen(true)
      return
    }

    setSelectedPokemon(pokemon)
    setCardSelectorMode(mode)
    setIsCardSelectorOpen(true)
  }, [readOnlyMode, user])

  const handleQuickCollectSelectedPokemon = async () => {
    if (!selectedPokemon) return
    await handleQuickCollect({ id: selectedPokemon.id, name: selectedPokemon.name })
  }

  const handleRemoveSelectedPokemon = async () => {
    if (!selectedPokemon) return
    if (readOnlyMode) return

    if (!user) {
      setIsAuthOpen(true)
      return
    }

    await removeFromCollection(selectedPokemon.id)
  }

  const handleQuickCollect = async (pokemon: { id: number; name: string }) => {
    if (readOnlyMode) return
    if (!user) {
      setIsAuthOpen(true)
      return
    }

    const existingItem = getCollectionItem(pokemon.id)

    if (isCollected(pokemon.id)) {
      await removeFromCollection(pokemon.id)
    } else {
      await addToCollection(
        pokemon.id,
        pokemon.name,
        existingItem?.card_id,
        existingItem?.card_name,
        existingItem?.card_image,
        existingItem?.card_set,
        existingItem?.card_language ?? "en",
        "collected",
        {
          cardFinish: existingItem?.card_finish ?? "normal",
          wantedCards: existingItem?.wanted_cards ?? [],
        },
      )
    }
    setLongPressedPokemon(null)
  }

  const handleCollectSetCard = useCallback(async (slot: TCGSetDexSlot, card: TCGSetSlotCard) => {
    if (readOnlyMode) return
    if (!user) {
      setIsAuthOpen(true)
      return
    }

    const existingItem = getCollectionItem(slot.dexId)
    await addToCollection(
      slot.dexId,
      slot.pokemonName,
      card.id,
      card.name,
      card.image,
      card.set.name,
      card.language ?? "en",
      "collected",
      {
        cardFinish: card.inferredFinish,
        wantedCards: existingItem?.wanted_cards ?? [],
      },
    )
  }, [addToCollection, getCollectionItem, readOnlyMode, user])

  const handleWantSetCard = useCallback(async (slot: TCGSetDexSlot, card: TCGSetSlotCard) => {
    if (readOnlyMode) return
    if (!user) {
      setIsAuthOpen(true)
      return
    }

    await addWantedCard(
      slot.dexId,
      slot.pokemonName,
      {
        card_id: card.id,
        card_name: card.name,
        card_image: card.image,
        card_set: card.set.name,
        card_language: card.language ?? "en",
        card_finish: card.inferredFinish,
        rarity: card.rarity,
        local_id: card.localId,
        set_total: card.set.officialCardCount,
        added_at: new Date().toISOString(),
      },
    )
  }, [addWantedCard, readOnlyMode, user])

  const handleBrowseWantCard = useCallback(async (pokemon: { id: number; name: string }, card: TCGCard, isWanted: boolean) => {
    if (readOnlyMode) return
    if (!user) {
      setCardBrowser(null)
      setIsAuthOpen(true)
      return
    }
    if (isWanted) {
      await removeWantedCard(pokemon.id, card.id)
      return
    }
    await addWantedCard(pokemon.id, pokemon.name, {
      card_id: card.id,
      card_name: card.name,
      card_image: card.image,
      card_set: card.set.name,
      card_language: card.language ?? "en",
      card_finish: inferCardFinish(card.rarity, card.variants),
      rarity: card.rarity,
      local_id: card.localId,
      set_total: card.set.officialCardCount,
      added_at: new Date().toISOString(),
    })
  }, [addWantedCard, readOnlyMode, removeWantedCard, user])

  const handleBrowseAddCard = useCallback(async (pokemon: { id: number; name: string }, card: TCGCard) => {
    if (readOnlyMode) return
    if (!user) {
      setCardBrowser(null)
      setIsAuthOpen(true)
      return
    }
    const existingItem = getCollectionItem(pokemon.id)
    await addToCollection(
      pokemon.id,
      pokemon.name,
      card.id,
      card.name,
      card.image,
      card.set.name,
      card.language ?? "en",
      "collected",
      {
        cardFinish: inferCardFinish(card.rarity, card.variants),
        wantedCards: existingItem?.wanted_cards ?? [],
      },
    )
  }, [addToCollection, getCollectionItem, readOnlyMode, user])

  const handleGotWantedCard = useCallback(async (pokemonId: number, pokemonName: string, wantedCard: WantedCard) => {
    if (readOnlyMode) return
    if (!user) {
      setIsAuthOpen(true)
      return
    }

    const existingItem = getCollectionItem(pokemonId)
    const wantedKey = getWantedCardKey(wantedCard)
    const nextWantedCards = (existingItem?.wanted_cards ?? []).filter((card) => getWantedCardKey(card) !== wantedKey)

    await addToCollection(
      pokemonId,
      pokemonName,
      wantedCard.card_id,
      wantedCard.card_name,
      wantedCard.card_image,
      wantedCard.card_set,
      wantedCard.card_language ?? "en",
      "collected",
      {
        cardFinish: wantedCard.card_finish ?? "normal",
        wantedCards: nextWantedCards,
      },
    )
  }, [addToCollection, getCollectionItem, readOnlyMode, user])

  const handleClearWantedCard = useCallback(async (pokemonId: number, wantedCard: WantedCard) => {
    if (readOnlyMode) return
    if (!user) {
      setIsAuthOpen(true)
      return
    }

    const existingItem = getCollectionItem(pokemonId)
    if (!existingItem) return

    const wantedKey = getWantedCardKey(wantedCard)
    const nextWantedCards = existingItem.wanted_cards.filter((card) => getWantedCardKey(card) !== wantedKey)
    const existingIsOwned = existingItem.status !== "wishlisted"

    if (!existingIsOwned && nextWantedCards.length === 0) {
      await removeFromCollection(pokemonId)
      return
    }

    await addToCollection(
      pokemonId,
      existingItem.pokemon_name,
      existingIsOwned ? existingItem.card_id : undefined,
      existingIsOwned ? existingItem.card_name : undefined,
      existingIsOwned ? existingItem.card_image : undefined,
      existingIsOwned ? existingItem.card_set : undefined,
      existingItem.card_language ?? "en",
      existingIsOwned ? existingItem.status : "wishlisted",
      {
        cardFinish: existingItem.card_finish ?? "normal",
        wantedCards: nextWantedCards,
      },
    )
  }, [addToCollection, getCollectionItem, readOnlyMode, removeFromCollection, user])

  const handleCollectSetCards = useCallback(async (cards: Array<{ slot: TCGSetDexSlot; card: TCGSetSlotCard }>) => {
    for (const { slot, card } of cards) {
      await handleCollectSetCard(slot, card)
    }
  }, [handleCollectSetCard])

  const handleWantSetCards = useCallback(async (cards: Array<{ slot: TCGSetDexSlot; card: TCGSetSlotCard }>) => {
    for (const { slot, card } of cards) {
      await handleWantSetCard(slot, card)
    }
  }, [handleWantSetCard])

  const handleCardSelected = async (card: any | null, selectedMode: CardSelectorMode = cardSelectorMode, finish: CardFinish = "normal") => {
    if (!selectedPokemon) return
    if (readOnlyMode) return
    const pokemon = selectedPokemon
    const existingCollectionItem = collectionItem

    beginBinderCardSelection({
      onCloseSelector: () => setIsCardSelectorOpen(false),
      onCloseSelectedSlot: () => setSelectedPokemon(null),
    })

    setCardSelectorMode(selectedMode)
    if (selectedMode === "wishlist") {
      if (!card) {
        const firstWantedCardId = existingCollectionItem?.wanted_cards?.[0]?.card_id
        if (firstWantedCardId) {
          await removeWantedCard(pokemon.id, firstWantedCardId)
        }
      } else {
        await addWantedCard(
          pokemon.id,
          pokemon.name,
          {
            card_id: card.id,
            card_name: card.name,
            card_image: card.image,
            card_set: card.set?.name,
            card_language: card.language ?? "en",
            card_finish: finish,
            rarity: card.rarity,
            local_id: card.localId,
            set_total: card.set?.officialCardCount,
            added_at: new Date().toISOString(),
          },
        )
      }
    } else {
      await addToCollection(
        pokemon.id,
        pokemon.name,
        card?.id,
        card?.name,
        card?.image,
        card?.set?.name,
        card?.language ?? "en",
        "collected",
        {
          cardFinish: finish,
          wantedCards: existingCollectionItem?.wanted_cards ?? [],
        },
      )
    }
    setIsCardSelectorOpen(false)
  }

  const handleSelectedCardFinishChange = async (finish: CardFinish) => {
    if (!selectedPokemon || !collectionItem?.card_id || readOnlyMode) return
    if (!user) {
      setIsAuthOpen(true)
      return
    }
    if ((collectionItem.card_finish ?? "normal") === finish) return

    await addToCollection(
      selectedPokemon.id,
      selectedPokemon.name,
      collectionItem.card_id,
      collectionItem.card_name,
      collectionItem.card_image,
      collectionItem.card_set,
      collectionItem.card_language ?? "en",
      collectionItem.status,
      {
        cardFinish: finish,
        wantedCards: collectionItem.wanted_cards ?? [],
      },
    )
  }

  const handleToggleFavorite = useCallback(async (pokemonId: number) => {
    if (readOnlyMode) return
    const item = getCollectionItem(pokemonId)
    if (!item || item.status === "wishlisted" || !item.card_id) {
      return
    }

    const nextStatus: SlotStatus = item.status === "finalized" ? "collected" : "finalized"
    await updateStatus(pokemonId, nextStatus)
    setLongPressedPokemon(null)
  }, [getCollectionItem, readOnlyMode, updateStatus])

  const handleToggleFavoriteSelectedPokemon = useCallback(async () => {
    if (!selectedPokemon) return
    await handleToggleFavorite(selectedPokemon.id)
  }, [handleToggleFavorite, selectedPokemon])

  const handleSyncLocalCollectionToCloud = async () => {
    if (readOnlyMode) return
    if (!user) {
      setIsAuthOpen(true)
      return
    }

    const confirmed = window.confirm(
      `Replace the cloud binder (${collectionCount} collected) with this device's local collection (${localCollectedCount} collected)? This removes anything that exists only in the cloud binder.`
    )

    if (!confirmed) return

    setIsSyncingLocalCollection(true)
    setLocalCollectionSyncMessage(null)

    const result = await syncLocalCollectionToDatabase(pokemonList, {
      replaceRemote: true,
    })

    if (result.error) {
      setLocalCollectionSyncMessage("Could not sync local collection to the cloud.")
    } else if (result.data) {
      setLocalCollectionSyncMessage(
        `Cloud binder replaced: ${result.data.remoteCountBefore} -> ${result.data.remoteCountAfter} collected. Device source had ${result.data.localCount}. ${result.data.added} added, ${result.data.removed} removed.`
      )
    }

    setIsSyncingLocalCollection(false)
  }

  const handlePokemonSelect = useCallback((pokemon: PokemonSummary) => {
    setSelectedPokemon(pokemon)
    setActiveMainView("binder")
    setIsSearchOpen(false)
    const idx = pokemonList.findIndex(p => p.id === pokemon.id)
    if (idx !== -1) {
      const targetPage = Math.ceil((idx + 1) / slotsPerPage)
      setCurrentBinderPage(targetPage)
    }
  }, [pokemonList, slotsPerPage])

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
    const summary = getPokemonSummary(pokemon.id)
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
  }, [getCollectionItem, pokemonList, selectedPokemon?.id, settings.binderCols, slotsPerPage])

  const handleJumpBetweenTargets = useCallback((direction: "next" | "prev") => {
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
  }, [activeJumpPokemonList, currentPagePokemon, generationFilteredPokemonList, handlePokemonSelect, selectedPokemon])

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

    if (longPressedPokemon?.id === pokemon.id) {
      setLongPressedPokemon(null)
      return
    }

    const summary = getPokemonSummary(pokemon.id)
    if (summary) setSelectedPokemon(summary)
  }

  const handleLongPress = (pokemon: { id: number; name: string }) => {
    if (readOnlyMode) return
    setLongPressedPokemon(pokemon)
    if (navigator.vibrate) {
      navigator.vibrate(30)
    }
  }

  const handlePhotoButtonClick = () => {
    if (readOnlyMode) return
    if (!user) {
      setIsAuthOpen(true)
      return
    }

    if (isFilteredBinderLayout) {
      setPageScanError("Turn off the card-status filter before scanning a page photo.")
      return
    }

    if (window.isSecureContext && navigator.mediaDevices) {
      setCameraError(null)
      setPageScannerMode("slot-sweep")
      setSlotSweepSlotIndex(firstSweepSlotIndex)
      setSlotSweepCompletedSlotIndexes([])
      setSlotSweepMatchedCards([])
      setSlotSweepPreviewUrl(null)
      setBurstFramesProcessed(0)
      setBurstUsableFrames(0)
      setBurstPreviewResult(null)
      setIsBurstScannerOpen(true)
      return
    }

    pagePhotoInputRef.current?.click()
  }

  const getPageScanCardsForPokemon = useCallback((pokemonId: number) => {
    const existingPromise = pageScanCardCandidatesCacheRef.current.get(pokemonId)
    if (existingPromise) return existingPromise

    const cardsPromise = fetchCardsForPokemon(pokemonId, "en").then((cards) => cards.filter((card) => Boolean(card.image)))
    pageScanCardCandidatesCacheRef.current.set(pokemonId, cardsPromise)
    return cardsPromise
  }, [fetchCardsForPokemon])

  const getPageScanDescriptorForCard = useCallback((card: TCGCard) => {
    if (!card.image) {
      return Promise.resolve(null)
    }

    const existingPromise = pageScanCardDescriptorCacheRef.current.get(card.id)
    if (existingPromise) return existingPromise

    const proxyUrl = card.image.startsWith("/")
      ? card.image
      : `/api/card-image-proxy?url=${encodeURIComponent(card.image)}`
    const descriptorPromise = import("@/lib/card-image-match")
      .then(({ buildCardImageDescriptor }) => buildCardImageDescriptor(proxyUrl))
      .catch(() => null)

    pageScanCardDescriptorCacheRef.current.set(card.id, descriptorPromise)
    return descriptorPromise
  }, [])

  const getPageScanTextSignalsForCard = useCallback((card: TCGCard) => {
    const existingPromise = pageScanCardTextSignalCacheRef.current.get(card.id)
    if (existingPromise) return existingPromise

    const metadataSignals = buildCardMetadataTextSignals(card)
    const proxyUrl = card.image?.startsWith("/")
      ? card.image
      : card.image
        ? `/api/card-image-proxy?url=${encodeURIComponent(card.image)}`
        : null
    const textSignalPromise = proxyUrl
      ? import("@/lib/card-scan-ocr")
          .then(({ recognizeCardTextSignalsFromImage }) => recognizeCardTextSignalsFromImage(proxyUrl, { exhaustive: true }))
          .then((imageSignals) => mergeCardTextSignals([metadataSignals, imageSignals]) ?? metadataSignals)
          .catch((error) => {
            console.info("[binderdex] Skipping candidate card OCR scan:", error)
            return metadataSignals
          })
      : Promise.resolve(metadataSignals)

    pageScanCardTextSignalCacheRef.current.set(card.id, textSignalPromise)
    return textSignalPromise
  }, [])

  const getPageScanTextSignalsForCards = useCallback(async (
    candidateCards: TCGCard[],
    visualMatches: AggregatedCardScanMatch<TCGCard>[],
    querySignals: CardTextSignals | null | undefined,
  ) => {
    const textSignalMap = new Map(
      candidateCards.map((card) => [card.id, buildCardMetadataTextSignals(card)] as const),
    )
    const assetOcrCandidates = selectCandidateCardsForAssetTextOcr(candidateCards, visualMatches, querySignals, {
      getCardId: (card) => card.id,
      maxCards: PAGE_SCAN_CANDIDATE_ASSET_OCR_LIMIT,
    })

    for (const card of assetOcrCandidates) {
      textSignalMap.set(card.id, await getPageScanTextSignalsForCard(card))
    }

    return textSignalMap
  }, [getPageScanTextSignalsForCard])

  const scorePageScanSlotCard = useCallback(async (
    cardImageDataUrl: string,
    pokemon: { id: number; name: string },
  ): Promise<CardScanFrameMatch<TCGCard>[]> => {
    const candidates = await getPageScanCardsForPokemon(pokemon.id)
    if (candidates.length === 0) return []

    const { buildCardImageDescriptor, compareCardImageDescriptors } = await import("@/lib/card-image-match")
    const queryDescriptor = await buildCardImageDescriptor(cardImageDataUrl)
    const matches = await Promise.all(
      candidates.map(async (card) => {
        const descriptor = await getPageScanDescriptorForCard(card)
        if (!descriptor) return null

        const match = compareCardImageDescriptors(queryDescriptor, descriptor)
        return {
          card,
          similarity: match.similarity,
        }
      }),
    )

    return matches
      .filter((match): match is CardScanFrameMatch<TCGCard> => Boolean(match))
      .sort((left, right) => right.similarity - left.similarity)
      .slice(0, 6)
  }, [getPageScanCardsForPokemon, getPageScanDescriptorForCard])

  const readPageScanSlotTextSignals = useCallback(async (cardImageDataUrl: string): Promise<CardTextSignals | null> => {
    try {
      const { recognizeCardTextSignalsFromImage } = await import("@/lib/card-scan-ocr")
      return await recognizeCardTextSignalsFromImage(cardImageDataUrl, { exhaustive: true })
    } catch (error) {
      console.info("[binderdex] Skipping page slot OCR scan:", error)
      return null
    }
  }, [])

  const rankPageSlotMatchesWithText = useCallback(async (
    matches: AggregatedCardScanMatch<TCGCard>[],
    cardImageCandidates?: CardScanImageCandidate[],
    candidateCards?: TCGCard[],
  ): Promise<AggregatedCardScanMatch<TCGCard>[]> => {
    if (!cardImageCandidates || cardImageCandidates.length === 0 || (matches.length <= 1 && !candidateCards?.length)) return matches

    const topMargin = matches.length > 0 ? Math.abs(matches[0].similarity - (matches[1]?.similarity ?? 0)) : 0
    const cropLimit = topMargin < 0.08 ? PAGE_SCAN_OCR_AMBIGUOUS_CROP_LIMIT : PAGE_SCAN_OCR_BASE_CROP_LIMIT
    const evidenceImages = selectCardScanEvidenceImages(cardImageCandidates, cropLimit)
    const textSignals = mergeCardTextSignals(await Promise.all(
      evidenceImages.map((cardImageDataUrl) => readPageScanSlotTextSignals(cardImageDataUrl)),
    ))
    if (!textSignals) return matches
    const candidateTextSignals = candidateCards?.length
      ? await getPageScanTextSignalsForCards(candidateCards, matches, textSignals)
      : undefined

    return rankAggregatedCardScanMatchesWithText(matches, textSignals, {
      candidateCards,
      candidateTextSignals,
      getCardId: (card) => card.id,
    })
  }, [getPageScanTextSignalsForCards, readPageScanSlotTextSignals])

  const matchPageScanCards = useCallback(async (
    results: BinderPageScanResult[],
  ): Promise<PageScanCardMatchSummary[]> => {
    const slotFrames = new Map<number, CardScanFrameMatch<TCGCard>[][]>()
    const slotCropImagesByIndex = new Map<number, CardScanImageCandidate[]>()

    for (const result of results) {
      await Promise.all(
        result.slots.map(async (slot) => {
          const pokemon = currentPageSlots[slot.index]
          if (!slot.occupied || !slot.cardImageDataUrl || !pokemon) return
          const slotCropImages = slotCropImagesByIndex.get(slot.index) ?? []
          slotCropImages.push({ dataUrl: slot.cardImageDataUrl, quality: slot.confidence })
          slotCropImagesByIndex.set(slot.index, slotCropImages)

          try {
            const matches = await scorePageScanSlotCard(slot.cardImageDataUrl, pokemon)
            if (matches.length === 0) return

            const frameMatches = slotFrames.get(slot.index) ?? []
            frameMatches.push(matches)
            slotFrames.set(slot.index, frameMatches)
          } catch (error) {
            console.info("[binderdex] Skipping page slot card match:", error)
          }
        }),
      )
    }

    const aggregatedSlots = aggregatePageSlotScanMatches(
      [...slotFrames.entries()].map(([slotIndex, frameMatches]) => ({ slotIndex, frameMatches })),
      {
        getCardId: (card) => card.id,
        minimumAppearances: results.length > 1 ? Math.max(1, Math.ceil(results.length * 0.34)) : 1,
        minimumFrameSimilarity: 0.55,
        maxResultsPerSlot: 6,
      },
    )
    const aggregatedSlotMatchesByIndex = new Map(aggregatedSlots.map((slot) => [slot.slotIndex, slot.matches]))
    const slotIndexesToRank = [...new Set([
      ...slotCropImagesByIndex.keys(),
      ...aggregatedSlotMatchesByIndex.keys(),
    ])].sort((left, right) => left - right)

    const summaries = await Promise.all(slotIndexesToRank.map(async (slotIndex): Promise<PageScanCardMatchSummary | null> => {
      const pokemon = currentPageSlots[slotIndex]
      const candidateCards = pokemon ? await getPageScanCardsForPokemon(pokemon.id) : undefined
      const rankedMatches = await rankPageSlotMatchesWithText(
        aggregatedSlotMatchesByIndex.get(slotIndex) ?? [],
        slotCropImagesByIndex.get(slotIndex),
        candidateCards,
      )
      const match = rankedMatches[0]
      if (!match) return null

      return {
        slotIndex,
        slotLabel: getSlotLabel(Math.floor(slotIndex / settings.binderCols), slotIndex % settings.binderCols),
        cardId: match.card.id,
        cardName: match.card.name,
        setName: match.card.set.name,
        cardImage: match.card.image,
        similarity: match.similarity,
        confidence: match.confidence,
        margin: match.margin,
        appearanceRatio: match.appearanceRatio,
      }
    }))

    return summaries.filter((summary): summary is PageScanCardMatchSummary => Boolean(summary))
  }, [currentPageSlots, getPageScanCardsForPokemon, rankPageSlotMatchesWithText, scorePageScanSlotCard, settings.binderCols])

  const handlePagePhotoSelected = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ""

    if (!file) return
    if (readOnlyMode) return

    if (!user) {
      setIsAuthOpen(true)
      return
    }

    if (isFilteredBinderLayout) {
      setPageScanError("Turn off the card-status filter before scanning a page photo.")
      return
    }

    setIsScanningPage(true)
    setPageScanSummary(null)
    setPageScanError(null)

    try {
      const result = await scanBinderPageImage(file, settings.binderRows, settings.binderCols)
      const cardMatches = await matchPageScanCards([result])
      const matchedCardsBySlotIndex = new Map(
        cardMatches
          .filter((match) => canAutoAcceptCardScanMatch(match))
          .map((match) => [match.slotIndex, match]),
      )
      const mappedOccupiedSlots = result.slots
        .filter((slot) => slot.occupied)
        .map((slot) => ({ slotIndex: slot.index, pokemon: currentPageSlots[slot.index] }))
        .filter((slot): slot is { slotIndex: number; pokemon: { id: number; name: string } } => Boolean(slot.pokemon))

      let alreadyCollected = 0
      const slotsToCollect = mappedOccupiedSlots
        .filter(({ pokemon }) => {
          if (isCollected(pokemon.id)) {
            alreadyCollected += 1
            return false
          }

          return true
        })

      const collectResults = await Promise.all(
        slotsToCollect.map(({ pokemon, slotIndex }) => {
          const cardMatch = matchedCardsBySlotIndex.get(slotIndex)

          return addToCollection(
            pokemon.id,
            pokemon.name,
            cardMatch?.cardId,
            cardMatch?.cardName,
            cardMatch?.cardImage,
            cardMatch?.setName,
          )
        })
      )
      const newCollected = collectResults.filter((result) => !result?.error).length

      setPageScanSummary({
        detectedOccupied: mappedOccupiedSlots.length,
        newCollected,
        alreadyCollected,
        matchedCards: cardMatches.length,
        cardMatches,
        page: currentBinderPage,
      })
    } catch (error) {
      console.error("[binderdex] Error scanning page photo:", error)
      setPageScanError(error instanceof Error ? error.message : "Could not scan that page photo.")
    } finally {
      setIsScanningPage(false)
    }
  }, [
    addToCollection,
    currentBinderPage,
    currentPageSlots,
    isCollected,
    matchPageScanCards,
    settings.binderCols,
    settings.binderRows,
    isFilteredBinderLayout,
    readOnlyMode,
    user,
  ])

  const closeBurstScanner = useCallback(() => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop())
    cameraStreamRef.current = null
    if (burstVideoRef.current) {
      burstVideoRef.current.srcObject = null
    }
    setIsCameraReady(false)
    setIsCapturingBurst(false)
    setIsApplyingScanResults(false)
    setBurstFramesProcessed(0)
    setBurstUsableFrames(0)
    setBurstPreviewResult(null)
    setSlotSweepCompletedSlotIndexes([])
    setSlotSweepMatchedCards([])
    setSlotSweepPreviewUrl(null)
    setIsBurstScannerOpen(false)
  }, [])

  useEffect(() => {
    if (!isBurstScannerOpen) {
      return
    }

    let cancelled = false

    const startCamera = async () => {
      setCameraError(null)
      setIsCameraReady(false)

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        })

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }

        cameraStreamRef.current = stream
        if (burstVideoRef.current) {
          burstVideoRef.current.srcObject = stream
          await burstVideoRef.current.play()
        }
        setIsCameraReady(true)
      } catch (error) {
        setCameraError(error instanceof Error ? error.message : "Could not access the camera.")
      }
    }

    startCamera()

    return () => {
      cancelled = true
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop())
      cameraStreamRef.current = null
      if (burstVideoRef.current) {
        burstVideoRef.current.srcObject = null
      }
    }
  }, [isBurstScannerOpen])

  const advanceSlotSweep = useCallback((completedSlotIndexes: Set<number>, fromSlotIndex = slotSweepSlotIndex) => {
    const nextSlotIndex = getNextSweepSlotIndex(currentPageSlots, fromSlotIndex, completedSlotIndexes)

    if (nextSlotIndex !== null) {
      setSlotSweepSlotIndex(nextSlotIndex)
    } else {
      setCameraError("All slots on this page have been scanned or skipped.")
    }
  }, [currentPageSlots, slotSweepSlotIndex])

  const handleSlotSweepSkip = useCallback(() => {
    setCameraError(null)
    const nextSet = new Set(slotSweepCompletedSlotIndexes)
    nextSet.add(slotSweepSlotIndex)
    setSlotSweepCompletedSlotIndexes([...nextSet].sort((left, right) => left - right))
    advanceSlotSweep(nextSet)
  }, [advanceSlotSweep, slotSweepCompletedSlotIndexes, slotSweepSlotIndex])

  const handleSlotSweepCapture = useCallback(async () => {
    const video = burstVideoRef.current
    const canvas = burstCanvasRef.current
    const pokemon = currentPageSlots[slotSweepSlotIndex]

    if (readOnlyMode || !video || !canvas || !pokemon || !isCameraReady || isCapturingBurst) {
      return
    }

    setIsCapturingBurst(true)
    setIsScanningPage(true)
    setPageScanError(null)
    setCameraError(null)
    setBurstFramesProcessed(0)
    setBurstUsableFrames(0)
    setIsApplyingScanResults(false)

    try {
      const frameMatches: CardScanFrameMatch<TCGCard>[][] = []
      const slotFrames: BinderSlotSweepFrame<TCGCard>[] = []
      const previewCandidates: CardScanImageCandidate[] = []

      for (let index = 0; index < SLOT_SWEEP_FRAME_COUNT; index += 1) {
        setBurstFramesProcessed(index + 1)
        const frame = await captureGuidedSlotFrame(video, canvas, index)
        setSlotSweepPreviewUrl(frame.previewUrl)

        try {
          const matches = await scorePageScanSlotCard(frame.previewUrl, pokemon)
          previewCandidates.push({ dataUrl: frame.previewUrl, quality: matches[0]?.similarity ?? 0 })
          slotFrames.push({ slotIndex: slotSweepSlotIndex, matches })

          if (matches.length > 0) {
            frameMatches.push(matches)
            setBurstUsableFrames(frameMatches.length)
          }
        } catch (error) {
          console.info("[binderdex] Skipping slot sweep frame:", error)
          previewCandidates.push({ dataUrl: frame.previewUrl, quality: 0 })
          slotFrames.push({ slotIndex: slotSweepSlotIndex, matches: [] })
        }

        if (index < SLOT_SWEEP_FRAME_COUNT - 1) {
          await delay(SLOT_SWEEP_FRAME_DELAY_MS)
        }
      }

      if (slotFrames.length < SLOT_SWEEP_MIN_USABLE_FRAMES) {
        throw new Error(
          `Only got ${slotFrames.length} frame${slotFrames.length === 1 ? "" : "s"} for ${slotSweepTargetLabel}. Fill the card guide and try that slot again.`,
        )
      }

      setIsCapturingBurst(false)
      setIsApplyingScanResults(true)

      const sweepResult = aggregateBinderSlotSweep(slotFrames, {
        slotCount: currentPageSlots.length,
        getCardId: (card) => card.id,
        minimumFramesPerSlot: SLOT_SWEEP_MIN_USABLE_FRAMES,
        minimumAppearanceRatio: 0.45,
        minimumFrameSimilarity: 0.55,
        minimumConfidence: 0.58,
        minimumSimilarity: 0.56,
      })
      const slotResult = sweepResult.slots[slotSweepSlotIndex]
      let baseMatches = slotResult?.matches ?? []
      if (baseMatches.length === 0 && frameMatches.length > 0) {
        baseMatches = aggregateCardScanMatches(frameMatches, {
          getCardId: (card) => card.id,
          minimumAppearances: Math.max(2, Math.ceil(frameMatches.length * 0.45)),
          minimumFrameSimilarity: 0.55,
          maxResults: 6,
        })
      }
      const candidateCards = await getPageScanCardsForPokemon(pokemon.id)
      const rankedMatches = await rankPageSlotMatchesWithText(baseMatches, previewCandidates, candidateCards)
      const match = rankedMatches[0]

      if (!match || !canAutoAcceptCardScanMatch(match, { minimumConfidence: 0.58, minimumSimilarity: 0.56 })) {
        throw new Error(`Could not confidently match ${slotSweepTargetLabel}. Try again with less glare or skip it for now.`)
      }

      const existingItem = getCollectionItem(pokemon.id)
      const wasCollected = isCollected(pokemon.id)
      const saveResult = await addToCollection(
        pokemon.id,
        pokemon.name,
        match.card.id,
        match.card.name,
        match.card.image,
        match.card.set.name,
        "en",
        "collected",
        {
          cardFinish: existingItem?.card_finish ?? "normal",
          wantedCards: existingItem?.wanted_cards ?? [],
        },
      )

      if (saveResult?.error && !saveResult.queued) {
        throw new Error(saveResult.error)
      }

      const summaryMatch: PageScanCardMatchSummary = {
        slotIndex: slotSweepSlotIndex,
        slotLabel: slotSweepTargetLabel,
        cardId: match.card.id,
        cardName: match.card.name,
        setName: match.card.set.name,
        cardImage: match.card.image,
        similarity: match.similarity,
        confidence: match.confidence,
        margin: match.margin,
        appearanceRatio: match.appearanceRatio,
      }

      const nextMatchedCards = [
        ...slotSweepMatchedCards.filter((card) => card.slotIndex !== slotSweepSlotIndex),
        summaryMatch,
      ].sort((left, right) => left.slotIndex - right.slotIndex)
      setSlotSweepMatchedCards(nextMatchedCards)

      const nextCompletedSet = new Set(slotSweepCompletedSlotIndexes)
      nextCompletedSet.add(slotSweepSlotIndex)
      const nextCompletedIndexes = [...nextCompletedSet].sort((left, right) => left - right)
      setSlotSweepCompletedSlotIndexes(nextCompletedIndexes)
      setPageScanSummary((current) => ({
        detectedOccupied: nextCompletedIndexes.length,
        newCollected: (current?.newCollected ?? 0) + (wasCollected ? 0 : 1),
        alreadyCollected: (current?.alreadyCollected ?? 0) + (wasCollected ? 1 : 0),
        matchedCards: nextMatchedCards.length,
        cardMatches: nextMatchedCards,
        page: currentBinderPage,
      }))
      advanceSlotSweep(nextCompletedSet)
    } catch (error) {
      console.error("[binderdex] Error scanning slot sweep:", error)
      const message = error instanceof Error ? error.message : "Could not scan that slot."
      setPageScanError(message)
      setCameraError(message)
    } finally {
      setIsApplyingScanResults(false)
      setIsCapturingBurst(false)
      setIsScanningPage(false)
    }
  }, [
    addToCollection,
    advanceSlotSweep,
    currentBinderPage,
    currentPageSlots,
    getCollectionItem,
    getPageScanCardsForPokemon,
    isCameraReady,
    isCapturingBurst,
    isCollected,
    rankPageSlotMatchesWithText,
    readOnlyMode,
    scorePageScanSlotCard,
    slotSweepCompletedSlotIndexes,
    slotSweepMatchedCards,
    slotSweepSlotIndex,
    slotSweepTargetLabel,
  ])

  const handleBurstCapture = useCallback(async () => {
    const video = burstVideoRef.current
    const canvas = burstCanvasRef.current

    if (readOnlyMode || !video || !canvas || !isCameraReady || isCapturingBurst) {
      return
    }

    setIsCapturingBurst(true)
    setIsScanningPage(true)
    setPageScanSummary(null)
    setPageScanError(null)
    setCameraError(null)
    setBurstFramesProcessed(0)
    setBurstUsableFrames(0)
    setBurstPreviewResult(null)
    setIsApplyingScanResults(false)

    try {
      const successfulResults: Awaited<ReturnType<typeof scanBinderPageImage>>[] = []

      for (let index = 0; index < GUIDED_SCAN_FRAME_COUNT; index += 1) {
        setBurstFramesProcessed(index + 1)
        const guidedFrame = await captureGuidedFrameFile(video, canvas, index)
        let detectedResult: Awaited<ReturnType<typeof scanBinderPageImage>> | null = null

        try {
          detectedResult = await scanBinderPageImage(guidedFrame, settings.binderRows, settings.binderCols, {
            useGuidedGrid: true,
          })
        } catch {
          // Ignore bad frames and keep sampling for a longer guided scan.
        }

        if (detectedResult) {
          successfulResults.push(detectedResult)
          setBurstUsableFrames(successfulResults.length)
          setBurstPreviewResult(buildAggregatedBinderPageScanPreview(successfulResults, {
            voteRatio: GUIDED_SCAN_SLOT_VOTE_RATIO,
          }))
        }

        if (index < GUIDED_SCAN_FRAME_COUNT - 1) {
          await delay(GUIDED_SCAN_FRAME_DELAY_MS)
        }
      }

      if (successfulResults.length < GUIDED_SCAN_MIN_USABLE_FRAMES) {
        throw new Error(
          `Only got ${successfulResults.length} usable frame${successfulResults.length === 1 ? "" : "s"} in the guided scan. Hold one page fully inside the frame and keep it steady for longer.`,
        )
      }

      setIsCapturingBurst(false)
      setIsApplyingScanResults(true)
      const requiredVotes = Math.max(2, Math.ceil(successfulResults.length * GUIDED_SCAN_SLOT_VOTE_RATIO))
      const aggregatedSlots = aggregateBinderPageScanResults(successfulResults, { requiredVotes }).slots
      const cardMatches = await matchPageScanCards(successfulResults)
      const matchedCardsBySlotIndex = new Map(
        cardMatches
          .filter((match) => canAutoAcceptCardScanMatch(match))
          .map((match) => [match.slotIndex, match]),
      )
      const mappedOccupiedSlots = aggregatedSlots
        .map((slot, index) => slot.occupied ? { slotIndex: index, pokemon: currentPageSlots[index] } : null)
        .filter((slot): slot is { slotIndex: number; pokemon: { id: number; name: string } } => Boolean(slot?.pokemon))

      closeBurstScanner()

      let alreadyCollected = 0
      const slotsToCollect = mappedOccupiedSlots.filter(({ pokemon }) => {
        if (isCollected(pokemon.id)) {
          alreadyCollected += 1
          return false
        }

        return true
      })

      const collectResults = await Promise.all(
        slotsToCollect.map(({ pokemon, slotIndex }) => {
          const cardMatch = matchedCardsBySlotIndex.get(slotIndex)

          return addToCollection(
            pokemon.id,
            pokemon.name,
            cardMatch?.cardId,
            cardMatch?.cardName,
            cardMatch?.cardImage,
            cardMatch?.setName,
          )
        })
      )
      const newCollected = collectResults.filter((result) => !result?.error).length

      setPageScanSummary({
        detectedOccupied: mappedOccupiedSlots.length,
        newCollected,
        alreadyCollected,
        matchedCards: cardMatches.length,
        cardMatches,
        page: currentBinderPage,
      })
    } catch (error) {
      console.error("[binderdex] Error scanning page burst:", error)
      const message = error instanceof Error ? error.message : "Could not scan that page burst."
      setPageScanError(message)
      setCameraError(message)
    } finally {
      setIsApplyingScanResults(false)
      setIsCapturingBurst(false)
      setIsScanningPage(false)
    }
  }, [
    addToCollection,
    closeBurstScanner,
    currentBinderPage,
    currentPageSlots,
    isCameraReady,
    isCapturingBurst,
    isCollected,
    matchPageScanCards,
    settings.binderRows,
    readOnlyMode,
    settings.binderCols,
  ])

  const toggleDarkMode = () => {
    const next = !isDarkMode
    setIsDarkMode(next)
    if (!readOnlyMode) {
      void updateSettings({ darkMode: next })
    }
    document.documentElement.classList.toggle("dark", next)
    const maxAge = 60 * 60 * 24 * 365
    document.cookie = `binderdex_theme=${next ? "dark" : "light"}; path=/; max-age=${maxAge}; samesite=lax`
  }

  useEffect(() => {
    setIsDarkMode(settings.darkMode)
  }, [settings.darkMode])

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDarkMode)

    const head = document.head
    let themeColorMeta = head.querySelector<HTMLMetaElement>('meta[name="theme-color"][data-binderdex-runtime-theme="true"]')

    if (!themeColorMeta) {
      themeColorMeta = document.createElement("meta")
      themeColorMeta.name = "theme-color"
      themeColorMeta.dataset.binderdexRuntimeTheme = "true"
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
      setPwaStatusMessage("BinderDex is ready to install for better offline use.")
    }
    const handleAppInstalled = () => {
      setInstallPromptEvent(null)
      setIsInstalledApp(true)
      setPwaStatusMessage("BinderDex installed. The app shell and cached assets are now available offline.")
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
          console.error("[binderdex] Failed to warm offline cache:", error)
        })
    }, 1200)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [offlineCacheWarmupSignature, offlineCacheWarmupUrls])

  const handleInstallApp = useCallback(async () => {
    if (!installPromptEvent) {
      setPwaStatusMessage("Use your browser's Add to Home Screen option to install BinderDex.")
      return
    }

    try {
      await installPromptEvent.prompt()
      const { outcome } = await installPromptEvent.userChoice
      if (outcome === "accepted") {
        setPwaStatusMessage("Install started. BinderDex will open like an app once added.")
      } else {
        setPwaStatusMessage("Install prompt dismissed.")
      }
    } catch (error) {
      console.error("[binderdex] Failed to install app:", error)
      setPwaStatusMessage("Could not open the install prompt.")
    } finally {
      setInstallPromptEvent(null)
    }
  }, [installPromptEvent])

  useEffect(() => {
    if (readOnlyMode || !user) {
      if (!readOnlyMode) {
        setSharePath(null)
        setIsShareEnabled(false)
        setShareMessage(null)
      }
      return
    }

    let cancelled = false

    const loadShareState = async () => {
      setIsShareLoading(true)
      setShareMessage(null)

      try {
        const response = await fetch("/api/binder-share", {
          cache: "no-store",
        })
        const payload = await response.json().catch(() => null)

        if (!response.ok) {
          throw new Error(payload?.error || `Failed to load share link (${response.status})`)
        }

        if (cancelled) return

        setSharePath(payload?.share?.path ?? null)
        setIsShareEnabled(Boolean(payload?.share?.is_enabled))
      } catch (error) {
        if (!cancelled) {
          setShareMessage(error instanceof Error ? error.message : "Could not load the share link.")
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
  }, [readOnlyMode, user])

  const handleEnableReadOnlyShare = useCallback(async () => {
    if (readOnlyMode || !user) return

    setIsShareLoading(true)
    setShareMessage(null)
    setShareCopyMessage(null)

    try {
      const response = await fetch("/api/binder-share", {
        method: "POST",
      })
      const payload = await response.json().catch(() => null)

      if (!response.ok) {
        throw new Error(payload?.error || `Failed to enable share link (${response.status})`)
      }

      setSharePath(payload?.share?.path ?? null)
      setIsShareEnabled(Boolean(payload?.share?.is_enabled))
      setShareMessage("Read-only share link is live.")
    } catch (error) {
      setShareMessage(error instanceof Error ? error.message : "Could not enable the share link.")
    } finally {
      setIsShareLoading(false)
    }
  }, [readOnlyMode, user])

  const handleCopyReadOnlyShareLink = useCallback(async () => {
    if (!fullShareUrl) {
      setShareCopyMessage("Generate a share link first.")
      return
    }

    try {
      await navigator.clipboard.writeText(fullShareUrl)
      setShareCopyMessage("Share link copied.")
      setShareMessage(null)
    } catch {
      setShareCopyMessage("Could not copy the share link.")
    }
  }, [fullShareUrl])

  const handleDisableReadOnlyShare = useCallback(async () => {
    if (readOnlyMode || !user) return

    setIsShareLoading(true)
    setShareMessage(null)
    setShareCopyMessage(null)

    try {
      const response = await fetch("/api/binder-share", {
        method: "DELETE",
      })
      const payload = await response.json().catch(() => null)

      if (!response.ok) {
        throw new Error(payload?.error || `Failed to disable share link (${response.status})`)
      }

      setSharePath(payload?.share?.path ?? sharePath)
      setIsShareEnabled(false)
      setShareMessage("Read-only share link disabled.")
    } catch (error) {
      setShareMessage(error instanceof Error ? error.message : "Could not disable the share link.")
    } finally {
      setIsShareLoading(false)
    }
  }, [readOnlyMode, sharePath, user])

  const handleRefreshPrices = useCallback(async () => {
    if (readOnlyMode) return
    if (!user) {
      setIsAuthOpen(true)
      return
    }

    setIsRefreshingPrices(true)
    setPriceRefreshMessage(null)

    try {
      const response = await fetch("/api/card-prices/refresh", {
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
  const selectedPokemonDisplayImage = selectedPokemon ? getDetailArtwork(selectedPokemon, collectionItem?.card_image) : null
  const selectedPokemonDisplayFit = getDisplayArtworkFit(collectionItem?.card_image)
  const selectedPokemonDisplayTone = getDisplayArtworkTone(collectionItem?.status)
  const selectedCardPriceKey = getCollectionItemPriceKey(collectionItem)
  const selectedAssignedPriceSnapshot = selectedCardPriceKey ? pricesByCardId[selectedCardPriceKey] : undefined
  const selectedCardPriceLabel = formatPriceLabel(selectedAssignedPriceSnapshot)
  const selectedWantedCards = collectionItem?.wanted_cards ?? []
  const selectedWantedCardPreview = selectedWantedCards[0] ?? null
  const selectedSlotCardDisplay = getSelectedSlotCardDisplay(collectionItem)
  const selectedPrimaryCardPreview = selectedSlotCardDisplay.primaryCard
  const selectedCurrentCardPreview = selectedSlotCardDisplay.currentCard
  const selectedHasWantedCard = Boolean(selectedWantedCardPreview)
  const selectedWantedPriceSnapshot = selectedWantedCardPreview
    ? pricesByCardId[getCardPriceKey(selectedWantedCardPreview.card_id, selectedWantedCardPreview.card_language ?? "en")]
    : undefined
  const selectedWantedPriceLabel = (() => {
    if (selectedWantedCards.length === 0) {
      return null
    }

    if (selectedWantedCards.length === 1) {
      const [card] = selectedWantedCards
      return formatPriceLabel(pricesByCardId[getCardPriceKey(card.card_id, card.card_language ?? "en")])
    }

    const selectedWantedPriceSummary = sumPriceSnapshots(
      selectedWantedCards.map((card) => pricesByCardId[getCardPriceKey(card.card_id, card.card_language ?? "en")]),
    )
    return formatPriceTotals(selectedWantedPriceSummary.gbpTotal, selectedWantedPriceSummary.originalTotals) || null
  })()
  const selectedWantedPriceChipLabel = selectedWantedCards.length > 0
    ? selectedWantedPriceLabel ?? (isLoadingPrices ? "Loading price..." : "No price yet")
    : null
  const selectedAssignedPriceChipLabel = selectedCardPriceLabel ?? (isLoadingPrices && collectionItem?.card_id ? "Loading price..." : null)
  const selectedDetailPriceLabel = selectedHasWantedCard
    ? selectedWantedPriceChipLabel ?? selectedAssignedPriceChipLabel
    : selectedAssignedPriceChipLabel
  const selectedDetailPriceSnapshot = selectedHasWantedCard
    ? selectedWantedPriceSnapshot ?? selectedAssignedPriceSnapshot
    : selectedAssignedPriceSnapshot
  const selectedMarketPriceLabel = formatGbpPriceAmount(selectedDetailPriceSnapshot?.marketGbpAmount ?? selectedDetailPriceSnapshot?.gbpAmount)
  const selectedGoodPriceLabel = formatGbpPriceAmount(selectedDetailPriceSnapshot?.goodGbpAmount)
  const selectedRangePriceLabel = formatGbpPriceRange(selectedDetailPriceSnapshot?.lowGbpAmount, selectedDetailPriceSnapshot?.highGbpAmount)
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
    const edgePadding = Math.max(16, navBottom + 10)
    const bottomClearance = 16
    const verticalGap = 14
    const spaceAbove = slotRect.top - edgePadding - verticalGap
    const spaceBelow = viewportHeight - slotRect.bottom - bottomClearance - verticalGap
    const placeBelow = spaceBelow >= panelRect.height || spaceBelow > spaceAbove
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
      : slotRect.top - panelRect.height - verticalGap
    top = Math.max(edgePadding, Math.min(top, viewportHeight - panelRect.height - bottomClearance))

    setQuickPanelPosition((current) => {
      if (current && Math.abs(current.top - top) < 1 && Math.abs(current.left - left) < 1) {
        return current
      }

      return { top, left }
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

    window.addEventListener("resize", updateQuickPanelPosition, { passive: true })
    window.addEventListener("scroll", updateQuickPanelPosition, { passive: true })

    return () => {
      window.cancelAnimationFrame(frame)
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
  const filterSheetRef = useRef<HTMLDivElement | null>(null)
  const burstScannerRef = useRef<HTMLDivElement | null>(null)
  const closeSelectedPokemon = useCallback(() => setSelectedPokemon(null), [])
  const closeSearch = useCallback(() => setIsSearchOpen(false), [])
  const closeControlsSheet = useCallback(() => setIsMobileNavExpanded(false), [])
  const closeFilterSheet = useCallback(() => setIsMobileFilterSheetOpen(false), [])
  const closeBurstScannerSafely = useCallback(() => {
    if (isCapturingBurst || isApplyingScanResults) return
    closeBurstScanner()
  }, [closeBurstScanner, isApplyingScanResults, isCapturingBurst])
  const isQuickPanelOpen = Boolean(selectedPokemon) && !isSearchOpen
  const isMobileQuickPanel = isQuickPanelOpen && !isDesktopViewport
  // The card selector and the all-cards view open on top of the card detail, which stays mounted but hidden.
  const isQuickPanelCovered = isCardSelectorOpen || Boolean(cardBrowser?.nested)

  // Card detail: a popover next to the slot on desktop, a modal bottom sheet on mobile.
  useOverlay(isQuickPanelOpen, closeSelectedPokemon, {
    containerRef: quickPanelRef,
    lockScroll: !isDesktopViewport,
    trapFocus: !isDesktopViewport && !isQuickPanelCovered,
    autoFocus: !isDesktopViewport,
  })
  useOverlay(isSearchOpen, closeSearch, { containerRef: searchDialogRef, autoFocus: false })
  useOverlay(isMobileNavExpanded && !isSearchOpen, closeControlsSheet, { containerRef: controlsSheetRef })
  useOverlay(isMobileFilterSheetOpen && !isSearchOpen, closeFilterSheet, { containerRef: filterSheetRef })
  useOverlay(isBurstScannerOpen, closeBurstScannerSafely, { containerRef: burstScannerRef })
  const quickPanelSwipe = useSwipeToDismiss(quickPanelRef, closeSelectedPokemon, isMobileQuickPanel)
  const closeCardBrowser = useCallback(() => setCardBrowser(null), [])
  const controlsSheetSwipe = useSwipeToDismiss(controlsSheetRef, closeControlsSheet)
  const filterSheetSwipe = useSwipeToDismiss(filterSheetRef, closeFilterSheet)

  /** Close every open overlay first so sheets/modals never stack on top of each other. */
  const openExclusively = useCallback((open: () => void) => {
    closeAllOverlays()
    setLongPressedPokemon(null)
    open()
  }, [])

  /** Switch main view (dock tab / desktop tab), closing any open overlay and card detail. */
  const switchMainView = useCallback((view: ActiveMainView) => {
    closeAllOverlays()
    setCardBrowser(null)
    setSelectedPokemon(null)
    setLongPressedPokemon(null)
    setIsSearchOpen(false)
    setIsMobileNavExpanded(false)
    setIsMobileFilterSheetOpen(false)
    setActiveMainView(view)
  }, [])

  /** Open the read-only all-cards view. From the card detail it stacks one level; otherwise it replaces any overlay. */
  // Offline card search: own cards plus card data the service worker has cached (read lazily, per search session).
  const getOfflineSearchCards = useCallback(
    () => import("@/lib/offline-card-index").then(({ buildOfflineCardIndex }) => buildOfflineCardIndex(collection)),
    [collection],
  )

  const openCardBrowser = useCallback((
    pokemon: { id: number; name: string },
    options: { highlightCardId?: string | null; fromDetail?: boolean } = {},
  ) => {
    if (options.fromDetail) {
      setCardBrowser({ pokemon, highlightCardId: options.highlightCardId ?? null, nested: true })
      return
    }
    openExclusively(() => {
      setSelectedPokemon(null)
      setCardBrowser({ pokemon, highlightCardId: options.highlightCardId ?? null, nested: false })
    })
  }, [openExclusively])

  const openSearch = useCallback(() => {
    openExclusively(() => {
      setSelectedPokemon(null)
      setIsSearchOpen(true)
    })
  }, [openExclusively])

  // Full-screen dialogs replace the card detail instead of stacking on top of it.
  useEffect(() => {
    if (isSettingsOpen || isAuthOpen || isPartnerOpen || isMobileNavExpanded || isMobileFilterSheetOpen) {
      setSelectedPokemon(null)
      setLongPressedPokemon(null)
    }
  }, [isAuthOpen, isMobileFilterSheetOpen, isMobileNavExpanded, isPartnerOpen, isSettingsOpen])

  const renderSelectedPokemonQuickPanel = () => {
    if (!selectedPokemon || isSearchOpen || typeof document === "undefined") {
      return null
    }

    const selectedStatusPill =
      selectedHasWantedCard
        ? { label: "Wanted", className: "border-amber-500/25 bg-amber-500/10 text-amber-400" }
        : selectedPokemonIsFavorite
          ? { label: "Perfect", className: "border-amber-500/25 bg-amber-500/10 text-amber-400" }
          : collected
            ? { label: "Owned", className: "border-emerald-500/25 bg-emerald-500/10 text-emerald-400" }
            : { label: "Open Slot", className: "border-border/60 bg-background/35 text-muted-foreground" }

    const selectedCardSummaryLabel =
      selectedHasWantedCard && selectedPrimaryCardPreview?.cardName
        ? `Wanted card: ${selectedPrimaryCardPreview.cardName}`
          : collectionItem?.card_name
            ? collectionItem.card_name.toLowerCase() === selectedPokemon.name.toLowerCase()
              ? selectedPokemonHasAssignedCard
                ? "Assigned card selected"
                : "Tracked card selected"
              : collectionItem.card_name
            : collected
              ? "No card assigned yet"
              : "Choose how you want to track this slot."
    const selectedPreviewImage = selectedPrimaryCardPreview?.cardImage ?? selectedPokemonDisplayImage ?? getDetailArtwork(selectedPokemon)
    const selectedPreviewAlt = selectedPrimaryCardPreview?.cardName ?? selectedPokemonDisplayName
    const selectedPreviewIsCard = Boolean(selectedPrimaryCardPreview?.cardImage)
    const selectedPreviewTone = selectedPreviewIsCard ? "" : selectedPokemonDisplayTone
    const selectedPreviewFit = selectedPreviewIsCard ? "object-cover" : selectedPokemonDisplayFit
    const selectedPreviewFrameClass = selectedPreviewIsCard
      ? "trading-card w-[4.6rem] sm:w-[3.35rem]"
      : "h-20 w-20 rounded-2xl sm:h-14 sm:w-14"
    const selectedPreviewImageClass = selectedPreviewIsCard
      ? "absolute inset-0 h-full w-full"
      : "absolute inset-1 max-w-[calc(100%-0.5rem)] max-h-[calc(100%-0.5rem)] m-auto"
    const selectedPreviewBadgeClass = selectedPreviewIsCard ? "-top-1.5 -right-1.5" : "-top-1 -right-1"
    const selectedPrimarySetLabel = selectedPrimaryCardPreview?.cardSet
    const selectedPrimaryLanguageLabel = selectedPrimaryCardPreview?.cardLanguage
    const selectedPrimaryFinishLabel = selectedPrimaryCardPreview?.cardFinish
    const selectedDetailChips = [
      selectedPrimarySetLabel ? { key: "set", label: selectedPrimarySetLabel } : null,
      selectedPrimaryLanguageLabel ? { key: "language", label: formatCardLanguageLabel(selectedPrimaryLanguageLabel) } : null,
      selectedPrimaryFinishLabel ? { key: "finish", label: formatCardFinishLabel(selectedPrimaryFinishLabel) } : null,
      collectionItem?.wanted_cards?.length ? { key: "wanted", label: `${collectionItem.wanted_cards.length} wanted` } : null,
      selectedDetailPriceLabel ? { key: "price", label: selectedDetailPriceLabel } : null,
      selectedCollectedDateLabel ? { key: "collected", label: `Collected ${selectedCollectedDateLabel}` } : null,
    ].filter((value): value is { key: string; label: string } => Boolean(value))

    const panelHelperText = readOnlyMode
      ? "This shared binder is read-only. You can browse, search, filter, and view prices, but only the owner can change collection state."
      : collected
        ? "Add or edit the card for this slot, or clear it if you no longer have one."
        : "Add card saves your chosen card, Mark owned leaves it cardless, and Wanted card tracks a card without counting it as owned."

    const quickPanel = (
      <>
      {!isDesktopViewport && !isQuickPanelCovered ? (
        <div
          aria-hidden="true"
          data-overlay-backdrop
          className="fixed inset-0 z-[35] bg-black/45 backdrop-blur-[2px]"
          onClick={closeSelectedPokemon}
        />
      ) : null}
      <div
        ref={quickPanelRef}
        role="dialog"
        aria-modal={!isDesktopViewport}
        aria-label={`${selectedPokemonDisplayName} details`}
        // Stay mounted (but hidden) under the card selector / all-cards view so focus can return here.
        className={`fixed z-40 ${isQuickPanelCovered ? "hidden" : "flex"} max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-1.5rem)] w-[min(calc(100vw-1.5rem),28rem)] flex-col overflow-hidden outline-none transition-[top,left,transform] duration-200 ease-out sm:w-[min(calc(100vw-2rem),24rem)]`}
        style={quickPanelPosition
          ? {
              top: quickPanelPosition.top,
              left: quickPanelPosition.left,
            }
          : isDesktopViewport
            ? {
                left: "50%",
                bottom: "1rem",
                transform: "translateX(-50%)",
              }
            : {
                left: "50%",
                bottom: "calc(var(--dock-clearance) + 0.375rem)",
                transform: "translateX(-50%)",
                width: "min(calc(100vw - 1rem), 28rem)",
                // Never taller than the space between the status bar and the bottom dock.
                maxHeight: "calc(100dvh - env(safe-area-inset-top) - var(--dock-clearance) - 0.375rem - 0.5rem)",
              }}
      >
        <div className="flex min-h-0 flex-col rounded-[1.35rem] border border-border/70 bg-card/96 p-3 text-foreground shadow-[0_28px_70px_-34px_rgba(15,23,42,0.28)] backdrop-blur-xl sm:rounded-[1.6rem] dark:bg-card/96 dark:shadow-[0_28px_70px_-34px_rgba(0,0,0,0.55)]">
          <div className="flex min-h-0 flex-col gap-3">
            <div className="shrink-0" data-sheet-grabber={isMobileQuickPanel ? "" : undefined} {...(isMobileQuickPanel ? quickPanelSwipe : {})}>
            {isMobileQuickPanel ? <div aria-hidden="true" className="mx-auto -mt-1 mb-2 h-1.5 w-10 rounded-full bg-muted-foreground/30" /> : null}
            <div className="flex items-start gap-3">
              <div className={`relative mt-0.5 flex shrink-0 items-center justify-center overflow-hidden border border-border/60 bg-background/45 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] dark:border-white/10 dark:bg-white/[0.04] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] ${selectedPreviewFrameClass}`}>
                <img
                  src={selectedPreviewImage}
                  alt={selectedPreviewAlt}
                  className={`${selectedPreviewImageClass} ${selectedPreviewFit} ${selectedPreviewTone}`}
                />
                {collected && !selectedPreviewIsCard && (
                  <div className={`absolute w-4 h-4 bg-green-500 rounded-full flex items-center justify-center shadow ${selectedPreviewBadgeClass}`}>
                    <Check className="w-2.5 h-2.5 text-white" />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold tracking-[0.16em] text-muted-foreground">#{String(selectedPokemon.id).padStart(4, "0")}</p>
                    <h3 className="truncate text-[1.05rem] font-bold leading-tight tracking-tight">{selectedPokemonDisplayName}</h3>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-9 shrink-0 gap-1 rounded-xl px-2 text-xs font-semibold text-muted-foreground hover:bg-background/60 hover:text-foreground dark:hover:bg-white/[0.04]"
                      onClick={() => openCardBrowser({ id: selectedPokemon.id, name: selectedPokemon.name }, { fromDetail: true })}
                      aria-label={`All ${selectedPokemonDisplayName} cards`}
                    >
                      <Layers3 className="h-4 w-4" />
                      <span className="hidden min-[360px]:inline">All cards</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 shrink-0 rounded-xl text-muted-foreground hover:bg-background/60 hover:text-foreground dark:hover:bg-white/[0.04]"
                      onClick={closeSelectedPokemon}
                      aria-label="Close card details"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${selectedStatusPill.className}`}>
                    {selectedStatusPill.label}
                  </span>
                  {collectionItem?.card_name ? (
                    <span className="rounded-full border border-border/60 bg-background/35 px-2.5 py-1 text-[10px] font-medium text-muted-foreground dark:border-white/10 dark:bg-white/[0.04]">
                      {selectedPokemonHasAssignedCard ? "Assigned Card" : "Tracked Card"}
                    </span>
                  ) : null}
                </div>
                <p className={`mt-1.5 min-h-[1rem] truncate text-[11px] leading-relaxed ${
                  selectedHasWantedCard
                    ? "text-amber-400"
                  : collectionItem?.card_name
                      ? "text-sky-300"
                      : "text-muted-foreground"
                }`}>
                  {selectedCardSummaryLabel}
                </p>
                {selectedDetailChips.length > 0 ? (
                  <div className="mt-2 flex items-center gap-1.5 overflow-x-auto scrollbar-hide sm:flex-wrap">
                    {selectedDetailChips.map((detailChip) => (
                      <span
                        key={detailChip.key}
                        className="shrink-0 rounded-full border border-border/60 bg-background/35 px-2.5 py-1 text-[10px] font-medium text-muted-foreground dark:border-white/10 dark:bg-white/[0.04]"
                      >
                        {detailChip.label}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
            </div>
            <div className="-mx-3 -mb-3 flex min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain px-3 pb-3" style={{ WebkitOverflowScrolling: "touch" }}>
            {selectedCurrentCardPreview ? (
              <div className="flex items-center gap-2 rounded-2xl border border-border/60 bg-background/25 p-2 dark:border-white/10 dark:bg-white/[0.03]">
                <div className="trading-card relative w-10 shrink-0 border border-border/60 bg-muted dark:border-white/10">
                  {selectedCurrentCardPreview.cardImage ? (
                    <img
                      src={selectedCurrentCardPreview.cardImage}
                      alt={selectedCurrentCardPreview.cardName}
                      className="absolute inset-0 h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-muted text-[9px] text-muted-foreground">No image</div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Current card</p>
                    {selectedAssignedPriceChipLabel ? (
                      <span className="shrink-0 rounded-full border border-border/60 bg-background/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground dark:border-white/10 dark:bg-white/[0.04]">
                        {selectedAssignedPriceChipLabel}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 truncate text-xs font-semibold">{selectedCurrentCardPreview.cardName}</p>
                  <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                    {[
                      selectedCurrentCardPreview.cardSet,
                      formatCardLanguageLabel(selectedCurrentCardPreview.cardLanguage),
                      formatCardFinishLabel(selectedCurrentCardPreview.cardFinish),
                    ].filter(Boolean).join(" · ")}
                  </p>
                </div>
              </div>
            ) : null}
            {!readOnlyMode && selectedPokemonHasAssignedCard ? (
              <div className="rounded-2xl border border-border/60 bg-background/25 p-2 dark:border-white/10 dark:bg-white/[0.03]">
                <div className="mb-2 flex items-center justify-between gap-2 px-1">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Variant</span>
                  <span className="truncate text-[10px] text-muted-foreground">
                    {formatCardFinishLabel(collectionItem?.card_finish)}
                  </span>
                </div>
                <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-hide">
                  {CARD_FINISH_OPTIONS.map((finishOption) => {
                    const isActive = (collectionItem?.card_finish ?? "normal") === finishOption.id

                    return (
                      <button
                        key={finishOption.id}
                        type="button"
                        onClick={() => handleSelectedCardFinishChange(finishOption.id)}
                        disabled={isCollectionLoading || isActive}
                        aria-pressed={isActive}
                        className={`h-8 shrink-0 rounded-xl border px-3 text-[11px] font-semibold transition-colors disabled:pointer-events-none ${
                          isActive
                            ? "border-primary/55 bg-primary text-primary-foreground shadow-sm"
                            : "border-border/60 bg-background/55 text-muted-foreground hover:bg-background/80 hover:text-foreground dark:border-white/10 dark:bg-white/[0.04] dark:hover:bg-white/[0.07]"
                        }`}
                      >
                        {finishOption.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : null}
            {(selectedMarketPriceLabel || selectedGoodPriceLabel || (isLoadingPrices && (collectionItem?.card_id || selectedWantedCardPreview?.card_id))) ? (
              <div className="rounded-2xl border border-border/60 bg-background/25 p-2.5 dark:border-white/10 dark:bg-white/[0.03]">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-border/50 bg-background/45 px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Low</p>
                    <p className="mt-0.5 text-sm font-bold tabular-nums text-emerald-600 dark:text-emerald-300">
                      {selectedGoodPriceLabel ?? (isLoadingPrices ? "Loading" : "No price")}
                    </p>
                  </div>
                  <div className="rounded-xl border border-border/50 bg-background/45 px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Market</p>
                    <p className="mt-0.5 text-sm font-bold tabular-nums">
                      {selectedMarketPriceLabel ?? (isLoadingPrices ? "Loading" : "No price")}
                    </p>
                  </div>
                </div>
                {(selectedRangePriceLabel || selectedConfidenceLabel) ? (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 px-1 text-[10px] text-muted-foreground">
                    {selectedRangePriceLabel ? (
                      <span className="rounded-full border border-border/50 bg-background/35 px-2 py-0.5 dark:border-white/10 dark:bg-white/[0.04]">
                        Range {selectedRangePriceLabel}
                      </span>
                    ) : null}
                    {selectedConfidenceLabel ? (
                      <span className="rounded-full border border-border/50 bg-background/35 px-2 py-0.5 dark:border-white/10 dark:bg-white/[0.04]">
                        {selectedConfidenceLabel}
                      </span>
                    ) : null}
                  </div>
                ) : null}
                {selectedPriceSourceLabel ? (
                  <p className="mt-2 truncate px-1 text-[10px] text-muted-foreground">{selectedPriceSourceLabel}</p>
                ) : null}
                <CardPriceEvidence price={selectedDetailPriceSnapshot} />
              </div>
            ) : null}
            {/* On phones the actions come first so they are reachable without scrolling past prices. */}
            <div data-testid="detail-actions" className="flex flex-col gap-2.5 max-sm:order-first">
              <div className="grid grid-cols-[1fr_auto] items-center gap-2">
                <div className="flex items-center rounded-2xl border border-border/60 bg-background/35 p-1 dark:border-white/10 dark:bg-white/[0.04]">
                  <Button
                    onClick={handleJumpToPreviousNeeded}
                    disabled={activeJumpPokemonList.length === 0}
                    variant="ghost"
                    size="sm"
                    className="h-9 rounded-xl gap-1.5 px-3 text-xs hover:bg-background/70 dark:hover:bg-white/[0.05]"
                  >
                    <ChevronLeft className="h-3 w-3" />
                    <span>Prev</span>
                  </Button>
                  <div className="h-5 w-px bg-border/60 dark:bg-white/10" />
                  <Button
                    onClick={handleJumpToNextNeeded}
                    disabled={activeJumpPokemonList.length === 0}
                    variant="ghost"
                    size="sm"
                    className="h-9 rounded-xl gap-1.5 px-3 text-xs hover:bg-background/70 dark:hover:bg-white/[0.05]"
                  >
                    <span>Next</span>
                    <ChevronRight className="h-3 w-3" />
                  </Button>
                </div>

                {!readOnlyMode && (collected || wishlisted) && (
                  <Button
                    onClick={handleRemoveSelectedPokemon}
                    disabled={isCollectionLoading}
                    variant="outline"
                    size="sm"
                    className="h-9 shrink-0 rounded-xl gap-1 border-destructive/25 bg-destructive/8 px-3 text-xs text-destructive shadow-none hover:bg-destructive/12 hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                    Clear
                  </Button>
                )}
              </div>

              <div className="rounded-2xl border border-border/60 bg-background/25 p-2 dark:border-white/10 dark:bg-white/[0.03]">
              <div className="flex flex-col gap-2">
                {!readOnlyMode && (
                  <>
                    {collected ? (
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          onClick={handleOpenCardSelector}
                          disabled={isCollectionLoading}
                          variant="default"
                          size="sm"
                          className="h-11 rounded-xl gap-1.5 px-3 text-xs shadow-sm"
                        >
                          <Check className="w-3.5 h-3.5" />
                          {selectedPokemonHasAssignedCard ? "Edit card" : "Add card"}
                        </Button>
                        <Button
                          onClick={handleOpenWishlistSelector}
                          disabled={isCollectionLoading}
                          variant={collectionItem?.wanted_cards?.length ? "secondary" : "outline"}
                          size="sm"
                          className={collectionItem?.wanted_cards?.length
                            ? "h-11 rounded-xl gap-1.5 px-3 text-xs"
                            : "h-11 rounded-xl gap-1.5 border-amber-400/25 bg-amber-400/8 px-3 text-xs text-amber-600 shadow-none hover:bg-amber-400/12 hover:text-amber-700 dark:text-amber-300 dark:hover:text-amber-200"}
                        >
                          <Heart className={`w-3.5 h-3.5 ${collectionItem?.wanted_cards?.length ? "fill-current" : ""}`} />
                          {collectionItem?.wanted_cards?.length ? "Add wanted" : "Want card"}
                        </Button>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          onClick={handleOpenCardSelector}
                          disabled={isCollectionLoading}
                          variant="secondary"
                          size="sm"
                          className="h-11 rounded-xl gap-1.5 px-3 text-xs shadow-sm"
                        >
                          <Check className="w-3.5 h-3.5" />
                          Add card
                        </Button>
                        <Button
                          onClick={handleOpenWishlistSelector}
                          disabled={isCollectionLoading}
                          variant={collectionItem?.wanted_cards?.length ? "secondary" : "outline"}
                          size="sm"
                          className={collectionItem?.wanted_cards?.length
                            ? "h-11 rounded-xl gap-1.5 px-3 text-xs"
                            : "h-11 rounded-xl gap-1.5 border-amber-400/25 bg-amber-400/8 px-3 text-xs text-amber-600 shadow-none hover:bg-amber-400/12 hover:text-amber-700 dark:text-amber-300 dark:hover:text-amber-200"}
                        >
                          <Heart className={`w-3.5 h-3.5 ${collectionItem?.wanted_cards?.length ? "fill-current" : ""}`} />
                          {collectionItem?.wanted_cards?.length ? "Add wanted" : "Track wanted"}
                        </Button>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        onClick={handleOpenSelectedSlotScanner}
                        disabled={isCollectionLoading}
                        variant="outline"
                        size="sm"
                        className="h-9 shrink-0 rounded-xl gap-1 !border-0 bg-background/55 px-3 text-xs text-muted-foreground shadow-none hover:bg-background/75 hover:text-foreground dark:bg-white/[0.05] dark:hover:bg-white/[0.08]"
                      >
                        <Camera className="h-3 w-3" />
                        Scan card
                      </Button>
                      {!collected && (
                        <Button
                          onClick={handleQuickCollectSelectedPokemon}
                          disabled={isCollectionLoading}
                          variant="outline"
                          size="sm"
                          className="h-9 shrink-0 rounded-xl !border-0 bg-background/55 px-3 text-xs text-muted-foreground shadow-none hover:bg-background/75 hover:text-foreground dark:bg-white/[0.05] dark:hover:bg-white/[0.08]"
                        >
                          Mark owned without card
                        </Button>
                      )}
                      {collected && selectedPokemonHasAssignedCard && (
                        <Button
                          onClick={handleToggleFavoriteSelectedPokemon}
                          disabled={isCollectionLoading}
                          variant={selectedPokemonIsFavorite ? "default" : "outline"}
                          size="sm"
                          className={selectedPokemonIsFavorite
                            ? "h-9 shrink-0 rounded-xl gap-1 px-3 text-xs"
                            : "h-9 shrink-0 rounded-xl gap-1 !border-0 bg-background/55 px-3 text-xs text-muted-foreground shadow-none hover:bg-background/75 hover:text-foreground dark:bg-white/[0.05] dark:hover:bg-white/[0.08]"}
                        >
                          <Star className={`h-3 w-3 ${selectedPokemonIsFavorite ? "fill-current" : ""}`} />
                          {selectedPokemonIsFavorite ? "Perfect" : "Fav"}
                        </Button>
                      )}
                    </div>
                  </>
                )}
              </div>
              </div>
              <p className="hidden px-1 text-[11px] leading-relaxed text-muted-foreground/90 sm:block">
                {panelHelperText}
              </p>
            </div>
            </div>
          </div>
        </div>
      </div>
      </>
    )

    return createPortal(quickPanel, document.body)
  }

  const renderMobileSlotActionBar = () => {
    if (readOnlyMode || !longPressedPokemon) {
      return null
    }

    const pokemon = getPokemonSummary(longPressedPokemon.id)
    if (!pokemon) {
      return null
    }

    const item = getCollectionItem(pokemon.id)
    const collected = isCollected(pokemon.id)
    const quickActions = getBinderSlotQuickActions({
      hasAssignedCard: Boolean(item?.card_id),
      readOnly: readOnlyMode,
    })

    if (!quickActions.canShowActions) {
      return null
    }

    const showFavoriteAction = collected && Boolean(item?.card_id)
    const mobileActionBar = (
      <div
        className="fixed inset-x-2 bottom-[calc(var(--dock-clearance)+0.5rem)] z-50 px-1 sm:hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mx-auto max-w-md rounded-[1.15rem] border border-border/70 bg-card/97 p-2 shadow-[0_22px_60px_-28px_rgba(15,23,42,0.48)] backdrop-blur-xl dark:border-border/50 dark:bg-background/97">
          <div className="mb-1.5 flex items-center justify-between gap-3 px-1">
            <p className="min-w-0 truncate text-xs font-semibold">
              {formatPokemonDisplayName(pokemon.name)}
            </p>
            <button
              type="button"
              onClick={() => openCardBrowser({ id: pokemon.id, name: pokemon.name })}
              className="-my-1 ml-auto flex h-9 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-semibold text-muted-foreground hover:bg-muted/70 hover:text-foreground"
              aria-label={`All ${formatPokemonDisplayName(pokemon.name)} cards`}
            >
              <Layers3 className="h-3.5 w-3.5" />
              All cards
            </button>
            <button
              type="button"
              onClick={() => setLongPressedPokemon(null)}
              className="-my-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted/70 hover:text-foreground"
              aria-label="Close quick actions"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className={`grid gap-1.5 ${showFavoriteAction ? "grid-cols-4" : "grid-cols-3"}`}>
            <button
              type="button"
              onClick={() => {
                setLongPressedPokemon(null)
                openCardSelectorForPokemon(pokemon, "collect")
              }}
              className="flex h-10 min-w-0 items-center justify-center gap-1 rounded-xl border border-emerald-400/35 bg-emerald-500/12 px-1.5 text-xs font-bold text-emerald-600 dark:text-emerald-300"
            >
              <Check className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{quickActions.addLabel}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setLongPressedPokemon(null)
                openCardSelectorForPokemon(pokemon, "wishlist")
              }}
              className="flex h-10 min-w-0 items-center justify-center gap-1 rounded-xl border border-amber-400/35 bg-amber-500/12 px-1.5 text-xs font-bold text-amber-600 dark:text-amber-300"
            >
              <Heart className="h-3.5 w-3.5 shrink-0 fill-current" />
              <span className="truncate">{quickActions.wantLabel}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setLongPressedPokemon(null)
                handleQuickCollect(pokemon)
              }}
              className={`flex h-10 min-w-0 items-center justify-center gap-1 rounded-xl border px-1.5 text-xs font-bold ${
                collected
                  ? "border-destructive/25 bg-destructive/10 text-destructive"
                  : "border-emerald-400/35 bg-emerald-500/12 text-emerald-600 dark:text-emerald-300"
              }`}
            >
              {collected ? <X className="h-3.5 w-3.5 shrink-0" /> : <Check className="h-3.5 w-3.5 shrink-0" />}
              <span className="truncate">{collected ? "Remove" : "Got"}</span>
            </button>
            {showFavoriteAction ? (
              <button
                type="button"
                onClick={() => {
                  setLongPressedPokemon(null)
                  handleToggleFavorite(pokemon.id)
                }}
                className={`flex h-10 min-w-0 items-center justify-center gap-1 rounded-xl border px-1.5 text-xs font-bold ${
                  item?.status === "finalized"
                    ? "border-amber-400/35 bg-amber-500/12 text-amber-600 dark:text-amber-300"
                    : "border-border/55 bg-muted/45 text-muted-foreground"
                }`}
              >
                <Star className={`h-3.5 w-3.5 shrink-0 ${item?.status === "finalized" ? "fill-current" : ""}`} />
                <span className="truncate">Fav</span>
              </button>
            ) : null}
          </div>
        </div>
      </div>
    )

    return createPortal(mobileActionBar, document.body)
  }

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
    if (longPressedPokemon) {
      const handleClick = () => setLongPressedPokemon(null)
      setTimeout(() => window.addEventListener("click", handleClick), 0)
      return () => window.removeEventListener("click", handleClick)
    }
  }, [longPressedPokemon])

  useEffect(() => {
    if (!isDesktopActionsOpen && !isDesktopFiltersOpen) return

    const handleClick = () => {
      setIsDesktopActionsOpen(false)
      setIsDesktopFiltersOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsDesktopActionsOpen(false)
        setIsDesktopFiltersOpen(false)
      }
    }

    setTimeout(() => window.addEventListener("click", handleClick), 0)
    window.addEventListener("keydown", handleKeyDown)

    return () => {
      window.removeEventListener("click", handleClick)
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [isDesktopActionsOpen, isDesktopFiltersOpen])

  const binderIntroStats = [
    { label: "Collected", value: `${collectionStats.collected}/${collectionStats.total}` },
    { label: "Completion", value: `${collectionStats.percentage}%` },
    { label: "Needed", value: String(neededPokemonList.length) },
    { label: "Perfect", value: String(favoritePokemonList.length) },
  ]

  const renderSpreadInfoPage = (side: "left" | "right") => {
    const pageTheme = getBinderThemeForPage(0)
    const spreadPanelClass = isDarkMode
      ? "border-white/10 bg-background/58"
      : "border-black/6 bg-white/84 shadow-[0_18px_44px_-34px_rgba(15,23,42,0.26)]"
    const spreadStatClass = isDarkMode
      ? "border-white/10 bg-background/52"
      : "border-black/6 bg-white/78 shadow-[0_16px_38px_-32px_rgba(15,23,42,0.22)]"
    const middleRowSpan = Math.max(settings.binderRows - 2, 1)

    return (
      <div key={`spread-info-${side}`} className="relative h-full w-full overflow-hidden rounded-2xl">
        <div
          className="absolute inset-0 rounded-2xl border"
          style={{
            background: pageTheme.background,
            borderColor: pageTheme.border,
            boxShadow: pageTheme.shadow,
          }}
        />
        <div
          className="absolute inset-0 rounded-2xl"
          style={{ background: pageTheme.gloss }}
        />
        {(isSpreadLayout || isDesktopViewport) && (
          <div className={`absolute top-3 z-10 rounded-full border border-white/15 bg-black/25 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/78 backdrop-blur-sm ${side === "left" ? "left-3" : "right-3"}`}>
            Page 0
          </div>
        )}
        <div
          className="absolute inset-0 p-2 sm:p-4"
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${settings.binderCols}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${settings.binderRows}, minmax(0, 1fr))`,
            gap: "0.375rem",
          }}
        >
          <div
            className={`min-h-0 rounded-[1.15rem] border px-4 py-3 backdrop-blur-md ${spreadPanelClass}`}
            style={{
              gridColumn: "1 / -1",
              gridRow: "1 / span 1",
            }}
          >
            <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">Inside Cover</p>
            <h2 className="mt-2 text-[clamp(1.35rem,2.2vw,2rem)] font-semibold tracking-tight">Binderdex</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              {selectedGen === 0 ? "National Dex binder" : `${GENERATIONS[selectedGen].name} binder`} with {settings.binderRows}x{settings.binderCols} slots per page.
            </p>
          </div>

          <div
            className="grid min-h-0 grid-cols-2 gap-2"
            style={{
              gridColumn: "1 / -1",
              gridRow: `2 / span ${middleRowSpan}`,
            }}
          >
            {binderIntroStats.map((stat) => (
              <div
                key={stat.label}
                className={`min-h-0 rounded-[1rem] border px-3 py-3 backdrop-blur-sm ${spreadStatClass}`}
              >
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{stat.label}</p>
                <p className="mt-1 text-lg font-semibold tabular-nums sm:text-[1.4rem]">{stat.value}</p>
              </div>
            ))}
          </div>

          <div
            className={`min-h-0 space-y-1.5 rounded-[1.15rem] border px-4 py-3 text-sm backdrop-blur-sm ${spreadStatClass}`}
            style={{
              gridColumn: "1 / -1",
              gridRow: `${settings.binderRows} / span 1`,
            }}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Visible mode</span>
              <span className="font-medium">{activeCollectionFilterOption.label}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Binder pages</span>
              <span className="font-medium tabular-nums">{totalBinderPages}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Visible Pokemon</span>
              <span className="font-medium tabular-nums">{filteredPokemonList.length}</span>
            </div>
            {hasTrackedCards && filteredTotalLabel ? (
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Tracked value</span>
                <span className="font-medium">{filteredTotalLabel}</span>
              </div>
            ) : null}
            <p className="pt-1 text-[11px] leading-relaxed text-muted-foreground">
              {canEditBinder
                ? "Open any slot to collect, wishlist, or swap a card. Wide screens show facing pages like a real binder."
                : "This shared binder is read-only. Search and browse pages, but edits stay disabled."}
            </p>
          </div>
        </div>
      </div>
    )
  }

  const renderSpreadBlankPage = (side: "left" | "right") => {
    const pageTheme = getBinderThemeForPage(null)

    return (
      <div key={`spread-blank-${side}`} className="relative h-full w-full overflow-hidden rounded-2xl">
        <div
          className="absolute inset-0 rounded-2xl border"
          style={{
            background: pageTheme.background,
            borderColor: pageTheme.border,
            boxShadow: pageTheme.shadow,
          }}
        />
        <div
          className="absolute inset-0 rounded-2xl"
          style={{ background: pageTheme.gloss }}
        />
        <div className="relative z-10 flex h-full items-center justify-center p-4">
          <div className="max-w-[16rem] rounded-[1.35rem] border border-border/45 bg-background/68 px-5 py-6 text-center shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-background/52">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Back Matter</p>
            <p className="mt-2 text-lg font-semibold">End of binder</p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              The last printed page sits on the facing side of this spread.
            </p>
          </div>
        </div>
      </div>
    )
  }

  const renderBinderGridPage = (pageNumber: number, side: "left" | "right") => {
    const pageTheme = getBinderThemeForPage(pageNumber)
    const pageSlots = getPageSlots(pageNumber)
    const isActivePage = pageNumber === currentBinderPage

    return (
      <div
        key={`binder-page-${pageNumber}`}
        data-binder-page={pageNumber}
        className="relative h-full w-full overflow-hidden rounded-2xl transition-shadow"
        style={isActivePage ? { boxShadow: `0 0 0 2px ${pageTheme.activeOutline}` } : undefined}
      >
        <div
          className="absolute inset-0 rounded-2xl border"
          style={{
            background: pageTheme.background,
            borderColor: pageTheme.border,
            boxShadow: pageTheme.shadow,
          }}
        />
        <div
          className="absolute inset-0 rounded-2xl"
          style={{ background: pageTheme.gloss }}
        />
        {(isSpreadLayout || isDesktopViewport) && (
          <div className={`absolute top-3 z-10 rounded-full border border-white/15 bg-black/25 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/78 backdrop-blur-sm ${side === "left" ? "left-3" : "right-3"}`}>
            Page {pageNumber}
          </div>
        )}
        <div
          className="absolute inset-0 p-2 sm:p-4"
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${settings.binderCols}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${settings.binderRows}, minmax(0, 1fr))`,
            gap: "0.375rem",
          }}
        >
          {pageSlots.map((pokemon, index) => {
            const row = Math.floor(index / settings.binderCols)
            const col = index % settings.binderCols
            const rowLetter = String.fromCharCode(65 + row)
            const slotLabel = `${rowLetter}${col + 1}`

            if (!pokemon) {
              return (
                <div
                  key={`slot-${pageNumber}-${index}`}
                  className="relative h-full w-full overflow-hidden border border-white/55 bg-white/16 shadow-[inset_0_1px_0_rgba(255,255,255,0.55),inset_0_-10px_18px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-white/[0.03] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),inset_0_-10px_18px_rgba(0,0,0,0.24)]"
                  style={{ borderRadius: TRADING_CARD_CORNER_RADIUS }}
                >
                  <div
                    className="absolute inset-[3px] border border-black/6 dark:border-white/8"
                    style={{ borderRadius: TRADING_CARD_INNER_CORNER_RADIUS }}
                  />
                  <div className="absolute inset-x-[7px] top-[7px] h-px bg-white/65 dark:bg-white/10" />
                  {settings.binderSlotGlareEnabled ? (
                    <BinderSlotGlare
                      glareStyle={slotGlareOverlayStyle}
                      innerRadius={TRADING_CARD_INNER_CORNER_RADIUS}
                    />
                  ) : null}
                </div>
              )
            }

            const isCurrentCollected = isCollected(pokemon.id)
            const isSelected = selectedPokemon?.id === pokemon.id
            const isLongPressed = longPressedPokemon?.id === pokemon.id
            const item = getCollectionItem(pokemon.id)
            const isCurrentWishlisted = item?.status === "wishlisted" || Boolean(item?.wanted_cards?.length)
            const wantedCardPreview = item?.wanted_cards?.[0] ?? null
            const representativeSlotPreview = slotPreviewCardsByPokemonId[pokemon.id] ?? null
            // Same resolution the adjacent-page prefetch decodes.
            const slotCardImage = getSlotCardImage(pokemon.id)
            const selectedSlotCardName = isCurrentWishlisted && wantedCardPreview?.card_name
              ? wantedCardPreview.card_name
              : item?.card_name
            const slotCardName = selectedSlotCardName || representativeSlotPreview?.name
            const slotCardFinish = isCurrentWishlisted && wantedCardPreview?.card_finish
              ? wantedCardPreview.card_finish
              : item?.card_finish
            const itemPriceKey = getCollectionItemPriceKey(item)

            return (
              <PokemonSlot
                key={`${pageNumber}-${pokemon.id}`}
                pokemon={pokemon}
                isCollected={isCurrentCollected}
                isWishlisted={isCurrentWishlisted}
                isSelected={isSelected}
                isLongPressed={isLongPressed}
                slotLabel={slotLabel}
                status={item?.status}
                cardImage={slotCardImage}
                cardName={slotCardName}
                cardFinish={slotCardFinish}
                hasAssignedCard={Boolean(item?.card_id)}
                priceLabel={isPriceMode && itemPriceKey ? formatPriceLabel(pricesByCardId[itemPriceKey]) : null}
                showPriceMode={isPriceMode}
                readOnly={readOnlyMode}
                showBinderSlotGlare={settings.binderSlotGlareEnabled}
                showCardFinishEffects={settings.cardFinishEffectsEnabled}
                binderSlotGlareStyle={slotGlareOverlayStyle}
                cardFinishEffectStyle={cardFinishEffectStyle}
                cardFinishGlint={cardFinishGlint}
                onClick={() => {
                  if (pageNumber !== currentBinderPage) {
                    setCurrentBinderPage(pageNumber)
                  }
                  handleSlotClick(pokemon)
                }}
                onDoubleClick={() => {
                  if (pageNumber !== currentBinderPage) {
                    setCurrentBinderPage(pageNumber)
                  }
                  setLongPressedPokemon(null)
                  const pokemonSummary = getPokemonSummary(pokemon.id)
                  if (pokemonSummary) {
                    openCardSelectorForPokemon(pokemonSummary, "collect")
                  }
                }}
                onLongPress={() => {
                  if (pageNumber !== currentBinderPage) {
                    setCurrentBinderPage(pageNumber)
                  }
                  handleLongPress(pokemon)
                }}
                onAddCard={() => {
                  setLongPressedPokemon(null)
                  const pokemonSummary = getPokemonSummary(pokemon.id)
                  if (pokemonSummary) {
                    openCardSelectorForPokemon(pokemonSummary, "collect")
                  }
                }}
                onAddWanted={() => {
                  setLongPressedPokemon(null)
                  const pokemonSummary = getPokemonSummary(pokemon.id)
                  if (pokemonSummary) {
                    openCardSelectorForPokemon(pokemonSummary, "wishlist")
                  }
                }}
                onQuickCollect={() => handleQuickCollect(pokemon)}
                onToggleFavorite={() => handleToggleFavorite(pokemon.id)}
                user={user}
                priority={pageNumber === 1}
                buttonRef={(node) => registerSlotButtonRef(pokemon.id, node)}
              />
            )
          })}
        </div>
      </div>
    )
  }

  const renderWantedCardsView = () => {
    const totalWantedCount = wantedDashboard.totalCards
    const marketTotalLabel = formatGbpPriceAmount(wantedDashboard.marketTotalGbp)
    const averagePriceLabel = formatGbpPriceAmount(wantedDashboard.averageGbp)
    const pricedPercent = totalWantedCount > 0 ? Math.round((wantedDashboard.pricedCount / totalWantedCount) * 100) : 0
    const highestCard = wantedDashboard.highestCards[0]
    const highestPriceLabel = formatGbpPriceAmount(highestCard?.effectiveGbpAmount)
    const bandDenominator = Math.max(totalWantedCount, 1)
    const visibleSetBreakdown = wantedDashboard.setBreakdown.slice(0, 5)
    const visibleLanguageBreakdown = wantedDashboard.languageBreakdown.slice(0, 6)
    const visibleFinishBreakdown = wantedDashboard.finishBreakdown.slice(0, 5)
    const maxSetCount = Math.max(...visibleSetBreakdown.map((group) => group.count), 1)
    const maxFinishCount = Math.max(...visibleFinishBreakdown.map((group) => group.count), 1)
    const priorityCards = wantedDashboard.highestCards.slice(0, 4)
    const isExplorerFiltered = wantedExplorerFilter.kind !== "all"
    const setWantedFilter = (filter: WantedExplorerFilter, sort: WantedDashboardSort = wantedSort) => {
      setWantedExplorerFilter(filter)
      setWantedSort(sort)
    }
    const clearWantedFilter = () => setWantedExplorerFilter({ kind: "all", label: "All wanted" })
    const isWantedFilterActive = (kind: WantedExplorerFilter["kind"], value?: string) => {
      if (wantedExplorerFilter.kind !== kind) return false
      if (wantedExplorerFilter.kind === "all") return true

      return wantedExplorerFilter.value === value
    }
    const jumpToWantedPokemonPage = (pokemon: PokemonSummary | null) => {
      if (!pokemon) return
      const pokemonIndex = pokemonList.findIndex((entry) => entry.id === pokemon.id)
      if (pokemonIndex < 0) return

      const page = Math.ceil((pokemonIndex + 1) / slotsPerPage)
      setActiveMainView("binder")
      handlePokemonSelect(pokemon)
      navigateToPage(page, page > currentBinderPage ? "left" : "right")
    }

    if (totalWantedCount === 0) {
      return (
        <div className="flex min-h-0 flex-1 items-center justify-center rounded-[1.35rem] border border-border/65 bg-card/88 p-6 text-center shadow-[0_18px_48px_-34px_rgba(15,23,42,0.32)] dark:border-white/10 dark:bg-card/72">
          <div className="max-w-sm">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-300">
              <Heart className="h-5 w-5" />
            </div>
            <p className="mt-3 text-sm font-semibold">No wanted cards yet</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Open a slot, choose Want card, then this becomes the buying dashboard.</p>
          </div>
        </div>
      )
    }

    return (
      <div className="min-h-0 flex-1 overflow-y-auto pb-[calc(var(--dock-clearance)+1rem)] md:pb-3">
        <div className="space-y-3">
          <section className="rounded-[1.35rem] border border-border/65 bg-card/88 p-2.5 shadow-[0_18px_48px_-34px_rgba(15,23,42,0.32)] dark:border-white/10 dark:bg-card/72 sm:p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Wanted</p>
                <h2 className="mt-0.5 text-lg font-semibold tracking-tight">Buying dashboard</h2>
                <p className="mt-1 hidden max-w-xl text-xs leading-relaxed text-muted-foreground sm:block">Prioritise what to buy, spot unpriced cards, and keep the want list tied back to binder slots.</p>
              </div>
              <div className="flex min-w-0 items-center gap-2 rounded-2xl border border-amber-500/18 bg-amber-500/10 px-3 py-2 text-amber-700 dark:text-amber-300">
                <ShoppingBag className="h-4 w-4" />
                <div className="text-right">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] opacity-75">Market total</p>
                  <p className="truncate text-sm font-bold tabular-nums">{marketTotalLabel ?? (isLoadingPrices ? "Loading" : "No prices")}</p>
                </div>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 sm:mt-4 xl:grid-cols-4">
              <button
                type="button"
                onClick={() => {
                  clearWantedFilter()
                  setWantedSort("newest")
                }}
                className="rounded-2xl border border-border/55 bg-background/56 p-2.5 text-left transition hover:border-primary/35 hover:bg-primary/5 dark:border-white/10 dark:bg-white/[0.03] sm:p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">To buy</p>
                  <ShoppingBag className="h-3.5 w-3.5 text-amber-600 dark:text-amber-300" />
                </div>
                <p className="mt-1.5 text-xl font-bold tabular-nums sm:mt-2 sm:text-2xl">{totalWantedCount}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">{wantedDashboard.unpricedCount} need pricing</p>
              </button>
              <button
                type="button"
                onClick={() => {
                  clearWantedFilter()
                  setWantedSort("highest")
                }}
                className="rounded-2xl border border-border/55 bg-background/56 p-2.5 text-left transition hover:border-primary/35 hover:bg-primary/5 dark:border-white/10 dark:bg-white/[0.03] sm:p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Priced</p>
                  <ListChecks className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-300" />
                </div>
                <p className="mt-1.5 text-xl font-bold tabular-nums sm:mt-2 sm:text-2xl">{wantedDashboard.pricedCount}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">{pricedPercent}% of wanted list</p>
              </button>
              <button
                type="button"
                onClick={() => {
                  clearWantedFilter()
                  setWantedSort("lowest")
                }}
                className="rounded-2xl border border-border/55 bg-background/56 p-2.5 text-left transition hover:border-primary/35 hover:bg-primary/5 dark:border-white/10 dark:bg-white/[0.03] sm:p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Average</p>
                  <Tag className="h-3.5 w-3.5 text-sky-600 dark:text-sky-300" />
                </div>
                <p className="mt-1.5 truncate text-xl font-bold tabular-nums sm:mt-2 sm:text-2xl">{averagePriceLabel ?? "No price"}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">priced cards only</p>
              </button>
              <button
                type="button"
                onClick={() => {
                  clearWantedFilter()
                  setWantedSort("highest")
                }}
                className="rounded-2xl border border-border/55 bg-background/56 p-2.5 text-left transition hover:border-primary/35 hover:bg-primary/5 dark:border-white/10 dark:bg-white/[0.03] sm:p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Highest</p>
                  <Layers3 className="h-3.5 w-3.5 text-rose-600 dark:text-rose-300" />
                </div>
                <p className="mt-2 truncate text-base font-bold">{highestCard?.card.card_name ?? "No priced cards"}</p>
                <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">{highestPriceLabel ?? "No price"}</p>
              </button>
            </div>
          </section>

          <section className="grid gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(21rem,0.85fr)]">
            <div className="rounded-[1.2rem] border border-border/65 bg-card/84 p-3 dark:border-white/10 dark:bg-card/70 sm:p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Price bands</p>
                  <h3 className="text-sm font-semibold">What the basket is made of</h3>
                </div>
                <span className="rounded-full border border-border/60 bg-background/60 px-2.5 py-1 text-[11px] font-semibold text-muted-foreground dark:border-white/10 dark:bg-white/[0.04]">
                  {wantedDashboard.unpricedCount} unpriced
                </span>
              </div>

              <div className="mt-4 flex h-4 overflow-hidden rounded-full bg-muted/70 dark:bg-white/[0.06]">
                {wantedDashboard.priceBands.filter((band) => band.count > 0).map((band) => {
                  const bandStyle = WANTED_PRICE_BAND_STYLES[band.id]
                  return (
                    <div
                      key={band.id}
                      className={`${bandStyle.bar} h-full min-w-[3px]`}
                      style={{ width: `${(band.count / bandDenominator) * 100}%` }}
                      title={`${band.label}: ${band.count}`}
                    />
                  )
                })}
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {wantedDashboard.priceBands.map((band) => {
                  const bandStyle = WANTED_PRICE_BAND_STYLES[band.id]
                  const bandTotalLabel = formatGbpPriceAmount(band.totalGbp)
                  const bandPercent = Math.round((band.count / bandDenominator) * 100)

                  return (
                    <button
                      key={band.id}
                      type="button"
                      onClick={() => setWantedFilter({ kind: "band", value: band.id, label: band.label }, band.id === "unpriced" ? "unpriced" : "highest")}
                      className={`rounded-2xl border p-3 text-left transition dark:border-white/10 ${
                        isWantedFilterActive("band", band.id)
                          ? "border-primary/45 bg-primary/8"
                          : "border-border/50 bg-background/50 hover:border-primary/35 hover:bg-primary/5 dark:bg-white/[0.03]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${bandStyle.dot}`} />
                          <span className="truncate text-xs font-semibold">{band.label}</span>
                        </div>
                        <span className="text-xs font-bold tabular-nums">{band.count}</span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted/80 dark:bg-white/[0.06]">
                        <div className={`h-full ${bandStyle.bar}`} style={{ width: `${bandPercent}%` }} />
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground">{bandTotalLabel ?? "No priced total"}</p>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="rounded-[1.2rem] border border-border/65 bg-card/84 p-3 dark:border-white/10 dark:bg-card/70 sm:p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Concentration</p>
                  <h3 className="text-sm font-semibold">Where the want list clusters</h3>
                </div>
                <Languages className="h-4 w-4 text-muted-foreground" />
              </div>

              <div className="mt-4 space-y-2">
                {visibleSetBreakdown.map((group) => (
                  <button
                    key={group.label}
                    type="button"
                    onClick={() => setWantedFilter({ kind: "set", value: group.label, label: group.label }, "set")}
                    className={`block w-full rounded-xl p-2 text-left transition ${
                      isWantedFilterActive("set", group.label)
                        ? "bg-primary/8"
                        : "hover:bg-primary/5"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate font-semibold">{group.label}</span>
                      <span className="shrink-0 text-muted-foreground tabular-nums">{group.count} cards</span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted/80 dark:bg-white/[0.06]">
                      <div
                        className="h-full rounded-full bg-sky-500"
                        style={{ width: `${Math.max(6, (group.count / maxSetCount) * 100)}%` }}
                      />
                    </div>
                  </button>
                ))}
              </div>

              <div className="mt-4 border-t border-border/50 pt-3 dark:border-white/10">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Languages</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {visibleLanguageBreakdown.map((group) => (
                    <button
                      key={group.label}
                      type="button"
                      onClick={() => setWantedFilter({ kind: "language", value: group.label, label: formatCardLanguageLabel(group.label) }, "newest")}
                      className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition dark:border-white/10 ${
                        isWantedFilterActive("language", group.label)
                          ? "border-primary/45 bg-primary/10 text-primary"
                          : "border-border/55 bg-background/55 hover:border-primary/35 hover:text-foreground dark:bg-white/[0.04]"
                      }`}
                    >
                      {formatCardLanguageLabel(group.label)} <span className="text-muted-foreground tabular-nums">{group.count}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-3 border-t border-border/50 pt-3 dark:border-white/10">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Finishes</p>
                <div className="mt-2 space-y-1.5">
                  {visibleFinishBreakdown.map((group) => (
                    <button
                      key={group.label}
                      type="button"
                      onClick={() => setWantedFilter({ kind: "finish", value: group.label, label: formatCardFinishLabel(group.label) }, "newest")}
                      className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-xl p-1.5 text-left transition ${
                        isWantedFilterActive("finish", group.label)
                          ? "bg-primary/8"
                          : "hover:bg-primary/5"
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center justify-between gap-2 text-[11px]">
                          <span className="truncate font-medium">{formatCardFinishLabel(group.label)}</span>
                          <span className="text-muted-foreground tabular-nums">{group.count}</span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted/80 dark:bg-white/[0.06]">
                          <div
                            className="h-full rounded-full bg-violet-500"
                            style={{ width: `${Math.max(6, (group.count / maxFinishCount) * 100)}%` }}
                          />
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-[1.2rem] border border-border/65 bg-card/84 p-3 dark:border-white/10 dark:bg-card/70 sm:p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Buy first</p>
                <h3 className="text-sm font-semibold">Highest impact pickups</h3>
              </div>
              {wantedDashboard.unpricedCount > 0 ? (
                <button
                  type="button"
                  onClick={() => setWantedSort("unpriced")}
                  className="rounded-full border border-slate-500/20 bg-slate-500/10 px-3 py-1 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-500/15 dark:text-slate-300"
                >
                  Review {wantedDashboard.unpricedCount} unpriced
                </button>
              ) : null}
            </div>

            {priorityCards.length === 0 ? (
              <p className="mt-3 rounded-2xl border border-border/55 bg-background/50 px-3 py-3 text-sm text-muted-foreground dark:border-white/10 dark:bg-white/[0.03]">
                Prices are still loading or unavailable for the current wanted cards.
              </p>
            ) : (
              <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {priorityCards.map((wantedCard) => {
                  const pokemon = getPokemonSummary(wantedCard.pokemonId)
                  const priorityPriceLabel = formatGbpPriceAmount(wantedCard.effectiveGbpAmount)

                  return (
                    <button
                      key={`priority-${wantedCard.key}`}
                      type="button"
                      onClick={() => jumpToWantedPokemonPage(pokemon)}
                      className="grid grid-cols-[3rem_minmax(0,1fr)] gap-2 rounded-2xl border border-border/55 bg-background/52 p-2 text-left transition hover:border-primary/35 hover:bg-primary/5 dark:border-white/10 dark:bg-white/[0.03]"
                    >
                      <span className="trading-card relative w-full border border-border/55 bg-muted dark:border-white/10">
                        {wantedCard.card.card_image ? (
                          <img src={wantedCard.card.card_image} alt={wantedCard.card.card_name} className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center text-[9px] text-muted-foreground">No image</span>
                        )}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-semibold">{wantedCard.card.card_name}</span>
                        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{wantedCard.pokemonName}</span>
                        <span className="mt-1 block text-sm font-bold tabular-nums">{priorityPriceLabel ?? "No price"}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </section>

          <section className="rounded-[1.2rem] border border-border/65 bg-card/84 dark:border-white/10 dark:bg-card/70">
            <div className="flex flex-col gap-3 border-b border-border/50 p-3 dark:border-white/10 sm:flex-row sm:items-center sm:justify-between sm:p-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Wanted cards</p>
                <h3 className="text-sm font-semibold">
                  {sortedWantedDashboardCards.length}
                  {isExplorerFiltered ? ` of ${totalWantedCount}` : ""} cards, sorted for buying
                </h3>
                {isExplorerFiltered ? (
                  <button
                    type="button"
                    onClick={clearWantedFilter}
                    className="mt-1 inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/8 px-2.5 py-1 text-[11px] font-semibold text-primary"
                  >
                    {wantedExplorerFilter.label}
                    <X className="h-3 w-3" />
                  </button>
                ) : null}
              </div>
              <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
                <span className="flex shrink-0 items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  <ArrowUpDown className="h-3.5 w-3.5" />
                  Sort
                </span>
                <div className="flex shrink-0 rounded-full border border-border/55 bg-background/55 p-1 dark:border-white/10 dark:bg-white/[0.04]">
                  {WANTED_SORT_OPTIONS.map((option) => {
                    const isActive = wantedSort === option.id
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => setWantedSort(option.id)}
                        className={`rounded-full px-3 py-1 text-[11px] font-semibold transition ${isActive ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-background hover:text-foreground dark:hover:bg-white/[0.06]"}`}
                      >
                        <span className="sm:hidden">{option.mobileLabel}</span>
                        <span className="hidden sm:inline">{option.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            <div className="divide-y divide-border/50 dark:divide-white/10">
              {sortedWantedDashboardCards.map((wantedCard) => {
                const { pokemonId, pokemonName, card, price } = wantedCard
                const pokemon = getPokemonSummary(pokemonId)
                const goodPriceLabel = formatGbpPriceAmount(wantedCard.goodGbpAmount)
                const marketPriceLabel = formatGbpPriceAmount(wantedCard.effectiveGbpAmount)
                const rangePriceLabel = formatGbpPriceRange(price?.lowGbpAmount, price?.highGbpAmount)
                const confidenceLabel = formatPriceConfidenceLabel(price)
                const sourceLabel = formatPriceSourceLabel(price)
                const bandStyle = WANTED_PRICE_BAND_STYLES[wantedCard.priceBandId]
                const cardMeta = [
                  card.card_set,
                  card.local_id ? `#${card.local_id}${card.set_total ? `/${card.set_total}` : ""}` : null,
                  formatCardLanguageLabel(card.card_language),
                  formatCardFinishLabel(card.card_finish),
                ].filter(Boolean).join(" · ")

                return (
                  <article
                    key={wantedCard.key}
                    className="grid grid-cols-[4.25rem_minmax(0,1fr)] gap-3 p-3 sm:grid-cols-[4.75rem_minmax(0,1fr)_9.5rem] sm:p-4"
                  >
                    <button
                      type="button"
                      onClick={() => pokemon && handlePokemonSelect(pokemon)}
                      className="trading-card relative w-full border border-border/60 bg-muted text-left dark:border-white/10 sm:w-[4.75rem]"
                    >
                      {card.card_image ? (
                        <img src={card.card_image} alt={card.card_name} className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">No image</div>
                      )}
                    </button>

                    <div className="min-w-0">
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${bandStyle.chip}`}>
                          {WANTED_PRICE_BAND_LABELS[wantedCard.priceBandId]}
                        </span>
                        <span className="text-[11px] font-semibold text-muted-foreground">#{String(pokemonId).padStart(4, "0")}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => pokemon && handlePokemonSelect(pokemon)}
                        className="mt-1 block max-w-full text-left"
                      >
                        <h3 className="truncate text-sm font-semibold">{card.card_name}</h3>
                        <p className="truncate text-xs capitalize text-muted-foreground">{pokemonName}</p>
                      </button>
                      <p className="mt-1 truncate text-[11px] text-muted-foreground">{cardMeta}</p>

                      <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
                        {rangePriceLabel ? (
                          <span className="rounded-full border border-border/50 bg-background/45 px-2 py-0.5 dark:border-white/10 dark:bg-white/[0.04]">
                            Range {rangePriceLabel}
                          </span>
                        ) : null}
                        {confidenceLabel ? (
                          <span className="rounded-full border border-border/50 bg-background/45 px-2 py-0.5 dark:border-white/10 dark:bg-white/[0.04]">
                            {confidenceLabel}
                          </span>
                        ) : null}
                        {sourceLabel ? (
                          <span className="rounded-full border border-border/50 bg-background/45 px-2 py-0.5 dark:border-white/10 dark:bg-white/[0.04]">
                            {sourceLabel}
                          </span>
                        ) : null}
                      </div>
                      <CardPriceEvidence price={price} showTrend={false} />
                    </div>

                    <div className="col-span-2 grid grid-cols-2 gap-2 sm:col-span-1 sm:flex sm:flex-col sm:items-stretch sm:justify-center">
                      <div className="rounded-2xl border border-border/55 bg-background/50 px-2.5 py-2 dark:border-white/10 dark:bg-white/[0.03] sm:text-right">
                        <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Market</p>
                        <p className="text-sm font-bold tabular-nums">{marketPriceLabel ?? (isLoadingPrices ? "Loading" : "No price")}</p>
                      </div>
                      <div className="rounded-2xl border border-emerald-500/18 bg-emerald-500/8 px-2.5 py-2 sm:text-right">
                        <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Good buy</p>
                        <p className="text-sm font-bold tabular-nums text-emerald-600 dark:text-emerald-300">{goodPriceLabel ?? "No price"}</p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        className="h-9 rounded-xl text-xs"
                        disabled={readOnlyMode}
                        onClick={() => handleGotWantedCard(pokemonId, pokemonName, card)}
                      >
                        <Check className="h-3.5 w-3.5" />
                        Got
                      </Button>
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-9 rounded-xl text-xs"
                          disabled={!pokemon}
                          onClick={() => jumpToWantedPokemonPage(pokemon)}
                        >
                          Page
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-9 rounded-xl text-xs text-muted-foreground hover:text-destructive"
                          disabled={readOnlyMode}
                          onClick={() => handleClearWantedCard(pokemonId, card)}
                        >
                          Clear
                        </Button>
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>
          </section>
        </div>
      </div>
    )
  }

  return (
    <main className={`${dashboardStyles.shell} relative flex h-[100dvh] max-h-[100dvh] w-full max-w-[100vw] touch-pan-y flex-col overflow-hidden overscroll-none bg-background select-none`}>
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 z-30 h-[env(safe-area-inset-top)] bg-background md:hidden"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-20 h-[env(safe-area-inset-bottom)] bg-background md:hidden"
      />

      {!isOnline && (
        <div className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+0.45rem)] z-50 flex justify-center px-3">
          <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-amber-500/25 bg-card/92 px-3 py-1.5 text-xs font-medium text-amber-600 shadow-[0_12px_32px_-20px_rgba(217,119,6,0.65)] backdrop-blur-xl dark:text-amber-300">
            <WifiOff className="h-3.5 w-3.5" />
            <span>Offline mode</span>
            <span className="text-[11px] text-amber-500/80 dark:text-amber-200/75">
              {user && localPendingSyncCount > 0
                ? `${localPendingSyncCount} change${localPendingSyncCount === 1 ? "" : "s"} will sync when you're back online`
                : "Using cached data where available"}
            </span>
          </div>
        </div>
      )}

      {/* Pending-sync indicator and rollback notice (minimal markup; reuses the offline pill's look). */}
      {isOnline && user && !readOnlyMode && (localPendingSyncCount > 0 || syncNotice) && (
        <div className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+0.45rem)] z-50 flex justify-center px-3">
          <div
            role="status"
            data-sync-status={syncNotice ? "rolled-back" : syncStatus}
            className="pointer-events-auto flex items-center gap-2 rounded-full border border-amber-500/25 bg-card/92 px-3 py-1.5 text-xs font-medium text-amber-600 shadow-[0_12px_32px_-20px_rgba(217,119,6,0.65)] backdrop-blur-xl dark:text-amber-300"
          >
            {syncNotice ? (
              <>
                <span>{syncNotice}</span>
                <button type="button" onClick={dismissSyncNotice} className="underline underline-offset-2">
                  Dismiss
                </button>
              </>
            ) : (
              <span>
                {syncStatus === "waiting"
                  ? `${localPendingSyncCount} change${localPendingSyncCount === 1 ? "" : "s"} waiting to sync, retrying…`
                  : `Syncing ${localPendingSyncCount} change${localPendingSyncCount === 1 ? "" : "s"}…`}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Glass Navigation */}
      <nav ref={shellNavRef} className="sticky top-0 z-40 mb-1 shrink-0 px-2.5 pt-[max(env(safe-area-inset-top),0.35rem)] sm:px-4 sm:pt-[calc(env(safe-area-inset-top)+0.45rem)]">
        <div className={`mx-auto w-full ${activeMainView === "binder" ? "max-w-none" : "max-w-7xl"}`}>
          <div className="rounded-2xl border border-border/70 bg-card/96 shadow-[0_18px_50px_-26px_rgba(15,23,42,0.24)] md:bg-card/86 md:backdrop-blur-xl dark:border-border/50 dark:bg-background dark:shadow-black/5 dark:md:bg-background/88">
          <div className="flex items-center justify-between gap-2 px-2.5 py-1 md:px-2.5 md:py-1.5">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary shadow-sm md:h-6 md:w-6">
                <Grid3X3 className="h-3.5 w-3.5 text-primary-foreground md:h-3 md:w-3" />
              </div>
              <div className={`min-w-0 ${activeMainView === "binder" ? "max-md:hidden" : ""}`}>
                <p className="truncate text-sm font-bold tracking-tight md:text-[13px]">BinderDex</p>
                <p className="hidden text-[10px] text-muted-foreground sm:block md:hidden lg:block">National Dex binder tracking</p>
              </div>
            </div>

            {activeMainView === "binder" && binderDimension === "2d" && (
              <div data-testid="mobile-header-pager" className="flex min-w-0 items-center gap-0.5 rounded-xl border border-border/50 bg-card/72 p-0.5 md:hidden dark:border-border/30 dark:bg-muted/35">
                <Button variant="ghost" size="icon" className="h-9 w-9 disabled:pointer-events-none disabled:opacity-35" onClick={isSpreadLayout ? goToPrevSpread : goToPrevPage} disabled={!canGoToPreviousVisiblePage} aria-label={isSpreadLayout ? "Previous binder spread" : "Previous binder page"}>
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
                  className="h-8 w-10 rounded-lg border border-border/30 bg-background/70 text-center text-sm font-semibold tabular-nums"
                />
                <span className="hidden whitespace-nowrap pr-0.5 text-xs text-muted-foreground tabular-nums min-[360px]:inline">/ {totalBinderPages}</span>
                <Button variant="ghost" size="icon" className="h-9 w-9 disabled:pointer-events-none disabled:opacity-35" onClick={isSpreadLayout ? goToNextSpread : goToNextPage} disabled={!canGoToNextVisiblePage} aria-label={isSpreadLayout ? "Next binder spread" : "Next binder page"}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="hidden h-9 w-9 border-l border-border/40 disabled:pointer-events-none disabled:opacity-35 min-[420px]:inline-flex dark:border-white/10"
                  onClick={handleJumpToPreviousNeeded}
                  disabled={activeJumpPokemonList.length === 0}
                  aria-label={`Previous ${activeJumpLabel.toLowerCase()}`}
                >
                  <Sparkles className="h-3.5 w-3.5 -scale-x-100 text-primary" />
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

              {!isOnline && (
                <div className="hidden md:flex items-center gap-1 rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-500">
                  Offline
                </div>
              )}

              {readOnlyMode ? (
                <div className="hidden md:flex items-center gap-1 rounded-full border border-border/50 bg-card/72 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground dark:border-border/30 dark:bg-muted/35">
                  Shared View
                </div>
              ) : !user ? (
                <Button size="sm" onClick={() => openExclusively(() => setIsAuthOpen(true))} className="h-9 gap-1 rounded-full px-3 md:h-7 md:px-2.5" aria-label="Sign in">
                  <LogIn className="h-3.5 w-3.5" />
                  <span className="hidden md:inline text-[11px]">Sign In</span>
                </Button>
              ) : null}

              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-full md:hidden"
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
                aria-label={isMobileNavExpanded ? "Collapse controls" : "Expand controls"}
              >
                {isMobileNavExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>

              <div className="relative hidden md:block" onClick={(event) => event.stopPropagation()}>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 rounded-full px-2"
                  onClick={() => {
                    setIsDesktopFiltersOpen(false)
                    setIsDesktopActionsOpen((current) => !current)
                  }}
                  aria-expanded={isDesktopActionsOpen}
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                  <span className="text-[11px]">More</span>
                </Button>

                {isDesktopActionsOpen && (
                  <div className="absolute right-0 top-[calc(100%+0.45rem)] z-50 w-56 overflow-hidden rounded-xl border border-border/60 bg-card/96 p-1.5 text-sm shadow-[0_18px_44px_-24px_rgba(15,23,42,0.34)] backdrop-blur-xl dark:border-border/45 dark:bg-background/96">
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

              <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full md:hidden" onClick={() => openExclusively(() => setIsSettingsOpen(true))} aria-label="Open settings">
                <Settings className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-full md:hidden"
                onClick={toggleDarkMode}
                aria-label={isDarkMode ? "Switch to light mode" : "Switch to dark mode"}
              >
                {isDarkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          <div className="hidden border-t border-border/40 px-2 py-1 md:block">
              <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide whitespace-nowrap">
                <div className="flex shrink-0 rounded-xl border border-border/50 bg-card/70 p-0.5 dark:border-border/30 dark:bg-muted/40">
                <button
                  onClick={openSearch}
                  className={`flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-medium transition-all ${
                    isSearchOpen ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <SearchIcon className="h-3 w-3" />
                  <span>Search</span>
                </button>
                <button
                  onClick={() => {
                    switchMainView("binder")
                  }}
                  className={`flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-medium transition-all ${
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
                  className={`flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-medium transition-all ${
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
                  className={`flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-medium transition-all ${
                    !isSearchOpen && activeMainView === "wanted" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Heart className="h-3 w-3" />
                  <span>Wanted</span>
                </button>
                <button
                  onClick={() => {
                    switchMainView("sets")
                  }}
                  className={`flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-medium transition-all ${
                    !isSearchOpen && activeMainView === "sets" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Layers3 className="h-3 w-3" />
                  <span>Sets</span>
                </button>
                </div>

                {(activeMainView !== "binder" || binderDimension === "2d") && <>
                {isCompactViewport && (
                  <button
                    onClick={() => setIsMobileSpreadPreview((current) => !current)}
                    aria-pressed={isMobileSpreadPreview}
                    title={isMobileSpreadPreview ? "Show single page view" : "Preview binder spread"}
                    className={`flex shrink-0 items-center gap-1 rounded-xl border px-2.5 py-1 text-[11px] font-medium transition-all ${
                      isMobileSpreadPreview
                        ? "border-primary/30 bg-primary/12 text-primary"
                        : "border-border/50 bg-card/72 text-muted-foreground hover:text-foreground dark:border-border/30 dark:bg-muted/35"
                    }`}
                  >
                    <BookOpen className="h-3 w-3" />
                    <span>{isMobileSpreadPreview ? "Single" : "Spread"}</span>
                  </button>
                )}

                <div className="flex shrink-0 items-center rounded-xl border border-border/50 bg-card/72 px-2 dark:border-border/30 dark:bg-muted/35">
                <select
                  value={selectedGen}
                  onChange={(e) => setSelectedGen(Number(e.target.value))}
                  className="h-6 min-w-[104px] bg-transparent px-1 text-[11px] font-medium cursor-pointer focus:outline-none"
                >
                  {GENERATIONS.map((gen) => (
                    <option key={gen.id} value={gen.id}>
                      {gen.id === 0 ? "All" : `Gen ${gen.id}`}{gen.region ? ` ${gen.region}` : ""}
                    </option>
                  ))}
                </select>
              </div>

              {canFilterCollection && (
                <>
                  <div className="flex shrink-0 items-center gap-1 rounded-xl border border-border/50 bg-card/72 p-0.5 dark:border-border/30 dark:bg-muted/35">
                    {primaryCollectionFilters.map((filterOption) => {
                      const isActive = collectionViewFilter === filterOption.id

                      return (
                        <button
                          key={filterOption.id}
                          onClick={() => setCollectionViewFilter(filterOption.id)}
                          className={`rounded-lg px-2 py-0.5 text-[11px] font-medium transition-all ${
                            isActive
                              ? "bg-background text-foreground shadow-sm"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {filterOption.label}
                        </button>
                      )
                    })}
                  </div>

                  <div className="relative shrink-0" onClick={(event) => event.stopPropagation()}>
                    <button
                      onClick={() => {
                        setIsDesktopActionsOpen(false)
                        setIsDesktopFiltersOpen((current) => !current)
                      }}
                      className={`flex items-center gap-1 rounded-xl border px-2.5 py-1 text-[11px] font-medium transition-all ${
                        collectionViewFilter === "wanted" || collectionViewFilter === "upgradeable" || collectionViewFilter === "favorite" || isPriceMode
                          ? "border-primary/30 bg-primary/12 text-primary"
                          : "border-border/50 bg-card/72 text-muted-foreground hover:text-foreground dark:border-border/30 dark:bg-muted/35"
                      }`}
                      aria-expanded={isDesktopFiltersOpen}
                    >
                      <SlidersHorizontal className="h-3 w-3" />
                      <span>Filters</span>
                    </button>

                    {isDesktopFiltersOpen && (
                      <div className="absolute left-0 top-[calc(100%+0.45rem)] z-50 w-56 overflow-hidden rounded-xl border border-border/60 bg-card/96 p-1.5 text-sm shadow-[0_18px_44px_-24px_rgba(15,23,42,0.34)] backdrop-blur-xl dark:border-border/45 dark:bg-background/96">
                        <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">More filters</div>
                        {secondaryCollectionFilters.map((filterOption) => {
                          const isActive = collectionViewFilter === filterOption.id

                          return (
                            <button
                              key={filterOption.id}
                              onClick={() => {
                                setCollectionViewFilter(filterOption.id)
                                setIsDesktopFiltersOpen(false)
                              }}
                              className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] font-medium text-foreground hover:bg-muted/70"
                            >
                              <span>{filterOption.label}</span>
                              {isActive ? <Check className="h-3.5 w-3.5 text-primary" /> : null}
                            </button>
                          )
                        })}

                        <div className="my-1 h-px bg-border/50" />

                        {hasTrackedCards ? (
                          <button
                            onClick={() => {
                              setIsPriceMode((current) => !current)
                              setIsDesktopFiltersOpen(false)
                            }}
                            className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] font-medium text-foreground hover:bg-muted/70"
                          >
                            <span className="flex items-center gap-2">
                              {isLoadingPrices && isPriceMode ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <span className="text-[13px] font-bold">$</span>}
                              Prices
                            </span>
                            {isPriceMode ? <Check className="h-3.5 w-3.5 text-primary" /> : null}
                          </button>
                        ) : null}

                        {activeMainView === "binder" ? (
                          <button
                            onClick={() => {
                              setIsDesktopFiltersOpen(false)
                              handlePhotoButtonClick()
                            }}
                            disabled={isScanningPage || isFilteredBinderLayout || currentPagePokemon.length === 0}
                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] font-medium text-foreground hover:bg-muted/70 disabled:cursor-not-allowed disabled:opacity-45"
                          >
                            {isScanningPage ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
                            {isScanningPage ? "Scanning page" : "Scan page"}
                          </button>
                        ) : null}
                      </div>
                    )}
                  </div>

                  {isPriceMode && hasTrackedCards && (
                    <div className="flex shrink-0 items-center gap-1.5 rounded-xl border border-primary/20 bg-primary/8 px-2.5 py-1 text-[10px] font-medium text-primary tabular-nums">
                      <span>Total {filteredTotalLabel || "No prices yet"}</span>
                      {filteredPriceSummary.unpricedCount > 0 ? (
                        <>
                          <span className="text-primary/40">•</span>
                          <span>{filteredPriceSummary.unpricedCount} unpriced</span>
                        </>
                      ) : null}
                    </div>
                  )}
                </>
              )}

              </>}

              {activeMainView === "binder" && binderDimension === "2d" && (
                <div className="ml-auto flex shrink-0 items-center gap-1.5">
                  <div className="flex items-center gap-0.5 rounded-xl border border-border/50 bg-card/72 p-0.5 dark:border-border/30 dark:bg-muted/40">
                    <Button variant="ghost" size="icon" className="h-7 w-7 disabled:pointer-events-none disabled:opacity-35" onClick={isSpreadLayout ? goToPrevSpread : goToPrevPage} disabled={!canGoToPreviousVisiblePage} aria-label={isSpreadLayout ? "Previous binder spread" : "Previous binder page"}>
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
                      className="h-6 w-10 rounded-lg border border-border/30 bg-background/70 text-center text-[11px] font-semibold tabular-nums"
                    />
                    <span className="pr-1 text-[11px] text-muted-foreground">/ {totalBinderPages}</span>
                    <Button variant="ghost" size="icon" className="h-7 w-7 disabled:pointer-events-none disabled:opacity-35" onClick={isSpreadLayout ? goToNextSpread : goToNextPage} disabled={!canGoToNextVisiblePage} aria-label={isSpreadLayout ? "Next binder spread" : "Next binder page"}>
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 w-7 rounded-xl px-0"
                    onClick={handleJumpToPreviousNeeded}
                    disabled={activeJumpPokemonList.length === 0}
                    aria-label={`Previous ${activeJumpLabel.toLowerCase()}`}
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    className="h-7 gap-1.5 rounded-xl px-2.5 text-[11px]"
                    onClick={handleJumpToNextNeeded}
                    disabled={activeJumpPokemonList.length === 0}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>Next {activeJumpLabel}</span>
                  </Button>
                </div>
              )}
            </div>
          </div>
          </div>
        </div>
      </nav>

      <div data-testid="main-content" className={`mx-auto flex min-h-0 w-full max-w-[100vw] flex-1 flex-col overflow-hidden px-2 pb-[calc(var(--dock-clearance)+0.5rem)] sm:px-4 md:pb-4 ${activeMainView === "binder" ? "max-w-none" : "max-w-7xl"}`}>
        <input
          ref={pagePhotoInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handlePagePhotoSelected}
        />
        <canvas ref={burstCanvasRef} className="hidden" />

        {isBurstScannerOpen && (
          <div ref={burstScannerRef} role="dialog" aria-modal="true" aria-label="Page scanner" className="fixed inset-0 z-50 bg-black outline-none">
            <div className="mx-auto flex h-full w-full max-w-md flex-col px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-[calc(env(safe-area-inset-top)+0.75rem)]">
              <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[2rem] border border-white/10 bg-black shadow-2xl">
                <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-white">
                  <div>
                    <p className="text-sm font-semibold">{pageScannerMode === "slot-sweep" ? "Slot Sweep" : "Whole Page Sweep"}</p>
                    <p className="text-xs text-white/65">
                      {pageScannerMode === "slot-sweep"
                        ? "Scan one pocket at a time for steadier card matches."
                        : "Move slowly over the full page. Stable slots stay locked."}
                    </p>
                  </div>
                  <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full" onClick={closeBurstScanner} disabled={isCapturingBurst || isApplyingScanResults} aria-label="Close page scanner">
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                <div className="relative min-h-0 flex-1 bg-black">
                  <video
                    ref={burstVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="h-full w-full object-cover"
                  />

                  {pageScannerMode === "slot-sweep" ? (
                    <>
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                        <div
                          className="relative max-h-[82%] w-[72%] max-w-[18rem] rounded-[1.35rem] border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.38),0_0_28px_rgba(255,255,255,0.18)]"
                          style={{ aspectRatio: String(TRADING_CARD_ASPECT_RATIO) }}
                        >
                          <div className="absolute inset-x-5 top-5 h-px bg-white/55" />
                          <div className="absolute inset-x-5 bottom-5 h-px bg-white/30" />
                        </div>
                      </div>
                      <div className="pointer-events-none absolute left-4 top-4 rounded-2xl border border-white/12 bg-black/65 px-3 py-2 text-white shadow-lg backdrop-blur">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/55">{slotSweepTargetLabel}</p>
                        <p className="max-w-[11rem] truncate text-sm font-semibold">{slotSweepTargetPokemon?.name ?? "No slot"}</p>
                      </div>
                      {slotSweepPreviewUrl ? (
                        <div className="pointer-events-none absolute right-4 top-4 w-20 overflow-hidden rounded-xl border border-white/15 bg-black/60 shadow-lg">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={slotSweepPreviewUrl} alt="Last slot scan frame" className="aspect-[2.5/3.5] w-full object-cover" />
                        </div>
                      ) : null}
                    </>
                  ) : burstPreviewResult?.previewDataUrl ? (
                    <div className="pointer-events-none absolute inset-0 bg-black/10">
                      <div
                        className="relative h-full w-full overflow-hidden"
                        style={{ aspectRatio: `${burstPreviewResult.width} / ${burstPreviewResult.height}` }}
                      >
                        <img
                          src={burstPreviewResult.previewDataUrl}
                          alt="Last detected binder page"
                          className="absolute inset-0 h-full w-full object-contain opacity-35"
                        />
                        <div className="absolute inset-0">
                          {burstPreviewSlots.map((slot, index) => (
                            <div
                              key={index}
                              className={`absolute rounded-[0.45rem] border-2 ${
                                slot.occupied
                                  ? "border-emerald-400 bg-emerald-400/20 shadow-[0_0_0_1px_rgba(16,185,129,0.25)]"
                                  : "border-white/30 bg-black/8"
                              }`}
                              style={{
                                left: `${slot.left}%`,
                                top: `${slot.top}%`,
                                width: `${slot.width}%`,
                                height: `${slot.height}%`,
                              }}
                            />
                          ))}
                        </div>
                      </div>
                      <div className="pointer-events-none absolute inset-x-4 top-4 flex items-center justify-between rounded-full border border-white/12 bg-black/60 px-3 py-2 text-[11px] text-white/80 backdrop-blur">
                        <span>Detected frame</span>
                        <span>{burstUsableFrames} usable</span>
                        <span>{burstPreviewResult.slots.filter((slot) => slot.occupied).length} occupied</span>
                      </div>
                    </div>
                  ) : (
                    <div className="pointer-events-none absolute inset-y-[5%] left-[12%] right-[12%] rounded-[2.25rem] border-2 border-white/75 shadow-[0_0_0_9999px_rgba(0,0,0,0.34)]" />
                  )}

                  {!isCameraReady && !cameraError && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="flex items-center gap-2 rounded-full bg-black/55 px-4 py-2 text-sm text-white">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Starting camera
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-3 border-t border-white/10 bg-black/85 px-4 py-4 text-white">
                  <div className="grid grid-cols-2 gap-1 rounded-2xl border border-white/10 bg-white/6 p-1">
                    <button
                      type="button"
                      onClick={() => {
                        setPageScannerMode("slot-sweep")
                        setCameraError(null)
                      }}
                      disabled={isCapturingBurst || isApplyingScanResults}
                      className={`rounded-xl px-3 py-2 text-xs font-semibold transition ${
                        pageScannerMode === "slot-sweep" ? "bg-white text-black" : "text-white/65"
                      }`}
                    >
                      Slot
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPageScannerMode("page-sweep")
                        setCameraError(null)
                      }}
                      disabled={isCapturingBurst || isApplyingScanResults}
                      className={`rounded-xl px-3 py-2 text-xs font-semibold transition ${
                        pageScannerMode === "page-sweep" ? "bg-white text-black" : "text-white/65"
                      }`}
                    >
                      Page
                    </button>
                  </div>

                  {cameraError ? (
                    <p className="text-sm text-destructive">{cameraError}</p>
                  ) : pageScannerMode === "slot-sweep" ? (
                    <div className="space-y-2">
                      <p className="text-sm text-white/70">
                        Put {slotSweepTargetLabel} in the card frame, then capture. The scanner samples {SLOT_SWEEP_FRAME_COUNT} quick frames and moves to the next slot.
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {currentPageSlots.map((pokemon, index) => {
                          if (!pokemon) return null
                          const isDone = slotSweepCompletedSet.has(index)
                          const isCurrent = index === slotSweepSlotIndex

                          return (
                            <span
                              key={index}
                              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                                isCurrent
                                  ? "border-white bg-white text-black"
                                  : isDone
                                    ? "border-emerald-400/35 bg-emerald-400/15 text-emerald-100"
                                    : "border-white/12 bg-white/5 text-white/55"
                              }`}
                            >
                              {getSlotLabel(Math.floor(index / settings.binderCols), index % settings.binderCols)}
                            </span>
                          )
                        })}
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-white/70">
                      Keep the page roughly in frame and move slowly across the slots. The scanner samples for about {Math.round((GUIDED_SCAN_FRAME_COUNT * GUIDED_SCAN_FRAME_DELAY_MS) / 1000)} seconds and locks slots that agree across the video.
                    </p>
                  )}

                  {isCapturingBurst || isApplyingScanResults ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-[11px] text-white/65">
                        <span>
                          {isCapturingBurst
                            ? `Scanning ${burstFramesProcessed}/${pageScannerMode === "slot-sweep" ? SLOT_SWEEP_FRAME_COUNT : GUIDED_SCAN_FRAME_COUNT}`
                            : "Applying results"}
                        </span>
                        <span>{burstUsableFrames} usable frame{burstUsableFrames === 1 ? "" : "s"}</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-white transition-all"
                          style={{
                            width: `${isCapturingBurst
                              ? (burstFramesProcessed / (pageScannerMode === "slot-sweep" ? SLOT_SWEEP_FRAME_COUNT : GUIDED_SCAN_FRAME_COUNT)) * 100
                              : 100}%`,
                          }}
                        />
                      </div>
                    </div>
                  ) : null}

                  <div className="flex items-center justify-end gap-2">
                    <Button variant="ghost" onClick={closeBurstScanner} disabled={isCapturingBurst || isApplyingScanResults}>
                      Cancel
                    </Button>
                    {pageScannerMode === "slot-sweep" ? (
                      <>
                        <Button variant="ghost" onClick={handleSlotSweepSkip} disabled={!isCameraReady || isCapturingBurst || isApplyingScanResults || !slotSweepTargetPokemon}>
                          Skip
                        </Button>
                        <Button onClick={handleSlotSweepCapture} disabled={!isCameraReady || isCapturingBurst || isApplyingScanResults || !slotSweepTargetPokemon}>
                          {isCapturingBurst || isApplyingScanResults ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Camera className="mr-2 h-4 w-4" />}
                          {isCapturingBurst ? "Scanning" : isApplyingScanResults ? "Saving" : "Capture Slot"}
                        </Button>
                      </>
                    ) : (
                      <Button onClick={handleBurstCapture} disabled={!isCameraReady || isCapturingBurst || isApplyingScanResults}>
                        {isCapturingBurst || isApplyingScanResults ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Camera className="mr-2 h-4 w-4" />}
                        {isCapturingBurst ? "Sweeping Page" : isApplyingScanResults ? "Applying Results" : "Start Sweep"}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeMainView === "binder" && <div className={dashboardStyles.switcher}>
          <div><p>Your collection</p>{binderAppearance.message && <span role="status" className="block max-w-[190px] text-[10px] text-muted-foreground">{binderAppearance.message}</span>}</div>
          <div role="group" aria-label="Binder display">
            <button type="button" aria-pressed={binderDimension === "2d"} onClick={() => setBinderDimension("2d")}>2D</button>
            <button type="button" aria-pressed={binderDimension === "3d"} onClick={() => { closeAllOverlays(); setSelectedPokemon(null); setBinderDimension("3d") }}>3D</button>
          </div>
        </div>}

        <div className={`flex min-h-0 flex-1 flex-col space-y-2 animate-fade-in ${
          activeMainView === "binder"
            ? binderDimension === "3d" ? "overflow-y-auto overflow-x-hidden" : "overflow-y-auto overflow-x-hidden md:overflow-visible"
            : "overflow-hidden"
        }`}>
          {activeMainView === "list" ? (
            <DexListView
              pokemonList={filteredPokemonSummaryList}
              collectionByPokemonId={collectionByPokemonId}
              pricesByKey={pricesByCardId}
              getPriceKey={getCollectionItemPriceKey}
              formatPrice={formatPriceLabel}
              onSelectPokemon={handlePokemonSelect}
              onToggleOwned={handleQuickCollect}
              onAddCard={(pokemon) => openCardSelectorForPokemon(pokemon, "collect")}
              onAddWanted={(pokemon) => openCardSelectorForPokemon(pokemon, "wishlist")}
              onTogglePerfect={handleToggleFavorite}
              onBrowseCards={(pokemon) => openCardBrowser({ id: pokemon.id, name: pokemon.name })}
              readOnly={readOnlyMode}
            />
          ) : activeMainView === "wanted" ? (
            renderWantedCardsView()
          ) : activeMainView === "sets" ? (
            <SetPopulationView
              collectionByPokemonId={collectionByPokemonId}
              pricesByKey={pricesByCardId}
              getPriceKey={getCollectionItemPriceKey}
              formatPrice={formatPriceLabel}
              onSelectSlot={handleSelectSetSlot}
              onCollectCard={handleCollectSetCard}
              onWantCard={handleWantSetCard}
              onCollectCards={handleCollectSetCards}
              onWantCards={handleWantSetCards}
              readOnly={readOnlyMode}
            />
          ) : binderDimension === "3d" ? (
            <DashboardBinderPreview
              onSelectPokemon={handlePokemonSelect}
              appearance={binderAppearance.design}
              artwork={binderAppearance.artwork}
              loading={binderAppearance.loading}
              collection={collection}
              enabled={Boolean(user) && !readOnlyMode}
            />
          ) : (
            <>
            {(pageScanSummary || pageScanError || isFilteredBinderLayout) && (
              <div className="rounded-xl border border-border/60 bg-card/82 px-3 py-2 text-xs text-muted-foreground dark:border-border/50 dark:bg-card/70">
                {pageScanError ? (
                  <p>{pageScanError}</p>
                ) : pageScanSummary ? (
                  <div className="space-y-1">
                    <p>
                      Page {pageScanSummary.page}: detected {pageScanSummary.detectedOccupied} occupied slot{pageScanSummary.detectedOccupied === 1 ? "" : "s"}, added {pageScanSummary.newCollected} new card{pageScanSummary.newCollected === 1 ? "" : "s"}
                      {pageScanSummary.alreadyCollected > 0 ? `, ${pageScanSummary.alreadyCollected} already collected` : ""}
                      {pageScanSummary.matchedCards > 0 ? `, matched ${pageScanSummary.matchedCards} card${pageScanSummary.matchedCards === 1 ? "" : "s"}` : ""}.
                    </p>
                    {pageScanSummary.cardMatches.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {pageScanSummary.cardMatches.slice(0, 4).map((match) => (
                          <span key={`${match.slotLabel}-${match.cardName}-${match.setName}`} className="rounded-full border border-border/60 bg-background/60 px-2 py-0.5 text-[11px] text-foreground dark:border-border/50 dark:bg-background/40">
                            {match.slotLabel} {match.cardName} · {Math.round(match.confidence * 100)}%
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <p>Scanning is disabled while a card-status filter is on, because those pages no longer match your binder layout.</p>
                )}
                <p className="mt-1 hidden text-[11px] text-muted-foreground/80 sm:block">
                  The scanner checks slot occupancy and compares occupied pockets against the closest cards for each slot. Fill the frame with one page and keep the pockets sharp.
                </p>
              </div>
            )}

            {collectionViewFilter === "wanted" && (
              <div className="shrink-0 rounded-xl border border-amber-400/25 bg-amber-400/8 p-1.5 sm:p-2">
                <div className="mb-1.5 grid grid-cols-2 gap-1.5 sm:mb-2 sm:grid-cols-3 sm:gap-2">
                  <div className="hidden rounded-lg border border-amber-400/18 bg-card/78 px-3 py-2 sm:block">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">All tracked</p>
                    <p className="mt-0.5 text-sm font-semibold tabular-nums">{wantedModeCombinedTotalLabel || (isLoadingPrices ? "Loading prices" : "No prices yet")}</p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">{ownedTrackedCards.length + wantedCardEntries.length} cards, owned and wanted</p>
                  </div>
                  <div className="min-w-0 rounded-lg border border-emerald-400/18 bg-card/78 px-2.5 py-2 sm:px-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Owned value</p>
                    <p className="mt-0.5 truncate text-[13px] font-semibold tabular-nums sm:text-sm">{ownedTotalLabel || (isLoadingPrices ? "Loading" : "No prices")}</p>
                    <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{ownedTrackedCards.length} owned card{ownedTrackedCards.length === 1 ? "" : "s"}</p>
                  </div>
                  <div className="min-w-0 rounded-lg border border-amber-400/22 bg-card/78 px-2.5 py-2 sm:px-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">To buy</p>
                    <p className="mt-0.5 truncate text-[13px] font-semibold tabular-nums text-amber-600 dark:text-amber-300 sm:text-sm">{wantedTotalLabel || (isLoadingPrices ? "Loading" : "No prices")}</p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {wantedCardEntries.length} wanted card{wantedCardEntries.length === 1 ? "" : "s"}
                      {wantedModeCombinedPriceSummary.unpricedCount > 0 ? `, ${wantedModeCombinedPriceSummary.unpricedCount} unpriced` : ""}
                    </p>
                  </div>
                </div>
                <div className="overflow-x-auto scrollbar-hide">
                  <div className="flex min-w-max gap-2">
                    {wantedCardEntries.length === 0 ? (
                      <div className="px-2 py-1 text-xs text-muted-foreground">No wanted cards yet</div>
                    ) : wantedCardEntries.map(({ pokemonId, pokemonName, card }) => {
                      const priceKey = getCardPriceKey(card.card_id, card.card_language ?? "en")
                      const priceLabel = formatPriceLabel(pricesByCardId[priceKey])

                      return (
                        <button
                          key={`${pokemonId}-${card.card_id}-${card.card_finish ?? "normal"}`}
                          onClick={() => {
                            const pokemon = getPokemonSummary(pokemonId)
                            if (pokemon) {
                              handlePokemonSelect(pokemon)
                            }
                          }}
                          className="flex w-44 shrink-0 items-center gap-2 rounded-lg border border-amber-400/20 bg-card/82 p-1.5 text-left sm:w-56 sm:p-2"
                        >
                          {card.card_image ? (
                            <img src={card.card_image} alt={card.card_name} className="trading-card w-8 object-cover sm:w-10" loading="lazy" />
                          ) : (
                            <div className="h-12 w-8 rounded bg-muted sm:h-14 sm:w-10" />
                          )}
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold">{card.card_name}</p>
                            <p className="truncate text-[10px] text-muted-foreground">{pokemonName} · {formatCardFinishLabel(card.card_finish)}</p>
                            <p className="mt-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-300">{priceLabel ?? (isLoadingPrices ? "Loading price" : "No price")}</p>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Binder Grid */}
            <div ref={binderStageRef} className="flex min-h-0 flex-1 items-center justify-center overflow-hidden pb-1 md:pb-0">
              <div
                ref={binderRef}
                data-page-turn-ms={pageTurnTiming.durationMs}
                className={`relative max-h-full max-w-full transition-[opacity,transform] ${
                  isPageTransitioning
                    ? transitionDirection === "left"
                      ? "opacity-0 -translate-x-4"
                      : "opacity-0 translate-x-4"
                    : "opacity-100 translate-x-0"
                }`}
                style={{
                  aspectRatio: String(displayedBinderAspectRatio),
                  width: binderFitSize ? `${binderFitSize.width}px` : "100%",
                  height: binderFitSize ? `${binderFitSize.height}px` : "auto",
                  overscrollBehaviorX: "contain",
                  touchAction: "pan-y",
                  transitionDuration: `${pageTurnTiming.durationMs}ms`,
                  transitionTimingFunction: PAGE_TURN_EASING,
                }}
              >
                <div className={`grid h-full w-full ${isSpreadLayout ? "grid-cols-2 gap-3 xl:gap-4" : "grid-cols-1"}`}>
                  {displayedSpreadPages.map((page) => {
                    if (page.kind === "info") {
                      return renderSpreadInfoPage(page.side)
                    }

                    if (page.kind === "blank") {
                      return renderSpreadBlankPage(page.side)
                    }

                    return renderBinderGridPage(page.pageNumber, page.side)
                  })}
                </div>
              </div>
            </div>

            {/* Page Info Footer */}
            <div className="hidden shrink-0 flex-col items-center justify-center gap-1 text-[10px] text-muted-foreground/70 md:hidden">
              {isPriceMode && hasTrackedCards && (
                <p className="text-center text-[10px] font-medium text-primary/85">
                  {visiblePageLabel} {visiblePageTotalLabel || "No page prices"}
                  {filteredTotalLabel ? ` · Filter total ${filteredTotalLabel}` : ""}
                  {visiblePagePriceSummary.unpricedCount > 0 ? ` · ${visiblePagePriceSummary.unpricedCount} unpriced in view` : ""}
                </p>
              )}
              <div className="flex items-center justify-center gap-3">
              <span className="tabular-nums">{settings.binderRows}x{settings.binderCols} Binder</span>
              <span className="w-px h-3 bg-border/50" />
              <span className="tabular-nums">{visiblePageLabel}</span>
              <span className="w-px h-3 bg-border/50 sm:block" />
              <span className="tabular-nums">{filteredPokemonList.length} Pokemon</span>
              <span className="hidden sm:block w-px h-3 bg-border/50" />
              <span className="hidden sm:block">
                {isSpreadLayout
                  ? `Swipe, trackpad, or arrows move a spread; N / Shift+N still jump through ${activeJumpLabel.toLowerCase()} slots`
                  : `Swipe, trackpad, arrows, or N / Shift+N to jump through ${activeJumpLabel.toLowerCase()} slots`}
              </span>
              </div>
            </div>
            </>
          )}
        </div>
      </div>

      {renderSelectedPokemonQuickPanel()}
      {renderMobileSlotActionBar()}

      {isSearchOpen && (
        <div data-overlay-backdrop className="fixed inset-0 z-40 bg-black/65 backdrop-blur-sm" onClick={closeSearch}>
          <div className="mx-auto flex h-full w-full max-w-2xl flex-col px-3 pb-[calc(var(--dock-clearance)+0.75rem)] pt-[calc(env(safe-area-inset-top)+0.75rem)] sm:px-4 md:pb-[calc(env(safe-area-inset-bottom)+1rem)]">
            <div
              ref={searchDialogRef}
              role="dialog"
              aria-modal="true"
              aria-label="Search Pokemon"
              onClick={(event) => event.stopPropagation()}
              className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[1.75rem] border border-border/65 bg-card/96 shadow-[0_30px_80px_-36px_rgba(15,23,42,0.35)] dark:border-border/50 dark:bg-background/96 dark:shadow-2xl">
              <div className="flex items-center justify-between border-b border-border/40 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold">Search Pokemon</p>
                  <p className="text-xs text-muted-foreground">Find a mon and jump straight to its binder slot.</p>
                </div>
                <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full" onClick={closeSearch} aria-label="Close search">
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
                <PokemonSearch
                  onSelect={(pokemon) => {
                    handlePokemonSelect(pokemon)
                    setIsSearchOpen(false)
                  }}
                  pokemonList={filteredPokemonList}
                  currentPagePokemonList={currentPagePokemon}
                  getResultMeta={getSearchResultMeta}
                  totalPages={totalBinderPages}
                  onJumpToPage={handleSearchJumpToPage}
                  onBrowseCards={(pokemon, highlightCardId) => openCardBrowser(pokemon, { highlightCardId })}
                  getOfflineCards={getOfflineSearchCards}
                />
                {selectedPokemon && (
                  <div className="mt-4 rounded-2xl border border-border/60 bg-card p-4 shadow-sm dark:border-border/50">
                    <div className="flex items-center gap-3">
                      <div className={`relative flex shrink-0 items-center justify-center bg-muted/40 ${selectedPrimaryCardPreview?.cardImage ? "trading-card w-11" : "h-16 w-16 rounded-xl"}`}>
                        <img
                          src={selectedPrimaryCardPreview?.cardImage ?? selectedPokemonDisplayImage ?? getDetailArtwork(selectedPokemon)}
                          alt={selectedPrimaryCardPreview?.cardName ?? selectedPokemonDisplayName}
                          className={selectedPrimaryCardPreview?.cardImage
                            ? "absolute inset-0 h-full w-full object-cover"
                            : `absolute inset-2 max-w-[calc(100%-1rem)] max-h-[calc(100%-1rem)] m-auto ${selectedPokemonDisplayFit} ${selectedPokemonDisplayTone}`}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-muted-foreground">#{String(selectedPokemon.id).padStart(4, "0")}</p>
                        <h2 className="truncate text-lg font-bold">{selectedPokemonDisplayName}</h2>
                        {selectedHasWantedCard && selectedPrimaryCardPreview?.cardName ? (
                          <p className="truncate text-xs text-amber-500">Wanted: {selectedPrimaryCardPreview.cardName}</p>
                        ) : collectionItem?.card_name ? (
                          <p className="truncate text-xs text-primary">{collectionItem.card_name}</p>
                        ) : collected ? (
                          <p className="text-xs text-muted-foreground">Collected, no card assigned</p>
                        ) : readOnlyMode ? (
                          <p className="text-xs text-muted-foreground">Browse this shared slot and use filters to inspect the binder.</p>
                        ) : (
                          <p className="text-xs text-muted-foreground">Jump to this slot to collect or pick a card.</p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {isMobileNavExpanded && !isSearchOpen && (
        <div data-overlay-backdrop className="fixed inset-0 z-40 bg-black/45 backdrop-blur-sm md:hidden" onClick={closeControlsSheet}>
          <div
            ref={controlsSheetRef}
            role="dialog"
            aria-modal="true"
            aria-label="Controls"
            className="absolute inset-x-0 bottom-0 overflow-y-auto outline-none overscroll-contain rounded-t-[1.75rem] border-t border-border/65 bg-card/96 px-4 pb-[calc(var(--dock-clearance)+1rem)] pt-3 shadow-[0_-24px_64px_-32px_rgba(15,23,42,0.35)] dark:border-border/50 dark:bg-background/96 dark:shadow-2xl"
            onClick={(event) => event.stopPropagation()}
            style={{
              maxHeight: "calc(100dvh - env(safe-area-inset-top) - 0.75rem)",
              WebkitOverflowScrolling: "touch",
              touchAction: "pan-y",
            }}
          >
            <div data-sheet-grabber className="-mx-4 -mt-3 px-4 pt-3" {...controlsSheetSwipe}>
            <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-border/60" />
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">Controls</p>
                <p className="text-xs text-muted-foreground">{collectionStats.percentage}% complete</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0 rounded-full"
                onClick={closeControlsSheet}
                aria-label="Close controls"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-[auto_1fr_auto] items-center gap-1 rounded-2xl border border-border/60 bg-background/62 p-1 dark:border-border/40 dark:bg-muted/35">
                <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl" onClick={() => setSelectedGen(prev => prev > 0 ? prev - 1 : GENERATIONS.length - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <select
                  value={selectedGen}
                  onChange={(e) => setSelectedGen(Number(e.target.value))}
                  className="h-9 min-w-0 bg-transparent text-center text-sm font-semibold cursor-pointer focus:outline-none"
                >
                  {GENERATIONS.map((gen) => (
                    <option key={gen.id} value={gen.id}>
                      {gen.id === 0 ? "All Pokemon" : `Gen ${gen.id}${gen.region ? ` ${gen.region}` : ""}`}
                    </option>
                  ))}
                </select>
                <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl" onClick={() => setSelectedGen(prev => prev < GENERATIONS.length - 1 ? prev + 1 : 0)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>

              {isCompactViewport && (
                <button
                  onClick={() => setIsMobileSpreadPreview((current) => !current)}
                  aria-pressed={isMobileSpreadPreview}
                  className={`flex h-11 w-full items-center justify-between rounded-2xl border px-4 text-sm font-semibold transition-all ${
                    isMobileSpreadPreview
                      ? "border-primary/30 bg-primary/12 text-primary"
                      : "border-border/60 bg-background/62 text-foreground dark:border-border/40 dark:bg-muted/35"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <BookOpen className="h-4 w-4" />
                    Spread preview
                  </span>
                  <span className="text-xs text-muted-foreground">{isMobileSpreadPreview ? "On" : "Off"}</span>
                </button>
              )}

              {canFilterCollection && (
                <div className="grid grid-cols-2 gap-2">
                  {COLLECTION_VIEW_FILTERS.map((filterOption) => {
                    const isActive = collectionViewFilter === filterOption.id

                    return (
                      <button
                        key={filterOption.id}
                        onClick={() => {
                          setCollectionViewFilter(filterOption.id)
                          setIsMobileNavExpanded(false)
                        }}
                        className={`h-11 rounded-2xl border px-3 text-sm font-semibold transition-all ${
                          isActive
                            ? "border-primary/35 bg-primary/12 text-primary"
                            : "border-border/60 bg-background/62 text-muted-foreground dark:border-border/40 dark:bg-muted/35"
                        }`}
                      >
                        {filterOption.mobileLabel}
                      </button>
                    )
                  })}
                </div>
              )}

              <div className={`grid gap-2 ${hasTrackedCards ? "grid-cols-2" : "grid-cols-1"}`}>
                {hasTrackedCards && (
                  <button
                    onClick={() => setIsPriceMode((current) => !current)}
                    className={`h-11 rounded-2xl border px-3 text-sm font-semibold transition-all ${
                      isPriceMode
                        ? "border-primary/35 bg-primary/12 text-primary"
                        : "border-border/60 bg-background/62 text-muted-foreground dark:border-border/40 dark:bg-muted/35"
                    }`}
                  >
                    {isLoadingPrices && isPriceMode ? "Loading prices" : "Prices"}
                  </button>
                )}
                <button
                  onClick={handlePhotoButtonClick}
                  disabled={isScanningPage || isFilteredBinderLayout || currentPagePokemon.length === 0}
                  className="h-11 rounded-2xl border border-border/60 bg-background/62 px-3 text-sm font-semibold text-muted-foreground transition-all disabled:opacity-45 dark:border-border/40 dark:bg-muted/35"
                >
                  {isScanningPage ? "Scanning" : "Scan page"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isMobileFilterSheetOpen && !isSearchOpen && (
        <div data-overlay-backdrop className="fixed inset-0 z-40 bg-black/55 backdrop-blur-sm md:hidden" onClick={closeFilterSheet}>
          <div
            ref={filterSheetRef}
            role="dialog"
            aria-modal="true"
            aria-label="Binder View"
            className="absolute inset-x-0 bottom-0 overflow-y-auto overscroll-contain rounded-t-[1.75rem] border-t border-border/65 bg-card/96 px-4 pb-[calc(var(--dock-clearance)+1rem)] pt-4 outline-none shadow-[0_-24px_64px_-32px_rgba(15,23,42,0.35)] dark:border-border/50 dark:bg-background/96 dark:shadow-2xl"
            onClick={(event) => event.stopPropagation()}
            style={{
              maxHeight: "calc(100dvh - env(safe-area-inset-top) - 0.75rem)",
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
      )}

      <nav aria-label="Main navigation" className="fixed inset-x-0 bottom-0 z-[45] max-w-[100vw] overflow-hidden px-2 pb-[var(--dock-inset)] md:hidden">
        <div className="mx-auto grid w-full min-w-0 max-w-xl grid-cols-[minmax(0,1fr)_auto] items-center gap-1 rounded-[1.25rem] border border-border/70 bg-card/96 p-1 shadow-[0_18px_52px_-30px_rgba(15,23,42,0.36)] backdrop-blur-xl dark:border-border/50 dark:bg-background/96 dark:shadow-black/10">
          <div className="grid min-w-0 grid-cols-5 items-center rounded-2xl bg-muted/42 dark:bg-muted/35">
            <button
              onClick={openSearch}
              aria-label="Search"
              title="Search"
              className={`flex h-10 min-w-0 items-center justify-center rounded-[0.9rem] px-1 transition-all ${
                isSearchOpen ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
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
              className={`flex h-10 min-w-0 items-center justify-center rounded-[0.9rem] px-1 transition-all ${
                !isSearchOpen && activeMainView === "binder" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
              }`}
            >
              <Grid3X3 className="h-4 w-4" />
            </button>
            <button
              onClick={() => {
                switchMainView("list")
              }}
              aria-label="List"
              title="List"
              className={`flex h-10 min-w-0 items-center justify-center rounded-[0.9rem] px-1 transition-all ${
                !isSearchOpen && activeMainView === "list" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
              }`}
            >
              <ListChecks className="h-4 w-4" />
            </button>
            <button
              onClick={() => {
                switchMainView("wanted")
              }}
              aria-label="Wanted"
              title="Wanted"
              className={`flex h-10 min-w-0 items-center justify-center rounded-[0.9rem] px-1 transition-all ${
                !isSearchOpen && activeMainView === "wanted" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
              }`}
            >
              <Heart className="h-4 w-4" />
            </button>
            <button
              onClick={() => {
                switchMainView("sets")
              }}
              aria-label="Sets"
              title="Sets"
              className={`flex h-10 min-w-0 items-center justify-center rounded-[0.9rem] px-1 transition-all ${
                !isSearchOpen && activeMainView === "sets" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
              }`}
            >
              <Layers3 className="h-4 w-4" />
            </button>
          </div>

            {!isSearchOpen && activeMainView === "binder" && (
              <div className="flex shrink-0 items-center gap-1">
              {hasTrackedCards && (
                <Button
                  variant={isPriceMode ? "default" : "outline"}
                  size="icon"
                  className="h-10 w-9 shrink-0 rounded-2xl px-0"
                  onClick={() => setIsPriceMode((current) => !current)}
                  aria-label={isPriceMode ? "Hide prices" : "Show prices"}
                >
                  {isLoadingPrices && isPriceMode ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <span className="text-[13px] font-bold">$</span>}
                </Button>
              )}
              <Button
                variant="default"
                size="icon"
                className="h-10 w-9 shrink-0 rounded-2xl px-0"
                onClick={handleJumpToNextNeeded}
                disabled={activeJumpPokemonList.length === 0}
                aria-label={`Next ${activeJumpLabel.toLowerCase()}`}
              >
                <Sparkles className="h-3.5 w-3.5" />
              </Button>
                <Button
                  variant={collectionViewFilter === "all" && !isMobileFilterSheetOpen ? "outline" : "default"}
                  size="icon"
                className="h-10 w-9 shrink-0 rounded-2xl px-0"
                onClick={() => openExclusively(() => { setSelectedPokemon(null); setIsMobileFilterSheetOpen(true) })}
                disabled={!canFilterCollection}
                aria-label={`Filter: ${activeCollectionFilterOption.mobileLabel}`}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-10 w-9 shrink-0 rounded-2xl px-0"
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

      {/* Modals */}
      <SettingsModal
        appearance={binderAppearance.hasSavedDesign ? binderAppearance.design : undefined}
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
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
        cloudCollectedCount={collectionCount}
        localCollectedCount={settingsLocalCollectedCount}
        localPendingSyncCount={localPendingSyncCount}
        isSyncingLocalCollection={isSyncingLocalCollection}
        localCollectionSyncMessage={localCollectionSyncMessage}
        onSyncLocalCollectionToCloud={handleSyncLocalCollectionToCloud}
        isOnline={isOnline}
        isInstalledApp={isInstalledApp}
        canInstallApp={canInstallApp}
        pwaStatusMessage={pwaStatusMessage}
        onInstallApp={handleInstallApp}
        isReadOnlyView={readOnlyMode}
        sharePath={sharePath}
        isShareEnabled={isShareEnabled}
        isShareLoading={isShareLoading}
        shareMessage={shareMessage}
        onEnableReadOnlyShare={handleEnableReadOnlyShare}
        onDisableReadOnlyShare={handleDisableReadOnlyShare}
        trackedCardCount={trackedPriceLookups.length}
        isRefreshingPrices={isRefreshingPrices}
        priceRefreshMessage={priceRefreshMessage}
        onRefreshPrices={handleRefreshPrices}
        motionGlintStatus={motionGlintStatus}
        motionGlintMessage={motionGlintMessage}
        onRequestMotionGlint={handleRequestMotionGlint}
      />
      <AuthModal isOpen={isAuthOpen} onClose={() => setIsAuthOpen(false)} />
      {isPartnerOpen ? (
        <PartnerModal isOpen={isPartnerOpen} onClose={() => setIsPartnerOpen(false)} user={user} />
      ) : null}

      {cardBrowser ? (
        <PokemonCardsBrowser
          key={`${cardBrowser.pokemon.id}:${cardBrowser.highlightCardId ?? ""}`}
          pokemon={cardBrowser.pokemon}
          highlightCardId={cardBrowser.highlightCardId}
          collectionItem={getCollectionItem(cardBrowser.pokemon.id) ?? null}
          isDesktop={isDesktopViewport}
          readOnly={readOnlyMode}
          onClose={closeCardBrowser}
          onWantCard={readOnlyMode ? undefined : (card, isWanted) => handleBrowseWantCard(cardBrowser.pokemon, card, isWanted)}
          onAddCard={readOnlyMode ? undefined : (card) => handleBrowseAddCard(cardBrowser.pokemon, card)}
          formatPrice={formatPriceLabel}
        />
      ) : null}

      {isCardSelectorOpen && selectedPokemon && (
        <CardSelector
          pokemonId={selectedPokemon.id}
          pokemonName={selectedPokemon.name}
          onSelect={handleCardSelected}
          onClose={() => setIsCardSelectorOpen(false)}
          selectedCardId={cardSelectorMode === "wishlist" ? collectionItem?.wanted_cards?.[0]?.card_id : collectionItem?.card_id}
          selectedCollectedCardId={collectionItem?.card_id}
          selectedWantedCardId={collectionItem?.wanted_cards?.[0]?.card_id}
          mode={cardSelectorMode}
        />
      )}

      <footer className="hidden md:block fixed bottom-0 left-0 right-0 py-2.5 text-center text-muted-foreground/40 text-[10px] bg-background/80 backdrop-blur-sm border-t border-border/20 safe-area-bottom">
        Made with 🩵 by{" "}
        <a
          href="https://callum.io"
          target="_blank"
          rel="noreferrer"
          className="transition-colors hover:text-foreground/70"
        >
          Cal
        </a>{" "}
        for his wife, Laura
        <CardDataAttribution className="mx-auto mt-0.5 max-w-3xl px-4 text-[9px] leading-snug" />
      </footer>
    </main>
  )
}

function PokemonSlot({
  pokemon,
  isCollected,
  isWishlisted,
  isSelected,
  isLongPressed,
  slotLabel,
  status,
  cardImage,
  cardName,
  cardFinish = "normal",
  hasAssignedCard,
  priceLabel,
  showPriceMode,
  readOnly,
  showBinderSlotGlare,
  showCardFinishEffects,
  binderSlotGlareStyle,
  cardFinishEffectStyle,
  cardFinishGlint,
  onClick,
  onDoubleClick,
  onLongPress,
  onAddCard,
  onAddWanted,
  onQuickCollect,
  onToggleFavorite,
  priority,
  buttonRef,
}: {
  pokemon: { id: number; name: string }
  isCollected: boolean
  isWishlisted: boolean
  isSelected: boolean
  isLongPressed: boolean
  slotLabel: string
  status?: SlotStatus
  cardImage?: string | null
  cardName?: string | null
  cardFinish?: CardFinish | null
  hasAssignedCard: boolean
  priceLabel?: string | null
  showPriceMode: boolean
  readOnly: boolean
  showBinderSlotGlare: boolean
  showCardFinishEffects: boolean
  binderSlotGlareStyle: CSSProperties
  cardFinishEffectStyle: CSSProperties
  cardFinishGlint: {
    x: number
    y: number
    angle: number
  }
  onClick: () => void
  onDoubleClick: () => void
  onLongPress: () => void
  onAddCard: () => void
  onAddWanted: () => void
  onQuickCollect: () => void
  onToggleFavorite: () => void
  user: User | null
  priority?: boolean
  buttonRef?: (node: HTMLButtonElement | null) => void
}) {
  const longPressTimer = useRef<NodeJS.Timeout | null>(null)
  const isLongPressTriggered = useRef(false)
  const touchStartPosition = useRef({ x: 0, y: 0 })

  const handleTouchStart = (event: ReactTouchEvent) => {
    const touch = event.touches[0]
    touchStartPosition.current = { x: touch.clientX, y: touch.clientY }
    if (readOnly) return
    isLongPressTriggered.current = false
    longPressTimer.current = setTimeout(() => {
      isLongPressTriggered.current = true
      onLongPress()
    }, 400)
  }

  const clearLongPressTimer = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
    }
  }

  const cardImageSource = getUsableImageSource(cardImage)
  const fallbackPreviewImage = getPokemonOfficialArtworkUrl(pokemon.id)
  const previewImage = resolveSlotImageUrl(pokemon.id, cardImage)
  const [previewImageSrc, setPreviewImageSrc] = useState(previewImage)
  const [didFallbackPreviewImage, setDidFallbackPreviewImage] = useState(false)
  const [isPreviewImageLoaded, setIsPreviewImageLoaded] = useState(false)
  const isVisuallyCollected = isCollected && !isWishlisted
  const previewFitClass = "object-contain"
  const previewToneClass = isVisuallyCollected
    ? ""
    : isWishlisted
      ? "grayscale saturate-[0.75] brightness-[0.92] contrast-[0.95] opacity-90"
      : "grayscale"
  const titleLabel = isWishlisted && cardName ? cardName : pokemon.name
  const subtitleLabel = isWishlisted && cardName
    ? `Wanted for #${String(pokemon.id).padStart(4, "0")}`
    : `#${String(pokemon.id).padStart(4, "0")}${showPriceMode && priceLabel ? ` • ${priceLabel}` : ""}`
  const hasCardPreviewSource = Boolean(cardImageSource)
  const hasCardPreview = hasCardPreviewSource && !didFallbackPreviewImage
  const statusChip = isWishlisted
    ? {
        label: isCollected ? "Want" : "Wanted",
        className: "border-amber-400/50 bg-amber-500/90 text-white",
      }
    : status === "finalized"
      ? {
          label: "Perfect",
          className: "border-amber-400/50 bg-amber-500/90 text-white",
        }
      : status === "considering"
        ? {
            label: "Upgrade",
            className: "border-sky-400/50 bg-sky-500/90 text-white",
          }
        : isCollected
          ? {
              label: "Owned",
              className: "border-emerald-400/50 bg-emerald-500/90 text-white",
            }
          : null
  const showStatusChip = Boolean(statusChip)
  const cardPreviewPose = hasCardPreview ? getCardPreviewPose(pokemon.id) : null
  const previewSurfaceInsetClass = "inset-[3px]"
  const slotRadiusStyle = { borderRadius: TRADING_CARD_CORNER_RADIUS }
  const previewRadiusStyle = { borderRadius: TRADING_CARD_INNER_CORNER_RADIUS }
  const effectiveCardFinish = cardFinish ?? "normal"
  const slotCardFinishGlint = getSlotFinishGlint(cardFinishGlint, pokemon.id)
  const slotCardFinishEffectStyle = {
    ...cardFinishEffectStyle,
    "--glint-x": `${slotCardFinishGlint.x * 100}%`,
    "--glint-y": `${slotCardFinishGlint.y * 100}%`,
    "--glint-angle": `${slotCardFinishGlint.angle}deg`,
    "--glint-shift-x": `${(slotCardFinishGlint.x * 100 - 50) * 0.34}%`,
    "--glint-shift-y": `${(slotCardFinishGlint.y * 100 - 50) * 0.2}%`,
    "--glint-streak-x": `${(slotCardFinishGlint.x * 100 - 50) * 0.42}%`,
    "--slot-shader-opacity": String(0.56 + slotCardFinishGlint.intensity * 0.1),
    "--slot-mobile-sheen-opacity": String(0.2 + slotCardFinishGlint.intensity * 0.05),
  } as CSSProperties
  const finishEffectClass = getCardFinishEffectClass(effectiveCardFinish)
  const shouldShowCardFinish = Boolean(
    hasCardPreview &&
    isPreviewImageLoaded &&
    !didFallbackPreviewImage &&
    showCardFinishEffects &&
    effectiveCardFinish !== "normal"
  )
  const shouldShowPocketGlare = showBinderSlotGlare && !shouldShowCardFinish
  const quickActions = getBinderSlotQuickActions({ hasAssignedCard, readOnly })
  const handlePreviewImageError = (event: SyntheticEvent<HTMLImageElement>) => {
    setIsPreviewImageLoaded(false)

    if (previewImageSrc !== fallbackPreviewImage) {
      setPreviewImageSrc(fallbackPreviewImage)
      setDidFallbackPreviewImage(true)
      return
    }

    event.currentTarget.style.visibility = "hidden"
  }

  useEffect(() => {
    setPreviewImageSrc(previewImage)
    setDidFallbackPreviewImage(false)
    setIsPreviewImageLoaded(false)
  }, [previewImage])

  return (
    <div className="relative group/slot">
      <button
        ref={buttonRef}
        data-dex-id={pokemon.id}
        aria-label={`${slotLabel} ${formatPokemonDisplayName(pokemon.name)} #${String(pokemon.id).padStart(4, "0")}`}
        onClick={(event) => {
          if (event.detail !== 0 && isLongPressTriggered.current) {
            event.preventDefault()
            event.stopPropagation()
            return
          }
          onClick()
        }}
        onPointerDown={() => {
          isLongPressTriggered.current = false
        }}
        onDoubleClick={onDoubleClick}
        onTouchStart={handleTouchStart}
        onTouchMove={(event) => {
          const touch = event.touches[0]
          if (getTouchGestureIntent(touch.clientX - touchStartPosition.current.x, touch.clientY - touchStartPosition.current.y).movedEnough) {
            clearLongPressTimer()
          }
        }}
        onTouchEnd={clearLongPressTimer}
        onTouchCancel={clearLongPressTimer}
        onContextMenu={(e) => {
          e.preventDefault()
          if (readOnly) return
          onLongPress()
        }}
        className={`relative isolate h-full w-full overflow-hidden transition-all duration-150 group ${
          isSelected
            ? "ring-2 ring-primary ring-offset-1 ring-offset-background scale-[1.03] z-10"
            : isWishlisted
              ? "ring-1 ring-amber-500/40"
            : status === "finalized"
              ? "ring-1 ring-amber-500/60 shadow-[0_0_0_1px_rgba(245,158,11,0.18)]"
            : isVisuallyCollected && hasCardPreview
              ? "ring-1 ring-black/5 shadow-[0_6px_14px_rgba(15,23,42,0.04)] dark:ring-white/6 dark:shadow-[0_8px_18px_rgba(0,0,0,0.14)]"
              : isVisuallyCollected
              ? "ring-1 ring-green-500/40"
              : "hover:ring-1 hover:ring-primary/30 active:scale-[0.98]"
        }`}
        style={slotRadiusStyle}
      >
        <div
          className={`absolute inset-0 border shadow-[inset_0_1px_0_rgba(255,255,255,0.55),inset_0_-10px_18px_rgba(15,23,42,0.08)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),inset_0_-10px_18px_rgba(0,0,0,0.24)] ${
            hasCardPreview
              ? "border-black/4 bg-transparent shadow-none dark:border-white/6 dark:shadow-none"
              : "border-white/55 bg-white/16 dark:border-white/10 dark:bg-white/[0.03]"
          }`}
          style={slotRadiusStyle}
        />
        {!hasCardPreview && (
          <div
            className={`absolute ${previewSurfaceInsetClass} border border-black/6 dark:border-white/8`}
            style={previewRadiusStyle}
          />
        )}
        {!hasCardPreview && (
          <div className={`absolute inset-0 transition-colors ${
            isVisuallyCollected
              ? "bg-gradient-to-br from-green-500/15 to-emerald-500/5"
              : isWishlisted
                ? "bg-gradient-to-br from-amber-500/12 to-orange-500/5"
                : "bg-gradient-to-br from-white/92 to-slate-100/88 dark:from-muted/80 dark:to-muted/40"
          }`} />
        )}

        <div className="absolute top-0.5 left-0.5 z-10 rounded bg-white/74 px-1 py-0.5 text-[7px] font-bold tabular-nums text-slate-600 backdrop-blur-sm sm:top-1 sm:left-1 sm:text-[8px] dark:bg-black/50 dark:text-white/70">
          {slotLabel}
        </div>

        {!hasCardPreview && (
          <div className="absolute inset-x-[7px] top-[7px] h-px bg-white/65 dark:bg-white/10" />
        )}

        {shouldShowPocketGlare ? (
          <BinderSlotGlare
            glareStyle={binderSlotGlareStyle}
            innerRadius={TRADING_CARD_INNER_CORNER_RADIUS}
          />
        ) : null}

        {hasCardPreview ? (
          <div
            className="absolute inset-0 z-[1] overflow-hidden"
            style={{
              borderRadius: TRADING_CARD_CORNER_RADIUS,
            }}
          >
            <img
              src={previewImageSrc}
              alt={cardName || pokemon.name}
              className={`h-full w-full ${didFallbackPreviewImage ? "object-contain p-3 opacity-85" : "object-cover"} ${previewToneClass} transition-transform duration-150 group-hover:scale-[1.015]`}
              loading={priority ? "eager" : "lazy"}
              fetchPriority={priority ? "high" : "auto"}
              decoding="async"
              draggable={false}
              onLoad={() => setIsPreviewImageLoaded(true)}
              onError={handlePreviewImageError}
            />
            {shouldShowCardFinish ? (
              <CardFinishShader
                finish={effectiveCardFinish}
                glintX={slotCardFinishGlint.x}
                glintY={slotCardFinishGlint.y}
                glintAngle={slotCardFinishGlint.angle}
                glintPhase={slotCardFinishGlint.phase}
                patternSeed={slotCardFinishGlint.patternSeed}
                finishIntensity={slotCardFinishGlint.intensity}
                hueOffset={slotCardFinishGlint.hueOffset}
                patternScale={slotCardFinishGlint.patternScale}
                fallbackClassName={finishEffectClass}
                fallbackStyle={slotCardFinishEffectStyle}
              />
            ) : null}
          </div>
        ) : (
          <div
            className={`absolute ${previewSurfaceInsetClass} z-[1] overflow-hidden`}
            style={{
              ...previewRadiusStyle,
              ...(cardPreviewPose ? { transform: cardPreviewPose, transformOrigin: "center center" } : {}),
            }}
          >
            <img
              src={previewImageSrc}
              alt={cardName || pokemon.name}
              className={`h-full w-full ${previewFitClass} ${previewToneClass} group-hover:scale-[1.025] transition-transform duration-150`}
              loading={priority ? "eager" : "lazy"}
              fetchPriority={priority ? "high" : "auto"}
              decoding="async"
              draggable={false}
              onLoad={() => setIsPreviewImageLoaded(true)}
              onError={handlePreviewImageError}
            />
          </div>
        )}

        {!hasCardPreview && (
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent p-1 sm:p-1.5">
            <p className="text-[8px] sm:text-[10px] text-white/90 font-semibold truncate capitalize leading-tight">
              {titleLabel}
            </p>
            <p className="text-[7px] sm:text-[9px] text-white/50 tabular-nums">
              {subtitleLabel}
            </p>
          </div>
        )}

        {showStatusChip && statusChip && (
          <div
            className={`absolute top-1 right-1 z-10 rounded-full border px-2 py-0.5 text-[7px] font-semibold uppercase tracking-[0.14em] shadow-none sm:top-1.5 sm:right-1.5 sm:text-[8px] ${statusChip.className}`}
          >
            {statusChip.label}
          </div>
        )}
      </button>

      {quickActions.canShowActions ? (
        <div className="pointer-events-none absolute inset-x-1.5 bottom-1.5 z-20 hidden translate-y-1 items-center justify-center gap-1 opacity-0 transition-all duration-150 sm:flex sm:group-hover/slot:pointer-events-auto sm:group-hover/slot:translate-y-0 sm:group-hover/slot:opacity-100 sm:group-focus-within/slot:pointer-events-auto sm:group-focus-within/slot:translate-y-0 sm:group-focus-within/slot:opacity-100">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onAddCard()
            }}
            aria-label={`${quickActions.addAccessibleLabel} for ${pokemon.name}`}
            className="flex h-7 min-w-0 flex-1 items-center justify-center gap-1 rounded-full border border-emerald-300/45 bg-emerald-500/92 px-2 text-[10px] font-bold text-white shadow-[0_8px_18px_-12px_rgba(16,185,129,0.9)] backdrop-blur transition-colors hover:bg-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
          >
            <Check className="h-3 w-3 shrink-0" />
            <span className="truncate">{quickActions.addLabel}</span>
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onAddWanted()
            }}
            aria-label={`${quickActions.wantAccessibleLabel} for ${pokemon.name}`}
            className="flex h-7 min-w-0 flex-1 items-center justify-center gap-1 rounded-full border border-amber-300/45 bg-amber-500/92 px-2 text-[10px] font-bold text-white shadow-[0_8px_18px_-12px_rgba(245,158,11,0.9)] backdrop-blur transition-colors hover:bg-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
          >
            <Heart className="h-3 w-3 shrink-0 fill-current" />
            <span className="truncate">{quickActions.wantLabel}</span>
          </button>
        </div>
      ) : null}

      {!readOnly && isLongPressed && (
        <div className="absolute -top-10 left-1/2 z-30 hidden -translate-x-1/2 animate-scale-in sm:block">
          <div className="flex max-w-[min(22rem,calc(100vw-1rem))] items-center gap-1 rounded-full border border-border/50 bg-card/95 p-1 shadow-xl backdrop-blur-lg">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onAddCard()
              }}
              className="flex h-7 items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 text-xs font-medium text-emerald-600 transition-all hover:bg-emerald-500/20 dark:text-emerald-300"
            >
              <Check className="h-3 w-3" />
              {quickActions.addLabel}
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onAddWanted()
              }}
              className="flex h-7 items-center gap-1 rounded-full bg-amber-500/10 px-2.5 text-xs font-medium text-amber-600 transition-all hover:bg-amber-500/20 dark:text-amber-300"
            >
              <Heart className="h-3 w-3 fill-current" />
              {quickActions.wantLabel}
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onQuickCollect(); }}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                isCollected
                  ? "bg-destructive/10 text-destructive hover:bg-destructive/20"
                  : "bg-green-500/10 text-green-500 hover:bg-green-500/20"
              }`}
            >
              {isCollected ? <X className="w-3 h-3" /> : <Check className="w-3 h-3" />}
              {isCollected ? "Remove" : "Got it"}
            </button>
            {isCollected && hasAssignedCard && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                  status === 'finalized'
                    ? "bg-amber-500/10 text-amber-500 hover:bg-amber-500/20"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {status === 'finalized' ? (
                  <><Star className="w-3 h-3 fill-current" /> Perfect</>
                ) : (
                  <><Star className="w-3 h-3" /> Fav</>
                )}
              </button>
            )}
          </div>
          <div className="absolute left-1/2 -translate-x-1/2 -bottom-1.5 w-3 h-3 bg-card/95 border-r border-b border-border/50 rotate-45" />
        </div>
      )}
    </div>
  )
}
