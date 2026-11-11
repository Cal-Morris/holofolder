import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { BlobStoreUnavailableError, createCardImageMirror, parseTcgdexCardImageUrl } from "../lib/card-image-blob"
import { createR2Deps, getR2Config, normalizePublicBaseUrl, parseListObjectsV2, type R2Config } from "../lib/card-image-r2"
import { getCardImageStoreKind } from "../lib/card-image-store"
import { mirrorSetImages } from "../lib/card-image-backfill"

const ACCOUNT = "0123456789abcdef0123456789abcdef"
const ENDPOINT = `https://${ACCOUNT}.r2.cloudflarestorage.com/binderdex-card-images/`
const PUBLIC = "https://img.example.test/"
const R2_ENV = {
  CARD_IMAGE_STORE: "r2",
  R2_ACCOUNT_ID: ACCOUNT,
  R2_ACCESS_KEY_ID: "test-access-key",
  R2_SECRET_ACCESS_KEY: "test-secret-key",
  R2_BUCKET: "binderdex-card-images",
  R2_PUBLIC_BASE_URL: "https://img.example.test",
}
const ref = parseTcgdexCardImageUrl("https://assets.tcgdex.net/en/me/me05/001/high.webp")!

/** In-memory fake of R2's S3 API + public bucket domain + TCGdex. Records every request. */
function fakeR2(options: { refuse?: number; publicStatus?: number; putStatus?: number } = {}) {
  const objects = new Map<string, { body: ArrayBuffer; headers: Headers }>()
  const requests: Array<{ method: string; url: string; headers: Headers }> = []
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init)
    requests.push({ method: request.method, url: request.url, headers: request.headers })
    const url = new URL(request.url)

    if (request.url.startsWith("https://assets.tcgdex.net/")) {
      return new Response(new Uint8Array([7, 7, 7]), { headers: { "content-type": "image/webp" } })
    }
    if (request.url.startsWith(PUBLIC)) {
      if (options.publicStatus) return new Response("nope", { status: options.publicStatus })
      const object = objects.get(decodeURIComponent(url.pathname.slice(1)))
      return object
        ? new Response(object.body, { headers: { "content-type": object.headers.get("content-type") ?? "" } })
        : new Response("not found", { status: 404 })
    }
    assert.ok(request.url.startsWith(ENDPOINT), `unexpected URL ${request.url}`)
    assert.match(request.headers.get("authorization") ?? "", /^AWS4-HMAC-SHA256 Credential=test-access-key\/\d{8}\/auto\/s3\/aws4_request/)
    if (options.refuse) return new Response("<Error/>", { status: options.refuse })

    const key = decodeURIComponent(url.pathname.slice(`/binderdex-card-images/`.length))
    if (request.method === "GET" && url.searchParams.get("list-type") === "2") {
      const prefix = url.searchParams.get("prefix") ?? ""
      const all = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort()
      const start = Number(url.searchParams.get("continuation-token") ?? 0)
      const page = all.slice(start, start + 2)
      const next = start + 2 < all.length ? String(start + 2) : null
      return new Response(
        `<?xml version="1.0"?><ListBucketResult>${page.map((k) => `<Contents><Key>${k.replace(/&/g, "&amp;")}</Key></Contents>`).join("")}<IsTruncated>${Boolean(next)}</IsTruncated>${next ? `<NextContinuationToken>${next}</NextContinuationToken>` : ""}</ListBucketResult>`,
        { headers: { "content-type": "application/xml" } },
      )
    }
    if (request.method === "HEAD") {
      const object = objects.get(key)
      return new Response(null, { status: object ? 200 : 404, headers: object ? [...object.headers].filter(([name]) => name.startsWith("x-amz-meta-")) : [] })
    }
    if (request.method === "PUT") {
      if (options.putStatus) return new Response(`<Error><Code>InternalError</Code></Error>`, { status: options.putStatus })
      if (request.headers.get("if-none-match") === "*" && objects.has(key)) return new Response("", { status: 412 })
      objects.set(key, { body: await request.arrayBuffer(), headers: request.headers })
      return new Response("", { status: 200 })
    }
    if (request.method === "GET") {
      const object = objects.get(key)
      return object ? new Response(object.body, { headers: { "content-type": "image/webp" } }) : new Response("", { status: 404 })
    }
    return new Response("", { status: 405 })
  }) as typeof fetch
  return { objects, requests, fetchImpl }
}

function config(overrides: Partial<R2Config> = {}): R2Config {
  return { ...getR2Config(R2_ENV)!, ...overrides }
}

