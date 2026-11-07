"use client"

// "Prepare for card show": pick sets, see the download size, then save their coverage data and card
// thumbnails for offline use. Shared by Sets and the Show finder.
import { useCallback, useEffect, useRef, useState } from "react"
import type { TCGSetSummary } from "@/lib/tcg-set-slots"
import { saveCardPricesForOffline, loadPriceEvidence } from "@/hooks/use-card-prices"
import { warmCardTextReader } from "@/lib/card-scan-ocr"
import { requestPersistentStorage } from "@/lib/service-worker-registration"
import {
  inspectSavedShowSets,
  type SavedShowSet,
  downloadCardShowImages,
  downloadCardShowPrices,
  formatBytes,
  planCardShowPrep,
  type CardShowPlan,
  type CardShowProgress,
} from "@/lib/card-show-prep"

type Phase =
  | { kind: "idle" }
  | { kind: "planning" }
  | { kind: "planned"; plan: CardShowPlan }
  | { kind: "downloading"; plan: CardShowPlan; progress: CardShowProgress }
  | { kind: "prices"; plan: CardShowPlan; done: number; total: number }
  | { kind: "done"; plan: CardShowPlan; progress: CardShowProgress; priced: number; failedPrices: number }
  | { kind: "error"; message: string; plan?: CardShowPlan }

