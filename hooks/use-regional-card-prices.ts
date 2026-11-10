"use client"

import { useMemo } from "react"
import { isCardLanguage } from "@/lib/domain/cards"
import { useInventoryPrices } from "@/hooks/use-inventory-prices"
import { applyPriceStaleness } from "@/lib/price-freshness"
import { useCardPrices, getCardPriceKey, type CardPriceLookup, type CardPriceSnapshot } from "@/hooks/use-card-prices"
import type { PricingRegion } from "@/lib/pricing-region"
import { regionalizeCardPrices, type RegionalCardPriceSnapshot } from "@/lib/regional-price"

/**
 * Batched, offline-cached card prices (see useCardPrices) re-weighted for the user's pricing region,
 * so list views rank and label cards with the same headline price as the card detail.
 * Native lookups use savedOnly to avoid the refresh-capable POST path.
 */
export function useRegionalCardPrices(
  lookups: Array<string | CardPriceLookup>,
  enabled: boolean,
  region: PricingRegion,
  savedOnly = false,
) {
  const { pricesByCardId: rawPrices, isLoading, fxRates } = useCardPrices(lookups, enabled && !savedOnly)
  const savedPrices = useInventoryPrices(savedOnly && enabled ? lookups.flatMap(lookup => typeof lookup !== "string" && isCardLanguage(lookup.language)
    ? [{ cardId: lookup.cardId, language: lookup.language }] : []) : [])
  const pricesByCardId = useMemo<Record<string, RegionalCardPriceSnapshot<CardPriceSnapshot>>>(
    () => regionalizeCardPrices(savedOnly ? Object.fromEntries(savedPrices.map(price =>
      [getCardPriceKey(price.cardId, price.language), { ...price, ...applyPriceStaleness(price, price.fetchedAt) }])) : rawPrices, region),
    [rawPrices, region, savedOnly, savedPrices],
  )
  return { pricesByCardId, isLoading, fxRates }
}
