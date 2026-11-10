import { test } from "node:test"
import assert from "node:assert/strict"
import { createMemoryStore } from "@/lib/offline-store/kv"
import { createSlotOfflineQueue } from "@/lib/collection/slot-offline-queue"
import { readCompleteInventorySnapshot } from "@/lib/collection/slot-snapshot"
import { parseSlotIntent, projectSlotIntent } from "@/lib/collection/slot-optimistic"
import { blankPreset, speciesPreset, parseBinderCreationDraft, prepareBinderCreation } from "@/lib/binder-creation-draft"
import type { InventorySnapshot } from "@/lib/domain/inventory"

// Synthetic identities and account. No hosted database or invented catalog printings.
const scope = { deviceId: "synthetic-device", workspaceId: "holofolder", accountId: "synthetic-actor", ownerUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }
const oldId = "11111111-1111-4111-8111-111111111111", newId = "22222222-2222-4222-8222-222222222222"
const base: InventorySnapshot = { ownerUserId: scope.ownerUserId, inventoryRevision: 1, items: [], placements: [],
  collections: [{ id: oldId, ownerUserId: scope.ownerUserId, name: "Existing", kind: "binder", defaultPresentation: "binder", version: 0 }],
  binders: [{ ownerUserId: scope.ownerUserId, collectionId: oldId, layoutRevision: 0, presetManifest: null, slots: [] }] }
