import { test } from "node:test"
import assert from "node:assert/strict"
import { readSavedInventoryPrices } from "@/hooks/use-inventory-prices"
import { inventoryProjectionPrices } from "./fixtures/inventory-browse"

test("saved inventory reader fetches distinct identities once, GET only, batches <=25", async () => {
  const calls: RequestInit[] = []
  const sizes: number[] = []
  const requests = Array.from({ length: 51 }, (_, i) => ({ cardId: `synthetic-${i}`, language: "en" as const }))
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input), "https://synthetic.invalid")
    assert.equal(url.pathname, "/app/api/card-prices")
    assert.equal(init?.method, undefined)
    assert.equal(init?.cache, "no-store")
    const cards = JSON.parse(url.searchParams.get("cards")!)
    sizes.push(cards.length); calls.push(init!)
    return Response.json({ prices: cards.map((card: object) => ({ ...inventoryProjectionPrices()[0], ...card })) })
  }
  const result = await readSavedInventoryPrices([...requests, ...requests], new AbortController().signal, fetcher)
  assert.equal(result.length, 51)
  assert.deepEqual(sizes, [25, 25, 1])
  assert.equal(calls.length, 3)
})

test("failed, malformed, duplicate and unrelated saved quotes fail closed", async () => {
  const requests = [{ cardId: "synthetic-snorlax", language: "en" as const }]
  for (const response of [new Response("", { status: 503 }), Response.json({}),
    Response.json({ prices: [{ ...inventoryProjectionPrices()[0], cardId: "foreign" }] }),
    Response.json({ prices: [{ ...inventoryProjectionPrices()[0], language: null }] }),
    Response.json({ prices: [inventoryProjectionPrices()[0], inventoryProjectionPrices()[0]] })]) {
    await assert.rejects(readSavedInventoryPrices(requests, new AbortController().signal, async () => response))
  }
  assert.deepEqual(await readSavedInventoryPrices(requests, new AbortController().signal, async () => Response.json({ prices: [] })), [])
})

test("saved native finish evidence never defaults a missing nested identity to English", async () => {
  const root = inventoryProjectionPrices()[0]
  const finish = { ...root, finish: "normal", variantKey: "normal", gbpAmount: 100 }
  const requests = [{ cardId: root.cardId, language: root.language }]
  const prices = await readSavedInventoryPrices(requests, new AbortController().signal, async () => Response.json({ prices: [{ ...root, finishPrices: [finish, { ...finish, language: undefined }, { ...finish, cardId: "other" }] }] }))
  assert.equal(prices[0].finishPrices?.length, 1)
  assert.equal(prices[0].finishPrices?.[0].cardId, root.cardId)
})
