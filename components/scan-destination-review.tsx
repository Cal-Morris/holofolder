"use client"

import { useLayoutEffect, useRef, useState, type RefObject } from "react"
import { useOverlay, useSwipeToDismiss } from "@/hooks/use-overlay"
import { useSlotDraftAcceptance } from "@/hooks/use-slot-draft-acceptance"
import { assertScanCurrent, prepareScanDraft, scanDestinations, type ScanChoice, type ScanDestinationAdmission, type ScanDestinationCapture } from "@/lib/scan-destinations"
import { pickerChoices, pickerCandidate, pickerFinishes } from "@/lib/slot-picker"
import { matchesCatalogCardId } from "@/lib/card-catalog"
import type { SearchCardResult } from "@/lib/pokemon-card-browse"
import type { CardFinish } from "@/lib/domain/cards"
import { isCardLanguage } from "@/lib/domain/cards"
import type { InventoryCatalogResolver } from "@/lib/domain/inventory"
import type { StagedSlotCommandIntent } from "@/lib/binder-slot-editing"

export interface ScanReviewCell { index: number; slotId: string | null; occupied: boolean; candidates: SearchCardResult[] }
const cardKey = (card: SearchCardResult) => `${card.id}:${card.language ?? "unknown"}`
const control = "min-h-11 max-w-full rounded-xl border border-border bg-background px-3 py-2 text-base disabled:opacity-50"

