/**
 * Price momentum ("Rising" indicator) rules. Pure and client-safe.
 *
 * A card is "rising" when, within a single price source (never mixing providers or
 * currencies), the current price is above that source's own rolling average:
 *   - current vs 7d average  >= +10%  (RISING_7D_THRESHOLD), or
 *   - current vs 30d average >= +15%  (RISING_30D_THRESHOLD)
 * Current = the source's "Trend", else "Now", else "1d" point.
 *
 * Gates (any failing gate means no indicator, never a guess):
 *   - snapshot confidence must be "high" or "medium" (never low/unknown);
 *   - current and baseline must both be >= MIN_MOMENTUM_PRICE_GBP (penny cards swing
 *     +50% on a single sale, which is low-volume noise, not momentum);
 *   - a change above MAX_PLAUSIBLE_CHANGE (+300%) is treated as a data error;
 *   - a 30d rise is ignored when the same source's 7d change is negative (the move
 *     already reversed);
 *   - provider data older than MAX_MOMENTUM_DATA_AGE_DAYS (by snapshot updatedAt) is
 *     too stale to call a trend.
 * When both windows qualify, the larger % change is reported with its timeframe.
 *
 * "Price dropped" mirrors it downwards, on the same gates: current vs 7d average <= -10%
 * (FALLING_7D_THRESHOLD) or vs 30d average <= -15% (FALLING_30D_THRESHOLD), a 30d drop being
 * ignored when the same source's 7d change is already back up. The biggest drop is reported.
 */
export const RISING_7D_THRESHOLD = 0.1;
export const RISING_30D_THRESHOLD = 0.15;
export const FALLING_7D_THRESHOLD = -0.1;
export const FALLING_30D_THRESHOLD = -0.15;
export const MIN_MOMENTUM_PRICE_GBP = 1;
export const MAX_PLAUSIBLE_CHANGE = 3;
export const MAX_MOMENTUM_DATA_AGE_DAYS = 7;

export type MomentumTimeframe = '7d' | '30d';
export type MomentumConfidence = 'high' | 'medium' | 'low' | 'unknown';

export interface MomentumTrendPoint {
  label: string;
  source: string;
  gbpAmount: number;
}

export interface MomentumPriceInput {
  confidence: MomentumConfidence;
  trendPoints: MomentumTrendPoint[];
  updatedAt?: string | null;
}

export interface PriceMomentum {
  /** Fractional change, e.g. 0.18 for +18%. */
  change: number;
  timeframe: MomentumTimeframe;
  source: string;
  currentGbpAmount: number;
  baselineGbpAmount: number;
}

const CURRENT_LABELS = ['trend', 'now', '1d'] as const;

export function isMomentumEligibleConfidence(confidence: MomentumConfidence | null | undefined) {
  return confidence === 'high' || confidence === 'medium';
}

/** Every qualifying-or-not change per source/timeframe that passes the data gates. */
export function measurePriceMomentum(price: MomentumPriceInput | null | undefined, now = Date.now()): PriceMomentum[] {
  if (!price || !isMomentumEligibleConfidence(price.confidence)) return [];

  const updatedAtMs = price.updatedAt ? Date.parse(price.updatedAt) : NaN;
  if (Number.isFinite(updatedAtMs) && now - updatedAtMs > MAX_MOMENTUM_DATA_AGE_DAYS * 24 * 60 * 60 * 1000) return [];

  const bySource = new Map<string, Map<string, number>>();
  for (const point of price.trendPoints ?? []) {
    if (!point || typeof point.gbpAmount !== 'number' || !Number.isFinite(point.gbpAmount) || point.gbpAmount <= 0)
      continue;
    const labels = bySource.get(point.source) ?? new Map<string, number>();
    // Later points win, matching how providers append their freshest value last.
    labels.set(point.label.trim().toLowerCase(), point.gbpAmount);
    bySource.set(point.source, labels);
  }

  const measurements: PriceMomentum[] = [];
  for (const [source, labels] of bySource) {
    // oxlint-disable-next-line react-doctor/js-index-maps -- first match in a fixed priority list
    const currentLabel = CURRENT_LABELS.find((label) => labels.has(label));
    const current = currentLabel ? labels.get(currentLabel)! : null;
    if (current == null || current < MIN_MOMENTUM_PRICE_GBP) continue;

    for (const timeframe of ['7d', '30d'] as const) {
      const baseline = labels.get(timeframe);
      if (baseline == null || baseline < MIN_MOMENTUM_PRICE_GBP) continue;
      // Round to basis points so float noise (23 / 20 - 1 = 0.1499...) cannot flip a threshold.
      const change = Math.round((current / baseline - 1) * 10_000) / 10_000;
      if (!Number.isFinite(change) || change > MAX_PLAUSIBLE_CHANGE) continue;
      measurements.push({ change, timeframe, source, currentGbpAmount: current, baselineGbpAmount: baseline });
    }
  }

  return measurements;
}

export function getRisingMomentum(
  price: MomentumPriceInput | null | undefined,
  now = Date.now(),
): PriceMomentum | null {
  const measurements = measurePriceMomentum(price, now);
  const qualifying = measurements.filter((measurement) => {
    if (measurement.timeframe === '7d') return measurement.change >= RISING_7D_THRESHOLD;

    const sameSource7d = measurements.find((other) => other.source === measurement.source && other.timeframe === '7d');
    if (sameSource7d && sameSource7d.change < 0) return false;
    return measurement.change >= RISING_30D_THRESHOLD;
  });

  if (qualifying.length === 0) return null;
  return qualifying.reduce((best, candidate) => (candidate.change > best.change ? candidate : best));
}

