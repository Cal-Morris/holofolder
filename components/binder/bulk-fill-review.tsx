"use client"

import { useEffect, useRef, useState } from "react"
import { useOverlay, useSwipeToDismiss } from "@/hooks/use-overlay"
import { useSlotDraftAcceptance } from "@/hooks/use-slot-draft-acceptance"
import type { LayoutBoundary } from "@/components/binder/layout-editor"
import type { BulkSelection } from "@/lib/binder-bulk-editing"
import { automaticBulkFillChoices, previewBulkFill, prepareBulkFillIntent, type BulkFillChoices } from "@/lib/binder-bulk-fill"
import { sameValue } from "@/lib/collection/slot-optimistic"

const button = "min-h-10 rounded-xl border border-border px-3 py-2 text-sm disabled:opacity-50"
export default function BulkFillReview({ boundary, selection, onClose }: { boundary: LayoutBoundary; selection: BulkSelection; onClose: () => void }) {
  const [original] = useState(() => structuredClone(boundary.snapshot))
  const [choices, setChoices] = useState<BulkFillChoices>({})
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useOverlay(true, onClose, { containerRef: ref })
  const swipe = useSwipeToDismiss(ref, onClose)
  const stale = !sameValue(original, boundary.snapshot)
  const preview = previewBulkFill(original, boundary.scope, selection, choices, boundary.catalog)
  const { pending, busy, message, handoff } = useSlotDraftAcceptance(async draft => {
    const receipt = await boundary.bulkFill?.receive(draft)
    if (!receipt) throw new Error("durable-acceptance-required")
    return receipt
  }, onClose)
  useEffect(() => {
    if (!boundary.bulkFill?.available) onClose()
    window.addEventListener("offline", onClose)
    return () => window.removeEventListener("offline", onClose)
  }, [boundary.bulkFill?.available, onClose])
  const confirm = () => {
    if (busy || pending || stale || !preview.ready || !boundary.bulkFill?.available) return
    try {
      const draft = prepareBulkFillIntent(original, boundary.scope, selection, choices, {
        source: "app", clientId: null, operationId: crypto.randomUUID(), batchId: null, clientOccurredAt: new Date().toISOString(),
      }, boundary.catalog)
      handoff(draft)
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not prepare this fill. Nothing saved.") }
  }
  return <div className="fixed inset-0 z-40">
    <div data-overlay-backdrop className="absolute inset-0 bg-black/60" onClick={onClose} />
    <div ref={ref} role="dialog" aria-modal="true" aria-label="Review bulk fill"
      className="absolute inset-x-3 bottom-[var(--dock-clearance)] mx-auto flex max-h-[calc(100dvh-var(--top-inset)-var(--dock-clearance)-1rem)] max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-card text-foreground shadow-xl">
      <header data-sheet-grabber {...swipe} className="flex shrink-0 items-center justify-between gap-2 border-b border-border p-3">
        <h2 className="text-sm font-semibold">Review bulk fill</h2>
        <button type="button" aria-label="Close bulk fill" className="h-10 w-10 shrink-0" onClick={onClose}>✕</button>
      </header>
      <div className="shrink-0 space-y-2 border-b border-border p-3">
        <p className="text-sm">Assign recorded Unassigned copies. Occupied pockets stay put. No new copies are created.</p>
        <div className="flex flex-wrap gap-2">
          {pending ? <button type="button" className={button} disabled={busy} onClick={() => handoff(pending)}>Retry same fill</button>
            : <button type="button" className={button} disabled={busy || stale || !preview.ready} onClick={confirm}>Confirm bulk fill</button>}
          <button type="button" className={button} onClick={onClose}>Cancel</button>
        </div>
        {message && <p role="alert" className="text-sm">{message}</p>}
        {busy && <p role="status" className="text-sm">Saving on device…</p>}
        {(stale || preview.error || error) && <p role="alert" className="text-sm">{stale ? "Storage changed. Close and review a fresh selection. Nothing new was saved." : preview.error ?? error}</p>}
      </div>
      <div className="space-y-3 overflow-y-auto overscroll-contain p-3 text-sm [overflow-wrap:anywhere]">
        <button type="button" className={button} disabled={busy || !!pending || stale} onClick={() => { setChoices(automaticBulkFillChoices(original, boundary.scope, selection, boundary.catalog)); setError(null) }}>Preview automatic matches</button>
        <p>Automatic proposals use compatible empty targets only. Review every copy and destination. Free pockets need an explicit choice or Skip.</p>
        {preview.rows.map(row => {
          const slot = selection.slots.find(s => s.slot.id === row.slotId)!.slot
          return <section key={row.slotId} aria-label={`Fill destination ${row.position}`} className="space-y-2 rounded-xl border border-border p-3">
            <p>Slot {row.position} · {row.slotId}</p>
            <p>{slot.inventoryItemId ? `Occupied by ${slot.inventoryItemId}` : slot.target ? `Target: ${slot.target.kind === "pokemon" ? `Pokémon #${slot.target.pokemonId}` : `${slot.target.cardId} · ${slot.target.language ?? "Any language"} · ${slot.target.finish ?? "Any finish"}`}` : "Free pocket, no catalog target"}</p>
            <label className="block">Actual copy for slot {row.position}
              <select aria-label={`Copy for slot ${row.position}`} className="mt-1 min-h-10 w-full min-w-0 rounded-lg border border-border bg-background px-2 text-base"
                value={choices[row.slotId] === null ? "skip" : choices[row.slotId] ?? ""} disabled={busy || !!pending || stale}
                onChange={e => setChoices(c => ({ ...c, [row.slotId]: e.target.value === "skip" ? null : e.target.value }))}>
                <option value="">Choose actual copy</option><option value="skip">Skip, preserve this pocket</option>
                {original.items.map(item => <option key={item.id} value={item.id}>{item.id} · {item.identity.kind === "card" ? `${item.identity.cardId} · ${item.identity.language ?? "Unknown language"} · ${item.identity.finish ?? "Unknown finish"}` : `Pokémon ${item.identity.pokemonId}, unknown printing`} · {item.grading ? "Recorded graded copy" : "No recorded grade"} · {original.placements.some(p => p.inventoryItemId === item.id) ? "Assigned, unavailable" : "Unassigned"}</option>)}
              </select>
            </label>
            <p role={row.reason && !row.skipped ? "status" : undefined}>{row.skipped ? `Skipped, no assignment.${row.reason ? ` ${row.reason}` : ""}` : row.reason ?? `Proposed copy: ${row.itemId}`}</p>
          </section>
        })}
        <p>Confirmation saves one atomic request on this device, pending server sync and a fresh complete read. Closing this review cannot cancel accepted work. Recovery uses Activity when supported, no inverse is promised here.</p>
      </div>
    </div>
  </div>
}