/** One review, one confirmed batch, no legacy species write callbacks. */
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
  const [choices, setChoices] = useState<Partial<Record<number, { cardId: string; slotId: string; finish: string; copy: string; skip: boolean }>>>({})
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
  const occupied = cells.filter(c => c.occupied)
  const update = (index: number, patch: Partial<NonNullable<(typeof choices)[number]>>) => setChoices(previous => ({ ...previous,
    [index]: { cardId: "", slotId: "", finish: "", copy: "", skip: false, ...previous[index], ...patch } }))
  const ready = occupied.length > 0 && occupied.every(c => choices[c.index]?.skip || (choices[c.index]?.cardId && choices[c.index]?.slotId && choices[c.index]?.copy))
  const confirm = () => {
    try {
      const selected: ScanChoice[] = occupied.filter(c => !choices[c.index]?.skip).map(cell => {
        const choice = choices[cell.index]
        const card = cell.candidates.find(c => cardKey(c) === choice?.cardId)
        if (!card || !choice || !choice.slotId || !choice.copy) throw new Error("scan-unconfirmed")
        const copy = choice.copy === "raw" ? "raw" : admission.snapshot.items.find(i => i.id === choice.copy)
        if (!copy) throw new Error("copy-choice-required")
        const append = choice.slotId === "append-free" ? "free" : choice.slotId === "append-card" ? "card" : undefined
        return { cellIndex: cell.index, slotId: append ? null : choice.slotId, ...(append ? { append } : {}), card, ...(choice.finish ? { finish: choice.finish as CardFinish } : {}),
          copy: copy === "raw" ? "raw" : { inventoryItemId: copy.id, itemVersion: copy.version } }
      })
      const prepared = prepareScanDraft(admission.snapshot, admission.view, capture, selected,
        { source: "app", clientId: null, operationId: crypto.randomUUID(), batchId: null, clientOccurredAt: new Date().toISOString() }, admission.catalog)
      setError(null)
      pendingCatalog.current = prepared.catalog
      acceptance.handoff({ scope: prepared.scope, intent: prepared.intent })
    } catch (cause) { setError(cause instanceof Error ? cause.message : "scan-unconfirmed") }
  }
  return <div className="fixed inset-0 z-40">
    <div data-overlay-backdrop className="absolute inset-0 bg-black/55" onClick={close} />
    <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Review scan destinations"
      className="absolute inset-x-2 bottom-[var(--dock-clearance)] mx-auto flex max-h-[calc(100dvh-var(--top-inset)-var(--dock-clearance)-1rem)] max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-background text-foreground outline-none">
      <header data-sheet-grabber {...swipe} className="flex shrink-0 items-center gap-2 border-b border-border p-3">
        <h2 className="min-w-0 flex-1 font-semibold">Review scan destinations</h2>
        <button className={control} disabled={acceptance.busy} aria-label="Close scan review" onClick={close}>Close</button>
      </header>
      <div className="space-y-3 overflow-y-auto overscroll-contain p-3">
        <p className="text-sm">Choose the exact card, copy and destination for every occupied cell, or skip it. Cells are applied in the review order below; appended slots follow the full saved order without padding. Occupancy alone never adds ownership.</p>
        {stale && <p role="alert">The owner, collection, layout or grid changed. Cancel and capture again.</p>}
        {error && <p role="alert" className="break-words">{error}</p>}
        {acceptance.message && <p role="alert">{acceptance.message}</p>}
        {acceptance.pending && <button className={control} disabled={acceptance.busy || stale} onClick={() => acceptance.handoff(acceptance.pending!)}>Retry same draft</button>}
        <fieldset disabled={stale || acceptance.busy || !!acceptance.pending} className="min-w-0 space-y-3">
          {occupied.length === 0 && <p>No occupied cells to confirm.</p>}
          {occupied.map(cell => {
            const choice = choices[cell.index]
            const card = cell.candidates.find(c => cardKey(c) === choice?.cardId)
            const identity = card ? { kind: "card" as const, cardId: card.canonicalId ?? card.id,
              ...(isCardLanguage(card.language) ? { language: card.language } : {}), ...(choice?.finish ? { finish: choice.finish as CardFinish } : {}) } : null
            const resolver = (id: string) => card && matchesCatalogCardId(card, id) ? pickerCandidate(card) : admission.catalog(id)
            const copies = identity ? admission.snapshot.items.flatMap(item => pickerChoices({ ...admission.snapshot, items: [item] }, identity, resolver)) : []
            const rawUnavailable = copies.length > 0 && !copies.some(c => c.label === "Raw")
            return <section key={cell.index} className="min-w-0 space-y-2 rounded-xl border border-border p-3" aria-label={`Cell ${cell.index + 1}`}>
              <p className="break-words text-sm font-medium">Cell {cell.index + 1} · {cell.slotId ?? "Uncreated pocket"}</p>
              <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={choice?.skip ?? false} onChange={e => update(cell.index, { skip: e.target.checked })} />Skip cell {cell.index + 1}</label>
              {!choice?.skip && <div className="grid min-w-0 gap-2">
                {!cell.candidates.length && <p className="text-sm">Unidentified content. No cached catalog identity is available. Skip or cancel, nothing will be inferred.</p>}
                <select className={control} aria-label={`Card for cell ${cell.index + 1}`} value={choice?.cardId ?? ""} onChange={e => update(cell.index, { cardId: e.target.value, slotId: "", finish: "", copy: "" })}>
                  <option value="">Choose catalog identity</option>{cell.candidates.map(c => <option key={cardKey(c)} value={cardKey(c)}>{c.name} · {c.set.name} · {c.localId} · {c.language ?? "Unknown language"}</option>)}
                </select>
                {card && <>
                  <select className={control} aria-label={`Finish for cell ${cell.index + 1}`} value={choice?.finish ?? ""} onChange={e => update(cell.index, { finish: e.target.value, slotId: "", copy: "" })}>
                    <option value="">Unknown finish</option>{pickerFinishes(card).map(f => <option key={f.finish} value={f.finish}>{f.label}</option>)}
                  </select>
                  <select className={control} aria-label={`Copy for cell ${cell.index + 1}`} value={choice?.copy ?? ""} onChange={e => update(cell.index, { copy: e.target.value })}>
                    <option value="">Choose copy</option><option value="raw" disabled={rawUnavailable}>{rawUnavailable ? "Raw creation unavailable beside graded-only copies" : "Raw, reuse Unassigned or create"}</option>{copies.map(c => c.selection.kind === "existing" && <option key={c.selection.inventoryItemId} value={c.selection.inventoryItemId}>{c.label} · {c.selection.inventoryItemId}</option>)}
                  </select>
                  <select className={control} aria-label={`Destination for cell ${cell.index + 1}`} value={choice?.slotId ?? ""} onChange={e => update(cell.index, { slotId: e.target.value })}>
                    <option value="">Choose destination</option>{scanDestinations(admission.snapshot, admission.view, card, choice?.finish ? choice.finish as CardFinish : undefined).map(s => <option key={s.id} value={s.id}>{s.id}{s.target ? " · Compatible target" : " · Free slot"}{s.id === cell.slotId ? " · Captured cell" : ""}</option>)}
                    <option value="append-free">Append new free slot and assign chosen copy</option>
                    <option value="append-card">Append new card target and assign chosen copy</option>
                  </select>
                </>}
              </div>}
            </section>
          })}
        </fieldset>
      </div>
      <footer className="flex shrink-0 gap-2 border-t border-border p-3">
        <button className={control} disabled={acceptance.busy} onClick={close}>Cancel</button>
        <button className={`${control} flex-1`} disabled={!ready || stale || acceptance.busy || !!acceptance.pending || occupied.every(c => choices[c.index]?.skip)} onClick={confirm}>{acceptance.busy ? "Saving on device…" : "Confirm scan draft"}</button>
      </footer>
    </div>
  </div>
}
