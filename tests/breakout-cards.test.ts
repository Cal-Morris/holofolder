import test from "node:test"
import assert from "node:assert/strict"
import { rankBreakoutCards, type BreakoutCandidate } from "../lib/breakout-cards"
import type { MomentumPriceInput } from "../lib/price-momentum"

// Labelled test fixtures only; none of these numbers are real market prices.
const now = Date.parse("2026-10-09T12:00:00.000Z")
const recent = new Date(now - 60 * 60 * 1000).toISOString()

function fixture(cardId: string, points: Record<string, number> | null, confidence: MomentumPriceInput["confidence"] = "high"): BreakoutCandidate<{ id: string }> {
  return {
    card: { id: cardId },
    cardId,
    price: points
      ? {
          confidence,
          updatedAt: recent,
          trendPoints: Object.entries(points).map(([label, gbpAmount]) => ({ label, source: "cardmarket", gbpAmount })),
        }
      : undefined,
  }
}

test("ranks by weighted momentum: a weekly move beats the same monthly move", () => {
  const ranked = rankBreakoutCards([
    fixture("month-30", { "30d": 10, Trend: 13 }),
    fixture("week-20", { "7d": 10, Trend: 12 }),
    fixture("month-60", { "30d": 10, Trend: 16 }),
  ], { now })

  assert.deepEqual(ranked.map((entry) => entry.cardId), ["month-60", "week-20", "month-30"])
  assert.deepEqual(ranked.map((entry) => [entry.momentum.timeframe, Math.round(entry.momentum.change * 100)]), [["30d", 60], ["7d", 20], ["30d", 30]])
})

test("only confidence-gated rising cards qualify", () => {
  const ranked = rankBreakoutCards([
    fixture("low-confidence", { "30d": 10, Trend: 20 }, "low"),
    fixture("unknown-confidence", { "30d": 10, Trend: 20 }, "unknown"),
    fixture("unpriced", null),
    fixture("flat", { "30d": 10, "7d": 10, Trend: 10.5 }),
    fixture("falling", { "30d": 10, "7d": 9, Trend: 8 }),
    fixture("penny", { "30d": 0.1, Trend: 0.5 }),
    fixture("medium-rising", { "7d": 10, Trend: 11.5 }, "medium"),
  ], { now })

  assert.deepEqual(ranked.map((entry) => entry.cardId), ["medium-rising"])
})

test("returns nothing when no card qualifies so the section can hide", () => {
  assert.deepEqual(rankBreakoutCards([fixture("flat", { "30d": 10, Trend: 10 })], { now }), [])
  assert.deepEqual(rankBreakoutCards([], { now }), [])
})

test("caps the list and keeps a stable tie order", () => {
  const ranked = rankBreakoutCards([
    fixture("b", { "7d": 10, Trend: 12 }),
    fixture("a", { "7d": 10, Trend: 12 }),
    fixture("pricier", { "7d": 50, Trend: 60 }),
    fixture("medium-tie", { "7d": 100, Trend: 120 }, "medium"),
    fixture("top", { "7d": 10, Trend: 15 }),
  ], { now, limit: 4 })

  assert.deepEqual(ranked.map((entry) => entry.cardId), ["top", "pricier", "a", "b"])
  assert.equal(rankBreakoutCards([fixture("top", { "7d": 10, Trend: 15 })], { now, limit: 0 }).length, 0)
})

test("duplicate card ids are counted once", () => {
  const ranked = rankBreakoutCards([
    fixture("dup", { "7d": 10, Trend: 15 }),
    fixture("dup", { "7d": 10, Trend: 15 }),
  ], { now })
  assert.equal(ranked.length, 1)
})

test("default ranking shows ten qualifying breakouts instead of three", () => {
  const ranked = rankBreakoutCards(Array.from({ length: 12 }, (_, index) => fixture(`card-${index}`, { "7d": 10, Trend: 12 })), { now })
  assert.equal(ranked.length, 10)
})
