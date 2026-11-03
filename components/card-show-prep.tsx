"use client"

// "Prepare for card show": pick sets, see the download size, then save their coverage data and card
// thumbnails for offline use. Deliberately plain markup; styling is up to the design owner.
import { useEffect, useRef, useState } from "react"
import type { TCGSetSummary } from "@/lib/tcg-set-slots"
import { saveCardPricesForOffline } from "@/hooks/use-card-prices"
import { warmCardTextReader } from "@/lib/card-scan-ocr"
import { requestPersistentStorage } from "@/lib/service-worker-registration"
import { warmShowComps, type CheckCompsProgress, type CheckCompsTarget } from "@/lib/check-comps"
import { getSetIdFromCardId } from "@/lib/show-hunt"
import {
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
  | { kind: "comps"; plan: CardShowPlan; comps: CheckCompsProgress }
  | { kind: "done"; plan: CardShowPlan; progress: CardShowProgress; priced: number; comps: CheckCompsProgress | null }
  | { kind: "error"; message: string }

export default function CardShowPrep({ candidateSets, wantedCards = [] }: {
  candidateSets: TCGSetSummary[]
  /** Want list printings; those in the chosen sets also get sold comps + asking checks saved (skipping any under 12 h old). */
  wantedCards?: readonly CheckCompsTarget[]
}) {
  const [open, setOpen] = useState(false)
  const [chosen, setChosen] = useState<Set<string>>(() => new Set())
  const [phase, setPhase] = useState<Phase>({ kind: "idle" })
  const [canStoreOffline, setCanStoreOffline] = useState(true)
  const [isOnline, setIsOnline] = useState(true)
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
  const busy = phase.kind === "planning" || phase.kind === "downloading" || phase.kind === "prices" || phase.kind === "comps"

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
        onProgress: (next) => setPhase({ kind: "downloading", plan, progress: next }),
      })
      if (controller.signal.aborted) return
      setPhase({ kind: "prices", plan, done: 0, total: plan.priceLookups.length })
      const prices = await downloadCardShowPrices(plan, { signal: controller.signal, savePrices: saveCardPricesForOffline,
        onProgress: next => setPhase({ kind: "prices", plan, done: next.done, total: next.total }),
      })
      if (controller.signal.aborted) return
      const setIds = new Set(plan.sets.map((entry) => entry.set.id))
      const wanted = wantedCards.filter((card) => setIds.has(getSetIdFromCardId(card.cardId)))
      // Sold comps are a metered provider: warm only wanted cards in these sets, and never fail the prep over them.
      const comps = wanted.length
        ? await warmShowComps({ wanted }, { signal: controller.signal, onProgress: (next) => setPhase({ kind: "comps", plan, comps: next }) }).catch(() => null)
        : null
      if (!controller.signal.aborted) setPhase({ kind: "done", plan, progress, priced: prices.priced, comps })
    } catch (error) {
      if (!controller.signal.aborted) setPhase({ kind: "error", message: error instanceof Error ? error.message : "Couldn't save prices on this device." })
    }
  }

  const cancel = () => {
    abortRef.current?.abort()
    setPhase({ kind: "idle" })
  }

  return (
    <section aria-label="Prepare for card show" data-card-show-prep className="mt-3 text-sm">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="rounded-full border border-border/55 bg-background/55 px-3.5 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground dark:border-white/10"
      >
        Prepare for card show
      </button>

      {open ? (
        <div className="mt-2 space-y-2 rounded-2xl border border-border/55 bg-background/45 p-3 dark:border-white/10">
          <p className="text-xs text-muted-foreground">Save sets on this device so they open without signal: set coverage, card thumbnails and available prices with their history. Prices can still change before the show.</p>

          {candidateSets.length === 0 ? (
            <p className="text-xs text-muted-foreground">Search for a set above first, then pick it here.</p>
          ) : (
            <fieldset disabled={busy} className="space-y-1">
              <legend className="sr-only">Sets to save</legend>
              {candidateSets.map((set) => (
                <label key={set.id} className="flex items-center gap-2 text-xs">
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

          <div role="status" aria-live="polite" className="text-xs">
            {phase.kind === "planning" ? "Checking download size…" : null}
            {phase.kind === "planned"
              ? `${phase.plan.sets.length} set${phase.plan.sets.length === 1 ? "" : "s"} · ${phase.plan.imageUrls.length} card images · about ${formatBytes(phase.plan.estimatedBytes)}`
              : null}
            {phase.kind === "downloading" ? `Downloading ${phase.progress.done}/${phase.progress.total} card images…` : null}
            {phase.kind === "prices" ? `Saving prices ${phase.done}/${phase.total}…` : null}
            {phase.kind === "comps" ? `Saving sold comps for wanted cards ${phase.comps.done}/${phase.comps.total}…` : null}
            {phase.kind === "done"
              ? `Ready offline: ${phase.plan.sets.map((entry) => entry.set.name).join(", ")} (${phase.progress.done - phase.progress.failed}/${phase.progress.total} card images${phase.progress.failed ? `, ${phase.progress.failed} failed` : ""}, ${phase.priced}/${phase.plan.priceLookups.length} cards priced${phase.comps ? `, sold comps for ${phase.comps.fresh + phase.comps.checked}/${phase.comps.total} wanted cards` : ""})`
              : null}
            {phase.kind === "error" ? phase.message : null}
          </div>

          <div className="flex flex-wrap gap-2">
            {phase.kind === "planned" ? (
              <>
                <button type="button" onClick={() => void download(phase.plan)} className="rounded-full border border-primary/35 bg-primary/12 px-3.5 py-2 text-xs font-semibold text-foreground">
                  Download for offline
                </button>
                <button type="button" onClick={cancel} className="rounded-full border border-border/55 px-3.5 py-2 text-xs font-semibold text-muted-foreground">
                  Cancel
                </button>
              </>
            ) : phase.kind === "downloading" || phase.kind === "prices" || phase.kind === "comps" ? (
              <button type="button" onClick={cancel} className="rounded-full border border-border/55 px-3.5 py-2 text-xs font-semibold text-muted-foreground">
                Stop
              </button>
            ) : (
              <button
                type="button"
                disabled={chosenSets.length === 0 || busy || !isOnline || !canStoreOffline}
                onClick={() => void checkSize()}
                className="rounded-full border border-primary/35 bg-primary/12 px-3.5 py-2 text-xs font-semibold text-foreground disabled:opacity-50"
              >
                Check download size
              </button>
            )}
          </div>
        </div>
      ) : null}
    </section>
  )
}
