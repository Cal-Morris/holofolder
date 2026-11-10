"use client"

import { useRef, useState, type ButtonHTMLAttributes } from "react"
import type { InventoryCatalogResolver, InventorySnapshot } from "@/lib/domain/inventory"
import { prepareLayoutIntent, type LayoutAction, type StagedSlotCommandIntent, type SlotCommandSink } from "@/lib/binder-slot-editing"

import { captureBulkSelection, bulkSelectionState, prepareBulkLayoutIntent, savedPageSlotIds, type BulkSelection, type BulkLayoutAction } from "@/lib/binder-bulk-editing"
import { SLOT_LIMITS } from "@/lib/domain/slot-commands"

import BulkFillReview from "@/components/binder/bulk-fill-review"

import { useSlotDraftAcceptance } from "@/hooks/use-slot-draft-acceptance"

export interface LayoutBoundary {
  snapshot: InventorySnapshot
  scope: StagedSlotCommandIntent["scope"]
  catalog: InventoryCatalogResolver
  onCommandIntent: SlotCommandSink
  localDurable?: boolean
  bulkFill?: { available: boolean; receive: SlotCommandSink }
}
const button = "min-h-10 rounded-xl border border-border px-3 py-2 text-sm disabled:opacity-50 hover:bg-muted"

/** A pointer must begin on this mounted edit-session control, and must not become a scroll/drag. */
function LayoutButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  const press = useRef<{ x: number; y: number } | null>(null)
  return <button {...props} type="button" className={button}
    onPointerDown={event => { press.current = { x: event.clientX, y: event.clientY } }}
    onPointerMove={event => { if (press.current && Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > 8) press.current = null }}
    onPointerCancel={() => { press.current = null }}
    onClick={event => {
      const deliberate = event.detail === 0 || press.current !== null
      press.current = null
      if (deliberate) props.onClick?.(event)
    }} />
}

