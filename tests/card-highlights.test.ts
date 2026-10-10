import { test } from "node:test"
import assert from "node:assert/strict"
import { buildCardHighlightCandidates, rankValuableCards } from "../lib/card-highlights"
import { buildCardPriceSnapshotFromPricing } from "../lib/card-pricing"

// Synthetic prices only, including two finishes of the same printing.
const card = { id: "synthetic-1", language: "en" as const, name: "Pikachu", numberLabel: "1/10", setName: "Synthetic set" }
const now = Date.parse("2026-10-10T12:00:00Z")
const price = buildCardPriceSnapshotFromPricing(card.id, "en", {
  tcgplayer: { updated: "2026-10-10T10:00:00Z", normal: { marketPrice: 5, lowPrice: 4 }, holofoil: { marketPrice: 20, lowPrice: 18 } },
}, { date: "2026-10-10", usdToGbp: 0.75, eurToGbp: 0.85 })

test("value ranking preserves separate finishes, deduplicates printings and filters exactly", () => {
  const candidates = buildCardHighlightCandidates([card, card], { "synthetic-1::en": price })
  const ranked = rankValuableCards(candidates, "all", now)
  assert.equal(ranked.length, 2)
  assert.deepEqual(ranked.map((entry) => entry.price.marketGbpAmount), [15, 3.75])
  assert.deepEqual(rankValuableCards(candidates, "normal", now).map((entry) => entry.finish), ["normal"])
  assert.deepEqual(rankValuableCards(candidates, "reverse_holo", now), [])
})

test("unknown finish, low confidence, nonpositive prices and stale data are not value picks", () => {
  const candidates = buildCardHighlightCandidates([card], { "synthetic-1::en": price })
  const now = Date.parse("2026-10-10T12:00:00Z")
  for (const override of [{ confidence: "low" as const }, { marketGbpAmount: 0 }, { marketGbpAmount: -1 }, { updatedAt: "2026-08-01T00:00:00Z" }, { updatedAt: null }]) {
    assert.equal(rankValuableCards(candidates.map((entry) => ({ ...entry, price: { ...entry.price, ...override } })), "all", now).length, 0)
  }
  assert.deepEqual(rankValuableCards(buildCardHighlightCandidates([card], { "synthetic-1::en": { ...price, finishPrices: undefined } })), [])
})

test("value ranking caps at ten and keeps collector-number ties stable", () => {
  const candidates = buildCardHighlightCandidates(Array.from({ length: 12 }, (_, i) => ({ ...card, id: `synthetic-${i}`, numberLabel: `${i + 1}/20` })), Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`synthetic-${i}::en`, price])))
  assert.equal(rankValuableCards(candidates, "all", now).length, 10)
  assert.deepEqual(rankValuableCards(candidates, "normal", now).map((entry) => entry.card.numberLabel), ["1/20", "2/20", "3/20", "4/20", "5/20", "6/20", "7/20", "8/20", "9/20", "10/20"])
})
