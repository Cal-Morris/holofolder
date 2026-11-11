"use client"

import CardImage from "@/components/card-image"
import { BinderSlotGlare, TRADING_CARD_CORNER_RADIUS } from "@/components/binder/pokemon-slot"
import { displaySlotLabel, displaySlotPreview, type ReadOnlyDisplaySlot } from "@/lib/binder-display-model"
import type { BinderCardDisplay } from "@/lib/selected-slot-card-display"
import { useId, useRef, type CSSProperties } from "react"

/** Browse-only slot. No drag, long-press, placement or ownership callbacks. */
export function OrderedSlot({ slot, slotLabel, selected, onSelect, imageSizes, glareStyle, glare, interactionKey, cardDisplay, priceLabel }: { priceLabel?: string | null; cardDisplay?: BinderCardDisplay; interactionKey?: string; slot: ReadOnlyDisplaySlot; slotLabel?: string; selected: boolean; onSelect: (id: string) => void; imageSizes: string; glareStyle: CSSProperties; glare: boolean }) {
  const coordinateId = useId()
  const press = useRef<{ key: string | undefined; x: number; y: number } | null>(null)
  const { image, isCard: hasCardImage, tone } = displaySlotPreview(slot, cardDisplay)
  return <button type="button" data-slot-id={slot.id} aria-label={displaySlotLabel(slot)} aria-describedby={slotLabel ? coordinateId : undefined} aria-pressed={selected} draggable={false}
    onPointerDown={event => { press.current = { key: interactionKey, x: event.clientX, y: event.clientY } }}
    onPointerMove={event => { if (press.current && Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > 8) press.current = null }}
    onPointerCancel={() => { press.current = null }}
    onClick={event => {
      const allowed = event.detail === 0 || (press.current !== null && press.current.key === interactionKey)
      press.current = null
      if (allowed) onSelect(slot.id)
    }}
    className={`relative h-full min-h-9 w-full min-w-9 overflow-hidden text-white active:scale-[0.98] ${hasCardImage ? "bg-transparent" : "border border-white/25 bg-white/10 shadow-inner"} ${selected ? "border-primary ring-2 ring-primary" : hasCardImage ? "ring-1 ring-black/5 dark:ring-white/6" : ""}`}
    style={{ borderRadius: TRADING_CARD_CORNER_RADIUS }}>
    {image && <CardImage key={`${slot.id}:${image}`} src={image} alt="" fill sizes={imageSizes} className={`object-contain ${hasCardImage ? "" : "p-[3px]"} ${tone}`} draggable={false} />}
    {/* Same pocket coordinate badge as the legacy PokemonSlot. */}
    {slotLabel && <span id={coordinateId} className="absolute top-0.5 left-0.5 z-10 hidden rounded bg-white/74 px-1 py-0.5 text-[7px] font-bold tabular-nums text-slate-600 sm:block sm:top-1 sm:left-1 sm:text-[8px] dark:bg-black/50 dark:text-white/70">{slotLabel}</span>}
    <span className="sr-only">
      <span className="block truncate">{slot.card?.name ?? slot.pokemon?.name ?? (slot.target?.kind === "pokemon" ? `Pokémon ${slot.target.pokemonId}` : "Free slot")}</span>
      <span className="block truncate">{slot.item ? "Owned" : slot.target ? "Unfilled target" : "Empty spacer"}</span>
      {slot.item?.grading && <span className="block truncate">Recorded grade: {slot.item.grading.grade ?? "Unknown"}</span>}
    </span>
    {/* Prices view: the owned copy's market price, over the card's foot like the legacy pocket subtitle. */}
    {priceLabel && <span className="absolute inset-x-0.5 bottom-0.5 z-10 truncate rounded bg-black/72 px-1 py-0.5 text-center text-[9px] font-semibold tabular-nums text-white sm:text-[10px]">{priceLabel}</span>}
    {glare && <BinderSlotGlare glareStyle={glareStyle} innerRadius={TRADING_CARD_CORNER_RADIUS} />}
  </button>
}
