"use client"

// Show mode's "Scan": point the camera at one card, read its name line and collector number, look the
// card up and hand back what was found (see lib/card-scan-identify.ts). Reading runs on the device
// (the system text reader where there is one, else Tesseract, whose engine is fetched from a CDN on first use);
// the lookup uses the card search online and the cards saved on this device offline. When it can't be
// sure, Quick mode gets the text it read so the search field can finish the job.
import { useCallback, useEffect, useRef, useState } from "react"
import { Camera, Keyboard, Loader2, X } from "lucide-react"
import { useOverlay } from "@/hooks/use-overlay"
import { useCameraStream } from "@/hooks/use-camera-stream"
import { SINGLE_CARD_GUIDE, captureSingleCardFrame, delay } from "@/lib/camera-frame"
import { mergeCardTextSignals, type CardTextSignals } from "@/lib/card-scan-text"
import { recognizeCardTextSignalsFromImage, warmCardTextReader } from "@/lib/card-scan-ocr"
import { decideScanOutcome, isScanReadComplete, readScannedCard, type CardScanOutcome } from "@/lib/card-scan-identify"
import { searchOfflineCards } from "@/lib/offline-card-index"
import { formatPokemonDisplayName, getPokemonById } from "@/lib/pokemon-catalog"
import type { SearchCardResult } from "@/lib/pokemon-card-browse"

const SCAN_FRAMES = 3
const SCAN_FRAME_GAP_MS = 300
const SCAN_REGIONS = ["name", "number-left", "number-right", "bottom"] as const
/** A first read can include downloading the reader on show Wi-Fi; past this, fall back to typing. */
const SCAN_FRAME_TIMEOUT_MS = 20_000

function withTimeout<T>(promise: Promise<T>, ms: number) {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("Reading the card took too long.")), ms)
    promise.then(
      (value) => { window.clearTimeout(timer); resolve(value) },
      (error) => { window.clearTimeout(timer); reject(error) },
    )
  })
}

export interface CardScanResult {
  outcome: CardScanOutcome
  /** The text reader couldn't run (usually offline before it was ever downloaded). */
  readerUnavailable: boolean
  offline: boolean
}

interface QuickCardScannerProps {
  onClose: () => void
  onResult: (result: CardScanResult) => void
  isOnline: boolean
  getOfflineCards: () => Promise<SearchCardResult[]>
}

function lookupPokemon(id: number) {
  const entry = getPokemonById(id)
  return entry ? { id: entry.id, name: formatPokemonDisplayName(entry.name) } : null
}

async function searchCards(query: string, isOnline: boolean, getOfflineCards: () => Promise<SearchCardResult[]>) {
  const onDevice = async () => searchOfflineCards(await getOfflineCards().catch(() => []), query)
  if (!query) return { cards: [] as SearchCardResult[], offline: !isOnline }
  if (!isOnline || (typeof navigator !== "undefined" && navigator.onLine === false)) return { cards: await onDevice(), offline: true }
  try {
    const response = await fetch(`/app/api/tcg-card-search?q=${encodeURIComponent(query.toLowerCase())}`)
    if (!response.ok) throw new Error(`Card search failed (${response.status})`)
    const payload = (await response.json()) as { cards?: SearchCardResult[] }
    return { cards: Array.isArray(payload?.cards) ? payload.cards : [], offline: false }
  } catch {
    return { cards: await onDevice(), offline: true }
  }
}

