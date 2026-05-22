"use client"

import { useState, useMemo, useEffect, useRef, useCallback, type CSSProperties } from "react"
import { createPortal } from "react-dom"
import { Moon, Sun, Settings, LogIn, LogOut, Grid3X3, Search as SearchIcon, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Users, Sparkles, Check, X, ChevronsLeft, ChevronsRight, Star, Camera, Loader2, SlidersHorizontal, WifiOff, BookOpen, Heart } from "lucide-react"
import PokemonSearch, { type PokemonSearchResultMeta } from "@/components/pokemon-search"
import SettingsModal from "@/components/settings-modal"
import AuthModal from "@/components/auth-modal"
import PartnerModal from "@/components/partner-modal"
import CardSelector, { type CardSelectorMode } from "@/components/card-selector"
import CardFinishShader from "@/components/card-finish-shader"
import { getCardPriceKey, useCardPrices, type CardPriceLookup, type CardPriceSnapshot, type SupportedCurrency } from "@/hooks/use-card-prices"
import { useCollection, type CardFinish, type CardLanguage, type SlotStatus, type WantedCard } from "@/hooks/use-collection"
import { useSettings, type BinderSettings } from "@/hooks/use-settings"
import { useTouchGestures } from "@/hooks/use-touch-gestures"
import { Button } from "@/components/ui/button"
import { scanBinderPageImage, type BinderPageScanResult } from "@/lib/binder-page-scan"
import { POKEMON_CATALOG, getPokemonSummary, type PokemonSummary } from "@/lib/pokemon-catalog"
import { getBinderColorPreset, type BinderColorId } from "@/lib/binder-colors"
import type { User } from "@supabase/supabase-js"

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

const TRADING_CARD_ASPECT_RATIO = 2.5 / 3.5
const TRADING_CARD_CORNER_RADIUS = "5%"
const TRADING_CARD_INNER_CORNER_RADIUS = "4.25%"
const BINDER_GRID_GAP_CARD_UNITS = 0.05
const BINDER_PAGE_PADDING_CARD_UNITS = 0.1
const GUIDED_SCAN_FRAME_COUNT = 16
const GUIDED_SCAN_FRAME_DELAY_MS = 800
const GUIDED_SCAN_SLOT_VOTE_RATIO = 0.6
const GUIDED_SCAN_MIN_USABLE_FRAMES = 2
const GUIDE_FRAME_INSET_X = 0.12
const GUIDE_FRAME_INSET_Y = 0.05
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

type PageScanSummary = {
  detectedOccupied: number
  newCollected: number
  alreadyCollected: number
  page: number
}

type BurstSlotAggregate = {
  occupiedVotes: number
  confidenceSum: number
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

function getDisplayArtwork(pokemon: PokemonSummary, cardImage?: string | null) {
  return cardImage || getPokemonArtwork(pokemon)
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
  const xOffset = hashSlotValue(seed, 1) * 0.14 - 0.07
  const yOffset = hashSlotValue(seed, 2) * 0.12 - 0.06
  const angleOffset = hashSlotValue(seed, 3) * 18 - 9
  const phase = hashSlotValue(seed, 4) * 3.6
  const patternSeed = seed * 0.017 + hashSlotValue(seed, 5) * 11

  return {
    x: clampGlareValue(baseGlint.x + xOffset, 0.04, 0.96),
    y: clampGlareValue(baseGlint.y + yOffset, 0.04, 0.96),
    angle: baseGlint.angle + angleOffset,
    phase,
    patternSeed,
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
}

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
    case "normal":
    default:
      return "card-finish-normal"
  }
}

function getCollectionItemPriceKey(item?: { card_id?: string | null; card_language?: string | null } | null) {
  return item?.card_id ? getCardPriceKey(item.card_id, item.card_language) : null
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

function sumPriceSnapshots(prices: Array<CardPriceSnapshot | undefined>) {
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

async function canvasToFile(canvas: HTMLCanvasElement, index: number) {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9))
  if (!blob) {
    throw new Error("Could not encode a camera frame.")
  }

  return new File([blob], `binder-burst-${index}.jpg`, { type: "image/jpeg" })
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

  return canvasToFile(guidedCanvas, index)
}

