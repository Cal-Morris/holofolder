'use client';

// Market prices for a list of printings, converted for display (Show mode's finder rows).
import { useCallback, useMemo } from 'react';
import { useRegionalCardPrices } from '@/hooks/use-regional-card-prices';
import { getCardPriceKey } from '@/hooks/use-card-prices';
import { convertGbpForDisplay, getRegionalFinishPrices, type DisplayFxRates } from '@/lib/regional-price';
import type { DisplayCurrency, PricingRegion } from '@/lib/pricing-region';
import type { PricedCardFinish } from '@/lib/card-pricing';

export interface DisplayPriceLookup {
  cardId: string;
  language: string;
  finish?: string | null;
}

export function useDisplayCardPrices(
  lookups: readonly DisplayPriceLookup[],
  region: PricingRegion,
  currency: DisplayCurrency,
  fxRatesProp?: DisplayFxRates | null,
) {
  const requests = useMemo(() => {
    const seen = new Set<string>();
    return lookups.flatMap(({ cardId, language }) => {
      const key = getCardPriceKey(cardId, language);
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ cardId, language }];
    });
  }, [lookups]);
  const {
    pricesByCardId,
    fxRates: hookRates,
    isLoading,
  } = useRegionalCardPrices(requests, requests.length > 0, region);
  const fxRates = fxRatesProp ?? hookRates ?? null;

  /** The market price of one printing (its own finish quote when there is one), or null. */
  const priceOf = useCallback(
    (lookup: DisplayPriceLookup) => {
      const snapshot = pricesByCardId[getCardPriceKey(lookup.cardId, lookup.language)];
      if (!snapshot) return null;
      const finishPrice = lookup.finish
        ? getRegionalFinishPrices(snapshot, region)[lookup.finish as PricedCardFinish]
        : undefined;
      const gbp = (finishPrice ?? snapshot).gbpAmount;
      return typeof gbp === 'number' && gbp > 0 ? convertGbpForDisplay(gbp, { currency, fxRates }, snapshot) : null;
    },
    [currency, fxRates, pricesByCardId, region],
  );

  /** The printing's raw price snapshot (trend points for price momentum), or undefined while unpriced. */
  const snapshotOf = useCallback(
    (lookup: DisplayPriceLookup) => pricesByCardId[getCardPriceKey(lookup.cardId, lookup.language)],
    [pricesByCardId],
  );

  return { priceOf, snapshotOf, isLoading };
}
