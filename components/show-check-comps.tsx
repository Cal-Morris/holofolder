"use client"

// Show's "Check comps": one button that bakes sold comps (and eBay asking checks) for the Hunting cards onto
// this device through Zip's warm engine (useShowCompsWarm → warmShowComps), with live progress. The engine
// owns skipping fresh checks, concurrency and back-off; this is only the button, the progress and the summary.
import { memo, useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useOverlay, useSwipeToDismiss } from "@/hooks/use-overlay"
import { Loader2, Receipt, Square, X } from "lucide-react"
import { useShowCompsWarm } from "@/hooks/use-show-comps-warm"
import type { CheckCompsProgress, CheckCompsRefusal, CheckCompsSpendEstimate, CheckCompsTarget } from "@/lib/check-comps"

export interface ShowCheckCompsProps {
  /** Hunting cards, most valuable first (the engine caps the run and keeps that order). */
  targets: readonly CheckCompsTarget[]
  isOnline: boolean
}

function summary(progress: CheckCompsProgress) {
  if (progress.total === 0) return "No cards here have sold comps to check."
  const ready = progress.fresh + progress.checked
  const parts = [`Sold comps ready for ${ready}/${progress.total} card${progress.total === 1 ? "" : "s"}`]
  if (progress.failed) parts.push(`${progress.failed} couldn't be checked`)
  const stopped = Object.values(progress.stopped)
  return `${parts.join(", ")}.${stopped.length ? ` ${[...new Set(stopped)].join(" ")}` : ""}`
}

function refusedStatus(_refused: CheckCompsRefusal) {
  return "Check comps cancelled."
}

function ShowCheckComps({ targets, isOnline }: ShowCheckCompsProps) {
  const { start, stop, running, progress, refused } = useShowCompsWarm()
  const [failed, setFailed] = useState(false)
  const [estimate, setEstimate] = useState<CheckCompsSpendEstimate | null>(null)
  const confirmation = useRef<((confirmed: boolean) => void) | null>(null)
  const mounted = useRef(true)
  const sheetRef = useRef<HTMLDivElement | null>(null)
  const finishConfirmation = useCallback((confirmed: boolean) => {
    const resolve = confirmation.current
    confirmation.current = null
    setEstimate(null)
    resolve?.(confirmed)
  }, [])
  const cancelConfirmation = useCallback(() => finishConfirmation(false), [finishConfirmation])
  useOverlay(estimate !== null, cancelConfirmation, { containerRef: sheetRef })
  const swipe = useSwipeToDismiss(sheetRef, cancelConfirmation, estimate !== null)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      confirmation.current?.(false)
      confirmation.current = null
    }
  }, [])
  const confirmSpend = useCallback((next: CheckCompsSpendEstimate) => {
    if (!mounted.current) return false
    return new Promise<boolean>(resolve => {
      confirmation.current = resolve
      setEstimate(next)
    })
  }, [])
  const checkComps = useCallback(() => {
    setFailed(false)
    void start({ wanted: targets }, { confirmSpend }).catch(() => setFailed(true))
  }, [start, targets, confirmSpend])

  const percent = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0
  const status = running
    ? `Checking comps ${progress?.done ?? 0}/${progress?.total ?? "…"}`
    : failed
    ? "Couldn't check comps. Try again when you have signal."
    : refused
    ? refusedStatus(refused)
    : progress
    ? summary(progress)
    : null

  return (
    <div data-testid="show-check-comps" className="space-y-1.5">
      <div className="flex items-center gap-2">
        {running ? (
          <button type="button" onClick={() => { cancelConfirmation(); stop() }} aria-label="Stop checking comps"
            className="inline-flex h-12 shrink-0 items-center gap-1.5 rounded-2xl border border-border/60 px-3 text-sm font-semibold">
            <Square className="h-3.5 w-3.5 fill-current" aria-hidden />Stop
          </button>
        ) : (
          <button type="button" onClick={checkComps} disabled={!isOnline || targets.length === 0}
            className="inline-flex h-12 shrink-0 items-center gap-1.5 rounded-2xl bg-muted/70 px-3 text-sm font-semibold disabled:opacity-50">
            <Receipt className="h-4 w-4" aria-hidden />Check comps
          </button>
        )}
        <p role="status" aria-live="polite" className="min-w-0 flex-1 text-xs leading-snug text-muted-foreground">
          {running && <Loader2 className="mr-1 inline h-3 w-3 animate-spin" aria-hidden />}
          {status ?? (isOnline ? "Save sold comps for these cards on this device." : "Comps need signal.")}
        </p>
      </div>
      {estimate && createPortal(
        <div className="fixed inset-0 z-60">
          <div data-overlay-backdrop className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={cancelConfirmation} />
          <div ref={sheetRef} role="dialog" aria-modal="true" aria-label="Check sold comps?"
            aria-describedby="comps-confirm-description"
            className="absolute inset-x-3 bottom-[var(--dock-clearance)] mx-auto flex max-h-[calc(100dvh-var(--top-inset)-var(--dock-clearance))] max-w-md flex-col overflow-hidden rounded-[1.6rem] border border-border/60 bg-card shadow-2xl outline-none">
            <div data-sheet-grabber {...swipe} className="shrink-0 px-5 pt-3">
              <div aria-hidden="true" className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-muted-foreground/30" />
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg font-semibold">Check sold comps?</h2>
                <button type="button" onClick={cancelConfirmation} aria-label="Close comps confirmation"
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full hover:bg-muted/70">
                  <X className="h-5 w-5" aria-hidden />
                </button>
              </div>
            </div>
            <div className="space-y-5 overflow-y-auto overscroll-contain px-5 pb-5">
              <p id="comps-confirm-description" className="text-sm leading-relaxed text-muted-foreground">
                {estimate.cardsNeedingSoldcomps} cards need a sold comps refresh. Check them now?
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={cancelConfirmation}
                  className="h-12 flex-1 rounded-2xl border border-border/60 text-sm font-semibold">Cancel</button>
                <button type="button" onClick={() => finishConfirmation(true)} disabled={!isOnline}
                  className="h-12 flex-1 rounded-2xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50">Check comps</button>
              </div>
            </div>
          </div>
        </div>, document.body,
      )}
      {running && (
        <div role="progressbar" aria-label="Comps checked" aria-valuemin={0} aria-valuemax={progress?.total ?? 0} aria-valuenow={progress?.done ?? 0}
          className="h-1 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
        </div>
      )}
    </div>
  )
}

export default memo(ShowCheckComps)
