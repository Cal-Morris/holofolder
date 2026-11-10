"use client"

import { useLayoutEffect, useRef, useState } from "react"
import CardImage from "@/components/card-image"
import type { LayoutBoundary } from "@/components/binder/layout-editor"
import { useOverlay, useSwipeToDismiss } from "@/hooks/use-overlay"
import { useNativeSlotAction } from "@/hooks/use-native-slot-pick"
import { useSlotDraftAcceptance } from "@/hooks/use-slot-draft-acceptance"
import { captureBulkSelection, prepareBulkLayoutIntent } from "@/lib/binder-bulk-editing"
import type { StagedSlotCommandIntent } from "@/lib/binder-slot-editing"
import { displaySlotPreview, type BinderDisplaySlot } from "@/lib/binder-display-model"
import { displaySlotName } from "@/lib/pocket-labels"
import { layoutFailureMessage } from "@/lib/slot-draft-failure"
import type { SlotPickerBoundary } from "@/lib/slot-picker"

const item = "flex min-h-11 w-full items-center rounded-xl px-3 text-left text-sm font-medium hover:bg-muted/70 focus-visible:bg-muted/70 focus-visible:outline-none disabled:opacity-45"

/**
 * The short list of things you can do with one pocket, opened by right-click, the keyboard menu key or a long
 * press. Every action is also reachable from the card's details or from Edit layout, so this is only a shortcut.
 * A sheet on phones, a small menu at the pointer on larger screens.
 */
export default function PocketMenu({ slot, place, point, picker, layout, selected, onOpen, onSelect, onMove, onClose }: {
  slot: BinderDisplaySlot; place: string; point: { x: number; y: number }
  picker?: SlotPickerBoundary; layout?: LayoutBoundary; selected?: boolean
  onOpen: () => void; onSelect?: () => void; onMove?: () => void; onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useOverlay(true, onClose, { containerRef: ref })
  const swipe = useSwipeToDismiss(ref, onClose)
  const [error, setError] = useState<string | null>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const card = useNativeSlotAction(picker, onClose)
  const add = useSlotDraftAcceptance<StagedSlotCommandIntent>(layout?.onCommandIntent ?? (() => { throw new Error("inactive-or-unavailable-session") }), onClose)
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect()
    if (!box || window.innerWidth < 640) return
    setPosition({ left: Math.max(8, Math.min(point.x, window.innerWidth - box.width - 8)), top: Math.max(8, Math.min(point.y, window.innerHeight - box.height - 8)) })
  }, [point.x, point.y])
  const insert = (side: "before" | "after") => {
    if (!layout || add.busy || add.pending) return
    setError(null)
    try {
      const prepared = prepareBulkLayoutIntent(layout.snapshot, layout.scope, captureBulkSelection(layout.snapshot, layout.scope, []),
        { kind: "insert", ids: [crypto.randomUUID()], destination: { kind: side, slotId: slot.id } },
        { source: "app", clientId: null, operationId: crypto.randomUUID(), batchId: null, clientOccurredAt: new Date().toISOString() }, layout.catalog)
      add.handoff({ scope: prepared.scope, intent: prepared.intent })
    } catch (cause) { setError(layoutFailureMessage(cause)) }
  }
  const busy = card.busy || add.busy
  const failure = error ?? (add.pending ? add.message : null) ?? card.failed
  const preview = displaySlotPreview(slot)
  const name = displaySlotName(slot)
  return <div className="fixed inset-0 z-40">
    <div data-overlay-backdrop className="absolute inset-0 bg-black/45 sm:bg-transparent" onClick={onClose} onContextMenu={event => { event.preventDefault(); onClose() }} />
    <div ref={ref} role="dialog" aria-modal="true" aria-label={`${name} pocket options`} style={position ?? undefined}
      className={`absolute inset-x-2 bottom-[calc(var(--dock-clearance)+0.375rem)] max-h-[calc(100dvh-var(--top-inset)-var(--dock-clearance)-1rem)] overflow-y-auto overscroll-contain rounded-[1.35rem] border border-border/70 bg-card p-2 text-foreground shadow-xl outline-none sm:inset-auto sm:w-64 sm:rounded-2xl ${position ? "" : "sm:invisible"}`}>
      <div data-sheet-grabber {...swipe} className="px-2 pb-2 pt-1">
        <div aria-hidden="true" className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-muted-foreground/30 sm:hidden" />
        <div className="flex items-center gap-3">
          {preview.image && <span className={`relative shrink-0 overflow-hidden rounded bg-muted ${preview.isCard ? "trading-card w-8" : "h-9 w-9"}`}><CardImage src={preview.image} alt="" fill sizes="36px" className={preview.isCard ? "object-cover" : "object-contain"} /></span>}
          <div className="min-w-0"><p className="truncate text-sm font-semibold">{name}</p><p className="truncate text-xs text-muted-foreground">{place}</p></div>
        </div>
      </div>
      {failure && <div role="alert" className="mx-1 mb-1 rounded-xl border border-destructive/40 bg-destructive/10 p-2 text-xs">
        <p className="break-words">{failure}</p>
        {(add.pending || card.retry) && <button type="button" className="mt-1 min-h-9 rounded-lg border border-border px-2 font-medium" disabled={busy} onClick={() => add.pending ? add.handoff(add.pending) : card.retry?.()}>Try again</button>}
      </div>}
      <div role="menu" aria-label="Pocket actions" className="grid gap-0.5">
        <button type="button" role="menuitem" className={item} onClick={onOpen}>{slot.item ? "View card" : picker ? "Add a card" : "View details"}</button>
        {picker && slot.item && <button type="button" role="menuitem" className={item} disabled={busy} onClick={() => card.run({ kind: "clear" })}>Take the card out</button>}
        {onMove && <button type="button" role="menuitem" className={item} disabled={busy} onClick={onMove}>Move this pocket</button>}
        {layout && <button type="button" role="menuitem" className={item} disabled={busy} onClick={() => insert("before")}>Add a pocket before</button>}
        {layout && <button type="button" role="menuitem" className={item} disabled={busy} onClick={() => insert("after")}>Add a pocket after</button>}
        {onSelect && <button type="button" role="menuitem" className={item} disabled={busy} onClick={onSelect}>{selected ? "Deselect" : "Select"}</button>}
      </div>
    </div>
  </div>
}
