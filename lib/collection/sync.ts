// Stable fingerprint of a collection row, used to compare imports and saved settings.
import type { CollectedPokemon, WantedCard } from "@/lib/domain/cards"
import { normalizeCollectionItem } from "@/lib/collection/normalize"

export const ABSENT_ROW_FINGERPRINT = "absent"

function wantedKey(card: WantedCard) {
  return `${card.card_id}:${card.card_language ?? "en"}:${card.card_finish ?? "normal"}`
}

function ownedGroup(item: CollectedPokemon) {
  return JSON.stringify([item.card_id ?? null, item.card_language ?? "en", item.card_finish ?? "normal"])
}

/** Stable fingerprint of what a row means to the user (ids, names and timestamps are ignored). */
export function collectionFingerprint(item: Partial<CollectedPokemon> | null | undefined) {
  if (!item) return ABSENT_ROW_FINGERPRINT
  const normalized = normalizeCollectionItem(item)
  return JSON.stringify({
    status: normalized.status,
    owned: ownedGroup(normalized),
    wanted: normalized.wanted_cards.map(card => `${wantedKey(card)}${card.wanted_by === undefined ? "" : `:wanted-by:${[...card.wanted_by].sort().join(",")}`}`).sort(),
  })
}
