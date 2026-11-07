import { test } from "node:test"
import assert from "node:assert/strict"
import { generateKeyPairSync, sign } from "node:crypto"
import { GET, POST } from "../app/api/ebay/account-deletion/route"

// Synthetic credentials and notification, never real eBay account data.
const endpoint = "https://holofolder.com/api/ebay/account-deletion"
const payload = { metadata: { topic: "MARKETPLACE_ACCOUNT_DELETION", schemaVersion: "1.0", deprecated: false }, notification: { notificationId: "synthetic-notification", eventDate: "2026-10-27T12:00:00Z", publishDate: "2026-10-27T12:00:01Z", publishAttemptCount: 1, data: { userId: "synthetic-user", username: "synthetic", eiasToken: "synthetic" } } }

test("eBay challenge uses the registered endpoint and rejects missing config or challenge", async () => {
  const previous = process.env.EBAY_ACCOUNT_DELETION_VERIFICATION_TOKEN
  try {
    process.env.EBAY_ACCOUNT_DELETION_VERIFICATION_TOKEN = "synthetic_verification_token_12345678"
    const response = await GET(new Request(`${endpoint}?challenge_code=synthetic-challenge`))
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { challengeResponse: "30fdc66daac0d72db121cb9603ee6d51c8899f71b79a7cfa609d619296a222cc" })
    assert.equal(response.headers.get("cache-control"), "no-store")
    assert.equal((await GET(new Request(endpoint))).status, 400)
    for (const token of ["", "too-short", "x".repeat(81), "x".repeat(32) + "!"]) {
      process.env.EBAY_ACCOUNT_DELETION_VERIFICATION_TOKEN = token
      assert.equal((await GET(new Request(`${endpoint}?challenge_code=test`))).status, 503)
    }
  } finally {
    if (previous === undefined) delete process.env.EBAY_ACCOUNT_DELETION_VERIFICATION_TOKEN
    else process.env.EBAY_ACCOUNT_DELETION_VERIFICATION_TOKEN = previous
  }
})

