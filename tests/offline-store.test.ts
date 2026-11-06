import test from "node:test"
import assert from "node:assert/strict"
import {
  LOCAL_COLLECTION_PENDING_OPS_KEY,
  LOCAL_COLLECTION_SNAPSHOT_KEY,
  readPendingCollectionOperations,
  restorePendingCollectionOperations,
} from "../lib/collection/offline-queue"
import type { CollectedPokemon } from "../lib/domain/cards"
import { flushCollectionMirror, holdCollectionMirrorUntil, mirrorCollectionSnapshot, mirrorPendingOperations } from "../lib/offline-store/collection-mirror"
import { createMemoryStore } from "../lib/offline-store/kv"
import {
  COLLECTION_RECORD_KEY,
  MAX_STORED_SET_QUERIES,
  extractLastKnownPrices,
  loadCollectionRecord,
  loadLastKnownPrices,
  loadSetQuery,
  migrateLocalStorageToOfflineStore,
  saveLastKnownPrices,
  saveSetQuery,
  selectWantlist,
} from "../lib/offline-store/records"
import type { TCGSetSlotsResponse } from "../lib/tcg-set-slots"

const keys = { snapshot: LOCAL_COLLECTION_SNAPSHOT_KEY, pendingOperations: LOCAL_COLLECTION_PENDING_OPS_KEY }

const pikachu: CollectedPokemon = {
  id: "row-25",
  pokemon_id: 25,
  pokemon_name: "Pikachu",
  card_language: "en",
  card_finish: "normal",
  wanted_cards: [],
  status: "collected",
  collected_at: "2026-10-01T00:00:00.000Z",
}

const mew: CollectedPokemon = {
  ...pikachu,
  id: "row-151",
  pokemon_id: 151,
  pokemon_name: "Mew",
  status: "wishlisted",
  wanted_cards: [{ card_id: "base4-151", card_name: "Mew", added_at: "2026-10-02T00:00:00.000Z" }],
}

const eevee: CollectedPokemon = { ...pikachu, id: "row-133", pokemon_id: 133, pokemon_name: "Eevee", status: "wishlisted" }

function storageWith(values: Record<string, string>) {
  return { getItem: (key: string) => (key in values ? values[key] : null) }
}

const upsertPikachu = { id: "op-1", type: "upsert", pokemonId: 25, item: pikachu, queuedAt: "2026-10-03T00:00:00.000Z" }

test("migration copies the localStorage snapshot and pending edits into the store once", async () => {
  const store = createMemoryStore()
  const storage = storageWith({
    [keys.snapshot]: JSON.stringify({ ownerUserId: "user-1", savedAt: "2026-10-04T00:00:00.000Z", collection: [pikachu, mew] }),
    [keys.pendingOperations]: JSON.stringify([upsertPikachu]),
  })

  assert.equal(await migrateLocalStorageToOfflineStore(storage, store, keys), "migrated")
  const record = await loadCollectionRecord(store)
  assert.equal(record?.ownerUserId, "user-1")
  assert.equal(record?.savedAt, "2026-10-04T00:00:00.000Z")
  assert.deepEqual(record?.collection.map((item) => item.pokemon_id), [25, 151])
  assert.deepEqual(record?.pendingOperations, [upsertPikachu])

  // Second run is a no-op even if localStorage changed meanwhile.
  await store.set(COLLECTION_RECORD_KEY, { ownerUserId: "user-1", savedAt: "x", collection: [], pendingOperations: [] })
  assert.equal(await migrateLocalStorageToOfflineStore(storage, store, keys), "already-migrated")
  assert.deepEqual((await loadCollectionRecord(store))?.collection, [])
})

test("migration never overwrites a collection IndexedDB already has", async () => {
  const store = createMemoryStore({
    [COLLECTION_RECORD_KEY]: { ownerUserId: "user-2", savedAt: "2026-10-05T00:00:00.000Z", collection: [mew], pendingOperations: [] },
  })
  const storage = storageWith({ [keys.snapshot]: JSON.stringify({ ownerUserId: "user-1", collection: [pikachu] }) })
  assert.equal(await migrateLocalStorageToOfflineStore(storage, store, keys), "kept-existing")
  assert.equal((await loadCollectionRecord(store))?.ownerUserId, "user-2")
})

test("migration tolerates missing or corrupt localStorage", async () => {
  assert.equal(await migrateLocalStorageToOfflineStore(storageWith({}), createMemoryStore(), keys), "nothing-to-migrate")
  const store = createMemoryStore()
  assert.equal(await migrateLocalStorageToOfflineStore(storageWith({ [keys.snapshot]: "{not json" }), store, keys), "nothing-to-migrate")
  assert.equal(await loadCollectionRecord(store), null)
})

test("the wantlist lists wanted printings, and wishlisted Pokémon without a chosen printing", () => {
  assert.deepEqual(selectWantlist([pikachu, mew, eevee]), [
    { pokemonId: 151, pokemonName: "Mew", card: mew.wanted_cards[0] },
    { pokemonId: 133, pokemonName: "Eevee", card: null },
  ])
})

test("collection mirror coalesces snapshot and pending-edit writes into one record", async () => {
  const store = createMemoryStore()
  mirrorCollectionSnapshot([pikachu], "user-1", "2026-10-06T00:00:00.000Z", store)
  mirrorPendingOperations([upsertPikachu], store)
  await flushCollectionMirror(store)

  const record = await loadCollectionRecord(store)
  assert.deepEqual(record?.collection.map((item) => item.pokemon_id), [25])
  assert.deepEqual(record?.pendingOperations, [upsertPikachu])

  // A later pending-only update keeps the saved collection.
  mirrorPendingOperations([], store)
  await flushCollectionMirror(store)
  const after = await loadCollectionRecord(store)
  assert.deepEqual(after?.collection.map((item) => item.pokemon_id), [25])
  assert.deepEqual(after?.pendingOperations, [])
})

