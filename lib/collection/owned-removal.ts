// Pure state transitions for removing an owned card from a binder slot.
//
// "Move back to Wanted" turns an owned slot into a wanted slot in one row write: the owned printing is cleared
// and, when there was one, it goes back to the front of the wanted list (so a card marked "Got" by mistake
// returns to exactly where it was). "Remove completely" deletes the row. Both are undone by writing the
// previous row back unchanged, through the same optimistic/offline-queued path as every other edit.
import {
  DEFAULT_CARD_FINISH,
  DEFAULT_CARD_LANGUAGE,
  type CollectedPokemon,
  type WantedCard,
} from "@/lib/domain/cards"
import { normalizeCollectionItem } from "@/lib/collection/normalize"

export type OwnedRemovalMode = "to-wanted" | "remove"

export function isOwnedCollectionItem(item: CollectedPokemon | null | undefined): item is CollectedPokemon {
  return Boolean(item && item.status !== "wishlisted")
}

function wantedCardKey(card: Pick<WantedCard, "card_id" | "card_language" | "card_finish">) {
  return `${card.card_id}:${card.card_language ?? DEFAULT_CARD_LANGUAGE}:${card.card_finish ?? DEFAULT_CARD_FINISH}`
}

/** The owned printing as a wanted-list entry, or null when the slot was owned without a specific card. */
export function ownedCardAsWantedCard(item: CollectedPokemon, now: string): WantedCard | null {
  if (!item.card_id || !item.card_name) return null
  return {
    card_id: item.card_id,
    card_name: item.card_name,
    card_image: item.card_image,
    card_set: item.card_set,
    card_language: item.card_language ?? DEFAULT_CARD_LANGUAGE,
    card_finish: item.card_finish ?? DEFAULT_CARD_FINISH,
    added_at: now,
  }
}

/**
 * The slot after "Move back to Wanted": status wanted, no owned card, wanted list kept with the
 * previously owned printing first (not duplicated if it was already wanted).
 */
export function moveOwnedItemToWanted(item: CollectedPokemon, now = new Date().toISOString()): CollectedPokemon {
  const ownedAsWanted = ownedCardAsWantedCard(item, now)
  const existingWanted = item.wanted_cards ?? []
  const wantedCards = ownedAsWanted
    ? [ownedAsWanted, ...existingWanted.filter((card) => wantedCardKey(card) !== wantedCardKey(ownedAsWanted))]
    : existingWanted

  return normalizeCollectionItem({
    id: item.id,
    pokemon_id: item.pokemon_id,
    pokemon_name: item.pokemon_name,
    card_id: undefined,
    card_name: undefined,
    card_image: undefined,
    card_set: undefined,
    card_language: DEFAULT_CARD_LANGUAGE,
    card_finish: DEFAULT_CARD_FINISH,
    wanted_cards: wantedCards,
    status: "wishlisted",
    collected_at: item.collected_at,
  })
}

/** What to write for a removal: the next row (null deletes it) and the exact row to restore on undo. */
export function planOwnedRemoval(item: CollectedPokemon, mode: OwnedRemovalMode, now = new Date().toISOString()) {
  return {
    previous: item,
    next: mode === "to-wanted" ? moveOwnedItemToWanted(item, now) : null,
  }
}