const context = { source: "app", clientId: scope.deviceId, operationId: "synthetic-create", batchId: null, clientOccurredAt: "2026-11-10T12:00:00Z" } as const
async function complete(s = base) {
  const page = <T>(rows: T[]) => async () => ({ inventoryRevision: s.inventoryRevision, total: rows.length, rows, next: null })
  return readCompleteInventorySnapshot(s.ownerUserId, s.inventoryRevision, { items: page(s.items), placements: page(s.placements), collections: page(s.collections), binders: page(s.binders) })
}
async function setup() {
  const store = createMemoryStore(), q = createSlotOfflineQueue(store, scope), snapshot = await complete()
  await q.saveSnapshot(snapshot)
  const draft = parseBinderCreationDraft({ version: 1, operationId: context.operationId, ownerUserId: scope.ownerUserId, name: "Copied", manifest: speciesPreset("Selected", [143, 25]) })
  const intent = prepareBinderCreation(draft, snapshot, context, newId, ["slot-one", "slot-two"])
  return { store, q, snapshot, intent }
}
test("creation requires verified existing native authority and detached immutable exact IDs/context", async () => {
  const { intent, snapshot } = await setup()
  assert.equal(intent.kind, "creation")
  assert.deepEqual(intent.request.slotIds, ["slot-one", "slot-two"])
  assert.deepEqual(intent.context, context)
  assert.ok(Object.isFrozen(intent.request.manifest.entries[0].target))
  assert.throws(() => prepareBinderCreation(parseBinderCreationDraft({ version: 1, operationId: context.operationId, ownerUserId: scope.ownerUserId, name: "Blank", manifest: blankPreset() }), structuredClone(snapshot), context, newId, []), /complete/)
  assert.deepEqual(projectSlotIntent(snapshot, intent, () => undefined), snapshot)
})
test("creation retains in same atomic record without exposing a half-created binder, all sinks fence pending creation", async () => {
  const { q, intent, snapshot } = await setup()
  await assert.rejects(q.enqueue(intent, () => undefined), /complete/)
  await q.enqueue(intent, () => undefined, snapshot)
  await assert.rejects(q.saveSnapshot(await complete({ ...base, inventoryRevision: 2 })), /creation-pending/)
  const record = await q.read()
  assert.deepEqual(record.optimistic, base)
  assert.deepEqual(record.pending[0].intent, parseSlotIntent(intent))
  await assert.rejects(q.enqueue({ kind: "slots", context: { ...context, operationId: "synthetic-slot-edit" }, request: { operationId: "synthetic-slot-edit", inventoryRevision: 1, collectionId: oldId, collectionVersion: 0, layoutRevision: 0, commands: [{ kind: "create", ids: ["later-slot"], beforeSlotId: null }] } }, () => undefined), /creation/)
})
test("abort retry, reopen and lost reply replay preserve original intent, ACK requires separate fresh read", async () => {
  const { q, store, snapshot, intent } = await setup()
  const failing = createSlotOfflineQueue({ ...store, update: async () => { throw new Error("synthetic-IDB-abort") } }, scope)
  await assert.rejects(failing.enqueue(intent, () => undefined, snapshot), /abort/)
  assert.equal((await q.read()).pending.length, 0)
  await q.enqueue(intent, () => undefined, snapshot)
  const replay = createSlotOfflineQueue(store, scope)
  await replay.replay(async sent => { assert.deepEqual(sent, intent); throw new Error("lost reply") }, () => scope, 1000)
  await replay.resume(context.operationId, 100000)
  const receipt = { status: 200, operationId: context.operationId, inventoryRevision: 2 }
  await replay.replay(async () => receipt, () => scope, 100000, () => undefined, async () => snapshot)
  assert.equal((await replay.read()).receipts.length, 0)
  await replay.resume(context.operationId, 200000)
  // A later legitimate deletion must not be resurrected by replaying the historical creation receipt.
  await replay.replay(async sent => { assert.deepEqual(sent, intent); return receipt }, () => scope, 200000, () => undefined, () => complete({ ...base, inventoryRevision: 3 }))
  assert.equal((await replay.read()).pending.length, 0)
  assert.deepEqual((await replay.read()).snapshot?.collections, base.collections)
})
for (const status of [400, 401, 402, 403, 409, 413, 422, 503]) test(`creation HTTP ${status} is retained with no inferred rejection/discard/rebase`, async () => {
  const { q, snapshot, intent } = await setup()
  await q.enqueue(intent, () => undefined, snapshot)
  await q.replay(async () => ({ status }), () => scope, 1000)
  const p = (await q.read()).pending[0]
  assert.equal(p.conflict?.rejected, false)
  await assert.rejects(q.reconcile(context.operationId, { kind: "keep-remote" }, () => undefined))
  await assert.rejects(q.rebase(context.operationId, "replacement-operation", () => undefined))
  assert.deepEqual(p.intent, intent)
})
test("current actor/owner fence is checked inside the atomic durable handoff", async () => {
  const { q, snapshot, intent, store } = await setup()
  let active = true
  const delayed = createSlotOfflineQueue({ ...store, update: async (key, transform) => {
    active = false
    return store.update(key, transform)
  } }, scope)
  await assert.rejects(delayed.enqueue(intent, () => undefined, snapshot, () => active ? scope : null), /inactive/)
  assert.equal((await q.read()).pending.length, 0)
})
test("creation cannot bootstrap a fabricated empty owner or silently drop a set scope", async () => {
  const { snapshot } = await setup()
  const draft = parseBinderCreationDraft({ version: 1, operationId: context.operationId, ownerUserId: scope.ownerUserId, name: "Empty", manifest: blankPreset() })
  const empty = await complete({ ...base, collections: [], binders: [] })
  assert.throws(() => prepareBinderCreation(draft, empty, context, newId, []), /complete/)
  assert.throws(() => prepareBinderCreation({ ...draft, ownerUserId: "other-owner" }, snapshot, context, newId, []), /complete/)
  assert.throws(() => prepareBinderCreation({ ...draft, setChecklist: {} as never }, snapshot, context, newId, []), /set-checklist/)
})
test("accepted fresh read retains independent exact copied manifest and adds no owned/wanted/grade data", async () => {
  const { q, snapshot, intent } = await setup()
  const { projectCollectionCreation } = await import("@/lib/domain/storage-creation")
  const copied = projectCollectionCreation(intent.request, scope.ownerUserId)
  const committed = { ...base, inventoryRevision: 2, collections: [...base.collections, { id: newId, ownerUserId: scope.ownerUserId, name: intent.request.name, kind: "binder" as const, defaultPresentation: "binder" as const, version: 0 }], binders: [...base.binders, copied] }
  await q.enqueue(intent, () => undefined, snapshot)
  await q.replay(async () => ({ status: 200, operationId: context.operationId, inventoryRevision: 2 }), () => scope, 1000, () => undefined, () => complete(committed))
  const saved = (await q.read()).snapshot!
  assert.deepEqual(saved.binders[1].presetManifest, intent.request.manifest)
  assert.equal(saved.items.length, 0)
  assert.ok(saved.binders[1].slots.every(s => s.inventoryItemId === null && s.wantedCards.length === 0 && s.status === null))
  copied.slots[0].target = null
  assert.equal((await q.read()).snapshot!.binders[1].slots[0].target?.kind, "pokemon")
})
test("unresolved recovery blocks creation; explicit discarded recovery permits it in the same record", async () => {
  const { q, snapshot, intent } = await setup()
  const recovery = { operation: "recovery.apply" as const, request: { eventId: "101", restoreUnassignedItemIds: [], planVersion: 1 as const, planToken: "a".repeat(64), operationId: "synthetic-recovery", confirmed: true as const }, context: { source: "app" as const, clientId: scope.deviceId, clientOccurredAt: context.clientOccurredAt } }
  await q.retainRecovery(recovery, () => scope)
  await assert.rejects(q.enqueue(intent, () => undefined, snapshot), /recovery-pending/)
  await q.replayRecovery("synthetic-recovery", async () => ({ outcome: "rejected", operationId: "synthetic-recovery", code: "recovery_plan_conflict", inventoryRevision: 1 }), () => complete(), () => scope)
  await q.discardRecovery("synthetic-recovery", () => complete(), () => scope)
  await q.enqueue(intent, () => undefined, snapshot)
  assert.equal((await q.read()).pending[0].intent.kind, "creation")
})
test("a slot terminal proof cannot be reused as creation noncommit proof", async () => {
  const { q, snapshot, intent, store } = await setup()
  const { offlineScopeKey } = await import("@/lib/collection/slot-offline-queue")
  await q.enqueue(intent, () => undefined, snapshot)
  await store.update(offlineScopeKey(scope), raw => {
    const record = raw as Awaited<ReturnType<typeof q.read>>
    record.pending[0].status = "conflict"
    record.pending[0].conflict = { reason: "synthetic wrong operation-family proof", current: base, rejected: true,
      rejection: { outcome: "rejected", operationId: context.operationId, code: "slot_revision_conflict", inventoryRevision: 1 } }
    return record
  })
  assert.equal((await q.read()).pending[0].conflict?.rejected, false)
  await assert.rejects(q.refreshConflict(context.operationId, () => complete(), () => scope))
  await assert.rejects(q.reconcile(context.operationId, { kind: "keep-remote" }, () => undefined))
})