test("pending edits from IndexedDB are restored only when localStorage lost them", () => {
  const globals = globalThis as { window?: unknown }
  const values = new Map<string, string>()
  globals.window = {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    },
  }
  try {
    assert.equal(restorePendingCollectionOperations([upsertPikachu]), 1)
    assert.equal(readPendingCollectionOperations()[0]?.id, "op-1")

    // "[]" means everything synced; don't resurrect old edits.
    values.set(LOCAL_COLLECTION_PENDING_OPS_KEY, "[]")
    assert.equal(restorePendingCollectionOperations([upsertPikachu]), 0)
    assert.deepEqual(readPendingCollectionOperations(), [])
  } finally {
    delete globals.window
  }
})

test("last-known prices come from the existing client price cache and survive it being trimmed", async () => {
  const raw = JSON.stringify({
    "base1-4:en": { cardId: "base1-4", language: "en", gbpAmount: 210, marketGbpAmount: 199.5, source: "cardmarket", updatedAt: "2026-10-07" },
    "base1-58:en": { cardId: "base1-58", language: "en", gbpAmount: null, marketGbpAmount: null },
    junk: "nope",
  })
  const prices = extractLastKnownPrices(raw)
  assert.deepEqual(Object.keys(prices), ["base1-4:en"])
  assert.equal(prices["base1-4:en"].marketGbpAmount, 199.5)
  assert.deepEqual(extractLastKnownPrices("{oops"), {})
  assert.deepEqual(extractLastKnownPrices(null), {})

  const store = createMemoryStore()
  await saveLastKnownPrices(store, prices)
  await saveLastKnownPrices(store, extractLastKnownPrices(JSON.stringify({
    "sv3pt5-151:en": { cardId: "sv3pt5-151", language: "en", gbpAmount: 12, marketGbpAmount: 11 },
  })))
  const stored = await loadLastKnownPrices(store)
  assert.deepEqual(Object.keys(stored).sort(), ["base1-4:en", "sv3pt5-151:en"])
})

test("set lookups are saved per query, readable later, and trimmed to the most recent", async () => {
  const store = createMemoryStore()
  const payload = (id: string): TCGSetSlotsResponse => ({
    sets: [],
    selectedSet: { id, name: id } as TCGSetSlotsResponse["selectedSet"],
    slots: [],
  })

  await saveSetQuery(store, "setId=base1", payload("base1"), new Date("2026-10-01T00:00:00Z"))
  assert.equal((await loadSetQuery(store, "setId=base1"))?.selectedSet?.id, "base1")
  assert.equal(await loadSetQuery(store, "setId=missing"), null)
  await saveSetQuery(store, "bad", { nope: true } as unknown as TCGSetSlotsResponse)
  assert.equal(await loadSetQuery(store, "bad"), null)

  for (let index = 0; index < MAX_STORED_SET_QUERIES; index += 1) {
    await saveSetQuery(store, `setId=s${index}`, payload(`s${index}`), new Date(Date.UTC(2026, 9, 2, 0, index)))
  }
  assert.equal(await loadSetQuery(store, "setId=base1"), null, "oldest lookup evicted")
  assert.equal((await store.keys("sets:query:")).length, MAX_STORED_SET_QUERIES)
})

test("mirror writes wait for the migration, so it sees the store as it was before this page load", async () => {
  const store = createMemoryStore()
  const storage = storageWith({
    [keys.snapshot]: JSON.stringify({ ownerUserId: "user-1", savedAt: "2026-10-04T00:00:00.000Z", collection: [pikachu, mew] }),
  })
  let startMigration: () => void = () => undefined
  const migration = new Promise<void>((resolve) => { startMigration = resolve })
    .then(() => migrateLocalStorageToOfflineStore(storage, store, keys))
  holdCollectionMirrorUntil(migration)

  // The app mirrors its collection before the migration has run.
  mirrorCollectionSnapshot([pikachu], "user-1", "2026-10-06T00:00:00.000Z", store)
  const flushed = flushCollectionMirror(store)
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(await loadCollectionRecord(store), null)

  startMigration()
  assert.equal(await migration, "migrated")
  await flushed
  const record = await loadCollectionRecord(store)
  assert.deepEqual(record?.collection.map((item) => item.pokemon_id), [25])
})

test("a stalled migration doesn't block mirror writes forever", async () => {
  const store = createMemoryStore()
  holdCollectionMirrorUntil(new Promise(() => undefined), 20)
  mirrorCollectionSnapshot([pikachu], "user-1", "2026-10-06T00:00:00.000Z", store)
  await flushCollectionMirror(store)
  assert.deepEqual((await loadCollectionRecord(store))?.collection.map((item) => item.pokemon_id), [25])
})

test("batched store reads preserve key order and isolate values; failed writes leave no partial batch", async () => {
  const store = createMemoryStore()
  const value = { synthetic: true, count: 1 }
  await store.setMany([["b", value], ["a", { count: 2 }]])
  value.count = 99
  const result = await store.getMany<{ count: number }>(["a", "missing", "b", "a"])
  assert.deepEqual(result.map(item => item?.count), [2, undefined, 1, 2])
  result[0]!.count = 3
  assert.equal((await store.get<{ count: number }>("a"))?.count, 2)
  assert.equal(result[3]?.count, 2)
  await assert.rejects(store.setMany([["a", 5], ["invalid", () => {}]]))
  assert.equal((await store.get<{ count: number }>("a"))?.count, 2)
  assert.deepEqual(await store.getMany([]), [])
  await store.setMany([])
})
