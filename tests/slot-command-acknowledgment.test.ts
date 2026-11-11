import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { createMemoryStore } from "@/lib/offline-store/kv"
import { createSlotOfflineQueue, offlineScopeKey } from "@/lib/collection/slot-offline-queue"
import { readCompleteInventorySnapshot } from "@/lib/collection/slot-snapshot"
import { projectSlotIntent } from "@/lib/collection/slot-optimistic"
import type { InventorySnapshot } from "@/lib/domain/inventory"

// Every identity, card and account in this suite is synthetic.
const collectionId = "00000000-0000-4000-8000-000000000001"
const scope = { deviceId: "synthetic-device", workspaceId: "synthetic-workspace", accountId: "account-a", ownerUserId: "owner-a" }
const context = { source: "app" as const, clientId: "synthetic-device", batchId: null, clientOccurredAt: "2026-01-01T00:00:00Z" }
const catalog = () => undefined
function snapshot(): InventorySnapshot {
  return { ownerUserId: scope.ownerUserId, inventoryRevision: 1, items: [], placements: [],
    collections: [{ id: collectionId, ownerUserId: scope.ownerUserId, name: "Synthetic", kind: "binder", defaultPresentation: "binder", version: 1 }],
    binders: [{ ownerUserId: scope.ownerUserId, collectionId, layoutRevision: 1, presetManifest: null,
      slots: ["a", "b", "c"].map(id => ({ id, ownerUserId: scope.ownerUserId, collectionId, version: 0, target: null, inventoryItemId: null, wantedCards: [], status: null, presetOrigin: null })) }] }
}
async function complete(s: InventorySnapshot) {
  const page = <T>(rows: T[]) => async () => ({ inventoryRevision: s.inventoryRevision, total: rows.length, rows, next: null })
  return readCompleteInventorySnapshot(s.ownerUserId, s.inventoryRevision, { items: page(s.items), placements: page(s.placements), collections: page(s.collections), binders: page(s.binders) })
}
const intent = () => ({ kind: "slots" as const, context: { ...context, operationId: "operation-one" }, request: { collectionId, operationId: "operation-one", inventoryRevision: 1, collectionVersion: 1, layoutRevision: 1,
  commands: [{ kind: "move" as const, slots: [{ id: "c", version: 0, inventoryItemId: null, itemVersion: null, placementVersion: null }], beforeSlotId: "a" }] } })
/** The server's state after the edit, at the receipt's revision. */
const committed = () => ({ ...projectSlotIntent(snapshot(), intent(), catalog), inventoryRevision: 2 })
const accepted = async () => ({ status: 200, operationId: "operation-one", inventoryRevision: 2 })
async function queued() {
  const store = createMemoryStore(), queue = createSlotOfflineQueue(store, scope)
  await queue.saveSnapshot(await complete(snapshot())); await queue.enqueue(intent(), catalog)
  return { store, queue }
}

describe("saves confirmed from the command result", () => {
  test("a matching receipt is saved durably before the background read starts, and the read settles it", async () => {
    const { store, queue } = await queued()
    let seenDuringRead: string | undefined
    await queue.replay(accepted, () => scope, 0, catalog, async () => {
      seenDuringRead = (await createSlotOfflineQueue(store, scope).read()).pending[0].status
      return complete(committed())
    })
    assert.equal(seenDuringRead, "acknowledged")
    const state = await queue.read()
    assert.equal(state.pending.length, 0)
    assert.equal(state.receipts[0].operationId, "operation-one")
    assert.equal(state.snapshot!.inventoryRevision, 2)
  })
  test("a failed read leaves the edit saved, never resends it, and a later covering read settles it", async () => {
    const { queue } = await queued()
    await queue.replay(accepted, () => scope, 0, catalog, async () => { throw new Error("read failed") })
    const saved = await queue.read()
    assert.equal(saved.pending[0].status, "acknowledged"); assert.equal(saved.pending[0].acknowledgedRevision, 2)
    assert.deepEqual(saved.optimistic!.binders[0].slots.map(s => s.id), ["c", "a", "b"])
    await queue.replay(async () => assert.fail("an acknowledged edit is never resent"), () => scope, 400000, catalog)
    await assert.rejects(queue.resume("operation-one"), /reconciliation/)
    await queue.saveSnapshot(await complete(committed()), catalog)
    assert.equal((await queue.read()).pending.length, 0)
  })
  test("a read another tab already saved at the receipt's revision settles it without a refetch", async () => {
    const { store, queue } = await queued()
    let sending!: () => void
    const replaying = queue.replay(() => new Promise(resolve => { sending = () => resolve({ status: 200, operationId: "operation-one", inventoryRevision: 2 }) }), () => scope, 0, catalog,
      async () => assert.fail("the saved read already covers the receipt"))
    await new Promise(resolve => setTimeout(resolve, 0))
    // Another tab saves a newer read while this reply is in flight; only acknowledged heads settle, so write it directly.
    await store.update(offlineScopeKey(scope), raw => ({ ...(raw as object), snapshot: committed() }))
    sending(); await replaying
    const state = await queue.read()
    assert.equal(state.pending.length, 0); assert.equal(state.receipts[0].outcome, "acknowledged")
  })
  test("a mismatched operation ID or a revision behind the request is not acceptance and keeps the ID for retry", async () => {
    for (const result of [{ status: 200, operationId: "another-operation", inventoryRevision: 2 }, { status: 200, operationId: "operation-one", inventoryRevision: 0 }]) {
      const { queue } = await queued()
      await queue.replay(async () => result, () => scope, 0, catalog)
      const head = (await queue.read()).pending[0]
      assert.equal(head.status, "unavailable"); assert.equal(head.intent.request.operationId, "operation-one")
    }
  })
  test("a receipt that lands after scope teardown is not acknowledged; the lease and exact request are kept", async () => {
    const { store, queue } = await queued()
    let active = true
    await queue.replay(async () => { active = false; return accepted() }, () => active ? scope : null, 0, catalog, async () => assert.fail("no read after teardown"))
    const head = (await createSlotOfflineQueue(store, scope).read()).pending[0]
    assert.equal(head.status, "sending"); assert.ok(head.lease); assert.equal(head.acknowledgedRevision, undefined)
    assert.deepEqual(head.intent, intent())
  })
  test("an acknowledged but unsettled edit stays in its own owner's record and never reaches another owner's queue", async () => {
    const { store, queue } = await queued()
    await queue.replay(accepted, () => scope, 0, catalog)
    const other = createSlotOfflineQueue(store, { ...scope, ownerUserId: "owner-b" })
    assert.deepEqual((await other.read()).pending, [])
    await other.replay(async () => assert.fail("another owner's queue never sends this edit"), () => ({ ...scope, ownerUserId: "owner-b" }), 0, catalog)
    const own = await queue.read()
    assert.equal(own.pending[0].status, "acknowledged"); assert.equal(own.pending[0].intent.request.operationId, "operation-one")
  })
  test("an acknowledged record without its revision fails closed", async () => {
    const { store, queue } = await queued()
    await queue.replay(accepted, () => scope, 0, catalog)
    const raw = structuredClone(await store.get(offlineScopeKey(scope))) as { pending: { acknowledgedRevision?: number }[] }
    delete raw.pending[0].acknowledgedRevision
    await assert.rejects(createSlotOfflineQueue(createMemoryStore({ [offlineScopeKey(scope)]: raw }), scope).read(), /malformed-pending-intent/)
  })
})
