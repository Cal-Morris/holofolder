import test from "node:test"
import assert from "node:assert/strict"
import {
  LOCAL_COLLECTION_PENDING_OPS_KEY,
  LOCAL_COLLECTION_SNAPSHOT_KEY,
  persistLocalCollectionState,
  queuePendingCollectionOperation,
  readLocalCollectionSnapshot,
  readPendingCollectionOperations,
  removePendingCollectionOperation,
  writeLocalCollectionSnapshot,
} from "../lib/collection/offline-queue"
import type { CollectedPokemon } from "../lib/domain/cards"

class MemoryStorage {
  values = new Map<string, string>()
  failWrites = false
  getItem(key: string) {
    return this.values.has(key) ? this.values.get(key)! : null
  }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error("QuotaExceededError")
    this.values.set(key, String(value))
  }
  removeItem(key: string) {
    this.values.delete(key)
  }
}

// The queue reads window.localStorage; install a fake window for one test and always restore it.
function withStorage(run: (storage: MemoryStorage) => void) {
  const globals = globalThis as { window?: unknown }
  const hadWindow = "window" in globals
  const previous = globals.window
  const storage = new MemoryStorage()
  globals.window = { localStorage: storage }
  try {
    run(storage)
  } finally {
    if (hadWindow) globals.window = previous
    else delete globals.window
  }
}

const pikachu: CollectedPokemon = {
  id: "row-25",
  pokemon_id: 25,
  pokemon_name: "Pikachu",
  card_id: undefined,
  card_name: undefined,
  card_image: undefined,
  card_set: undefined,
  card_language: "en",
  card_finish: "normal",
  wanted_cards: [],
  status: "collected",
  collected_at: "2026-10-01T00:00:00.000Z",
}

test("without a window everything is a safe no-op", () => {
  assert.equal(readLocalCollectionSnapshot(), null)
  assert.deepEqual(readPendingCollectionOperations(), [])
  assert.doesNotThrow(() => queuePendingCollectionOperation({ type: "delete", pokemonId: 1 }))
})

test("snapshot round-trips and normalizes items", () => {
  withStorage(() => {
    writeLocalCollectionSnapshot({ ownerUserId: "owner", savedAt: "2026-10-09T00:00:00.000Z", collection: [pikachu] })
    const snapshot = readLocalCollectionSnapshot()
    assert.equal(snapshot?.ownerUserId, "owner")
    assert.equal(snapshot?.savedAt, "2026-10-09T00:00:00.000Z")
    assert.deepEqual(snapshot?.collection, [pikachu])
  })
})

test("corrupt or malformed snapshots are ignored", () => {
  withStorage((storage) => {
    storage.setItem(LOCAL_COLLECTION_SNAPSHOT_KEY, "{not json")
    assert.equal(readLocalCollectionSnapshot(), null)
    storage.setItem(LOCAL_COLLECTION_SNAPSHOT_KEY, JSON.stringify({ collection: "nope" }))
    assert.equal(readLocalCollectionSnapshot(), null)
    storage.setItem(LOCAL_COLLECTION_SNAPSHOT_KEY, JSON.stringify({ collection: [], ownerUserId: 7 }))
    assert.deepEqual(readLocalCollectionSnapshot(), { ownerUserId: null, savedAt: new Date(0).toISOString(), collection: [] })
  })
})

test("quota failures on write are swallowed", () => {
  withStorage((storage) => {
    storage.failWrites = true
    assert.doesNotThrow(() => writeLocalCollectionSnapshot({ ownerUserId: null, savedAt: "x", collection: [] }))
    assert.doesNotThrow(() => queuePendingCollectionOperation({ type: "delete", pokemonId: 1 }))
  })
})

test("queueing keeps only the latest operation per Pokémon, in order", () => {
  withStorage(() => {
    queuePendingCollectionOperation({ type: "upsert", pokemonId: 25, item: pikachu })
    queuePendingCollectionOperation({ type: "delete", pokemonId: 1 })
    queuePendingCollectionOperation({ type: "delete", pokemonId: 25 })

    const operations = readPendingCollectionOperations()
    assert.deepEqual(operations.map((operation) => [operation.type, operation.pokemonId]), [["delete", 1], ["delete", 25]])
    assert.equal(new Set(operations.map((operation) => operation.id)).size, 2)
    for (const operation of operations) {
      assert.ok(!Number.isNaN(Date.parse(operation.queuedAt)))
    }
  })
})

test("removing an operation by id leaves the others", () => {
  withStorage(() => {
    queuePendingCollectionOperation({ type: "delete", pokemonId: 1 })
    queuePendingCollectionOperation({ type: "upsert", pokemonId: 25, item: pikachu })
    const [first] = readPendingCollectionOperations()
    removePendingCollectionOperation(first.id)
    const remaining = readPendingCollectionOperations()
    assert.equal(remaining.length, 1)
    assert.equal(remaining[0].pokemonId, 25)
    assert.equal(remaining[0].type === "upsert" && remaining[0].item.pokemon_name, "Pikachu")
  })
})

test("invalid stored operations are dropped and upsert items are normalized", () => {
  withStorage((storage) => {
    storage.setItem(LOCAL_COLLECTION_PENDING_OPS_KEY, JSON.stringify([
      null,
      { id: "a", type: "delete", pokemonId: 0 },
      { id: "b", type: "delete", pokemonId: 1.5 },
      { id: "c", type: "teleport", pokemonId: 3 },
      { id: "d", type: "upsert", pokemonId: 4 },
      { type: "delete", pokemonId: 5 },
      { id: "e", type: "delete", pokemonId: 6 },
      { id: "f", type: "upsert", pokemonId: 7, item: { pokemon_id: 7, pokemon_name: "Squirtle", status: "bogus", card_finish: "gold" } },
    ]))

    const operations = readPendingCollectionOperations()
    assert.deepEqual(operations.map((operation) => operation.id), ["e", "f"])
    const upsert = operations[1]
    assert.equal(upsert.type, "upsert")
    if (upsert.type === "upsert") {
      assert.equal(upsert.item.status, "collected")
      assert.equal(upsert.item.card_finish, "normal")
      assert.equal(upsert.item.card_language, "en")
    }
    assert.ok(typeof operations[0].queuedAt === "string")

    storage.setItem(LOCAL_COLLECTION_PENDING_OPS_KEY, "garbage")
    assert.deepEqual(readPendingCollectionOperations(), [])
    storage.setItem(LOCAL_COLLECTION_PENDING_OPS_KEY, JSON.stringify({ not: "an array" }))
    assert.deepEqual(readPendingCollectionOperations(), [])
  })
})

test("persistLocalCollectionState writes the snapshot and the collected ids (excluding wishlisted)", () => {
  withStorage((storage) => {
    const wanted: CollectedPokemon = { ...pikachu, id: "row-1", pokemon_id: 1, pokemon_name: "Bulbasaur", status: "wishlisted" }
    persistLocalCollectionState([pikachu, wanted], "owner")
    assert.equal(readLocalCollectionSnapshot()?.collection.length, 2)
    assert.equal(readLocalCollectionSnapshot()?.ownerUserId, "owner")
    assert.deepEqual(JSON.parse(storage.getItem("pokemon_collected") ?? "[]"), [25])
  })
})
