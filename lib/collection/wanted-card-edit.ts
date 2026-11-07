import type { WantedCard } from "@/lib/domain/cards"

export function wantedCardKey(card: Pick<WantedCard, "card_id" | "card_language" | "card_finish">) {
  return `${card.card_id}:${card.card_language ?? "en"}:${card.card_finish ?? "normal"}`
}

export function editWantedCards(cards: WantedCard[], target: WantedCard, replacement: WantedCard | null) {
  const targetKey = wantedCardKey(target)
  const saved = cards.find(card => wantedCardKey(card) === targetKey)
  if (!saved) return cards
  const alreadyWanted = replacement && cards.some(card => wantedCardKey(card) !== targetKey && wantedCardKey(card) === wantedCardKey(replacement))
  return cards.flatMap(card => wantedCardKey(card) !== targetKey ? [card] : replacement && !alreadyWanted
    ? [{ ...replacement, wanted_by: saved.wanted_by, added_at: saved.added_at }]
    : [])
}
