import { describe, test } from "node:test"
import assert from "node:assert/strict"
import {
  createCardImageMirror,
  getCardImageBlobPathname,
  isCardImageBlobEnabled,
  parseTcgdexCardImageUrl,
  type CardImageBlobDeps,
} from "../lib/card-image-blob"
import {
  InvalidBackfillRequestError,
  mirrorSetImages,
  parseCardImageBackfillRequest,
  planCardImageRefs,
} from "../lib/card-image-backfill"

const BLOB_BASE = "https://store123.public.blob.vercel-storage.com/"

function fakeDeps(options: { existing?: string[]; tcgdexStatus?: number; putDelayMs?: number; putFails?: boolean } = {}) {
  const store = new Map<string, ArrayBuffer>(
    (options.existing ?? []).map((pathname) => [pathname, new Uint8Array([1, 2, 3]).buffer]),
  )
  const calls = { head: 0, put: 0, list: 0, tcgdex: 0, blobGet: 0 }
  const deps: CardImageBlobDeps = {
    async head(pathname) {
      calls.head += 1
      return store.has(pathname) ? { url: `${BLOB_BASE}${pathname}` } : null
    },
    async put(pathname, body) {
      calls.put += 1
      if (options.putDelayMs) await new Promise((resolve) => setTimeout(resolve, options.putDelayMs))
      if (options.putFails) throw new Error("upload failed")
      if (store.has(pathname)) throw new Error("This blob already exists")
      store.set(pathname, body)
      return { url: `${BLOB_BASE}${pathname}` }
    },
    async list(prefix) {
      calls.list += 1
      return [...store.keys()].filter((pathname) => pathname.startsWith(prefix))
    },
    fetch: (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith(BLOB_BASE)) {
        calls.blobGet += 1
        const body = store.get(url.slice(BLOB_BASE.length))
        return body
          ? new Response(body, { headers: { "content-type": "image/webp" } })
          : new Response("missing", { status: 404, headers: { "content-type": "text/plain" } })
      }
      if (url.startsWith("https://assets.tcgdex.net/")) {
        calls.tcgdex += 1
        const status = options.tcgdexStatus ?? 200
        return status === 200
          ? new Response(new Uint8Array([9, 9, 9, 9]), { headers: { "content-type": "image/webp" } })
          : new Response("nope", { status, headers: { "content-type": "text/plain" } })
      }
      throw new Error(`unexpected fetch ${url}`)
    }) as typeof fetch,
  }
  return { deps, store, calls }
}

const ref = parseTcgdexCardImageUrl("https://assets.tcgdex.net/en/me/me05/001/high.webp")!

