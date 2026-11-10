import { isCardFinish, isCardLanguage, type CardFinish } from "@/lib/domain/cards"
import { getCardPriceKey, type CardPriceLookup } from "@/lib/card-pricing"

export interface TrackedPriceIdentity extends CardPriceLookup { finish: CardFinish | null }

/** Legacy omission means English; native omission is unknown. Never infer a finish or alias an ID. */
export function trackedPriceIdentity(cardId: unknown, language: unknown, finish: unknown, legacy = false): TrackedPriceIdentity | null {
  if (cardId === null || cardId === undefined) return null
  if (typeof cardId !== "string" || !cardId.trim() || cardId !== cardId.trim() || cardId.length > 200) throw new Error("Invalid tracked card ID")
  if (finish !== null && finish !== undefined && !isCardFinish(finish)) throw new Error("Invalid tracked finish")
  const knownLanguage = typeof language === "string" ? language.trim().toLowerCase() : legacy && language == null ? "en" : null
  if (knownLanguage === null) return null
  if (!isCardLanguage(knownLanguage)) throw new Error("Invalid tracked language")
  return { cardId, language: knownLanguage, finish: isCardFinish(finish) ? finish : null }
}

/** The provider transports all finish evidence in one card/language snapshot. */
export function trackedPriceRequests(identities: readonly TrackedPriceIdentity[]): CardPriceLookup[] {
  return [...new Map(identities.map(({ cardId, language }) => [getCardPriceKey(cardId, language), { cardId, language }])).values()]
}
