"use client"

// The camera scanner (slot sweep and whole-page sweep). It only mounts while open and
// binder-app loads it with next/dynamic, so the capture and aggregation code stays out of
// the binder's first chunk. Matching and collection writes are passed in from binder-app,
// which shares them with the page-photo scan.
import { cropCanvasToCardGuide, delay, drawVideoCoverFrame } from "@/lib/camera-frame"
import { useState, useMemo, useEffect, useRef, useCallback, type Dispatch, type SetStateAction } from "react"
import { X, Camera, Loader2 } from "lucide-react"
import { useOverlay } from "@/hooks/use-overlay"
import { aggregateCardScanMatches, type AggregatedCardScanMatch, type CardScanFrameMatch } from "@/lib/card-scan-matching"
import type { useCollection } from "@/hooks/use-collection"
import type { TCGCard } from "@/hooks/use-tcgdex"
import { Button } from "@/components/ui/button"
import { scanBinderPageImage, type BinderPageScanResult } from "@/lib/binder-page-scan"
import { aggregateBinderPageScanResults, buildAggregatedBinderPageScanPreview } from "@/lib/binder-page-scan-aggregate"
import { aggregateBinderSlotSweep, getNextSweepSlotIndex, type BinderSlotSweepFrame } from "@/lib/binder-slot-sweep"
import { canAutoAcceptCardScanMatch } from "@/lib/card-scan-acceptance"
import type { CardScanImageCandidate } from "@/lib/card-scan-evidence"
import { TRADING_CARD_ASPECT_RATIO, getSlotLabel, type PageScanCardMatchSummary, type PageScanSummary } from "@/lib/page-scan"

const GUIDED_SCAN_FRAME_COUNT = 16
const GUIDED_SCAN_FRAME_DELAY_MS = 800
const GUIDED_SCAN_SLOT_VOTE_RATIO = 0.45
const GUIDED_SCAN_MIN_USABLE_FRAMES = 2
const SLOT_SWEEP_FRAME_COUNT = 8
const SLOT_SWEEP_FRAME_DELAY_MS = 360
const SLOT_SWEEP_MIN_USABLE_FRAMES = 2
const GUIDE_FRAME_INSET_X = 0.12
const GUIDE_FRAME_INSET_Y = 0.05
const SLOT_SWEEP_GUIDE_INSET_X = 0.14
const SLOT_SWEEP_GUIDE_INSET_Y = 0.08

type PageScannerMode = "slot-sweep" | "page-sweep"

async function canvasToFile(canvas: HTMLCanvasElement, index: number, prefix = "binder-scan") {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9))
  if (!blob) {
    throw new Error("Could not encode a camera frame.")
  }

  return new File([blob], `${prefix}-${index}.jpg`, { type: "image/jpeg" })
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
  const guidedCanvas = cropCanvasToCardGuide(canvas, { insetX: SLOT_SWEEP_GUIDE_INSET_X, insetY: SLOT_SWEEP_GUIDE_INSET_Y, aspectRatio: TRADING_CARD_ASPECT_RATIO, minWidth: 260, minHeight: 360, errorMessage: "Could not crop the slot scanner frame." })

  return {
    file: await canvasToFile(guidedCanvas, index, "binder-slot-sweep"),
    previewUrl: guidedCanvas.toDataURL("image/jpeg", 0.82),
  }
}

function getScannerOverlayLayout(result: BinderPageScanResult) {
  return result.slots.map((slot) => ({
    left: (slot.x / result.width) * 100,
    top: (slot.y / result.height) * 100,
    width: (slot.width / result.width) * 100,
    height: (slot.height / result.height) * 100,
    occupied: slot.occupied,
  }))
}

type CollectionApi = ReturnType<typeof useCollection>

