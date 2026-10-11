import test from "node:test"
import assert from "node:assert/strict"
import type { CollectedPokemon } from "../lib/domain/cards"
import {
  buildOfflineCardIndex,
  collectionToSearchCards,
  extractCardsFromCachedResponse,
  extractSetsFromCachedResponse,
  mergeSearchCards,
  searchOfflineCards,
  searchOfflineSets,
} from "../lib/offline-card-index"
import {
  ESTIMATE_SAMPLE_SIZE,
  FALLBACK_THUMBNAIL_BYTES,
  downloadCardShowImages,
  estimateCardShowBytes,
  formatBytes,
  getProxiedThumbnailUrl,
  getSetSlotsUrl,
  getSetThumbnailUrls,
  planCardShowPrep,
} from "../lib/card-show-prep"

const BASE = { id: "base1", name: "Base Set", officialCardCount: 102 }
const card = (id: string, name: string, localId: string, set = BASE) => ({
  id,
  localId,
  name,
  image: `https://assets.tcgdex.net/en/base/${set.id}/${localId}/high.webp`,
  set,
  rarity: "Common",
  language: "en" as const,
  inferredFinish: "normal" as const,
})
const setSlots = {
  sets: [BASE],
  selectedSet: BASE,
  slots: [
    { dexId: 1, pokemonName: "Bulbasaur", cards: [card("base1-44", "Bulbasaur", "44")] },
    { dexId: 4, pokemonName: "Charmander", cards: [card("base1-46", "Charmander", "46")] },
  ],
}

const charmander: CollectedPokemon = {
  id: "row-4",
  pokemon_id: 4,
  pokemon_name: "charmander",
  card_id: "sv03.5-168",
  card_name: "Charmander",
  card_set: "151",
  card_language: "en",
  card_finish: "holo",
  wanted_cards: [{ card_id: "swsh12pt5-001", card_name: "Charmander", card_set: "Crown Zenith", local_id: "001", added_at: "2026-10-01" }],
  status: "collected",
  collected_at: "2026-10-01",
}

test("cached set coverage, per-Pokémon lists and earlier searches all become searchable cards", () => {
  const fromSet = extractCardsFromCachedResponse("http://x/api/tcg-set-slots?query=Base+Set&setId=base1", setSlots)
  assert.deepEqual(fromSet.map((entry) => [entry.id, entry.dexIds]), [["base1-44", [1]], ["base1-46", [4]]])

  const fromPokemon = extractCardsFromCachedResponse("/api/tcgdex-cache?pokemonId=6&language=en", { cards: [card("sv03.5-006", "Charizard ex", "006", { id: "sv03.5", name: "151", officialCardCount: 165 })] })
  assert.deepEqual(fromPokemon[0].dexIds, [6])

  const fromSearch = extractCardsFromCachedResponse("/api/tcg-card-search?q=pika", { cards: [{ ...card("base1-58", "Pikachu", "58"), dexIds: [25] }, { ...card("x-1", "No dex", "1"), dexIds: [] }] })
  assert.deepEqual(fromSearch.map((entry) => entry.id), ["base1-58"])

  assert.deepEqual(extractCardsFromCachedResponse("/api/tcgdex-cache?pokemonId=0", { cards: [card("a-1", "A", "1")] }), [])
  assert.deepEqual(extractCardsFromCachedResponse("/api/other", setSlots), [])
  assert.deepEqual(extractSetsFromCachedResponse("/api/tcg-set-slots?recent=1", setSlots).map((set) => set.id), ["base1", "base1"])
})

test("the user's owned and wanted printings are searchable with set ids and numbers", () => {
  const cards = collectionToSearchCards([charmander])
  assert.deepEqual(cards.map((entry) => [entry.id, entry.set.id, entry.localId, entry.set.name]), [
    ["sv03.5-168", "sv03.5", "168", "151"],
    ["swsh12pt5-001", "swsh12pt5", "001", "Crown Zenith"],
  ])
  assert.deepEqual(collectionToSearchCards([{ ...charmander, status: "wishlisted", wanted_cards: [] }]), [])
})

test("offline search follows the server's rules: name, set name, set id, number, card id", () => {
  const index = mergeSearchCards([
    collectionToSearchCards([charmander]),
    extractCardsFromCachedResponse("/api/tcg-set-slots?setId=base1", setSlots),
  ])
  const ids = (query: string) => searchOfflineCards(index, query).map((entry) => entry.id)
  assert.deepEqual(ids("charm"), ["sv03.5-168", "swsh12pt5-001", "base1-46"])
  assert.deepEqual(ids("charmander 46/102"), ["base1-46"])
  assert.deepEqual(ids("charmander 168"), ["sv03.5-168"])
  assert.deepEqual(ids("base set"), ["base1-44", "base1-46"])
  assert.deepEqual(ids("base1"), ["base1-44", "base1-46"])
  assert.deepEqual(ids("base1-44"), ["base1-44"])
  assert.deepEqual(ids("crown zenith"), ["swsh12pt5-001"])
  assert.deepEqual(ids("mewtwo"), [])
})

