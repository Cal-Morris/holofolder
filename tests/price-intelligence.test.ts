import { buildBuySignal } from "../lib/price-intelligence"
import test from "node:test"
import assert from "node:assert/strict"
import { buildCardPriceSnapshotFromPricing } from "../lib/card-pricing"

const fxRates = {
  date: "2026-06-28",
  eurToGbp: 0.85,
  usdToGbp: 0.75,
}

test("buildCardPriceSnapshotFromPricing marks a card as a good time to buy when current price is below recent history", () => {
  const snapshot = buildCardPriceSnapshotFromPricing("sv1-001", "en", {
    tcgplayer: {
      updated: "2026-06-27T10:00:00.000Z",
      normal: {
        lowPrice: 8,
        marketPrice: 10,
      },
    },
    cardmarket: {
      updated: "2026-06-27T00:00:00.000Z",
      trend: 8,
      avg1: 8,
      avg7: 11,
      avg30: 12,
      low: 7,
    },
  }, fxRates)

  assert.equal(snapshot.buySignal?.status, "good")
  assert.match(snapshot.buySignal?.reason ?? "", /below 30d/i)
})

test("buildCardPriceSnapshotFromPricing warns when the market is rising above recent history", () => {
  const snapshot = buildCardPriceSnapshotFromPricing("sv1-002", "en", {
    tcgplayer: {
      updated: "2026-06-27T10:00:00.000Z",
      normal: {
        lowPrice: 18,
        marketPrice: 24,
      },
    },
    cardmarket: {
      updated: "2026-06-27T00:00:00.000Z",
      trend: 24,
      avg1: 24,
      avg7: 19,
      avg30: 17,
      low: 18,
    },
  }, fxRates)

  assert.equal(snapshot.buySignal?.status, "rising")
  assert.match(snapshot.buySignal?.reason ?? "", /above 30d/i)
})

test("buildCardPriceSnapshotFromPricing stays neutral when history is too thin", () => {
  const snapshot = buildCardPriceSnapshotFromPricing("sv1-003", "en", {
    tcgplayer: {
      updated: "2026-06-27T10:00:00.000Z",
      normal: {
        marketPrice: 10,
      },
    },
  }, fxRates)

  assert.equal(snapshot.buySignal?.status, "hold")
  assert.match(snapshot.buySignal?.reason ?? "", /not enough/i)
})


test("all timing calls require medium or high confidence, weak quotes retain thin-data context", () => {
  for (const confidence of ["low", "unknown", undefined] as const) {
    for (const marketGbpAmount of [8, 15]) {
      const signal = buildBuySignal({ marketGbpAmount, lowGbpAmount: 7, highGbpAmount: 20, confidence, trendPoints: [{ label: "30d", gbpAmount: 10 }] })
      assert.equal(signal?.status, "hold")
      assert.equal(signal?.label, "Thin data")
    }
  }
  assert.equal(buildBuySignal({ marketGbpAmount: 8, lowGbpAmount: 7, highGbpAmount: 20, confidence: "high", trendPoints: [{ label: "30d", gbpAmount: 10 }] })?.status, "good")
  assert.equal(buildBuySignal({ marketGbpAmount: 0, lowGbpAmount: null, highGbpAmount: null, confidence: "high", trendPoints: [] }), null)
})