export function getFallingMomentum(
  price: MomentumPriceInput | null | undefined,
  now = Date.now(),
): PriceMomentum | null {
  const measurements = measurePriceMomentum(price, now);
  const qualifying = measurements.filter((measurement) => {
    if (measurement.timeframe === '7d') return measurement.change <= FALLING_7D_THRESHOLD;

    const sameSource7d = measurements.find((other) => other.source === measurement.source && other.timeframe === '7d');
    if (sameSource7d && sameSource7d.change > 0) return false;
    return measurement.change <= FALLING_30D_THRESHOLD;
  });

  if (qualifying.length === 0) return null;
  return qualifying.reduce((best, candidate) => (candidate.change < best.change ? candidate : best));
}

export function formatMomentumChange(change: number) {
  const percent = Math.round(change * 100);
  return `${percent >= 0 ? '+' : ''}${percent}%`;
}

/*
 * List helpers for "% up" / "% down" sorts and the Show "Good pickups" strip. They only ever
 * rank by getRisingMomentum / getFallingMomentum, so every threshold and gate above still
 * applies; cards that do not qualify (or have no price) keep their original relative order
 * after the ranked ones. Generic over the row type: pass a getter that returns the row's
 * momentum price input (or null), so callers are not coupled to collection/Wanted types.
 */
export type MomentumPriceGetter<T> = (item: T) => MomentumPriceInput | null | undefined;

export interface RankedMomentumItem<T> {
  item: T;
  momentum: PriceMomentum;
}

/** Biggest rise first; nulls last. Usable directly with Array.prototype.sort on momenta. */
export function compareByRisingMomentum(a: PriceMomentum | null | undefined, b: PriceMomentum | null | undefined) {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return b.change - a.change;
}

/** Biggest drop (most negative change) first; nulls last. */
export function compareByFallingMomentum(a: PriceMomentum | null | undefined, b: PriceMomentum | null | undefined) {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.change - b.change;
}

function sortByMomentum<T>(
  items: readonly T[],
  getPrice: MomentumPriceGetter<T>,
  measure: (price: MomentumPriceInput | null | undefined, now: number) => PriceMomentum | null,
  compare: (a: PriceMomentum | null, b: PriceMomentum | null) => number,
  now: number,
): T[] {
  // Decorate once so momentum is computed per item, not per comparison; index keeps it stable.
  return items
    .map((item, index) => ({ item, index, momentum: measure(getPrice(item), now) }))
    .sort((a, b) => compare(a.momentum, b.momentum) || a.index - b.index)
    .map(({ item }) => item);
}

/** New array: qualifying risers by biggest % up, then everything else in original order. */
export function sortByRisingMomentum<T>(items: readonly T[], getPrice: MomentumPriceGetter<T>, now = Date.now()): T[] {
  return sortByMomentum(items, getPrice, getRisingMomentum, compareByRisingMomentum, now);
}

/** New array: qualifying fallers by biggest % down, then everything else in original order. */
export function sortByFallingMomentum<T>(items: readonly T[], getPrice: MomentumPriceGetter<T>, now = Date.now()): T[] {
  return sortByMomentum(items, getPrice, getFallingMomentum, compareByFallingMomentum, now);
}

function rankByMomentum<T>(
  items: readonly T[],
  getPrice: MomentumPriceGetter<T>,
  measure: (price: MomentumPriceInput | null | undefined, now: number) => PriceMomentum | null,
  compare: (a: PriceMomentum, b: PriceMomentum) => number,
  now: number,
  limit?: number,
): RankedMomentumItem<T>[] {
  const ranked = items
    .map((item, index) => ({ item, index, momentum: measure(getPrice(item), now) }))
    .filter((entry): entry is { item: T; index: number; momentum: PriceMomentum } => entry.momentum !== null)
    .sort((a, b) => compare(a.momentum, b.momentum) || a.index - b.index)
    .map(({ item, momentum }) => ({ item, momentum }));
  return limit != null && limit >= 0 ? ranked.slice(0, limit) : ranked;
}

/** Only items that qualify as "Price dropped", biggest drop first (Show "Good pickups"). */
export function rankFallingPickups<T>(
  items: readonly T[],
  getPrice: MomentumPriceGetter<T>,
  options: { now?: number; limit?: number } = {},
): RankedMomentumItem<T>[] {
  return rankByMomentum(
    items,
    getPrice,
    getFallingMomentum,
    compareByFallingMomentum,
    options.now ?? Date.now(),
    options.limit,
  );
}

/** Only items that qualify as "Rising", biggest rise first ("Trending up"). */
export function rankRisingMomentum<T>(
  items: readonly T[],
  getPrice: MomentumPriceGetter<T>,
  options: { now?: number; limit?: number } = {},
): RankedMomentumItem<T>[] {
  return rankByMomentum(
    items,
    getPrice,
    getRisingMomentum,
    compareByRisingMomentum,
    options.now ?? Date.now(),
    options.limit,
  );
}
