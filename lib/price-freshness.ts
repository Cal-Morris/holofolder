import type { CardPriceSnapshot, PriceConfidence } from "@/lib/card-pricing"

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Freshness rules for provider price data.
 *
 * - Provider data (snapshot.updatedAt) older than STALE_AFTER_DAYS is capped at "medium"
 *   confidence and loses its buy-timing call (a 7d/30d comparison on week-old data is noise).
 * - Provider data older than VERY_STALE_AFTER_DAYS is capped at "low" confidence.
 * - Unknown provider timestamps are left alone (some fallbacks never report one).
 * - When a refresh returns no price (provider outage, FX feed down, transient 5xx) we keep the
 *   last known price for up to CARRY_FORWARD_MAX_DAYS, at "low" confidence and with no buy
 *   signal, instead of overwriting a good row with an empty one.
 */
export const STALE_AFTER_DAYS = 7
export const VERY_STALE_AFTER_DAYS = 30
export const CARRY_FORWARD_MAX_DAYS = 30

const CONFIDENCE_RANK: Record<PriceConfidence, number> = { unknown: 0, low: 1, medium: 2, high: 3 }

export function capConfidence(current: PriceConfidence, cap: PriceConfidence): PriceConfidence {
  return CONFIDENCE_RANK[current] > CONFIDENCE_RANK[cap] ? cap : current
}

export function getPriceDataAgeDays(updatedAt: string | null | undefined, now: number) {
  if (!updatedAt) return null
  const timestamp = Date.parse(updatedAt)
  if (!Number.isFinite(timestamp)) return null
  return Math.max(0, (now - timestamp) / DAY_MS)
}

export function applyPriceStaleness(snapshot: CardPriceSnapshot, now: number): CardPriceSnapshot {
  if (snapshot.finishPrices) {
    snapshot = { ...snapshot, finishPrices: snapshot.finishPrices.map((price) => ({ ...price, ...applyPriceStaleness(price, now) })) }
  }
  if (snapshot.marketGbpAmount == null) return snapshot

  const ageDays = getPriceDataAgeDays(snapshot.updatedAt, now)
  if (ageDays == null || ageDays <= STALE_AFTER_DAYS) return snapshot

  const roundedDays = Math.round(ageDays)
  return {
    ...snapshot,
    confidence: capConfidence(snapshot.confidence, ageDays > VERY_STALE_AFTER_DAYS ? "low" : "medium"),
    buySignal: {
      status: "hold",
      label: "Stale data",
      reason: `Provider prices were last updated ${roundedDays} days ago.`,
    },
  }
}

export function carryForwardMissingPrice(
  fresh: CardPriceSnapshot,
  previous: { snapshot: CardPriceSnapshot; fetchedAt: string | null } | null | undefined,
  now: number,
): CardPriceSnapshot {
  if (fresh.marketGbpAmount != null || !previous || previous.snapshot.marketGbpAmount == null) {
    return fresh
  }

  // Age is measured from when the provider last reported the price (or, if it never said,
  // from when we last fetched it). Pinning updatedAt to that moment means repeated carries
  // never make an old price look newer, so it expires after CARRY_FORWARD_MAX_DAYS.
  const lastObservedAt = previous.snapshot.updatedAt ?? previous.fetchedAt
  const ageDays = getPriceDataAgeDays(lastObservedAt, now)
  if (ageDays == null || ageDays > CARRY_FORWARD_MAX_DAYS) {
    return fresh
  }

  return {
    ...previous.snapshot,
    cardId: fresh.cardId,
    language: fresh.language,
    confidence: capConfidence(previous.snapshot.confidence, "low"),
    buySignal: null,
    updatedAt: lastObservedAt,
    finishPrices: previous.snapshot.finishPrices?.map((price) => ({ ...price, confidence: "low", buySignal: null })),
  }
}
