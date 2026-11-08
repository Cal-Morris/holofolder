import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { binderPrintings, downloadBinderPrep, inspectBinderPrep, binderPrepKey, type BinderPrepScope } from "@/lib/binder-offline-prep"
import { createMemoryStore } from "@/lib/offline-store/kv"
import type { CollectedPokemon } from "@/lib/domain/cards"
import type { CardPriceSnapshot } from "@/lib/card-pricing"
import { readPinnedCardPriceCheck } from "@/lib/card-price-check-cache"

const scope: BinderPrepScope = { ownerUserId: "synthetic-owner", binderId: null, isDefault: true }
// Synthetic cards and evidence, never provider data.
const collection = (count: number): CollectedPokemon[] => Array.from({ length: count }, (_, i) => ({
  id: `slot-${i}`, pokemon_id: i + 1, pokemon_name: `Pokemon ${i}`, status: "collected", collected_at: "2026-01-01",
  card_id: `synthetic-${i}`, card_name: `Synthetic ${i}`, card_image: `https://assets.tcgdex.net/en/base/base1/${i}/high.webp`, card_finish: "normal", wanted_cards: [],
}))
const check = (kind: "asking" | "sold") => ({ summary: { kind, currency: "GBP", count: 1, low: 2, median: 2, high: 2 }, checkedAt: "2026-01-01T00:00:00Z", searchUrl: "https://www.ebay.co.uk/sch/i.html?_nkw=synthetic", ...(kind === "sold" ? { sales: [{ amount: 2, soldAt: "2026-01-01" }] } : { listings: [{ amount: 2 }] }) })
function setup(rows: CollectedPokemon[]) {
  const store = createMemoryStore({ collection: { ...scope, collection: rows, pendingOperations: [{ keep: true }], savedAt: "2026-01-01" } })
  const images = new Map<string, Response>()
  const cache = { match: async (url: string) => images.get(url)?.clone(), put: async (url: string, response: Response) => { images.set(url, response.clone()) } } as unknown as Cache
  const prices = new Map<string, CardPriceSnapshot>()
  const requests: string[] = []
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    assert.notEqual(init?.method, "POST")
    const url = new URL(String(input), "https://synthetic.test")
    requests.push(url.href)
    if ((url.pathname === "/app/api/card-image-proxy" || url.hostname === "assets.holofolder.com")) return new Response("synthetic-image", { headers: { "Content-Type": "image/webp" } })
    if (url.pathname === "/app/api/card-prices") return Response.json({ prices: JSON.parse(url.searchParams.get("cards")!).map((card: { cardId: string; language: string }) => ({ ...card, marketGbpAmount: 2, finishPrices: [{ finish: "normal", variantKey: "normal", marketGbpAmount: 2 }], sourcePrices: [{ source: "cardmarket" }], historyPoints: [{ amount: 2 }], trendPoints: [{ gbpAmount: 2 }] })) })
    return Response.json({ checks: JSON.parse(url.searchParams.get("cards")!).map((card: object) => ({ ...card, ebay: check("asking"), soldcomps: check("sold"), errors: {} })) })
  }) as typeof fetch
  return { shellReady: true, store, cache, images, prices, requests, fetcher, signal: new AbortController().signal, onProgress: () => {},
    loadPrices: async () => [...prices.values()], savePrices: async (values: unknown[]) => { for (const price of values as CardPriceSnapshot[]) prices.set(`${price.cardId}:${price.language}`, price) },
  }
}

