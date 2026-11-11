"use client"

import { useRef, useState, useEffect } from "react"
import { useOverlay, useSwipeToDismiss } from "@/hooks/use-overlay"
import { useCameraStream } from "@/hooks/use-camera-stream"
import { scanBinderPageImage } from "@/lib/binder-page-scan"
import { drawVideoCoverFrame } from "@/lib/camera-frame"
import { captureScanDestination, mapScanCells, type ScanCell, type ScanDestinationAdmission, type ScanDestinationCapture } from "@/lib/scan-destinations"
import type { SearchCardResult } from "@/lib/pokemon-card-browse"
import ScanDestinationReview, { type ScanReviewCell } from "@/components/scan-destination-review"

export interface NativePageScanAdmission extends ScanDestinationAdmission {
  getOfflineCards: () => Promise<SearchCardResult[]>
  /** Occupancy detector adapter. Default is the existing browser page detector. */
  detectPage?: (file: File, rows: number, cols: number) => Promise<ScanCell[]>
}
const detectPage = async (file: File, rows: number, cols: number) => (await scanBinderPageImage(file, rows, cols)).slots
const button = "min-h-11 rounded-xl border border-border bg-background px-3 py-2 text-base disabled:opacity-50"
const pageProblem = (cause: unknown) => cause instanceof Error && cause.message === "scan-stale" ? "This page changed while scanning. Close this and try again."
  : "Couldn't read that photo. Try again with the whole page in view and good light."

export default function NativePageScanner({ admission, onClose }: { admission: NativePageScanAdmission; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null), video = useRef<HTMLVideoElement>(null)
  const alive = useRef(true), saving = useRef(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null)
  const [review, setReview] = useState<{ capture: ScanDestinationCapture; cells: ScanReviewCell[] } | null>(null)
  const camera = useCameraStream(!review, video)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const close = () => { if (!saving.current) { alive.current = false; onClose() } }
  useOverlay(true, close, { containerRef: panel })
  const swipe = useSwipeToDismiss(panel, close, !review)
  const capture = async (file: File, captured: ScanDestinationCapture) => {
    setBusy(true); setError(null)
    try {
      const cells = mapScanCells(captured, await (admission.detectPage ?? detectPage)(file, captured.rows, captured.cols))
      // The photo shows which pockets are filled, not which cards they are: each card is chosen in the review, next to its crop.
      if (alive.current) setReview({ capture: captured, cells: cells.map(c => ({ ...c, candidates: [], crop: (c as { cardImageDataUrl?: string }).cardImageDataUrl })) })
    } catch (cause) { if (alive.current) setError(pageProblem(cause)) }
    finally { if (alive.current) setBusy(false) }
  }
  const cameraCapture = async () => {
    try {
      // Freeze scope/order BEFORE awaiting camera encoding or detection.
      const captured = captureScanDestination(admission.snapshot, admission.view)
      if (!video.current || !camera.ready || busy) return
      setBusy(true)
      const canvas = document.createElement("canvas")
      canvas.width = video.current.videoWidth; canvas.height = video.current.videoHeight
      const context = canvas.getContext("2d")
      if (!context) throw new Error("Could not capture page")
      drawVideoCoverFrame(video.current, context, canvas.width, canvas.height)
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.9))
      if (!blob) throw new Error("Could not encode page")
      if (alive.current) await capture(new File([blob], "page-scan.jpg", { type: "image/jpeg" }), captured)
    } catch (cause) { if (alive.current) { setError(pageProblem(cause)); setBusy(false) } }
  }
  if (review) return <ScanDestinationReview admission={admission} capture={review.capture} cells={review.cells} onClose={close} managed={{ containerRef: panel, onBusyChange: busy => { saving.current = busy } }} />
  return <div className="fixed inset-0 z-40">
    <div data-overlay-backdrop className="absolute inset-0 bg-black/55" onClick={close} />
    <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Scan page" className="absolute inset-x-2 bottom-[var(--dock-clearance)] mx-auto flex max-h-[calc(100dvh-var(--top-inset)-var(--dock-clearance)-1rem)] max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-background text-foreground">
      <header data-sheet-grabber {...swipe} className="relative flex shrink-0 items-center gap-2 p-3"><span aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1 h-1 w-10 -translate-x-1/2 rounded-full bg-muted-foreground/30" /><h2 className="flex-1 font-semibold">Scan page</h2><button className={button} onClick={close} aria-label="Close page scanner">Close</button></header>
      <div className="space-y-3 overflow-y-auto p-3">
        <p className="text-sm text-muted-foreground">Fit the whole page in view ({admission.view.rows} by {admission.view.cols} pockets) and take a photo. You choose each card before anything is added.</p>
        <video ref={video} autoPlay playsInline muted className="max-h-48 w-full rounded-xl bg-black object-cover" />
        {camera.error && <p className="text-sm">The camera isn&apos;t available. Choose a photo of the page instead.</p>}
        {error && <p role="alert">{error}</p>}
        <button className={`${button} w-full`} disabled={busy || !camera.ready} onClick={() => void cameraCapture()}>Take photo</button>
        <label className="block text-sm">Or choose a photo<input aria-label="Page photo" type="file" accept="image/*" disabled={busy} className="mt-2 block min-h-11 w-full max-w-full text-base" onChange={e => {
          const file = e.target.files?.[0]
          e.target.value = ""
          if (!file || busy) return
          try { void capture(file, captureScanDestination(admission.snapshot, admission.view)) }
          catch (cause) { setError(pageProblem(cause)) }
        }} /></label>
        {busy && <p role="status">Reading the page…</p>}
      </div>
    </div>
  </div>
}
