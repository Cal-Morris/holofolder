import type { CollectedPokemon } from "@/lib/domain/cards"
import type { TCGSetDexSlot, TCGSetSlotCard, TCGSetSlotsResponse } from "@/lib/tcg-set-slots"

export function getSetSlotState(slot: TCGSetDexSlot, item: CollectedPokemon | undefined) {
  const speciesOwned = Boolean(item && item.status !== "wishlisted")
  const ownedInSet = speciesOwned && slot.cards.some(card => card.id === item?.card_id)
  const wantedIds = new Set(item?.wanted_cards.map(card => card.card_id) ?? [])
  if (item?.status === "wishlisted" && item.card_id) wantedIds.add(item.card_id)
  return {
    ownedInSet,
    ownedElsewhere: speciesOwned && !ownedInSet,
    wantedInSet: slot.cards.some(card => wantedIds.has(card.id)),
  }
}

export function getSetCardState(card: TCGSetSlotCard, collection: Iterable<CollectedPokemon>) {
  let owned = false
  let wanted = false
  for (const item of collection) {
    if (item.card_id === card.id) {
      if (item.status === "wishlisted") wanted = true
      else owned = true
    }
    if (item.wanted_cards.some(wantedCard => wantedCard.card_id === card.id)) wanted = true
  }
  return { owned, wanted }
}

export function getSetChecklistCards(payload: TCGSetSlotsResponse) {
  return [...new Map((payload.cards ?? payload.slots.flatMap(slot => slot.cards)).map(card => [card.id, card])).values()]
}

export type SetSlotFilter = "all" | "open" | "owned" | "wanted" | "multiple"

export function mergeSetSlots(groups: TCGSetDexSlot[][]): TCGSetDexSlot[] {
  const slots = new Map<number, TCGSetDexSlot>()
  for (const group of groups) {
    for (const slot of group) {
      const previous = slots.get(slot.dexId)
      slots.set(slot.dexId, {
        ...slot,
        cards: [...new Map([...(previous?.cards ?? []), ...slot.cards].map(card => [card.id, card])).values()],
      })
    }
  }
  return [...slots.values()].sort((left, right) => left.dexId - right.dexId)
}

export function matchesSetSlotFilter(slot: TCGSetDexSlot, item: CollectedPokemon | undefined, filter: SetSlotFilter) {
  const owned = Boolean(item && item.status !== "wishlisted")
  const wanted = Boolean(item?.status === "wishlisted" || item?.wanted_cards.length)
  return filter === "all"
    || filter === "open" && !owned
    || filter === "owned" && owned
    || filter === "wanted" && wanted
    || filter === "multiple" && slot.cards.length > 1
}
