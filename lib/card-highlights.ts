import { getCardPriceKey, type CardPriceSnapshot, type PricedCardFinish } from "@/lib/card-pricing"
import { getPriceDataAgeDays } from "@/lib/price-freshness"
import { isMomentumEligibleConfidence } from "@/lib/price-momentum"

export const CARD_HIGHLIGHT_LIMIT = 10
export const FINISH_LABELS = { normal: "Non-holo", holo: "Holo", reverse_holo: "Reverse holo" } as const
export type CardHighlightFinishFilter = "all" | PricedCardFinish

export interface HighlightCard {
  id: string
  language?: string
  name: string
  numberLabel: string
  setName: string
  image?: string
  rarity?: string
}

export interface CardHighlightCandidate {
  card: HighlightCard
  cardId: string
  finish: PricedCardFinish | null
  price: CardPriceSnapshot
}

export function buildCardHighlightCandidates(cards: HighlightCard[], prices: Record<string, CardPriceSnapshot>): CardHighlightCandidate[] {
  const seen = new Set<string>()
  return cards.flatMap<CardHighlightCandidate>((card) => {
    const key = getCardPriceKey(card.id, card.language)
    if (seen.has(key)) return []
    seen.add(key)
    const price = prices[key]
    if (!price) return []
    if (price.finishPrices?.length) return price.finishPrices.map((variant) => ({ card, cardId: `${key}:${variant.variantKey}`, finish: variant.finish, price: variant }))
    // Older cached snapshots can still supply the existing unfiltered momentum view.
    return [{ card, cardId: key, finish: null, price }]
  })
}

export function rankValuableCards(candidates: CardHighlightCandidate[], finish: CardHighlightFinishFilter = "all", now = Date.now()) {
  return candidates.filter((entry) => {
    const age = getPriceDataAgeDays(entry.price.updatedAt, now)
    return entry.finish !== null && (finish === "all" || finish === entry.finish)
      && isMomentumEligibleConfidence(entry.price.confidence)
      && typeof entry.price.marketGbpAmount === "number" && Number.isFinite(entry.price.marketGbpAmount) && entry.price.marketGbpAmount > 0
      && age !== null && age <= 30
  }).sort((left, right) => right.price.marketGbpAmount! - left.price.marketGbpAmount!
    || left.card.numberLabel.localeCompare(right.card.numberLabel, undefined, { numeric: true })
    || left.card.name.localeCompare(right.card.name)
    || left.cardId.localeCompare(right.cardId)).slice(0, CARD_HIGHLIGHT_LIMIT)
}
