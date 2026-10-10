import test from "node:test"
import assert from "node:assert/strict"
import { buildBuySignal } from "../lib/price-intelligence"
import {
  formatMomentumChange,
  getRisingMomentum,
  measurePriceMomentum,
  type MomentumPriceInput,
} from "../lib/price-momentum"

// Labelled test fixtures only; none of these numbers are real market prices.
const now = Date.parse("2026-10-09T12:00:00.000Z")
const recent = new Date(now - 24 * 60 * 60 * 1000).toISOString()

function fixturePrice(points: Record<string, number>, overrides: Partial<MomentumPriceInput> = {}, source = "cardmarket"): MomentumPriceInput {
  return {
    confidence: "high",
    updatedAt: recent,
    trendPoints: Object.entries(points).map(([label, gbpAmount]) => ({ label, source, gbpAmount })),
    ...overrides,
  }
}

test("rises past the 30d threshold are flagged with % change and timeframe", () => {
  const momentum = getRisingMomentum(fixturePrice({ "30d": 10, "7d": 11.5, Trend: 12 }), now)
  assert.equal(momentum?.timeframe, "30d")
  assert.equal(formatMomentumChange(momentum!.change), "+20%")
})

test("rises past the 7d threshold are flagged when larger than the 30d move", () => {
  const momentum = getRisingMomentum(fixturePrice({ "30d": 10, "7d": 9, Trend: 10.5 }), now)
  assert.equal(momentum?.timeframe, "7d")
  assert.equal(formatMomentumChange(momentum!.change), "+17%")
})

test("moves below the thresholds are not rising", () => {
  assert.equal(getRisingMomentum(fixturePrice({ "30d": 10, "7d": 10.5, Trend: 11.0 }), now), null)
  assert.equal(getRisingMomentum(fixturePrice({ "7d": 10, Trend: 10.9 }), now), null)
})

test("thresholds are inclusive at exactly +10% (7d) and +15% (30d)", () => {
  assert.equal(getRisingMomentum(fixturePrice({ "7d": 10, Trend: 11 }), now)?.timeframe, "7d")
  assert.equal(getRisingMomentum(fixturePrice({ "30d": 20, Trend: 23 }), now)?.timeframe, "30d")
})

test("never shown on low or unknown confidence data", () => {
  const points = { "30d": 10, "7d": 10, Trend: 20 }
  assert.equal(getRisingMomentum(fixturePrice(points, { confidence: "low" }), now), null)
  assert.equal(getRisingMomentum(fixturePrice(points, { confidence: "unknown" }), now), null)
  assert.ok(getRisingMomentum(fixturePrice(points, { confidence: "medium" }), now))
})

test("penny cards are ignored as low-volume noise", () => {
  assert.equal(getRisingMomentum(fixturePrice({ "30d": 0.2, "7d": 0.3, Trend: 0.6 }), now), null)
  assert.equal(getRisingMomentum(fixturePrice({ "30d": 0.8, Trend: 1.6 }), now), null)
})

test("implausible jumps are treated as data errors", () => {
  assert.equal(getRisingMomentum(fixturePrice({ "30d": 2, Trend: 9 }), now), null)
})

test("a 30d rise that already reversed this week is not rising", () => {
  assert.equal(getRisingMomentum(fixturePrice({ "30d": 10, "7d": 14, Trend: 12 }), now), null)
})

test("stale provider data cannot call a trend", () => {
  const stale = new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString()
  assert.equal(getRisingMomentum(fixturePrice({ "30d": 10, Trend: 13 }, { updatedAt: stale }), now), null)
  // Unknown timestamps are not penalised.
  assert.ok(getRisingMomentum(fixturePrice({ "30d": 10, Trend: 13 }, { updatedAt: null }), now))
})

test("sources are never mixed when comparing current price to an average", () => {
  const mixed: MomentumPriceInput = {
    confidence: "high",
    updatedAt: recent,
    trendPoints: [
      { label: "30d", source: "cardmarket", gbpAmount: 10 },
      { label: "Now", source: "pokepulse", gbpAmount: 20 },
    ],
  }
  assert.deepEqual(measurePriceMomentum(mixed, now), [])
  assert.equal(getRisingMomentum(mixed, now), null)
})

test("falls back from Trend to Now to 1d for the current price and ignores bad points", () => {
  assert.equal(getRisingMomentum(fixturePrice({ "7d": 10, Now: 12 }), now)?.currentGbpAmount, 12)
  assert.equal(getRisingMomentum(fixturePrice({ "7d": 10, "1d": 12 }), now)?.currentGbpAmount, 12)
  assert.equal(getRisingMomentum(fixturePrice({ "7d": 10, Trend: Number.NaN }), now), null)
  assert.equal(getRisingMomentum(fixturePrice({ "7d": 10 }), now), null)
  assert.equal(getRisingMomentum(null, now), null)
})

test("formatMomentumChange rounds and signs", () => {
  assert.equal(formatMomentumChange(0.184), "+18%")
  assert.equal(formatMomentumChange(-0.05), "-5%")
})

test("buildBuySignal never calls Rising on low confidence", () => {
  const input = {
    marketGbpAmount: 20,
    lowGbpAmount: 15,
    highGbpAmount: 22,
    trendPoints: [{ label: "30d", gbpAmount: 10 }, { label: "Trend", gbpAmount: 20 }],
  }
  assert.equal(buildBuySignal({ ...input, confidence: "high" })?.status, "rising")
  assert.equal(buildBuySignal({ ...input, confidence: "medium" })?.status, "rising")
  assert.notEqual(buildBuySignal({ ...input, confidence: "low" })?.status, "rising")
  assert.notEqual(buildBuySignal({ ...input, confidence: "unknown" })?.status, "rising")
  assert.notEqual(buildBuySignal(input)?.status, "rising")
})
