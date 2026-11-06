import assert from "node:assert/strict"
import { loadPriceCheckSubject } from "../../lib/server/ebay-listings"
import { loadCardPriceChecks } from "../../lib/server/card-price-checks"
import { summarizeSoldComps } from "../../lib/sold-comps"
import { matchesPriceCheckTitle } from "../../lib/ebay-listings"

async function run() {
  // Real catalog identity; synthetic catalog rows, prices and provider responses. No network access.
  const id = "mep-070~685563"
  let unsupported = false
  let regular = false
  let stamp = "pokemon-center"
  let label = "Pokémon Center"
  let productId = "685563"
  let saved: unknown
  let calls = 0
  for (const name of ["SUPABASE_SERVICE_ROLE_KEY", "EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET", "SOLDCOMPS_API_KEY"]) process.env[name] = "synthetic"
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://synthetic.supabase.test"
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    if (url.pathname.includes("/tcg_cards")) {
      assert.equal(url.searchParams.get("id"), `eq.${regular ? "mep-070" : id}`)
      return Response.json([{ id: regular ? "mep-070" : id, name_en: regular ? "Tyrunt" : `Tyrunt (${label})`, local_id: regular ? "070" : "070~685563", set_id: "mep",
        external_ids_json: regular ? {} : { catalog: { localId: "070", tcgdexCardId: "mep-070", variantId: "synthetic-variant", productId, printingLabel: unsupported ? "Unknown stamp" : label } },
        raw_json: { supplementalSources: { tcgdexVariant: { variantId: "synthetic-variant", stamp: [unsupported ? "unknown" : stamp], thirdParty: { tcgplayer: 685563 } } } },
        tcg_sets: { name_en: "Mega Evolution Promos" } }])
    }
    if (url.pathname.includes("/rpc/claim_card_price_check")) {
      assert.equal(JSON.parse(String(init?.body)).p_card_id, id)
      return Response.json(true)
    }
    if (url.pathname.includes("/card_price_checks")) {
      assert.equal(url.searchParams.get("card_id"), `eq.${id}`)
      assert.equal(url.searchParams.get("finish"), "eq.holo")
      if (init?.method === "PATCH") { saved = JSON.parse(String(init.body)).result_json; return new Response(null, { status: 204 }) }
      return Response.json(saved ? [{ result_json: saved }] : [])
    }
    if (url.pathname.includes("/oauth2/token")) return Response.json({ access_token: "synthetic", expires_in: 7200 })
    if (url.pathname.includes("/item_summary/search")) {
      calls++
      assert.match(url.searchParams.get("q")!, /Pokémon Center/)
      return Response.json({ itemSummaries: ["Tyrunt 070 Pokémon Center MEP Holo", "Tyrunt 070 MEP Holo"].map((title, i) => ({ itemId: `synthetic-${i}`, title, price: { value: i ? "1" : "12", currency: "GBP" }, itemLocation: { country: "GB" }, buyingOptions: ["FIXED_PRICE"] })) })
    }
    throw new Error(`Unexpected request ${url.pathname}`)
  }) as typeof fetch

  // Bun module mocks are confined to this subprocess; the application uses node:test.
  // @ts-expect-error Bun test types are not part of the application's TypeScript environment.
  const { mock } = await import("bun:test")
  mock.module("next/cache", () => ({ cacheLife: () => {} }))
  mock.module("../../lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "synthetic" } } }) } }) }))
  mock.module("../../lib/supabase/session-user", () => ({ getSessionUser: async () => ({ id: "synthetic" }) }))
  const routes = await import("../../app/api/card-price-checks/route")
  const legacy = await import("../../app/api/ebay/listings/route")
  const request = (cardId: string, finish = "holo") => new Request(`https://synthetic.test/api/card-price-checks?${new URLSearchParams({ cardId, finish })}`)
  assert.equal((await routes.GET(request(id))).status, 200)
  for (const handler of [routes.GET, routes.POST, legacy.GET]) {
    for (const bad of ["", "../card", "a/b", "a?b", "a~", "a~~123", "a:123", "a~123~456", "x".repeat(101)]) assert.equal((await handler(request(bad))).status, 400, bad)
    assert.equal((await handler(request(id, "invalid"))).status, 400)
  }
  const lookup = await loadPriceCheckSubject(id, "holo")
  assert.ok(lookup, "supported catalog printing must load")
  assert.equal(lookup.subject.cardId, id)
  assert.equal(lookup.subject.localId, "070")
  assert.equal(matchesPriceCheckTitle(lookup.subject, "Tyrunt 070 Pokémon Center MEP Holo"), true)
  for (const title of ["Tyrunt 070 MEP Holo", "Tyrunt 070 GameStop MEP Holo", "Tyrunt 070 Pokemon Center Staff MEP Holo", "Tyrunt 070 Pokemon Center MEP Holo lot", "Tyrunt 070 Pokemon Center MEP Holo PSA 10", "Tyrunt 070 Pokemon Center MEP Reverse Holo", "Tyrunt 071 Pokemon Center MEP Holo", "Tyrunt 070 Pokemon Center Holo", "Tyrunt 070 non Pokemon Center MEP Holo"]) {
    assert.equal(matchesPriceCheckTitle(lookup.subject, title), false, title)
  }
  const sold = summarizeSoldComps(lookup.subject, ["Tyrunt 070 Pokemon Center MEP Holo", "Tyrunt 070 MEP Holo"].map((title, i) => ({ item_id: `synthetic-${i}`, title, sold_price: { value: i ? 1 : 12, currency: "GBP" }, sold_at: "2026-11-01", best_offer_price_known: true, best_offer_accepted: false, flags: [] })), Date.parse("2026-11-06"))
  assert.equal(sold.summary.count, 1)
  assert.equal(sold.summary.median, 12)
  const response = await routes.POST(new Request(`${request(id).url}&source=ebay`, { method: "POST" }))
  assert.equal(response.status, 200)
  const checked = await response.json()
  assert.equal(checked?.ebay?.summary.median, 12)
  assert.equal(checked?.ebay?.summary.count, 1)
  assert.deepEqual((await loadCardPriceChecks(id, "holo", true, "ebay"))?.ebay, checked?.ebay)
  assert.equal(calls, 1)
  assert.equal((await legacy.GET(request(id))).status, 200)
  unsupported = true
  assert.equal((await routes.GET(request(id))).status, 422)
  assert.equal((await legacy.GET(request(id))).status, 422)
  assert.equal(await loadCardPriceChecks(id, "holo", true), null)
  assert.equal(calls, 2)
  unsupported = false
  productId = "123"
  assert.equal(await loadPriceCheckSubject(id, "holo"), null, "conflicting product provenance is unsupported")
  productId = "685563"
  for (const [knownStamp, knownLabel] of [["staff", "Staff"], ["pre-release", "Prerelease"]]) {
    stamp = knownStamp
    label = knownLabel
    const known = await loadPriceCheckSubject(id, "holo")
    assert.ok(known)
    assert.equal(matchesPriceCheckTitle(known.subject, `Tyrunt 070 ${knownLabel} MEP Holo`), true)
    assert.equal(matchesPriceCheckTitle(known.subject, "Tyrunt 070 MEP Holo"), false)
  }
  regular = true
  const base = await loadPriceCheckSubject("mep-070", "holo")
  assert.ok(base)
  assert.equal(matchesPriceCheckTitle(base.subject, "Tyrunt 070 MEP Holo"), true)
  assert.equal(matchesPriceCheckTitle(base.subject, "Tyrunt 070 Pokemon Center MEP Holo"), false)
}
void run().catch(error => { console.error(error); process.exitCode = 1 })