/** Session-only preparation. Closing or Cancel never revokes an already handed-off draft. */
export function LayoutActions({ boundary, onCancel, appendOnly = false }: { boundary: LayoutBoundary; onCancel?: () => void; appendOnly?: boolean }) {
  const { snapshot, scope, catalog, onCommandIntent } = boundary
  const binder = snapshot.binders.find(b => b.collectionId === scope.collectionId)!
  const selected = binder.slots.find(s => s.id === scope.slotId)
  const index = binder.slots.findIndex(s => s.id === scope.slotId)
  const [position, setPosition] = useState("")
  const [anchor, setAnchor] = useState("")
  const [error, setError] = useState<string | null>(null)
  const { pending, busy, message, handoff } = useSlotDraftAcceptance<StagedSlotCommandIntent>(onCommandIntent, () => {
    setError(null); setPosition(""); setAnchor("")
  })
  const emit = (action: LayoutAction) => {
    if (pending || busy) return
    try {
      const prepared = prepareLayoutIntent(snapshot, scope, action, { source: "app", clientId: null, operationId: crypto.randomUUID(), batchId: null, clientOccurredAt: new Date().toISOString() }, catalog)
      handoff({ scope: prepared.scope, intent: prepared.intent })
    } catch (cause) {
      if (cause instanceof Error && cause.message === "layout-capacity") { setError("This binder is at the 4,096-slot limit."); return }
      setError("Layout changed or destination is invalid. Choose a current saved slot or position.")
    }
  }
  const blocked = pending !== null || busy
  return <section aria-label="Layout actions" className="space-y-3">
    {!appendOnly && <>
      <p className="text-sm font-semibold">Editing layout · Slot {index + 1} of {binder.slots.length}</p>
      <p className="text-xs text-muted-foreground">Moves keep the target, owned copy and wants together.</p>
      {selected && <>
        <div className="grid grid-cols-2 gap-2">
          <LayoutButton disabled={blocked} onClick={() => emit({ kind: "insert", anchorId: selected.id, side: "before", newSlotId: crypto.randomUUID() })}>Insert free slot before</LayoutButton>
          <LayoutButton disabled={blocked} onClick={() => emit({ kind: "insert", anchorId: selected.id, side: "after", newSlotId: crypto.randomUUID() })}>Insert free slot after</LayoutButton>
          <LayoutButton disabled={blocked || index === 0} onClick={() => emit({ kind: "move", destination: { kind: "position", position: index } })}>Move earlier</LayoutButton>
          <LayoutButton disabled={blocked || index === binder.slots.length - 1} onClick={() => emit({ kind: "move", destination: { kind: "position", position: index + 2 } })}>Move later</LayoutButton>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1 text-sm">Saved position
            <input aria-label="Saved position" type="number" inputMode="numeric" min={1} max={binder.slots.length} step={1} required value={position} onChange={event => setPosition(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !blocked) { event.preventDefault(); emit({ kind: "move", destination: { kind: "position", position: Number(position) } }) } }} className="mt-1 min-h-10 w-full rounded-lg border border-border bg-background px-2 text-base" />
          </label>
          <LayoutButton disabled={blocked || !position} onClick={() => emit({ kind: "move", destination: { kind: "position", position: Number(position) } })}>Move to position</LayoutButton>
        </div>
        <label className="block text-sm">Saved anchor slot
          <select aria-label="Saved anchor slot" value={anchor} onChange={event => setAnchor(event.target.value)} className="mt-1 min-h-10 w-full min-w-0 rounded-lg border border-border bg-background px-2 text-base">
            <option value="">Choose a slot</option>
            {binder.slots.map((slot, i) => slot.id !== selected.id && <option key={slot.id} value={slot.id}>Slot {i + 1}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <LayoutButton disabled={blocked || !anchor} onClick={() => emit({ kind: "move", destination: { kind: "before", slotId: anchor } })}>Move before</LayoutButton>
          <LayoutButton disabled={blocked || !anchor} onClick={() => emit({ kind: "move", destination: { kind: "after", slotId: anchor } })}>Move after</LayoutButton>
        </div>
      </>}
    </>}
    <LayoutButton disabled={blocked} onClick={() => emit({ kind: "append", newSlotId: crypto.randomUUID() })}>Append free slot</LayoutButton>
    {error && <p role="alert" className="text-sm">{error}</p>}
    {message && <p role={pending ? "alert" : "status"} className="break-words text-sm">{message}</p>}
    {busy && <p role="status">Saving on device…</p>}
    {pending && <LayoutButton disabled={busy} onClick={() => handoff(pending)}>Retry same draft</LayoutButton>}
    {onCancel && <LayoutButton onClick={onCancel}>Cancel selection</LayoutButton>}
    {!appendOnly && <p className="text-xs text-muted-foreground">{boundary.localDurable ? "Accepted edits stay saved on this device. Sync and Undo are separate." : "Internal draft only. Saving, offline sync and Undo are not enabled."}</p>}
  </section>
}

export interface BulkLayoutHost { pageIndex: number; rows: number; cols: number; sessionKey: string; collapsible?: boolean; onPageChange?: (pageIndex: number) => void }

export function LayoutToolbar({ editing, onToggle, boundary, bulk }: { editing: boolean; onToggle: () => void; boundary: LayoutBoundary; bulk?: BulkLayoutHost }) {
  const [bulkOpen, setBulkOpen] = useState(false)
  const showBulk = Boolean(bulk && (!bulk.collapsible || bulkOpen))
  return <section aria-label="Layout editing" className="shrink-0 rounded-xl border border-border bg-card px-3 py-2 text-foreground">
    <div className="flex items-center justify-between gap-2">
      <p role="status" className="text-sm">{editing ? "Editing layout" : "Browse layout"}</p>
      <LayoutButton aria-pressed={editing} onClick={onToggle}>{editing ? "Done" : "Edit layout"}</LayoutButton>
    </div>
    {editing && bulk?.collapsible && <div className="mt-2"><LayoutButton aria-expanded={bulkOpen} onClick={() => setBulkOpen(open => !open)}>{bulkOpen ? "Back to single slot" : "Select several pockets"}</LayoutButton></div>}
    {editing && showBulk && bulk?.onPageChange && <nav aria-label="Selection pages" className="mt-2 flex flex-wrap items-center gap-2">
      <LayoutButton disabled={bulk.pageIndex <= 0} onClick={() => bulk.onPageChange?.(bulk.pageIndex - 1)}>Previous selection page</LayoutButton>
      <LayoutButton disabled={(bulk.pageIndex + 1) * bulk.rows * bulk.cols >= (boundary.snapshot.binders.find(b => b.collectionId === boundary.scope.collectionId)?.slots.length ?? 0)} onClick={() => bulk.onPageChange?.(bulk.pageIndex + 1)}>Next selection page</LayoutButton>
    </nav>}
    {editing && showBulk && bulk ? <BulkLayoutEditor key={`${boundary.scope.ownerUserId}:${boundary.scope.collectionId}:${bulk.sessionKey}:${bulk.rows}:${bulk.cols}`} boundary={boundary} host={bulk} /> : editing && <><p className="mb-2 text-xs text-muted-foreground">Select a slot to insert or move. {boundary.localDurable ? "Save on this device." : "Internal draft only."}</p><LayoutActions boundary={boundary} appendOnly /></>}
  </section>
}


/** Mounted only in an explicit edit session. Host removes it on view/filter/scope changes. */
function BulkLayoutEditor({ boundary, host }: { boundary: LayoutBoundary; host: BulkLayoutHost }) {
  const [selection, setSelection] = useState(() => captureBulkSelection(boundary.snapshot, boundary.scope, []))
  const [attempt, setAttempt] = useState(0)
  return <BulkLayoutControls key={attempt} boundary={boundary} host={host} selection={selection} onSelection={setSelection} onDiscard={() => setAttempt(n => n + 1)} />
}

function BulkLayoutControls({ boundary, host, selection, onSelection, onDiscard }: {
  boundary: LayoutBoundary; host: BulkLayoutHost; selection: BulkSelection; onSelection: (selection: BulkSelection) => void; onDiscard: () => void
}) {
  const { snapshot, scope, catalog } = boundary
  const binder = snapshot.binders.find(b => b.collectionId === scope.collectionId)!
  const ids = selection.slots.map(s => s.slot.id)
  const state = bulkSelectionState(snapshot, scope, selection)
  const pageIds = savedPageSlotIds(snapshot, scope, host.pageIndex, host.rows, host.cols)
  const [fillOpen, setFillOpen] = useState(false)
  const [anchor, setAnchor] = useState("")
  const [count, setCount] = useState("1")
  const [error, setError] = useState<string | null>(null)
  const prepared = useRef<ReturnType<typeof prepareBulkLayoutIntent> | null>(null)
  const { pending, busy, message, handoff } = useSlotDraftAcceptance<StagedSlotCommandIntent>(boundary.onCommandIntent, () => {
    const accepted = prepared.current
    if (accepted) onSelection(captureBulkSelection(accepted.preview, scope, ids))
    setError(null)
  })
  const blocked = busy || pending !== null
  const unavailable = blocked || state !== "current"
  const changeSelection = (next: string[]) => {
    if (unavailable) return
    try { onSelection(captureBulkSelection(snapshot, scope, next)); setError(null) }
    catch { setError("Select at most 256 slots for one atomic action. Nothing was selected from this page.") }
  }
  const emit = (action: BulkLayoutAction) => {
    if (unavailable) return
    try {
      prepared.current = prepareBulkLayoutIntent(snapshot, scope, selection, action, {
        source: "app", clientId: null, operationId: crypto.randomUUID(), batchId: null, clientOccurredAt: new Date().toISOString(),
      }, catalog)
      handoff({ scope: prepared.current.scope, intent: prepared.current.intent })
    } catch (cause) {
      setError(cause instanceof Error && cause.message === "layout-capacity" ? "This would exceed the 4,096-slot limit. Nothing was inserted."
        : "Layout or destination changed, or the group exceeds 256 slots. Nothing was handed off. Review the complete group.")
    }
  }
  const insert = (amount: number, destination: BulkLayoutAction["destination"]) => {
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > SLOT_LIMITS.inserted) { setError("Enter a whole number from 1 to 256. Nothing was inserted."); return }
    emit({ kind: "insert", ids: Array.from({ length: amount }, () => crypto.randomUUID()), destination })
  }
  return <section aria-label="Bulk layout actions" className="mt-3 max-h-[40dvh] space-y-3 overflow-y-auto overscroll-contain pr-1">
    <p role="status" className="sticky top-0 z-10 bg-card py-1 text-sm font-semibold">{ids.length} selected · Page {host.pageIndex + 1}</p>
    <p className="text-xs text-muted-foreground">Select saved slots across pages. Moves keep targets, copies and wants together, in saved order.</p>
    <div className="flex flex-wrap gap-2">
      <LayoutButton key={`page-${host.pageIndex}`} disabled={unavailable || !pageIds.length} onClick={() => changeSelection([...new Set([...ids, ...pageIds])])}>Select page</LayoutButton>
      <LayoutButton disabled={blocked || !ids.length} onClick={() => { onSelection(captureBulkSelection(snapshot, scope, [])); setError(null) }}>Clear selection</LayoutButton>
    </div>
    <div aria-label="Select saved slots" className="grid grid-cols-2 gap-2">
      {pageIds.map(id => {
        const slot = binder.slots.find(s => s.id === id)!
        const position = binder.slots.indexOf(slot) + 1
        return <LayoutButton key={id} aria-label={`Select slot ${position}`} aria-pressed={ids.includes(id)} disabled={unavailable}
          onClick={() => changeSelection(ids.includes(id) ? ids.filter(selected => selected !== id) : [...ids, id])}>
          Slot {position} · {slot.inventoryItemId ? "Occupied" : slot.target ? "Target" : "Free"}{ids.includes(id) ? " · Selected" : ""}
        </LayoutButton>
      })}
    </div>
    {boundary.bulkFill?.available && <LayoutButton disabled={unavailable || !ids.length} onClick={() => setFillOpen(true)}>Fill selected pockets</LayoutButton>}
    {fillOpen && <BulkFillReview boundary={boundary} selection={selection} onClose={() => setFillOpen(false)} />}
    {state === "selection-changed" && <p role="alert" className="text-sm">Selected slots or copies changed. The entire group is blocked. Clear selection and choose again after reviewing the latest contents.</p>}
    {state === "layout-changed" && <>
      <p role="alert" className="text-sm">Layout evidence changed. Your selected copies are unchanged. Review the current order before continuing.</p>
      <LayoutButton disabled={blocked} onClick={() => { onSelection(captureBulkSelection(snapshot, scope, ids)); setAnchor(""); setError(null) }}>Use latest layout</LayoutButton>
    </>}
    <label className="block text-sm">Destination slot
      <select aria-label="Bulk destination slot" disabled={blocked} value={anchor} onChange={event => setAnchor(event.target.value)} className="mt-1 min-h-10 w-full min-w-0 rounded-lg border border-border bg-background px-2 text-base">
        <option value="">Choose a saved slot</option>
        {binder.slots.map((slot, i) => <option key={slot.id} value={slot.id}>Slot {i + 1}{ids.includes(slot.id) ? " · Selected" : ""}</option>)}
      </select>
    </label>
    {ids.includes(anchor) && <p className="text-xs text-muted-foreground">A selected destination cannot anchor a move. Choose another slot.</p>}
    <div className="grid grid-cols-2 gap-2">
      <LayoutButton disabled={unavailable || !ids.length || !anchor || ids.includes(anchor)} onClick={() => emit({ kind: "move", destination: { kind: "before", slotId: anchor } })}>Move group before</LayoutButton>
      <LayoutButton disabled={unavailable || !ids.length || !anchor || ids.includes(anchor)} onClick={() => emit({ kind: "move", destination: { kind: "after", slotId: anchor } })}>Move group after</LayoutButton>
      <LayoutButton disabled={unavailable || !ids.length} onClick={() => emit({ kind: "move", destination: { kind: "beginning" } })}>Move group to beginning</LayoutButton>
      <LayoutButton disabled={unavailable || !ids.length} onClick={() => emit({ kind: "move", destination: { kind: "end" } })}>Move group to end</LayoutButton>
    </div>
    <label className="block text-sm">Free slots to insert
      <input aria-label="Free slots to insert" type="number" inputMode="numeric" min={1} max={256} step={1} value={count} disabled={blocked} onChange={event => setCount(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-border bg-background px-2 text-base" />
    </label>
    <p className="text-xs text-muted-foreground">Insertion shifts every following slot. A page adds {host.rows * host.cols} free slots using this grid; later grid changes repaginate them.</p>
    <div className="grid grid-cols-2 gap-2">
      <LayoutButton disabled={unavailable || !anchor} onClick={() => insert(Number(count), { kind: "before", slotId: anchor })}>Insert N before</LayoutButton>
      <LayoutButton disabled={unavailable || !anchor} onClick={() => insert(Number(count), { kind: "after", slotId: anchor })}>Insert N after</LayoutButton>
      <LayoutButton disabled={unavailable} onClick={() => insert(Number(count), { kind: "end" })}>Append N free slots</LayoutButton>
      <LayoutButton disabled={unavailable || !anchor} onClick={() => insert(host.rows * host.cols, { kind: "before", slotId: anchor })}>Insert page before</LayoutButton>
      <LayoutButton disabled={unavailable || !anchor} onClick={() => insert(host.rows * host.cols, { kind: "after", slotId: anchor })}>Insert page after</LayoutButton>
    </div>
    {error && <p role="alert" className="text-sm">{error}</p>}
    {message && <p role={pending ? "alert" : "status"} className="break-words text-sm">{message}</p>}
    {busy && <p role="status">Saving group on device…</p>}
    {pending && <div className="flex flex-wrap gap-2">
      <LayoutButton disabled={busy} onClick={() => handoff(pending)}>Retry same group</LayoutButton>
      <LayoutButton disabled={busy} onClick={onDiscard}>Discard unaccepted draft</LayoutButton>
    </div>}
    <p className="text-xs text-muted-foreground">{boundary.localDurable ? "Accepted edits stay on this device, pending sync." : "Internal draft only, no durable saving."} Clear/remove with Undo and cross-storage moves are not available here.</p>
  </section>
}
