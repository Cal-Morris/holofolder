import test from "node:test"
import assert from "node:assert/strict"
import {
  CARD_PRICE_CACHE_MAX_ENTRIES,
  CARD_PRICE_CACHE_STALE_MS,
  buildCardPriceFetchPlan,
  capPriceCacheEntries,
  getCardPriceKey,
  saveCardPricesForOffline,
  writePriceCache,
  type CardPriceSnapshot,
} from "../hooks/use-card-prices"

const now = new Date("2026-06-28T18:00:00.000Z").getTime()

test("offline preparation preserves current quotes locally and full validated history in IndexedDB", async () => {
  const original = globalThis.localStorage
  const stored = new Map<string, string>()
  const evidence = new Map<string, unknown>()
  const store = { get: async <T,>(key: string) => evidence.get(key) as T | undefined,
    set: async (key: string, value: unknown) => { evidence.set(key, value) }, delete: async (key: string) => { evidence.delete(key) }, keys: async () => [...evidence.keys()] }
  globalThis.localStorage = { getItem: key => stored.get(key) ?? null, setItem: (key, value) => { stored.set(key, value) } } as Storage
  try {
    await saveCardPricesForOffline([priceSnapshot("fixture-existing", now)], store)
    await saveCardPricesForOffline([{ ...priceSnapshot("fixture-new", now), historyPoints: [
      { date: "2026-09-15", source: "tcgplayer", currency: "USD", amount: 4, lowAmount: 2, finish: "normal", productId: "123" },
      { amount: -10 },
    ] }, null], store)
    const cache = JSON.parse([...stored.values()][0])
    assert.equal(cache["fixture-existing::en"].marketGbpAmount, 12)
    assert.equal(cache["fixture-new::en"].historyPoints.length, 0)
    const full = evidence.get("price-evidence:fixture-new::en") as CardPriceSnapshot
    assert.equal(full.historyPoints?.length, 1)
    assert.equal(full.historyPoints?.[0].currency, "USD")
    // A broken localStorage no longer fails the download: IndexedDB evidence is what offline reads use.
    globalThis.localStorage.setItem = () => { throw new Error("Storage full") }
    await saveCardPricesForOffline([priceSnapshot("fixture-late", now)], store)
    assert.ok(evidence.has("price-evidence:fixture-late::en"))
    await assert.rejects(saveCardPricesForOffline([priceSnapshot("fixture-late", now)], null), /unavailable/)
  } finally { globalThis.localStorage = original }
})

test("a full set's history does not consume localStorage's five-megabyte quota", async () => {
  const original = globalThis.localStorage
  let local = "{}"
  const evidence = new Map<string, unknown>()
  const store = { get: async <T,>(key: string) => evidence.get(key) as T | undefined,
    set: async (key: string, value: unknown) => { evidence.set(key, value) }, delete: async () => {}, keys: async () => [...evidence.keys()] }
  globalThis.localStorage = { length: 1, clear: () => { local = "{}" }, key: () => null, removeItem: () => { local = "{}" }, getItem: () => local, setItem: (_key, value) => {
    if (value.length * 2 > 5 * 1024 * 1024) throw new Error("Quota exceeded")
    local = value
  } } as Storage
  try {
    // Synthetic 200-card set, each with 90 recorded days across three finishes.
    const history = Array.from({ length: 270 }, (_, i) => ({
      date: new Date(Date.parse("2026-09-15") - Math.floor(i / 3) * 86_400_000).toISOString().slice(0, 10),
      source: "tcgplayer", currency: "USD", amount: 4, lowAmount: 2,
      finish: ["normal", "holo", "reverse_holo"][i % 3], productId: "123",
    }))
    await saveCardPricesForOffline(Array.from({ length: 200 }, (_, i) => ({ ...priceSnapshot(`fixture-${i}`, now), historyPoints: history })), store)
    assert.equal(evidence.size, 200)
    assert.equal((evidence.get("price-evidence:fixture-0::en") as CardPriceSnapshot).historyPoints?.length, 270)
    assert.ok(local.length * 2 < 5 * 1024 * 1024)
  } finally { globalThis.localStorage = original }
})

function priceSnapshot(cardId: string, fetchedAt: number): CardPriceSnapshot {
  return {
    historyPoints: [],
    finishPrices: [],
    cardId,
    language: "en",
    gbpAmount: 12,
    marketGbpAmount: 12,
    goodGbpAmount: 9,
    lowGbpAmount: 8,
    highGbpAmount: 14,
    confidence: "high",
    sourcePrices: [],
    trendPoints: [],
    buySignal: null,
    originalAmount: 16,
    originalCurrency: "USD",
    source: "tcgplayer",
    variantLabel: "Normal",
    updatedAt: "2026-06-28T12:00:00.000Z",
    fxDate: "2026-06-28",
    fetchedAt,
  }
}