async function rejectedCreation() {
  const state = await setup(), auth = "synthetic-auth-session"
  await state.q.enqueue(state.intent, () => undefined, state.snapshot, () => scope, auth)
  const proof = { family: "collection.create" as const, deliveryId: "synthetic-delivery", scope: { accountId: scope.accountId, ownerUserId: scope.ownerUserId, authSessionId: auth },
    intent: state.intent, rejection: { outcome: "rejected" as const, operationId: context.operationId, code: "inventory_revision_conflict" as const, inventoryRevision: 2 } }
  return { ...state, auth, proof }
}
test("creation terminal proof survives reload separately from acceptance; explicit discard retains exact intent/proof and later edits", async () => {
  const { q, store, intent, auth, proof } = await rejectedCreation()
  await q.replay(async () => ({ status: 409, operationId: context.operationId, creationProof: proof }), () => scope, 1000, () => undefined, () => complete({ ...base, inventoryRevision: 4 }))
  const reopened = createSlotOfflineQueue(store, scope)
  assert.deepEqual((await reopened.read()).pending[0].conflict?.creationProof, proof)
  assert.equal((await reopened.read()).pending[0].conflict?.current?.inventoryRevision, 4)
  assert.equal((await reopened.read()).receipts.length, 0)
  await assert.rejects(reopened.reconcile(context.operationId, { kind: "keep-remote" }, () => undefined))
  await assert.rejects(reopened.rebase(context.operationId, "synthetic-new-id", () => undefined))
  await assert.rejects(reopened.discardCreation(context.operationId, () => complete(), () => scope, "different-auth"))
  await assert.rejects(reopened.discardCreation(context.operationId, () => complete(), () => scope, auth), /stale/)
  await reopened.discardCreation(context.operationId, () => complete({ ...base, inventoryRevision: 5, collections: [{ ...base.collections[0], name: "Later edit" }] }), () => scope, auth)
  const saved = await createSlotOfflineQueue(store, scope).read()
  assert.equal(saved.pending.length, 0); assert.equal(saved.receipts.length, 0)
  assert.equal(saved.snapshot?.collections[0].name, "Later edit")
  assert.deepEqual(saved.creationDiscards, [{ intent, proof, resolution: "discarded" }])
  await assert.rejects(reopened.enqueue(intent, () => undefined, await complete({ ...base, inventoryRevision: 5 })), /new-creation-ids/)
})
for (const field of ["family", "operation", "request", "context", "account", "owner", "auth", "delivery", "malformed", "status"] as const) test(`creation ${field} mismatch cannot authorize discard`, async () => {
  const { q, intent, auth, proof } = await rejectedCreation()
  const bad = structuredClone(proof)
  if (field === "family") Object.assign(bad, { family: "inventory" })
  if (field === "operation") Object.assign(bad.rejection, { operationId: "another-operation" })
  if (field === "request") bad.intent.request.collectionId = oldId
  if (field === "context") bad.intent.context.clientOccurredAt = "2026-11-10T13:00:00Z"
  if (field === "account") bad.scope.accountId = "another-account"
  if (field === "owner") bad.scope.ownerUserId = "another-owner"
  if (field === "auth") bad.scope.authSessionId = "another-session"
  if (field === "delivery") bad.deliveryId = ""
  if (field === "malformed") Object.assign(bad.rejection, { code: "generic-error" })
  await q.replay(async () => ({ status: field === "status" ? 0 : 409, operationId: context.operationId, creationProof: bad }), () => scope, 1000)
  assert.equal((await q.read()).pending[0].conflict?.rejected, false)
  assert.deepEqual((await q.read()).pending[0].intent, intent)
  await assert.rejects(q.discardCreation(context.operationId, () => complete({ ...base, inventoryRevision: 3 }), () => scope, auth))
})
test("creation discard fences stale read, scope teardown, lease/CAS races and IDB abort without losing proof", async () => {
  const { q, store, intent, auth, proof } = await rejectedCreation()
  await q.replay(async () => ({ status: 409, operationId: context.operationId, creationProof: proof }), () => scope, 1000)
  const cached = await complete({ ...base, inventoryRevision: 3 })
  await assert.rejects(q.discardCreation(context.operationId, async () => cached, () => scope, auth), /fresh/)
  let active = true
  await assert.rejects(q.discardCreation(context.operationId, async () => { active = false; return complete({ ...base, inventoryRevision: 3 }) }, () => active ? scope : null, auth, 2000), /fresh/)
  const { offlineScopeKey } = await import("@/lib/collection/slot-offline-queue")
  await store.update(offlineScopeKey(scope), raw => { const r = raw as Awaited<ReturnType<typeof q.read>>; r.pending[0].lease = null; return r })
  await assert.rejects(q.discardCreation(context.operationId, async () => {
    await store.update(offlineScopeKey(scope), raw => { const r = raw as Awaited<ReturnType<typeof q.read>>; r.pending[0].lease = { id: "other-tab-lease", until: 999999 }; return r })
    return complete({ ...base, inventoryRevision: 3 })
  }, () => scope, auth, 3000), /stale/)
  await store.update(offlineScopeKey(scope), raw => { const r = raw as Awaited<ReturnType<typeof q.read>>; r.pending[0].lease = null; return r })
  let writes = 0
  const aborting = createSlotOfflineQueue({ ...store, update: async (key, transform) => { if (++writes === 2) throw new Error("synthetic-IDB-abort"); return store.update(key, transform) } }, scope)
  await assert.rejects(aborting.discardCreation(context.operationId, () => complete({ ...base, inventoryRevision: 3 }), () => scope, auth), /abort/)
  const saved = await q.read()
  assert.deepEqual(saved.pending[0].intent, intent); assert.deepEqual(saved.pending[0].conflict?.creationProof, proof)
  assert.equal(saved.pending[0].lease, null); assert.equal(saved.creationDiscards, undefined)
  await q.discardCreation(context.operationId, () => complete({ ...base, inventoryRevision: 3 }), () => scope, auth)
})

