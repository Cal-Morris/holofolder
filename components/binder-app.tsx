"use client"

import { useState, useMemo, useEffect, useRef, useCallback } from "react"
import { Moon, Sun, Settings, LogIn, LogOut, Grid3X3, Search as SearchIcon, ChevronLeft, ChevronRight, Users, Sparkles, Check, X, ChevronsLeft, ChevronsRight, Star, HelpCircle, Camera, Loader2 } from "lucide-react"
import PokemonSearch from "@/components/pokemon-search"
import SettingsModal from "@/components/settings-modal"
import AuthModal from "@/components/auth-modal"
import PartnerModal from "@/components/partner-modal"
import CardSelector from "@/components/card-selector"
import { useCollection, type SlotStatus } from "@/hooks/use-collection"
import { useSettings, type BinderSettings } from "@/hooks/use-settings"
import { useTouchGestures } from "@/hooks/use-touch-gestures"
import { Button } from "@/components/ui/button"
import { scanBinderPageImage, type BinderPageScanResult } from "@/lib/binder-page-scan"
import { POKEMON_CATALOG, getPokemonSummary, type PokemonSummary } from "@/lib/pokemon-catalog"
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
const GUIDED_SCAN_FRAME_COUNT = 16
const GUIDED_SCAN_FRAME_DELAY_MS = 800
const GUIDED_SCAN_SLOT_VOTE_RATIO = 0.6
const GUIDED_SCAN_MIN_USABLE_FRAMES = 2
const GUIDE_FRAME_INSET_X = 0.12
const GUIDE_FRAME_INSET_Y = 0.05
const BINDER_PAGE_QUERY_PARAM = "page"

type ViewMode = "search" | "browse"
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

interface InitialCollectionRow {
  id: string
  pokemon_id: number
  pokemon_name: string
  card_id?: string
  card_name?: string
  card_image?: string
  card_set?: string
  status: SlotStatus
  collected_at: string
}

interface BinderAppProps {
  initialUser: User | null
  initialCollection: InitialCollectionRow[]
  initialSettings: BinderSettings
  initialDarkMode: boolean
}

function getPokemonArtwork(pokemon: PokemonSummary) {
  return pokemon.sprites.other["official-artwork"].front_default
}

