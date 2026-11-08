import assert from "node:assert/strict"
import { loadPriceCheckSubject } from "../../lib/server/ebay-listings"
import { loadCardPriceChecks } from "../../lib/server/card-price-checks"
import type { CardPriceCheck } from "../../lib/card-price-checks"
import { matchesPriceCheckTitle } from "../../lib/ebay-listings"

// Real catalog identity and title shapes; synthetic rows, prices and credentials. No network.
async function run() {
  for (const name of ["SUPABASE_SERVICE_ROLE_KEY", "EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET", "SOLDCOMPS_API_KEY"]) process.env[name] = "synthetic"
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://synthetic.supabase.test"
  const id = "30th-c-018"
  const title = "Gengar (Prime) 94/102 Holo 30th Celebration Classic Collection Pokemon NM"
  const rows = new Map<string, unknown>()
  let providerCalls = 0
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    if (url.pathname.endsWith("/rpc/consume_developer_budget")) return Response.json({allowed:true,retry_after:1})
    if (url.pathname.includes("/tcg_cards")) return Response.json([{ id, name_en: "Gengar", local_id: "018", set_id: "30th-c", external_ids_json: {}, tcg_sets: { name_en: "30th Classic Collection", official_card_count: 30 } }])
    if (url.pathname.includes("/rpc/claim_card_price_check")) return Response.json(true)
    if (url.pathname.includes("/card_price_checks")) {
      if (url.searchParams.get("select") === "source,result_json") return Response.json([...rows].map(([source,result_json])=>({source,result_json})))
      const source = url.searchParams.get("source")!.slice(3)
      if (init?.method === "PATCH") { rows.set(source, JSON.parse(String(init.body)).result_json); return new Response(null, { status: 204 }) }
      return Response.json(rows.has(source) ? [{ result_json: rows.get(source) }] : [])
    }
    if (url.pathname.includes("/oauth2/token")) return Response.json({ access_token: "synthetic", expires_in: 7200 })
    assert.equal(url.searchParams.get("q"), "Gengar 94/102 30th Classic Collection")
    providerCalls++
    if (url.pathname.includes("/item_summary/search")) return Response.json({ itemSummaries: [{ itemId: "synthetic-ask", title, price: { value: "12", currency: "GBP" }, itemLocation: { country: "GB" }, buyingOptions: ["FIXED_PRICE"] }] })
    if (url.hostname === "www.soldcomps.io") return Response.json({ items: [{ item_id: "synthetic-sold", title, sold_price: { value: 10, currency: "GBP" }, sold_at: new Date().toISOString().slice(0, 10), best_offer_price_known: true, best_offer_accepted: false, flags: [] }] })
    throw new Error(`Unexpected synthetic request: ${url.pathname}`)
  }) as typeof fetch
  const lookup = await loadPriceCheckSubject(id, "holo")
  assert.ok(lookup)
  assert.equal(lookup.query, "Gengar 94/102 30th Classic Collection")
  assert.equal(lookup.subject.localId, "94")
  assert.equal(lookup.subject.officialCardCount, 102)
  for (const title of ["Gengar 94/102 Holo 30th Classic Collection", "Gengar 94/102 Holo 30th Celebration Classic Collection", "Gengar 94/102 Holo 30th Celebrations Classic Collection", "Gengar 94/102 Holo 30th Anniversary Classic Collection"]) assert.equal(matchesPriceCheckTitle(lookup.subject, title), true, title)
  for (const title of ["Gengar 94/102 Holo Triumphant", "Gengar 94/102 Holo Classic Collection", "Gengar 94/102 Holo 30th Celebration", "Gengar 094/030 Holo 30th Classic Collection", "Gengar 018/030 Holo 30th Classic Collection", "Gengar 194/102 Holo 30th Classic Collection", "Gengar 94/102 Reverse Holo 30th Classic Collection", "Gengar 94/102 Holo 30th Classic Collection Japanese", "PSA 10 Gengar 94/102 Holo 30th Classic Collection"]) assert.equal(matchesPriceCheckTitle(lookup.subject, title), false, title)
  const checks = await loadCardPriceChecks(id, "holo", true)
  assert.deepEqual(checks?.errors, {})
  assert.equal(checks?.ebay?.summary.median, 12)
  assert.equal(checks?.soldcomps?.summary.median, 10)
  for (const source of ["ebay", "soldcomps"] as const) {
    const old: CardPriceCheck = { ...checks![source]!, searchUrl: "https://www.ebay.co.uk/sch/i.html?_nkw=Gengar+018+30th+Classic+Collection" }
    rows.set(source, old)
    const saved = await loadCardPriceChecks(id, "holo", false, source)
    assert.equal(new URL(saved![source]!.searchUrl!).searchParams.get("_nkw"), lookup.query)
    assert.equal(saved![source]!.checkedAt, old.checkedAt, "fixing a link must not fabricate a new check")
  }
  assert.equal(providerCalls, 2, "saved links cost no upstream requests")
}
void run().catch(error => { console.error(error); process.exitCode = 1 })
