import test from "node:test"
import assert from "node:assert/strict"
import type { CollectedPokemon, WantedCard } from "../lib/domain/cards"
import {
  ABSENT_ROW_FINGERPRINT,
  SYNC_RETRY_MAX_MS,
  applyPendingEdits,
  classifyWriteFailure,
  collectionFingerprint,
  matchesCollectionFingerprint,
  nextSyncRetryDelay,
  resolveConflict,
} from "../lib/collection/sync"
import { CollectionWriteError } from "../lib/collection/remote"
import {
  queuePendingCollectionOperation,
  readPendingCollectionOperations,
  rebasePendingCollectionOperation,
} from "../lib/collection/offline-queue"

const want = (card_id: string): WantedCard => ({ card_id, card_name: card_id, added_at: "2026-10-01T00:00:00.000Z" })

const row = (overrides: Partial<CollectedPokemon> = {}): CollectedPokemon => ({
  id: "row-25",
  pokemon_id: 25,
  pokemon_name: "pikachu",
  card_id: "base1-58",
  card_name: "Pikachu",
  card_language: "en",
  card_finish: "normal",
  wanted_cards: [],
  status: "collected",
  collected_at: "2026-10-01T00:00:00.000Z",
  ...overrides,
})

test("imports preserve concurrent owned selections and only append wants", () => {
  const base = row({ card_id: undefined, status: "wishlisted", wanted_cards: [want("old")] })
  const local = row({ wanted_cards: [want("new")] })
  const remote = row({ card_id: "remote-printing", status: "finalized", wanted_cards: [want("old"), want("remote")] })
  const resolution = resolveConflict({ type: "upsert", pokemonId: 25, base, item: local, importOnly: true }, remote)
  assert.equal(resolution.action, "write")
  if (resolution.action !== "write") return
  assert.equal(resolution.item.card_id, "remote-printing")
  assert.equal(resolution.item.status, "finalized")
  assert.deepEqual(resolution.item.wanted_cards.map(c => c.card_id), ["old", "remote", "new"])
  assert.deepEqual(resolveConflict({ type: "upsert", pokemonId: 25, base, item: local, importOnly: true }, null), { action: "drop", serverItem: null })
})

test("fingerprints ignore ids, names and timestamps but see status, printing and wanted cards", () => {
  assert.equal(collectionFingerprint(null), ABSENT_ROW_FINGERPRINT)
  assert.equal(collectionFingerprint(row()), collectionFingerprint(row({ id: "other", card_name: "x", collected_at: "2020-01-01" })))
  assert.notEqual(collectionFingerprint(row()), collectionFingerprint(row({ status: "finalized" })))
  assert.notEqual(collectionFingerprint(row()), collectionFingerprint(row({ card_finish: "holo" })))
  assert.equal(
    collectionFingerprint(row({ wanted_cards: [want("a"), want("b")] })),
    collectionFingerprint(row({ wanted_cards: [want("b"), want("a")] })),
  )
})

test("queued edits are re-applied over a freshly loaded collection", () => {
  const server = [row(), row({ id: "row-1", pokemon_id: 1, pokemon_name: "bulbasaur" })]
  const result = applyPendingEdits(server, [
    { type: "upsert", pokemonId: 25, item: row({ id: "local", status: "finalized" }) },
    { type: "delete", pokemonId: 1 },
    { type: "upsert", pokemonId: 4, item: row({ id: "row-4", pokemon_id: 4, pokemon_name: "charmander" }) },
  ])
  assert.deepEqual(result.map((item) => [item.pokemon_id, item.status, item.id]), [[4, "collected", "row-4"], [25, "finalized", "row-25"]])
})

test("conflict: local and server changed different things, both survive", () => {
  const base = row({ wanted_cards: [want("a")] })
  const local = row({ status: "finalized", wanted_cards: [want("a"), want("local")] })
  const server = row({ card_finish: "holo", wanted_cards: [want("a"), want("server")] })
  const resolution = resolveConflict({ type: "upsert", pokemonId: 25, item: local, base }, server)
  assert.equal(resolution.action, "write")
  if (resolution.action !== "write") return
  assert.equal(resolution.item.status, "finalized", "local status change wins")
  assert.equal(resolution.item.card_finish, "holo", "server printing change kept")
  assert.deepEqual(resolution.item.wanted_cards.map((card) => card.card_id).sort(), ["a", "local", "server"])
  assert.equal(resolution.base, server)
})

test("conflict: both changed the same field, the local (newer) edit wins", () => {
  const base = row()
  const resolution = resolveConflict(
    { type: "upsert", pokemonId: 25, item: row({ status: "finalized" }), base },
    row({ status: "considering" }),
  )
  assert.equal(resolution.action === "write" && resolution.item.status, "finalized")
})

test("conflict: removing a wanted card locally removes it from the server's list too", () => {
  const base = row({ wanted_cards: [want("a"), want("b")] })
  const resolution = resolveConflict(
    { type: "upsert", pokemonId: 25, item: row({ wanted_cards: [want("b")] }), base },
    row({ wanted_cards: [want("a"), want("b"), want("c")] }),
  )
  assert.deepEqual(resolution.action === "write" && resolution.item.wanted_cards.map((card) => card.card_id), ["b", "c"])
})