test("creation proof write abort leaves original sending intent, reload exact replay persists proof", async () => {
  const { q, store, intent, auth, proof } = await rejectedCreation()
  let writes = 0
  const aborting = createSlotOfflineQueue({ ...store, update: async (key, transform) => { if (++writes === 2) throw new Error("synthetic-proof-IDB-abort"); return store.update(key, transform) } }, scope)
  const result = { status: 409, operationId: context.operationId, creationProof: proof }
  await assert.rejects(aborting.replay(async () => result, () => scope, 1000), /abort/)
  const retained = (await q.read()).pending[0]
  assert.equal(retained.status, "sending"); assert.deepEqual(retained.intent, intent)
  assert.equal(retained.conflict, null)
  await assert.rejects(q.discardCreation(context.operationId, () => complete({ ...base, inventoryRevision: 3 }), () => scope, auth))
  const reopened = createSlotOfflineQueue(store, scope)
  await reopened.replay(async sent => { assert.deepEqual(sent, intent); return result }, () => scope, 100000)
  assert.deepEqual((await reopened.read()).pending[0].conflict?.creationProof, proof)
})

test("pre-consumer pending creation without original auth evidence stays unresolved", async () => {
  const { q, store, intent, snapshot } = await setup()
  const { proof, auth } = await rejectedCreation()
  await q.enqueue(intent, () => undefined, snapshot)
  await q.replay(async () => ({ status: 409, operationId: context.operationId, creationProof: proof }), () => scope, 1000)
  const reopened = createSlotOfflineQueue(store, scope)
  assert.equal((await reopened.read()).pending[0].conflict?.rejected, false)
  await assert.rejects(reopened.discardCreation(context.operationId, () => complete({ ...base, inventoryRevision: 3 }), () => scope, auth))
})
test("creation discard cannot use a read older than an already observed current revision or an expired lease", async () => {
  const { q, auth, proof } = await rejectedCreation()
  await q.replay(async () => ({ status: 409, operationId: context.operationId, creationProof: proof }), () => scope, 1000, () => undefined, () => complete({ ...base, inventoryRevision: 4 }))
  await assert.rejects(q.discardCreation(context.operationId, () => complete({ ...base, inventoryRevision: 3 }), () => scope, auth), /stale/)
  const clock = Date.now
  try {
    await assert.rejects(q.discardCreation(context.operationId, async () => { const expired = clock() + 60001; Date.now = () => expired; return complete({ ...base, inventoryRevision: 5 }) }, () => scope, auth), /stale/)
  } finally { Date.now = clock }
  assert.deepEqual((await q.read()).pending[0].conflict?.creationProof, proof)
})

