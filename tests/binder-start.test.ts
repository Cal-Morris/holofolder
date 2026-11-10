import test from "node:test"
import assert from "node:assert/strict"
import { BINDER_START_MARKER_KEY, readLocalBinderStart, writeBinderStartMarker } from "../lib/binder-start"
import type { Binder } from "../lib/binders/model"

function memoryStorage(entries: Record<string, unknown> = {}) {
  const values = new Map(Object.entries(entries).map(([key, value]) => [key, typeof value === "string" ? value : JSON.stringify(value)]))
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  }
}

const row = { id: "r1", pokemon_id: 1, pokemon_name: "bulbasaur", card_id: "base1-44", status: "collected", collected_at: "2026-01-01T00:00:00.000Z" }
const snapshot = (ownerUserId: string | undefined, binderId?: string) => ({ pokemon_collection_snapshot_v1: { ownerUserId, ...(binderId ? { binderId } : {}), savedAt: "x", collection: [row] } })
const binder = (id: string): Binder => ({ id, ownerUserId: "u1", name: id, color: null, sortOrder: 0, isDefault: id === "b1", rows: null, cols: null, createdAt: null, updatedAt: null })
const marker = (userId: string, ownerUserId: string, binderId: string | null = null, binders: Binder[] = []) => ({ userId, ownerUserId, binderId, binders })

test("paints the saved binder for the account the server last opened on this device", () => {
  const storage = memoryStorage(snapshot("u1"))
  writeBinderStartMarker(storage, marker("u1", "u1"))
  const state = readLocalBinderStart(storage, "", "u1")
  assert.equal(state?.collection[0].card_id, "base1-44")
  assert.equal(state?.collectionOwnerUserId, "u1")
  assert.equal(state?.binderId, null)
})

test("keeps the open binder and the binder list for the switcher", () => {
  const storage = memoryStorage(snapshot("u1", "b2"))
  writeBinderStartMarker(storage, marker("u1", "u1", "b2", [binder("b1"), binder("b2")]))
  const state = readLocalBinderStart(storage, "", "u1")
  assert.equal(state?.binderId, "b2")
  assert.deepEqual(state?.binders.map((entry) => entry.id), ["b1", "b2"])
  assert.equal(readLocalBinderStart(storage, "", "u1", "b2")?.binderId, "b2")
})

test("a non-default binder starts from its own saved copy", () => {
  const storage = memoryStorage({
    pokemon_collection_snapshot_v1: { ownerUserId: "u1", binderId: "b1", savedAt: "x", collection: [row, { ...row, id: "r2", pokemon_id: 2 }] },
    "pokemon_collection_snapshot_v1:b2": { ownerUserId: "u1", binderId: "b2", savedAt: "x", collection: [row] },
  })
  writeBinderStartMarker(storage, marker("u1", "u1", "b2", [binder("b1"), binder("b2")]))
  assert.equal(readLocalBinderStart(storage, "", "u1")?.collection.length, 1)
  writeBinderStartMarker(storage, marker("u1", "u1", "b1", [binder("b1"), binder("b2")]))
  assert.equal(readLocalBinderStart(storage, "", "u1")?.collection.length, 2)
})

test("waits for the server when the URL asks for another binder or the snapshot is of another binder", () => {
  const storage = memoryStorage(snapshot("u1", "b2"))
  writeBinderStartMarker(storage, marker("u1", "u1", "b2"))
  assert.equal(readLocalBinderStart(storage, "", "u1", "b1"), null)
  const stale = memoryStorage(snapshot("u1", "b1"))
  writeBinderStartMarker(stale, marker("u1", "u1", "b2"))
  assert.equal(readLocalBinderStart(stale, "", "u1"), null)
})

test("keeps partner mode: the marker remembers the partner as owner", () => {
  const storage = memoryStorage({ ...snapshot("owner"), holofolder_billing_v1: { accountId: "partner", access: { ownerUserId: "owner", source: "perpetual", enforced: true } } })
  writeBinderStartMarker(storage, marker("partner", "owner"))
  assert.equal(readLocalBinderStart(storage, "", "partner")?.collectionOwnerUserId, "owner")
})

test("waits for the server for another account on the same device", () => {
  const storage = memoryStorage(snapshot("u1"))
  writeBinderStartMarker(storage, marker("u1", "u1"))
  assert.equal(readLocalBinderStart(storage, "", "u2"), null)
})

test("waits for the server when the snapshot belongs to someone other than the confirmed owner", () => {
  const storage = memoryStorage(snapshot("someone-else"))
  writeBinderStartMarker(storage, marker("u1", "u1"))
  assert.equal(readLocalBinderStart(storage, "", "u1"), null)
})

test("waits for the server on a first visit, with no snapshot, or with a legacy snapshot without an owner", () => {
  assert.equal(readLocalBinderStart(memoryStorage(snapshot("u1")), "", "u1"), null)
  const noSnapshot = memoryStorage()
  writeBinderStartMarker(noSnapshot, marker("u1", "u1"))
  assert.equal(readLocalBinderStart(noSnapshot, "", "u1"), null)
  const legacy = memoryStorage(snapshot(undefined))
  writeBinderStartMarker(legacy, marker("u1", "u1"))
  assert.equal(readLocalBinderStart(legacy, "", "u1"), null)
})

test("ignores a malformed marker", () => {
  assert.equal(readLocalBinderStart(memoryStorage({ ...snapshot("u1"), [BINDER_START_MARKER_KEY]: "{oops" }), "", "u1"), null)
  assert.equal(readLocalBinderStart(memoryStorage({ ...snapshot("u1"), [BINDER_START_MARKER_KEY]: { userId: 1 } }), "", "u1"), null)
})

test("a storage that throws on write does not break the start", () => {
  assert.doesNotThrow(() => writeBinderStartMarker({ setItem: () => { throw new Error("quota") } }, marker("u1", "u1")))
})

test("suspended or unknown partner access never paints a cached shared binder", () => {
 const storage = memoryStorage(snapshot("owner"))
 writeBinderStartMarker(storage, marker("partner", "owner"))
 assert.equal(readLocalBinderStart(storage, "", "partner"), null)
 storage.setItem("holofolder_billing_v1", JSON.stringify({ accountId: "partner", access: { ownerUserId:"owner", source:"free", enforced:true } }))
 assert.equal(readLocalBinderStart(storage, "", "partner"), null)
})

test("native display pointer can reach IDB startup without a legacy snapshot, never seeds legacy rows", () => {
  const storage = memoryStorage()
  writeBinderStartMarker(storage, { ...marker("u1", "u1", "b1"), native: { version: 1, deviceId: "device", authSessionId: "auth" } })
  const boot = readLocalBinderStart(storage, "", "u1")
  assert.deepEqual(boot?.collection, [])
  assert.equal(boot?.collectionOwnerUserId, "u1")
  assert.equal(readLocalBinderStart(storage, "", "other"), null)
  assert.equal(readLocalBinderStart(storage, "", "u1", "b2"), null)
})
