"use client"

import { toCardImageSrc } from "@/lib/card-image-url"
import { SINGLE_CARD_GUIDE, captureSingleCardFrame, delay } from "@/lib/camera-frame"
import { useCameraStream } from "@/hooks/use-camera-stream"
import { matchesCatalogCardId } from "@/lib/card-catalog"

import { useState, useEffect, useMemo, useRef, useCallback } from "react"
import { useTCGdex, type TCGCard, type CardFilters, type CardLanguage } from "@/hooks/use-tcgdex"
import type { CardFinish } from "@/hooks/use-collection"
import { Button } from "@/components/ui/button"
import { useOverlay } from "@/hooks/use-overlay"
import CardPickerFiltersSheet from "@/components/card-picker-filters-sheet"
import { getCardPriceKey, type CardPriceSnapshot } from "@/hooks/use-card-prices"
import { useRegionalCardPrices } from "@/hooks/use-regional-card-prices"
import {
  getCardPickerSortAmount,
  readCardPickerSort,
  saveCardPickerSort,
  sortCardPickerCards,
  type CardPickerSort,
} from "@/lib/card-selector-sort"
import {
  getActiveFilterChips,
  getCardPickerFinishChoices,
  getRecordedFinish,
  getVariantFilter,
  type CardPickerFilterKey,
  type CardPickerVariantChoice,
} from "@/lib/card-picker-filters"
import { getRegionalFinishPrices } from "@/lib/regional-price"
import { DEFAULT_PRICING_REGION, type PricingRegion } from "@/lib/pricing-region"
import { PriceRisingBadge } from "@/components/price-rising-badge"
import CardPickerVariantSheet from "@/components/card-picker-variant-sheet"
import { completeCardSelectorSelection } from "@/lib/card-selector-selection-flow"
import { buildCardImageDescriptor, compareCardImageDescriptors, type CardImageDescriptor } from "@/lib/card-image-match"
import { aggregateCardScanMatches, type AggregatedCardScanMatch, type CardScanFrameMatch } from "@/lib/card-scan-matching"
import { selectCandidateCardsForAssetTextOcr } from "@/lib/card-scan-candidate-text"
import { rankAggregatedCardScanMatchesWithText } from "@/lib/card-scan-ranking"
import { buildCardMetadataTextSignals, mergeCardTextSignals, type CardTextSignals } from "@/lib/card-scan-text"
import { X, Search, Check, Loader2, Camera, Heart, MoreHorizontal, SlidersHorizontal, WifiOff } from "lucide-react"

export type CardSelectorMode = "collect" | "wishlist"

interface CardSelectorProps {
  pokemonId: number
  pokemonName: string
  onSelect: (card: TCGCard | null, mode: CardSelectorMode, finish?: CardFinish) => void
  onClose: () => void
  selectedCardId?: string
  selectedCollectedCardId?: string
  selectedWantedCardId?: string
  mode?: CardSelectorMode
  /** Initial card language (the user's preferred card language setting). */
  defaultCardLanguage?: CardLanguage
  /** The user's pricing region; card prices are weighted for it. */
  pricingRegion?: PricingRegion
  /** Formats a GBP amount in the user's display currency (GBP when omitted). */
  formatAmount?: CardSelectorAmountFormatter
}

type CardSelectorAmountFormatter = (gbpAmount: number | null | undefined, price?: CardPriceSnapshot) => string | null

type CardScanMatch = CardScanFrameMatch<TCGCard>

const CARD_SCAN_FRAME_COUNT = 8
const CARD_SCAN_FRAME_DELAY_MS = 450
const CARD_SCAN_MIN_USABLE_FRAMES = 3
const CARD_SCAN_OCR_FRAME_LIMIT = 4
const CARD_SCAN_CANDIDATE_ASSET_OCR_LIMIT = 18
const CARD_GUIDE_INSET_X = SINGLE_CARD_GUIDE.insetX
const CARD_GUIDE_INSET_Y = SINGLE_CARD_GUIDE.insetY
const CARD_ASPECT_RATIO = SINGLE_CARD_GUIDE.aspectRatio

function formatGbpAmount(amount: number | null | undefined) {
  return typeof amount === "number" && Number.isFinite(amount)
    ? new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 2 }).format(amount)
    : null
}

function getCardSelectorPriceLabels(price: CardPriceSnapshot | undefined, formatAmount: CardSelectorAmountFormatter = formatGbpAmount) {
  const low = formatAmount(price?.lowGbpAmount, price)
  const high = formatAmount(price?.highGbpAmount, price)
  const confidence = price?.confidence && price.confidence !== "unknown"
    ? price.confidence.charAt(0).toUpperCase() + price.confidence.slice(1)
    : null

  return {
    good: formatAmount(price?.goodGbpAmount, price),
    market: formatAmount(price?.marketGbpAmount ?? price?.gbpAmount, price),
    range: low && high ? (low === high ? low : `${low}-${high}`) : low || high,
    confidence,
  }
}

function parseCardNumber(value?: string) {
  if (!value) return null
  const match = value.match(/\d+/)
  if (!match) return null
  const parsed = Number.parseInt(match[0], 10)
  return Number.isFinite(parsed) ? parsed : null
}

function inferCardFinish(card: TCGCard): CardFinish {
  const rarity = (card.rarity || "").toLowerCase()
  const localNumber = parseCardNumber(card.localId)
  const officialCount = card.set.officialCardCount

  if (rarity.includes("ace spec")) return "ace_spec"
  if (rarity.includes("amazing")) return "amazing_rare"
  if (rarity.includes("radiant")) return "radiant_rare"
  if (rarity.includes("shiny")) return "shiny_rare"
  if (rarity.includes("special illustration")) return "special_illustration_rare"
  if (rarity.includes("illustration")) return "illustration_rare"
  if (rarity.includes("hyper")) return "hyper_rare"
  if (rarity.includes("ultra")) return "ultra_rare"
  if (rarity.includes("double")) return "double_rare"
  if (card.variants?.jumbo) return "jumbo"
  if ((localNumber != null && officialCount && localNumber > officialCount) || rarity.includes("secret")) return "secret_rare"
  if (card.variants?.holo) return "holo"
  if (card.variants?.reverse) return "reverse_holo"
  return "normal"
}

