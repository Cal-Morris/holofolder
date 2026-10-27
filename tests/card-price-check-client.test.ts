import { test } from "node:test"
import assert from "node:assert/strict"
import { requestCardPriceCheck } from "../lib/card-price-check-client"
// Synthetic source results.
test("manual source request preserves printing identity and validates source kind", async () => {
  const original = globalThis.fetch
  let wrongKind = false
  globalThis.fetch = (async (url: string, options: RequestInit) => {
    const params = new URL(url, "https://example.invalid").searchParams
    assert.equal(params.get("finish"), "any")
    assert.equal(params.get("cardId"), "test-1")
    assert.equal(params.get("source"), "soldcomps")
    assert.equal(options.method, "POST")
    assert.equal(options.cache, "no-store")
    return Response.json({ soldcomps: { summary: { kind: wrongKind ? "asking" : "sold", currency: "GBP", count: 1, low: 10, high: 10, median: 10 }, checkedAt: "2026-10-27T12:00:00Z" }, errors: {} })
  }) as typeof fetch
  try {
    assert.equal((await requestCardPriceCheck("test-1", "en", "special_illustration_rare", "soldcomps", new AbortController().signal)).check?.summary.median, 10)
    wrongKind = true
    await assert.rejects(requestCardPriceCheck("test-1", "en", "special_illustration_rare", "soldcomps", new AbortController().signal), /Invalid price check response/)
  } finally { globalThis.fetch = original }
})
