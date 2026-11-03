import { test } from "node:test"
import assert from "node:assert/strict"
import { PriceCheckRequestError } from "../lib/card-price-check-client"
import { CHECK_COMPS_CONCURRENCY, CHECK_COMPS_MAX_CARDS, checkCompsTargets, runCheckComps } from "../lib/check-comps"
import { formatPriceCheckAge, isPriceCheckFresh, pinCardPriceCheck, priceCheckKey, readPinnedCardPriceCheck } from "../lib/card-price-check-cache"
import { createMemoryStore } from "../lib/offline-store/kv"
import type { CardPriceCheck, PriceCheckSource } from "../lib/card-price-checks"

// Synthetic checks only, never market data.
const now = Date.parse("2026-11-03T09:00:00Z")
const hours = (n: number) => new Date(now - n * 3600_000).toISOString()
const check = (source: PriceCheckSource, checkedAt: string): CardPriceCheck => ({ summary: { kind: source === "ebay" ? "asking" : "sold", currency: "GBP", count: 1, low: 5, median: 5, high: 5 }, checkedAt })

test("pins are keyed per card, API finish and source; older answers never replace newer ones", async () => {
  const store = createMemoryStore()
  assert.equal(priceCheckKey("sv1-1", "special_illustration_rare", "soldcomps"), "price-check:sv1-1:any:soldcomps")
  await pinCardPriceCheck("sv1-1", "holo", "soldcomps", check("soldcomps", hours(1)), store)
  await pinCardPriceCheck("sv1-1", "holo", "soldcomps", check("soldcomps", hours(5)), store)
  assert.equal((await readPinnedCardPriceCheck("sv1-1", "holo", "soldcomps", store))?.checkedAt, hours(1))
  await pinCardPriceCheck("sv1-1", "holo", "ebay", check("soldcomps", hours(0)), store)
  assert.equal(await readPinnedCardPriceCheck("sv1-1", "holo", "ebay", store), null)
  assert.equal(isPriceCheckFresh(check("soldcomps", hours(11.9)), now), true)
  assert.equal(isPriceCheckFresh(check("soldcomps", hours(12)), now), false)
  assert.equal(formatPriceCheckAge(hours(3), now), "3 h ago")
})

test("targets skip non-English and jumbo cards, dedupe, and cap the run", () => {
  const many = Array.from({ length: CHECK_COMPS_MAX_CARDS + 5 }, (_, i) => ({ cardId: `c-${i}` }))
  assert.equal(checkCompsTargets(many).length, CHECK_COMPS_MAX_CARDS)
  assert.deepEqual(checkCompsTargets([{ cardId: "a" }, { cardId: "a" }, { cardId: "b", language: "ja" }, { cardId: "c", finish: "jumbo" }]).map(t => t.cardId), ["a"])
})

test("fresh pins make no request; stale ones refresh with bounded concurrency", async () => {
  const pins = new Map<string, CardPriceCheck>([["fresh:soldcomps", check("soldcomps", hours(2))], ["fresh:ebay", check("ebay", hours(2))], ["stale:soldcomps", check("soldcomps", hours(30))]])
  const calls: string[] = []
  let active = 0, peak = 0
  const result = await runCheckComps([{ cardId: "fresh" }, { cardId: "stale" }, { cardId: "new" }], {
    signal: new AbortController().signal, now: () => now,
    readPinned: async (cardId, _finish, source) => pins.get(`${cardId}:${source}`) ?? null,
    request: async (cardId, _language, _finish, source) => {
      calls.push(`${cardId}:${source}`)
      active++; peak = Math.max(peak, active)
      await new Promise(resolve => setTimeout(resolve, 5))
      active--
      return { check: check(source, hours(0)), error: undefined }
    },
  })
  assert.deepEqual(calls.filter(c => c.startsWith("fresh")), [])
  assert.ok(peak <= CHECK_COMPS_CONCURRENCY)
  assert.deepEqual({ done: result.done, fresh: result.fresh, checked: result.checked, failed: result.failed }, { done: 3, fresh: 1, checked: 2, failed: 0 })
})

test("429 backs the batch off and retries; an exhausted allowance stops that source", async () => {
  const sleeps: number[] = []
  let first = true
  const calls: string[] = []
  const result = await runCheckComps([{ cardId: "a" }, { cardId: "b" }, { cardId: "c" }], {
    signal: new AbortController().signal, now: () => now,
    sleep: async ms => { sleeps.push(ms) },
    readPinned: async () => null,
    request: async (cardId, _language, _finish, source) => {
      calls.push(`${cardId}:${source}`)
      if (source === "ebay") return { check: check("ebay", hours(0)), error: undefined }
      if (first) { first = false; throw new PriceCheckRequestError("Too many requests", 429) }
      return { check: null, error: "Sold comps monthly allowance used up." }
    },
  })
  assert.ok(sleeps.length >= 1)
  assert.equal(result.stopped.soldcomps, "Sold comps monthly allowance used up.")
  // After the stop, later cards are not sent to sold comps again.
  assert.ok(calls.filter(c => c.endsWith("soldcomps")).length <= 3)
  assert.equal(result.failed, 3)
})

test("show targets put exact-finish wanted cards first, then other wanted, then hunt", async () => {
  const { showCompsTargets } = await import("../lib/check-comps")
  const order = showCompsTargets([{ cardId: "w-any", finish: "special_illustration_rare" }, { cardId: "w-holo", finish: "holo" }], [{ cardId: "h-1" }, { cardId: "w-holo", finish: "holo" }])
  assert.deepEqual(order.map(t => t.cardId), ["w-holo", "w-any", "h-1"])
})
