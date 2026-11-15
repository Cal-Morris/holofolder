// A card's saved price as a public card page shows it: display strings only, and nothing below medium confidence.
import type { CardPriceSnapshot } from '@/lib/card-pricing';
import { formatCardFinishLabel } from '@/lib/card-labels';
import { formatCurrencyAmount, formatGbpAmount } from '@/lib/price-format';
import { isMomentumEligibleConfidence } from '@/lib/price-momentum';
import { formatReleaseDate } from '@/lib/set-pages';

export interface PublicCardPrice {
  /** "£12.40" */
  market: string;
  /** "£10.00 to £15.20", when both ends are known. */
  range?: string;
  confidence: 'high' | 'medium';
  /** "12 November 2026" */
  updated?: string;
  /** Each finish with its own confident quote ("Reverse holo", "£3.10"); empty for one-finish cards. */
  finishes: { label: string; amount: string }[];
  /** Each marketplace's own quote in its own currency ("TCGplayer · Holofoil", "$15.80"). */
  sources: { label: string; amount: string }[];
}

/**
 * Null unless the card has a positive GBP market price with high or medium confidence. A public page has no room to
 * explain thin evidence, so it shows no price rather than a weak one.
 */
export function publicCardPrice(snapshot: CardPriceSnapshot | undefined): PublicCardPrice | null {
  if (!snapshot || !isMomentumEligibleConfidence(snapshot.confidence)) return null;
  const market = formatGbpAmount(snapshot.marketGbpAmount ?? snapshot.gbpAmount);
  if (!market) return null;
  const low = formatGbpAmount(snapshot.lowGbpAmount);
  const high = formatGbpAmount(snapshot.highGbpAmount);
  const finishes = (snapshot.finishPrices ?? []).flatMap((quote) => {
    const amount = isMomentumEligibleConfidence(quote.confidence) && formatGbpAmount(quote.gbpAmount);
    return amount ? [{ label: formatCardFinishLabel(quote.finish), amount }] : [];
  });
  const sources = snapshot.sourcePrices.flatMap((quote) => {
    const amount =
      formatCurrencyAmount(quote.originalMarketAmount, quote.originalCurrency) ??
      formatGbpAmount(quote.marketGbpAmount);
    return amount ? [{ label: [quote.label, quote.variantLabel].filter(Boolean).join(' · '), amount }] : [];
  });
  const updated = snapshot.updatedAt?.slice(0, 10);
  return {
    market,
    ...(low && high && low !== high ? { range: `${low} to ${high}` } : {}),
    confidence: snapshot.confidence as 'high' | 'medium',
    ...(updated ? { updated: formatReleaseDate(updated) } : {}),
    finishes: finishes.length > 1 ? finishes : [],
    sources,
  };
}
