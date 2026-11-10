"use client"

import { useRef, useState } from "react"
import type { LayoutBoundary } from "@/components/binder/layout-editor"
import { bulkSelectionState, type BulkSelection } from "@/lib/binder-bulk-editing"
import { prepareSlotRemoval } from "@/lib/binder-slot-removal"
import { useSlotDraftAcceptance } from "@/hooks/use-slot-draft-acceptance"
import { useOverlay, useSwipeToDismiss } from "@/hooks/use-overlay"

const button = "min-h-10 rounded-xl border border-border px-3 py-2 text-sm disabled:opacity-50"

/** Single-slot review stays inside its existing sheet; bulk uses one deliberate review sheet. */
export default function SlotRemovalReview({ boundary, selection, onClose, embedded = false }: {
  boundary: LayoutBoundary; selection: BulkSelection; onClose: () => void; embedded?: boolean
}) {
  const [review] = useState(() => {
    try { return { prepared: prepareSlotRemoval(boundary.snapshot, boundary.scope, selection, {
      source: "app", clientId: null, operationId: crypto.randomUUID(), batchId: null, clientOccurredAt: new Date().toISOString(),
    }), error: null } }
    catch { return { prepared: null, error: "This entire selection is unsupported or changed. One removal supports at most 256 work units: each slot plus each assigned copy. Nothing was handed off. Choose a smaller selection and review again." } }
  })
  const ref = useRef<HTMLDivElement>(null)
  useOverlay(!embedded, onClose, { containerRef: ref })
  const swipe = useSwipeToDismiss(ref, onClose, !embedded)
  const { pending, busy, message, handoff } = useSlotDraftAcceptance(async draft => {
    if (!boundary.removal?.available) throw new Error("fresh-scoped-read-required")
    const receipt = await boundary.removal.receive(draft)
    if (!receipt) throw new Error("durable-acceptance-required")
    return receipt
  }, onClose)
  let stale = true
  try { stale = bulkSelectionState(boundary.snapshot, boundary.scope, selection) !== "current" } catch { /* Changed owner/collection cannot authorize the retained review. */ }
  const prepared = review.prepared
  const blocked = busy || stale || !boundary.removal?.available
  const content = <>
    <div className="shrink-0 space-y-2 border-b border-border p-3">
      {prepared && <>
        <p className="text-sm" role="status">Slots to remove: {prepared.counts.slots} · Targets to remove: {prepared.counts.targets} · Explicit wants to remove: {prepared.counts.wants} · Owned copies becoming Unassigned: {prepared.counts.unassigned}</p>
        <p className="text-sm">Every owned copy stays in Inventory with its grade and source metadata. Remaining slots keep their order, targets and wants. The original preset manifest stays unchanged; progress uses the remaining current targets.</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={button} disabled={blocked} onClick={() => handoff(pending ?? prepared)}>{pending ? "Retry same removal" : "Confirm slot removal"}</button>
          <button type="button" className={button} onClick={onClose}>Cancel removal</button>
        </div>
      </>}
      {busy && <p role="status" className="text-sm">Saving on device…</p>}
      {message && <p role="alert" className="text-sm">{message}</p>}
      {review.error && <p role="alert" className="text-sm">{review.error}</p>}
      {(stale || !boundary.removal?.available) && <p role="alert" className="text-sm">Current storage or session is unavailable or changed. This review is blocked. Close and review current storage before a new removal.</p>}
    </div>
    <div className="space-y-3 overflow-y-auto overscroll-contain p-3 text-sm [overflow-wrap:anywhere]">
      {prepared?.rows.map(({ slot, item, position }) => <section key={slot.id} aria-label={`Remove saved slot ${position}`} className="space-y-1 rounded-xl border border-border p-3">
        <p>Slot {position} · {slot.id}</p>
        <p>{slot.target ? `Target to remove: ${slot.target.kind === "pokemon" ? `Pokémon #${slot.target.pokemonId}` : `${slot.target.cardId} · ${slot.target.language ?? "Any language"} · ${slot.target.finish ?? "Any finish"}`}` : "No target"}</p>
        {slot.wantedCards.length ? <ul>{slot.wantedCards.map((want, i) => <li key={i}>Want to remove: {want.card_name} · {want.card_id} · {want.card_language ?? "Any language"} · {want.card_finish ?? "Any finish"}</li>)}</ul> : <p>No explicit wants</p>}
        <p>{item ? `Copy ${item.id} becomes Unassigned · ${item.identity.kind === "card" ? item.identity.cardId : `Pokémon #${item.identity.pokemonId}, unknown printing`} · ${item.grading ? "Recorded graded copy, metadata retained" : "Raw or unknown grade, metadata retained"}` : "No assigned owned copy"}</p>
      </section>)}
      <p>Confirmation saves one atomic removal on this device, pending sync. Closing cannot cancel accepted work. After synchronization, use Find acknowledged change, open the exact recorded entry and choose Review recovery when supported, then confirm its current preview. Recovery may be unavailable or blocked by newer edits. No instant Undo is promised.</p>
      {!prepared && <button type="button" className={button} onClick={onClose}>Cancel removal</button>}
    </div>
  </>
  if (embedded) return <section aria-label="Review slot removal" className="space-y-2 rounded-xl border border-border">{content}</section>
  return <div className="fixed inset-0 z-40">
    <div data-overlay-backdrop className="absolute inset-0 bg-black/60" onClick={onClose} />
    <div ref={ref} role="dialog" aria-modal="true" aria-label="Review slot removal" tabIndex={-1}
      className="absolute inset-x-3 bottom-[var(--dock-clearance)] mx-auto flex max-h-[calc(100dvh-var(--top-inset)-var(--dock-clearance)-1rem)] max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-card text-foreground shadow-xl">
      <header data-sheet-grabber {...swipe} className="flex shrink-0 items-center justify-between gap-2 border-b border-border p-3">
        <h2 className="text-sm font-semibold">Review slot removal</h2>
        <button type="button" aria-label="Close slot removal" className="h-10 w-10 shrink-0" onClick={onClose}>✕</button>
      </header>
      {content}
    </div>
  </div>
}
