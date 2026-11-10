"use client"

import { useEffect, useRef, useState } from "react"
import { useOverlay, useSwipeToDismiss } from "@/hooks/use-overlay"
import { displaySlotLabel, type BinderDisplaySlot } from "@/lib/binder-display-model"
import SlotPicker, { type SlotPickerBoundary } from "@/components/binder/slot-picker"
import { LayoutActions, type LayoutBoundary } from "@/components/binder/layout-editor"
import CardImage from "@/components/card-image"
import CardImageZoom from "@/components/card-image-zoom"
import { CARD_PICKER_LANGUAGES } from "@/lib/card-picker-filters"

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
  const identity = slot.item?.identity.kind === "card" ? slot.item.identity : slot.target?.kind === "card" ? slot.target : null
  const language = CARD_PICKER_LANGUAGES.find(l => l.id === identity?.language)?.label
  const name = slot.card?.name ?? slot.pokemon?.name ?? "Empty slot"
  // An editable empty pocket is only a card search: one plain heading, no status or structural controls.
  // Decided once on open: an owned pocket emptied from this sheet stays its detail, never turns into a search.
  const [choosing] = useState(() => Boolean(picker) && !layout && !slot.item)
  const selecting = choosing && Boolean(picker) && !layout && !slot.item
  return <div className="fixed inset-0 z-40">
    <div data-overlay-backdrop className="absolute inset-0 bg-black/60" onClick={onClose} />
    <div ref={ref} role="dialog" aria-modal="true" aria-label={`${displaySlotLabel(slot)} details`} data-slot-id={slot.id}
      className="absolute inset-x-3 bottom-[var(--dock-clearance)] mx-auto flex max-h-[calc(100dvh-var(--top-inset)-var(--dock-clearance)-1rem)] max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-card text-foreground shadow-xl">
      <header data-sheet-grabber {...swipe} className="flex shrink-0 items-center justify-between gap-2 border-b border-border p-3">
        <h2 className="min-w-0 break-words text-sm font-semibold">{selecting ? slot.pokemon || slot.card ? `Add card for ${name}` : "Add a card" : displaySlotLabel(slot)}</h2>
        {layout && <button type="button" onClick={onDoneLayout} className="min-h-10 shrink-0 rounded-xl border border-border px-3 text-sm">Done</button>}
        <button type="button" aria-label="Close slot details" onClick={onClose} className="h-10 w-10 shrink-0 rounded-full hover:bg-muted">✕</button>
      </header>
      <div className="space-y-3 overflow-y-auto overscroll-contain p-4 text-sm">
        {!selecting && <div className="flex items-start gap-4">
          {slot.card?.image && <CardImageZoom src={slot.card.image} alt={name} className="trading-card relative w-20 shrink-0 overflow-hidden rounded-lg border border-border/60 bg-muted sm:w-28"><CardImage key={`${slot.id}:${slot.card.image}`} src={slot.card.image} alt={name} fill sizes="(max-width: 639px) 80px, 112px" className="object-contain" /></CardImageZoom>}
          <div className="min-w-0 space-y-1 break-words [overflow-wrap:anywhere]">
            <h3 className="text-lg font-bold leading-tight">{name}</h3>
            {slot.card && <p className="text-muted-foreground">{slot.card.set?.name ?? "Set unknown"}{slot.card.localId ? ` · #${slot.card.localId}` : ""}</p>}
            {identity && <p className="text-xs text-muted-foreground">{language ?? "Unknown language"} · {identity.finish?.replaceAll("_", " ") ?? "Unknown finish"}</p>}
            <p className="text-xs font-medium">{slot.item ? "Owned copy" : slot.target ? "Unfilled target" : "Empty slot"}</p>
            {/* Only a share's opted-in saved figure; no live price lookup. */}
            {slot.item && slot.card?.savedMarketGBP !== undefined && <p className="text-xs tabular-nums">Saved market estimate: {new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(slot.card.savedMarketGBP)}</p>}
            {slot.card?.rarity && <p className="text-xs text-muted-foreground">{slot.card.rarity}</p>}
            {slot.card?.illustrator && <p className="text-xs text-muted-foreground">Illustrated by {slot.card.illustrator}</p>}
          </div>
        </div>}
        {layout && <LayoutActions boundary={layout} onCancel={onClose} />}
        {layout && <SlotPicker boundary={{ ...layout, scope: { ...layout.scope, slotId: slot.id } }} structural />}
        {picker && !layout && <SlotPicker boundary={picker} choosing={selecting} onDone={onClose} />}
        {grade && <dl className="space-y-1 break-words"><dt>Recorded grading provider</dt><dd>{grade.provider.kind === "known" ? grade.provider.id.toUpperCase() : grade.provider.name}</dd><dt>Grade</dt><dd>{grade.grade ?? "Unknown"}{grade.scale ? ` / ${grade.scale}` : ""}</dd>{grade.designation && <><dt>Designation</dt><dd>{grade.designation}</dd></>}{grade.holder && <><dt>Holder</dt><dd>{grade.holder}</dd></>}{grade.subgrades.map((s, index) => <div key={index}><dt>{s.name}</dt><dd>{s.grade}</dd></div>)}</dl>}
      </div>
    </div>
  </div>
}