export default function QuickCardScanner({ onClose, onResult, isOnline, getOfflineCards }: QuickCardScannerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [phase, setPhase] = useState<"idle" | "reading" | "matching">("idle")
  const [frame, setFrame] = useState(0)
  const busy = phase !== "idle"
  const camera = useCameraStream(true, videoRef)

  // Fetch the reader while he lines the card up (and so it's cached for offline use later).
  useEffect(() => {
    if (!isOnline) return
    void warmCardTextReader()
  }, [isOnline])

  const closeSafely = useCallback(() => {
    if (!busy) onClose()
  }, [busy, onClose])
  useOverlay(true, closeSafely, { containerRef, autoFocus: false })

  const typeInstead = useCallback(() => {
    onResult({ outcome: { kind: "unread", query: "" }, readerUnavailable: false, offline: !isOnline })
  }, [isOnline, onResult])

  const read = useCallback(async () => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || !camera.ready || busy) return
    setPhase("reading")
    const frames: Array<CardTextSignals | null> = []
    let readerFailures = 0
    try {
      for (let index = 0; index < SCAN_FRAMES; index += 1) {
        setFrame(index + 1)
        try {
          const { previewUrl } = await captureSingleCardFrame(video, canvas, index)
          frames.push(await withTimeout(recognizeCardTextSignalsFromImage(previewUrl, { regions: SCAN_REGIONS, isEnough: isScanReadComplete }), SCAN_FRAME_TIMEOUT_MS))
        } catch (error) {
          readerFailures += 1
          console.info("[holofolder] Card scan frame not read:", error)
        }
        if (isScanReadComplete(mergeCardTextSignals(frames))) break
        if (index < SCAN_FRAMES - 1) await delay(SCAN_FRAME_GAP_MS)
      }

      const scanned = readScannedCard(mergeCardTextSignals(frames))
      setPhase("matching")
      const { cards, offline } = await searchCards(scanned.query, isOnline, getOfflineCards)
      onResult({
        outcome: decideScanOutcome(cards, scanned, lookupPokemon),
        readerUnavailable: frames.length === 0 && readerFailures > 0,
        offline,
      })
    } catch (error) {
      console.info("[holofolder] Card scan failed:", error)
      onResult({ outcome: { kind: "unread", query: readScannedCard(mergeCardTextSignals(frames)).query }, readerUnavailable: true, offline: !isOnline })
    } finally {
      setPhase("idle")
    }
  }, [busy, camera.ready, getOfflineCards, isOnline, onResult])

  return (
    <div ref={containerRef} role="dialog" aria-modal="true" aria-label="Scan a card" className="fixed inset-0 z-[60] bg-black outline-none">
      <canvas ref={canvasRef} className="hidden" />
      <div className="mx-auto flex h-full w-full max-w-md flex-col px-3 pb-[calc(var(--safe-bottom)+0.75rem)] pt-[calc(var(--top-inset)+0.25rem)] text-white">
        <div className="flex shrink-0 items-center gap-2 py-2">
          <div className="min-w-0 flex-1">
            <p className="text-base font-bold leading-tight">Scan a card</p>
            <p className="truncate text-xs text-white/65">Fill the frame with one card, name and number in view.</p>
          </div>
          <button
            type="button"
            onClick={closeSafely}
            disabled={busy}
            aria-label="Close scanner"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/10 disabled:opacity-40"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="relative min-h-0 flex-1 overflow-hidden rounded-[2rem] border border-white/10 bg-black">
          <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" data-testid="card-scan-video" />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div
              className="rounded-[1.75rem] border-2 border-white/85 shadow-[0_0_0_9999px_rgba(0,0,0,0.4)]"
              style={{
                width: `${(1 - SINGLE_CARD_GUIDE.insetX * 2) * 100}%`,
                aspectRatio: `${SINGLE_CARD_GUIDE.aspectRatio}`,
                maxHeight: `${(1 - SINGLE_CARD_GUIDE.insetY * 2) * 100}%`,
              }}
            />
          </div>
          {!camera.ready && !camera.error && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="flex items-center gap-2 rounded-full bg-black/60 px-4 py-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Starting camera
              </span>
            </div>
          )}
        </div>

        <div className="shrink-0 space-y-2 pt-3">
          <p role="status" className="min-h-5 text-center text-sm text-white/75" data-testid="card-scan-status">
            {camera.error
              ? camera.error
              : phase === "reading"
              ? `Reading the card… ${frame}/${SCAN_FRAMES}`
              : phase === "matching"
              ? isOnline ? "Looking it up…" : "Looking it up on this device…"
              : camera.ready
              ? isOnline ? "Hold steady, then tap Read card." : "Offline: reads the card and looks it up on this device."
              : ""}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={typeInstead}
              disabled={busy}
              className="flex h-14 shrink-0 items-center gap-2 rounded-2xl border border-white/20 px-4 text-sm font-semibold disabled:opacity-40"
            >
              <Keyboard className="h-4 w-4" aria-hidden />
              Type instead
            </button>
            <button
              type="button"
              onClick={() => void read()}
              disabled={!camera.ready || busy}
              className="flex h-14 min-w-0 flex-1 items-center justify-center gap-2 holo-action rounded-2xl px-4 text-base font-semibold disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <Camera className="h-5 w-5" aria-hidden />}
              {busy ? "Reading…" : "Read card"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
