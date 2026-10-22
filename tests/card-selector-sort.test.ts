import { describe, test } from "node:test"
import assert from "node:assert/strict"
import type { CardPriceSnapshot } from "../lib/card-pricing"
import {
  getCardPickerSortAmount,
  normalizeCardPickerSort,
  sortCardPickerCards,
} from "../lib/card-selector-sort"

// TEST FIXTURES ONLY: synthetic cards and amounts. Not market data.
const card = (id: string, releaseDate?: string) => ({ id, localId: id, set: { id: `set-${id}`, releaseDate } })
const cards = [card("a", "2023-01-01"), card("b", "2025-06-01"), card("c"), card("d", "2020-03-01")]
const prices: Record<string, number | null> = { a: 0.5, b: null, c: 12, d: 3 }
const ids = (list: Array<{ id: string }>) => list.map((entry) => entry.id)

describe("card picker sort", () => {
  test("default keeps the incoming order", () => {
    assert.deepEqual(ids(sortCardPickerCards(cards, "default", (entry) => prices[entry.id])), ["a", "b", "c", "d"])
  })

  test("price sorts rank priced cards and list unpriced cards last", () => {
    assert.deepEqual(ids(sortCardPickerCards(cards, "price-desc", (entry) => prices[entry.id])), ["c", "d", "a", "b"])
    assert.deepEqual(ids(sortCardPickerCards(cards, "price-asc", (entry) => prices[entry.id])), ["a", "d", "c", "b"])
  })

  test("set date sorts put undated sets last", () => {
    assert.deepEqual(ids(sortCardPickerCards(cards, "newest", () => null)), ["b", "a", "d", "c"])
    assert.deepEqual(ids(sortCardPickerCards(cards, "oldest", () => null)), ["d", "a", "b", "c"])
  })

  test("unknown stored values fall back to default", () => {
    assert.equal(normalizeCardPickerSort("price-desc"), "price-desc")
    assert.equal(normalizeCardPickerSort("cheapest"), "default")
    assert.equal(normalizeCardPickerSort(null), "default")
  })

  test("sort amount uses market price, then the good price, else null", () => {
    const snap = (partial: Partial<CardPriceSnapshot>) => ({ cardId: "x", ...partial }) as CardPriceSnapshot
    assert.equal(getCardPickerSortAmount(snap({ marketGbpAmount: 4, goodGbpAmount: 2, gbpAmount: 4 }), "normal", "UK"), 4)
    assert.equal(getCardPickerSortAmount(snap({ marketGbpAmount: null, gbpAmount: null, goodGbpAmount: 2 }), "normal", "UK"), 2)
    assert.equal(getCardPickerSortAmount(snap({ marketGbpAmount: 0, gbpAmount: 0, goodGbpAmount: null }), "normal", "UK"), null)
    assert.equal(getCardPickerSortAmount(undefined, "normal", "UK"), null)
  })
})
