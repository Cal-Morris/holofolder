"use client"

import CardImage from "@/components/card-image"
import { BinderSlotGlare, TRADING_CARD_CORNER_RADIUS } from "@/components/binder/pokemon-slot"
import { displaySlotLabel, type ReadOnlyDisplaySlot } from "@/lib/binder-display-model"
import { getOfficialArtworkUrl } from "@/lib/pokemon-catalog"
import { useRef, type CSSProperties } from "react"

/** Browse-only slot. No drag, long-press, placement or ownership callbacks. */
export function OrderedSlot({ slot, selected, onSelect, imageSizes, glareStyle, glare, interactionKey }: { interactionKey?: string; slot: ReadOnlyDisplaySlot; selected: boolean; onSelect: (id: string) => void; imageSizes: string; glareStyle: CSSProperties; glare: boolean }) {
  const press = useRef<{ key: string | undefined; x: number; y: number } | null>(null)
  const image = slot.card?.image ?? (slot.pokemon ? getOfficialArtworkUrl(slot.pokemon.id) : null)
  return <button type="button" data-slot-id={slot.id} aria-label={displaySlotLabel(slot)} aria-pressed={selected} draggable={false}
    onPointerDown={event => { press.current = { key: interactionKey, x: event.clientX, y: event.clientY } }}
    onPointerMove={event => { if (press.current && Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > 8) press.current = null }}
    onPointerCancel={() => { press.current = null }}
    onClick={event => {
      const allowed = event.detail === 0 || (press.current !== null && press.current.key === interactionKey)
      press.current = null
      if (allowed) onSelect(slot.id)
    }}
    className={`relative h-full min-h-9 w-full min-w-9 overflow-hidden border bg-white/10 text-white shadow-inner active:scale-[0.98] ${selected ? "border-primary ring-2 ring-primary" : "border-white/25"}`}
    style={{ borderRadius: TRADING_CARD_CORNER_RADIUS }}>
    {image && <CardImage key={`${slot.id}:${image}`} src={image} alt="" fill sizes={imageSizes} className={`object-contain p-[3px] ${slot.item ? "" : "grayscale opacity-45"}`} draggable={false} />}
    <span className="absolute inset-x-0 bottom-0 bg-black/75 px-1 py-1 text-[10px] leading-tight">
      <span className="block truncate">{slot.card?.name ?? slot.pokemon?.name ?? (slot.target?.kind === "pokemon" ? `Pokémon ${slot.target.pokemonId}` : "Free slot")}</span>
      <span className="block truncate">{slot.item ? "Owned" : slot.target ? "Unfilled target" : "Empty spacer"}</span>
      {slot.item?.grading && <span className="block truncate">Recorded grade: {slot.item.grading.grade ?? "Unknown"}</span>}
    </span>
    {glare && <BinderSlotGlare glareStyle={glareStyle} innerRadius={TRADING_CARD_CORNER_RADIUS} />}
  </button>
}
