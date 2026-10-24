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
export const RISING_7D_THRESHOLD = 0.1
export const RISING_30D_THRESHOLD = 0.15
export const FALLING_7D_THRESHOLD = -0.1
export const FALLING_30D_THRESHOLD = -0.15
export const MIN_MOMENTUM_PRICE_GBP = 1
export const MAX_PLAUSIBLE_CHANGE = 3
export const MAX_MOMENTUM_DATA_AGE_DAYS = 7

export type MomentumTimeframe = "7d" | "30d"
export type MomentumConfidence = "high" | "medium" | "low" | "unknown"

export interface MomentumTrendPoint {
  label: string
  source: string
  gbpAmount: number
}

export interface MomentumPriceInput {
  confidence: MomentumConfidence
  trendPoints: MomentumTrendPoint[]
  updatedAt?: string | null
}

export interface PriceMomentum {
  /** Fractional change, e.g. 0.18 for +18%. */
  change: number
  timeframe: MomentumTimeframe
  source: string
  currentGbpAmount: number
  baselineGbpAmount: number
}

const CURRENT_LABELS = ["trend", "now", "1d"] as const

export function isMomentumEligibleConfidence(confidence: MomentumConfidence | null | undefined) {
  return confidence === "high" || confidence === "medium"
}

/** Every qualifying-or-not change per source/timeframe that passes the data gates. */
export function measurePriceMomentum(price: MomentumPriceInput | null | undefined, now = Date.now()): PriceMomentum[] {
  if (!price || !isMomentumEligibleConfidence(price.confidence)) return []

  const updatedAtMs = price.updatedAt ? Date.parse(price.updatedAt) : NaN
  if (Number.isFinite(updatedAtMs) && now - updatedAtMs > MAX_MOMENTUM_DATA_AGE_DAYS * 24 * 60 * 60 * 1000) return []

  const bySource = new Map<string, Map<string, number>>()
  for (const point of price.trendPoints ?? []) {
    if (!point || typeof point.gbpAmount !== "number" || !Number.isFinite(point.gbpAmount) || point.gbpAmount <= 0) continue
    const labels = bySource.get(point.source) ?? new Map<string, number>()
    // Later points win, matching how providers append their freshest value last.
    labels.set(point.label.trim().toLowerCase(), point.gbpAmount)
    bySource.set(point.source, labels)
  }

  const measurements: PriceMomentum[] = []
  for (const [source, labels] of bySource) {
    const currentLabel = CURRENT_LABELS.find((label) => labels.has(label))
    const current = currentLabel ? labels.get(currentLabel)! : null
    if (current == null || current < MIN_MOMENTUM_PRICE_GBP) continue

    for (const timeframe of ["7d", "30d"] as const) {
      const baseline = labels.get(timeframe)
      if (baseline == null || baseline < MIN_MOMENTUM_PRICE_GBP) continue
      // Round to basis points so float noise (23 / 20 - 1 = 0.1499...) cannot flip a threshold.
      const change = Math.round((current / baseline - 1) * 10_000) / 10_000
      if (!Number.isFinite(change) || change > MAX_PLAUSIBLE_CHANGE) continue
      measurements.push({ change, timeframe, source, currentGbpAmount: current, baselineGbpAmount: baseline })
    }
  }

  return measurements
}

export function getRisingMomentum(price: MomentumPriceInput | null | undefined, now = Date.now()): PriceMomentum | null {
  const measurements = measurePriceMomentum(price, now)
  const qualifying = measurements.filter((measurement) => {
    if (measurement.timeframe === "7d") return measurement.change >= RISING_7D_THRESHOLD

    const sameSource7d = measurements.find((other) => other.source === measurement.source && other.timeframe === "7d")
    if (sameSource7d && sameSource7d.change < 0) return false
    return measurement.change >= RISING_30D_THRESHOLD
  })

  if (qualifying.length === 0) return null
  return qualifying.reduce((best, candidate) => (candidate.change > best.change ? candidate : best))
}

export function getFallingMomentum(price: MomentumPriceInput | null | undefined, now = Date.now()): PriceMomentum | null {
  const measurements = measurePriceMomentum(price, now)
  const qualifying = measurements.filter((measurement) => {
    if (measurement.timeframe === "7d") return measurement.change <= FALLING_7D_THRESHOLD

    const sameSource7d = measurements.find((other) => other.source === measurement.source && other.timeframe === "7d")
    if (sameSource7d && sameSource7d.change > 0) return false
    return measurement.change <= FALLING_30D_THRESHOLD
  })

  if (qualifying.length === 0) return null
  return qualifying.reduce((best, candidate) => (candidate.change < best.change ? candidate : best))
}

export function formatMomentumChange(change: number) {
  const percent = Math.round(change * 100)
  return `${percent >= 0 ? "+" : ""}${percent}%`
}
