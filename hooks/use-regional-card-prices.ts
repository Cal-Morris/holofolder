"use client"

import { useMemo } from "react"
import { useCardPrices, type CardPriceLookup, type CardPriceSnapshot } from "@/hooks/use-card-prices"
import type { PricingRegion } from "@/lib/pricing-region"
import { regionalizeCardPrices, type RegionalCardPriceSnapshot } from "@/lib/regional-price"

/**
 * Batched, offline-cached card prices (see useCardPrices) re-weighted for the user's pricing region,
 * so list views rank and label cards with the same headline price as the card detail.
 */
export function useRegionalCardPrices(
  lookups: Array<string | CardPriceLookup>,
  enabled: boolean,
  region: PricingRegion,
) {
  const { pricesByCardId: rawPrices, isLoading, fxRates } = useCardPrices(lookups, enabled)
  const pricesByCardId = useMemo<Record<string, RegionalCardPriceSnapshot<CardPriceSnapshot>>>(
    () => regionalizeCardPrices(rawPrices, region),
    [rawPrices, region],
  )
  return { pricesByCardId, isLoading, fxRates }
}
