import test from "node:test"
import assert from "node:assert/strict"
import { readOfflineShellState } from "../lib/offline-shell"

function storage(entries: Record<string, unknown>) {
  return { getItem: (key: string) => (key in entries ? (typeof entries[key] === "string" ? entries[key] as string : JSON.stringify(entries[key])) : null) }
}

const row = { id: "r1", pokemon_id: 1, pokemon_name: "bulbasaur", card_id: "base1-44", status: "collected", collected_at: "2026-01-01T00:00:00.000Z" }

test("boots the signed-in user's saved collection and settings", () => {
  const state = readOfflineShellState(storage({
    pokemon_collection_snapshot_v1: { ownerUserId: "u1", savedAt: "x", collection: [row] },
    "pokemon_binder_settings:u1": { binderRows: 3, binderCols: 3, darkMode: false },
  }), "", "u1")
  assert.equal(state.collection.length, 1)
  assert.equal(state.collection[0].card_id, "base1-44")
  assert.equal(state.collectionOwnerUserId, "u1")
  assert.equal(state.settings.binderRows, 3)
  assert.equal(state.darkMode, false)
})

test("keeps the partner owner from the snapshot", () => {
  const state = readOfflineShellState(storage({
    pokemon_collection_snapshot_v1: { ownerUserId: "owner", collection: [row] },
    holofolder_billing_v1: { accountId: "partner", access: { ownerUserId: "owner", source: "perpetual", enforced: true } },
  }), "", "partner")
  assert.equal(state.collection.length, 1)
  assert.equal(state.collectionOwnerUserId, "owner")
})

test("ignores corrupt storage and falls back to defaults", () => {
  const state = readOfflineShellState(storage({ pokemon_collection_snapshot_v1: "{not json", "pokemon_binder_settings:u1": "nope" }), "", "u1")
  assert.deepEqual(state.collection, [])
  assert.equal(state.settings.binderRows, 4)
  assert.equal(state.darkMode, true)
})

test("signed out uses the snapshot and anonymous settings; theme cookie wins", () => {
  const state = readOfflineShellState(storage({
    pokemon_collection_snapshot_v1: { ownerUserId: null, collection: [row] },
    "pokemon_binder_settings:anon": { binderRows: 5, darkMode: true },
  }), "a=1; binderdex_theme=light", null)
  assert.equal(state.collection.length, 1)
  assert.equal(state.collectionOwnerUserId, null)
  assert.equal(state.settings.binderRows, 5)
  assert.equal(state.darkMode, false)
})

test("another account cannot open a shared snapshot without current scoped access", () => {
 const state = readOfflineShellState(storage({ pokemon_collection_snapshot_v1: { ownerUserId:"owner", collection:[row] } }), "", "stranger")
 assert.deepEqual(state.collection, [])
 assert.equal(state.collectionOwnerUserId, "stranger")
})
