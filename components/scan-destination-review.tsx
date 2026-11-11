"use client"

import { useLayoutEffect, useRef, useState, type RefObject } from "react"
import { X } from "lucide-react"
import CardImage from "@/components/card-image"
import { CardSelector } from "@/components/binder/lazy-views"
import { useOverlay, useSwipeToDismiss } from "@/hooks/use-overlay"
import { useSlotDraftAcceptance } from "@/hooks/use-slot-draft-acceptance"
import { assertScanCurrent, prepareScanDraft, scanDestinations, type ScanChoice, type ScanDestinationAdmission, type ScanDestinationCapture } from "@/lib/scan-destinations"
import { pickerChoices, pickerCandidate, pickerFinishes, speciesSelectorCard } from "@/lib/slot-picker"
import { matchesCatalogCardId } from "@/lib/card-catalog"
import type { SearchCardResult } from "@/lib/pokemon-card-browse"
import type { CardFinish } from "@/lib/domain/cards"
import { isCardLanguage } from "@/lib/domain/cards"
import type { InventoryCatalogResolver } from "@/lib/domain/inventory"
import type { StagedSlotCommandIntent } from "@/lib/binder-slot-editing"
import { formatCardFinishLabel } from "@/lib/card-labels"
import { describeIdentity, pocketPlace } from "@/lib/pocket-labels"
import { slotDraftFailureMessage } from "@/lib/slot-draft-failure"

/** One thing the scan found: a filled pocket on the page (with its photo crop), or a single scanned card. */
export interface ScanReviewCell { index: number; slotId: string | null; occupied: boolean; candidates: SearchCardResult[]; crop?: string }
interface CellChoice { card?: SearchCardResult; finish?: CardFinish; copy?: string; destination?: string; skip?: boolean }
const cardKey = (card: SearchCardResult) => `${card.id}:${card.language ?? "unknown"}`
const unusedLegacySelect = () => {}
const small = "min-h-9 rounded-xl border border-border/70 px-3 text-xs font-semibold hover:bg-muted disabled:opacity-45"

function scanProblem(cause: unknown) {
  const reason = cause instanceof Error ? cause.message : ""
  if (reason === "scan-stale") return "This page changed after the scan. Close this and scan again. Nothing was added."
  if (reason === "target-mismatch") return "One of these cards doesn't fit the pocket chosen for it. Pick another pocket for it."
  if (reason === "duplicate-scan-destination") return "Two cards are set to go in the same pocket. Change one of them."
  if (reason === "duplicate-scan-copy" || reason === "copy-choice-required" || reason.startsWith("raw-creation-unavailable")) return "Choose which of your copies each card is, then try again."
  return slotDraftFailureMessage(cause)
}

/**
 * What a scan found, card by card: the photo, the card you say it is and the pocket it goes in. A scan never adds
 * anything by itself: only cards you have chosen are added, to the pocket shown, in one save when you press Add.
 */
