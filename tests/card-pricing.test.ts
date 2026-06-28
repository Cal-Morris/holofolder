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
      avg1: 8.8,
      avg7: 8.6,
      avg30: 8.4,
      low: 7,
    },
  }, fxRates)

  assert.equal(snapshot.gbpAmount, 7.5)
  assert.equal(snapshot.marketGbpAmount, 7.5)
  assert.equal(snapshot.goodGbpAmount, 6)
  assert.equal(snapshot.lowGbpAmount, 5.95)
  assert.equal(snapshot.highGbpAmount, 8.8)
  assert.equal(snapshot.confidence, "high")
  assert.equal(snapshot.source, "tcgplayer")
  assert.equal(snapshot.variantLabel, "Normal")
  assert.deepEqual(snapshot.sourcePrices.map((source) => ({
    source: source.source,
    marketGbpAmount: source.marketGbpAmount,
    lowGbpAmount: source.lowGbpAmount,
    variantLabel: source.variantLabel,
  })), [
    { source: "tcgplayer", marketGbpAmount: 7.5, lowGbpAmount: 6, variantLabel: "Normal" },
    { source: "cardmarket", marketGbpAmount: 7.65, lowGbpAmount: 5.95, variantLabel: "Trend" },
  ])
  assert.deepEqual(snapshot.trendPoints.map((point) => ({
    label: point.label,
    gbpAmount: point.gbpAmount,
    source: point.source,
  })), [
    { label: "30d", gbpAmount: 7.14, source: "cardmarket" },
    { label: "7d", gbpAmount: 7.31, source: "cardmarket" },
    { label: "1d", gbpAmount: 7.48, source: "cardmarket" },
    { label: "Trend", gbpAmount: 7.65, source: "cardmarket" },
  ])
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
  assert.equal(snapshot.highGbpAmount, 25.88)
  assert.equal(snapshot.confidence, "low")
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

test("buildCardPriceSnapshotFromPricing lowers confidence and widens range when sources disagree", () => {
  const snapshot = buildCardPriceSnapshotFromPricing("sv1-004", "en", {
    tcgplayer: {
      updated: "2026-06-27T10:00:00.000Z",
      normal: {
        lowPrice: 8,
        marketPrice: 10,
      },
    },
    cardmarket: {
      updated: "2026-06-27T00:00:00.000Z",
      trend: 20,
      avg1: 19,
      avg7: 18,
      avg30: 16,
      low: 15,
    },
  }, fxRates)

  assert.equal(snapshot.marketGbpAmount, 7.5)
  assert.equal(snapshot.lowGbpAmount, 6)
  assert.equal(snapshot.highGbpAmount, 19.55)
  assert.equal(snapshot.confidence, "low")
  assert.equal(snapshot.sourcePrices.length, 2)
})
