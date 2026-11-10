import { catalogCardIds } from "@/lib/card-catalog"
import { getSetChecklistCards } from "@/lib/set-checklist"
import type { CollectedPokemon } from "@/lib/domain/cards"
import type { TCGSetSlotsResponse } from "@/lib/tcg-set-slots"

export type SetCompletion = {
  owned: number
  total: number
  /** Rounded down, so a set only shows 100% when every card is owned. */
  percent: number
  complete: boolean
  /** False when only the Pokémon cards were saved for this set, not the full checklist. */
  hasFullCardList: boolean
}

/**
 * How much of a set the binder holds: a card counts as owned when it is the printing tracked in
 * a binder slot (the same rule as the Cards checklist). Wanted-only rows don't count.
 */
export function getSetCompletion(payload: TCGSetSlotsResponse, collection: Iterable<CollectedPokemon>): SetCompletion {
  const ownedCardIds = new Set<string>()
  for (const item of collection) {
    if (item.status !== "wishlisted" && item.card_id) ownedCardIds.add(item.card_id)
  }

  const cards = getSetChecklistCards(payload)
  const owned = cards.filter((card) => catalogCardIds(card).some((id) => ownedCardIds.has(id))).length
  const total = cards.length

  return {
    owned,
    total,
    percent: total > 0 ? Math.floor((owned / total) * 100) : 0,
    complete: total > 0 && owned === total,
    hasFullCardList: Array.isArray(payload.cards),
  }
}
