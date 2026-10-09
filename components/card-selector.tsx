"use client"

import { useState, useEffect, useMemo, useRef, useCallback } from "react"
import { useTCGdex, type TCGCard, type CardFilters, type CardLanguage } from "@/hooks/use-tcgdex"
import type { CardFinish } from "@/hooks/use-collection"
import { Button } from "@/components/ui/button"
import { useOverlay } from "@/hooks/use-overlay"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { getCardPriceKey, useCardPrices, type CardPriceSnapshot } from "@/hooks/use-card-prices"
import { getCardSelectorQuickActions } from "@/lib/card-selector-actions"
import { completeCardSelectorSelection } from "@/lib/card-selector-selection-flow"
import { buildCardImageDescriptor, compareCardImageDescriptors, type CardImageDescriptor } from "@/lib/card-image-match"
import { aggregateCardScanMatches, type AggregatedCardScanMatch, type CardScanFrameMatch } from "@/lib/card-scan-matching"
import { selectCandidateCardsForAssetTextOcr } from "@/lib/card-scan-candidate-text"
import { rankAggregatedCardScanMatchesWithText } from "@/lib/card-scan-ranking"
import { buildCardMetadataTextSignals, mergeCardTextSignals, type CardTextSignals } from "@/lib/card-scan-text"
import { X, Search, Check, Loader2, Camera, Languages, Heart } from "lucide-react"

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
}

type CardScanMatch = CardScanFrameMatch<TCGCard>

const ALL_FILTERS_VALUE = "__all__"
const CARD_LANGUAGES: Array<{ id: CardLanguage; label: string; shortLabel: string }> = [
  { id: "en", label: "English", shortLabel: "EN" },
  { id: "it", label: "Italian", shortLabel: "IT" },
  { id: "fr", label: "French", shortLabel: "FR" },
  { id: "de", label: "German", shortLabel: "DE" },
  { id: "es", label: "Spanish", shortLabel: "ES" },
  { id: "pt-br", label: "Portuguese", shortLabel: "PT" },
  { id: "ja", label: "Japanese", shortLabel: "JA" },
  { id: "ko", label: "Korean", shortLabel: "KO" },
]
const CARD_SCAN_FRAME_COUNT = 8
const CARD_SCAN_FRAME_DELAY_MS = 450
const CARD_SCAN_MIN_USABLE_FRAMES = 3
const CARD_SCAN_OCR_FRAME_LIMIT = 4
const CARD_SCAN_CANDIDATE_ASSET_OCR_LIMIT = 18
const CARD_GUIDE_INSET_X = 0.18
const CARD_GUIDE_INSET_Y = 0.1
const CARD_ASPECT_RATIO = 2.5 / 3.5
const CARD_FINISHES: Array<{ id: CardFinish; label: string }> = [
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

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function formatGbpAmount(amount: number | null | undefined) {
  return typeof amount === "number" && Number.isFinite(amount)
    ? new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 2 }).format(amount)
    : null
}

function getCardSelectorPriceLabels(price: CardPriceSnapshot | undefined) {
  const low = formatGbpAmount(price?.lowGbpAmount)
  const high = formatGbpAmount(price?.highGbpAmount)
  const confidence = price?.confidence && price.confidence !== "unknown"
    ? price.confidence.charAt(0).toUpperCase() + price.confidence.slice(1)
    : null

  return {
    good: formatGbpAmount(price?.goodGbpAmount),
    market: formatGbpAmount(price?.marketGbpAmount ?? price?.gbpAmount),
    range: low && high ? (low === high ? low : `${low}-${high}`) : low || high,
    confidence,
  }
}

async function canvasToFile(canvas: HTMLCanvasElement, index: number) {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92))
  if (!blob) {
    throw new Error("Could not encode the card scan frame.")
  }

  return new File([blob], `card-scan-${index}.jpg`, { type: "image/jpeg" })
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

