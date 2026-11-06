"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Receipt, Square } from "lucide-react"
import CheckCompsConfirm from "@/components/check-comps-confirm"
import { checkCompsTargets, runCheckComps, type CheckCompsProgress } from "@/lib/check-comps"
import type { CollectedPokemon } from "@/lib/domain/cards"
import { collectionCompsTargets } from "@/lib/collection-comps"

export default function CollectionPriceCheck({ collection, kind, isOnline }: {
  collection: readonly CollectedPokemon[]
  kind: "wanted" | "owned"
  isOnline: boolean
}) {
  const targets = useMemo(() => checkCompsTargets(collectionCompsTargets(collection, kind), "collection"), [collection, kind])
  const [progress, setProgress] = useState<CheckCompsProgress | null>(null)
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [estimate, setEstimate] = useState<number | null>(null)
  const controller = useRef<AbortController | null>(null)
  const pending = useRef<((ok: boolean) => void) | null>(null)

  const confirm = useCallback((ok: boolean) => {
    pending.current?.(ok)
    pending.current = null
    setEstimate(null)
  }, [])
  const stop = useCallback(() => {
    controller.current?.abort()
    confirm(false)
    setRunning(false)
    setMessage("Stopped. Completed checks are saved on this device.")
  }, [confirm])
  useEffect(() => () => {
    controller.current?.abort()
    pending.current?.(false)
  }, [])
  useEffect(() => {
    window.addEventListener("offline", stop)
    return () => window.removeEventListener("offline", stop)
  }, [stop])

  const start = async () => {
    if (!isOnline || controller.current && !controller.current.signal.aborted) return
    const abort = new AbortController()
    controller.current = abort
    setRunning(true)
    setMessage(null)
    setProgress(null)
    try {
      const outcome = await runCheckComps(targets, {
        scope: "collection", signal: abort.signal,
        onProgress: next => { if (!abort.signal.aborted) setProgress(next) },
        confirmSpend: ({ cardsNeedingSoldcomps }) => new Promise<boolean>(resolve => {
          pending.current = resolve
          setEstimate(cardsNeedingSoldcomps)
        }),
      })
      if (!abort.signal.aborted) setMessage(outcome.ok ? "Finished." : "Price check cancelled.")
    } catch {
      if (!abort.signal.aborted) setMessage("Couldn't finish checking prices. Try again when you have signal.")
    } finally {
      if (controller.current === abort) {
        controller.current = null
        if (!abort.signal.aborted) setRunning(false)
      }
    }
  }

  return <div className="shrink-0 space-y-1 px-1 py-1" data-testid="collection-price-check">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {running && estimate === null ? <button type="button" onClick={stop} aria-label="Stop checking prices" className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-muted/70 px-3 text-sm font-semibold">
        <Square className="h-3.5 w-3.5" aria-hidden />Stop
      </button> : <button type="button" onClick={() => void start()} disabled={!isOnline || !targets.length || running} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-muted/70 px-3 text-sm font-semibold disabled:opacity-50">
        <Receipt className="h-4 w-4" aria-hidden />Check {kind} prices
      </button>}
      <span className="text-xs text-muted-foreground">{targets.length} eligible printing{targets.length === 1 ? "" : "s"} in this binder</span>
    </div>
    <p className="text-xs text-muted-foreground">eBay asking prices + sold comps. English, non-jumbo cards; duplicates checked once.</p>
    <p role="status" className="text-xs text-muted-foreground">
      {!isOnline ? "Connect to check prices." : running ? estimate === null ? `Checking ${progress?.done ?? 0}/${progress?.total ?? targets.length}…` : "Waiting for confirmation." : message}
      {progress && <> {progress.checked} checked, {progress.fresh} already fresh, {progress.failed} incomplete. {Object.values(progress.stopped).join(" ")}</>}
    </p>
    {running && estimate === null && <progress aria-label="Prices checked" value={progress?.done ?? 0} max={progress?.total || targets.length || 1} className="h-1 w-full accent-primary" />}
    {estimate !== null && <CheckCompsConfirm cardsNeedingSoldcomps={estimate} onConfirm={() => confirm(true)} onCancel={() => confirm(false)} />}
  </div>
}
