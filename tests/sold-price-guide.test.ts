import { test } from "node:test"
import assert from "node:assert/strict"
import { buildSoldPriceGuide, buildSoldPriceChart } from "../lib/sold-price-guide"
import type { CardPriceCheck } from "../lib/card-price-checks"

// Synthetic prices and dates, not real market data.
const now = Date.parse("2026-10-27T12:00:00Z")
const check = (amounts = [98, 99, 100, 101, 102, 98, 99, 100, 101, 102]): CardPriceCheck => ({
  summary: { kind: "sold", currency: "GBP", count: amounts.length, median: 100, low: 98, high: 102 },
  checkedAt: "2026-10-27T10:00:00Z",
  sales: amounts.map((amount, i) => ({ amount, soldAt: `2026-10-${25 - i % 3}` })),
})

test("recent concentrated sold evidence provides a buying band and overlap with the catalogue guide", () => {
  const guide = buildSoldPriceGuide(check(), 102, "normal", undefined, now)!
  assert.equal(guide.eligible, true)
  assert.equal(guide.referenceGbp, 100)
  assert.deepEqual(guide.fairBand, { low: 90, high: 110 })
  assert.deepEqual(guide.fairOverlap, { low: 91.8, high: 110 })
  assert.deepEqual(guide.soldBand, { low: 80, high: 90 })
  assert.deepEqual(guide.overlap, { low: 81.6, high: 90 })
})

test("weak, stale, broad, unknown-finish and conflicting evidence cannot change the reference", () => {
  const cases = [
    buildSoldPriceGuide(check([100, 100]), 100, "normal", undefined, now),
    buildSoldPriceGuide({ ...check(), checkedAt: "2026-10-01T00:00:00Z" }, 100, "normal", undefined, now),
    buildSoldPriceGuide({ ...check(), sales: check().sales!.map(sale => ({ ...sale, soldAt: "2026-10-01" })) }, 100, "normal", undefined, now),
    buildSoldPriceGuide(check([10, 20, 30, 40, 50, 100, 200, 300, 400, 500]), 100, "normal", undefined, now),
    buildSoldPriceGuide(check(), 100, undefined, undefined, now),
    buildSoldPriceGuide(check(), 200, "normal", undefined, now),
  ]
  for (const guide of cases) assert.equal(guide?.referenceGbp ?? null, null)
  assert.equal(buildSoldPriceGuide(check(), 200, "normal", undefined, now)?.reason, "The sold and catalogue buying ranges do not overlap. Keeping the catalogue guide.")
})

test("a qualified exact-printing sold guide can fill a missing catalogue price and respects custom thresholds", () => {
  const guide = buildSoldPriceGuide(check(), null, "special_illustration_rare", { greatPct: 25, fairPct: 15, walkAwayPct: 40 }, now)!
  assert.equal(guide.referenceGbp, 100)
  assert.deepEqual(guide.soldBand, { low: 75, high: 85 })
  assert.equal(guide.overlap, null)
})


test("daily medians keep missing dates empty and never interpolate price history", () => {
  const data = buildSoldPriceChart({ ...check(), sales: [{ amount: 10, soldAt: "2026-10-23" }, { amount: 20, soldAt: "2026-10-23" }, { amount: 30, soldAt: "2026-10-25" }, { amount: 40, soldAt: "2026-10-28" }, { amount: 50, soldAt: "2026-02-30" }] }, now)
  assert.deepEqual(data.daily.map(point => [point.median, point.count]), [[15, 2], [null, 0], [30, 1]])
  assert.equal(data.sales.length, 3)
})

test("ineligible currency, invalid or future timestamps and penny evidence cannot change a guide", () => {
  assert.equal(buildSoldPriceGuide({ ...check(), summary: { ...check().summary, currency: "USD" as "GBP" } }, 100, "normal", undefined, now), null)
  for (const checkedAt of ["invalid", "2026-10-28T00:00:00Z"]) assert.equal(buildSoldPriceGuide({ ...check(), checkedAt }, 100, "normal", undefined, now)?.referenceGbp, null)
  assert.equal(buildSoldPriceGuide(check(Array(10).fill(0.5)), 0.5, "normal", undefined, now)?.referenceGbp, null)
})

test("guide limits are inclusive and missing sales cannot inflate its sample", () => {
  assert.equal(buildSoldPriceGuide(check([75, 75, 75, 75, 100, 100, 125, 125, 125, 125]), 100, "normal", undefined, now)?.eligible, true)
  assert.equal(buildSoldPriceGuide({ ...check(), checkedAt: new Date(now - 7 * 86400_000).toISOString() }, 100, "normal", undefined, now)?.eligible, true)
  assert.equal(buildSoldPriceGuide({ ...check(), checkedAt: new Date(now - 7 * 86400_000 - 1).toISOString() }, 100, "normal", undefined, now)?.eligible, false)
  assert.equal(buildSoldPriceGuide(check(Array(9).fill(100)), 100, "normal", undefined, now)?.eligible, false)
  assert.equal(buildSoldPriceGuide({ ...check(), sales: check().sales!.map(sale => ({ ...sale, soldAt: "2026-10-25" })) }, 100, "normal", undefined, now)?.eligible, false)
})

test("chart range and candle whiskers come from daily sales, with real gaps", () => {
  const chart = buildSoldPriceChart({ ...check(), sales: [{ amount: 10, soldAt: "2026-10-23" }, { amount: 20, soldAt: "2026-10-23" }, { amount: 30, soldAt: "2026-10-25" }] }, now)
  assert.deepEqual(chart.daily[0].range, [12.5, 17.5])
  assert.deepEqual(chart.daily[0].whisker, [5, 5])
  assert.equal(chart.daily[1].range, null)
  assert.deepEqual(chart.daily[2].range, [30, 30])
})
