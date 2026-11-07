import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { parseShowBudget, summarizeShowBudget, showBudgetStorageKey } from "../lib/show-budget"
import { parseShowSession, removeShowPurchases, SHOW_SESSION_MAX_AGE_MS } from "../lib/show-session"

const purchase = (id: string, price: number, currency: string) => ({ id, price, currency, cardId: "synthetic", cardName: "Synthetic", language: "en", finish: "normal", marketPrice: null, at: 1000 })
const session = { startedAt: 1000, purchases: [purchase("a", 12, "GBP"), purchase("b", 4.5, "GBP"), purchase("c", 9, "EUR")] }
const budget = { limit: 20, currency: "GBP" as const }

describe("show budget", () => {
  test("rejects invalid money and unsupported currencies", () => {
    assert.deepEqual(parseShowBudget(JSON.stringify(budget)), budget)
    for (const value of [null, "nope", "[]", JSON.stringify({ limit: -1, currency: "GBP" }), JSON.stringify({ limit: 0, currency: "GBP" }), JSON.stringify({ limit: "20", currency: "GBP" }), JSON.stringify({ limit: 20, currency: "wat" })]) assert.equal(parseShowBudget(value), null)
  })
  test("totals only the budget currency, reports excluded purchases and over-budget amounts", () => {
    assert.deepEqual(summarizeShowBudget(budget, session), { spent: 16.5, remaining: 3.5, excludedCount: 1 })
    assert.equal(summarizeShowBudget({ ...budget, limit: 10 }, session).remaining, -6.5)
    assert.equal(summarizeShowBudget(budget, removeShowPurchases(session, ["a"])).remaining, 15.5)
  })
  test("starts spending from zero for a cleared or expired show and isolates accounts", () => {
    assert.equal(summarizeShowBudget(budget, parseShowSession(JSON.stringify(session), 1001 + SHOW_SESSION_MAX_AGE_MS)).remaining, 20)
    assert.equal(summarizeShowBudget(budget, { startedAt: 2000, purchases: [] }).spent, 0)
    assert.notEqual(showBudgetStorageKey("a", "owner"), showBudgetStorageKey("b", "owner"))
    assert.notEqual(showBudgetStorageKey("a", "owner"), showBudgetStorageKey("a", "other"))
    assert.equal(showBudgetStorageKey(null, "owner"), null)
  })
})