export type PageScannerProps = {
  initialSlotIndex: number
  currentPageSlots: Array<{ id: number; name: string } | null>
  currentBinderPage: number
  binderRows: number
  binderCols: number
  readOnlyMode: boolean
  addToCollection: CollectionApi["addToCollection"]
  getCollectionItem: CollectionApi["getCollectionItem"]
  isCollected: CollectionApi["isCollected"]
  matchPageScanCards: (results: BinderPageScanResult[]) => Promise<PageScanCardMatchSummary[]>
  scorePageScanSlotCard: (cardImageDataUrl: string, pokemon: { id: number; name: string }) => Promise<CardScanFrameMatch<TCGCard>[]>
  getPageScanCardsForPokemon: (pokemonId: number) => Promise<TCGCard[]>
  rankPageSlotMatchesWithText: (
    matches: AggregatedCardScanMatch<TCGCard>[],
    cardImageCandidates?: CardScanImageCandidate[],
    candidateCards?: TCGCard[],
  ) => Promise<AggregatedCardScanMatch<TCGCard>[]>
  setIsScanningPage: (value: boolean) => void
  setPageScanSummary: Dispatch<SetStateAction<PageScanSummary | null>>
  setPageScanError: (value: string | null) => void
  onClose: () => void
}

export default function PageScanner({
  initialSlotIndex,
  currentPageSlots,
  currentBinderPage,
  binderRows,
  binderCols,
  readOnlyMode,
  addToCollection,
  getCollectionItem,
  isCollected,
  matchPageScanCards,
  scorePageScanSlotCard,
  getPageScanCardsForPokemon,
  rankPageSlotMatchesWithText,
  setIsScanningPage,
  setPageScanSummary,
  setPageScanError,
  onClose,
}: PageScannerProps) {
  const [pageScannerMode, setPageScannerMode] = useState<PageScannerMode>("slot-sweep")
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [isCameraReady, setIsCameraReady] = useState(false)
  const [isCapturingBurst, setIsCapturingBurst] = useState(false)
  const [isApplyingScanResults, setIsApplyingScanResults] = useState(false)
  const [burstFramesProcessed, setBurstFramesProcessed] = useState(0)
  const [burstUsableFrames, setBurstUsableFrames] = useState(0)
  const [burstPreviewResult, setBurstPreviewResult] = useState<BinderPageScanResult | null>(null)
  const [slotSweepSlotIndex, setSlotSweepSlotIndex] = useState(initialSlotIndex)
  const [slotSweepCompletedSlotIndexes, setSlotSweepCompletedSlotIndexes] = useState<number[]>([])
  const [slotSweepMatchedCards, setSlotSweepMatchedCards] = useState<PageScanCardMatchSummary[]>([])
  const [slotSweepPreviewUrl, setSlotSweepPreviewUrl] = useState<string | null>(null)
  const burstVideoRef = useRef<HTMLVideoElement | null>(null)
  const burstCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const cameraStreamRef = useRef<MediaStream | null>(null)
  const slotSweepCompletedSet = useMemo(
    () => new Set(slotSweepCompletedSlotIndexes),
    [slotSweepCompletedSlotIndexes],
  )
  const slotSweepTargetPokemon = currentPageSlots[slotSweepSlotIndex] ?? null
  const slotSweepTargetLabel = getSlotLabel(
    Math.floor(slotSweepSlotIndex / binderCols),
    slotSweepSlotIndex % binderCols,
  )
  const burstPreviewSlots = useMemo(
    () =>
      burstPreviewResult
        ? getScannerOverlayLayout(burstPreviewResult)
        : [],
    [burstPreviewResult],
  )

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
    onClose()
  }, [onClose])

  useEffect(() => {
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
  }, [])

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
    setIsScanningPage,
    setPageScanError,
    setPageScanSummary,
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
          detectedResult = await scanBinderPageImage(guidedFrame, binderRows, binderCols, {
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
    binderRows,
    readOnlyMode,
    binderCols,
    setIsScanningPage,
    setPageScanError,
    setPageScanSummary,
  ])

  const burstScannerRef = useRef<HTMLDivElement | null>(null)
  const closeBurstScannerSafely = useCallback(() => {
    if (isCapturingBurst || isApplyingScanResults) return
    closeBurstScanner()
  }, [closeBurstScanner, isApplyingScanResults, isCapturingBurst])
  useOverlay(true, closeBurstScannerSafely, { containerRef: burstScannerRef })

  return (
    <>
      <canvas ref={burstCanvasRef} className="hidden" />
      <div ref={burstScannerRef} role="dialog" aria-modal="true" aria-label="Page scanner" className="fixed inset-0 z-50 bg-black outline-none">
        <div className="mx-auto flex h-full w-full max-w-md flex-col px-3 pb-[calc(var(--safe-bottom)+0.75rem)] pt-[calc(var(--top-inset)+0.25rem)]">
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
                          {getSlotLabel(Math.floor(index / binderCols), index % binderCols)}
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
    </>
  )
}
