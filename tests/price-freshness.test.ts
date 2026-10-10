import test from "node:test"
import assert from "node:assert/strict"
import type { CardPriceSnapshot } from "../lib/card-pricing"
import {
  applyPriceStaleness,
  capConfidence,
  carryForwardMissingPrice,
  getPriceDataAgeDays,
} from "../lib/price-freshness"

const now = Date.parse("2026-10-09T12:00:00.000Z")
const daysAgo = (days: number) => new Date(now - days * 24 * 60 * 60 * 1000).toISOString()

// Test fixture snapshot (not real market data).
function fixtureSnapshot(overrides: Partial<CardPriceSnapshot> = {}): CardPriceSnapshot {
  return {
    cardId: "fixture-001",
    language: "en",
    gbpAmount: 10,
    marketGbpAmount: 10,
    goodGbpAmount: 8,
    lowGbpAmount: 7,
    highGbpAmount: 12,
    confidence: "high",
    sourcePrices: [],
    trendPoints: [],
    buySignal: { status: "rising", label: "Rising", reason: "fixture" },
    originalAmount: 13,
    originalCurrency: "USD",
    source: "tcgplayer",
    variantLabel: "Normal",
    updatedAt: daysAgo(1),
    fxDate: "2026-10-08",
    ...overrides,
  }
}

function emptyFixture(): CardPriceSnapshot {
  return fixtureSnapshot({
    gbpAmount: null,
    marketGbpAmount: null,
    goodGbpAmount: null,
    lowGbpAmount: null,
    highGbpAmount: null,
    confidence: "unknown",
    buySignal: null,
    originalAmount: null,
    originalCurrency: null,
    source: null,
    variantLabel: null,
    updatedAt: null,
    fxDate: null,
  })
}

test("capConfidence never raises confidence", () => {
  assert.equal(capConfidence("high", "medium"), "medium")
  assert.equal(capConfidence("low", "medium"), "low")
  assert.equal(capConfidence("unknown", "low"), "unknown")
})

test("getPriceDataAgeDays handles missing and invalid timestamps", () => {
  assert.equal(getPriceDataAgeDays(null, now), null)
  assert.equal(getPriceDataAgeDays("not a date", now), null)
  assert.equal(getPriceDataAgeDays(daysAgo(3), now), 3)
  assert.equal(getPriceDataAgeDays(new Date(now + 60_000).toISOString(), now), 0)
})

test("fresh provider data is left untouched", () => {
  const snapshot = fixtureSnapshot({ updatedAt: daysAgo(2) })
  assert.deepEqual(applyPriceStaleness(snapshot, now), snapshot)
})

test("unknown provider timestamps are not penalised", () => {
  const snapshot = fixtureSnapshot({ updatedAt: null })
  assert.deepEqual(applyPriceStaleness(snapshot, now), snapshot)
})

test("week-old data is capped at medium confidence and loses its timing call", () => {
  const result = applyPriceStaleness(fixtureSnapshot({ updatedAt: daysAgo(10) }), now)
  assert.equal(result.confidence, "medium")
  assert.equal(result.buySignal?.status, "hold")
  assert.equal(result.buySignal?.label, "Stale data")
  assert.match(result.buySignal?.reason ?? "", /10 days ago/)
  assert.equal(result.marketGbpAmount, 10)
})

test("month-old data is capped at low confidence", () => {
  assert.equal(applyPriceStaleness(fixtureSnapshot({ updatedAt: daysAgo(45) }), now).confidence, "low")
})

test("unpriced snapshots are never marked stale", () => {
  const empty = emptyFixture()
  assert.deepEqual(applyPriceStaleness({ ...empty, updatedAt: daysAgo(90) }, now), { ...empty, updatedAt: daysAgo(90) })
})

test("a successful refresh always wins over the previous row", () => {
  const fresh = fixtureSnapshot({ marketGbpAmount: 11, gbpAmount: 11 })
  const previous = { snapshot: fixtureSnapshot(), fetchedAt: daysAgo(1) }
  assert.equal(carryForwardMissingPrice(fresh, previous, now), fresh)
})

test("an empty refresh keeps the last known price at low confidence without a buy signal", () => {
  const previous = { snapshot: fixtureSnapshot({ updatedAt: daysAgo(3) }), fetchedAt: daysAgo(1) }
  const result = carryForwardMissingPrice(emptyFixture(), previous, now)

  assert.equal(result.marketGbpAmount, 10)
  assert.equal(result.confidence, "low")
  assert.equal(result.buySignal, null)
  assert.equal(result.updatedAt, daysAgo(3))
})

test("carried prices pin updatedAt to the last real observation so they expire", () => {
  const previous = { snapshot: fixtureSnapshot({ updatedAt: null }), fetchedAt: daysAgo(5) }
  const carried = carryForwardMissingPrice(emptyFixture(), previous, now)
  assert.equal(carried.updatedAt, daysAgo(5))

  // Re-carrying the carried row (now fetched "today") must not reset its age.
  const recarried = carryForwardMissingPrice(emptyFixture(), { snapshot: carried, fetchedAt: daysAgo(0) }, now + 26 * 24 * 60 * 60 * 1000)
  assert.equal(recarried.marketGbpAmount, null)
})

test("prices older than the carry-forward window are dropped", () => {
  const previous = { snapshot: fixtureSnapshot({ updatedAt: daysAgo(40) }), fetchedAt: daysAgo(1) }
  assert.equal(carryForwardMissingPrice(emptyFixture(), previous, now).marketGbpAmount, null)
})

test("nothing to carry when there is no previous price", () => {
  const empty = emptyFixture()
  assert.equal(carryForwardMissingPrice(empty, null, now), empty)
  assert.equal(carryForwardMissingPrice(empty, { snapshot: emptyFixture(), fetchedAt: daysAgo(1) }, now), empty)
})

test("finish evidence is capped independently and carried prices cannot retain high-confidence finishes", () => {
  const oldFinish = { ...fixtureSnapshot({ updatedAt: daysAgo(31) }), finish: "holo" as const, variantKey: "holofoil" }
  const snapshot = fixtureSnapshot({ finishPrices: [oldFinish] })
  assert.equal(applyPriceStaleness(snapshot, now).finishPrices?.[0].confidence, "low")
  const carried = carryForwardMissingPrice(emptyFixture(), { snapshot: fixtureSnapshot({ finishPrices: [{ ...oldFinish, updatedAt: daysAgo(1) }] }), fetchedAt: daysAgo(1) }, now)
  assert.equal(carried.finishPrices?.[0].confidence, "low")
})
