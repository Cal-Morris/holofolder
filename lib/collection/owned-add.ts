// Pure state transition for putting an owned card into a binder slot.
//
// A slot's wanted list is what the user is still looking for. In the default "mixed" binder view the first
// wanted card is shown in place of the owned one, so a wanted card that survives an add makes the slot keep
// looking wanted. Rules when a specific card is added as owned:
//   - a wanted slot (status "wishlisted", or no row yet) is filled: its wanted list is cleared;
//   - an owned slot whose printing changes keeps its other wanted cards (deliberate upgrade targets), but a
//     wanted entry for exactly the printing just added (same catalog id or alias, language and finish) is
//     fulfilled and dropped.
// Adding without a specific card ("mark owned"), wanted-mode writes and writes that keep the owned printing
// (adding or removing a wanted card on an owned slot) leave the wanted list untouched.
import {
  DEFAULT_CARD_FINISH,
  DEFAULT_CARD_LANGUAGE,
  type CardFinish,
  type CardLanguage,
  type CollectedPokemon,
  type SlotStatus,
  type WantedCard,
} from "@/lib/domain/cards"

export interface OwnedAddInput {
  /** The row before the add (undefined/null when the slot had no row). */
  existing: Pick<CollectedPokemon, "status" | "wanted_cards" | "card_id" | "card_language" | "card_finish"> | null | undefined
  /** The wanted list the caller would otherwise write. */
  wantedCards: WantedCard[]
  status: SlotStatus
  cardId?: string | null
  /** Every id the added card is known by (catalog canonical id and aliases); cardId is always included. */
  cardIds?: readonly string[]
  cardLanguage?: CardLanguage | null
  cardFinish?: CardFinish | null
}

export function resolveWantedCardsAfterOwnedAdd({
  existing,
  wantedCards,
  status,
  cardId,
  cardIds = [],
  cardLanguage,
  cardFinish,
}: OwnedAddInput): WantedCard[] {
  if (status === "wishlisted" || !cardId) return wantedCards

  const wasOwned = Boolean(existing && existing.status !== "wishlisted")
  if (!wasOwned) return []

  const language = cardLanguage ?? DEFAULT_CARD_LANGUAGE
  const finish = cardFinish ?? DEFAULT_CARD_FINISH
  const printingUnchanged = existing?.card_id === cardId
    && (existing.card_language ?? DEFAULT_CARD_LANGUAGE) === language
    && (existing.card_finish ?? DEFAULT_CARD_FINISH) === finish
  if (printingUnchanged) return wantedCards

  const ids = new Set([cardId, ...cardIds])
  return wantedCards.filter((card) => !(
    ids.has(card.card_id)
    && (card.card_language ?? DEFAULT_CARD_LANGUAGE) === language
    && (card.card_finish ?? DEFAULT_CARD_FINISH) === finish
  ))
}