describe("card image store selection", () => {
  test("CARD_IMAGE_STORE picks the backend; incomplete R2 config falls back to off", () => {
    assert.equal(getCardImageStoreKind(R2_ENV), "r2")
    assert.equal(getCardImageStoreKind({ ...R2_ENV, CARD_IMAGE_BLOB: "0" }), "r2", "CARD_IMAGE_BLOB only gates Blob")
    assert.equal(getCardImageStoreKind({ ...R2_ENV, R2_SECRET_ACCESS_KEY: "" }), "off")
    assert.equal(getCardImageStoreKind({ ...R2_ENV, R2_ACCOUNT_ID: "not-an-account" }), "off")
    assert.equal(getCardImageStoreKind({ ...R2_ENV, CARD_IMAGE_STORE: "off" }), "off")
    assert.equal(getCardImageStoreKind({ CARD_IMAGE_STORE: "blob", BLOB_READ_WRITE_TOKEN: "x" }), "blob")
    assert.equal(getCardImageStoreKind({ CARD_IMAGE_STORE: "blob" }), "off")
  })

  test("Blob requires explicit selection even when its token is inherited", () => {
    assert.equal(getCardImageStoreKind({ BLOB_READ_WRITE_TOKEN: "x" }), "off")
    assert.equal(getCardImageStoreKind({ CARD_IMAGE_STORE: "typo", BLOB_READ_WRITE_TOKEN: "x" }), "off")
    assert.equal(getCardImageStoreKind({ CARD_IMAGE_STORE: "", BLOB_READ_WRITE_TOKEN: "x" }), "off")
    assert.equal(getCardImageStoreKind({ BLOB_READ_WRITE_TOKEN: "x", CARD_IMAGE_BLOB: "0" }), "off")
    assert.equal(getCardImageStoreKind({ CARD_IMAGE_STORE: "blob", BLOB_READ_WRITE_TOKEN: "x", CARD_IMAGE_BLOB: "0" }), "off")
    assert.equal(getCardImageStoreKind({}), "off")
  })

  test("public base URL must be https and is normalised with a trailing slash", () => {
    assert.equal(normalizePublicBaseUrl("https://img.cal.gg"), "https://img.cal.gg/")
    assert.equal(normalizePublicBaseUrl("https://pub-abc.r2.dev/"), "https://pub-abc.r2.dev/")
    assert.equal(normalizePublicBaseUrl("http://img.cal.gg"), null)
    assert.equal(normalizePublicBaseUrl(""), null)
  })
})

