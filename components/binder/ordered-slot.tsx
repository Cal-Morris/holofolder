"use client"

import CardImage from "@/components/card-image"
import { BinderSlotGlare, TRADING_CARD_CORNER_RADIUS } from "@/components/binder/pokemon-slot"
import { displaySlotLabel, displaySlotPreview, type ReadOnlyDisplaySlot } from "@/lib/binder-display-model"
import type { BinderCardDisplay } from "@/lib/selected-slot-card-display"
import { formatPokemonDisplayName } from "@/lib/pokemon-catalog"
import { Check } from "lucide-react"
import { useEffect, useId, useRef, type CSSProperties } from "react"

const LONG_PRESS_MS = 450
const MOVE_TOLERANCE_PX = 8

/**
 * One binder pocket. A tap selects it. Where the host offers pocket actions (`onMenu`), a right-click, the keyboard
 * menu key or a long press opens them instead; a long press is dropped as soon as the finger pans, scrolls or
 * turns the page, and never also counts as a tap. `marked` shows layout selection on the pocket itself.
 */
export function OrderedSlot({ slot, slotLabel, selected, onSelect, onMenu, marked, dimmed, imageSizes, glareStyle, glare, interactionKey, cardDisplay, priceLabel }: {
  /** The saved market price shown on the pocket in the Prices view. */
  priceLabel?: string | null
  cardDisplay?: BinderCardDisplay; interactionKey?: string; slot: ReadOnlyDisplaySlot; slotLabel?: string; selected: boolean; onSelect: (id: string) => void
  onMenu?: (id: string, point: { x: number; y: number }) => void
  /** Layout selection: undefined outside layout editing, otherwise whether this pocket is selected. */
  marked?: boolean; dimmed?: boolean
  imageSizes: string; glareStyle: CSSProperties; glare: boolean
}) {
  const coordinateId = useId()
  const press = useRef<{ key: string | undefined; x: number; y: number } | null>(null)
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null)
  const held = useRef(false)
  const cancelHold = () => { if (hold.current) { clearTimeout(hold.current); hold.current = null } }
  useEffect(() => cancelHold, [])
  const { image, isCard: hasCardImage, tone } = displaySlotPreview(slot, cardDisplay)
  return <button type="button" data-slot-id={slot.id} aria-label={displaySlotLabel(slot)} aria-describedby={slotLabel ? coordinateId : undefined} aria-pressed={marked ?? selected} draggable={false}
    aria-haspopup={onMenu ? "menu" : undefined}
    onPointerDown={event => {
      press.current = { key: interactionKey, x: event.clientX, y: event.clientY }
      held.current = false
      cancelHold()
      if (!onMenu || event.pointerType === "mouse") return
      const point = { x: event.clientX, y: event.clientY }
      hold.current = setTimeout(() => { hold.current = null; if (!press.current) return; held.current = true; press.current = null; onMenu(slot.id, point) }, LONG_PRESS_MS)
    }}
    onPointerMove={event => { if (press.current && Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > MOVE_TOLERANCE_PX) { press.current = null; cancelHold() } }}
    onPointerUp={cancelHold}
    onPointerLeave={cancelHold}
    onPointerCancel={() => { press.current = null; cancelHold() }}
    onContextMenu={event => {
      if (!onMenu) return
      event.preventDefault()
      cancelHold()
      // A touch long press may already have opened the menu; the platform's own event then only needs suppressing.
      if (held.current) return
      press.current = null
      const box = event.currentTarget.getBoundingClientRect()
      onMenu(slot.id, event.clientX || event.clientY ? { x: event.clientX, y: event.clientY } : { x: box.left + box.width / 2, y: box.top + box.height / 2 })
    }}
    onClick={event => {
      const allowed = !held.current && (event.detail === 0 || (press.current !== null && press.current.key === interactionKey))
      press.current = null; held.current = false
      if (allowed) onSelect(slot.id)
    }}
    className={`relative h-full min-h-9 w-full min-w-9 select-none overflow-hidden text-white [-webkit-touch-callout:none] active:scale-[0.98] ${hasCardImage ? "bg-transparent" : "border border-white/25 bg-white/10 shadow-inner"} ${marked || (marked === undefined && selected) ? "border-primary ring-2 ring-primary" : hasCardImage ? "ring-1 ring-black/5 dark:ring-white/6" : ""} ${dimmed ? "opacity-45" : ""}`}
    style={{ borderRadius: TRADING_CARD_CORNER_RADIUS }}>
    {image && <CardImage key={`${slot.id}:${image}`} src={image} alt="" fill sizes={imageSizes} className={`object-contain ${hasCardImage ? "" : "p-[3px]"} ${tone}`} draggable={false} />}
    {/* Same pocket coordinate badge as the legacy PokemonSlot. */}
    {slotLabel && <span id={coordinateId} className="absolute top-0.5 left-0.5 z-10 hidden rounded bg-white/74 px-1 py-0.5 text-[7px] font-bold tabular-nums text-slate-600 sm:block sm:top-1 sm:left-1 sm:text-[8px] dark:bg-black/50 dark:text-white/70">{slotLabel}</span>}
    {marked !== undefined && <span aria-hidden="true" data-pocket-mark={marked ? "selected" : "available"}
      className={`absolute right-1 top-1 z-10 flex h-5 w-5 items-center justify-center rounded-full border-2 shadow ${marked ? "border-primary bg-primary text-primary-foreground" : "border-white/85 bg-black/35"}`}>
      {marked && <Check className="h-3 w-3" strokeWidth={3} />}
    </span>}
    <span className="sr-only">
      <span className="block truncate">{slot.card?.name ?? (slot.pokemon ? formatPokemonDisplayName(slot.pokemon.name) : slot.target?.kind === "pokemon" ? `Pokémon ${slot.target.pokemonId}` : "Free slot")}</span>
      <span className="block truncate">{slot.item ? "Owned" : slot.target ? "Unfilled target" : "Empty spacer"}</span>
      {slot.item?.grading && <span className="block truncate">Recorded grade: {slot.item.grading.grade ?? "Unknown"}</span>}
    </span>
    {/* Prices view: the owned copy's market price, over the card's foot like the legacy pocket subtitle. */}
    {priceLabel && <span className="absolute inset-x-0.5 bottom-0.5 z-10 truncate rounded bg-black/72 px-1 py-0.5 text-center text-[9px] font-semibold tabular-nums text-white sm:text-[10px]">{priceLabel}</span>}
    {glare && <BinderSlotGlare glareStyle={glareStyle} innerRadius={TRADING_CARD_CORNER_RADIUS} />}
  </button>
}
