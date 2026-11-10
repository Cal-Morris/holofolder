"use client"

import { useLayoutEffect, useRef, useState, type ButtonHTMLAttributes } from "react"
import dynamic from "next/dynamic"
import { ArrowLeftRight, MoreHorizontal, PencilRuler, Plus, Sparkles, Trash2 } from "lucide-react"
import type { InventoryCatalogResolver, InventorySnapshot } from "@/lib/domain/inventory"
import type { StagedSlotCommandIntent, SlotCommandSink } from "@/lib/binder-slot-editing"
import { captureBulkSelection, bulkSelectionState, prepareBulkLayoutIntent, type BulkSelection, type BulkLayoutAction } from "@/lib/binder-bulk-editing"
import { SLOT_LIMITS } from "@/lib/domain/slot-commands"
import { useSlotDraftAcceptance } from "@/hooks/use-slot-draft-acceptance"
import { useNativeSlotAction } from "@/hooks/use-native-slot-pick"
import { layoutFailureMessage } from "@/lib/slot-draft-failure"
import type { CardNamer } from "@/lib/pocket-labels"
import { cn } from "@/lib/utils"

const SlotRemovalReview = dynamic(() => import("@/components/binder/slot-removal-review"), { ssr: false })
const BulkFillReview = dynamic(() => import("@/components/binder/bulk-fill-review"), { ssr: false })
const PocketReserve = dynamic(() => import("@/components/binder/pocket-reserve"), { ssr: false })

export interface LayoutBoundary {
  snapshot: InventorySnapshot
  scope: StagedSlotCommandIntent["scope"]
  catalog: InventoryCatalogResolver
  onCommandIntent: SlotCommandSink
  localDurable?: boolean
  removal?: { available: boolean; receive: SlotCommandSink }
  bulkFill?: { available: boolean; receive: SlotCommandSink }
  /** Names and artwork for the cards in this read, so reviews show cards instead of IDs. */
  resolveCard?: CardNamer
}

/** How the binder grid talks to the bar while editing: a tapped pocket is a selection toggle or a move destination. */
export type LayoutTap = (slotId: string) => void
export interface LayoutEditHost { rows: number; cols: number }
export interface LayoutSessionStart { ids: readonly string[]; moving: boolean }

const button = "inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-border/70 px-2.5 text-xs font-semibold hover:bg-muted disabled:opacity-45"

/** A pointer must begin on this mounted control, and must not become a scroll or drag. */
function LayoutButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  const press = useRef<{ x: number; y: number } | null>(null)
  return <button {...props} type="button" className={cn(button, props.className)}
    onPointerDown={event => { press.current = { x: event.clientX, y: event.clientY } }}
    onPointerMove={event => { if (press.current && Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > 8) press.current = null }}
    onPointerCancel={() => { press.current = null }}
    onClick={event => {
      const deliberate = event.detail === 0 || press.current !== null
      press.current = null
      if (deliberate) props.onClick?.(event)
    }} />
}

const menuItem = "flex min-h-11 w-full items-center rounded-xl px-3 text-left text-sm font-medium hover:bg-muted/70 disabled:opacity-45"

/**
 * Layout editing lives on the binder itself. Browsing shows one small control; editing shows one compact bar with
 * the count, the actions that apply and Done, while the pockets on the page are the selection.
 */
export function LayoutToolbar({ editing, onToggle, boundary, host, start, onTap, onSelection }: {
  editing: boolean; onToggle: () => void; boundary: LayoutBoundary; host: LayoutEditHost
  /** The bar hands the host its pocket-tap handler while it is mounted, and null when it leaves. */
  start?: LayoutSessionStart; onTap: (tap: LayoutTap | null) => void; onSelection: (ids: readonly string[], moving: boolean) => void
}) {
  if (!editing) return <section aria-label="Layout editing" className="flex shrink-0 justify-end"><LayoutButton aria-label="Edit layout" title="Edit layout" aria-pressed={false} onClick={onToggle}
    className="h-9 w-9 rounded-lg border-0 p-0 text-muted-foreground hover:bg-muted/60"><PencilRuler className="h-4 w-4" aria-hidden /></LayoutButton></section>
  return <LayoutBar boundary={boundary} host={host} start={start} onTap={onTap} onSelection={onSelection} onDone={onToggle} />
}

function safeCapture(boundary: LayoutBoundary, ids: readonly string[]) {
  const binder = boundary.snapshot.binders.find(b => b.collectionId === boundary.scope.collectionId)
  const live = new Set(binder?.slots.map(s => s.id))
  return captureBulkSelection(boundary.snapshot, boundary.scope, [...new Set(ids)].filter(id => live.has(id)).slice(0, SLOT_LIMITS.affected))
}