function CardSelectorImage({
  src,
  alt,
  className,
  fallbackClassName = "flex h-full w-full items-center justify-center bg-muted",
}: {
  src?: string
  alt: string
  className: string
  fallbackClassName?: string
}) {
  const [failed, setFailed] = useState(false)
  const imageSrc = toCardImageSrc(src)

  useEffect(() => {
    setFailed(false)
  }, [src])

  if (!imageSrc || failed) {
    return (
      <div className={fallbackClassName}>
        <span className="text-xs text-muted-foreground">No Image</span>
      </div>
    )
  }

  return (
    <img
      src={imageSrc}
      alt={alt}
      className={className}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  )
}

export default function CardSelector({
  pokemonId,
  pokemonName,
  onSelect,
  onClose,
  selectedCardId,
  selectedCollectedCardId,
  selectedWantedCardId,
  mode = "collect",
  defaultCardLanguage,
  pricingRegion = DEFAULT_PRICING_REGION,
  formatAmount = formatGbpAmount,
}: CardSelectorProps) {
  const { fetchCardsForPokemon, filterCards, isLoading, error } = useTCGdex()
  const [cards, setCards] = useState<TCGCard[]>([])
  const [filters, setFilters] = useState<CardFilters>({})
  const [sort, setSort] = useState<CardPickerSort>(readCardPickerSort)
  const [selectedCardLanguage, setSelectedCardLanguage] = useState<CardLanguage>(defaultCardLanguage ?? "en")
  const [selectionMode, setSelectionMode] = useState<CardSelectorMode>(mode)
  const [variantChoice, setVariantChoice] = useState<CardPickerVariantChoice>("any")
  const [isFiltersOpen, setIsFiltersOpen] = useState(false)
  const [isMoreOpen, setIsMoreOpen] = useState(false)
  const moreMenuRef = useRef<HTMLDivElement | null>(null)
  const [isScanningCard, setIsScanningCard] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [scanPreviewUrl, setScanPreviewUrl] = useState<string | null>(null)
  const [scanMatches, setScanMatches] = useState<CardScanMatch[]>([])
  const [isCardScannerOpen, setIsCardScannerOpen] = useState(false)
  const [scanCameraError, setCameraError] = useState<string | null>(null)
  const [isCapturingCardScan, setIsCapturingCardScan] = useState(false)
  const [isApplyingCardResults, setIsApplyingCardResults] = useState(false)
  const [cardFramesProcessed, setCardFramesProcessed] = useState(0)
  const [cardUsableFrames, setCardUsableFrames] = useState(0)
  const [lastFramePreviewUrl, setLastFramePreviewUrl] = useState<string | null>(null)
  const descriptorCacheRef = useRef<Map<string, Promise<CardImageDescriptor | null>>>(new Map())
  const cardTextSignalCacheRef = useRef<Map<string, Promise<CardTextSignals>>>(new Map())
  const cardVideoRef = useRef<HTMLVideoElement | null>(null)
  const cardCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const isWishlistMode = selectionMode === "wishlist"
  const activeSelectedCardId = isWishlistMode
    ? selectedWantedCardId ?? (mode === "wishlist" ? selectedCardId : undefined)
    : selectedCollectedCardId ?? (mode === "collect" ? selectedCardId : undefined)
  const recordedFinish = getRecordedFinish(variantChoice)
  const finishFor = useCallback((card: TCGCard | undefined): CardFinish => recordedFinish ?? (card ? inferCardFinish(card) : "normal"), [recordedFinish])
  const priceLookups = useMemo(
    () => cards.map((card) => ({ cardId: card.id, language: selectedCardLanguage })),
    [cards, selectedCardLanguage],
  )
  const { pricesByCardId, isLoading: isLoadingPrices } = useRegionalCardPrices(priceLookups, cards.length > 0, pricingRegion)
  const intentCopy = isWishlistMode
    ? {
        title: `Choose wanted card for ${pokemonName}`,
        label: "Wanted",
        shortLabel: "Want",
        actionLabel: "Track as wanted",
        scanLabel: "Scan wanted",
        emptyActionLabel: "Clear wanted card",
        helper: "Selecting a card keeps this slot open and tracks the card you want to find.",
        searchPlaceholder: "Search name or number",
        currentLabel: "Current wanted",
        activeClass: "border-amber-400/60 bg-amber-400/15 text-amber-700 shadow-[0_10px_24px_-18px_rgba(251,191,36,0.85)] dark:text-amber-300",
        accentClass: "border-amber-400/40 bg-amber-400/12 text-amber-700 dark:text-amber-300",
      }
    : {
        title: `Add card for ${pokemonName}`,
        label: "Add card",
        shortLabel: "Add",
        actionLabel: "Add card",
        scanLabel: "Scan card",
        emptyActionLabel: "Mark owned without card",
        helper: "Selecting a card marks the slot collected and attaches this card to your binder.",
        searchPlaceholder: "Search name or number",
        currentLabel: "Current card",
        activeClass: "border-emerald-400/55 bg-emerald-400/14 text-emerald-700 shadow-[0_10px_24px_-18px_rgba(52,211,153,0.85)] dark:text-emerald-300",
        accentClass: "border-emerald-400/40 bg-emerald-400/12 text-emerald-700 dark:text-emerald-300",
      }
  const intentTextClass = isWishlistMode ? "text-amber-600 dark:text-amber-300" : "text-emerald-600 dark:text-emerald-300"
  const intentSelectedCardClass = isWishlistMode
    ? "border-amber-400 ring-2 ring-amber-400/45"
    : "border-emerald-400 ring-2 ring-emerald-400/45"
  const intentHoverCardClass = isWishlistMode
    ? "hover:border-amber-400/65 hover:ring-2 hover:ring-amber-400/20"
    : "hover:border-emerald-400/65 hover:ring-2 hover:ring-emerald-400/20"

  const selectCard = useCallback((card: TCGCard, finish: CardFinish = finishFor(card)) => {
    completeCardSelectorSelection({
      onClose,
      onSelect: () => onSelect({ ...card, language: selectedCardLanguage }, selectionMode, finish),
    })
  }, [finishFor, onClose, onSelect, selectedCardLanguage, selectionMode])
  const [pendingCard, setPendingCard] = useState<TCGCard | null>(null)
  /** Tapping a card picks it; a printing that comes in several finishes asks which one first. */
  const pickCard = useCallback((card: TCGCard) => {
    if (getCardPickerFinishChoices(card.variants, inferCardFinish(card), variantChoice).length > 0) {
      setPendingCard(card)
      return
    }
    selectCard(card)
  }, [selectCard, variantChoice])
  const [isOnline, setIsOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine !== false)
  useEffect(() => {
    const update = () => setIsOnline(navigator.onLine !== false)
    window.addEventListener("online", update)
    window.addEventListener("offline", update)
    return () => {
      window.removeEventListener("online", update)
      window.removeEventListener("offline", update)
    }
  }, [])

  const selectWithoutCard = useCallback(() => {
    completeCardSelectorSelection({
      onClose,
      onSelect: () => onSelect(null, selectionMode, finishFor(cards.find((card) => matchesCatalogCardId(card, activeSelectedCardId)))),
    })
  }, [activeSelectedCardId, cards, finishFor, onClose, onSelect, selectionMode])

  useEffect(() => {
    setSelectionMode(mode)
  }, [mode])

  useEffect(() => {
    const load = async () => {
      const cardsData = await fetchCardsForPokemon(pokemonId, "en")
      setCards(cardsData)
    }
    load()
  }, [pokemonId, fetchCardsForPokemon])

  useEffect(() => {
    descriptorCacheRef.current.clear()
    cardTextSignalCacheRef.current.clear()
    setScanError(null)
    setScanMatches([])
    setScanPreviewUrl((currentUrl) => {
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl)
      }
      return null
    })
    setLastFramePreviewUrl(null)
  }, [pokemonId])

  useEffect(() => {
    return () => {
      if (scanPreviewUrl) {
        URL.revokeObjectURL(scanPreviewUrl)
      }
    }
  }, [scanPreviewUrl])

  const camera = useCameraStream(isCardScannerOpen, cardVideoRef)
  const cameraError = scanCameraError ?? camera.error
  const isCameraReady = camera.ready

  const variantFilter = getVariantFilter(variantChoice)
  const filteredCards = useMemo(
    () => filterCards(cards, { ...filters, variant: variantFilter }),
    [cards, filters, filterCards, variantFilter],
  )
  const scanRankById = useMemo(() => {
    return new Map(scanMatches.map((match, index) => [match.card.id, index + 1]))
  }, [scanMatches])
  const likelyRank = useCallback((card: TCGCard) => {
    // Most likely picks first: in Add mode the card this slot wants, then the slot's current card.
    if (!isWishlistMode && matchesCatalogCardId(card, selectedWantedCardId)) return 0
    if (matchesCatalogCardId(card, activeSelectedCardId)) return 1
    return Number.POSITIVE_INFINITY
  }, [activeSelectedCardId, isWishlistMode, selectedWantedCardId])
  const displayedCards = useMemo(() => {
    if (scanRankById.size === 0) {
      return sortCardPickerCards(filteredCards, sort, (card) =>
        getCardPickerSortAmount(pricesByCardId[getCardPriceKey(card.id, selectedCardLanguage)], finishFor(card), pricingRegion), likelyRank)
    }

    return [...filteredCards]
      .sort((left, right) => {
        const leftRank = scanRankById.get(left.id) ?? Number.POSITIVE_INFINITY
        const rightRank = scanRankById.get(right.id) ?? Number.POSITIVE_INFINITY

        if (leftRank !== rightRank) {
          return leftRank - rightRank
        }

        if (Boolean(left.image) !== Boolean(right.image)) {
          return left.image ? -1 : 1
        }

        return left.localId.localeCompare(right.localId, undefined, { numeric: true, sensitivity: "base" })
      })
  }, [filteredCards, pricesByCardId, pricingRegion, scanRankById, selectedCardLanguage, finishFor, likelyRank, sort])

  const uniqueSets = useMemo(() => {
    return [...new Map(cards.map((card) => [card.set.id, card.set])).values()]
      .filter((set) => Boolean(set.id))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [cards])

  const uniqueRarities = useMemo(() => {
    return [...new Set(cards.map((c) => c.rarity).filter(Boolean))] as string[]
  }, [cards])

  const defaultLanguage = defaultCardLanguage ?? "en"
  const activeFilterChips = useMemo(() => getActiveFilterChips(
    { filters, language: selectedCardLanguage, defaultLanguage, variant: variantChoice, sort },
    (id) => uniqueSets.find((set) => set.id === id)?.name,
  ), [defaultLanguage, filters, selectedCardLanguage, sort, uniqueSets, variantChoice])
  const updateSort = useCallback((next: CardPickerSort) => {
    setSort(next)
    saveCardPickerSort(next)
  }, [])
  const clearFilter = useCallback((key: CardPickerFilterKey) => {
    if (key === "sort") updateSort("default")
    else if (key === "language") setSelectedCardLanguage(defaultLanguage)
    else if (key === "variant") setVariantChoice("any")
    else setFilters((current) => ({ ...current, [key]: undefined }))
  }, [defaultLanguage, updateSort])
  const resetFilters = useCallback(() => {
    setFilters((current) => ({ searchQuery: current.searchQuery }))
    setVariantChoice("any")
    setSelectedCardLanguage(defaultLanguage)
    updateSort("default")
  }, [defaultLanguage, updateSort])
  const closeMoreMenu = useCallback(() => setIsMoreOpen(false), [])
  useOverlay(isMoreOpen, closeMoreMenu, { containerRef: moreMenuRef, lockScroll: false, history: false })

  const getDescriptorForCard = useCallback(async (card: TCGCard) => {
    if (!card.image) {
      return null
    }

    const existingPromise = descriptorCacheRef.current.get(card.id)
    if (existingPromise) {
      return existingPromise
    }

    const proxyUrl = card.image.startsWith("/")
      ? card.image
      : `/api/card-image-proxy?url=${encodeURIComponent(card.image)}`

    const descriptorPromise = buildCardImageDescriptor(proxyUrl).catch(() => null)
    descriptorCacheRef.current.set(card.id, descriptorPromise)
    return descriptorPromise
  }, [])

  const getTextSignalsForCard = useCallback((card: TCGCard) => {
    const existingPromise = cardTextSignalCacheRef.current.get(card.id)
    if (existingPromise) {
      return existingPromise
    }

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

    cardTextSignalCacheRef.current.set(card.id, textSignalPromise)
    return textSignalPromise
  }, [])

  const getTextSignalsForCards = useCallback(async (
    candidateCards: TCGCard[],
    visualMatches: AggregatedCardScanMatch<TCGCard>[],
    querySignals: CardTextSignals | null | undefined,
  ) => {
    const textSignalMap = new Map(
      candidateCards.map((card) => [card.id, buildCardMetadataTextSignals(card)] as const),
    )
    const assetOcrCandidates = selectCandidateCardsForAssetTextOcr(candidateCards, visualMatches, querySignals, {
      getCardId: (card) => card.id,
      maxCards: CARD_SCAN_CANDIDATE_ASSET_OCR_LIMIT,
    })

    for (const card of assetOcrCandidates) {
      textSignalMap.set(card.id, await getTextSignalsForCard(card))
    }

    return textSignalMap
  }, [getTextSignalsForCard])

  const scoreSingleCardFrame = useCallback(async (file: File) => {
    const candidates = cards.filter((card) => Boolean(card.image))
    if (candidates.length === 0) {
      throw new Error("There are no card images loaded for this Pokemon yet.")
    }

    const queryDescriptor = await buildCardImageDescriptor(file, { requireCardBounds: true })
    const scoredMatches = (
      await Promise.all(
        candidates.map(async (card) => {
          const descriptor = await getDescriptorForCard(card)
          if (!descriptor) {
            return null
          }

          const match = compareCardImageDescriptors(queryDescriptor, descriptor)
          return {
            card,
            similarity: match.similarity,
          }
        }),
      )
    )
      .filter((match): match is CardScanMatch => Boolean(match))
      .sort((left, right) => right.similarity - left.similarity)

    if (scoredMatches.length === 0) {
      throw new Error("The scan could not compare that image to the loaded card set.")
    }

    return scoredMatches
  }, [cards, getDescriptorForCard])

  const closeCardScanner = useCallback(() => {
    setIsCardScannerOpen(false)
    setCameraError(null)
    setIsCapturingCardScan(false)
    setIsApplyingCardResults(false)
    setCardFramesProcessed(0)
    setCardUsableFrames(0)
    setLastFramePreviewUrl(null)
  }, [])

  const selectorDialogRef = useRef<HTMLDivElement | null>(null)
  const cardScannerRef = useRef<HTMLDivElement | null>(null)
  const closeCardScannerSafely = useCallback(() => {
    if (isCapturingCardScan || isApplyingCardResults) return
    closeCardScanner()
  }, [closeCardScanner, isApplyingCardResults, isCapturingCardScan])
  useOverlay(true, onClose, { containerRef: selectorDialogRef, autoFocus: false })
  useOverlay(isCardScannerOpen, closeCardScannerSafely, { containerRef: cardScannerRef })

  const openCardScanner = useCallback(() => {
    if (cards.length === 0 || isLoading) {
      return
    }

    setScanError(null)
    setCameraError(null)
    setCardFramesProcessed(0)
    setCardUsableFrames(0)
    setLastFramePreviewUrl(null)
    setIsCardScannerOpen(true)
  }, [cards.length, isLoading])

  const handleGuidedCardScan = useCallback(async () => {
    const video = cardVideoRef.current
    const canvas = cardCanvasRef.current

    if (!video || !canvas || !isCameraReady || isCapturingCardScan) {
      return
    }

    setIsCapturingCardScan(true)
    setIsScanningCard(true)
    setScanError(null)
    setCameraError(null)
    setCardFramesProcessed(0)
    setCardUsableFrames(0)
    setScanMatches([])

    try {
      const candidates = cards.filter((card) => Boolean(card.image))
      const successfulFrameMatches: CardScanMatch[][] = []
      const scanTextSignalPromises: Array<Promise<CardTextSignals | null>> = []

      const startTextScan = (previewUrl: string) => {
        if (scanTextSignalPromises.length >= CARD_SCAN_OCR_FRAME_LIMIT) return

        scanTextSignalPromises.push(import("@/lib/card-scan-ocr")
          .then(({ recognizeCardTextSignalsFromImage }) => recognizeCardTextSignalsFromImage(previewUrl, { exhaustive: true }))
          .catch((error) => {
            console.info("[binderdex] Skipping card OCR scan:", error)
            return null
          }))
      }

      for (let index = 0; index < CARD_SCAN_FRAME_COUNT; index += 1) {
        setCardFramesProcessed(index + 1)
        const frame = await captureSingleCardFrame(video, canvas, index)
        setLastFramePreviewUrl(frame.previewUrl)

        try {
          const matches = await scoreSingleCardFrame(frame.file)
          if (
            scanTextSignalPromises.length === 0 ||
            (scanTextSignalPromises.length < CARD_SCAN_OCR_FRAME_LIMIT && index >= Math.floor(CARD_SCAN_FRAME_COUNT / 2))
          ) {
            startTextScan(frame.previewUrl)
          }
          successfulFrameMatches.push(matches)
          setCardUsableFrames(successfulFrameMatches.length)
          setScanPreviewUrl((currentUrl) => {
            if (currentUrl) {
              URL.revokeObjectURL(currentUrl)
            }
            return URL.createObjectURL(frame.file)
          })
        } catch {
          // Ignore bad or reflective frames and keep sampling.
        }

        if (index < CARD_SCAN_FRAME_COUNT - 1) {
          await delay(CARD_SCAN_FRAME_DELAY_MS)
        }
      }

      if (successfulFrameMatches.length < CARD_SCAN_MIN_USABLE_FRAMES) {
        throw new Error(
          `Only got ${successfulFrameMatches.length} usable frame${successfulFrameMatches.length === 1 ? "" : "s"} from the scan. Fill the guide with one card and keep it steady.`,
        )
      }

      setIsCapturingCardScan(false)
      setIsApplyingCardResults(true)

      const minimumAppearances = Math.max(2, Math.ceil(successfulFrameMatches.length * 0.45))
      const textSignals = mergeCardTextSignals(await Promise.all(scanTextSignalPromises))
      const visualMatches = aggregateCardScanMatches(successfulFrameMatches, {
        getCardId: (card) => card.id,
        minimumAppearances,
        maxResults: 6,
      })
      const candidateTextSignals = textSignals
        ? await getTextSignalsForCards(candidates, visualMatches, textSignals)
        : undefined
      const aggregatedMatches = rankAggregatedCardScanMatchesWithText(
        visualMatches,
        textSignals,
        {
          candidateCards: candidates,
          candidateTextSignals,
          getCardId: (card) => card.id,
        },
      )
        .slice(0, 6)
        .map((match) => ({
          card: match.card,
          similarity: match.similarity,
        }))

      if (aggregatedMatches.length === 0) {
        throw new Error("The scan did not get a stable match. Try again with less glare and the card centered.")
      }

      setScanMatches(aggregatedMatches)
      closeCardScanner()
    } catch (scanError) {
      console.error(scanError)
      const message = scanError instanceof Error ? scanError.message : "The card scan failed."
      setScanError(message)
      setCameraError(message)
    } finally {
      setIsCapturingCardScan(false)
      setIsApplyingCardResults(false)
      setIsScanningCard(false)
    }
  }, [cards, closeCardScanner, getTextSignalsForCards, isCameraReady, isCapturingCardScan, scoreSingleCardFrame])

  return (
    <>
      {isCardScannerOpen && (
        <div ref={cardScannerRef} role="dialog" aria-modal="true" aria-label="Single card scanner" className="fixed inset-0 z-[60] bg-black outline-none">
          <canvas ref={cardCanvasRef} className="hidden" />
          <div className="mx-auto flex h-full w-full max-w-md flex-col px-3 pb-[calc(var(--safe-bottom)+0.75rem)] pt-[calc(var(--top-inset)+0.25rem)]">
            <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[2rem] border border-white/10 bg-black shadow-2xl">
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-white">
                <div>
                  <p className="text-sm font-semibold">Single Card Scan</p>
                  <p className="text-xs text-white/65">Guided multi-frame scan using the same camera flow as page scanning.</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 rounded-full"
                  aria-label="Close card scanner"
                  onClick={closeCardScanner}
                  disabled={isCapturingCardScan || isApplyingCardResults}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="relative min-h-0 flex-1 bg-black">
                <video
                  ref={cardVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className={`h-full w-full object-cover transition-opacity ${lastFramePreviewUrl ? "opacity-25" : "opacity-100"}`}
                />
                {lastFramePreviewUrl ? (
                  <div className="absolute inset-0">
                    <img
                      src={lastFramePreviewUrl}
                      alt="Last scanned card frame"
                      className="absolute inset-0 h-full w-full object-contain"
                    />
                    <div className="pointer-events-none absolute inset-x-4 top-4 flex items-center justify-between rounded-full border border-white/12 bg-black/60 px-3 py-2 text-[11px] text-white/80 backdrop-blur">
                      <span>Last good frame</span>
                      <span>{cardUsableFrames} usable</span>
                      <span>{Math.min(CARD_SCAN_FRAME_COUNT, cardFramesProcessed)}/{CARD_SCAN_FRAME_COUNT}</span>
                    </div>
                  </div>
                ) : (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div
                      className="rounded-[2.25rem] border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.36)]"
                      style={{
                        width: `${(1 - CARD_GUIDE_INSET_X * 2) * 100}%`,
                        aspectRatio: `${CARD_ASPECT_RATIO}`,
                        maxHeight: `${(1 - CARD_GUIDE_INSET_Y * 2) * 100}%`,
                      }}
                    />
                  </div>
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
                  <p className="text-sm text-red-300">{cameraError}</p>
                ) : (
                  <p className="text-sm text-white/70">
                    Place one card inside the guide and keep it steady. The scanner samples for about{" "}
                    {Math.round((CARD_SCAN_FRAME_COUNT * CARD_SCAN_FRAME_DELAY_MS) / 1000)} seconds and keeps the last usable frame visible.
                  </p>
                )}

                {isCapturingCardScan || isApplyingCardResults ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-[11px] text-white/65">
                      <span>{isCapturingCardScan ? `Scanning ${cardFramesProcessed}/${CARD_SCAN_FRAME_COUNT}` : "Applying results"}</span>
                      <span>{cardUsableFrames} usable frame{cardUsableFrames === 1 ? "" : "s"}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-white transition-all"
                        style={{ width: `${isCapturingCardScan ? (cardFramesProcessed / CARD_SCAN_FRAME_COUNT) * 100 : 100}%` }}
                      />
                    </div>
                  </div>
                ) : null}

                <div className="flex items-center justify-end gap-2">
                  <Button
                    variant="ghost"
                    onClick={closeCardScanner}
                    disabled={isCapturingCardScan || isApplyingCardResults}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleGuidedCardScan}
                    disabled={!isCameraReady || isCapturingCardScan || isApplyingCardResults}
                  >
                    {isCapturingCardScan || isApplyingCardResults ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Camera className="mr-2 h-4 w-4" />
                    )}
                    {isCapturingCardScan ? "Scanning Card" : isApplyingCardResults ? "Applying Results" : "Start Guided Scan"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div data-overlay-backdrop className="fixed inset-0 z-50 bg-black/80" onClick={onClose} />
      <div
        ref={selectorDialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Card selector"
        className="fixed inset-x-0 z-50 flex flex-col outline-none overflow-hidden rounded-t-[2.25rem] border border-border bg-card shadow-[0_-28px_80px_-42px_rgba(0,0,0,0.75)] sm:inset-x-3 sm:rounded-[2.25rem] lg:inset-x-8 xl:left-1/2 xl:right-auto xl:w-[min(calc(100vw-4rem),92rem)] xl:-translate-x-1/2"
        onClick={(e) => e.stopPropagation()}
        style={{
          top: "calc(var(--top-inset) + 0.5rem)",
          bottom: "calc(var(--safe-bottom) + 0.25rem)",
          overscrollBehaviorY: "contain",
          touchAction: "pan-y",
        }}
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="z-20 shrink-0 border-b border-border bg-card px-4 pb-2.5 pt-2 sm:px-5 sm:pt-3">
            <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-muted-foreground/30 sm:hidden" />
            <h2 className="sr-only">{intentCopy.title}</h2>
            <p className="sr-only">{intentCopy.helper}</p>
            <div className="flex items-center gap-2">
              <div role="group" aria-label="Picker mode" className="grid shrink-0 grid-cols-2 rounded-full border border-border/60 bg-background/70 p-0.5 dark:border-white/10 dark:bg-white/[0.04]">
                <button
                  type="button"
                  aria-pressed={selectionMode === "collect"}
                  aria-label="Add card"
                  onClick={() => setSelectionMode("collect")}
                  className={`flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors ${
                    selectionMode === "collect"
                      ? "bg-emerald-500/15 text-emerald-700 ring-1 ring-emerald-400/50 dark:text-emerald-300"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Check className="h-3.5 w-3.5" />
                  <span>Add<span className="hidden sm:inline"> card</span></span>
                </button>
                <button
                  type="button"
                  aria-pressed={selectionMode === "wishlist"}
                  aria-label="Wanted"
                  onClick={() => setSelectionMode("wishlist")}
                  className={`flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors ${
                    selectionMode === "wishlist"
                      ? "bg-amber-500/15 text-amber-700 ring-1 ring-amber-400/55 dark:text-amber-300"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Heart className={`h-3.5 w-3.5 ${selectionMode === "wishlist" ? "fill-current" : ""}`} />
                  <span>Want<span className="hidden sm:inline">ed</span></span>
                </button>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold capitalize leading-tight">{pokemonName}</p>
                <p className="truncate text-[11px] text-muted-foreground">{filteredCards.length} of {cards.length} cards</p>
              </div>
              <div className="relative shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 rounded-full"
                  aria-label="More options"
                  aria-haspopup="menu"
                  aria-expanded={isMoreOpen}
                  onClick={() => setIsMoreOpen((open) => !open)}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
                {isMoreOpen && <div aria-hidden="true" className="fixed inset-0 z-20" onClick={() => setIsMoreOpen(false)} />}
                {isMoreOpen && (
                  <div
                    ref={moreMenuRef}
                    role="menu"
                    aria-label="More options"
                    className="absolute right-0 top-10 z-30 w-56 rounded-2xl border border-border bg-card p-1 shadow-xl"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setIsMoreOpen(false)
                        selectWithoutCard()
                      }}
                      className="flex min-h-10 w-full items-center rounded-xl px-3 text-left text-sm hover:bg-muted/70"
                    >
                      {intentCopy.emptyActionLabel}
                    </button>
                  </div>
                )}
              </div>
              <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 rounded-full" onClick={onClose} aria-label="Close card selector">
                <X className="h-4 w-4 sm:h-5 sm:w-5" />
              </Button>
            </div>

            <div className="mt-2 flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="search"
                  aria-label="Search cards"
                  placeholder={intentCopy.searchPlaceholder}
                  value={filters.searchQuery || ""}
                  onChange={(e) => setFilters((f) => ({ ...f, searchQuery: e.target.value }))}
                  className="h-11 w-full rounded-2xl border border-border/60 bg-background/85 pl-9 pr-11 text-base md:text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/50 [&::-webkit-search-cancel-button]:hidden"
                />
                <button
                  type="button"
                  onClick={openCardScanner}
                  disabled={isLoading || cards.length === 0 || isScanningCard}
                  aria-label={intentCopy.scanLabel}
                  className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted/70 hover:text-foreground disabled:opacity-40"
                >
                  {isScanningCard ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                </button>
              </div>
              <button
                type="button"
                onClick={() => setIsFiltersOpen(true)}
                aria-haspopup="dialog"
                className={`flex h-11 shrink-0 items-center gap-1.5 rounded-2xl border px-3 text-xs font-semibold transition-colors ${
                  activeFilterChips.length > 0
                    ? "border-primary/45 bg-primary/12 text-primary"
                    : "border-border/60 bg-background/85 text-foreground hover:bg-muted/60"
                }`}
              >
                <SlidersHorizontal className="h-4 w-4" />
                <span>Filters · Sort</span>
                {activeFilterChips.length > 0 && (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] text-primary-foreground">
                    {activeFilterChips.length}
                  </span>
                )}
              </button>
            </div>

            {activeFilterChips.length > 0 && (
              <div role="list" aria-label="Active filters" className="-mx-4 mt-2 flex items-center gap-1.5 overflow-x-auto px-4 scrollbar-hide sm:mx-0 sm:px-0">
                {activeFilterChips.map((chip) => (
                  <span role="listitem" key={chip.key} className="shrink-0">
                    <button
                      type="button"
                      onClick={() => clearFilter(chip.key)}
                      aria-label={`Remove filter ${chip.label}`}
                      className="flex h-9 items-center gap-1 rounded-full border border-primary/35 bg-primary/10 pl-3 pr-2 text-xs font-semibold text-primary"
                    >
                      <span className="max-w-[10rem] truncate">{chip.label}</span>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                ))}
                {activeFilterChips.length > 1 && (
                  <button type="button" onClick={resetFilters} className="h-9 shrink-0 rounded-full px-3 text-xs font-semibold text-muted-foreground hover:text-foreground">
                    Clear all
                  </button>
                )}
              </div>
            )}
          </div>

          {pendingCard && (
            <CardPickerVariantSheet
              cardName={pendingCard.name}
              setName={pendingCard.set.name}
              actionLabel={isWishlistMode ? "Want" : "Add"}
              choices={getCardPickerFinishChoices(pendingCard.variants, inferCardFinish(pendingCard), variantChoice).map((choice) => {
                const snapshot = pricesByCardId[getCardPriceKey(pendingCard.id, selectedCardLanguage)]
                const finishPrice = getRegionalFinishPrices(snapshot, pricingRegion)[choice.finish]
                return { ...choice, price: finishPrice ? formatAmount(finishPrice.marketGbpAmount ?? finishPrice.gbpAmount, snapshot) : null }
              })}
              suggested={(() => {
                const inferred = inferCardFinish(pendingCard)
                return inferred === "normal" || inferred === "holo" || inferred === "reverse_holo" ? inferred : null
              })()}
              onChoose={(finish) => {
                const card = pendingCard
                setPendingCard(null)
                selectCard(card, finish)
              }}
              onClose={() => setPendingCard(null)}
            />
          )}
          {isFiltersOpen && (
            <CardPickerFiltersSheet
              sort={sort}
              onSortChange={updateSort}
              language={selectedCardLanguage}
              onLanguageChange={setSelectedCardLanguage}
              variant={variantChoice}
              onVariantChange={setVariantChoice}
              set={filters.set}
              sets={uniqueSets}
              onSetChange={(set) => setFilters((f) => ({ ...f, set }))}
              rarity={filters.rarity}
              rarities={uniqueRarities}
              onRarityChange={(rarity) => setFilters((f) => ({ ...f, rarity }))}
              resultCount={filteredCards.length}
              onReset={resetFilters}
              onClose={() => setIsFiltersOpen(false)}
            />
          )}

          <div
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
            style={{
              WebkitOverflowScrolling: "touch",
              touchAction: "pan-y",
            }}
          >

            {(isScanningCard || scanError || scanMatches.length > 0 || scanPreviewUrl) && (
              <div className="border-b border-border bg-background/70 p-3 sm:p-4">
                <div className="flex flex-col gap-3 lg:flex-row">
                  {scanPreviewUrl && (
                    <div className="w-full max-w-[140px] shrink-0 overflow-hidden rounded-2xl border border-border bg-muted sm:max-w-[180px]">
                      <img src={scanPreviewUrl} alt="Scanned card preview" className="h-full w-full object-cover" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1 space-y-3">
                    <div>
                      <p className="text-sm font-medium">Single-card scan</p>
                      <p className="text-xs text-muted-foreground">
                        The scanner samples multiple guided frames, throws away unstable captures, and ranks the closest loaded cards by consistency.
                      </p>
                    </div>
                    {isScanningCard && (
                      <div className="flex items-center gap-2 rounded-2xl border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Comparing stable guided frames against {cards.length} loaded cards…
                      </div>
                    )}
                    {scanError && <div className="text-sm text-destructive">{scanError}</div>}
                    {scanMatches.length > 0 && (
                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {scanMatches.map((match, index) => {
                          const price = pricesByCardId[getCardPriceKey(match.card.id, selectedCardLanguage)]
                          const priceLabels = getCardSelectorPriceLabels(price, formatAmount)

                          return (
                            <button
                              key={match.card.id}
                              onClick={() => pickCard(match.card)}
                              className={`flex items-center gap-3 rounded-2xl border border-border bg-muted/40 p-3 text-left transition-all hover:bg-muted/60 ${intentHoverCardClass}`}
                            >
                              <CardSelectorImage
                                src={match.card.image}
                                alt={match.card.name}
                                className="h-20 w-14 shrink-0 rounded-md object-cover bg-muted"
                                fallbackClassName="flex h-20 w-14 shrink-0 items-center justify-center rounded-md bg-muted"
                              />
                              <div className="min-w-0">
                                <p className={`text-xs font-medium uppercase tracking-[0.2em] ${intentTextClass}`}>
                                  {index === 0 ? "Best Match" : `Match ${index + 1}`}
                                </p>
                                <p className="truncate text-sm font-medium">{match.card.set.name}</p>
                                <p className="text-xs text-muted-foreground">#{match.card.localId}</p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  Similarity {Math.round(match.similarity * 100)}%
                                </p>
                                <div className="mt-1 grid grid-cols-2 gap-1 text-[10px]">
                                  <span className="rounded-lg bg-background/70 px-1.5 py-1 text-emerald-600 dark:text-emerald-300">
                                    Low {priceLabels.good ?? (isLoadingPrices ? "..." : "-")}
                                  </span>
                                  <span className="rounded-lg bg-background/70 px-1.5 py-1 text-foreground">
                                    Market {priceLabels.market ?? (isLoadingPrices ? "..." : "-")}
                                  </span>
                                </div>
                                {(priceLabels.range || priceLabels.confidence) ? (
                                  <p className="mt-1 truncate text-[10px] text-muted-foreground">
                                    {[
                                      priceLabels.range ? `Range ${priceLabels.range}` : null,
                                      priceLabels.confidence ? `${priceLabels.confidence} confidence` : null,
                                    ].filter(Boolean).join(" · ")}
                                  </p>
                                ) : null}
                                <p className={`mt-1 text-xs font-medium ${intentTextClass}`}>{intentCopy.actionLabel}</p>
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="px-5 py-4 pb-[calc(var(--safe-bottom)+1.25rem)] sm:px-5 sm:py-4">
            {!isOnline && cards.length > 0 && (
              <p role="status" className="mb-3 flex items-center gap-2 rounded-2xl border border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                <WifiOff className="h-3.5 w-3.5 shrink-0" />
                You&apos;re offline. Showing saved cards and prices; your pick syncs when you reconnect.
              </p>
            )}
            {isLoading && cards.length === 0 ? (
              <div role="status" aria-label="Loading cards" className="grid grid-cols-3 gap-2 sm:gap-3 md:grid-cols-4 xl:grid-cols-5">
                {Array.from({ length: 6 }, (_, index) => (
                  <div key={index} aria-hidden="true" className="overflow-hidden rounded-xl bg-muted/40">
                    <div className="trading-card w-full animate-pulse bg-muted" />
                    <div className="space-y-1 p-1.5">
                      <div className="h-2.5 w-3/4 animate-pulse rounded bg-muted" />
                      <div className="h-2.5 w-1/2 animate-pulse rounded bg-muted" />
                    </div>
                  </div>
                ))}
                <span className="sr-only">Loading cards…</span>
              </div>
            ) : (error || cards.length === 0) ? (
              <div className="mx-auto flex max-w-xs flex-col items-center gap-3 py-10 text-center">
                {!isOnline && <WifiOff className="h-6 w-6 text-muted-foreground" />}
                <p className="text-sm font-semibold">
                  {!isOnline ? "You're offline" : error ? "Couldn't load cards" : `No cards found for ${pokemonName}`}
                </p>
                <p className="text-xs text-muted-foreground">
                  {!isOnline
                    ? "These cards haven't been saved on this device yet. Reconnect to load them, or mark the slot without a card."
                    : error
                      ? "Check your connection and try again, or mark the slot without a card."
                      : "You can still mark the slot without choosing a printing."}
                </p>
                <Button variant="outline" size="sm" className="h-10 rounded-2xl px-4" onClick={selectWithoutCard}>
                  {intentCopy.emptyActionLabel}
                </Button>
              </div>
            ) : filteredCards.length === 0 ? (
              <div className="mx-auto flex max-w-xs flex-col items-center gap-3 py-10 text-center">
                <p className="text-sm font-semibold">No cards match</p>
                <p className="text-xs text-muted-foreground">Try a different search or clear the filters.</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-10 rounded-2xl px-4"
                  onClick={() => {
                    resetFilters()
                    setFilters({})
                  }}
                >
                  Clear search and filters
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-3 sm:gap-3 md:grid-cols-4 xl:grid-cols-5">
                {displayedCards.map((card) => {
                  const price = pricesByCardId[getCardPriceKey(card.id, selectedCardLanguage)]
                  const priceLabels = getCardSelectorPriceLabels(price, formatAmount)
                  const isCurrent = matchesCatalogCardId(card, activeSelectedCardId)
                  const isWantedHere = !isWishlistMode && matchesCatalogCardId(card, selectedWantedCardId)

                  return (
                    <button
                      key={card.id}
                      type="button"
                      onClick={() => pickCard(card)}
                      aria-label={`${isWishlistMode ? "Want card" : "Add card"} ${card.name} from ${card.set.name}`}
                      className={`group/card relative flex flex-col justify-start overflow-hidden rounded-xl border-2 bg-card text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 sm:hover:scale-[1.03] ${
                        isCurrent ? intentSelectedCardClass : `border-transparent ${intentHoverCardClass}`
                      }`}
                    >
                      {scanRankById.has(card.id) && (
                        <div className="absolute left-2 top-2 z-10 rounded-full bg-black/80 px-2 py-1 text-[10px] font-medium text-white">
                          Match {scanRankById.get(card.id)}
                        </div>
                      )}
                      <div className="trading-card relative w-full bg-muted">
                        <CardSelectorImage
                          src={card.image}
                          alt={card.name}
                          className="absolute inset-0 h-full w-full object-cover bg-muted"
                        />
                        {isCurrent ? (
                          <div className={`absolute right-1.5 top-1.5 rounded-full border px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em] backdrop-blur ${intentCopy.activeClass}`}>
                            {intentCopy.currentLabel}
                          </div>
                        ) : isWantedHere ? (
                          <div className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded-full border border-amber-400/60 bg-black/70 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em] text-amber-300">
                            <Heart className="h-2.5 w-2.5 fill-current" />
                            Wanted
                          </div>
                        ) : (
                          <PriceRisingBadge price={price} className="absolute right-1.5 top-1.5" />
                        )}
                      </div>
                      <div className="p-1.5 sm:p-2">
                        <p className="truncate text-[10px] font-semibold text-foreground sm:text-xs">{card.set.name}</p>
                        {card.name.includes("(") && <p className="mt-0.5 text-[10px] text-foreground">{card.name}</p>}
                        <div className="mt-1 grid grid-cols-2 gap-1 text-[9px] font-semibold tabular-nums sm:text-[10px]">
                          <span className="rounded-md bg-muted px-1 py-0.5 text-emerald-600 dark:text-emerald-300">L {priceLabels.good ?? (isLoadingPrices ? "..." : "-")}</span>
                          <span className="rounded-md bg-muted px-1 py-0.5 text-foreground">M {priceLabels.market ?? (isLoadingPrices ? "..." : "-")}</span>
                        </div>
                        {(priceLabels.range || priceLabels.confidence) ? (
                          <p className="mt-1 truncate text-[9px] text-muted-foreground">
                            {[
                              priceLabels.range ? `R ${priceLabels.range}` : null,
                              priceLabels.confidence,
                            ].filter(Boolean).join(" · ")}
                          </p>
                        ) : null}
                        <div className="mt-1 flex items-center justify-between gap-1">
                          <p className="text-[9px] text-muted-foreground sm:text-[10px]">#{card.localId}</p>
                          <span aria-hidden="true" className={`flex items-center gap-0.5 text-[9px] font-bold uppercase sm:text-[10px] ${intentTextClass}`}>
                            {isWishlistMode ? <Heart className="h-2.5 w-2.5 fill-current" /> : <Check className="h-2.5 w-2.5" />}
                            {intentCopy.shortLabel}
                          </span>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
