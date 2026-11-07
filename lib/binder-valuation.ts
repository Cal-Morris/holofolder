import type { AnalyticsCard } from "@/lib/collection-analytics"
import type { CardPriceCheck } from "@/lib/card-price-checks"
import { priceCheckKey } from "@/lib/card-price-check-cache"
import { buildSoldPriceGuide } from "@/lib/sold-price-guide"

export function buildRefinedValuation(cards: readonly AnalyticsCard[], checks: Record<string, CardPriceCheck | null>, now = Date.now()) {
  let totalGbp = 0, soldCards = 0, fallbackCards = 0, unpricedCards = 0
  let oldestCheck: string | null = null
  for (const entry of cards) {
    if (entry.scope !== "owned") continue
    const { card } = entry
    const check = checks[priceCheckKey(card.card_id, card.card_finish ?? "normal", "soldcomps")]
    const guide = (card.card_language ?? "en") === "en"
      ? buildSoldPriceGuide(check, entry.amount, card.card_finish ?? "normal", undefined, now) : null
    if (guide?.eligible && guide.referenceGbp !== null && check) {
      totalGbp += guide.referenceGbp
      soldCards++
      if (!oldestCheck || Date.parse(check.checkedAt) < Date.parse(oldestCheck)) oldestCheck = check.checkedAt
    } else if (entry.amount !== null) {
      totalGbp += entry.amount
      fallbackCards++
    } else unpricedCards++
  }
  return { totalGbp: Math.round(totalGbp * 100) / 100, soldCards, fallbackCards, unpricedCards, oldestCheck }
}