describe("R2 backend", () => {
  test("first request serves TCGdex and uploads with immutable caching; next request is served from the public URL", async () => {
    const r2 = fakeR2()
    const mirror = createCardImageMirror(createR2Deps(config(), { fetch: r2.fetchImpl }))

    const first = await mirror.loadImage(ref)
    assert.equal(first.source, "tcgdex")
    await first.pendingUpload?.()
    const stored = r2.objects.get("cards/en/me05/001/high.webp")
    assert.ok(stored)
    assert.equal(stored.headers.get("cache-control"), "public, max-age=31536000, immutable")
    assert.equal(stored.headers.get("content-type"), "image/webp")
    assert.equal(stored.headers.get("x-amz-meta-source"), "tcgdex")
    assert.equal(stored.headers.get("x-amz-meta-source-url"), "https://assets.tcgdex.net/en/me/me05/001/high.webp")
    assert.match(stored.headers.get("x-amz-meta-source-sha256") ?? "", /^[0-9a-f]{64}$/)

    const before = r2.requests.length
    const second = await mirror.loadImage(ref)
    assert.equal(second.source, "blob")
    const reads = r2.requests.slice(before)
    assert.deepEqual(reads.map((r) => `${r.method} ${r.url}`), [`GET ${PUBLIC}cards/en/me05/001/high.webp`])
    assert.equal(reads[0].headers.get("authorization"), null, "public reads are unsigned")
  })

  test("without a public URL, reads are signed GetObject calls", async () => {
    const r2 = fakeR2()
    const mirror = createCardImageMirror(createR2Deps(config({ publicBaseUrl: null }), { fetch: r2.fetchImpl }))
    await (await mirror.loadImage(ref)).pendingUpload?.()
    const image = await mirror.loadImage(ref)
    assert.equal(image.source, "blob")
    assert.equal(r2.requests.at(-1)?.url, `${ENDPOINT}cards/en/me05/001/high.webp`)
  })

  test("a deliberate overwrite replaces the object and HEAD returns its origin tags", async () => {
    const r2 = fakeR2()
    const deps = createR2Deps(config(), { fetch: r2.fetchImpl })
    const metadata = { source: "pokemoncom", "source-url": "https://example.test/a.png", "source-sha256": "ab", "source-etag": "v1" }
    await deps.put("cards/src/pokemoncom/A/A_EN_1.webp", new Uint8Array([1]).buffer, "image/webp", { metadata })
    await assert.rejects(deps.put("cards/src/pokemoncom/A/A_EN_1.webp", new Uint8Array([2]).buffer, "image/webp", { metadata }))
    await deps.put("cards/src/pokemoncom/A/A_EN_1.webp", new Uint8Array([2]).buffer, "image/webp", { metadata: { ...metadata, "source-etag": "v2" }, overwrite: true })
    assert.equal((await deps.head("cards/src/pokemoncom/A/A_EN_1.webp"))?.metadata?.["source-etag"], "v2")
  })

  test("concurrent writers never overwrite: a 412 reuses the existing object", async () => {
    const r2 = fakeR2()
    const deps = createR2Deps(config(), { fetch: r2.fetchImpl })
    await deps.put("cards/en/me05/001/high.webp", new Uint8Array([1]).buffer, "image/webp")
    const mirror = createCardImageMirror(deps)
    const result = await mirror.ensureMirrored(ref, { assumeMissing: true })
    assert.equal(result.url, `${PUBLIC}cards/en/me05/001/high.webp`)
    assert.deepEqual([...new Uint8Array(r2.objects.get("cards/en/me05/001/high.webp")!.body)], [1])
  })

  test("backfill lists with pagination and only uploads what is missing (resumable)", async () => {
    const r2 = fakeR2()
    const deps = createR2Deps(config(), { fetch: r2.fetchImpl })
    for (const id of ["001", "002", "003"]) {
      await deps.put(`cards/en/me05/${id}/high.webp`, new Uint8Array([1]).buffer, "image/webp")
    }
    const cards = ["001", "002", "003", "004", "005"].map((localId) => ({ seriesId: "me", setId: "me05", localId, imageLanguages: ["en"] }))
    const result = await mirrorSetImages(createCardImageMirror(deps), "me05", cards, { languages: ["en"], qualities: ["high"] })
    assert.deepEqual(
      { planned: result.planned, alreadyMirrored: result.alreadyMirrored, uploaded: result.uploaded, complete: result.complete },
      { planned: 5, alreadyMirrored: 3, uploaded: 2, complete: true },
    )
    assert.equal(r2.requests.filter((r) => r.url.includes("list-type=2")).length, 2, "two list pages")
  })

  test("refused credentials trip the cooldown: the proxy serves TCGdex and stops calling R2", async () => {
    const r2 = fakeR2({ refuse: 403, publicStatus: 404 })
    const mirror = createCardImageMirror(createR2Deps(config(), { fetch: r2.fetchImpl }))
    const first = await mirror.loadImage(ref)
    assert.equal(first.source, "tcgdex")
    await first.pendingUpload?.()
    assert.equal(mirror.isBlobBlocked(), true)

    const before = r2.requests.length
    const second = await mirror.loadImage(ref)
    assert.equal(second.source, "tcgdex")
    assert.equal(second.pendingUpload, undefined)
    assert.ok(r2.requests.slice(before).every((r) => r.url.startsWith("https://assets.tcgdex.net/")))
    await assert.rejects(mirror.listSetPathnames("en", "me05"), BlobStoreUnavailableError)
  })

  test("a refused public URL (403) also trips the cooldown", async () => {
    const r2 = fakeR2({ publicStatus: 403 })
    const mirror = createCardImageMirror(createR2Deps(config(), { fetch: r2.fetchImpl }))
    const image = await mirror.loadImage(ref)
    assert.equal(image.source, "tcgdex")
    assert.equal(image.pendingUpload, undefined)
    assert.equal(mirror.isBlobBlocked(), true)
  })

  test("parses ListObjectsV2 XML", () => {
    const page = parseListObjectsV2(
      "<ListBucketResult><Contents><Key>cards/en/a&amp;b/1/high.webp</Key></Contents><IsTruncated>true</IsTruncated><NextContinuationToken>t+1</NextContinuationToken></ListBucketResult>",
    )
    assert.deepEqual(page, { keys: ["cards/en/a&b/1/high.webp"], nextContinuationToken: "t+1" })
    assert.deepEqual(parseListObjectsV2("<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>"), { keys: [], nextContinuationToken: null })
  })

  test("backfill results carry a sample of failure messages including R2's error code", async () => {
    const r2 = fakeR2({ putStatus: 500 })
    const mirror = createCardImageMirror(createR2Deps(config(), { fetch: r2.fetchImpl }))
    const cards = ["001", "002"].map((localId) => ({ seriesId: "me", setId: "me05", localId, imageLanguages: ["en"] }))
    const result = await mirrorSetImages(mirror, "me05", cards, { languages: ["en"], qualities: ["high"] })
    assert.equal(result.failed, 2)
    assert.deepEqual(result.errors, ["R2 PUT failed with 500 InternalError"])
  })

  test("signed PUTs are sent as url + init with the original ArrayBuffer body (keeps Content-Length under Next's fetch)", async () => {
    const seen: Array<{ input: unknown; body: unknown; auth: string | null }> = []
    const deps = createR2Deps(config(), {
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        seen.push({ input, body: init?.body, auth: new Headers(init?.headers).get("authorization") })
        return new Response("", { status: 200 })
      }) as typeof fetch,
    })
    const body = new Uint8Array([1, 2, 3]).buffer
    await deps.put("cards/en/me05/001/high.webp", body, "image/webp")
    assert.equal(typeof seen[0].input, "string")
    assert.equal(seen[0].input, `${ENDPOINT}cards/en/me05/001/high.webp`)
    assert.equal(seen[0].body, body)
    assert.match(seen[0].auth ?? "", /^AWS4-HMAC-SHA256 /)
  })
})