test("an edit the server already has is dropped (safe retry after a lost response)", () => {
  const resolution = resolveConflict({ type: "upsert", pokemonId: 25, item: row({ status: "finalized" }), base: row() }, row({ status: "finalized", id: "x" }))
  assert.equal(resolution.action, "drop")
})

test("a queued delete never removes a row someone changed after it was queued", () => {
  const base = row()
  assert.deepEqual(resolveConflict({ type: "delete", pokemonId: 25, base }, row({ status: "finalized" })), { action: "drop", serverItem: row({ status: "finalized" }) })
  assert.deepEqual(resolveConflict({ type: "delete", pokemonId: 25, base }, null), { action: "drop", serverItem: null })
  assert.equal(resolveConflict({ type: "delete", pokemonId: 25, base }, row({ id: "same-content" })).action, "delete")
})

test("an edit to a row deleted elsewhere re-creates it", () => {
  const resolution = resolveConflict({ type: "upsert", pokemonId: 25, item: row({ status: "finalized" }), base: row() }, null)
  assert.equal(resolution.action, "write")
  assert.equal(resolution.action === "write" && resolution.base, null)
})

test("failures: network/5xx/401/429 retry, 409 is a conflict, other 4xx are hard", () => {
  assert.equal(classifyWriteFailure(new TypeError("Failed to fetch")), "retry")
  assert.equal(classifyWriteFailure(new CollectionWriteError("offline", null)), "retry")
  for (const status of [500, 502, 503, 401, 408, 429]) assert.equal(classifyWriteFailure(new CollectionWriteError("x", status)), "retry", String(status))
  assert.equal(classifyWriteFailure(new CollectionWriteError("x", 409)), "conflict")
  for (const status of [400, 403, 404, 422]) assert.equal(classifyWriteFailure(new CollectionWriteError("x", status)), "hard", String(status))
})

test("backoff doubles with jitter and is capped", () => {
  assert.equal(nextSyncRetryDelay(0, () => 0.5), 2_000)
  assert.equal(nextSyncRetryDelay(1, () => 0.5), 4_000)
  assert.equal(nextSyncRetryDelay(3, () => 0.5), 16_000)
  assert.equal(nextSyncRetryDelay(30, () => 0.5), SYNC_RETRY_MAX_MS)
  assert.ok(nextSyncRetryDelay(1, () => 0) >= 3_000 && nextSyncRetryDelay(1, () => 0.999) <= 6_000)
})

test("the queue keeps one edit per Pokémon with the base of the first unsynced edit", () => {
  const globals = globalThis as { window?: unknown }
  const values = new Map<string, string>()
  globals.window = { localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value) } }
  try {
    const original = row()
    queuePendingCollectionOperation({ origin: { kind: "account", actorUserId: "actor", ownerUserId: "owner", binderId: "binder" }, type: "upsert", pokemonId: 25, item: row({ status: "finalized" }), base: original })
    queuePendingCollectionOperation({ origin: { kind: "account", actorUserId: "actor", ownerUserId: "owner", binderId: "binder" }, type: "upsert", pokemonId: 25, item: row({ status: "considering" }), base: row({ status: "finalized" }) })
    let operations = readPendingCollectionOperations()
    assert.equal(operations.length, 1)
    assert.equal(operations[0].type === "upsert" && operations[0].item.status, "considering")
    assert.equal(operations[0].base?.status, "collected")

    queuePendingCollectionOperation({ origin: { kind: "account", actorUserId: "actor", ownerUserId: "owner", binderId: "binder" }, type: "delete", pokemonId: 25, base: row({ status: "considering" }) })
    operations = readPendingCollectionOperations()
    assert.equal(operations[0].type, "delete")
    assert.equal(operations[0].base?.status, "collected")

    rebasePendingCollectionOperation(25, null, "binder", { kind: "account", actorUserId: "actor", ownerUserId: "owner", binderId: "binder" })
    assert.equal(readPendingCollectionOperations()[0].base, null)
  } finally {
    delete globals.window
  }
})


test("legacy collection writes can ignore only wanted-person metadata, while current clients detect it", () => {
  const before = row({ wanted_cards: [want("a")] })
  const assigned = row({ wanted_cards: [{ ...want("a"), wanted_by: ["00000000-0000-4000-8000-000000000001"] }] })
  const legacy = collectionFingerprint(before)
  assert.equal(matchesCollectionFingerprint(assigned, legacy), false)
  assert.equal(matchesCollectionFingerprint(assigned, legacy, true), true)
  assert.equal(matchesCollectionFingerprint(assigned, collectionFingerprint(assigned)), true)
  for (const changed of [{ ...assigned, status: "finalized" as const }, { ...assigned, card_id: "other" }, { ...assigned, wanted_cards: [...assigned.wanted_cards, want("b")] }]) {
    assert.equal(matchesCollectionFingerprint(changed, legacy, true), false)
  }
})

test('billing rejections pause edits rather than treating them as permanent errors', () => {
  assert.equal(classifyWriteFailure({ status: 402 }), 'paused')
})