test("missing prices retry after five minutes, while legacy evidence stays available offline", () => {
  const empty = { ...priceSnapshot("fixture-1", now - 300_000), gbpAmount: null, marketGbpAmount: null }
  const legacy = { ...priceSnapshot("fixture-2", now), historyPoints: undefined }
  const cache = { "fixture-1::en": empty, "fixture-2::en": legacy }
  assert.equal(buildCardPriceFetchPlan(["fixture-1", "fixture-2"], cache, { now }).fetchBatches[0].lookups.length, 2)
  assert.equal(buildCardPriceFetchPlan(["fixture-1"], { "fixture-1::en": { ...empty, fetchedAt: now - 299_999 } }, { now }).fetchBatches.length, 0)
  assert.equal(buildCardPriceFetchPlan(["fixture-2"], cache, { now, isOnline: false }).cachedPrices["fixture-2::en"], legacy)
})

test("buildCardPriceFetchPlan shows stale cached prices while force-refreshing them", () => {
  const cacheKey = getCardPriceKey("sv1-001", "en")
  const plan = buildCardPriceFetchPlan(
    [{ cardId: "sv1-001", language: "en" }],
    {
      [cacheKey]: priceSnapshot("sv1-001", now - CARD_PRICE_CACHE_STALE_MS - 1),
    },
    { now },
  )

  assert.equal(plan.cachedPrices[cacheKey]?.gbpAmount, 12)
  assert.equal(plan.fetchBatches.length, 1)
  assert.equal(plan.fetchBatches[0].force, true)
  assert.deepEqual(plan.fetchBatches[0].lookups, [{ cardId: "sv1-001", language: "en" }])
})

test("buildCardPriceFetchPlan keeps fresh cache local and fetches missing prices without force", () => {
  const freshKey = getCardPriceKey("sv1-001", "en")
  const plan = buildCardPriceFetchPlan(
    [
      { cardId: "sv1-001", language: "en" },
      { cardId: "sv1-002", language: "fr" },
    ],
    {
      [freshKey]: priceSnapshot("sv1-001", now - CARD_PRICE_CACHE_STALE_MS + 1),
    },
    { now },
  )

  assert.equal(plan.cachedPrices[freshKey]?.gbpAmount, 12)
  assert.deepEqual(plan.fetchBatches, [
    {
      force: false,
      lookups: [{ cardId: "sv1-002", language: "fr" }],
    },
  ])
})

test("buildCardPriceFetchPlan does not fetch while offline", () => {
  const cacheKey = getCardPriceKey("sv1-001", "en")
  const plan = buildCardPriceFetchPlan(
    [
      { cardId: "sv1-001", language: "en" },
      { cardId: "sv1-002", language: "en" },
    ],
    {
      [cacheKey]: priceSnapshot("sv1-001", now - CARD_PRICE_CACHE_STALE_MS - 1),
    },
    { isOnline: false, now },
  )

  assert.equal(plan.cachedPrices[cacheKey]?.gbpAmount, 12)
  assert.deepEqual(plan.fetchBatches, [])
})

test("buildCardPriceFetchPlan chunks stale refreshes under the configured batch size", () => {
  const cache = Object.fromEntries(
    ["sv1-001", "sv1-002", "sv1-003"].map((cardId) => [
      getCardPriceKey(cardId, "en"),
      priceSnapshot(cardId, now - CARD_PRICE_CACHE_STALE_MS - 1),
    ]),
  )
  const plan = buildCardPriceFetchPlan(
    ["sv1-001", "sv1-002", "sv1-003"],
    cache,
    { batchSize: 2, now },
  )

  assert.deepEqual(plan.fetchBatches.map((batch) => ({
    force: batch.force,
    cards: batch.lookups.map((lookup) => lookup.cardId),
  })), [
    { force: true, cards: ["sv1-001", "sv1-002"] },
    { force: true, cards: ["sv1-003"] },
  ])
})

test("legacy cache is retained while finish evidence refreshes, and remains usable offline", () => {
  const key = getCardPriceKey("sv1-001", "en")
  const legacy = priceSnapshot("sv1-001", now)
  delete legacy.finishPrices
  const plan = buildCardPriceFetchPlan(["sv1-001"], { [key]: legacy }, { now })
  assert.equal(plan.cachedPrices[key].marketGbpAmount, 12)
  assert.equal(plan.fetchBatches[0].force, true)
  assert.deepEqual(buildCardPriceFetchPlan(["sv1-001"], { [key]: legacy }, { now, isOnline: false }).fetchBatches, [])
})

