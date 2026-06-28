import test from "node:test"
import assert from "node:assert/strict"
import { buildCardPriceSnapshotFromPricing } from "../lib/card-pricing"

const fxRates = {
  date: "2026-06-28",
  eurToGbp: 0.85,
  usdToGbp: 0.75,
}

test("buildCardPriceSnapshotFromPricing uses TCGplayer market as market and low as show target for English cards", () => {
  const snapshot = buildCardPriceSnapshotFromPricing("sv1-001", "en", {
    tcgplayer: {
      updated: "2026-06-27T10:00:00.000Z",
      normal: {
        lowPrice: 8,
        midPrice: 12,
        marketPrice: 10,
        highPrice: 14,
      },
    },
    cardmarket: {
      updated: "2026-06-27T00:00:00.000Z",
      trend: 9,
      low: 7,
    },
  }, fxRates)

  assert.equal(snapshot.gbpAmount, 7.5)
  assert.equal(snapshot.marketGbpAmount, 7.5)
  assert.equal(snapshot.goodGbpAmount, 6)
  assert.equal(snapshot.lowGbpAmount, 6)
  assert.equal(snapshot.highGbpAmount, 8.63)
  assert.equal(snapshot.confidence, "high")
  assert.equal(snapshot.source, "tcgplayer")
  assert.equal(snapshot.variantLabel, "Normal")
})

test("buildCardPriceSnapshotFromPricing prefers Cardmarket trend for European languages", () => {
  const snapshot = buildCardPriceSnapshotFromPricing("sv1-002", "fr", {
    tcgplayer: {
      updated: "2026-06-27T10:00:00.000Z",
      normal: {
        lowPrice: 20,
        marketPrice: 30,
      },
    },
    cardmarket: {
      updated: "2026-06-27T00:00:00.000Z",
      trend: 18,
      low: 12,
    },
  }, fxRates)

  assert.equal(snapshot.gbpAmount, 15.3)
  assert.equal(snapshot.marketGbpAmount, 15.3)
  assert.equal(snapshot.goodGbpAmount, 10.2)
  assert.equal(snapshot.lowGbpAmount, 10.2)
  assert.equal(snapshot.highGbpAmount, 17.6)
  assert.equal(snapshot.confidence, "high")
  assert.equal(snapshot.source, "cardmarket")
  assert.equal(snapshot.variantLabel, "Trend")
})

test("buildCardPriceSnapshotFromPricing marks inferred price ranges as medium confidence", () => {
  const snapshot = buildCardPriceSnapshotFromPricing("sv1-003", "en", {
    tcgplayer: {
      updated: "2026-06-27T10:00:00.000Z",
      normal: {
        marketPrice: 10,
      },
    },
  }, fxRates)

  assert.equal(snapshot.marketGbpAmount, 7.5)
  assert.equal(snapshot.goodGbpAmount, 6)
  assert.equal(snapshot.lowGbpAmount, 6.38)
  assert.equal(snapshot.highGbpAmount, 8.63)
  assert.equal(snapshot.confidence, "medium")
})
