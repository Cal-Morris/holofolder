import test from "node:test"
import assert from "node:assert/strict"
import {
  LOCAL_COLLECTION_PENDING_OPS_KEY,
  LOCAL_COLLECTION_SNAPSHOT_KEY,
  persistLocalCollectionState,
  queuePendingCollectionOperation as queueOperation,
  readLegacyQueueSources,
  readLocalCollectionSnapshot,
  readPendingCollectionOperations,
  removePendingCollectionOperation,
  writeLocalCollectionSnapshot,
} from "../lib/collection/offline-queue"
import type { CollectedPokemon } from "../lib/domain/cards"

const origin = { kind: "account" as const, actorUserId: "actor", ownerUserId: "owner", binderId: "binder" }
const queuePendingCollectionOperation = (input: Parameters<typeof queueOperation>[0]) => queueOperation({ ...input, origin: { ...origin, binderId: input.binderId ?? origin.binderId } })

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

test("import conflict policy survives queue persistence, a later manual edit replaces it", () => {
  withStorage(() => {
    queuePendingCollectionOperation({ type: "upsert", pokemonId: 25, item: pikachu, base: null, importOnly: true })
    const imported = readPendingCollectionOperations()[0]
    assert.equal(imported.type === "upsert" && imported.importOnly, true)
    queuePendingCollectionOperation({ type: "upsert", pokemonId: 25, item: { ...pikachu, status: "finalized" } })
    const manual = readPendingCollectionOperations()[0]
    assert.equal(manual.type === "upsert" && manual.importOnly, undefined)
  })
})

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

test("snapshot quota failures are mirrored, queue authority failures stop delivery", () => {
  withStorage((storage) => {
    storage.failWrites = true
    assert.doesNotThrow(() => writeLocalCollectionSnapshot({ ownerUserId: null, savedAt: "x", collection: [] }))
    assert.throws(() => queuePendingCollectionOperation({ type: "delete", pokemonId: 1 }))
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

test("unbound and malformed operations remain exact source evidence, never normalized into replay", () => {
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

    assert.deepEqual(readPendingCollectionOperations(), [])
    const original = storage.getItem(LOCAL_COLLECTION_PENDING_OPS_KEY)
    assert.equal(readLegacyQueueSources()[0].legacyQueueSource.raw, original)

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

test("queued edits are per binder slot and keep their binder", () => {
  withStorage(() => {
    queuePendingCollectionOperation({ type: "upsert", pokemonId: 25, item: pikachu, base: null, binderId: "binder-a" })
    queuePendingCollectionOperation({ type: "upsert", pokemonId: 25, item: { ...pikachu, status: "considering" }, base: null, binderId: "binder-b" })
    queuePendingCollectionOperation({ type: "delete", pokemonId: 25, base: pikachu })
    const operations = readPendingCollectionOperations()
    assert.equal(operations.length, 3)
    assert.deepEqual(operations.map((operation) => operation.binderId ?? null), ["binder-a", "binder-b", "binder"])
    // A newer edit of the same binder slot replaces the older one.
    queuePendingCollectionOperation({ type: "delete", pokemonId: 25, base: pikachu, binderId: "binder-a" })
    const next = readPendingCollectionOperations()
    assert.equal(next.length, 3)
    assert.equal(next.find((operation) => operation.binderId === "binder-a")?.type, "delete")
  })
})

test("snapshots remember their binder", () => {
  withStorage(() => {
    persistLocalCollectionState([pikachu], "owner-1", "binder-b")
    assert.equal(readLocalCollectionSnapshot()?.binderId, "binder-b")
    persistLocalCollectionState([pikachu], "owner-1")
    assert.equal(readLocalCollectionSnapshot()?.binderId, undefined)
  })
})

// Synthetic acquisition context survives retries independently of queued row IDs.
test('queued show acquisitions survive metadata edits and reload, and an undo clears the alert intent', () => {
  withStorage(() => {
    const acquired = { ...pikachu, card_id: 'synthetic-card', card_finish: 'normal' as const, card_language: 'en' as const }
    const acquisition = { operationId: '00000000-0000-4000-8000-000000000004', actorId: '00000000-0000-4000-8000-000000000001', recipientId: '00000000-0000-4000-8000-000000000002', partnershipId: '00000000-0000-4000-8000-000000000003', printingKey: 'synthetic-card:en:normal' }
    queuePendingCollectionOperation({ type: 'upsert', pokemonId: 25, item: acquired, base: pikachu, acquisition })
    queuePendingCollectionOperation({ type: 'upsert', pokemonId: 25, item: { ...acquired, pokemon_name: 'Renamed' }, base: acquired })
    const saved = readPendingCollectionOperations()[0]
    assert.equal(saved.type, 'upsert')
    if (saved.type === 'upsert') assert.deepEqual(saved.acquisition, acquisition)
    queuePendingCollectionOperation({ type: 'upsert', pokemonId: 25, item: pikachu, base: acquired })
    const undone = readPendingCollectionOperations()[0]
    if (undone.type === 'upsert') assert.equal(undone.acquisition, undefined)
  })
})
