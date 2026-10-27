import { test } from "node:test"
import assert from "node:assert/strict"
import { buildBundlePriceGuide } from "../lib/bundle-price-guide"
import type { CardPriceCheck } from "../lib/card-price-checks"
// Synthetic exact-printing prices, not real sales.
const now = Date.parse("2026-10-27T12:00:00Z")
const soldCheck: CardPriceCheck = { checkedAt: new Date(now).toISOString(), summary: { kind: "sold", currency: "GBP", count: 12, low: 98, median: 100, high: 102 }, sales: Array.from({ length: 12 }, (_, i) => ({ amount: 100, soldAt: `2026-10-${25 - i % 3}` })) }
const entry = { marketPrice: 102, catalogMarketGbp: 102, gbpPerUnit: 1, currency: "GBP", finish: "normal" as const, soldCheck }
test("bundle sums qualified sold and catalogue references, with explicit missing coverage", () => {
  const guide = buildBundlePriceGuide([entry, { ...entry, soldCheck: undefined }, { ...entry, soldCheck: undefined, catalogMarketGbp: null, marketPrice: null }], "GBP", undefined, now)
  assert.equal(guide.marketTotal, 202)
  assert.deepEqual(guide.items.map(item => item.source), ["sold", "catalogue", "unknown"])
  assert.deepEqual(guide.band, { low: 161.6, high: 181.8 })
  assert.equal(guide.complete, false)
  assert.equal(guide.overlap, null)
})
test("bundle never combines currencies or guesses FX, and stale sold falls back to catalogue", () => {
  const guide = buildBundlePriceGuide([{ ...entry, currency: "USD" }, { ...entry, currency: "EUR", gbpPerUnit: null }, { ...entry, soldCheck: { ...soldCheck, checkedAt: "2026-10-01" } }], "GBP", undefined, now)
  assert.deepEqual(guide.items.map(item => item.marketPrice), [null, null, 102])
  const converted = buildBundlePriceGuide([{ ...entry, currency: "EUR", gbpPerUnit: 0.8, marketPrice: 127.5 }], "EUR", undefined, now)
  assert.equal(converted.marketTotal, 125)
  assert.deepEqual(converted.overlap, { low: 102, high: 112.5 })
})

test("legacy bundle values remain usable without claiming catalogue or sold provenance", () => {
  const guide = buildBundlePriceGuide([{ marketPrice: 100, currency: "GBP", finish: "normal" }], "GBP", undefined, now)
  assert.equal(guide.marketTotal, 100)
  assert.equal(guide.items[0].source, "saved")
  assert.equal(guide.overlap, null)
})
