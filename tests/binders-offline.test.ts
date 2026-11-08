import test from "node:test"
import assert from "node:assert/strict"
import type { Binder } from "../lib/binders/model"
import {
  collectionRecordKey,
  collectionSnapshotKey,
  DEVICE_BINDERS_KEY,
  markBinderSavedOnDevice,
  offlineAvailableBinderIds,
  pickOfflineBinder,
  readDeviceBinders,
  rememberDeviceBinders,
} from "../lib/binders/offline"
import { readOfflineBinderBoot } from "../lib/offline-shell"
import { createMemoryStore } from "../lib/offline-store/kv"
import { flushCollectionMirror, mirrorCollectionSnapshot, mirrorPendingOperations } from "../lib/offline-store/collection-mirror"
import { loadCollectionRecord } from "../lib/offline-store/records"

const MAIN = "11111111-1111-4111-8111-111111111111"
const TRADES = "22222222-2222-4222-8222-222222222222"
const SPARE = "33333333-3333-4333-8333-333333333333"

const binder = (id: string, name: string, isDefault: boolean, sortOrder: number): Binder => ({
  id, ownerUserId: "owner", name, color: null, sortOrder, isDefault, rows: null, cols: null, createdAt: null, updatedAt: null,
})
const BINDERS = [binder(MAIN, "My binder", true, 0), binder(TRADES, "Trades", false, 1), binder(SPARE, "Spare", false, 2)]

function memoryStorage(entries: Record<string, unknown> = {}) {
  const data = new Map(Object.entries(entries).map(([key, value]) => [key, typeof value === "string" ? value : JSON.stringify(value)]))
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  }
}

const row = (pokemonId: number, cardId: string) => ({ id: `r${pokemonId}`, pokemon_id: pokemonId, pokemon_name: "x", card_id: cardId, status: "collected", collected_at: "2026-01-01T00:00:00.000Z" })

test("the default binder keeps the original keys; other binders get their own", () => {
  assert.equal(collectionSnapshotKey(null, true), "pokemon_collection_snapshot_v1")
  assert.equal(collectionSnapshotKey(MAIN, true), "pokemon_collection_snapshot_v1")
  assert.equal(collectionSnapshotKey(TRADES, false), `pokemon_collection_snapshot_v1:${TRADES}`)
  assert.equal(collectionRecordKey(MAIN, true), "collection")
  assert.equal(collectionRecordKey(TRADES, false), `collection:${TRADES}`)
})

test("the binder list is remembered per owner, and saved binders are tracked", () => {
  const storage = memoryStorage()
  rememberDeviceBinders(storage, "owner", BINDERS)
  markBinderSavedOnDevice(storage, "owner", TRADES)
  markBinderSavedOnDevice(storage, "owner", TRADES)
  const device = readDeviceBinders(storage, "owner")!
  assert.deepEqual(device.binders.map((item) => item.name), ["My binder", "Trades", "Spare"])
  assert.deepEqual(device.savedBinderIds, [TRADES])
  assert.equal(readDeviceBinders(storage, "someone-else"), null)

  // A deleted binder's saved flag goes with it.
  rememberDeviceBinders(storage, "owner", BINDERS.filter((item) => item.id !== TRADES))
  assert.deepEqual(readDeviceBinders(storage, "owner")!.savedBinderIds, [])
})

test("a binder opens offline only when this device has a copy of it", () => {
  const storage = memoryStorage({
    pokemon_collection_snapshot_v1: { ownerUserId: "owner", binderId: MAIN, collection: [row(1, "base1-44")] },
    [`pokemon_collection_snapshot_v1:${TRADES}`]: { ownerUserId: "owner", binderId: TRADES, collection: [row(4, "base1-46")] },
  })
  assert.deepEqual([...offlineAvailableBinderIds(storage, "owner", BINDERS)].sort(), [MAIN, TRADES].sort())

  // A snapshot from before binders (no binderId) is the default binder's.
  const legacy = memoryStorage({ pokemon_collection_snapshot_v1: { ownerUserId: "owner", collection: [] } })
  assert.deepEqual([...offlineAvailableBinderIds(legacy, "owner", BINDERS)], [MAIN])

  // The original key holding another binder (saved there before per-binder keys) doesn't count for the default.
  const stale = memoryStorage({ pokemon_collection_snapshot_v1: { ownerUserId: "owner", binderId: TRADES, collection: [] } })
  assert.deepEqual([...offlineAvailableBinderIds(stale, "owner", BINDERS)], [])
})

