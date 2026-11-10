import { isCardLanguage, type CardFinish } from "@/lib/domain/cards"
import { isStandardFinishVariantKey, normalizePriceSource, type CardFinishPrice } from "@/lib/card-pricing"
import { priceCheckFinish } from "@/lib/card-price-check-cache"
import { isMomentumEligibleConfidence } from "@/lib/price-momentum"
import { capConfidence, STALE_AFTER_DAYS, VERY_STALE_AFTER_DAYS } from "@/lib/price-freshness"

export type NativeCatalogueQuote = Pick<CardFinishPrice, "cardId" | "language" | "finish" | "variantKey" | "gbpAmount" | "source" | "confidence" | "updatedAt">
export interface NativeBundleEvidence { catalogue?: NativeCatalogueQuote; soldExact: boolean }

/** Retain enough exact quote provenance to recheck a long-lived, offline bundle. */
export function nativeCatalogueQuote(card: { id: string; language?: string }, finish: CardFinish, quote: Partial<NativeCatalogueQuote> | undefined, now: number): NativeCatalogueQuote | undefined {
  const at = typeof quote?.updatedAt === "string" ? Date.parse(quote.updatedAt) : NaN
  const age = (now - at) / 86_400_000
  if (!isCardLanguage(card.language) || quote?.cardId !== card.id || quote.language !== card.language || quote.finish !== finish
    || typeof quote.variantKey !== "string" || !isStandardFinishVariantKey(quote.variantKey)
    || !normalizePriceSource(quote.source) || !isMomentumEligibleConfidence(quote.confidence)
    || !Number.isFinite(age) || age < 0 || age > VERY_STALE_AFTER_DAYS
    || typeof quote.gbpAmount !== "number" || !Number.isFinite(quote.gbpAmount) || quote.gbpAmount <= 0) return undefined
  return { cardId: quote.cardId, language: quote.language, finish: quote.finish, variantKey: quote.variantKey,
    gbpAmount: quote.gbpAmount, source: quote.source!, confidence: age > STALE_AFTER_DAYS ? capConfidence(quote.confidence!, "medium") : quote.confidence!, updatedAt: quote.updatedAt! }
}

/** Shared sold checks support English standard finishes only; "any" is not exact evidence. */
export function nativeSoldEvidenceAllowed(card: { language?: string; variants?: { normal?: boolean; holo?: boolean; reverse?: boolean } }, finish: CardFinish, exactCatalogue = false) {
  if (card.language !== "en" || priceCheckFinish(finish) === "any") return false
  return exactCatalogue || (finish === "normal" ? card.variants?.normal : finish === "holo" ? card.variants?.holo : card.variants?.reverse) === true
}
