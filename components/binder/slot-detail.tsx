"use client"

import { useEffect, useRef } from "react"
import { useOverlay, useSwipeToDismiss } from "@/hooks/use-overlay"
import { displaySlotLabel, type BinderDisplaySlot } from "@/lib/binder-display-model"
import SlotPicker, { type SlotPickerBoundary } from "@/components/binder/slot-picker"
import { LayoutActions, type LayoutBoundary } from "@/components/binder/layout-editor"
import CardImage from "@/components/card-image"

export default function SlotDetail({ slot, onClose, picker, layout, onDoneLayout }: { slot: BinderDisplaySlot; onClose: () => void; picker?: SlotPickerBoundary; layout?: LayoutBoundary; onDoneLayout?: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useOverlay(true, onClose, { containerRef: ref })
  const swipe = useSwipeToDismiss(ref, onClose)
  const editable = Boolean(picker || layout)
  useEffect(() => {
    if (!editable) return
    window.addEventListener("offline", onClose)
    return () => window.removeEventListener("offline", onClose)
  }, [editable, onClose])
  const grade = slot.item?.grading
  return <div className="fixed inset-0 z-40">
    <div data-overlay-backdrop className="absolute inset-0 bg-black/60" onClick={onClose} />
    <div ref={ref} role="dialog" aria-modal="true" aria-label={`${displaySlotLabel(slot)} details`} data-slot-id={slot.id}
      className="absolute inset-x-3 bottom-[var(--dock-clearance)] mx-auto flex max-h-[calc(100dvh-var(--top-inset)-var(--dock-clearance)-1rem)] max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-card text-foreground shadow-xl">
      <header data-sheet-grabber {...swipe} className="flex shrink-0 items-center justify-between gap-2 border-b border-border p-3">
        <h2 className="min-w-0 break-words text-sm font-semibold">{displaySlotLabel(slot)}</h2>
        {layout && <button type="button" onClick={onDoneLayout} className="min-h-10 shrink-0 rounded-xl border border-border px-3 text-sm">Done</button>}
        <button type="button" aria-label="Close slot details" onClick={onClose} className="h-10 w-10 shrink-0 rounded-full hover:bg-muted">✕</button>
      </header>
      <div className="space-y-3 overflow-y-auto overscroll-contain p-4 text-sm">
        {slot.card?.image && <div className="relative mx-auto h-40 w-28"><CardImage key={`${slot.id}:${slot.card.image}`} src={slot.card.image} alt={slot.card.name} fill sizes="112px" className="object-contain" /></div>}
        {layout && <LayoutActions boundary={layout} onCancel={onClose} />}
        {picker && <SlotPicker key={picker.snapshot.inventoryRevision} boundary={picker} />}
        <p>{slot.item ? "Owned copy" : slot.target ? "Unfilled target, no owned copy assigned" : "Empty spacer, no target or owned copy"}</p>
        {slot.item?.identity.kind === "card" && <p className="break-words [overflow-wrap:anywhere]">Printing: {slot.item.identity.cardId}<br />{slot.item.identity.language ?? "Unknown language"} · {slot.item.identity.finish?.replaceAll("_", " ") ?? "Unknown finish"}</p>}
        {slot.item && <p>Copy: {slot.item.id}</p>}
        {grade && <dl className="space-y-1 break-words"><dt>Recorded grading provider</dt><dd>{grade.provider.kind === "known" ? grade.provider.id.toUpperCase() : grade.provider.name}</dd><dt>Grade</dt><dd>{grade.grade ?? "Unknown"}{grade.scale ? ` / ${grade.scale}` : ""}</dd>{grade.designation && <><dt>Designation</dt><dd>{grade.designation}</dd></>}{grade.holder && <><dt>Holder</dt><dd>{grade.holder}</dd></>}{grade.subgrades.map((s, index) => <div key={index}><dt>{s.name}</dt><dd>{s.grade}</dd></div>)}</dl>}
      </div>
    </div>
  </div>
}