function getDisplayArtwork(pokemon: PokemonSummary, cardImage?: string | null) {
  return cardImage || getPokemonArtwork(pokemon)
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

export default function BinderApp({ initialUser, initialCollection, initialSettings, initialDarkMode }: BinderAppProps) {
  const [selectedPokemon, setSelectedPokemon] = useState<PokemonSummary | null>(null)
  const [isDarkMode, setIsDarkMode] = useState(initialDarkMode)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isAuthOpen, setIsAuthOpen] = useState(false)
  const [isPartnerOpen, setIsPartnerOpen] = useState(false)
  const [isCardSelectorOpen, setIsCardSelectorOpen] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>("browse")
  const [selectedGen, setSelectedGen] = useState(0)
  const [currentBinderPage, setCurrentBinderPage] = useState(1)
  const [showCollectedOnly, setShowCollectedOnly] = useState(false)
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
  const pagePhotoInputRef = useRef<HTMLInputElement | null>(null)
  const burstVideoRef = useRef<HTMLVideoElement | null>(null)
  const burstCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const cameraStreamRef = useRef<MediaStream | null>(null)
  const hasHydratedPageFromQueryRef = useRef(false)

  const pokemonList = POKEMON_CATALOG
  const {
    user,
    isCollected,
    addToCollection,
    removeFromCollection,
    cycleStatus,
    collectionCount,
    signOut,
    isLoading: isCollectionLoading,
    getCollectionItem,
    collection,
    syncLocalCollectionToDatabase,
    localCollectedCount,
  } = useCollection({ initialUser, initialCollection })
  const { settings, updateSettings } = useSettings({ initialSettings, initialUser })

  const slotsPerPage = settings.binderRows * settings.binderCols
  const binderPageAspectRatio = (settings.binderCols * TRADING_CARD_ASPECT_RATIO) / settings.binderRows

  const filteredPokemonList = useMemo(() => {
    let list = pokemonList

    if (selectedGen !== 0) {
      const gen = GENERATIONS[selectedGen]
      list = list.filter(p => p.id >= gen.start && p.id <= gen.end)
    }

    if (showCollectedOnly) {
      const collectedIds = new Set(collection.map(c => c.pokemon_id))
      list = list.filter(p => collectedIds.has(p.id))
    }

    return list
  }, [pokemonList, selectedGen, showCollectedOnly, collection])

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
    setPageScanSummary(null)
    setPageScanError(null)
  }, [currentBinderPage, selectedGen, showCollectedOnly, settings.binderRows, settings.binderCols])

  useEffect(() => {
    setLocalCollectionSyncMessage(null)
  }, [user])

  const currentPageSlots = useMemo(() => {
    const startIdx = (currentBinderPage - 1) * slotsPerPage
    return Array.from({ length: slotsPerPage }, (_, slotIndex) => {
      const pokemon = pokemonList[startIdx + slotIndex]
      if (!pokemon) return null
      return filteredPokemonIds.has(pokemon.id) ? pokemon : null
    })
  }, [pokemonList, filteredPokemonIds, currentBinderPage, slotsPerPage])

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

  const { ref: binderRef, isSwiping, didSwipe } = useTouchGestures<HTMLDivElement>({
    onSwipeLeft: goToNextPage,
    onSwipeRight: goToPrevPage,
    swipeThreshold: 60,
  })

  const handleToggleCollected = async () => {
    if (!selectedPokemon) return

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

    if (!user) {
      setIsAuthOpen(true)
      return
    }

    setIsCardSelectorOpen(true)
  }

  const handleQuickCollectSelectedPokemon = async () => {
    if (!selectedPokemon) return
    await handleQuickCollect({ id: selectedPokemon.id, name: selectedPokemon.name })
  }

  const handleRemoveSelectedPokemon = async () => {
    if (!selectedPokemon) return

    if (!user) {
      setIsAuthOpen(true)
      return
    }

    await removeFromCollection(selectedPokemon.id)
  }

  const handleQuickCollect = async (pokemon: { id: number; name: string }) => {
    if (!user) {
      setIsAuthOpen(true)
      return
    }

    if (isCollected(pokemon.id)) {
      await removeFromCollection(pokemon.id)
    } else {
      await addToCollection(pokemon.id, pokemon.name)
    }
    setLongPressedPokemon(null)
  }

  const handleCardSelected = async (card: any | null) => {
    if (!selectedPokemon) return
    await addToCollection(
      selectedPokemon.id,
      selectedPokemon.name,
      card?.id,
      card?.name,
      card?.image,
      card?.set?.name
    )
    setIsCardSelectorOpen(false)
  }

  const handleSyncLocalCollectionToCloud = async () => {
    if (!user) {
      setIsAuthOpen(true)
      return
    }

    const confirmed = window.confirm(
      "Replace your cloud collection with the local collected state from this device? This removes anything that is only in the cloud."
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
        `Cloud collection replaced from local: ${result.data.localCount} local collected, ${result.data.added} added, ${result.data.removed} removed.`
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
    setLongPressedPokemon(pokemon)
    if (navigator.vibrate) {
      navigator.vibrate(30)
    }
  }

  const handlePhotoButtonClick = () => {
    if (!user) {
      setIsAuthOpen(true)
      return
    }

    if (showCollectedOnly) {
      setPageScanError("Turn off the collected-only filter before scanning a page photo.")
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

    if (!user) {
      setIsAuthOpen(true)
      return
    }

    if (showCollectedOnly) {
      setPageScanError("Turn off the collected-only filter before scanning a page photo.")
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
    showCollectedOnly,
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

    if (!video || !canvas || !isCameraReady || isCapturingBurst) {
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
    settings.binderCols,
  ])

  const toggleDarkMode = () => {
    const next = !isDarkMode
    setIsDarkMode(next)
    document.documentElement.classList.toggle("dark", next)
    const maxAge = 60 * 60 * 24 * 365
    document.cookie = `binderdex_theme=${next ? "dark" : "light"}; path=/; max-age=${maxAge}; samesite=lax`
  }

  const collected = selectedPokemon ? isCollected(selectedPokemon.id) : false
  const collectionItem = selectedPokemon ? getCollectionItem(selectedPokemon.id) : null
  const selectedPokemonHasAssignedCard = Boolean(collectionItem?.card_id)
  const selectedPokemonDisplayImage = selectedPokemon ? getDisplayArtwork(selectedPokemon, collectionItem?.card_image) : null

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (viewMode !== "browse") return
      if (e.key === "ArrowLeft") goToPrevPage()
      if (e.key === "ArrowRight") goToNextPage()
      if (e.key === "Escape") {
        setSelectedPokemon(null)
        setLongPressedPokemon(null)
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [viewMode, goToPrevPage, goToNextPage])

  useEffect(() => {
    if (longPressedPokemon) {
      const handleClick = () => setLongPressedPokemon(null)
      setTimeout(() => window.addEventListener("click", handleClick), 0)
      return () => window.removeEventListener("click", handleClick)
    }
  }, [longPressedPokemon])

  return (
    <main className="min-h-screen bg-background select-none md:h-screen md:overflow-hidden">
      {/* Glass Navigation */}
      <nav className="sticky top-0 z-40 px-2.5 sm:px-4 pt-[calc(env(safe-area-inset-top)+0.9rem)] mb-3">
        <div className="max-w-7xl mx-auto">
          <div className="rounded-2xl border border-border/50 bg-background/88 shadow-xl shadow-black/5 backdrop-blur-xl">
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
              {user && (
                <div className="hidden md:flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2 py-1">
                  <span className="text-xs font-bold text-primary tabular-nums">{collectionCount}</span>
                  <span className="text-[10px] text-primary/70">owned</span>
                </div>
              )}

              {user ? (
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

              <div className="mx-0.5 h-4 w-px bg-border/50" />

              <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full" onClick={() => setIsSettingsOpen(true)}>
                <Settings className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full" onClick={toggleDarkMode}>
                {isDarkMode ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>

          <div className="border-t border-border/40 px-2 py-1.5">
            <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide whitespace-nowrap">
              <div className="flex shrink-0 bg-muted/40 rounded-xl p-0.5 border border-border/30">
                <button
                  onClick={() => setViewMode("search")}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
                    viewMode === "search" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <SearchIcon className="h-3 w-3" />
                  <span>Search</span>
                </button>
                <button
                  onClick={() => setViewMode("browse")}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
                    viewMode === "browse" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Grid3X3 className="h-3 w-3" />
                  <span>Binder</span>
                </button>
              </div>

              <div className="flex shrink-0 items-center rounded-xl border border-border/30 bg-muted/35 px-1">
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

              {user && (
                <>
                  <button
                    onClick={() => setShowCollectedOnly(!showCollectedOnly)}
                    className={`flex shrink-0 items-center gap-1 rounded-xl border px-2.5 py-1 text-[11px] font-medium transition-all ${
                      showCollectedOnly
                        ? "bg-green-500/10 border-green-500/30 text-green-500"
                        : "bg-muted/35 border-border/30 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Check className="h-3 w-3" />
                    <span>{showCollectedOnly ? "Collected" : "All Cards"}</span>
                  </button>

                  <div className="flex shrink-0 items-center gap-1.5 rounded-xl border border-border/30 bg-muted/35 px-2.5 py-1 text-[10px] font-medium text-muted-foreground tabular-nums">
                    <span>{collectionStats.percentage}%</span>
                    <span className="text-border/80">•</span>
                    <span>{collectionStats.collected}/{collectionStats.total}</span>
                  </div>
                </>
              )}
            </div>
          </div>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-3 sm:px-4 pb-28 md:h-full md:min-h-0 md:flex md:flex-col md:pb-16">
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

        {/* Search View */}
        {viewMode === "search" && (
          <div className="space-y-4 animate-fade-in md:min-h-0 md:flex-1 md:overflow-y-auto md:pb-2">
            <PokemonSearch onSelect={handlePokemonSelect} pokemonList={filteredPokemonList} />

            {selectedPokemon && (
              <div className="bg-card border border-border/50 rounded-2xl p-4 shadow-xl animate-scale-in">
                <div className="flex items-center gap-3">
                  <div className="relative w-20 h-20 rounded-xl bg-gradient-to-br from-muted to-muted/30 flex items-center justify-center shrink-0">
                    <img
                      src={selectedPokemonDisplayImage || getPokemonArtwork(selectedPokemon)}
                      alt={selectedPokemon.name}
                      className="w-16 h-16 object-contain"
                    />
                    {collected && (
                      <div className="absolute -top-1 -right-1 w-5 h-5 bg-green-500 rounded-full flex items-center justify-center border-2 border-background shadow-lg">
                        <Check className="w-3 h-3 text-white" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-muted-foreground font-semibold">#{String(selectedPokemon.id).padStart(4, "0")}</p>
                    <h2 className="text-xl font-bold capitalize truncate">{selectedPokemon.name}</h2>
                    {collectionItem?.card_name && (
                      <p className="text-xs text-primary mt-0.5 truncate">{collectionItem.card_name}</p>
                    )}
                    {collected && !collectionItem?.card_name && (
                      <p className="text-xs text-muted-foreground mt-0.5">Owned, no card assigned</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {!collected && (
                      <Button
                        onClick={handleQuickCollectSelectedPokemon}
                        disabled={isCollectionLoading}
                        variant="outline"
                        size="sm"
                      >
                        Mark owned
                      </Button>
                    )}
                    <Button
                      onClick={collected ? handleOpenCardSelector : handleToggleCollected}
                      disabled={isCollectionLoading}
                      variant={collected ? "default" : "outline"}
                      size="sm"
                      className="gap-1.5"
                    >
                      {collected ? <Check className="w-3.5 h-3.5" /> : null}
                      {collected
                        ? selectedPokemonHasAssignedCard
                          ? "Change card"
                          : "Add card"
                        : user
                          ? "Pick card"
                          : "Sign in"}
                    </Button>
                    {collected && (
                      <Button
                        onClick={handleRemoveSelectedPokemon}
                        disabled={isCollectionLoading}
                        variant="outline"
                        size="sm"
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                </div>
                <p className="mt-3 text-[11px] text-muted-foreground">
                  Mark owned saves it instantly. Pick card lets you assign the exact TCG printing.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Binder View */}
        {viewMode === "browse" && (
          <div className="space-y-3 animate-fade-in md:min-h-0 md:flex md:flex-1 md:flex-col">
            {/* Page Navigation - Compact */}
            <div className="flex items-center justify-between shrink-0">
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigateToPage(1, "right")} disabled={currentBinderPage === 1}>
                  <ChevronsLeft className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={goToPrevPage} disabled={currentBinderPage === 1}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={totalBinderPages}
                  value={currentBinderPage}
                  onChange={(e) => {
                    const page = parseInt(e.target.value)
                    if (page >= 1 && page <= totalBinderPages) {
                      setCurrentBinderPage(page)
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
                  className="mr-1 gap-1.5 h-8 px-2.5"
                  onClick={handlePhotoButtonClick}
                  disabled={isScanningPage || showCollectedOnly || currentPagePokemon.length === 0}
                >
                  {isScanningPage ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
                  <span className="hidden sm:inline">{isScanningPage ? "Scanning" : "Scan Page"}</span>
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={goToNextPage} disabled={currentBinderPage === totalBinderPages}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigateToPage(totalBinderPages, "left")} disabled={currentBinderPage === totalBinderPages}>
                  <ChevronsRight className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {(pageScanSummary || pageScanError || showCollectedOnly) && (
              <div className="rounded-xl border border-border/50 bg-card/70 px-3 py-2 text-xs text-muted-foreground">
                {pageScanError ? (
                  <p>{pageScanError}</p>
                ) : pageScanSummary ? (
                  <p>
                    Page {pageScanSummary.page}: detected {pageScanSummary.detectedOccupied} occupied slot{pageScanSummary.detectedOccupied === 1 ? "" : "s"}, added {pageScanSummary.newCollected} new card{pageScanSummary.newCollected === 1 ? "" : "s"}
                    {pageScanSummary.alreadyCollected > 0 ? `, ${pageScanSummary.alreadyCollected} already collected` : ""}.
                  </p>
                ) : (
                  <p>Scanning is disabled while the collected-only filter is on, because those pages no longer match your binder layout.</p>
                )}
                <p className="mt-1 text-[11px] text-muted-foreground/80">
                  The scanner checks slot occupancy from the page photo. Fill the frame with one page and keep the pockets sharp.
                </p>
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
                  aspectRatio: String(binderPageAspectRatio),
                  overscrollBehaviorX: "contain",
                }}
              >
                <div className="absolute inset-0 bg-gradient-to-br from-card via-card to-card/80 rounded-2xl border border-border/50 shadow-2xl -z-10" />
                <div className="absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent rounded-2xl -z-10" />

                <div
                  className="absolute inset-0 p-3 sm:p-4"
                  style={{
                    display: "grid",
                    gridTemplateColumns: `repeat(${settings.binderCols}, minmax(0, 1fr))`,
                    gridTemplateRows: `repeat(${settings.binderRows}, minmax(0, 1fr))`,
                    gap: "0.375rem",
                  }}
                >
                  {currentPageSlots.map((pokemon, index) => {
                    const row = Math.floor(index / settings.binderCols)
                    const col = index % settings.binderCols
                    const rowLetter = String.fromCharCode(65 + row)
                    const slotLabel = `${rowLetter}${col + 1}`

                    if (!pokemon) {
                      return (
                        <div key={`slot-${currentBinderPage}-${index}`} className="h-full w-full rounded-xl border border-dashed border-border/20 bg-muted/5" />
                      )
                    }

                    const isCurrentCollected = isCollected(pokemon.id)
                    const isSelected = selectedPokemon?.id === pokemon.id
                    const isLongPressed = longPressedPokemon?.id === pokemon.id
                    const item = getCollectionItem(pokemon.id)

                    return (
                      <PokemonSlot
                        key={pokemon.id}
                        pokemon={pokemon}
                        isCollected={isCurrentCollected}
                        isSelected={isSelected}
                        isLongPressed={isLongPressed}
                        slotLabel={slotLabel}
                        status={item?.status}
                        cardImage={item?.card_image}
                        onClick={() => handleSlotClick(pokemon)}
                        onLongPress={() => handleLongPress(pokemon)}
                        onQuickCollect={() => handleQuickCollect(pokemon)}
                        onCycleStatus={() => cycleStatus(pokemon.id)}
                        user={user}
                        priority={currentBinderPage === 1}
                      />
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Page Info Footer */}
            <div className="flex flex-col items-center justify-center gap-1 text-[10px] text-muted-foreground/70 shrink-0">
              <p className="text-center">
                Tap a Pokemon to inspect or pick a card. Tap the small check or cross for quick owned/unowned.
              </p>
              <div className="flex items-center justify-center gap-3">
              <span className="tabular-nums">{settings.binderRows}x{settings.binderCols} Binder</span>
              <span className="w-px h-3 bg-border/50" />
              <span className="tabular-nums">{filteredPokemonList.length} Pokemon</span>
              <span className="hidden sm:block w-px h-3 bg-border/50" />
              <span className="hidden sm:block">Swipe, trackpad, or use arrow keys</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Selected Pokemon Quick Panel */}
      {selectedPokemon && viewMode === "browse" && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 w-[calc(100%-1.5rem)] max-w-sm z-30 animate-slide-up">
          <div className="bg-card/95 backdrop-blur-xl border border-border/50 rounded-2xl p-3 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="relative w-12 h-12 rounded-xl bg-muted/50 flex items-center justify-center shrink-0">
                <img
                  src={selectedPokemonDisplayImage || getPokemonArtwork(selectedPokemon)}
                  alt={selectedPokemon.name}
                  className="w-10 h-10 object-contain"
                />
                {collected && (
                  <div className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 rounded-full flex items-center justify-center shadow">
                    <Check className="w-2.5 h-2.5 text-white" />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-muted-foreground font-semibold">#{String(selectedPokemon.id).padStart(4, "0")}</p>
                <h3 className="text-sm font-bold capitalize truncate">{selectedPokemon.name}</h3>
                {collectionItem?.card_name && (
                  <p className="text-[10px] text-primary truncate">{collectionItem.card_name}</p>
                )}
                {collected && !collectionItem?.card_name && (
                  <p className="text-[10px] text-muted-foreground">No card assigned yet</p>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                {!collected && (
                  <Button
                    onClick={handleQuickCollectSelectedPokemon}
                    disabled={isCollectionLoading}
                    variant="outline"
                    size="sm"
                    className="h-8 px-2.5 text-xs"
                  >
                    Owned
                  </Button>
                )}
                <Button
                  onClick={collected ? handleOpenCardSelector : handleToggleCollected}
                  disabled={isCollectionLoading}
                  variant={collected ? "default" : "secondary"}
                  size="sm"
                  className="gap-1 h-8 px-2.5 text-xs"
                >
                  {collected ? <Check className="w-3 h-3" /> : null}
                  {collected
                    ? selectedPokemonHasAssignedCard
                      ? "Card"
                      : "Add card"
                    : "Pick card"}
                </Button>
                {collected && (
                  <Button
                    onClick={handleRemoveSelectedPokemon}
                    disabled={isCollectionLoading}
                    variant="outline"
                    size="sm"
                    className="h-8 px-2.5 text-xs"
                  >
                    Remove
                  </Button>
                )}
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSelectedPokemon(null)}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Owned is the fast path. Pick card opens the TCG list.
            </p>
          </div>
        </div>
      )}

      {/* Modals */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        user={user}
        settings={settings}
        onUpdateSettings={updateSettings}
        isSignedIn={Boolean(user)}
        localCollectedCount={localCollectedCount}
        isSyncingLocalCollection={isSyncingLocalCollection}
        localCollectionSyncMessage={localCollectionSyncMessage}
        onSyncLocalCollectionToCloud={handleSyncLocalCollectionToCloud}
      />
      <AuthModal isOpen={isAuthOpen} onClose={() => setIsAuthOpen(false)} />
      <PartnerModal isOpen={isPartnerOpen} onClose={() => setIsPartnerOpen(false)} user={user} />

      {isCardSelectorOpen && selectedPokemon && (
        <CardSelector
          pokemonId={selectedPokemon.id}
          pokemonName={selectedPokemon.name}
          onSelect={handleCardSelected}
          onClose={() => setIsCardSelectorOpen(false)}
          selectedCardId={collectionItem?.card_id}
        />
      )}

      <footer className="fixed bottom-0 left-0 right-0 py-2.5 text-center text-muted-foreground/40 text-[10px] bg-background/80 backdrop-blur-sm border-t border-border/20 safe-area-bottom">
        Made with 🩵 by Cal for his wife, Laura
      </footer>
    </main>
  )
}

function PokemonSlot({
  pokemon,
  isCollected,
  isSelected,
  isLongPressed,
  slotLabel,
  status,
  cardImage,
  onClick,
  onLongPress,
  onQuickCollect,
  onCycleStatus,
  priority,
}: {
  pokemon: { id: number; name: string }
  isCollected: boolean
  isSelected: boolean
  isLongPressed: boolean
  slotLabel: string
  status?: SlotStatus
  cardImage?: string | null
  onClick: () => void
  onLongPress: () => void
  onQuickCollect: () => void
  onCycleStatus: () => void
  user: User | null
  priority?: boolean
}) {
  const longPressTimer = useRef<NodeJS.Timeout | null>(null)
  const isLongPressTriggered = useRef(false)

  const handleTouchStart = () => {
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

  const handleQuickToggleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    onQuickCollect()
  }

  const previewImage = cardImage || `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${pokemon.id}.png`
  const previewFitClass = cardImage ? "object-cover" : "object-contain"
  const previewToneClass = isCollected ? "" : "grayscale"

  return (
    <div className="relative">
      <button
        onClick={onClick}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
        onContextMenu={(e) => { e.preventDefault(); onLongPress(); }}
        className={`relative h-full w-full rounded-xl overflow-hidden transition-all duration-150 group ${
          isSelected
            ? "ring-2 ring-primary ring-offset-1 ring-offset-background scale-[1.03] z-10"
            : isCollected
              ? "ring-1 ring-green-500/40"
              : "hover:ring-1 hover:ring-primary/30 active:scale-[0.98]"
        }`}
      >
        <div className={`absolute inset-0 transition-colors ${
          isCollected
            ? "bg-gradient-to-br from-green-500/15 to-emerald-500/5"
            : "bg-gradient-to-br from-muted/80 to-muted/40"
        }`} />

        <div className="absolute top-0.5 left-0.5 sm:top-1 sm:left-1 px-1 py-0.5 bg-black/50 backdrop-blur-sm rounded text-[7px] sm:text-[8px] text-white/70 font-bold tabular-nums z-10">
          {slotLabel}
        </div>

        <img
          src={previewImage}
          alt={pokemon.name}
          className={`absolute inset-1 w-[calc(100%-8px)] h-[calc(100%-8px)] ${previewFitClass} ${previewToneClass} group-hover:scale-105 transition-transform duration-150`}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          decoding="async"
          draggable={false}
        />

        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent p-1 sm:p-1.5">
          <p className="text-[8px] sm:text-[10px] text-white/90 font-semibold truncate capitalize leading-tight">
            {pokemon.name}
          </p>
          <p className="text-[7px] sm:text-[9px] text-white/50 tabular-nums">
            #{String(pokemon.id).padStart(4, "0")}
          </p>
        </div>

        {isCollected && (
          <div className={`absolute top-0.5 right-0.5 sm:top-1 sm:right-1 w-4 h-4 sm:w-5 sm:h-5 rounded-full flex items-center justify-center shadow-lg border ${
            status === 'finalized'
              ? 'bg-amber-500 border-amber-400/50'
              : status === 'considering'
                ? 'bg-blue-500 border-blue-400/50'
                : 'bg-green-500 border-green-400/50'
          }`}>
            {status === 'finalized' ? (
              <Star className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-white fill-white" />
            ) : status === 'considering' ? (
              <HelpCircle className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-white" />
            ) : (
              <Check className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-white" />
            )}
          </div>
        )}
      </button>

      <button
        type="button"
        onClick={handleQuickToggleClick}
        aria-label={isCollected ? `Remove ${pokemon.name} from collection` : `Quick collect ${pokemon.name}`}
        title={isCollected ? `Mark ${pokemon.name} unowned` : `Mark ${pokemon.name} owned`}
        className={`absolute bottom-1 right-1 z-20 flex h-6 w-6 items-center justify-center rounded-full border shadow-lg backdrop-blur-sm transition-all ${
          isCollected
            ? "bg-destructive/85 border-destructive/60 text-white hover:bg-destructive"
            : "bg-green-500/85 border-green-400/60 text-white hover:bg-green-500"
        }`}
      >
        {isCollected ? <X className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
      </button>

      {isLongPressed && (
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
            {isCollected && (
              <button
                onClick={(e) => { e.stopPropagation(); onCycleStatus(); }}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                  status === 'finalized'
                    ? "bg-amber-500/10 text-amber-500 hover:bg-amber-500/20"
                    : status === 'considering'
                      ? "bg-blue-500/10 text-blue-500 hover:bg-blue-500/20"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {status === 'finalized' ? (
                  <><Star className="w-3 h-3 fill-current" /> Done</>
                ) : status === 'considering' ? (
                  <><HelpCircle className="w-3 h-3" /> Maybe</>
                ) : (
                  <><Star className="w-3 h-3" /> Status</>
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