test("duplicates across sources are merged and keep every Pokémon", () => {
  const merged = mergeSearchCards([[{ ...card("a-1", "Nidoran", "1"), dexIds: [29] }], [{ ...card("a-1", "Nidoran", "1"), dexIds: [32] }]])
  assert.equal(merged.length, 1)
  assert.deepEqual(merged[0].dexIds, [29, 32])
})

test("saved sets can be found offline by name or id", () => {
  const sets = [BASE, { id: "sv03.5", name: "151" }, BASE]
  assert.deepEqual(searchOfflineSets(sets, "base").map((set) => set.id), ["base1"])
  assert.deepEqual(searchOfflineSets(sets, "sv03"), [{ id: "sv03.5", name: "151" }])
  assert.deepEqual(searchOfflineSets(sets, "b"), [])
})

test("the index reads JSON card data from the service worker's data caches only", async () => {
  const responses = new Map<string, unknown>([
    ["http://x/api/tcg-set-slots?setId=base1", setSlots],
    ["http://x/api/card-prices", { prices: [] }],
  ])
  const fakeCaches = {
    keys: async () => ["binderdex-v3-data", "binderdex-v3-images"],
    open: async (name: string) => ({
      keys: async () => (name.endsWith("-data") ? [...responses.keys()].map((url) => ({ url })) : [{ url: "http://x/api/tcg-set-slots?setId=evil" }]),
      match: async (request: { url: string }) => new Response(JSON.stringify(responses.get(request.url))),
    }),
  } as unknown as CacheStorage
  const index = await buildOfflineCardIndex([charmander], fakeCaches)
  assert.deepEqual(index.map((entry) => entry.id).sort(), ["base1-44", "base1-46", "sv03.5-168", "swsh12pt5-001"])
})

test("card show prep uses the Sets view's exact URLs and proxied low-res thumbnails", () => {
  assert.equal(getSetSlotsUrl(BASE), "/api/tcg-set-slots?query=Base+Set&setId=base1")
  assert.equal(
    getProxiedThumbnailUrl("https://assets.tcgdex.net/en/base/base1/44/high.webp"),
    `/api/card-image-proxy?url=${encodeURIComponent("https://assets.tcgdex.net/en/base/base1/44/low.webp")}`,
  )
  assert.equal(getProxiedThumbnailUrl("/api/card-image-proxy?url=x"), "/api/card-image-proxy?url=x")
  assert.equal(getProxiedThumbnailUrl("javascript:alert(1)"), null)
  assert.equal(getProxiedThumbnailUrl(undefined), null)
  assert.equal(getSetThumbnailUrls(setSlots).length, 2)
})

test("the size estimate uses measured samples, or a fallback per image", () => {
  assert.equal(estimateCardShowBytes(10, 1000, []), 1000 + 10 * FALLBACK_THUMBNAIL_BYTES)
  assert.equal(estimateCardShowBytes(10, 0, [10_000, 20_000]), 150_000)
  assert.equal(formatBytes(512), "1 KB")
  assert.equal(formatBytes(3.5 * 1024 * 1024), "3.5 MB")
  assert.equal(formatBytes(42 * 1024 * 1024), "42 MB")
})

test("planning downloads only set data and a few samples; downloading fetches the rest once", async () => {
  const many = { ...setSlots, slots: Array.from({ length: 10 }, (_, index) => ({ dexId: index + 1, pokemonName: `P${index}`, cards: [card(`base1-${index}`, `P${index}`, String(index))] })) }
  const requested: string[] = []
  const fetcher = async (url: string) => {
    requested.push(url)
    if (url.startsWith("/api/tcg-set-slots")) return new Response(JSON.stringify(many))
    return new Response(new Uint8Array(20_000))
  }

  const plan = await planCardShowPrep([BASE], { fetcher })
  assert.equal(plan.imageUrls.length, 10)
  assert.equal(requested.filter((url) => url.startsWith("/api/card-image-proxy")).length, ESTIMATE_SAMPLE_SIZE)
  assert.equal(plan.estimatedBytes, plan.dataBytes + 10 * 20_000)

  const updates: number[] = []
  const result = await downloadCardShowImages(plan, { fetcher, onProgress: (progress) => updates.push(progress.done) })
  assert.deepEqual(result, { done: 10, total: 10, failed: 0 })
  const imageRequests = requested.filter((url) => url.startsWith("/api/card-image-proxy"))
  assert.equal(imageRequests.length, 10)
  assert.equal(new Set(imageRequests).size, 10, "each image fetched exactly once")
  assert.equal(updates.at(-1), 10)
})

test("card show preparation includes Trainer and Energy highlight thumbnails", () => {
  // Synthetic all-card payload, including a Trainer outside Pokémon dex slots.
  const payload = { ...setSlots, cards: [setSlots.slots[0].cards[0], card("synthetic-trainer", "Trainer fixture", "99")] }
  assert.deepEqual(getSetThumbnailUrls(payload), [
    "/api/card-image-proxy?url=https%3A%2F%2Fassets.tcgdex.net%2Fen%2Fbase%2Fbase1%2F44%2Flow.webp",
    "/api/card-image-proxy?url=https%3A%2F%2Fassets.tcgdex.net%2Fen%2Fbase%2Fbase1%2F99%2Flow.webp",
  ])
})