test("new creation review must allocate independent operation, collection and slot IDs after discard", async () => {
  const { q, intent, auth, proof } = await rejectedCreation()
  await q.replay(async () => ({ status: 409, operationId: context.operationId, creationProof: proof }), () => scope, 1000)
  const fresh = await complete({ ...base, inventoryRevision: 3 })
  await q.discardCreation(context.operationId, () => complete({ ...base, inventoryRevision: 3 }), () => scope, auth)
  const next = structuredClone(intent)
  Object.assign(next.request, { operationId: "synthetic-new-review", inventoryRevision: 3 })
  Object.assign(next.context, { operationId: "synthetic-new-review", clientOccurredAt: "2026-11-10T14:00:00Z" })
  await assert.rejects(q.enqueue(next, () => undefined, fresh, () => scope, auth), /new-creation-ids/)
  next.request.collectionId = "33333333-3333-4333-8333-333333333333"
  await assert.rejects(q.enqueue(next, () => undefined, fresh, () => scope, auth), /new-creation-ids/)
  next.request.slotIds = ["new-review-one", "new-review-two"]
  await q.enqueue(next, () => undefined, fresh, () => scope, auth)
  const saved = await q.read()
  assert.deepEqual(saved.creationDiscards![0], { intent, proof, resolution: "discarded" })
  assert.deepEqual(saved.pending[0].intent, next); assert.equal(saved.receipts.length, 0)
})

test("custom creation uses the same exact command, targets and identity without acquiring copies", async () => {
  const snapshot = await complete()
  const draft = parseBinderCreationDraft({ version: 1, operationId: context.operationId, ownerUserId: scope.ownerUserId, name: "Box", kind: "custom", location: "Private shelf", manifest: speciesPreset("Selected", [143]) })
  const intent = prepareBinderCreation(draft, snapshot, context, newId, ["slot-one"])
  assert.equal(intent.request.kind, "custom"); assert.equal(intent.request.defaultPresentation, "list")
  assert.equal(intent.request.location, "Private shelf"); assert.equal(intent.request.grid, null)
  assert.deepEqual(intent.request.manifest, draft.manifest)
  assert.deepEqual(projectSlotIntent(snapshot, intent, () => undefined), snapshot)
  const q = createSlotOfflineQueue(createMemoryStore(), scope)
  await q.saveSnapshot(snapshot); await q.enqueue(intent, () => undefined, snapshot)
  assert.deepEqual((await q.read()).pending[0].intent, intent)
})