function cropCanvasToCardGuide(sourceCanvas: HTMLCanvasElement) {
  const availableWidth = sourceCanvas.width * (1 - CARD_GUIDE_INSET_X * 2)
  const availableHeight = sourceCanvas.height * (1 - CARD_GUIDE_INSET_Y * 2)
  let cropWidth = availableWidth
  let cropHeight = cropWidth / CARD_ASPECT_RATIO

  if (cropHeight > availableHeight) {
    cropHeight = availableHeight
    cropWidth = cropHeight * CARD_ASPECT_RATIO
  }

  const cropX = Math.round((sourceCanvas.width - cropWidth) / 2)
  const cropY = Math.round((sourceCanvas.height - cropHeight) / 2)
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(220, Math.round(cropWidth))
  canvas.height = Math.max(300, Math.round(cropHeight))
  const context = canvas.getContext("2d")

  if (!context) {
    throw new Error("Could not crop the card guide frame.")
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

async function captureGuidedCardFrameFile(video: HTMLVideoElement, canvas: HTMLCanvasElement, index: number) {
  const previewWidth = Math.max(480, Math.round((video.clientWidth || 360) * 2))
  const previewHeight = Math.max(820, Math.round((video.clientHeight || 640) * 2))
  canvas.width = previewWidth
  canvas.height = previewHeight
  const context = canvas.getContext("2d")

  if (!context) {
    throw new Error("Could not capture the card scanner frame.")
  }

  drawVideoCoverFrame(video, context, previewWidth, previewHeight)
  const guidedCanvas = cropCanvasToCardGuide(canvas)

  return {
    file: await canvasToFile(guidedCanvas, index),
    previewUrl: guidedCanvas.toDataURL("image/jpeg", 0.82),
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

  useEffect(() => {
    setFailed(false)
  }, [src])

  if (!src || failed) {
    return (
      <div className={fallbackClassName}>
        <span className="text-xs text-muted-foreground">No Image</span>
      </div>
    )
  }

  return (
    <img
      src={src}
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
}: CardSelectorProps) {
  const { fetchCardsForPokemon, filterCards, isLoading, error } = useTCGdex()
  const [cards, setCards] = useState<TCGCard[]>([])
  const [filters, setFilters] = useState<CardFilters>({})
  const [selectedCardLanguage, setSelectedCardLanguage] = useState<CardLanguage>("en")
  const [selectionMode, setSelectionMode] = useState<CardSelectorMode>(mode)
  const [selectedFinish, setSelectedFinish] = useState<CardFinish>("normal")
  const [hasManuallySelectedFinish, setHasManuallySelectedFinish] = useState(false)
  const [isScanningCard, setIsScanningCard] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [scanPreviewUrl, setScanPreviewUrl] = useState<string | null>(null)
  const [scanMatches, setScanMatches] = useState<CardScanMatch[]>([])
  const [isCardScannerOpen, setIsCardScannerOpen] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [isCameraReady, setIsCameraReady] = useState(false)
  const [isCapturingCardScan, setIsCapturingCardScan] = useState(false)
  const [isApplyingCardResults, setIsApplyingCardResults] = useState(false)
  const [cardFramesProcessed, setCardFramesProcessed] = useState(0)
  const [cardUsableFrames, setCardUsableFrames] = useState(0)
  const [lastFramePreviewUrl, setLastFramePreviewUrl] = useState<string | null>(null)
  const descriptorCacheRef = useRef<Map<string, Promise<CardImageDescriptor | null>>>(new Map())
  const cardTextSignalCacheRef = useRef<Map<string, Promise<CardTextSignals>>>(new Map())
  const cameraStreamRef = useRef<MediaStream | null>(null)
  const cardVideoRef = useRef<HTMLVideoElement | null>(null)
  const cardCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const isWishlistMode = selectionMode === "wishlist"
  const activeSelectedCardId = isWishlistMode
    ? selectedWantedCardId ?? (mode === "wishlist" ? selectedCardId : undefined)
    : selectedCollectedCardId ?? (mode === "collect" ? selectedCardId : undefined)
  const selectedLanguageLabel = CARD_LANGUAGES.find((language) => language.id === selectedCardLanguage)?.label ?? "English"
  const priceLookups = useMemo(
    () => cards.map((card) => ({ cardId: card.id, language: selectedCardLanguage })),
    [cards, selectedCardLanguage],
  )
  const { pricesByCardId, isLoading: isLoadingPrices } = useCardPrices(priceLookups, cards.length > 0)
  const intentCopy = isWishlistMode
    ? {
        title: `Choose wanted card for ${pokemonName}`,
        label: "Wanted",
        shortLabel: "Want",
        actionLabel: "Track as wanted",
        scanLabel: "Scan wanted",
        emptyActionLabel: "Clear wanted card",
        helper: "Selecting a card keeps this slot open and tracks the printing you want to find.",
        searchPlaceholder: "Search wanted card, number, set...",
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
        helper: "Selecting a card marks the slot collected and attaches this printing to your binder.",
        searchPlaceholder: "Search card, number, set...",
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
  const activeFiltersCount = [filters.set, filters.rarity, filters.variant, filters.searchQuery].filter(Boolean).length

  const selectorQuickActions = useMemo(() => getCardSelectorQuickActions(selectionMode), [selectionMode])

  const selectCard = useCallback((card: TCGCard, selectedMode: CardSelectorMode = selectionMode) => {
    completeCardSelectorSelection({
      onClose,
      onSelect: () => onSelect({ ...card, language: selectedCardLanguage }, selectedMode, hasManuallySelectedFinish ? selectedFinish : inferCardFinish(card)),
    })
  }, [hasManuallySelectedFinish, onClose, onSelect, selectedCardLanguage, selectedFinish, selectionMode])

  const selectWithoutCard = useCallback(() => {
    completeCardSelectorSelection({
      onClose,
      onSelect: () => onSelect(null, selectionMode, selectedFinish),
    })
  }, [onClose, onSelect, selectedFinish, selectionMode])

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

  useEffect(() => {
    if (!isCardScannerOpen) {
      return
    }

    let cancelled = false
    const videoElement = cardVideoRef.current

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
        if (cardVideoRef.current) {
          cardVideoRef.current.srcObject = stream
          await cardVideoRef.current.play()
        }
        setIsCameraReady(true)
      } catch (cameraError) {
        setCameraError(cameraError instanceof Error ? cameraError.message : "Could not access the camera.")
      }
    }

    startCamera()

    return () => {
      cancelled = true
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop())
      cameraStreamRef.current = null
      if (videoElement) {
        videoElement.srcObject = null
      }
    }
  }, [isCardScannerOpen])

  const filteredCards = useMemo(() => filterCards(cards, filters), [cards, filters, filterCards])
  useEffect(() => {
    const selectedCard = cards.find((card) => card.id === activeSelectedCardId) ?? filteredCards[0]
    setSelectedFinish(selectedCard ? inferCardFinish(selectedCard) : "normal")
    setHasManuallySelectedFinish(false)
  }, [activeSelectedCardId, cards, filteredCards])
  const scanRankById = useMemo(() => {
    return new Map(scanMatches.map((match, index) => [match.card.id, index + 1]))
  }, [scanMatches])
  const displayedCards = useMemo(() => {
    if (scanRankById.size === 0) {
      return filteredCards
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
  }, [filteredCards, scanRankById])

  const uniqueSets = useMemo(() => {
    return [...new Map(cards.map((card) => [card.set.id, card.set])).values()]
      .filter((set) => Boolean(set.id))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [cards])

  const uniqueRarities = useMemo(() => {
    return [...new Set(cards.map((c) => c.rarity).filter(Boolean))] as string[]
  }, [cards])

  const hasActiveFilters = Boolean(filters.set || filters.rarity || filters.variant || filters.searchQuery)

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
    setIsCameraReady(false)
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
        const frame = await captureGuidedCardFrameFile(video, canvas, index)
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
          <div className="mx-auto flex h-full w-full max-w-md flex-col px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-[calc(env(safe-area-inset-top)+0.75rem)]">
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

      <div data-overlay-backdrop className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <div
        ref={selectorDialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Card selector"
        className="fixed inset-x-0 z-50 flex flex-col outline-none overflow-hidden rounded-t-[2.25rem] border border-border bg-card shadow-[0_-28px_80px_-42px_rgba(0,0,0,0.75)] sm:inset-x-3 sm:rounded-[2.25rem] lg:inset-x-8 xl:left-1/2 xl:right-auto xl:w-[min(calc(100vw-4rem),92rem)] xl:-translate-x-1/2"
        onClick={(e) => e.stopPropagation()}
        style={{
          top: "calc(env(safe-area-inset-top) + 1rem)",
          bottom: "calc(env(safe-area-inset-bottom) + 0.25rem)",
          overscrollBehaviorY: "contain",
          touchAction: "pan-y",
        }}
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="z-20 shrink-0 border-b border-border bg-card/96 px-4 py-3 backdrop-blur-xl sm:px-5">
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-muted-foreground/30 sm:hidden" />
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] ${intentCopy.accentClass}`}>
                    {intentCopy.label}
                  </span>
                  <span className="text-[11px] text-muted-foreground sm:text-xs">
                    {filteredCards.length} of {cards.length} cards
                  </span>
                </div>
                <h2 className="mt-2 truncate text-base font-semibold leading-tight tracking-normal sm:text-lg">
                  {intentCopy.title}
                </h2>
                <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground sm:max-w-2xl sm:text-xs">
                  {intentCopy.helper}
                </p>
              </div>
              <Button variant="ghost" size="icon" className="mr-0.5 h-9 w-9 shrink-0 rounded-full" onClick={onClose} aria-label="Close card selector">
                <X className="h-4 w-4 sm:h-5 sm:w-5" />
              </Button>
            </div>

            <div className="mt-3 grid grid-cols-2 rounded-2xl border border-border/60 bg-background/70 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] dark:border-white/10 dark:bg-white/[0.04] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
              <button
                type="button"
                aria-pressed={selectionMode === "collect"}
                onClick={() => setSelectionMode("collect")}
                className={`flex h-11 min-w-0 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold transition-all ${
                  selectionMode === "collect"
                    ? "border border-emerald-400/50 bg-emerald-400/14 text-emerald-300 shadow-[0_10px_24px_-18px_rgba(52,211,153,0.85)]"
                    : "text-muted-foreground hover:bg-background/70 hover:text-foreground dark:hover:bg-white/[0.06]"
                }`}
              >
                <Check className="h-4 w-4" />
                <span>Add card</span>
              </button>
              <button
                type="button"
                aria-pressed={selectionMode === "wishlist"}
                onClick={() => setSelectionMode("wishlist")}
                className={`flex h-11 min-w-0 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold transition-all ${
                  selectionMode === "wishlist"
                    ? "border border-amber-400/55 bg-amber-400/15 text-amber-300 shadow-[0_10px_24px_-18px_rgba(251,191,36,0.85)]"
                    : "text-muted-foreground hover:bg-background/70 hover:text-foreground dark:hover:bg-white/[0.06]"
                }`}
              >
                <Heart className={`h-4 w-4 ${selectionMode === "wishlist" ? "fill-current" : ""}`} />
                <span>Wanted</span>
              </button>
            </div>

            <div className="mt-3 flex items-center gap-2 overflow-x-auto px-1 scrollbar-hide sm:flex-wrap sm:gap-2 sm:px-0">
              <Button
                variant="secondary"
                size="sm"
                className="h-8 shrink-0 gap-1.5 rounded-full px-3 text-[12px] sm:h-9 sm:rounded-2xl sm:px-3"
                onClick={openCardScanner}
                disabled={isLoading || cards.length === 0 || isScanningCard}
              >
                {isScanningCard ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                <span>{intentCopy.scanLabel}</span>
              </Button>
              <Button variant="outline" size="sm" className="h-8 shrink-0 rounded-full px-3 text-[12px] sm:h-9 sm:rounded-2xl sm:px-3" onClick={selectWithoutCard}>
                {intentCopy.emptyActionLabel}
              </Button>
              <div className="flex shrink-0 items-center gap-2 rounded-full border border-border/60 bg-background/70 px-3 py-1.5 text-[12px] text-muted-foreground sm:rounded-2xl">
                <Languages className="h-3.5 w-3.5" />
                <span>{selectedLanguageLabel}</span>
              </div>
            </div>

            <div className="mt-3 flex items-center gap-2 overflow-x-auto px-1 scrollbar-hide sm:flex-wrap sm:px-0">
              {CARD_FINISHES.map((finish) => (
                <button
                  key={finish.id}
                  type="button"
                  aria-pressed={selectedFinish === finish.id}
                  onClick={() => {
                    setSelectedFinish(finish.id)
                    setHasManuallySelectedFinish(true)
                  }}
                  className={`shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                    selectedFinish === finish.id
                      ? "border-primary/40 bg-primary/12 text-primary"
                      : "border-border/50 bg-background/65 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {finish.label}
                </button>
              ))}
            </div>
          </div>

          <div
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
            style={{
              WebkitOverflowScrolling: "touch",
              touchAction: "pan-y",
            }}
          >
            <div className="border-b border-border bg-muted/15 px-4 py-3 sm:px-5 sm:py-4">
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Search className="h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder={intentCopy.searchPlaceholder}
                    value={filters.searchQuery || ""}
                    onChange={(e) => setFilters((f) => ({ ...f, searchQuery: e.target.value }))}
                    className="h-11 flex-1 rounded-2xl bg-background/85 text-sm shadow-none"
                  />
                </div>
                <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
                  {CARD_LANGUAGES.map((language) => {
                    const isSelected = selectedCardLanguage === language.id

                    return (
                      <button
                        key={language.id}
                        type="button"
                        onClick={() => setSelectedCardLanguage(language.id)}
                        className={`shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                          isSelected
                            ? "border-primary/40 bg-primary/12 text-primary"
                            : "border-border/50 bg-background/65 text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <span className="sm:hidden">{language.shortLabel}</span>
                        <span className="hidden sm:inline">{language.label}</span>
                      </button>
                    )
                  })}
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Card art stays on the English print, but pricing is refreshed for the selected card language.
                </p>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-2 sm:gap-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
                  <Select
                    value={filters.set || ALL_FILTERS_VALUE}
                    onValueChange={(value) => setFilters((f) => ({ ...f, set: value === ALL_FILTERS_VALUE ? undefined : value }))}
                  >
                    <SelectTrigger className="h-9 w-full rounded-2xl bg-background/80 px-3 text-left text-xs shadow-none sm:h-10 sm:text-sm">
                      <SelectValue placeholder="All Sets" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_FILTERS_VALUE}>All Sets</SelectItem>
                      {uniqueSets.map((set) => (
                        <SelectItem key={set.id} value={set.id}>
                          {set.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={filters.rarity || ALL_FILTERS_VALUE}
                    onValueChange={(value) =>
                      setFilters((f) => ({ ...f, rarity: value === ALL_FILTERS_VALUE ? undefined : value }))
                    }
                  >
                    <SelectTrigger className="h-9 w-full rounded-2xl bg-background/80 px-3 text-left text-xs shadow-none sm:h-10 sm:text-sm">
                      <SelectValue placeholder="All Rarities" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_FILTERS_VALUE}>All Rarities</SelectItem>
                      {uniqueRarities.map((rarity) => (
                        <SelectItem key={rarity} value={rarity}>
                          {rarity}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={filters.variant || ALL_FILTERS_VALUE}
                    onValueChange={(value) =>
                      setFilters((f) => ({ ...f, variant: value === ALL_FILTERS_VALUE ? undefined : value }))
                    }
                  >
                    <SelectTrigger className="h-9 w-full rounded-2xl bg-background/80 px-3 text-left text-xs shadow-none sm:h-10 sm:text-sm">
                      <SelectValue placeholder="All Variants" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_FILTERS_VALUE}>All Variants</SelectItem>
                      <SelectItem value="normal">Normal</SelectItem>
                      <SelectItem value="holo">Holo</SelectItem>
                      <SelectItem value="reverse">Reverse Holo</SelectItem>
                      <SelectItem value="firstEdition">1st Edition</SelectItem>
                    </SelectContent>
                  </Select>
                  {hasActiveFilters && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setFilters({})}
                      className="h-9 rounded-2xl px-3 text-xs text-muted-foreground sm:h-10 sm:px-4 sm:text-sm"
                    >
                      Clear {activeFiltersCount}
                    </Button>
                  )}
                </div>
              </div>
            </div>

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
                          const priceLabels = getCardSelectorPriceLabels(price)

                          return (
                            <button
                              key={match.card.id}
                              onClick={() => selectCard(match.card)}
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

            <div className="px-5 py-4 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] sm:px-5 sm:py-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <span className="ml-2 text-muted-foreground">Loading cards...</span>
              </div>
            ) : error ? (
              <div className="text-center py-12 text-destructive">{error}</div>
            ) : filteredCards.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                {cards.length === 0 ? "No cards found for this Pokemon" : "No cards match your filters"}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-3 sm:gap-3 md:grid-cols-4 xl:grid-cols-5">
                {displayedCards.map((card) => {
                  const price = pricesByCardId[getCardPriceKey(card.id, selectedCardLanguage)]
                  const priceLabels = getCardSelectorPriceLabels(price)

                  return (
                    <div
                      key={card.id}
                      className={`relative group/card overflow-hidden rounded-xl border-2 bg-card text-left transition-all sm:hover:scale-[1.03] ${
                        activeSelectedCardId === card.id ? intentSelectedCardClass : `border-transparent ${intentHoverCardClass}`
                      }`}
                    >
                      {scanRankById.has(card.id) && (
                        <div className="absolute left-2 top-2 z-10 rounded-full bg-black/80 px-2 py-1 text-[10px] font-medium text-white">
                          Match {scanRankById.get(card.id)}
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => selectCard(card)}
                        className="block w-full bg-card p-0 text-left"
                      >
                        <div className="relative aspect-[2.5/3.5] w-full overflow-hidden rounded-[10px] bg-muted sm:rounded-none">
                          <CardSelectorImage
                            src={card.image}
                            alt={card.name}
                            className="absolute inset-0 h-full w-full object-cover bg-muted"
                          />
                          {activeSelectedCardId === card.id && (
                            <div className={`absolute right-2 top-2 rounded-full border px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em] backdrop-blur ${intentCopy.activeClass}`}>
                              {intentCopy.currentLabel}
                            </div>
                          )}
                          <div className="absolute inset-x-0 bottom-0 hidden bg-gradient-to-t from-black/90 via-black/68 to-transparent p-2 sm:block">
                            <p className="truncate text-xs font-medium text-white">{card.set.name}</p>
                            <div className="mt-1 grid grid-cols-2 gap-1 text-[9px] font-semibold tabular-nums">
                              <span className="rounded-md bg-black/50 px-1.5 py-0.5 text-emerald-200">L {priceLabels.good ?? (isLoadingPrices ? "..." : "-")}</span>
                              <span className="rounded-md bg-black/50 px-1.5 py-0.5 text-white">M {priceLabels.market ?? (isLoadingPrices ? "..." : "-")}</span>
                            </div>
                            {(priceLabels.range || priceLabels.confidence) ? (
                              <p className="mt-1 truncate text-[9px] font-medium text-white/66">
                                {[
                                  priceLabels.range ? `R ${priceLabels.range}` : null,
                                  priceLabels.confidence ? priceLabels.confidence : null,
                                ].filter(Boolean).join(" · ")}
                              </p>
                            ) : null}
                            <div className="mt-1 flex items-center justify-between gap-2">
                              <p className="text-[10px] text-white/70">#{card.localId}</p>
                              <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-white/58">{intentCopy.shortLabel} mode</p>
                            </div>
                          </div>
                        </div>

                        <div className="p-1.5 sm:hidden">
                          <p className="truncate text-[10px] font-semibold text-foreground">{card.set.name}</p>
                          <div className="mt-1 grid grid-cols-2 gap-1 text-[9px] font-semibold tabular-nums">
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
                          <div className="mt-0.5 flex items-center justify-between gap-1">
                            <p className="text-[9px] text-muted-foreground">#{card.localId}</p>
                            <p className={`text-[9px] font-semibold uppercase ${intentTextClass}`}>{intentCopy.shortLabel}</p>
                          </div>
                        </div>
                      </button>
                      <div className="grid grid-cols-2 gap-1.5 p-1.5 pt-0 sm:pointer-events-none sm:absolute sm:inset-x-2 sm:bottom-2 sm:z-20 sm:translate-y-1 sm:p-0 sm:opacity-0 sm:transition-all sm:duration-150 sm:group-hover/card:pointer-events-auto sm:group-hover/card:translate-y-0 sm:group-hover/card:opacity-100 sm:group-focus-within/card:pointer-events-auto sm:group-focus-within/card:translate-y-0 sm:group-focus-within/card:opacity-100">
                        {selectorQuickActions.map((action) => (
                          <button
                            key={action.mode}
                            type="button"
                            onClick={() => selectCard(card, action.mode)}
                            aria-label={`${action.accessibleLabel} ${card.name} from ${card.set.name}`}
                            className={`flex h-8 min-w-0 items-center justify-center gap-1 rounded-lg border px-2 text-[10px] font-bold uppercase tracking-[0.08em] shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 sm:h-9 sm:rounded-xl sm:backdrop-blur ${
                              action.mode === "collect"
                                ? action.isPrimary
                                  ? "border-emerald-300/55 bg-emerald-500 text-white hover:bg-emerald-400"
                                  : "border-emerald-400/35 bg-emerald-500/12 text-emerald-700 hover:bg-emerald-500/18 dark:text-emerald-200 sm:bg-black/58 sm:text-emerald-200 sm:hover:bg-emerald-500/32"
                                : action.isPrimary
                                  ? "border-amber-300/55 bg-amber-500 text-white hover:bg-amber-400"
                                  : "border-amber-400/35 bg-amber-500/12 text-amber-700 hover:bg-amber-500/18 dark:text-amber-200 sm:bg-black/58 sm:text-amber-200 sm:hover:bg-amber-500/32"
                            }`}
                          >
                            {action.mode === "collect" ? (
                              <Check className="h-3 w-3 shrink-0" />
                            ) : (
                              <Heart className="h-3 w-3 shrink-0 fill-current" />
                            )}
                            <span className="truncate">{action.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
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