export default function CardShowPrep({ candidateSets, embedded = false }: {
  embedded?: boolean
  candidateSets: TCGSetSummary[]
}) {
  const [open, setOpen] = useState(embedded)
  const [chosen, setChosen] = useState<Set<string>>(() => new Set())
  const [phase, setPhase] = useState<Phase>({ kind: "idle" })
  const [canStoreOffline, setCanStoreOffline] = useState(true)
  const [isOnline, setIsOnline] = useState(true)
  const [saved, setSaved] = useState<SavedShowSet[] | null>(null)
  const [storageError, setStorageError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const inspect = useCallback(() => inspectSavedShowSets({ cacheStorage: window.caches, loadPrices: loadPriceEvidence }).then(
    entries => { setSaved(entries); setStorageError(null) },
    () => setStorageError("Couldn't inspect saved data on this device. Try again."),
  ), [])
  useEffect(() => { if (open) void inspect() }, [open, inspect])
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const update = () => {
      setIsOnline(navigator.onLine !== false)
      setCanStoreOffline(Boolean(navigator.serviceWorker?.controller))
    }
    update()
    window.addEventListener("online", update)
    window.addEventListener("offline", update)
    navigator.serviceWorker?.addEventListener("controllerchange", update)
    return () => {
      window.removeEventListener("online", update)
      window.removeEventListener("offline", update)
      navigator.serviceWorker?.removeEventListener("controllerchange", update)
      abortRef.current?.abort()
    }
  }, [])

  const chosenSets = candidateSets.filter((set) => chosen.has(set.id))
  const busy = phase.kind === "planning" || phase.kind === "downloading" || phase.kind === "prices"

  const toggle = (setId: string) => {
    setPhase({ kind: "idle" })
    setChosen((current) => {
      const next = new Set(current)
      if (next.has(setId)) next.delete(setId)
      else next.add(setId)
      return next
    })
  }

  const checkSize = async () => {
    if (!navigator.onLine || !navigator.serviceWorker?.controller) return
    setNotice(null)
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setPhase({ kind: "planning" })
    try {
      const plan = await planCardShowPrep(chosenSets, { signal: controller.signal })
      if (!controller.signal.aborted) setPhase({ kind: "planned", plan })
    } catch (error) {
      if (!controller.signal.aborted) setPhase({ kind: "error", message: error instanceof Error ? error.message : "Couldn't check the size." })
    }
  }

  const download = async (plan: CardShowPlan) => {
    if (!navigator.onLine || !navigator.serviceWorker?.controller) return
    setNotice(null)
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const total = plan.imageUrls.length
    setPhase({ kind: "downloading", plan, progress: { done: 0, total, failed: 0 } })
    // Also fetch card scanning's text reader now (a few MB, once), so Scan still reads cards at the show
    // without signal even if it was never opened online. Best effort: never holds up or fails the prep.
    void warmCardTextReader()
    // Ask the browser not to evict the saved show data under storage pressure. Best effort, never fails the prep.
    void requestPersistentStorage()
    try {
      const progress = await downloadCardShowImages(plan, {
        signal: controller.signal,
        onProgress: (next) => { if (!controller.signal.aborted) setPhase({ kind: "downloading", plan, progress: next }) },
      })
      if (controller.signal.aborted) return
      setPhase({ kind: "prices", plan, done: 0, total: plan.priceLookups.length })
      const prices = await downloadCardShowPrices(plan, { signal: controller.signal, savePrices: saveCardPricesForOffline,
        onProgress: next => { if (!controller.signal.aborted) setPhase({ kind: "prices", plan, done: next.done, total: next.total }) },
      })
      if (controller.signal.aborted) return
      if (!controller.signal.aborted) setPhase({ kind: "done", plan, progress, priced: prices.priced, failedPrices: prices.failed })
      await inspect()
    } catch (error) {
      if (!controller.signal.aborted) setPhase({ kind: "error", plan, message: error instanceof Error ? error.message : "Couldn't save prices on this device." })
      await inspect()
    }
  }

  const cancel = () => {
    abortRef.current?.abort()
    setPhase({ kind: "idle" })
    setNotice("Stopped. Anything already saved stays on this device.")
    void inspect()
  }

  return (
    <section aria-label="Prepare for card show" data-card-show-prep className="mt-3 text-sm">
      {!embedded && <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="min-h-9 rounded-full border border-border/55 bg-background/55 px-3.5 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground dark:border-white/10"
      >
        Prepare for card show
      </button>}

      {open ? (
        <div className="space-y-3 py-2">
          <p className="text-xs text-muted-foreground">Save set data, card thumbnails and available price history on this device. Prices may change before the show.</p>

          {candidateSets.length === 0 ? (
            <p className="text-xs text-muted-foreground">Search for a set, then pick it here.</p>
          ) : (
            <fieldset disabled={busy} className="max-h-40 space-y-1 overflow-y-auto">
              <legend className="sr-only">Sets to save</legend>
              {candidateSets.map((set) => (
                <label key={set.id} className="flex min-h-10 items-center gap-2 text-sm">
                  <input type="checkbox" checked={chosen.has(set.id)} onChange={() => toggle(set.id)} />
                  <span>{set.name}</span>
                  {set.officialCardCount ? <span className="text-muted-foreground">({set.officialCardCount} cards)</span> : null}
                </label>
              ))}
            </fieldset>
          )}

          {!canStoreOffline ? (
            <p className="text-xs text-muted-foreground">Offline storage isn&apos;t active yet. Reload the app once, then try again.</p>
          ) : !isOnline ? (
            <p className="text-xs text-muted-foreground">You&apos;re offline. Connect to download sets.</p>
          ) : null}

          {notice && <p className="text-xs text-muted-foreground">{notice}</p>}
          <div role="status" aria-live="polite" className="text-xs">
            {phase.kind === "planning" ? "Checking download size…" : null}
            {phase.kind === "planned"
              ? `${phase.plan.sets.length} set${phase.plan.sets.length === 1 ? "" : "s"} · ${phase.plan.imageUrls.length} card images · about ${formatBytes(phase.plan.estimatedBytes)}`
              : null}
            {phase.kind === "downloading" ? `Downloading ${phase.progress.done}/${phase.progress.total} card images…` : null}
            {phase.kind === "prices" ? `Saving prices ${phase.done}/${phase.total}…` : null}
            {phase.kind === "done"
              ? `Download finished: ${phase.plan.sets.map((entry) => entry.set.name).join(", ")} (${phase.progress.done - phase.progress.failed}/${phase.progress.total} card images${phase.progress.failed ? `, ${phase.progress.failed} failed` : ""}, ${phase.priced}/${phase.plan.priceLookups.length} cards priced${phase.failedPrices ? `, ${phase.failedPrices} price downloads failed` : ""})`
              : null}
            {phase.kind === "error" ? phase.message : null}
          </div>

          {phase.kind === "planned" && <p className="text-xs text-muted-foreground">Estimate covers set data and images. Prices and scanning tools use extra data, including a few MB for the first scan download. Scanning tools are best effort; offline scanning is not guaranteed.</p>}
          <div className="flex flex-wrap gap-2">
            {((phase.kind === "error" && phase.plan) || (phase.kind === "done" && (phase.progress.failed > 0 || phase.failedPrices > 0))) && <button type="button" disabled={!isOnline || !canStoreOffline} onClick={() => { if (phase.plan) void download(phase.plan) }} className="min-h-9 rounded-full border px-3.5 py-2 text-xs font-semibold">Resume / retry download</button>}
            {phase.kind === "planned" ? (
              <>
                <button type="button" disabled={!isOnline || !canStoreOffline} onClick={() => void download(phase.plan)} className="min-h-9 rounded-full border border-primary/35 bg-primary/12 px-3.5 py-2 text-xs font-semibold text-foreground">
                  Download for offline
                </button>
                <button type="button" onClick={cancel} className="min-h-9 rounded-full border border-border/55 px-3.5 py-2 text-xs font-semibold text-muted-foreground">
                  Cancel
                </button>
              </>
            ) : busy ? (
              <button type="button" onClick={cancel} className="min-h-9 rounded-full border border-border/55 px-3.5 py-2 text-xs font-semibold text-muted-foreground">
                Stop
              </button>
            ) : (
              <button
                type="button"
                disabled={chosenSets.length === 0 || busy || !isOnline || !canStoreOffline}
                onClick={() => void checkSize()}
                className="min-h-9 rounded-full border border-primary/35 bg-primary/12 px-3.5 py-2 text-xs font-semibold text-foreground disabled:opacity-50"
              >
                Check download size
              </button>
            )}
          </div>
          <section aria-label="Saved on this device" className="space-y-2 border-t border-border/50 pt-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold">Saved on this device</h3>
              <button type="button" disabled={busy} onClick={() => void inspect()} className="min-h-9 rounded-full px-3 text-xs font-semibold">Refresh</button>
            </div>
            {storageError ? <p className="text-xs">{storageError}</p> : saved === null ? <p className="text-xs">Checking saved data…</p> : saved.length === 0 ? <p className="text-xs text-muted-foreground">No saved set data found.</p> : saved.map(entry => (
              <p key={entry.set.id} className="text-xs"><span className="font-medium">{entry.set.name}</span>: set data saved, {entry.images}/{entry.imageTotal} images, {entry.priced}/{entry.priceTotal} available prices.</p>
            ))}
            <p className="text-xs text-muted-foreground">Saved prices are last-known values, not live quotes. Missing images or prices need a connection. Browser storage can be cleared or evicted.</p>
          </section>
        </div>
      ) : null}
    </section>
  )
}