describe("parseTcgdexCardImageUrl", () => {
  test("parses TCGdex card image URLs into a deterministic Blob path", () => {
    assert.deepEqual(ref, { language: "en", seriesId: "me", setId: "me05", localId: "001", quality: "high", extension: "webp" })
    assert.equal(getCardImageBlobPathname(ref), "cards/en/me05/001/high.webp")
    const special = parseTcgdexCardImageUrl("https://assets.tcgdex.net/en/me/me02.5/TG01/low.png")!
    assert.equal(getCardImageBlobPathname(special), "cards/en/me02.5/TG01/low.png")
  })

  test("only accepts TCGdex card images", () => {
    for (const url of [
      "https://images.scrydex.com/pokemon/me55c-4/large",
      "https://images.pokemontcg.io/base1/4_hires.png",
      "https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/30C/30C_001_R_EN_SM.png",
      "https://product-images.tcgplayer.com/12345.jpg",
      "https://assets.tcgdex.net.evil.com/en/me/me05/001/high.webp",
      "http://assets.tcgdex.net/en/me/me05/001/high.webp",
      "https://assets.tcgdex.net/en/me/me05/001",
      "https://assets.tcgdex.net/en/me/me05/symbol.webp",
      "https://assets.tcgdex.net/en/me/../001/high.webp",
      "https://assets.tcgdex.net/en/me/me05/001/high.webp?x=1",
      "not a url",
    ]) {
      assert.equal(parseTcgdexCardImageUrl(url), null, url)
    }
  })

  test("Blob mirror is enabled only with a token", () => {
    assert.equal(isCardImageBlobEnabled({}), false)
    assert.equal(isCardImageBlobEnabled({ BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_x" }), true)
    assert.equal(isCardImageBlobEnabled({ BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_x", CARD_IMAGE_BLOB: "0" }), false)
  })
})

describe("card image mirror", () => {
  test("serves an existing copy from Blob without touching TCGdex", async () => {
    const { deps, calls } = fakeDeps({ existing: ["cards/en/me05/001/high.webp"] })
    const mirror = createCardImageMirror(deps)
    const image = await mirror.loadImage(ref)
    assert.equal(image.source, "blob")
    assert.equal(image.pendingUpload, undefined)
    assert.equal(calls.tcgdex, 0)
    // Second request reuses the known URL (no extra head call).
    await mirror.loadImage(ref)
    assert.equal(calls.head, 1)
  })

  test("falls back to TCGdex when the copy is missing and uploads it once", async () => {
    const { deps, store, calls } = fakeDeps()
    const mirror = createCardImageMirror(deps)
    const image = await mirror.loadImage(ref)
    assert.equal(image.source, "tcgdex")
    assert.ok(image.pendingUpload)
    await image.pendingUpload!()
    assert.ok(store.has("cards/en/me05/001/high.webp"))
    const again = await mirror.loadImage(ref)
    assert.equal(again.source, "blob")
    assert.equal(calls.tcgdex, 1)
    assert.equal(calls.put, 1)
  })

  test("deduplicates concurrent uploads of the same image", async () => {
    const { deps, calls } = fakeDeps({ putDelayMs: 20 })
    const mirror = createCardImageMirror(deps)
    const results = await Promise.all([mirror.ensureMirrored(ref), mirror.ensureMirrored(ref), mirror.ensureMirrored(ref)])
    assert.equal(calls.put, 1)
    assert.equal(calls.tcgdex, 1)
    assert.equal(results.filter((result) => result.uploaded).length, 1)
    assert.equal(new Set(results.map((result) => result.url)).size, 1)
  })

  test("reuses a blob uploaded by another instance when put reports it already exists", async () => {
    const { deps, store, calls } = fakeDeps()
    const mirror = createCardImageMirror(deps)
    store.set("cards/en/me05/001/high.webp", new Uint8Array([7]).buffer)
    const result = await mirror.ensureMirrored(ref, { assumeMissing: true })
    assert.equal(result.url, `${BLOB_BASE}cards/en/me05/001/high.webp`)
    assert.equal(calls.put, 1)
  })

  test("upload failures never break serving", async () => {
    const { deps } = fakeDeps({ putFails: true })
    const mirror = createCardImageMirror(deps)
    const image = await mirror.loadImage(ref)
    assert.equal(image.source, "tcgdex")
    await image.pendingUpload!() // swallowed
  })

  test("propagates TCGdex 404 when neither copy exists", async () => {
    const { deps } = fakeDeps({ tcgdexStatus: 404 })
    const mirror = createCardImageMirror(deps)
    await assert.rejects(mirror.loadImage(ref), (error: { status?: number }) => error.status === 404)
  })
})

describe("set image backfill", () => {
  const cards = [
    { seriesId: "me", setId: "30th", localId: "001", imageLanguages: [], tcgdexImageUrl: "https://assets.tcgdex.net/en/me/30th/001/high.webp" },
    { seriesId: "me", setId: "30th", localId: "002", imageLanguages: ["en", "fr"] },
    { seriesId: "me", setId: "30th-c", localId: "001", imageLanguages: [] },
  ]

  test("plans only images TCGdex has, using the card image URL when the manifest lacks the set", () => {
    const refs = planCardImageRefs(cards, { languages: ["en"], qualities: ["high", "low"] })
    assert.deepEqual(refs.map(getCardImageBlobPathname), [
      "cards/en/30th/001/high.webp",
      "cards/en/30th/001/low.webp",
      "cards/en/30th/002/high.webp",
      "cards/en/30th/002/low.webp",
    ])
  })

  test("copies only missing images and is idempotent", async () => {
    const { deps, calls } = fakeDeps({ existing: ["cards/en/30th/001/high.webp"] })
    const mirror = createCardImageMirror(deps)
    const first = await mirrorSetImages(mirror, "30th", cards, { languages: ["en"], qualities: ["high", "low"] })
    assert.deepEqual({ ...first }, { setId: "30th", planned: 4, alreadyMirrored: 1, uploaded: 3, failed: 0, complete: true })
    const second = await mirrorSetImages(mirror, "30th", cards, { languages: ["en"], qualities: ["high", "low"] })
    assert.equal(second.uploaded, 0)
    assert.equal(second.alreadyMirrored, 4)
    assert.equal(calls.put, 3)
  })

  test("stops at the upload budget and reports the set as incomplete", async () => {
    const { deps } = fakeDeps()
    const mirror = createCardImageMirror(deps)
    const result = await mirrorSetImages(mirror, "30th", cards, { languages: ["en"], qualities: ["high", "low"], maxUploads: 2, concurrency: 1 })
    assert.equal(result.uploaded, 2)
    assert.equal(result.complete, false)
  })

  test("parses backfill requests", () => {
    assert.deepEqual(parseCardImageBackfillRequest(new URLSearchParams()), {
      setIds: [],
      cursor: null,
      languages: ["en"],
      qualities: ["high", "low"],
      maxSets: 10,
      maxUploads: 1500,
    })
    const request = parseCardImageBackfillRequest(new URLSearchParams("set=30th,me05&lang=en,FR&quality=high&cursor=base1&maxSets=999"))
    assert.deepEqual(request.setIds, ["30th", "me05"])
    assert.deepEqual(request.languages, ["en", "fr"])
    assert.deepEqual(request.qualities, ["high"])
    assert.equal(request.cursor, "base1")
    assert.equal(request.maxSets, 50)
    assert.throws(() => parseCardImageBackfillRequest(new URLSearchParams("quality=huge")), InvalidBackfillRequestError)
    assert.throws(() => parseCardImageBackfillRequest(new URLSearchParams("lang=english")), InvalidBackfillRequestError)
    assert.throws(() => parseCardImageBackfillRequest(new URLSearchParams("cursor=../x")), InvalidBackfillRequestError)
  })
})