function aggregateBurstResults(
  results: Awaited<ReturnType<typeof scanBinderPageImage>>[],
  requiredVotes: number,
) {
  const slotCount = results[0]?.slots.length ?? 0
  const aggregates = Array.from({ length: slotCount }, (): BurstSlotAggregate => ({
    occupiedVotes: 0,
    confidenceSum: 0,
  }))

  for (const result of results) {
    result.slots.forEach((slot, index) => {
      if (slot.occupied) {
        aggregates[index].occupiedVotes += 1
      }
      aggregates[index].confidenceSum += slot.confidence
    })
  }

  return aggregates.map((aggregate) => ({
    occupied: aggregate.occupiedVotes >= requiredVotes,
    averageConfidence: results.length > 0 ? aggregate.confidenceSum / results.length : 0,
  }))
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
  const [selectedPokemon, setSelectedPokemon] = useState<PokemonSummary | null>(null)
  const [isDarkMode, setIsDarkMode] = useState(initialDarkMode)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isAuthOpen, setIsAuthOpen] = useState(false)
  const [isPartnerOpen, setIsPartnerOpen] = useState(false)
  const [isCardSelectorOpen, setIsCardSelectorOpen] = useState(false)
  const [cardSelectorMode, setCardSelectorMode] = useState<CardSelectorMode>("collect")
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [isPriceMode, setIsPriceMode] = useState(initialPriceMode)
  const [selectedGen, setSelectedGen] = useState(0)
  const [currentBinderPage, setCurrentBinderPage] = useState(1)
  const [pageInputValue, setPageInputValue] = useState("1")
  const [collectionViewFilter, setCollectionViewFilter] = useState<CollectionViewFilter>("all")
  const [isMobileNavExpanded, setIsMobileNavExpanded] = useState(false)
  const [isMobileFilterSheetOpen, setIsMobileFilterSheetOpen] = useState(false)
  const [longPressedPokemon, setLongPressedPokemon] = useState<{ id: number; name: string } | null>(null)
  const [isPageTransitioning, setIsPageTransitioning] = useState(false)
  const [transitionDirection, setTransitionDirection] = useState<"left" | "right" | null>(null)
  const [isScanningPage, setIsScanningPage] = useState(false)
  const [pageScanSummary, setPageScanSummary] = useState<PageScanSummary | null>(null)
  const [pageScanError, setPageScanError] = useState<string | null>(null)
  const [isBurstScannerOpen, setIsBurstScannerOpen] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [isCameraReady, setIsCameraReady] = useState(false)
  const [isCapturingBurst, setIsCapturingBurst] = useState(false)
  const [isApplyingScanResults, setIsApplyingScanResults] = useState(false)
  const [burstFramesProcessed, setBurstFramesProcessed] = useState(0)
  const [burstUsableFrames, setBurstUsableFrames] = useState(0)
  const [burstPreviewResult, setBurstPreviewResult] = useState<BinderPageScanResult | null>(null)
  const [isSyncingLocalCollection, setIsSyncingLocalCollection] = useState(false)
  const [localCollectionSyncMessage, setLocalCollectionSyncMessage] = useState<string | null>(null)
  const [sharePath, setSharePath] = useState<string | null>(shareViewToken ? `/share/${shareViewToken}` : null)
  const [isShareEnabled, setIsShareEnabled] = useState(Boolean(shareViewToken))
  const [isShareLoading, setIsShareLoading] = useState(false)
  const [shareMessage, setShareMessage] = useState<string | null>(null)
  const [isRefreshingPrices, setIsRefreshingPrices] = useState(false)
  const [priceRefreshMessage, setPriceRefreshMessage] = useState<string | null>(null)
  const [isOnline, setIsOnline] = useState(true)
  const [isInstalledApp, setIsInstalledApp] = useState(false)
  const [installPromptEvent, setInstallPromptEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [pwaStatusMessage, setPwaStatusMessage] = useState<string | null>(null)
  const [isDesktopViewport, setIsDesktopViewport] = useState(false)
  const [isCompactViewport, setIsCompactViewport] = useState(false)
  const [isWideBinderSpread, setIsWideBinderSpread] = useState(false)
  const [isMobileSpreadPreview, setIsMobileSpreadPreview] = useState(false)
  const [slotGlareState, setSlotGlareState] = useState(DEFAULT_SLOT_GLARE_STATE)
  const [motionGlintStatus, setMotionGlintStatus] = useState<MotionGlintStatus>("fallback")
  const [motionGlintMessage, setMotionGlintMessage] = useState<string | null>(null)
  const [motionSensorVersion, setMotionSensorVersion] = useState(0)
  const [quickPanelPosition, setQuickPanelPosition] = useState<QuickPanelPosition | null>(null)
  const pagePhotoInputRef = useRef<HTMLInputElement | null>(null)
  const burstVideoRef = useRef<HTMLVideoElement | null>(null)
  const burstCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const cameraStreamRef = useRef<MediaStream | null>(null)
  const hasHydratedPageFromQueryRef = useRef(false)
  const quickPanelRef = useRef<HTMLDivElement | null>(null)
  const slotButtonRefs = useRef(new Map<number, HTMLButtonElement>())
  const motionSensorsEnabledRef = useRef(false)

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
  } = useCollection({ initialUser, initialCollection, initialCollectionOwnerUserId, readOnly: readOnlyMode })
  const { settings, updateSettings } = useSettings({
    initialSettings,
    initialUser,
    settingsOwnerUserId: initialCollectionOwnerUserId,
    readOnly: readOnlyMode,
    hasRemoteSettings: initialHasStoredSettings,
  })

  const canEditBinder = !readOnlyMode
  const canFilterCollection = readOnlyMode || Boolean(user)
  const canInstallApp = Boolean(installPromptEvent)

  const slotsPerPage = settings.binderRows * settings.binderCols
  const binderPageAspectRatio = (
    settings.binderCols * TRADING_CARD_ASPECT_RATIO
    + Math.max(0, settings.binderCols - 1) * BINDER_GRID_GAP_CARD_UNITS
    + BINDER_PAGE_PADDING_CARD_UNITS * 2
  ) / (
    settings.binderRows
    + Math.max(0, settings.binderRows - 1) * BINDER_GRID_GAP_CARD_UNITS
    + BINDER_PAGE_PADDING_CARD_UNITS * 2
  )
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

    return isDarkMode ? binderColor.dark : binderColor.light
  }, [isDarkMode, settings.binderColorId, settings.binderPageColors])

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

  const handleRequestMotionGlint = useCallback(async () => {
    if (typeof window === "undefined") {
      setMotionGlintStatus("unsupported")
      setMotionGlintMessage("Motion glint is not available in this browser.")
      return
    }

    if (!settings.binderSlotGlareEnabled) {
      setMotionGlintStatus("disabled")
      setMotionGlintMessage("Turn on binder slot glare first.")
      return
    }

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
  }, [settings.binderSlotGlareEnabled])

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }

    setSlotGlareState(DEFAULT_SLOT_GLARE_STATE)

    if (!settings.binderSlotGlareEnabled) {
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
      const beta = Math.max(-45, Math.min(45, event.beta))

      queueState(getSlotGlareState(
        gamma * 0.95 - 24,
        beta * 0.38 - 18,
        gamma * 1.45 - 26,
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

    const canUseFallbackInput = () => Date.now() - lastSensorUpdateAt >= 250

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
  }, [motionSensorVersion, settings.binderSlotGlareEnabled])

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
    [selectedTrackedCardItem?.card_id, selectedTrackedCardItem?.card_language],
  )
  const priceLookupCards = useMemo(
    () => {
      const byKey = new Map<string, CardPriceLookup>()

      for (const lookup of trackedPriceLookups) {
        byKey.set(getCardPriceKey(lookup.cardId, lookup.language), lookup)
      }

      for (const lookup of wantedPriceLookups) {
        byKey.set(getCardPriceKey(lookup.cardId, lookup.language), lookup)
      }

      if (selectedTrackedPriceLookup) {
        byKey.set(getCardPriceKey(selectedTrackedPriceLookup.cardId, selectedTrackedPriceLookup.language), selectedTrackedPriceLookup)
      }

      return [...byKey.values()]
    },
    [selectedTrackedPriceLookup, trackedPriceLookups, wantedPriceLookups],
  )
  const hasTrackedCards = trackedPriceLookups.length > 0 || wantedPriceLookups.length > 0
  const shouldLoadCardPrices = isPriceMode || collectionViewFilter === "wanted" || Boolean(selectedTrackedPriceLookup)
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
    ? binderPageAspectRatio * 2 + 0.12
    : binderPageAspectRatio

  const navigateToPage = useCallback((page: number, direction: "left" | "right") => {
    if (page < 1 || page > totalBinderPages || page === currentBinderPage) return

    setTransitionDirection(direction)
    setIsPageTransitioning(true)

    setTimeout(() => {
      setCurrentBinderPage(page)
      setTimeout(() => {
        setIsPageTransitioning(false)
        setTransitionDirection(null)
      }, 50)
    }, 150)
  }, [currentBinderPage, totalBinderPages])

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
    })
  }, [currentBinderPage, readOnlyMode, settings.binderPageColors, updateSettings])

  const handleSetBinderColorForPageRange = useCallback((binderColorId: BinderColorId, endPage: number) => {
    if (readOnlyMode) return

    const safeEndPage = Math.min(Math.max(endPage, 1), totalBinderPages)
    const nextPageColors = { ...settings.binderPageColors }

    for (let page = 1; page <= safeEndPage; page += 1) {
      nextPageColors[String(page)] = binderColorId
    }

    updateSettings({ binderPageColors: nextPageColors })
  }, [readOnlyMode, settings.binderPageColors, totalBinderPages, updateSettings])

  const handleClearCurrentPageBinderColor = useCallback(() => {
    if (readOnlyMode) return
    const nextPageColors = { ...settings.binderPageColors }
    delete nextPageColors[String(currentBinderPage)]
    updateSettings({ binderPageColors: nextPageColors })
  }, [currentBinderPage, readOnlyMode, settings.binderPageColors, updateSettings])

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

  const handleCardSelected = async (card: any | null, selectedMode: CardSelectorMode = cardSelectorMode, finish: CardFinish = "normal") => {
    if (!selectedPokemon) return
    if (readOnlyMode) return
    setCardSelectorMode(selectedMode)
    if (selectedMode === "wishlist") {
      if (!card) {
        const firstWantedCardId = collectionItem?.wanted_cards?.[0]?.card_id
        if (firstWantedCardId) {
          await removeWantedCard(selectedPokemon.id, firstWantedCardId)
        }
      } else {
        await addWantedCard(
          selectedPokemon.id,
          selectedPokemon.name,
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
        selectedPokemon.id,
        selectedPokemon.name,
        card?.id,
        card?.name,
        card?.image,
        card?.set?.name,
        card?.language ?? "en",
        "collected",
        {
          cardFinish: finish,
          wantedCards: collectionItem?.wanted_cards ?? [],
        },
      )
    }
    setIsCardSelectorOpen(false)
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

  const handlePokemonSelect = (pokemon: PokemonSummary) => {
    setSelectedPokemon(pokemon)
    const idx = pokemonList.findIndex(p => p.id === pokemon.id)
    if (idx !== -1) {
      const targetPage = Math.ceil((idx + 1) / slotsPerPage)
      setCurrentBinderPage(targetPage)
    }
  }

  const getSearchResultMeta = useCallback((pokemon: { id: number; name: string }): PokemonSearchResultMeta => {
    const summary = getPokemonSummary(pokemon.id)
    const item = getCollectionItem(pokemon.id)
    const image = summary ? getDisplayArtwork(summary, item?.card_image) : item?.card_image || null
    const fitClass = item?.card_image ? getDisplayArtworkFit(item.card_image) : "object-contain"
    const toneClass = item?.status ? getDisplayArtworkTone(item.status) : ""
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
      previewImage: image,
      previewFitClass: fitClass,
      previewToneClass: toneClass,
      stateLabel,
      stateToneClass,
      cardLabel: item?.card_name
        ? item.status === "wishlisted"
          ? `Wanted: ${item.card_name}`
          : item.card_name
        : null,
      locationLabel: page && slotLabel ? `Page ${page} • ${slotLabel}` : null,
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
      setIsBurstScannerOpen(true)
      return
    }

    pagePhotoInputRef.current?.click()
  }

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
      const mappedOccupiedPokemon = result.slots
        .filter((slot) => slot.occupied)
        .map((slot) => currentPageSlots[slot.index])
        .filter((pokemon): pokemon is { id: number; name: string } => Boolean(pokemon))

      let alreadyCollected = 0
      const pokemonToCollect = mappedOccupiedPokemon
        .filter((pokemon) => {
          if (isCollected(pokemon.id)) {
            alreadyCollected += 1
            return false
          }

          return true
        })

      const collectResults = await Promise.all(
        pokemonToCollect.map((pokemon) => addToCollection(pokemon.id, pokemon.name))
      )
      const newCollected = collectResults.filter((result) => !result?.error).length

      setPageScanSummary({
        detectedOccupied: mappedOccupiedPokemon.length,
        newCollected,
        alreadyCollected,
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
          setBurstPreviewResult(detectedResult)
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
      const aggregatedSlots = aggregateBurstResults(successfulResults, requiredVotes)
      const mappedOccupiedPokemon = aggregatedSlots
        .map((slot, index) => (slot.occupied ? currentPageSlots[index] : null))
        .filter((pokemon): pokemon is { id: number; name: string } => Boolean(pokemon))

      closeBurstScanner()

      let alreadyCollected = 0
      const pokemonToCollect = mappedOccupiedPokemon.filter((pokemon) => {
        if (isCollected(pokemon.id)) {
          alreadyCollected += 1
          return false
        }

        return true
      })

      const collectResults = await Promise.all(
        pokemonToCollect.map((pokemon) => addToCollection(pokemon.id, pokemon.name))
      )
      const newCollected = collectResults.filter((result) => !result?.error).length

      setPageScanSummary({
        detectedOccupied: mappedOccupiedPokemon.length,
        newCollected,
        alreadyCollected,
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

    if ("serviceWorker" in window.navigator) {
      window.navigator.serviceWorker.register("/sw.js").catch((error) => {
        console.error("[binderdex] Failed to register service worker:", error)
      })
    }

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
    setIsShareLoading(true)
    setShareMessage(null)

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
  }, [])

  const handleDisableReadOnlyShare = useCallback(async () => {
    setIsShareLoading(true)
    setShareMessage(null)

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
  }, [sharePath])

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
  const selectedPokemonDisplayImage = selectedPokemon ? getDisplayArtwork(selectedPokemon, collectionItem?.card_image) : null
  const selectedPokemonDisplayFit = getDisplayArtworkFit(collectionItem?.card_image)
  const selectedPokemonDisplayTone = getDisplayArtworkTone(collectionItem?.status)
  const selectedCardPriceKey = getCollectionItemPriceKey(collectionItem)
  const selectedCardPriceLabel = selectedCardPriceKey ? formatPriceLabel(pricesByCardId[selectedCardPriceKey]) : null
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
    const edgePadding = 16
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
    selectedPokemonHasAssignedCard,
    selectedPokemonIsFavorite,
    updateQuickPanelPosition,
    wishlisted,
  ])

  const renderSelectedPokemonQuickPanel = () => {
    if (!selectedPokemon || isSearchOpen || typeof document === "undefined") {
      return null
    }

    const selectedStatusPill =
      wishlisted
        ? { label: "Wanted", className: "border-amber-500/25 bg-amber-500/10 text-amber-400" }
        : selectedPokemonIsFavorite
          ? { label: "Perfect", className: "border-amber-500/25 bg-amber-500/10 text-amber-400" }
          : collected
            ? { label: "Owned", className: "border-emerald-500/25 bg-emerald-500/10 text-emerald-400" }
            : { label: "Open Slot", className: "border-border/60 bg-background/35 text-muted-foreground" }

    const selectedCardLabel = wishlisted && collectionItem?.card_name
      ? `Wishlisted: ${collectionItem.card_name}`
      : collectionItem?.card_name
        ? collectionItem.card_name
        : collected
          ? "No card assigned yet"
          : "Choose how you want to track this slot."
    const selectedCardSummaryLabel =
      wishlisted && collectionItem?.card_name
        ? `Wanted card: ${collectionItem.card_name}`
        : collectionItem?.card_name
          ? collectionItem.card_name.toLowerCase() === selectedPokemon.name.toLowerCase()
            ? selectedPokemonHasAssignedCard
              ? "Assigned card selected"
              : "Tracked card selected"
            : collectionItem.card_name
          : collected
            ? "No card assigned yet"
            : "Choose how you want to track this slot."
    const selectedDetailChips = [
      collectionItem?.card_set ? { key: "set", label: collectionItem.card_set } : null,
      collectionItem?.card_id ? { key: "language", label: formatCardLanguageLabel(collectionItem.card_language) } : null,
      collectionItem?.card_id ? { key: "finish", label: formatCardFinishLabel(collectionItem.card_finish) } : null,
      collectionItem?.wanted_cards?.length ? { key: "wanted", label: `${collectionItem.wanted_cards.length} wanted` } : null,
      selectedCardPriceLabel ? { key: "price", label: isLoadingPrices ? "Loading price..." : selectedCardPriceLabel } : null,
      !selectedCardPriceLabel && isLoadingPrices && collectionItem?.card_id ? { key: "price-loading", label: "Loading price..." } : null,
      selectedCollectedDateLabel ? { key: "collected", label: `Collected ${selectedCollectedDateLabel}` } : null,
    ].filter((value): value is { key: string; label: string } => Boolean(value))

    const panelHelperText = readOnlyMode
      ? "This shared binder is read-only. You can browse, search, filter, and view prices, but only the owner can change collection state."
      : collected
        ? "Add or edit the card for this slot, or clear it if you no longer have one."
        : "Add card picks a specific printing, Mark owned leaves it cardless, and Wanted card tracks a target without counting it owned."

    const quickPanel = (
      <div
        ref={quickPanelRef}
        className="fixed z-30 w-[min(calc(100vw-1.5rem),28rem)] transition-[top,left,transform] duration-200 ease-out sm:w-[min(calc(100vw-2rem),24rem)]"
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
                bottom: "calc(env(safe-area-inset-bottom) + 4.75rem)",
                transform: "translateX(-50%)",
                width: "min(calc(100vw - 1.5rem), 24rem)",
              }}
      >
        <div className="rounded-[1.35rem] border border-border/70 bg-card/96 p-3 text-foreground shadow-[0_28px_70px_-34px_rgba(15,23,42,0.28)] backdrop-blur-xl sm:rounded-[1.6rem] dark:bg-[linear-gradient(180deg,rgba(20,24,32,0.97)_0%,rgba(15,19,26,0.98)_100%)] dark:shadow-[0_28px_70px_-34px_rgba(0,0,0,0.55)]">
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-3">
              <div className="relative mt-0.5 flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border/60 bg-background/45 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] dark:border-white/10 dark:bg-white/[0.04] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                <img
                  src={selectedPokemonDisplayImage || getPokemonArtwork(selectedPokemon)}
                  alt={selectedPokemon.name}
                  className={`absolute inset-1 max-w-[calc(100%-0.5rem)] max-h-[calc(100%-0.5rem)] m-auto ${selectedPokemonDisplayFit} ${selectedPokemonDisplayTone}`}
                />
                {collected && (
                  <div className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 rounded-full flex items-center justify-center shadow">
                    <Check className="w-2.5 h-2.5 text-white" />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold tracking-[0.16em] text-muted-foreground">#{String(selectedPokemon.id).padStart(4, "0")}</p>
                    <h3 className="truncate text-[1.05rem] font-bold capitalize leading-tight tracking-tight">{selectedPokemon.name}</h3>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 rounded-xl text-muted-foreground hover:bg-background/60 hover:text-foreground dark:hover:bg-white/[0.04]"
                    onClick={() => setSelectedPokemon(null)}
                  >
                    <X className="w-4 h-4" />
                  </Button>
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
                  wishlisted && collectionItem?.card_name
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
            <div className="flex flex-col gap-2.5">
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
                      <Button
                        onClick={handleOpenCardSelector}
                        disabled={isCollectionLoading}
                        variant="default"
                        size="sm"
                        className="h-10 w-full rounded-xl gap-1.5 px-3 text-sm shadow-[0_12px_24px_-18px_rgba(96,165,250,0.9)]"
                      >
                        <Check className="w-3.5 h-3.5" />
                        {selectedPokemonHasAssignedCard ? "Edit card" : "Add card"}
                      </Button>
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          onClick={handleOpenCardSelector}
                          disabled={isCollectionLoading}
                          variant="secondary"
                          size="sm"
                          className="h-11 rounded-xl gap-1.5 px-3 text-xs shadow-[0_12px_24px_-18px_rgba(52,211,153,0.8)]"
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
    )

    return createPortal(quickPanel, document.body)
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
          className="absolute inset-0 p-3 sm:p-4"
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
          className="absolute inset-0 p-3 sm:p-4"
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
                cardImage={item?.card_image}
                cardName={item?.card_name}
                cardFinish={item?.card_finish}
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
                onLongPress={() => {
                  if (pageNumber !== currentBinderPage) {
                    setCurrentBinderPage(pageNumber)
                  }
                  handleLongPress(pokemon)
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

  return (
    <main className="flex h-[100dvh] max-h-[100dvh] flex-col overflow-hidden bg-background select-none">
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
            <span className="text-[11px] text-amber-500/80 dark:text-amber-200/75">Using cached data where available</span>
          </div>
        </div>
      )}

      {/* Glass Navigation */}
      <nav className="sticky top-0 z-40 mb-2 shrink-0 px-2.5 pt-[max(env(safe-area-inset-top),0.45rem)] sm:px-4 sm:pt-[calc(env(safe-area-inset-top)+0.6rem)]">
        <div className="mx-auto max-w-7xl">
          <div className="rounded-2xl border border-border/70 bg-card/96 shadow-[0_18px_50px_-26px_rgba(15,23,42,0.24)] md:bg-card/86 md:backdrop-blur-xl dark:border-border/50 dark:bg-background dark:shadow-black/5 dark:md:bg-background/88">
          <div className="flex items-center justify-between gap-2 px-3 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-secondary shadow-lg shadow-primary/20">
                <Sparkles className="h-3.5 w-3.5 text-primary-foreground" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold tracking-tight">BinderDex</p>
                <p className="hidden sm:block text-[10px] text-muted-foreground">National Dex binder tracking</p>
              </div>
            </div>

            <div className="flex items-center gap-1">
              {canFilterCollection && (
                <div className="hidden md:flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2 py-1">
                  <span className="text-xs font-bold text-primary tabular-nums">{collectionCount}</span>
                  <span className="text-[10px] text-primary/70">collected</span>
                </div>
              )}

              {!isOnline && (
                <div className="hidden md:flex items-center gap-1 rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-500">
                  Offline
                </div>
              )}

              {installPromptEvent && !isInstalledApp && (
                <Button variant="ghost" size="sm" onClick={handleInstallApp} className="hidden h-7 gap-1 rounded-full px-2 md:flex">
                  <span className="text-[11px] font-medium">Install</span>
                </Button>
              )}

              {readOnlyMode ? (
                <div className="hidden md:flex items-center gap-1 rounded-full border border-border/50 bg-card/72 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground dark:border-border/30 dark:bg-muted/35">
                  Shared View
                </div>
              ) : user ? (
                <>
                  <Button variant="ghost" size="sm" onClick={() => setIsPartnerOpen(true)} className="h-7 gap-1 rounded-full px-2">
                    <Users className="h-3.5 w-3.5" />
                    <span className="hidden md:inline text-[11px]">Partner</span>
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full" onClick={signOut}>
                    <LogOut className="h-3.5 w-3.5" />
                  </Button>
                </>
              ) : (
                <Button size="sm" onClick={() => setIsAuthOpen(true)} className="h-7 gap-1 rounded-full px-2.5">
                  <LogIn className="h-3.5 w-3.5" />
                  <span className="hidden md:inline text-[11px]">Sign In</span>
                </Button>
              )}

              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-full md:hidden"
                onClick={() => setIsMobileNavExpanded((current) => !current)}
                aria-label={isMobileNavExpanded ? "Collapse controls" : "Expand controls"}
              >
                {isMobileNavExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </Button>

              <div className="mx-0.5 hidden h-4 w-px bg-border/50 md:block" />

              <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full" onClick={() => setIsSettingsOpen(true)}>
                <Settings className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full" onClick={toggleDarkMode}>
                {isDarkMode ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>

          <div className="hidden border-t border-border/40 px-2 py-1.5 md:block">
	            <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide whitespace-nowrap">
	              <div className="flex shrink-0 rounded-xl border border-border/50 bg-card/70 p-0.5 dark:border-border/30 dark:bg-muted/40">
                <button
                  onClick={() => setIsSearchOpen(true)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
                    isSearchOpen ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <SearchIcon className="h-3 w-3" />
                  <span>Search</span>
                </button>
                <button
                  onClick={() => setIsSearchOpen(false)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
                    !isSearchOpen ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Grid3X3 className="h-3 w-3" />
                  <span>Binder</span>
	                </button>
	              </div>

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

	              <div className="flex shrink-0 items-center rounded-xl border border-border/50 bg-card/72 px-1 dark:border-border/30 dark:bg-muted/35">
                <Button variant="ghost" size="icon" className="h-6 w-6 rounded-lg" onClick={() => setSelectedGen(prev => prev > 0 ? prev - 1 : GENERATIONS.length - 1)}>
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <select
                  value={selectedGen}
                  onChange={(e) => setSelectedGen(Number(e.target.value))}
                  className="h-6 min-w-[96px] bg-transparent px-1 text-[11px] font-medium cursor-pointer focus:outline-none"
                >
                  {GENERATIONS.map((gen) => (
                    <option key={gen.id} value={gen.id}>
                      {gen.id === 0 ? "All" : `Gen ${gen.id}`}{gen.region ? ` ${gen.region}` : ""}
                    </option>
                  ))}
                </select>
                <Button variant="ghost" size="icon" className="h-6 w-6 rounded-lg" onClick={() => setSelectedGen(prev => prev < GENERATIONS.length - 1 ? prev + 1 : 0)}>
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>

              {canFilterCollection && (
                <>
                  <div className="flex shrink-0 items-center gap-1 rounded-xl border border-border/50 bg-card/72 p-0.5 dark:border-border/30 dark:bg-muted/35">
                    {COLLECTION_VIEW_FILTERS.map((filterOption) => {
                      const isActive = collectionViewFilter === filterOption.id

                      return (
                        <button
                          key={filterOption.id}
                          onClick={() => setCollectionViewFilter(filterOption.id)}
                          className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition-all ${
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

                  {hasTrackedCards && (
                    <button
                      onClick={() => setIsPriceMode((current) => !current)}
                      className={`flex shrink-0 items-center gap-1 rounded-xl border px-2.5 py-1 text-[11px] font-medium transition-all ${
                        isPriceMode
                          ? "bg-primary/12 border-primary/30 text-primary"
                          : "bg-card/72 border-border/50 text-muted-foreground hover:text-foreground dark:bg-muted/35 dark:border-border/30"
                      }`}
                    >
                      {isLoadingPrices && isPriceMode ? <Loader2 className="h-3 w-3 animate-spin" /> : <span className="text-[12px] font-bold">$</span>}
                      <span>Prices</span>
                    </button>
                  )}

                  <div className="flex shrink-0 items-center gap-1.5 rounded-xl border border-border/50 bg-card/72 px-2.5 py-1 text-[10px] font-medium text-muted-foreground tabular-nums dark:border-border/30 dark:bg-muted/35">
                    <span>{collectionStats.percentage}%</span>
                    <span className="text-border/80">•</span>
                    <span>{collectionStats.collected}/{collectionStats.total}</span>
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
            </div>
          </div>
          </div>
        </div>
      </nav>

      <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col overflow-hidden px-3 pb-[calc(env(safe-area-inset-bottom)+6.75rem)] sm:px-4 md:pb-4">
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
          <div className="fixed inset-0 z-50 bg-black">
            <div className="mx-auto flex h-full w-full max-w-md flex-col px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-[calc(env(safe-area-inset-top)+0.75rem)]">
              <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[2rem] border border-white/10 bg-black shadow-2xl">
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-white">
                <div>
                  <p className="text-sm font-semibold">Burst Scan</p>
                  <p className="text-xs text-white/65">Capture several frames and keep only stable occupied slots.</p>
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={closeBurstScanner} disabled={isCapturingBurst}>
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="relative min-h-0 flex-1 bg-black">
                <video
                  ref={burstVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className={`h-full w-full object-cover transition-opacity ${
                    burstPreviewResult ? "opacity-25" : "opacity-100"
                  }`}
                />
                {burstPreviewResult?.previewDataUrl ? (
                  <div className="absolute inset-0">
                    <div
                      className="relative h-full w-full overflow-hidden bg-black"
                      style={{ aspectRatio: `${burstPreviewResult.width} / ${burstPreviewResult.height}` }}
                    >
                      <img
                        src={burstPreviewResult.previewDataUrl}
                        alt="Last detected binder page"
                        className="absolute inset-0 h-full w-full object-contain"
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
                {cameraError ? (
                  <p className="text-sm text-destructive">{cameraError}</p>
                ) : (
                  <p className="text-sm text-white/70">
                    Line up one binder page inside the frame. The scanner samples for about {Math.round((GUIDED_SCAN_FRAME_COUNT * GUIDED_SCAN_FRAME_DELAY_MS) / 1000)} seconds and keeps the last successful slot detection visible.
                  </p>
                )}

                {isCapturingBurst || isApplyingScanResults ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-[11px] text-white/65">
                      <span>{isCapturingBurst ? `Scanning ${burstFramesProcessed}/${GUIDED_SCAN_FRAME_COUNT}` : "Applying results"}</span>
                      <span>{burstUsableFrames} usable frame{burstUsableFrames === 1 ? "" : "s"}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-white transition-all"
                        style={{ width: `${isCapturingBurst ? (burstFramesProcessed / GUIDED_SCAN_FRAME_COUNT) * 100 : 100}%` }}
                      />
                    </div>
                  </div>
                ) : null}

                <div className="flex items-center justify-end gap-2">
                  <Button variant="ghost" onClick={closeBurstScanner} disabled={isCapturingBurst || isApplyingScanResults}>
                    Cancel
                  </Button>
                  <Button onClick={handleBurstCapture} disabled={!isCameraReady || isCapturingBurst || isApplyingScanResults}>
                    {isCapturingBurst || isApplyingScanResults ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Camera className="mr-2 h-4 w-4" />}
                    {isCapturingBurst ? "Scanning Page" : isApplyingScanResults ? "Applying Results" : "Start Guided Scan"}
                  </Button>
                </div>
              </div>
            </div>
            </div>
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col space-y-3 animate-fade-in">
            {/* Page Navigation - Compact */}
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigateToPage(1, "right")} disabled={currentBinderPage === 1}>
                  <ChevronsLeft className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={isSpreadLayout ? goToPrevSpread : goToPrevPage} disabled={!canGoToPreviousVisiblePage}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
              </div>

              <div className="flex items-center gap-2">
                {isSpreadLayout && (
                  <span className="hidden rounded-full border border-border/50 bg-card/70 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground lg:inline-flex">
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
                  className="w-12 h-7 bg-muted/40 border border-border/30 rounded-lg text-xs text-center font-semibold tabular-nums"
                />
                <span className="text-xs text-muted-foreground">of {totalBinderPages}</span>
              </div>

              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="mr-1 h-8 gap-1.5 px-2.5"
                  onClick={handleJumpToPreviousNeeded}
                  disabled={activeJumpPokemonList.length === 0}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{activeJumpLabel}</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="mr-1 h-8 gap-1.5 px-2.5"
                  onClick={handleJumpToNextNeeded}
                  disabled={activeJumpPokemonList.length === 0}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Next {activeJumpLabel}</span>
                  <span className="sm:hidden">Next</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="mr-1 gap-1.5 h-8 px-2.5"
                  onClick={handlePhotoButtonClick}
                  disabled={isScanningPage || isFilteredBinderLayout || currentPagePokemon.length === 0}
                >
                  {isScanningPage ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
                  <span className="hidden sm:inline">{isScanningPage ? "Scanning" : "Scan Page"}</span>
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={isSpreadLayout ? goToNextSpread : goToNextPage} disabled={!canGoToNextVisiblePage}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigateToPage(totalBinderPages, "left")} disabled={currentBinderPage === totalBinderPages}>
                  <ChevronsRight className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {(pageScanSummary || pageScanError || isFilteredBinderLayout) && (
              <div className="rounded-xl border border-border/60 bg-card/82 px-3 py-2 text-xs text-muted-foreground dark:border-border/50 dark:bg-card/70">
                {pageScanError ? (
                  <p>{pageScanError}</p>
                ) : pageScanSummary ? (
                  <p>
                    Page {pageScanSummary.page}: detected {pageScanSummary.detectedOccupied} occupied slot{pageScanSummary.detectedOccupied === 1 ? "" : "s"}, added {pageScanSummary.newCollected} new card{pageScanSummary.newCollected === 1 ? "" : "s"}
                    {pageScanSummary.alreadyCollected > 0 ? `, ${pageScanSummary.alreadyCollected} already collected` : ""}.
                  </p>
                ) : (
                  <p>Scanning is disabled while a card-status filter is on, because those pages no longer match your binder layout.</p>
                )}
                <p className="mt-1 text-[11px] text-muted-foreground/80">
                  The scanner checks slot occupancy from the page photo. Fill the frame with one page and keep the pockets sharp.
                </p>
              </div>
            )}

            {collectionViewFilter === "wanted" && (
              <div className="shrink-0 overflow-x-auto rounded-xl border border-amber-400/25 bg-amber-400/8 p-2 scrollbar-hide">
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
                        className="flex w-56 shrink-0 items-center gap-2 rounded-lg border border-amber-400/20 bg-card/82 p-2 text-left"
                      >
                        {card.card_image ? (
                          <img src={card.card_image} alt={card.card_name} className="h-14 w-10 rounded object-cover" loading="lazy" />
                        ) : (
                          <div className="h-14 w-10 rounded bg-muted" />
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
            )}

            {/* Binder Grid */}
            <div className="md:min-h-0 md:flex-1 md:flex md:items-center md:justify-center">
              <div
                ref={binderRef}
                className={`relative w-full max-w-full transition-all duration-150 md:h-full md:w-auto md:max-h-full ${
                  isPageTransitioning
                    ? transitionDirection === "left"
                      ? "opacity-0 -translate-x-4"
                      : "opacity-0 translate-x-4"
                    : "opacity-100 translate-x-0"
                }`}
                style={{
                  aspectRatio: String(displayedBinderAspectRatio),
                  overscrollBehaviorX: "contain",
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

            <div className="shrink-0 px-0.5">
              <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 rounded-[1.35rem] border border-border/60 bg-card/88 p-1.5 shadow-[0_18px_42px_-32px_rgba(15,23,42,0.45)] backdrop-blur-xl dark:border-white/10 dark:bg-card/72">
                <Button
                  variant="ghost"
                  className="h-14 min-w-0 justify-start gap-2 rounded-[1rem] px-3 text-sm font-semibold sm:px-4"
                  onClick={isSpreadLayout ? goToPrevSpread : goToPrevPage}
                  disabled={!canGoToPreviousVisiblePage}
                  aria-label={isSpreadLayout ? "Previous binder spread" : "Previous binder page"}
                >
                  <ChevronLeft className="h-6 w-6 shrink-0" />
                  <span className="truncate">{isSpreadLayout ? "Previous spread" : "Previous page"}</span>
                </Button>

                <div className="flex min-w-[4.5rem] flex-col items-center justify-center px-1 text-center">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Page</span>
                  <span className="text-sm font-bold tabular-nums text-foreground">{currentBinderPage}/{totalBinderPages}</span>
                </div>

                <Button
                  variant="ghost"
                  className="h-14 min-w-0 justify-end gap-2 rounded-[1rem] px-3 text-sm font-semibold sm:px-4"
                  onClick={isSpreadLayout ? goToNextSpread : goToNextPage}
                  disabled={!canGoToNextVisiblePage}
                  aria-label={isSpreadLayout ? "Next binder spread" : "Next binder page"}
                >
                  <span className="truncate">{isSpreadLayout ? "Next spread" : "Next page"}</span>
                  <ChevronRight className="h-6 w-6 shrink-0" />
                </Button>
              </div>
            </div>

            {/* Page Info Footer */}
            <div className="flex shrink-0 flex-col items-center justify-center gap-1 text-[10px] text-muted-foreground/70">
              {isPriceMode && hasTrackedCards && (
                <p className="text-center text-[10px] font-medium text-primary/85">
                  {visiblePageLabel} {visiblePageTotalLabel || "No page prices"}
                  {filteredTotalLabel ? ` · Filter total ${filteredTotalLabel}` : ""}
                  {visiblePagePriceSummary.unpricedCount > 0 ? ` · ${visiblePagePriceSummary.unpricedCount} unpriced in view` : ""}
                </p>
              )}
              <p className="hidden text-center sm:block">
                {readOnlyMode
                  ? "Tap a Pokemon to open its details. This shared binder is read-only, but filters and prices still work."
                  : isSpreadLayout
                  ? "Tap a Pokemon to open its details. Wide layouts show facing pages; the highlighted page is the active one for scanning and page jumps."
                  : "Tap a Pokemon to open its details. Collect, wishlist, edit, and remove cards from the action panel."}
              </p>
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
        </div>
      </div>

      {renderSelectedPokemonQuickPanel()}

      {isSearchOpen && (
        <div className="fixed inset-0 z-40 bg-black/65 backdrop-blur-sm" onClick={() => setIsSearchOpen(false)}>
          <div className="mx-auto flex h-full w-full max-w-2xl flex-col px-3 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-[calc(env(safe-area-inset-top)+0.75rem)] sm:px-4" onClick={(event) => event.stopPropagation()}>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[1.75rem] border border-border/65 bg-card/96 shadow-[0_30px_80px_-36px_rgba(15,23,42,0.35)] dark:border-border/50 dark:bg-background/96 dark:shadow-2xl">
              <div className="flex items-center justify-between border-b border-border/40 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold">Search Pokemon</p>
                  <p className="text-xs text-muted-foreground">Find a mon and jump straight to its binder slot.</p>
                </div>
                <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full" onClick={() => setIsSearchOpen(false)}>
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
                />
                {selectedPokemon && (
                  <div className="mt-4 rounded-2xl border border-border/60 bg-card p-4 shadow-sm dark:border-border/50">
                    <div className="flex items-center gap-3">
                      <div className="relative flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-muted to-muted/30">
                        <img
                          src={selectedPokemonDisplayImage || getPokemonArtwork(selectedPokemon)}
                          alt={selectedPokemon.name}
                          className={`absolute inset-2 max-w-[calc(100%-1rem)] max-h-[calc(100%-1rem)] m-auto ${selectedPokemonDisplayFit} ${selectedPokemonDisplayTone}`}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-muted-foreground">#{String(selectedPokemon.id).padStart(4, "0")}</p>
                        <h2 className="truncate text-lg font-bold capitalize">{selectedPokemon.name}</h2>
                        {wishlisted && collectionItem?.card_name ? (
                          <p className="truncate text-xs text-amber-500">Wishlisted: {collectionItem.card_name}</p>
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
        <div className="fixed inset-0 z-40 bg-black/45 backdrop-blur-sm md:hidden" onClick={() => setIsMobileNavExpanded(false)}>
          <div
            className="absolute inset-x-0 bottom-0 overflow-y-auto overscroll-contain rounded-t-[1.75rem] border-t border-border/65 bg-card/96 px-4 pb-[calc(env(safe-area-inset-bottom)+5.5rem)] pt-3 shadow-[0_-24px_64px_-32px_rgba(15,23,42,0.35)] dark:border-border/50 dark:bg-background/96 dark:shadow-2xl"
            onClick={(event) => event.stopPropagation()}
            style={{
              maxHeight: "calc(100dvh - env(safe-area-inset-top) - 0.75rem)",
              WebkitOverflowScrolling: "touch",
              touchAction: "pan-y",
            }}
          >
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
                onClick={() => setIsMobileNavExpanded(false)}
              >
                <X className="h-4 w-4" />
              </Button>
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
        <div className="fixed inset-0 z-40 bg-black/55 backdrop-blur-sm md:hidden" onClick={() => setIsMobileFilterSheetOpen(false)}>
          <div
            className="absolute inset-x-0 bottom-0 overflow-y-auto overscroll-contain rounded-t-[1.75rem] border-t border-border/65 bg-card/96 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-4 shadow-[0_-24px_64px_-32px_rgba(15,23,42,0.35)] dark:border-border/50 dark:bg-background/96 dark:shadow-2xl"
            onClick={(event) => event.stopPropagation()}
            style={{
              maxHeight: "calc(100dvh - env(safe-area-inset-top) - 0.75rem)",
              WebkitOverflowScrolling: "touch",
              touchAction: "pan-y",
            }}
          >
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
                onClick={() => setIsMobileFilterSheetOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
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

      <div className="fixed inset-x-0 bottom-0 z-30 px-3 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] md:hidden">
        <div className="mx-auto flex max-w-7xl items-center gap-2 rounded-2xl border border-border/70 bg-card/96 p-2 shadow-[0_20px_60px_-30px_rgba(15,23,42,0.28)] dark:border-border/50 dark:bg-background dark:shadow-black/10">
          <div className="flex flex-1 items-center rounded-xl border border-border/50 bg-card/72 p-0.5 dark:border-border/40 dark:bg-muted/40">
            <button
              onClick={() => setIsSearchOpen(true)}
              className={`flex min-w-0 flex-1 items-center justify-center gap-1 rounded-[10px] px-2 py-2 text-[11px] font-medium transition-all ${
                isSearchOpen ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
              }`}
            >
              <SearchIcon className="h-3.5 w-3.5" />
              <span>Search</span>
            </button>
            <button
              onClick={() => setIsSearchOpen(false)}
              className={`flex min-w-0 flex-1 items-center justify-center gap-1 rounded-[10px] px-2 py-2 text-[11px] font-medium transition-all ${
                !isSearchOpen ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
              }`}
            >
              <Grid3X3 className="h-3.5 w-3.5" />
              <span>Binder</span>
            </button>
          </div>

	          {!isSearchOpen && (
	            <>
              {hasTrackedCards && (
                <Button
                  variant={isPriceMode ? "default" : "outline"}
                  size="sm"
                  className="h-10 shrink-0 rounded-xl px-3 text-[11px]"
                  onClick={() => setIsPriceMode((current) => !current)}
                >
                  {isLoadingPrices && isPriceMode ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <span className="text-[13px] font-bold">$</span>}
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="h-10 shrink-0 rounded-xl px-3"
                onClick={handleJumpToNextNeeded}
                disabled={activeJumpPokemonList.length === 0}
              >
                <Sparkles className="h-3.5 w-3.5" />
              </Button>
	              <Button
	                variant={collectionViewFilter === "all" && !isMobileFilterSheetOpen ? "outline" : "default"}
	                size="sm"
                className="h-10 shrink-0 rounded-xl px-3 text-[11px]"
                onClick={() => setIsMobileFilterSheetOpen(true)}
                disabled={!canFilterCollection}
              >
                <SlidersHorizontal className="mr-1 h-3.5 w-3.5" />
                {activeCollectionFilterOption.mobileLabel}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-10 shrink-0 rounded-xl px-3"
                onClick={() => setIsMobileNavExpanded((current) => !current)}
              >
                {isMobileNavExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Modals */}
      <SettingsModal
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
        localCollectedCount={localCollectedCount}
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
      <PartnerModal isOpen={isPartnerOpen} onClose={() => setIsPartnerOpen(false)} user={user} />

      {isCardSelectorOpen && selectedPokemon && (
        <CardSelector
          pokemonId={selectedPokemon.id}
          pokemonName={selectedPokemon.name}
          onSelect={handleCardSelected}
          onClose={() => setIsCardSelectorOpen(false)}
          selectedCardId={cardSelectorMode === "wishlist" ? collectionItem?.wanted_cards?.[0]?.card_id : collectionItem?.card_id}
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
  onLongPress,
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
  onLongPress: () => void
  onQuickCollect: () => void
  onToggleFavorite: () => void
  user: User | null
  priority?: boolean
  buttonRef?: (node: HTMLButtonElement | null) => void
}) {
  const longPressTimer = useRef<NodeJS.Timeout | null>(null)
  const isLongPressTriggered = useRef(false)

  const handleTouchStart = () => {
    if (readOnly) return
    isLongPressTriggered.current = false
    longPressTimer.current = setTimeout(() => {
      isLongPressTriggered.current = true
      onLongPress()
    }, 400)
  }

  const handleTouchEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
    }
    if (!isLongPressTriggered.current) {
      onClick()
    }
  }

  const handleTouchCancel = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
    }
  }

  const previewImage = cardImage || `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${pokemon.id}.png`
  const previewFitClass = "object-contain"
  const previewToneClass = isCollected
    ? ""
    : isWishlisted
      ? "grayscale saturate-[0.75] brightness-[0.92] contrast-[0.95] opacity-90"
      : "grayscale"
  const titleLabel = isWishlisted && cardName ? cardName : pokemon.name
  const subtitleLabel = isWishlisted && cardName
    ? `Wanted for #${String(pokemon.id).padStart(4, "0")}`
    : `#${String(pokemon.id).padStart(4, "0")}${showPriceMode && priceLabel ? ` • ${priceLabel}` : ""}`
  const hasCardPreview = Boolean(cardImage)
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
  } as CSSProperties
  const finishEffectClass = getCardFinishEffectClass(effectiveCardFinish)
  const shouldShowCardFinish = Boolean(hasCardPreview && showCardFinishEffects)
  const shouldShowPocketGlare = showBinderSlotGlare && !shouldShowCardFinish

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={onClick}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
        onContextMenu={(e) => {
          e.preventDefault()
          if (readOnly) return
          onLongPress()
        }}
        className={`relative isolate h-full w-full overflow-hidden transition-all duration-150 group ${
          isSelected
            ? "ring-2 ring-primary ring-offset-1 ring-offset-background scale-[1.03] z-10"
            : status === "finalized"
              ? "ring-1 ring-amber-500/60 shadow-[0_0_0_1px_rgba(245,158,11,0.18)]"
            : isCollected && hasCardPreview
              ? "ring-1 ring-black/5 shadow-[0_6px_14px_rgba(15,23,42,0.04)] dark:ring-white/6 dark:shadow-[0_8px_18px_rgba(0,0,0,0.14)]"
              : isCollected
              ? "ring-1 ring-green-500/40"
            : isWishlisted
              ? "ring-1 ring-amber-500/40"
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
            isCollected
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
            className="absolute inset-[4px] z-[1] overflow-hidden border border-black/6 shadow-[0_1px_0_rgba(255,255,255,0.12),0_6px_12px_rgba(15,23,42,0.12)] dark:border-white/6 dark:shadow-[0_8px_14px_rgba(0,0,0,0.18)]"
            style={{
              borderRadius: TRADING_CARD_CORNER_RADIUS,
            }}
          >
            <img
              src={previewImage}
              alt={cardName || pokemon.name}
              className={`h-full w-full object-contain ${previewToneClass} transition-transform duration-150 group-hover:scale-[1.015]`}
              loading={priority ? "eager" : "lazy"}
              fetchPriority={priority ? "high" : "auto"}
              decoding="async"
              draggable={false}
            />
            {shouldShowCardFinish ? (
              <CardFinishShader
                finish={effectiveCardFinish}
                glintX={slotCardFinishGlint.x}
                glintY={slotCardFinishGlint.y}
                glintAngle={slotCardFinishGlint.angle}
                glintPhase={slotCardFinishGlint.phase}
                patternSeed={slotCardFinishGlint.patternSeed}
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
              src={previewImage}
              alt={cardName || pokemon.name}
              className={`h-full w-full ${previewFitClass} ${previewToneClass} group-hover:scale-[1.025] transition-transform duration-150`}
              loading={priority ? "eager" : "lazy"}
              fetchPriority={priority ? "high" : "auto"}
              decoding="async"
              draggable={false}
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

      {!readOnly && isLongPressed && (
        <div className="absolute -top-10 left-1/2 -translate-x-1/2 z-20 animate-scale-in">
          <div className="flex items-center gap-1 bg-card/95 backdrop-blur-lg border border-border/50 rounded-full p-1 shadow-xl">
            <button
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
