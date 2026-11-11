"use client"

import { useRef, useState } from "react"
import { X } from "lucide-react"
import type { LayoutBoundary } from "@/components/binder/layout-editor"
import CardImage from "@/components/card-image"
import { bulkSelectionState, type BulkSelection } from "@/lib/binder-bulk-editing"
import { prepareSlotRemoval } from "@/lib/binder-slot-removal"
import { useSlotDraftAcceptance } from "@/hooks/use-slot-draft-acceptance"
import { useOverlay, useSwipeToDismiss } from "@/hooks/use-overlay"
import { describeIdentity } from "@/lib/pocket-labels"

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

/**
 * The consequence review before pockets are removed: what goes, and what happens to the cards in them. Owned cards
 * are never deleted by removing a pocket. The exact prepared removal is what Try again resends.
 */
export default function SlotRemovalReview({ boundary, selection, onClose, onRemoved }: {
  boundary: LayoutBoundary; selection: BulkSelection; onClose: () => void; onRemoved?: () => void
}) {
  const [review] = useState(() => {
    try { return { prepared: prepareSlotRemoval(boundary.snapshot, boundary.scope, selection, {
      source: "app", clientId: null, operationId: crypto.randomUUID(), batchId: null, clientOccurredAt: new Date().toISOString(),
    }), error: null } }
    catch { return { prepared: null, error: "That is too many pockets to remove at once. Select fewer pockets and try again. Nothing was removed." } }
  })
  const ref = useRef<HTMLDivElement>(null)
  useOverlay(true, onClose, { containerRef: ref })
  const swipe = useSwipeToDismiss(ref, onClose)
  const { pending, busy, message, handoff } = useSlotDraftAcceptance(async draft => {
    if (!boundary.removal?.available) throw new Error("fresh-scoped-read-required")
    const receipt = await boundary.removal.receive(draft)
    if (!receipt) throw new Error("durable-acceptance-required")
    return receipt
  }, onRemoved ?? onClose)
  let stale = true
  try { stale = bulkSelectionState(boundary.snapshot, boundary.scope, selection) !== "current" } catch { /* A changed owner or collection cannot authorize the retained review. */ }
  const prepared = review.prepared
  const blocked = busy || stale || !boundary.removal?.available
  const counts = prepared?.counts
  return <div className="fixed inset-0 z-40">
    <div data-overlay-backdrop className="absolute inset-0 bg-black/60" onClick={onClose} />
    <div ref={ref} role="dialog" aria-modal="true" aria-label="Remove pockets" tabIndex={-1}
      className="absolute inset-x-3 bottom-[var(--dock-clearance)] mx-auto flex max-h-[calc(100dvh-var(--top-inset)-var(--dock-clearance)-1rem)] max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-card text-foreground shadow-xl">
      <header data-sheet-grabber {...swipe} className="flex shrink-0 items-center justify-between gap-2 border-b border-border p-3">
        <h2 className="text-sm font-semibold">{counts ? `Remove ${plural(counts.slots, "pocket")}?` : "Remove pockets"}</h2>
        <button type="button" aria-label="Close" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-muted" onClick={onClose}><X className="h-4 w-4" /></button>
      </header>
      <div className="min-h-0 space-y-3 overflow-y-auto overscroll-contain p-3 text-sm [overflow-wrap:anywhere]">
        {counts && <ul className="space-y-1.5" aria-label="What happens">
          {counts.unassigned > 0 && <li><span className="font-semibold">{plural(counts.unassigned, "card")} stay{counts.unassigned === 1 ? "s" : ""} in your collection</span>, out of the binder until you place {counts.unassigned === 1 ? "it" : "them"} again.</li>}
          {counts.wants > 0 && <li><span className="font-semibold">{plural(counts.wants, "wanted card")}</span> on {counts.wants === 1 ? "this pocket leaves" : "these pockets leave"} your want list.</li>}
          {counts.targets > 0 && <li>{counts.targets === counts.slots ? "These pockets stop" : `${plural(counts.targets, "pocket")} stop${counts.targets === 1 ? "s" : ""}`} counting towards this binder&apos;s progress.</li>}
          <li className="text-muted-foreground">The pockets after them close up. Everything else keeps its order.</li>
        </ul>}
        {prepared && prepared.rows.some(row => row.item || row.slot.wantedCards.length) && <ul aria-label="Affected cards" className="space-y-1.5">
          {prepared.rows.filter(row => row.item || row.slot.wantedCards.length).map(({ slot, item }) => {
            const card = item ? describeIdentity(item.identity, boundary.resolveCard) : null
            return <li key={slot.id} className="flex items-center gap-3 rounded-xl border border-border/60 p-2">
              {card?.image && <span className="trading-card relative w-9 shrink-0 overflow-hidden rounded bg-muted"><CardImage src={card.image} alt="" fill sizes="36px" className="object-cover" /></span>}
              <span className="min-w-0 flex-1">
                {card && <><span className="block truncate font-semibold">{card.name}</span><span className="block truncate text-xs text-muted-foreground">{card.detail} · stays in your collection</span></>}
                {slot.wantedCards.map((want, index) => <span key={index} className="block truncate text-xs text-amber-700 dark:text-amber-300">Wanted: {want.card_name}</span>)}
              </span>
            </li>
          })}
        </ul>}
        {review.error && <p role="alert">{review.error}</p>}
        {message && <p role="alert">{message}</p>}
        {prepared && (stale || !boundary.removal?.available) && <p role="alert">{stale ? "These pockets changed while this was open. Close this and select them again." : "Your collection is still syncing. Try again in a moment."}</p>}
        <p className="text-xs text-muted-foreground">This can&apos;t be undone with one tap. You can add pockets back and place the cards again.</p>
      </div>
      <footer className="flex shrink-0 gap-2 border-t border-border p-3">
        <button type="button" className="min-h-11 flex-1 rounded-xl border border-border px-3 text-sm font-medium" onClick={onClose}>Keep them</button>
        {prepared && <button type="button" className="min-h-11 flex-1 rounded-xl bg-destructive px-3 text-sm font-semibold text-white disabled:opacity-50" disabled={blocked} onClick={() => handoff(pending ?? prepared)}>
          {busy ? "Removing…" : pending ? "Try again" : `Remove ${plural(prepared.counts.slots, "pocket")}`}
        </button>}
      </footer>
    </div>
  </div>
}
