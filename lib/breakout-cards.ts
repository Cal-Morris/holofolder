/**
 * "Breakout" cards for a single Pokémon: the printings with the strongest recent price momentum.
 *
 * Scoring rules (pure, client-safe; built on lib/price-momentum.ts):
 *   - Only printings whose price passes the Rising gates qualify: confidence high/medium,
 *     same-source comparison, current & baseline >= £1, change <= +300%, provider data <= 7 days
 *     old, and current vs 7d >= +10% or current vs 30d >= +15% (30d ignored if 7d is negative).
 *   - Each card is represented by its strongest qualifying move; % change and timeframe shown are
 *     that move's actual values.
 *   - Rank score = change x timeframe weight (7d = 1, 30d = 0.5): the same % move over a week is
 *     stronger momentum than over a month.
 *   - Ties: higher-confidence first, then higher current price, then card id (stable order).
 *   - At most BREAKOUT_LIMIT cards; an empty list means the section is hidden (no guessing).
 */
import { getRisingMomentum, type MomentumPriceInput, type PriceMomentum } from '@/lib/price-momentum';

export const BREAKOUT_LIMIT = 10;
export const BREAKOUT_TIMEFRAME_WEIGHT = { '7d': 1, '30d': 0.5 } as const;

export interface BreakoutCandidate<TCard> {
  card: TCard;
  cardId: string;
  price: MomentumPriceInput | null | undefined;
}

export interface BreakoutCard<TCard> {
  card: TCard;
  cardId: string;
  momentum: PriceMomentum;
  score: number;
}

const CONFIDENCE_ORDER = { high: 2, medium: 1, low: 0, unknown: 0 } as const;

export function rankBreakoutCards<TCard>(
  candidates: Array<BreakoutCandidate<TCard>>,
  options: { limit?: number; now?: number } = {},
): Array<BreakoutCard<TCard> & { confidence: MomentumPriceInput['confidence'] }> {
  const limit = options.limit ?? BREAKOUT_LIMIT;
  const now = options.now ?? Date.now();
  const seen = new Set<string>();

  const ranked = candidates.flatMap((candidate) => {
    if (seen.has(candidate.cardId)) return [];
    seen.add(candidate.cardId);

    const momentum = getRisingMomentum(candidate.price, now);
    if (!momentum || !candidate.price) return [];

    return [
      {
        card: candidate.card,
        cardId: candidate.cardId,
        momentum,
        score: momentum.change * BREAKOUT_TIMEFRAME_WEIGHT[momentum.timeframe],
        confidence: candidate.price.confidence,
      },
    ];
  });

  ranked.sort(
    (left, right) =>
      right.score - left.score ||
      CONFIDENCE_ORDER[right.confidence] - CONFIDENCE_ORDER[left.confidence] ||
      right.momentum.currentGbpAmount - left.momentum.currentGbpAmount ||
      left.cardId.localeCompare(right.cardId),
  );

  return ranked.slice(0, Math.max(0, limit));
}