export default function ScanDestinationReview({ admission, capture, cells, onClose, managed }: {
  admission: ScanDestinationAdmission
  capture: ScanDestinationCapture
  cells: ScanReviewCell[]
  onClose: () => void
  /** Keep one overlay/history entry while capture transitions into review. */
  managed?: { containerRef: RefObject<HTMLDivElement | null>; onBusyChange: (busy: boolean) => void }
}) {
  const ownPanel = useRef<HTMLDivElement>(null)
  const panel = managed?.containerRef ?? ownPanel
  const latest = useRef(admission)
  const pendingCatalog = useRef<InventoryCatalogResolver>(admission.catalog)
  useLayoutEffect(() => { latest.current = admission }, [admission])
  // A single clear match is offered as the card; anything less clear waits for you to choose.
  const [choices, setChoices] = useState<Partial<Record<number, CellChoice>>>(() => Object.fromEntries(cells.filter(c => c.occupied && c.candidates.length === 1).map(c => [c.index, { card: c.candidates[0] }])))
  const [choosing, setChoosing] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const acceptance = useSlotDraftAcceptance<StagedSlotCommandIntent>(async draft => {
    assertScanCurrent(latest.current.snapshot, latest.current.view, capture)
    const receipt = await latest.current.onCommandIntent(draft, pendingCatalog.current)
    if (!receipt || receipt.status !== "saved-on-device" || receipt.operationId !== draft.intent.request.operationId) throw new Error("invalid-local-acceptance")
    return receipt
  }, () => { managed?.onBusyChange(false); onClose() })
  const close = () => { if (!acceptance.busy) onClose() }
  useOverlay(!managed, close, { containerRef: panel })
  useLayoutEffect(() => {
    managed?.onBusyChange(acceptance.busy)
    return () => managed?.onBusyChange(false)
  }, [managed, acceptance.busy])
  useLayoutEffect(() => { panel.current?.focus() }, [panel])
  const swipe = useSwipeToDismiss(panel, close, !acceptance.busy)
  let stale = false
  try { assertScanCurrent(admission.snapshot, admission.view, capture) } catch { stale = true }
  const binder = admission.snapshot.binders.find(b => b.collectionId === admission.view.collectionId)
  const place = (slotId: string) => { const at = capture.orderedSlotIds.indexOf(slotId); return at < 0 ? "A pocket in this binder" : pocketPlace(at, capture.rows, capture.cols) }
  const found = cells.filter(c => c.occupied)
  const update = (index: number, patch: CellChoice) => setChoices(previous => ({ ...previous, [index]: { ...previous[index], ...patch } }))
  const rows = found.map(cell => {
    const choice = choices[cell.index] ?? {}
    const slot = cell.slotId ? binder?.slots.find(s => s.id === cell.slotId) : undefined
    const recorded = Boolean(slot?.inventoryItemId)
    const card = choice.card
    const finishes = card ? pickerFinishes(card) : []
    const finish = choice.finish ?? (finishes.length === 1 ? finishes[0].finish : undefined)
    const identity = card ? { kind: "card" as const, cardId: card.canonicalId ?? card.id, ...(isCardLanguage(card.language) ? { language: card.language } : {}), ...(finish ? { finish } : {}) } : null
    const resolver = (id: string) => card && matchesCatalogCardId(card, id) ? pickerCandidate(card) : admission.catalog(id)
    const copies = identity ? admission.snapshot.items.flatMap(item => pickerChoices({ ...admission.snapshot, items: [item] }, identity, resolver)) : []
    const graded = copies.filter(c => c.label !== "Raw")
    const rawAvailable = !copies.length || copies.some(c => c.label === "Raw")
    const copy = choice.copy ?? (rawAvailable && !graded.length ? "raw" : undefined)
    const pockets = card ? scanDestinations(admission.snapshot, admission.view, card, finish) : []
    // The pocket it was photographed in when the card fits there; otherwise a pocket kept for this card, or your choice.
    const fallback = cell.slotId && pockets.some(p => p.id === cell.slotId) ? `slot:${cell.slotId}` : !cell.slotId && pockets.find(p => p.target) ? `slot:${pockets.find(p => p.target)!.id}` : undefined
    const destination = choice.destination ?? fallback
    const ready = Boolean(card && copy && destination && !choice.skip && !recorded)
    return { cell, choice, slot, recorded, card, finishes, finish, graded, rawAvailable, copy, pockets, destination, ready }
  })
  const adding = rows.filter(r => r.ready)
  const confirm = () => {
    try {
      const selected: ScanChoice[] = adding.map(({ cell, card, finish, copy, destination }) => {
        const existing = copy!.startsWith("copy:") ? admission.snapshot.items.find(i => i.id === copy!.slice(5)) : undefined
        if (copy !== "raw" && !existing) throw new Error("copy-choice-required")
        return { cellIndex: cell.index, slotId: destination === "append" ? null : destination!.slice(5), ...(destination === "append" ? { append: "free" as const } : {}), card: card!, ...(finish ? { finish } : {}),
          copy: existing ? { inventoryItemId: existing.id, itemVersion: existing.version } : "raw" }
      })
      const prepared = prepareScanDraft(admission.snapshot, admission.view, capture, selected,
        { source: "app", clientId: null, operationId: crypto.randomUUID(), batchId: null, clientOccurredAt: new Date().toISOString() }, admission.catalog)
      setError(null)
      pendingCatalog.current = prepared.catalog
      acceptance.handoff({ scope: prepared.scope, intent: prepared.intent })
    } catch (cause) { setError(scanProblem(cause)) }
  }
  const picking = rows.find(r => r.cell.index === choosing)
  const pickingSpecies = picking?.slot?.target?.kind === "pokemon" ? picking.slot.target.pokemonId : null
  const pickingReserved = picking?.slot?.target?.kind === "card" ? picking.slot.target : null
  const locked = stale || acceptance.busy || Boolean(acceptance.pending)
  return <div className="fixed inset-0 z-40">
    <div data-overlay-backdrop className="absolute inset-0 bg-black/55" onClick={close} />
    <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Scanned cards"
      className="absolute inset-x-2 bottom-[var(--dock-clearance)] mx-auto flex max-h-[calc(100dvh-var(--top-inset)-var(--dock-clearance)-1rem)] max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-card text-foreground outline-none">
      <header data-sheet-grabber {...swipe} className="flex shrink-0 items-center gap-2 border-b border-border p-3">
        <div className="min-w-0 flex-1"><h2 className="font-semibold">{found.length === 1 && !found[0].slotId ? "Scanned card" : "Cards on this page"}</h2>
          <p className="text-xs text-muted-foreground">Choose each card, then add them to your binder.</p></div>
        <button type="button" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-muted disabled:opacity-45" disabled={acceptance.busy} aria-label="Close scan review" onClick={close}><X className="h-4 w-4" /></button>
      </header>
      <div className="min-h-0 space-y-2 overflow-y-auto overscroll-contain p-3">
        {stale && <p role="alert" className="text-sm">This page changed after the scan. Close this and scan again.</p>}
        {error && <p role="alert" className="break-words text-sm">{error}</p>}
        {acceptance.pending && acceptance.message && <p role="alert" className="text-sm">{acceptance.message}</p>}
        {found.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No cards were found in the photo. Try again with the whole page in view and good light.</p>}
        {rows.map(({ cell, choice, slot, recorded, card, finishes, finish, graded, rawAvailable, copy, pockets, destination }) => {
          const pocketFor = slot?.target ? slot.target.kind === "pokemon" ? describeIdentity(slot.target).name : "a specific card" : null
          const where = cell.slotId ? place(cell.slotId) : null
          const picture = card?.image ?? cell.crop
          return <section key={cell.index} aria-label={where ?? "Scanned card"} className={`flex gap-3 rounded-2xl border border-border/60 p-2.5 ${choice.skip || recorded ? "opacity-60" : ""}`}>
            <span className="trading-card relative w-16 shrink-0 self-start overflow-hidden rounded-md border border-border/60 bg-muted">
              {/* eslint-disable-next-line @next/next/no-img-element -- a crop of the person's own photo, held in memory */}
              {picture && (card?.image ? <CardImage src={card.image} alt="" fill sizes="64px" className="object-cover" /> : <img src={picture} alt="" className="absolute inset-0 h-full w-full object-cover" />)}
            </span>
            <div className="min-w-0 flex-1 space-y-1.5">
              {where && <p className="text-xs text-muted-foreground">{where}{pocketFor ? ` · for ${pocketFor}` : ""}</p>}
              {recorded ? <p className="text-sm">Already in your binder. Nothing to add.</p> : choice.skip ? <>
                <p className="text-sm text-muted-foreground">Skipped</p>
                <button type="button" className={small} disabled={locked} onClick={() => update(cell.index, { skip: false })}>Include</button>
              </> : !card ? <>
                <p className="text-sm font-semibold">Which card is this?</p>
                {cell.candidates.length > 1 && cell.candidates.length <= 6 && <div role="group" aria-label="Possible matches" className="flex gap-1.5 overflow-x-auto pb-1">
                  {cell.candidates.map(option => <button key={cardKey(option)} type="button" disabled={locked} aria-label={`${option.name}, ${option.set.name} #${option.localId}`} onClick={() => update(cell.index, { card: option, finish: undefined, copy: undefined, destination: undefined })}
                    className="trading-card relative w-12 shrink-0 overflow-hidden rounded border border-border/60 bg-muted">{option.image && <CardImage src={option.image} alt="" fill sizes="48px" className="object-cover" />}</button>)}
                </div>}
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" className={`${small} border-primary/50 bg-primary/15 text-primary`} disabled={locked} onClick={() => setChoosing(cell.index)}>Choose card</button>
                  <button type="button" className={small} disabled={locked} onClick={() => update(cell.index, { skip: true })}>Skip</button>
                </div>
              </> : <>
                <p className="break-words text-sm font-semibold [overflow-wrap:anywhere]">{card.name}</p>
                <p className="break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">{card.set.name}{card.localId ? ` · #${card.localId}` : ""}{finish ? ` · ${formatCardFinishLabel(finish)}` : ""}</p>
                {finishes.length > 1 && <div role="group" aria-label="Which version?" className="flex flex-wrap gap-1.5">
                  {finishes.map(option => <button key={option.finish} type="button" disabled={locked} aria-pressed={finish === option.finish} onClick={() => update(cell.index, { finish: option.finish, copy: undefined, destination: undefined })}
                    className={`${small} aria-pressed:border-primary/50 aria-pressed:bg-primary/15`}>{option.label}</button>)}
                </div>}
                {graded.length > 0 && <div role="group" aria-label="Which copy?" className="flex flex-wrap gap-1.5">
                  {rawAvailable && <button type="button" disabled={locked} aria-pressed={copy === "raw"} onClick={() => update(cell.index, { copy: "raw" })} className={`${small} aria-pressed:border-primary/50 aria-pressed:bg-primary/15`}>An ungraded copy</button>}
                  {graded.map(option => option.selection.kind === "existing" && <button key={option.selection.inventoryItemId} type="button" disabled={locked} aria-pressed={copy === `copy:${option.selection.inventoryItemId}`}
                    onClick={() => update(cell.index, { copy: `copy:${option.selection.kind === "existing" ? option.selection.inventoryItemId : ""}` })} className={`${small} aria-pressed:border-primary/50 aria-pressed:bg-primary/15`}>My {option.label}</button>)}
                </div>}
                {/* Where it goes is always shown. It is only a question when the card doesn't fit where it was photographed. */}
                {destination && (cell.slotId ? destination === `slot:${cell.slotId}` : pockets.length <= 1 && destination !== "append")
                  ? <p className="text-xs">Goes in <span className="font-semibold">{destination === "append" ? "a new pocket at the end" : place(destination.slice(5))}</span></p>
                  : <label className="block text-xs">{cell.slotId && !pockets.some(p => p.id === cell.slotId) ? "This card doesn't fit that pocket. Put it in" : "Put it in"}
                    <select aria-label={`Pocket for ${card.name}`} disabled={locked} value={destination ?? ""} onChange={event => update(cell.index, { destination: event.target.value || undefined })}
                      className="mt-1 min-h-10 w-full min-w-0 rounded-lg border border-border bg-background px-2 text-base md:text-sm">
                      <option value="">Choose a pocket</option>
                      {pockets.map(pocket => <option key={pocket.id} value={`slot:${pocket.id}`}>{place(pocket.id)}{pocket.target ? "" : " · empty pocket"}</option>)}
                      <option value="append">A new pocket at the end</option>
                    </select></label>}
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" className={small} disabled={locked} onClick={() => setChoosing(cell.index)}>Change card</button>
                  <button type="button" className={small} disabled={locked} onClick={() => update(cell.index, { skip: true })}>Skip</button>
                </div>
              </>}
            </div>
          </section>
        })}
      </div>
      <footer className="flex shrink-0 gap-2 border-t border-border p-3">
        <button type="button" className="min-h-11 flex-1 rounded-2xl border border-border/70 px-3 text-sm font-medium disabled:opacity-45" disabled={acceptance.busy} onClick={close}>Cancel</button>
        {acceptance.pending ? <button type="button" className="min-h-11 flex-1 rounded-2xl bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-45" disabled={acceptance.busy || stale} onClick={() => acceptance.handoff(acceptance.pending!)}>Try again</button>
          : <button type="button" className="min-h-11 flex-1 rounded-2xl bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-45" disabled={!adding.length || locked} onClick={confirm}>
            {acceptance.busy ? "Adding…" : adding.length ? `Add ${adding.length} ${adding.length === 1 ? "card" : "cards"}` : "Choose a card to add"}</button>}
      </footer>
    </div>
    {picking && <CardSelector pokemonId={pickingSpecies ?? 0} pokemonName={pickingSpecies ? describeIdentity({ kind: "pokemon", pokemonId: pickingSpecies }).name : ""} onSelect={unusedLegacySelect} onClose={() => setChoosing(null)}
      defaultCardLanguage={pickingReserved?.language} anyCard={pickingSpecies ? undefined : pickingReserved ? { title: "Which card is this?", cardId: pickingReserved.cardId } : { title: "Which card is this?" }}
      native={{ onPick: (card, finish) => {
        update(picking.cell.index, { card: pickingSpecies ? speciesSelectorCard(card, pickingSpecies) : { ...card, dexIds: card.dexIds ?? [] } as SearchCardResult, finish, copy: undefined, destination: undefined, skip: false })
        setChoosing(null)
      } }} />}
  </div>
}
