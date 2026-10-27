import { test } from "node:test"
import assert from "node:assert/strict"
import { summarizeSoldComps } from "../lib/sold-comps"
import type { PriceSubject } from "../lib/price-intelligence"

// Synthetic listings, amounts and sale dates, not market data.
const subject: PriceSubject = { cardId: "base1-44", name: "Bulbasaur", setId: "base1", setName: "Base Set", localId: "44", language: "en", variant: "normal" }
const now = Date.parse("2026-10-27T12:00:00Z")
const sale = (id: string, amount: number, extra = {}) => ({ item_id: id, title: "Bulbasaur 44/102 Base Set", sold_price: { value: amount, currency: "GBP" }, sold_at: "2026-10-25", best_offer_accepted: false, best_offer_price_known: true, flags: [], ...extra })

test("sold comps deduplicate exact known-price singles and retain public listing evidence", () => {
  const result = summarizeSoldComps(subject, [sale("a", 10), sale("b", 12), sale("a", 10)], now)
  assert.deepEqual(result.summary, { kind: "sold", currency: "GBP", count: 2, median: 11, low: 10, high: 12 })
  assert.deepEqual(result.sales, [{ amount: 10, soldAt: "2026-10-25", title: "Bulbasaur 44/102 Base Set" }, { amount: 12, soldAt: "2026-10-25", title: "Bulbasaur 44/102 Base Set" }])
})

test("sold comps reject hidden offers, mismatches, flags, invalid dates and currency", () => {
  const invalid = [
    sale("offer", 20, { best_offer_price_known: false }),
    sale("missing", 20, { best_offer_price_known: undefined }),
    sale("lot", 20, { title: "Bulbasaur 44/102 Base Set x4" }),
    sale("lang", 20, { title: "Bulbasaur 44/102 Base Set GER" }),
    sale("finish", 20, { title: "Bulbasaur 44/102 Base Set Reverse" }),
    sale("number", 20, { title: "Bulbasaur 144/102 Base Set" }),
    sale("flag", 20, { flags: ["outlier"] }),
    sale("currency", 20, { sold_price: { value: 20, currency: "USD" } }),
    sale("future", 20, { sold_at: "2026-10-28" }),
    sale("old", 20, { sold_at: "2026-01-01" }),
    sale("date", 20, { sold_at: "2026-02-30" }), sale("zero", 0),
  ]
  assert.equal(summarizeSoldComps(subject, invalid, now).summary.count, 0)
  assert.equal(summarizeSoldComps(subject, [], now).summary.median, null)
})

test("sold evidence rejects Base Set 2 and conflicting collector-number totals", () => {
  const charizard = { ...subject, cardId: "base1-4", name: "Charizard", localId: "4", variant: "holo" as const }
  assert.equal(summarizeSoldComps(charizard, [sale("wrong-set", 50, { title: "Charizard 4/130 Base Set 2 Holo" })], now).summary.count, 0)
  assert.equal(summarizeSoldComps({ ...subject, officialCardCount: 102 }, [sale("wrong-total", 50, { title: "Bulbasaur 44/130 Base Set" })], now).summary.count, 0)
})

test("original Base Set checks reject explicit reprints even when the collector fraction matches", () => {
  const charizard = { ...subject, cardId: "base1-4", name: "Charizard", localId: "4", variant: "holo" as const, officialCardCount: 102 }
  for (const printing of ["Celebrations Classic Collection", "25th Anniversary", "Legendary Collection", "Evolutions", "Pokemon TCG Classic", "World Championship", "Reprint"]) {
    assert.equal(summarizeSoldComps(charizard, [sale("reprint", 50, { title: `Pokemon ${printing} Charizard 4/102 Base Set Holo` })], now).summary.count, 0, printing)
  }
  assert.equal(summarizeSoldComps(charizard, [sale("original", 50, { title: "Pokemon Charizard 4/102 Base Set Holo" })], now).summary.count, 1)
})

test("sold record evidence retains public listing provenance and strips unsafe/tracking links", () => {
  const result = summarizeSoldComps(subject, [sale("record", 10, { url: "https://www.ebay.co.uk/itm/123456789012?mkcid=1", condition: "Used", seller: { username: "not retained" } }), sale("unsafe", 12, { url: "https://ebay.co.uk.evil.test/itm/123456789012" })], now)
  assert.deepEqual(result.sales[0], { amount: 10, soldAt: "2026-10-25", title: "Bulbasaur 44/102 Base Set", url: "https://www.ebay.co.uk/itm/123456789012", condition: "Used" })
  assert.equal(result.sales[1].url, undefined)
})
