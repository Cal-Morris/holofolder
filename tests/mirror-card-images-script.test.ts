import { afterEach, describe, test } from "node:test"
import assert from "node:assert/strict"
import { BudgetExceededError, createPoliteFetch } from "../scripts/mirror-card-images"

const ENDPOINT = "https://acct.r2.cloudflarestorage.com/"
const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

describe("mirror-card-images polite fetch", () => {
  test("retries transient 503s with backoff and counts Class A operations", async () => {
    let calls = 0
    globalThis.fetch = (async () => {
      calls += 1
      return new Response("", { status: calls === 1 ? 503 : 200 })
    }) as unknown as typeof fetch
    const { politeFetch, stats } = createPoliteFetch({ maxClassA: 10, maxBytes: 1024, endpointPrefix: ENDPOINT })
    const response = await politeFetch(`${ENDPOINT}bucket/cards/en/a/1/high.webp`, { method: "PUT", body: new ArrayBuffer(100) })
    assert.equal(response.status, 200)
    assert.deepEqual(stats, { classA: 2, classB: 0, bytesUploaded: 100, retries: 1 })
  })

  test("refuses to exceed the Class A and storage budgets", async () => {
    globalThis.fetch = (async () => new Response("", { status: 200 })) as unknown as typeof fetch
    const { politeFetch } = createPoliteFetch({ maxClassA: 1, maxBytes: 150, endpointPrefix: ENDPOINT })
    await politeFetch(`${ENDPOINT}bucket?list-type=2&prefix=cards/`)
    await assert.rejects(politeFetch(`${ENDPOINT}bucket?list-type=2&prefix=cards/`), BudgetExceededError)
    const second = createPoliteFetch({ maxClassA: 10, maxBytes: 150, endpointPrefix: ENDPOINT })
    await second.politeFetch(`${ENDPOINT}bucket/a`, { method: "PUT", body: new ArrayBuffer(100) })
    await assert.rejects(second.politeFetch(`${ENDPOINT}bucket/b`, { method: "PUT", body: new ArrayBuffer(100) }), BudgetExceededError)
  })
})