test("eBay notifications require a valid signature, cache keys and acknowledge without storing account data", async () => {
  const previousFetch = globalThis.fetch
  const previousId = process.env.EBAY_CLIENT_ID
  const previousSecret = process.env.EBAY_CLIENT_SECRET
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
  let requests = 0
  let tokenRequests = 0
  let unavailable = false
  globalThis.fetch = (async (input, init) => {
    requests++
    if (unavailable) return new Response(null, { status: 503 })
    if (String(input) === "https://api.ebay.com/identity/v1/oauth2/token") {
      tokenRequests++
      assert.equal(init?.method, "POST")
      assert.equal(new Headers(init?.headers).get("authorization"), `Basic ${Buffer.from("synthetic-id:synthetic-secret").toString("base64")}`)
      assert.equal(new URLSearchParams(String(init?.body)).get("scope"), "https://api.ebay.com/oauth/api_scope")
      return Response.json({ access_token: "synthetic-access-token", expires_in: 7200, token_type: "Application Access Token" })
    }
    assert.ok(["synthetic-key", "synthetic-sha1-key", "synthetic-new-key"].some(id => String(input) === `https://api.ebay.com/commerce/notification/v1/public_key/${id}`))
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer synthetic-access-token")
    return Response.json({ key: publicKey.export({ type: "spki", format: "pem" }), algorithm: "ECDSA", digest: String(input).endsWith("sha1-key") ? "SHA1" : "SHA256" })
  }) as typeof fetch
  const signature = sign("sha256", Buffer.from(JSON.stringify(payload)), privateKey).toString("base64")
  const header = Buffer.from(JSON.stringify({ alg: "ecdsa", kid: "synthetic-key", signature, digest: "SHA256" })).toString("base64")
  const request = (body: string, signatureHeader = header) => new Request(endpoint, { method: "POST", body, headers: { "x-ebay-signature": signatureHeader, "content-type": "application/json" } })
  try {
    delete process.env.EBAY_CLIENT_ID
    delete process.env.EBAY_CLIENT_SECRET
    assert.equal((await POST(request(JSON.stringify(payload)))).status, 503)
    process.env.EBAY_CLIENT_ID = "synthetic-id"
    process.env.EBAY_CLIENT_SECRET = "synthetic-secret"
    assert.equal((await POST(request(JSON.stringify(payload), ""))).status, 412)
    assert.equal((await POST(request(JSON.stringify(payload), "not-json"))).status, 412)
    assert.equal((await POST(request("{"))).status, 400)
    const concurrent = await Promise.all([POST(request(JSON.stringify(payload, null, 2))), POST(request(JSON.stringify(payload)))])
    assert.deepEqual(concurrent.map(response => response.status), [204, 204])
    assert.equal(requests, 2, "repeat delivery reuses the one-hour public-key cache")
    assert.equal((await POST(request(JSON.stringify({ ...payload, notification: { ...payload.notification, data: { userId: "tampered" } } })))).status, 412)
    assert.equal((await POST(request(JSON.stringify({ metadata: { topic: "OTHER" } })))).status, 400)
    assert.equal((await POST(request("x".repeat(65537)))).status, 413)
    const sha1Header = Buffer.from(JSON.stringify({ alg: "ecdsa", kid: "synthetic-sha1-key", signature: sign("sha1", Buffer.from(JSON.stringify(payload)), privateKey).toString("base64"), digest: "SHA1" })).toString("base64")
    assert.equal((await POST(request(JSON.stringify(payload), sha1Header))).status, 204)
    assert.equal(tokenRequests, 1, "different signing keys reuse the application token")
    const invalidAlgorithm = Buffer.from(JSON.stringify({ alg: "rsa", kid: "synthetic-key", signature, digest: "SHA256" })).toString("base64")
    assert.equal((await POST(request(JSON.stringify(payload), invalidAlgorithm))).status, 412)
    unavailable = true
    const uncachedKey = Buffer.from(JSON.stringify({ alg: "ecdsa", kid: "uncached-key", signature, digest: "SHA256" })).toString("base64")
    assert.equal((await POST(request(JSON.stringify(payload), uncachedKey))).status, 503)
    const requestsAfterFailure = requests
    await Promise.all(Array.from({ length: 3 }, () => POST(request(JSON.stringify(payload), uncachedKey))))
    assert.equal(requests, requestsAfterFailure, "failed key lookups are cached too")
    assert.equal((await POST(request(JSON.stringify(payload)))).status, 204)
    for (let i = 0; i < 20; i++) {
      const bogusKey = Buffer.from(JSON.stringify({ alg: "ecdsa", kid: `bogus-${i}`, signature, digest: "SHA256" })).toString("base64")
      assert.equal((await POST(request(JSON.stringify(payload), bogusKey))).status, 503)
    }
    assert.equal(tokenRequests, 1)
    assert.equal((await POST(request(JSON.stringify(payload)))).status, 204)
    unavailable = false
    const newKey = Buffer.from(JSON.stringify({ alg: "ecdsa", kid: "synthetic-new-key", signature, digest: "SHA256" })).toString("base64")
    assert.equal((await POST(request(JSON.stringify(payload), newKey))).status, 204, "bogus keys cannot block a previously unseen legitimate key")
    const previousNow = Date.now
    try {
      Date.now = () => previousNow() + 7200 * 1000
      unavailable = false
      const refreshed = await Promise.all([POST(request(JSON.stringify(payload))), POST(request(JSON.stringify(payload)))])
      assert.deepEqual(refreshed.map(response => response.status), [204, 204])
      assert.equal(tokenRequests, 2, "expired tokens refresh once for concurrent deliveries")
    } finally {
      Date.now = previousNow
    }
  } finally {
    globalThis.fetch = previousFetch
    if (previousId === undefined) delete process.env.EBAY_CLIENT_ID
    else process.env.EBAY_CLIENT_ID = previousId
    if (previousSecret === undefined) delete process.env.EBAY_CLIENT_SECRET
    else process.env.EBAY_CLIENT_SECRET = previousSecret
  }
})