describe("binder offline prep", () => {
  test("keeps exact stamped ids, languages and finishes, deduping owned/wanted printings", () => {
    const rows = collection(1)
    rows[0].card_id = "base1-4-stamped"
    rows[0].wanted_cards = [
      { card_id: "base1-4-stamped", card_name: "Synthetic", added_at: "2026-01-01", card_finish: "normal" },
      { card_id: "base1-4-stamped", card_name: "Synthetic", added_at: "2026-01-01", card_finish: "reverse_holo" },
      { card_id: "base1-4-stamped", card_name: "Synthetic", added_at: "2026-01-01", card_language: "ja" },
    ]
    const cards = binderPrintings(rows)
    assert.equal(cards.length, 3)
    assert.ok(cards.every(card => card.cardId === "base1-4-stamped"))
    assert.equal(cards[0].images.length, 2)
  })
  test("downloads more than 60 saved checks with GET and refreshes saved evidence without repeating images", async () => {
    const rows = collection(65)
    const deps = setup(rows)
    const cards = binderPrintings(rows)
    const result = await downloadBinderPrep(cards, scope, deps)
    assert.equal(result.sold, 65)
    assert.equal(result.asking, 65)
    assert.equal(result.complete, true)
    assert.equal(deps.requests.filter(url => url.includes("card-price-checks?")).length, 3)
    assert.equal(deps.requests.filter(url => url.includes("/app/api/card-prices?")).length, 3)
    const imageCalls = deps.requests.filter(url => url.includes("card-image-proxy")).length
    await downloadBinderPrep(cards, scope, { ...deps, fetcher: (async (...args: Parameters<typeof fetch>) => {
      const response = await deps.fetcher(...args)
      if (String(args[0]).includes("/app/api/card-prices?")) {
        const payload = await response.json()
        return Response.json({ prices: payload.prices.map((price: CardPriceSnapshot) => ({ ...price, marketGbpAmount: 4 })) })
      }
      if (String(args[0]).includes("card-price-checks?")) {
        const payload = await response.json()
        for (const saved of payload.checks) saved.soldcomps = { ...check("sold"), checkedAt: "2026-11-06T12:00:00Z", summary: { kind: "sold", currency: "GBP", count: 1, low: 9, median: 9, high: 9 }, sales: [{ amount: 9, soldAt: "2026-11-06" }] }
        return Response.json(payload)
      }
      return response
    }) as typeof fetch })
    assert.equal(deps.requests.filter(url => url.includes("card-image-proxy")).length, imageCalls)
    assert.equal(deps.requests.filter(url => url.includes("card-price-checks?")).length, 6)
    assert.equal(deps.prices.get("synthetic-0:en")?.marketGbpAmount, 4)
    assert.equal((await readPinnedCardPriceCheck("synthetic-0", "normal", "soldcomps", deps.store))?.summary.median, 9)
    assert.equal((await deps.store.get<{ pendingOperations: unknown[] }>("collection"))?.pendingOperations.length, 1)
    assert.equal(result.oldestCheck, "2026-01-01T00:00:00Z")
    assert.ok([...deps.prices.values()].every(price => price.sourcePrices.length && price.historyPoints?.length && price.trendPoints.length))
  })
  test("missing images, quotes and unsupported checks stay partial; actual cache loss invalidates readiness", async () => {
    const rows = collection(3)
    rows[1].card_language = "ja"
    rows[2].card_finish = "jumbo"
    rows[2].card_image = undefined
    const deps = setup(rows)
    const cards = binderPrintings(rows)
    const result = await downloadBinderPrep(cards, scope, deps)
    assert.equal(result.unsupported, 2)
    assert.equal(result.images, 2)
    assert.equal(result.prices, 2)
    assert.equal(result.sold, 1)
    assert.equal(result.complete, false)
    assert.equal(deps.requests.filter(url => url.includes("card-price-checks?")).length, 1)
    deps.images.clear()
    assert.equal((await inspectBinderPrep(cards, scope, deps)).images, 0)
    assert.notEqual(binderPrepKey(scope), binderPrepKey({ ...scope, ownerUserId: "other" }))
    const other = await inspectBinderPrep(cards, { ...scope, binderId: "other", isDefault: false }, deps)
    assert.equal(other.cards, 0)
    assert.equal(other.prices, 0)
    assert.equal(other.sold, 0)
  })
  test("failed image then cancel and retry preserves successes and queue", async () => {
    const rows = collection(4)
    const deps = setup(rows)
    const abort = new AbortController()
    let calls = 0
    const fetcher = (async (...args: Parameters<typeof fetch>) => {
      calls++
      if (calls === 1) return new Response(null, { status: 500 })
      if (calls === 4) abort.abort()
      return deps.fetcher(...args)
    }) as typeof fetch
    await assert.rejects(downloadBinderPrep(binderPrintings(rows), scope, { ...deps, signal: abort.signal, fetcher }))
    const saved = deps.images.size
    assert.ok(saved > 0)
    const result = await downloadBinderPrep(binderPrintings(rows), scope, deps)
    assert.equal(result.complete, true)
    assert.equal(deps.requests.filter(url => url.includes("card-image-proxy") || url.startsWith("https://assets.holofolder.com/cards/")).length, 8)
  })
})

test("large binder preparations have no 500 warm-up or 1500 browsing-cache ceiling", async () => {
  const rows = collection(1601)
  const deps = setup(rows)
  const result = await downloadBinderPrep(binderPrintings(rows), scope, deps)
  assert.equal(result.images, 1601)
  assert.equal(deps.images.size, 3202)
  assert.equal(result.sold, 1601)
  assert.equal(result.complete, true)
})

test("legacy summaries without asking/sold records never count as fully prepared", async () => {
  const rows = collection(1)
  const deps = setup(rows)
  const result = await downloadBinderPrep(binderPrintings(rows), scope, { ...deps, fetcher: (async (...args: Parameters<typeof fetch>) => {
    if (!String(args[0]).includes("card-price-checks?")) return deps.fetcher(...args)
    const asking = check("asking"), sold = check("sold")
    return Response.json({ checks: [{ cardId: "synthetic-0", finish: "normal", ebay: { summary: asking.summary, checkedAt: asking.checkedAt }, soldcomps: { summary: sold.summary, checkedAt: sold.checkedAt }, errors: {} }] })
  }) as typeof fetch })
  assert.equal(result.sold, 0)
  assert.equal(result.asking, 0)
  assert.equal(result.soldRecords, 0)
  assert.equal(result.complete, false)
})

test("transient image and saved-price failures retry within the same preparation", async () => {
  const rows = collection(1), deps = setup(rows)
  const attempts = new Map<string, number>()
  const result = await downloadBinderPrep(binderPrintings(rows), scope, { ...deps, retryDelay: async () => {}, fetcher: (async (...args: Parameters<typeof fetch>) => {
    const url = String(args[0]), count = (attempts.get(url) ?? 0) + 1
    attempts.set(url, count)
    if (count === 1 && (url.includes("card-image-proxy") || url.includes("/app/api/card-prices?"))) return new Response(null, { status: 503 })
    return deps.fetcher(...args)
  }) as typeof fetch })
  assert.equal(result.complete, true)
  assert.equal(result.failedDownloads, 0)
})
