import { describe, test } from "node:test"
import assert from "node:assert/strict"
import {
  SHOW_SESSION_MAX_AGE_MS,
  addShowPurchase,
  emptyShowSession,
  parseShowSession,
  removeShowPurchases,
  splitBundlePrice,
  summarizeShowSession,
  type ShowPurchase,
} from "@/lib/show-session"

const purchase = (id: string, price: number, marketPrice: number | null, currency = "GBP"): ShowPurchase => ({
  id, cardId: `c-${id}`, cardName: `Card ${id}`, language: "en", finish: "normal", price, marketPrice, currency, at: 1,
})

describe("show session tally", () => {
  test("adds, removes and totals purchases in the display currency", () => {
    let session = emptyShowSession(1000)
    session = addShowPurchase(session, purchase("a", 6, 10), 1000)
    session = addShowPurchase(session, purchase("b", 4, null), 1000)
    session = addShowPurchase(session, purchase("c", 9, 8, "EUR"), 1000)
    assert.deepEqual(summarizeShowSession(session, "GBP"), { count: 2, spent: 10, marketValue: 10, saved: 4, currency: "GBP" })
    session = removeShowPurchases(session, ["a"])
    assert.equal(summarizeShowSession(session, "GBP").spent, 4)
  })

  test("parses defensively and starts a new session after a day", () => {
    assert.deepEqual(parseShowSession("nope", 5), emptyShowSession(5))
    const raw = JSON.stringify({ startedAt: 100, purchases: [purchase("a", 6, 10), { id: 3 }] })
    assert.equal(parseShowSession(raw, 200).purchases.length, 1)
    assert.equal(parseShowSession(raw, 100 + SHOW_SESSION_MAX_AGE_MS + 1).purchases.length, 0)
    const stale = { startedAt: 0, purchases: [purchase("a", 6, 10)] }
    const next = addShowPurchase(stale, purchase("b", 2, 3), SHOW_SESSION_MAX_AGE_MS + 10)
    assert.deepEqual(next.purchases.map((entry) => entry.id), ["b"])
  })

  test("splits a bundle total by market price, keeping the exact total", () => {
    assert.deepEqual(splitBundlePrice(10, [2, 6, 2]), [2, 6, 2])
    const parts = splitBundlePrice(10, [1, 1, 1])
    assert.equal(Math.round(parts.reduce((sum, part) => sum + part, 0) * 100) / 100, 10)
    assert.deepEqual(splitBundlePrice(9, [5, null, 4]), [3, 3, 3])
    assert.deepEqual(splitBundlePrice(9, []), [])
  })
})
