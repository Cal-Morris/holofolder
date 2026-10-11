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