test("offline the requested binder opens if saved, else the last opened saved one, else the default", () => {
  const available = new Set([MAIN, TRADES])
  assert.equal(pickOfflineBinder(BINDERS, available, TRADES, null).binder?.id, TRADES)
  const spare = pickOfflineBinder(BINDERS, available, SPARE, TRADES)
  assert.equal(spare.binder?.id, TRADES)
  assert.equal(spare.unavailable?.name, "Spare")
  assert.equal(pickOfflineBinder(BINDERS, available, null, SPARE).binder?.id, MAIN)
})

test("the offline shell boots a non-default binder from its own copy, with the remembered list", () => {
  const storage = memoryStorage({
    pokemon_collection_snapshot_v1: { ownerUserId: "owner", binderId: MAIN, collection: [row(1, "base1-44"), row(4, "base1-46")] },
    [`pokemon_collection_snapshot_v1:${TRADES}`]: { ownerUserId: "owner", binderId: TRADES, collection: [row(4, "base1-46")] },
    [DEVICE_BINDERS_KEY]: { ownerUserId: "owner", binders: BINDERS, savedBinderIds: [MAIN, TRADES], savedAt: "x" },
    holofolder_billing_v1: { accountId: "partner", access: { ownerUserId: "owner", source: "perpetual", enforced: true } },
  })
  const trades = readOfflineBinderBoot(storage, "", "owner", TRADES, null)
  assert.equal(trades.binderId, TRADES)
  assert.deepEqual(trades.collection.map((item) => item.pokemon_id), [4])
  assert.equal(trades.binders.length, 3)

  const fallback = readOfflineBinderBoot(storage, "", "owner", SPARE, null)
  assert.equal(fallback.binderId, MAIN)
  assert.equal(fallback.collection.length, 2)
  assert.equal(fallback.unavailableBinderName, "Spare")

  // A partner opens the owner's binders (the snapshot names the owner).
  const partner = readOfflineBinderBoot(storage, "", "partner", TRADES, null)
  assert.equal(partner.binderId, TRADES)
  assert.equal(partner.collectionOwnerUserId, "owner")

  // Another account on a shared device doesn't get this owner's list.
  const other = readOfflineBinderBoot(memoryStorage({ [DEVICE_BINDERS_KEY]: { ownerUserId: "owner", binders: BINDERS, savedBinderIds: [] } }), "", "stranger", TRADES, null)
  assert.equal(other.binderId, null)
  assert.deepEqual(other.binders, [])
})

test("the IndexedDB copy is per binder; pending edits stay in the default record", async () => {
  const store = createMemoryStore()
  const pikachu = { ...row(25, "base1-58"), wanted_cards: [] } as never
  const charmander = { ...row(4, "base1-46"), wanted_cards: [] } as never
  mirrorCollectionSnapshot([pikachu], "owner", "2026-10-06T00:00:00.000Z", store, MAIN, true)
  mirrorCollectionSnapshot([charmander], "owner", "2026-10-06T00:00:00.000Z", store, TRADES, false)
  mirrorPendingOperations([{ id: "op", type: "delete", pokemonId: 4, binderId: TRADES }], store)
  await flushCollectionMirror(store)

  const main = await loadCollectionRecord(store)
  const trades = await loadCollectionRecord(store, `collection:${TRADES}`)
  assert.deepEqual(main?.collection.map((item) => item.pokemon_id), [25])
  assert.equal(main?.pendingOperations.length, 1)
  assert.deepEqual(trades?.collection.map((item) => item.pokemon_id), [4])
  assert.equal(trades?.binderId, TRADES)
  assert.deepEqual(trades?.pendingOperations, [])
})

test("offline boot keeps each binder's own custom layout and queued device dimensions", () => {
  const storage = memoryStorage({
    pokemon_collection_snapshot_v1: { ownerUserId: "owner", binderId: MAIN, collection: [row(1, "base1-44")] },
    [`pokemon_collection_snapshot_v1:${TRADES}`]: { ownerUserId: "owner", binderId: TRADES, collection: [row(4, "base1-46")] },
    [`pokemon_binder_settings:owner:binder:${TRADES}`]: { binderRows: 8, binderCols: 7 },
  })
  rememberDeviceBinders(storage, "owner", BINDERS.map(binder => ({ ...binder, rows: 2, cols: 2 })))
  assert.equal(readOfflineBinderBoot(storage, "", "owner", MAIN, null).settings.binderRows, 2)
  assert.equal(readOfflineBinderBoot(storage, "", "owner", TRADES, null).settings.binderRows, 8)
  assert.equal(readOfflineBinderBoot(storage, "", "owner", TRADES, null).settings.binderCols, 7)
})
