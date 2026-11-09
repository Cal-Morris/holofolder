"use client"

import { useRef, useState, type ButtonHTMLAttributes } from "react"
import type { InventoryCatalogResolver, InventorySnapshot } from "@/lib/domain/inventory"
import { prepareLayoutIntent, type LayoutAction, type StagedSlotCommandIntent } from "@/lib/binder-slot-editing"

export interface LayoutBoundary {
  snapshot: InventorySnapshot
  scope: StagedSlotCommandIntent["scope"]
  catalog: InventoryCatalogResolver
  onCommandIntent: (draft: StagedSlotCommandIntent) => void
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
  const [pending, setPending] = useState<StagedSlotCommandIntent | null>(null)
  const handoff = (draft: StagedSlotCommandIntent) => {
    try {
      onCommandIntent(draft)
      setPending(null); setError(null); setPosition(""); setAnchor("")
    } catch {
      setPending(draft)
      setError("Draft could not be handed off. Nothing is confirmed. Retry the same draft, or choose Done to discard this unaccepted draft.")
    }
  }
  const emit = (action: LayoutAction) => {
    if (pending) return
    try {
      const prepared = prepareLayoutIntent(snapshot, scope, action, { source: "app", clientId: null, operationId: crypto.randomUUID(), batchId: null, clientOccurredAt: new Date().toISOString() }, catalog)
      handoff({ scope: prepared.scope, intent: prepared.intent })
    } catch (cause) {
      if (cause instanceof Error && cause.message === "layout-capacity") { setError("This binder is at the 4,096-slot limit."); return }
      setError("Layout changed or destination is invalid. Choose a current saved slot or position.")
    }
  }
  const blocked = pending !== null
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
    {pending && <LayoutButton onClick={() => handoff(pending)}>Retry same draft</LayoutButton>}
    {onCancel && <LayoutButton onClick={onCancel}>Cancel selection</LayoutButton>}
    {!appendOnly && <p className="text-xs text-muted-foreground">Internal draft only. Saving, offline sync and Undo are not enabled.</p>}
  </section>
}

export function LayoutToolbar({ editing, onToggle, boundary }: { editing: boolean; onToggle: () => void; boundary: LayoutBoundary }) {
  return <section aria-label="Layout editing" className="shrink-0 rounded-xl border border-border bg-card px-3 py-2 text-foreground">
    <div className="flex items-center justify-between gap-2">
      <p role="status" className="text-sm">{editing ? "Editing layout" : "Browse layout"}</p>
      <LayoutButton aria-pressed={editing} onClick={onToggle}>{editing ? "Done" : "Edit layout"}</LayoutButton>
    </div>
    {editing && <><p className="mb-2 text-xs text-muted-foreground">Select a slot to insert or move. Internal draft only.</p><LayoutActions boundary={boundary} appendOnly /></>}
  </section>
}
