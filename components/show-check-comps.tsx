"use client"

// Show's "Check comps": one button that bakes sold comps (and eBay asking checks) for the Hunting cards onto
// this device through Zip's warm engine (useShowCompsWarm → warmShowComps), with live progress. The engine
// owns skipping fresh checks, concurrency and back-off; this is only the button, the progress and the summary.
import { memo, useCallback, useState } from "react"
import { Loader2, Receipt, Square } from "lucide-react"
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

function refusedStatus(refused: CheckCompsRefusal) {
  return refused.reason === "budget"
    ? `Sold comps daily limit reached (${refused.remaining} left today). Try again tomorrow.`
    : "Check comps cancelled."
}

// Plain confirm for big runs (the engine only asks at CHECK_COMPS_CONFIRM_AT+ sold comps calls).
function confirmSpend({ cardsNeedingSoldcomps, remainingBudget }: CheckCompsSpendEstimate) {
  return window.confirm(`${cardsNeedingSoldcomps} card${cardsNeedingSoldcomps === 1 ? "" : "s"} need a sold comps refresh (${remainingBudget} left today). Check them now?`)
}

function ShowCheckComps({ targets, isOnline }: ShowCheckCompsProps) {
  const { start, stop, running, progress, refused } = useShowCompsWarm()
  const [failed, setFailed] = useState(false)
  // The single entry point here; the credit gate itself lives in the engine (runCheckComps) so Prepare shares it.
  const checkComps = useCallback(() => {
    setFailed(false)
    void start({ wanted: targets }, { confirmSpend }).catch(() => setFailed(true))
  }, [start, targets])

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
          <button type="button" onClick={stop} aria-label="Stop checking comps"
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