function LayoutBar({ boundary, host, start, onTap, onSelection, onDone }: {
  boundary: LayoutBoundary; host: LayoutEditHost; start?: LayoutSessionStart; onTap: (tap: LayoutTap | null) => void
  onSelection: (ids: readonly string[], moving: boolean) => void; onDone: () => void
}) {
  const { snapshot, scope, catalog } = boundary
  const binder = snapshot.binders.find(b => b.collectionId === scope.collectionId)!
  const [selection, setSelection] = useState<BulkSelection>(() => safeCapture(boundary, start?.ids ?? []))
  const [moving, setMoving] = useState(() => Boolean(start?.moving && start.ids.length))
  const [menu, setMenu] = useState<"add" | "more" | null>(null)
  const [sheet, setSheet] = useState<"remove" | "fill" | "reserve" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const prepared = useRef<ReturnType<typeof prepareBulkLayoutIntent> | null>(null)
  const ids = selection.slots.map(s => s.slot.id)
  let state: ReturnType<typeof bulkSelectionState> = "selection-changed"
  try { state = bulkSelectionState(snapshot, scope, selection) } catch { /* A changed owner or collection ends this selection. */ }
  const { pending, busy, message, handoff, discard } = useSlotDraftAcceptance<StagedSlotCommandIntent>(boundary.onCommandIntent, () => {
    const accepted = prepared.current
    if (accepted) setSelection(captureBulkSelection(accepted.preview, scope, ids))
    setMoving(false); setError(null)
  })
  const blocked = busy || pending !== null
  const unavailable = blocked || state !== "current"
  const single = ids.length === 1 ? binder.slots.find(s => s.id === ids[0]) : undefined
  const pocket = useNativeSlotAction(single ? { snapshot, scope: { ...scope, slotId: single.id }, catalog, onCommandIntent: boundary.onCommandIntent } : undefined, () => setError(null))
  const select = (next: readonly string[]) => {
    try { setSelection(captureBulkSelection(snapshot, scope, next)); setError(null) }
    catch { setError(`You can select up to ${SLOT_LIMITS.affected} pockets at once.`) }
  }
  const emit = (action: BulkLayoutAction) => {
    if (unavailable) return
    setMenu(null)
    try {
      prepared.current = prepareBulkLayoutIntent(snapshot, scope, selection, action, {
        source: "app", clientId: null, operationId: crypto.randomUUID(), batchId: null, clientOccurredAt: new Date().toISOString(),
      }, catalog)
      handoff({ scope: prepared.current.scope, intent: prepared.current.intent })
    } catch (cause) { setError(layoutFailureMessage(cause)) }
  }
  const insert = (amount: number, destination: BulkLayoutAction["destination"]) => emit({ kind: "insert", ids: Array.from({ length: amount }, () => crypto.randomUUID()), destination })
  const tap = (slotId: string) => {
    if (blocked) return
    if (state !== "current") { setError("These pockets changed. Update the selection to carry on."); return }
    if (!moving) { select(ids.includes(slotId) ? ids.filter(id => id !== slotId) : [...ids, slotId]); return }
    if (ids.includes(slotId)) { setError("Tap a pocket that isn't selected."); return }
    emit({ kind: "move", destination: { kind: "before", slotId } })
  }
  useLayoutEffect(() => { onTap(tap); return () => onTap(null) })
  const selectionKey = ids.join(",")
  // The grid draws the selection; it only needs the IDs and whether a tap now picks a destination.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { onSelection(ids, moving) }, [selectionKey, moving])
  const ordered = binder.slots.filter(s => ids.includes(s.id))
  const first = ordered[0]?.id, last = ordered[ordered.length - 1]?.id
  const page = host.rows * host.cols
  const count = ids.length === 0 ? "Tap pockets to select" : `${ids.length} selected`
  const failure = error ?? (pending ? message : null) ?? pocket.failed
  return <section aria-label="Layout editing" data-layout-bar className="relative shrink-0 rounded-2xl border border-border/70 bg-card/95 px-2 py-1.5 text-foreground shadow-sm">
    <div className="flex flex-wrap items-center gap-1.5">
      <p role="status" className="order-1 min-w-0 flex-1 truncate px-1 text-sm font-semibold">{moving ? `Tap where ${ids.length === 1 ? "it goes" : "they go"}` : count}</p>
      {/* Phones: the count and Done on one row, the actions on the next. Wider screens: a single row. */}
      <div className="order-3 flex w-full flex-wrap items-center gap-1.5 sm:order-2 sm:w-auto">
        {moving ? <>
          <LayoutButton disabled={unavailable} onClick={() => emit({ kind: "move", destination: { kind: "beginning" } })}>To the start</LayoutButton>
          <LayoutButton disabled={unavailable} onClick={() => emit({ kind: "move", destination: { kind: "end" } })}>To the end</LayoutButton>
        </> : <>
          <LayoutButton disabled={unavailable || !ids.length || ids.length === binder.slots.length} onClick={() => { setMenu(null); setMoving(true); setError(null) }}><ArrowLeftRight className="h-3.5 w-3.5" aria-hidden />Move</LayoutButton>
          <LayoutButton aria-haspopup="menu" aria-expanded={menu === "add"} disabled={unavailable} onClick={() => setMenu(menu === "add" ? null : "add")}><Plus className="h-3.5 w-3.5" aria-hidden />Add</LayoutButton>
          {boundary.bulkFill?.available && ids.length > 0 && <LayoutButton disabled={unavailable} onClick={() => { setMenu(null); setSheet("fill") }}><Sparkles className="h-3.5 w-3.5" aria-hidden />Fill</LayoutButton>}
          {boundary.removal && <LayoutButton disabled={unavailable || !ids.length || !boundary.removal.available} onClick={() => { setMenu(null); setSheet("remove") }}><Trash2 className="h-3.5 w-3.5" aria-hidden />Remove</LayoutButton>}
          {single && <LayoutButton aria-label="More pocket options" aria-haspopup="menu" aria-expanded={menu === "more"} disabled={unavailable} className="w-9 px-0" onClick={() => setMenu(menu === "more" ? null : "more")}><MoreHorizontal className="h-4 w-4" aria-hidden /></LayoutButton>}
        </>}
      </div>
      {moving ? <LayoutButton className="order-2 sm:order-3" onClick={() => { setMoving(false); setError(null) }}>Cancel</LayoutButton>
        : <LayoutButton aria-pressed onClick={onDone} className="order-2 border-primary/50 bg-primary/15 text-primary sm:order-3">Done</LayoutButton>}
    </div>
    {menu === "add" && <div role="menu" aria-label="Add an empty pocket" className="mt-1.5 grid gap-0.5 rounded-xl border border-border/60 bg-background/60 p-1 sm:grid-cols-2">
      {first && <button type="button" role="menuitem" className={menuItem} onClick={() => insert(1, { kind: "before", slotId: first })}>Before the selection</button>}
      {last && <button type="button" role="menuitem" className={menuItem} onClick={() => insert(1, { kind: "after", slotId: last })}>After the selection</button>}
      <button type="button" role="menuitem" className={menuItem} onClick={() => insert(1, { kind: "end" })}>At the end of the binder</button>
      {first && <button type="button" role="menuitem" className={menuItem} onClick={() => insert(page, { kind: "before", slotId: first })}>A new page before ({page} pockets)</button>}
      <button type="button" role="menuitem" className={menuItem} onClick={() => insert(page, { kind: "end" })}>A new page at the end ({page} pockets)</button>
    </div>}
    {menu === "more" && single && <div role="menu" aria-label="Pocket options" className="mt-1.5 grid gap-0.5 rounded-xl border border-border/60 bg-background/60 p-1">
      {!single.inventoryItemId && <button type="button" role="menuitem" className={menuItem} onClick={() => { setMenu(null); setSheet("reserve") }}>{single.target ? "Change what goes here" : "Choose what goes here"}</button>}
      {single.target && !single.inventoryItemId && <button type="button" role="menuitem" className={menuItem} disabled={pocket.busy} onClick={() => { setMenu(null); pocket.run({ kind: "target", target: null }) }}>Let any card go here</button>}
      {single.inventoryItemId && <button type="button" role="menuitem" className={cn(menuItem, "flex-col items-start justify-center")} disabled={pocket.busy} onClick={() => { setMenu(null); pocket.run({ kind: "clear" }) }}>
        <span>Take the card out</span><span className="text-xs font-normal text-muted-foreground">It stays in your collection.</span>
      </button>}
    </div>}
    {state !== "current" && !blocked && <div role="alert" className="mt-1.5 flex flex-wrap items-center gap-2 px-1 text-xs">
      <span className="min-w-0 flex-1">These pockets changed since you selected them.</span>
      <LayoutButton onClick={() => { setSelection(safeCapture(boundary, ids)); setMoving(false); setError(null) }}>Update selection</LayoutButton>
    </div>}
    {failure && <div role="alert" className="mt-1.5 flex flex-wrap items-center gap-2 px-1 text-xs">
      <span className="min-w-0 flex-1 break-words">{failure}</span>
      {pending && <LayoutButton disabled={busy} onClick={() => handoff(pending)}>Try again</LayoutButton>}
      {pending && <LayoutButton disabled={busy} onClick={() => { discard(); setError(null) }}>Discard</LayoutButton>}
      {!pending && pocket.retry && <LayoutButton disabled={pocket.busy} onClick={pocket.retry}>Try again</LayoutButton>}
      {!pending && pocket.failed && <LayoutButton disabled={pocket.busy} onClick={pocket.dismiss}>Dismiss</LayoutButton>}
    </div>}
    {sheet === "remove" && <SlotRemovalReview boundary={boundary} selection={selection} onClose={() => setSheet(null)} onRemoved={() => { setSheet(null); setSelection(captureBulkSelection(snapshot, scope, [])) }} />}
    {sheet === "fill" && <BulkFillReview boundary={boundary} selection={selection} grid={host} onClose={() => setSheet(null)} />}
    {sheet === "reserve" && single && <PocketReserve boundary={{ snapshot, scope: { ...scope, slotId: single.id }, catalog, onCommandIntent: boundary.onCommandIntent }} onClose={() => setSheet(null)} />}
  </section>
}
