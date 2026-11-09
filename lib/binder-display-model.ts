import { normalizeBinderSnapshot, type BinderSnapshot, type SlotTarget } from "@/lib/domain/binder-slots"
import { normalizeInventorySnapshot, type InventoryItem, type InventorySnapshot } from "@/lib/domain/inventory"
import type { CollectedPokemon, WantedCard } from "@/lib/domain/cards"
import { isBinderGridSize } from "@/lib/binder-layout"
import { getPokemonSummary } from "@/lib/pokemon-catalog"

export interface DisplayCatalogCard { name: string; image?: string }
/** Ephemeral read model. The item is a reference, never slot-local ownership. */
export interface BinderDisplaySlot {
  id: string
  target: SlotTarget | null
  item: InventoryItem | null
  card: DisplayCatalogCard | null
  pokemon: { id: number; name: string } | null
  wantedCards: readonly WantedCard[]
  legacyPokemonId?: number
  legacyItem?: CollectedPokemon
}
/** Minimal browse contract shared by private display references and public projections. */
export interface ReadOnlyDisplaySlot {
  id: string
  target: { kind: "card" } | { kind: "pokemon"; pokemonId: number } | null
  item: { grading: { grade: string | null } | null } | null
  card: DisplayCatalogCard | null
  pokemon: { id: number; name: string } | null
}
export interface SlotDisplayInput {
  binder: BinderSnapshot
  inventory: InventorySnapshot
  catalog: Record<string, DisplayCatalogCard>
}

/** Internal only: requires a complete coherent owner snapshot, not a partial transport page. */
export function buildSlotDisplay(binder: BinderSnapshot, inventory: InventorySnapshot, resolve: (cardId: string) => DisplayCatalogCard | undefined): BinderDisplaySlot[] {
  const checked = normalizeInventorySnapshot(inventory)
  const canonical = checked?.binders.find(b => b.collectionId === binder.collectionId)
  const requested = normalizeBinderSnapshot(binder)
  if (binder.ownerUserId !== inventory.ownerUserId || !canonical || !requested || JSON.stringify(canonical) !== JSON.stringify(requested)) throw new Error("invalid-display-snapshot")
  const items = new Map(inventory.items.map(item => [item.id, item]))
  return binder.slots.map(slot => {
    const item = slot.inventoryItemId ? items.get(slot.inventoryItemId)! : null
    const cardId = item?.identity.kind === "card" ? item.identity.cardId : slot.target?.kind === "card" ? slot.target.cardId : null
    const pokemonId = item?.identity.kind === "pokemon" ? item.identity.pokemonId : slot.target?.kind === "pokemon" ? slot.target.pokemonId : null
    return { id: slot.id, target: slot.target, item, card: cardId ? resolve(cardId) ?? { name: cardId } : null, pokemon: pokemonId ? getPokemonSummary(pokemonId) ?? null : null, wantedCards: slot.wantedCards }
  })
}

/** Stable names are local display keys only, not conversion IDs or a persisted migration map. */
export function adaptLegacyDisplaySlots(collectionId: string, pokemon: readonly { id: number; name: string }[], getItem: (id: number) => CollectedPokemon | undefined): BinderDisplaySlot[] {
  return pokemon.map(p => {
    const legacyItem = getItem(p.id)
    return { id: `legacy:${collectionId}:${p.id}`, target: { kind: "pokemon", pokemonId: p.id }, item: null, card: null, pokemon: p, wantedCards: legacyItem?.wanted_cards ?? [], legacyPokemonId: p.id, legacyItem }
  })
}

/** Mask filtered slots in place. Trailing nulls are visual padding, never stored free slots. */
export function paginateDisplaySlots(slots: readonly BinderDisplaySlot[], rows: number, cols: number, visible: (slot: BinderDisplaySlot) => boolean = () => true): (BinderDisplaySlot | null)[][] {
  if (!isBinderGridSize(rows) || !isBinderGridSize(cols)) throw new Error("invalid-display-grid")
  const capacity = rows * cols
  return Array.from({ length: Math.ceil(slots.length / capacity) }, (_, page) => Array.from({ length: capacity }, (_, offset) => {
    const slot = slots[page * capacity + offset]
    return slot && visible(slot) ? slot : null
  }))
}

export function resolveDisplaySelection(slots: readonly BinderDisplaySlot[], slotId: string | null | undefined) {
  return slots.find(slot => slot.id === slotId) ?? null
}

export function displaySlotLabel(slot: Pick<ReadOnlyDisplaySlot, "card" | "pokemon" | "target" | "item">) {
  const name = slot.card?.name ?? (slot.pokemon ? slot.pokemon.name : slot.target?.kind === "pokemon" ? `Pokémon ${slot.target.pokemonId}` : "Free slot")
  return `${name}, ${slot.item ? "Owned" : slot.target ? "Unfilled target" : "Empty spacer"}`
}