const QUOTA_KEY = "binderdex_card_price_cache_v7"

function quotaStorage(maxChars: number) {
  const stored = new Map<string, string>()
  const writes: number[] = []
  const storage = {
    get length() { return stored.size },
    clear: () => stored.clear(),
    key: () => null,
    getItem: (key: string) => stored.get(key) ?? null,
    removeItem: (key: string) => { stored.delete(key) },
    setItem: (key: string, value: string) => {
      writes.push(Object.keys(JSON.parse(value)).length)
      if (value.length > maxChars) throw new DOMException("The quota has been exceeded.", "QuotaExceededError")
      stored.set(key, value)
    },
  } as Storage
  return { storage, stored, writes }
}

function cacheOf(count: number, start = now) {
  return Object.fromEntries(Array.from({ length: count }, (_, i) => [`fixture-${i}::en`, priceSnapshot(`fixture-${i}`, start + i)]))
}

test("price cache cap evicts the oldest fetchedAt first", () => {
  const cache = {
    "old::en": priceSnapshot("old", now - 3_000),
    "newest::en": priceSnapshot("newest", now),
    "middle::en": priceSnapshot("middle", now - 1_000),
    "broken::en": { ...priceSnapshot("broken", now), fetchedAt: Number.NaN },
  }
  assert.deepEqual(Object.keys(capPriceCacheEntries(cache, 2)).sort(), ["middle::en", "newest::en"])
  assert.equal(capPriceCacheEntries(cache, 10), cache)
  const tied = { "a::en": priceSnapshot("a", now), "b::en": priceSnapshot("b", now) }
  assert.deepEqual(Object.keys(capPriceCacheEntries(tied, 1)), ["b::en"])
})

test("price cache writes never keep more than the cap", () => {
  const { storage, stored } = quotaStorage(Number.POSITIVE_INFINITY)
  assert.equal(writePriceCache(cacheOf(CARD_PRICE_CACHE_MAX_ENTRIES + 150), storage), CARD_PRICE_CACHE_MAX_ENTRIES)
  const saved = JSON.parse(stored.get(QUOTA_KEY)!)
  assert.equal(Object.keys(saved).length, CARD_PRICE_CACHE_MAX_ENTRIES)
  assert.ok(saved[`fixture-${CARD_PRICE_CACHE_MAX_ENTRIES + 149}::en`], "newest quote kept")
  assert.equal(saved["fixture-149::en"], undefined, "oldest quotes evicted")
  assert.ok(saved["fixture-150::en"])
})

test("a full quota halves the kept quotes, newest first, until the write fits", () => {
  const entrySize = JSON.stringify({ "fixture-100::en": { ...priceSnapshot("fixture-100", now), historyPoints: [] } }).length
  const { storage, stored, writes } = quotaStorage(entrySize * 130)
  assert.equal(writePriceCache(cacheOf(400), storage), 100)
  assert.deepEqual(writes, [400, 200, 100])
  const saved = JSON.parse(stored.get(QUOTA_KEY)!)
  assert.ok(saved["fixture-399::en"])
  assert.equal(saved["fixture-299::en"], undefined)
})

test("when even a tiny write fails, the price key is dropped to free space for other prefs", () => {
  const { storage, stored, writes } = quotaStorage(10)
  stored.set(QUOTA_KEY, "{\"stale\":1}")
  assert.equal(writePriceCache(cacheOf(400), storage), 0)
  assert.deepEqual(writes, [400, 200, 100, 50, 25])
  assert.equal(stored.has(QUOTA_KEY), false)
})

test("offline download still saves every quote to IndexedDB when localStorage must shrink", async () => {
  const original = globalThis.localStorage
  const evidence = new Map<string, unknown>()
  const store = { get: async <T,>(key: string) => evidence.get(key) as T | undefined,
    set: async (key: string, value: unknown) => { evidence.set(key, value) }, delete: async () => {}, keys: async () => [...evidence.keys()] }
  const entrySize = JSON.stringify({ "fixture-100::en": { ...priceSnapshot("fixture-100", now), historyPoints: [] } }).length
  const { storage, stored } = quotaStorage(entrySize * 70)
  globalThis.localStorage = storage
  try {
    await saveCardPricesForOffline(Array.from({ length: 300 }, (_, i) => priceSnapshot(`fixture-${i}`, now)), store)
    assert.equal(evidence.size, 300)
    const saved = JSON.parse(stored.get(QUOTA_KEY)!)
    assert.ok(Object.keys(saved).length > 0 && Object.keys(saved).length <= 70)
  } finally { globalThis.localStorage = original }
})
