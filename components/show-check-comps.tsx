"use client"

// Show's "Check comps": one button that bakes sold comps (and eBay asking checks) for the Hunting cards onto
// this device through Zip's warm engine (useShowCompsWarm → warmShowComps), with live progress. The engine
// owns skipping fresh checks, concurrency and back-off; this is only the button, the progress and the summary.
import { memo, useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Loader2, Receipt, Square } from "lucide-react"
import { useOverlay } from "@/hooks/use-overlay"
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

/** In-app confirm for big runs (engine asks at CHECK_COMPS_CONFIRM_AT+). Matches owned-remove sheet chrome. */
function CheckCompsConfirm({
  cardsNeedingSoldcomps,
  onConfirm,
  onCancel,
}: {
  cardsNeedingSoldcomps: number
  onConfirm: () => void
  onCancel: () => void
}) {
  const sheetRef = useRef<HTMLDivElement | null>(null)
  useOverlay(true, onCancel, { containerRef: sheetRef })

  if (typeof document === "undefined") return null

  const n = cardsNeedingSoldcomps
  const title = `${n} card${n === 1 ? "" : "s"} need a sold comps refresh. Check them now?`

  return createPortal(
    <div
      data-overlay-backdrop
      data-testid="check-comps-confirm-backdrop"
      className="fixed inset-0 z-[60] bg-black/45 backdrop-blur-[2px]"
      onClick={onCancel}
    >
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="check-comps-confirm-title"
        data-testid="check-comps-confirm"
        className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-md rounded-t-[1.6rem] border-t border-border/65 bg-card/97 px-4 pb-[calc(var(--safe-bottom)+0.75rem)] pt-3 outline-none shadow-[0_-24px_64px_-32px_rgba(15,23,42,0.35)] sm:bottom-4 sm:rounded-[1.6rem] sm:border sm:pb-4 dark:border-border/50 dark:bg-background/97"
        onClick={(event) => event.stopPropagation()}
      >
        <div aria-hidden="true" className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-muted-foreground/30" />
        <p id="check-comps-confirm-title" className="mb-4 text-sm font-semibold leading-snug">
          {title}
        </p>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={onConfirm}
            className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-primary px-3 text-sm font-semibold text-primary-foreground"
          >
            Check now
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl border border-border/60 px-3 text-sm font-semibold text-muted-foreground dark:border-white/10"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function ShowCheckComps({ targets, isOnline }: ShowCheckCompsProps) {
  const { start, stop, running, progress, refused } = useShowCompsWarm()
  const [failed, setFailed] = useState(false)
  const [confirmCount, setConfirmCount] = useState<number | null>(null)
  const pendingRef = useRef<{ resolve: (ok: boolean) => void } | null>(null)

  useEffect(() => () => {
    pendingRef.current?.resolve(false)
    pendingRef.current = null
  }, [])

  const settleConfirm = useCallback((ok: boolean) => {
    const pending = pendingRef.current
    pendingRef.current = null
    setConfirmCount(null)
    pending?.resolve(ok)
  }, [])

  // Promise-shaped confirmSpend so the engine can await the in-app dialog (API already allows Promise<boolean>).
  const confirmSpend = useCallback((estimate: CheckCompsSpendEstimate) => {
    return new Promise<boolean>((resolve) => {
      pendingRef.current?.resolve(false)
      pendingRef.current = { resolve }
      setConfirmCount(estimate.cardsNeedingSoldcomps)
    })
  }, [])

  // The soft confirm gate lives in the engine (runCheckComps) so Prepare shares it; Show passes confirmSpend.
  const checkComps = useCallback(() => {
    setFailed(false)
    void start({ wanted: targets }, { confirmSpend }).catch(() => setFailed(true))
  }, [confirmSpend, start, targets])

  // While the in-app confirm is up the engine has already set running; keep the Check comps chrome until they decide.
  const confirming = confirmCount !== null
  const activelyChecking = running && !confirming
  const percent = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0
  const status = confirming
    ? null
    : activelyChecking
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
        {activelyChecking ? (
          <button type="button" onClick={stop} aria-label="Stop checking comps"
            className="inline-flex h-12 shrink-0 items-center gap-1.5 rounded-2xl border border-border/60 px-3 text-sm font-semibold">
            <Square className="h-3.5 w-3.5 fill-current" aria-hidden />Stop
          </button>
        ) : (
          <button type="button" onClick={checkComps} disabled={!isOnline || targets.length === 0 || confirming}
            className="inline-flex h-12 shrink-0 items-center gap-1.5 rounded-2xl bg-muted/70 px-3 text-sm font-semibold disabled:opacity-50">
            <Receipt className="h-4 w-4" aria-hidden />Check comps
          </button>
        )}
        <p role="status" aria-live="polite" className="min-w-0 flex-1 text-xs leading-snug text-muted-foreground">
          {activelyChecking && <Loader2 className="mr-1 inline h-3 w-3 animate-spin" aria-hidden />}
          {status ?? (isOnline ? "Save sold comps for these cards on this device." : "Comps need signal.")}
        </p>
      </div>
      {activelyChecking && (
        <div role="progressbar" aria-label="Comps checked" aria-valuemin={0} aria-valuemax={progress?.total ?? 0} aria-valuenow={progress?.done ?? 0}
          className="h-1 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
        </div>
      )}
      {confirmCount !== null && (
        <CheckCompsConfirm
          cardsNeedingSoldcomps={confirmCount}
          onConfirm={() => settleConfirm(true)}
          onCancel={() => settleConfirm(false)}
        />
      )}
    </div>
  )
}

export default memo(ShowCheckComps)
