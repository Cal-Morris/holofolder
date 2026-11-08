import assert from "node:assert/strict"
import { checkComparisonTarget, estimateComparisonSpend } from "../../lib/server/comparison-jobs"
import { loadCardPriceChecks } from "../../lib/server/card-price-checks"

// Synthetic isolated provider calls, never real market data or credentials.
async function run() {
  const originalFetch = globalThis.fetch
  const names = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET", "SOLDCOMPS_API_KEY"] as const
  const originalEnv = names.map(name => process.env[name])
  for (const name of names) process.env[name] = name === "NEXT_PUBLIC_SUPABASE_URL" ? "https://synthetic.supabase.test" : "synthetic-key"
  const rows = new Map<string, unknown>()
  let browseCalls = 0, soldCalls = 0, failSold = false, claim = true
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const json = (data: unknown) => Response.json(data)
    if (url.pathname.includes("/tcg_cards")) return json([{ id: "base1-44", name_en: "Bulbasaur", local_id: "44", set_id: "base1", external_ids_json: {}, tcg_sets: { name_en: "Base Set" } }])
    if (url.pathname.includes("/rpc/claim_card_price_check")) return json(claim)
    if (url.pathname.includes("/card_price_checks")) {
      const source = url.searchParams.get("source")?.slice(3) ?? ""
      if (init?.method === "PATCH") { rows.set(source, JSON.parse(String(init.body)).result_json); return new Response(null, { status: 204 }) }
      if (url.searchParams.get("select") !== "result_json") return json([...rows].map(([source, value]) => ({ card_id: "base1-44", finish: "normal", source, result_json: value, checked_at: (value as { checkedAt: string }).checkedAt })))
      return json(rows.has(source) ? [{ result_json: rows.get(source) }] : [])
    }
    if (url.pathname.includes("/oauth2/token")) return json({ access_token: "synthetic-token", expires_in: 7200 })
    if (url.pathname.includes("/item_summary/search")) {
      browseCalls++
      return json({ itemSummaries: [{ itemId: "synthetic-a", title: "Bulbasaur 44/102 Base Set", itemWebUrl: "https://www.ebay.co.uk/itm/123456789012?mkcid=1", condition: "Used", price: { value: "12", currency: "GBP" }, itemLocation: { country: "GB" }, buyingOptions: ["FIXED_PRICE"] }] })
    }
    if (url.hostname === "www.soldcomps.io") {
      soldCalls++
      assert.equal(url.searchParams.get("site"), "EBAY_GB")
      if (failSold) return new Response(null, { status: 402 })
      return json({ items: [{ item_id: "synthetic-s", title: "Bulbasaur 44/102 Base Set", url: "https://www.ebay.co.uk/itm/123456789013?mkcid=1", condition: "Used", sold_price: { value: 9, currency: "GBP" }, sold_at: new Date().toISOString().slice(0, 10), best_offer_price_known: true, best_offer_accepted: false, flags: [] }] })
    }
    throw new Error(`Unexpected synthetic request to ${url.pathname}`)
  }) as typeof fetch
  try {
    assert.deepEqual(await loadCardPriceChecks("base1-44", "normal", false), { ebay: null, soldcomps: null, errors: {} })
    const onlyEbay = await loadCardPriceChecks("base1-44", "normal", true, "ebay")
    assert.equal(onlyEbay?.ebay?.summary.median, 12)
    assert.equal(onlyEbay?.soldcomps, null)
    assert.equal(onlyEbay?.ebay?.listings?.[0].url, "https://www.ebay.co.uk/itm/123456789012")
    assert.deepEqual(rows.get("ebay"), onlyEbay?.ebay)
    assert.equal(soldCalls, 0, "an eBay-only check cannot start a sold lookup")
    const first = await loadCardPriceChecks("base1-44", "normal", true)
    assert.equal(first?.ebay?.summary.median, 12)
    assert.equal(first?.soldcomps?.summary.median, 9)
    assert.equal(rows.size, 2)
    assert.equal(first?.soldcomps?.sales?.[0].url, "https://www.ebay.co.uk/itm/123456789013")
    assert.deepEqual((await loadCardPriceChecks("base1-44", "normal", false))?.soldcomps, first?.soldcomps)
    await loadCardPriceChecks("base1-44", "normal", true)
    await loadCardPriceChecks("base1-44", "normal", true, "soldcomps", true)
    assert.deepEqual([browseCalls, soldCalls], [1, 1], "manual refresh still respects the cooldown")
    const stale = { summary: { kind: "sold", currency: "GBP", count: 1, median: 9, low: 9, high: 9 }, checkedAt: new Date(Date.now() - 365 * 24 * 3600_000).toISOString() }
    rows.set("soldcomps", stale)
    const reused = await loadCardPriceChecks("base1-44", "normal", true)
    assert.equal(reused?.soldcomps?.checkedAt, stale.checkedAt)
    assert.deepEqual([browseCalls, soldCalls], [1, 1], "old saved checks never spend credits without explicit refresh")
    const refreshed = await loadCardPriceChecks("base1-44", "normal", true, "soldcomps", true)
    assert.notEqual(refreshed?.soldcomps?.checkedAt, stale.checkedAt)
    assert.equal(soldCalls, 2, "explicit refresh requests a new check")
    rows.set("soldcomps", stale)
    failSold = true
    const partial = await loadCardPriceChecks("base1-44", "normal", true, "soldcomps", true)
    assert.equal(partial?.soldcomps?.checkedAt, stale.checkedAt)
    assert.match(partial!.errors.soldcomps!, /allowance/)
    assert.deepEqual(rows.get("soldcomps"), stale)
    claim = false
    await loadCardPriceChecks("base1-44", "normal", true)
    assert.equal(soldCalls, 3)
    rows.set("ebay", { ...stale, summary: { ...stale.summary, kind: "asking" } })
    const target = { cardId: "base1-44", finish: "normal" as const, language: "en" as const }
    assert.equal(await estimateComparisonSpend([target]), 0, "old shared checks do not count towards credit estimates")
    assert.equal((await checkComparisonTarget(target, {})).result, "fresh", "background jobs reuse old shared checks")
    assert.deepEqual([browseCalls, soldCalls], [1, 3])
    const empty = { ...stale, summary: { ...stale.summary, count: 0, low: null, median: null, high: null } }
    rows.set("soldcomps", empty)
    assert.equal((await loadCardPriceChecks("base1-44", "normal", true))?.soldcomps?.summary.count, 0)
    assert.equal(soldCalls, 3, "an old empty search also remains saved")
  } finally {
    globalThis.fetch = originalFetch
    names.forEach((name, i) => { if (originalEnv[i] === undefined) delete process.env[name]; else process.env[name] = originalEnv[i] })
  }
}

void run().catch(error => { console.error(error); process.exitCode = 1 })
