import { test } from "node:test"
import assert from "node:assert/strict"
import { createLegacyQueue } from "../lib/collection/legacy-queue-store"
import { LEGACY_QUEUE_KEY } from "../lib/collection/legacy-queue-record"
import { createMemoryStore } from "../lib/offline-store/kv"

const origin = { kind: "account" as const, actorUserId: "actor", ownerUserId: "owner", binderId: "binder" }
const input = (pokemonId: number) => ({ type: "delete" as const, pokemonId, origin, binderId: origin.binderId, base: null })
const storage = { getItem: () => null }
async function setup() {
  const store = createMemoryStore()
  let session = "session"
  const queue = createLegacyQueue(store, () => ({ session, origin }))
  await queue.initialize(storage)
  return { store, queue, switchSession: () => { session = "other" } }
}

test("disjoint appends survive, stale same-slot edit rejects", async () => {
  const { queue } = await setup(), token = (await queue.read(origin)).token
  await Promise.all([queue.enqueue(input(1), { epoch: token.epoch, entryRevision: null }), queue.enqueue(input(2), { epoch: token.epoch, entryRevision: null })])
  assert.equal((await queue.read(origin)).entries.length, 2)
  await assert.rejects(queue.enqueue(input(1), { epoch: token.epoch, entryRevision: null }), /queue_changed/)
})

test("competing claims serialize and expired sending becomes unknown, never replayable", async () => {
  const { queue } = await setup(), token = (await queue.read(origin)).token
  await queue.enqueue(input(1), { epoch: token.epoch, entryRevision: null })
  const claims = await Promise.all([queue.claim(origin, "session", "one", 0), queue.claim(origin, "session", "two", 0)])
  assert.equal(claims.filter(Boolean).length, 1)
  const before = (await queue.read(origin)).entries[0]
  await queue.enqueue(input(1), { epoch: token.epoch, entryRevision: before.revision })
  assert.equal(await queue.claim(origin, "session", "three", 60001), null)
  const entries = (await queue.read(origin)).entries
  assert.equal(entries[0].state, "unknown")
  assert.deepEqual(entries[0].request, before.request)
  assert.equal(entries[1].state, "ready")
})

test("session and request token fence settlement; local completion retains evidence", async () => {
  const { queue, switchSession } = await setup(), token = (await queue.read(origin)).token
  await queue.enqueue(input(1), { epoch: token.epoch, entryRevision: null })
  const claim = (await queue.claim(origin, "session", "one", 0))!
  assert.equal(await queue.settle({ ...claim, token: "wrong" }, { kind: "acknowledged", item: null }), false)
  switchSession()
  assert.equal(await queue.settle(claim, { kind: "acknowledged", item: null }), false)
  assert.equal((await queue.read(origin)).entries[0].state, "sending")
})

test("future envelope fails closed without overwriting", async () => {
  const { store, queue } = await setup()
  const future = { version: 3, retained: "evidence" }
  await store.set(LEGACY_QUEUE_KEY, future)
  await assert.rejects(queue.initialize(storage), /unsupported_legacy_queue/)
  await assert.rejects(queue.read(origin), /unsupported_legacy_queue/)
  assert.deepEqual(await store.get(LEGACY_QUEUE_KEY), future)
})

test("coalescing retains first base presence, ID, original and amendment evidence", async () => {
  const { queue } = await setup(), token = (await queue.read(origin)).token
  const first = await queue.enqueue({ type: "delete", pokemonId: 1, origin, binderId: "binder" }, { epoch: token.epoch, entryRevision: null })
  const entry = (await queue.read(origin)).entries[0]
  const next = await queue.enqueue(input(1), { epoch: token.epoch, entryRevision: entry.revision })
  assert.equal(next.id, first.id)
  assert.equal(Object.hasOwn(next, "base"), false)
  assert.deepEqual(next.original, first.original)
  assert.equal(next.amendments?.length, 1)
  assert.equal((await queue.read(origin)).entries.length, 1)
})

test("exact source strings, duplicate IDs and structured mirror survive initialization and old overwrites", async () => {
  const store = createMemoryStore(), queue = createLegacyQueue(store, () => ({ session: "session", origin }))
  const op = { ...input(1), id: "duplicate", queuedAt: "synthetic" }
  const raw = ` [ ${JSON.stringify(op)}, ${JSON.stringify(op)} ] `, mirror = { pendingOperations: [op], malformed: { preserved: true } }
  await store.set("collection", mirror)
  await queue.initialize({ getItem: () => raw })
  const initial = await queue.read(origin)
  assert.equal(initial.sources[0].raw, raw)
  assert.deepEqual(initial.sources[1].retainedValue, mirror)
  assert.equal(initial.entries.length, 3)
  assert.equal(new Set(initial.entries.map(e => e.entryId)).size, 3)
  assert.ok(initial.entries.every(e => e.state === "paused"))
  await store.set("collection", { pendingOperations: [] })
  await queue.observeOldSource({ kind: "local-storage", raw: "[]" })
  const after = await queue.read(origin)
  assert.deepEqual(after.entries, initial.entries)
  assert.equal(after.sources[0].raw, raw)
  await queue.observeOldSource({ kind: "local-storage", raw })
  assert.equal((await queue.read(origin)).sources.length, 3)
})

const historical = { id: "guest-original", type: "delete", pokemonId: 7, queuedAt: "synthetic", base: null }
async function reviewSetup() {
  const { store, queue, switchSession } = await setup()
  await queue.observeOldSource({ kind: "local-storage", raw: ` [${JSON.stringify(historical)}] ` })
  const view = await queue.read(origin), source = view.sources.find(s => s.raw?.includes("guest-original"))!
  const token = await queue.prepareReview(origin)
  const selections = [{ sourceId: source.sourceId, ordinal: 0, input: input(7) }]
  return { store, queue, switchSession, view, source, token, selections }
}

test("acceptance and new action commit together, exact source reobservation cannot reopen acceptance", async () => {
  const { queue, view, source, token, selections } = await reviewSetup()
  await queue.acceptReview(token, view.sources, selections)
  const after = await queue.read(origin)
  assert.deepEqual(after.sources.find(s => s.sourceId === source.sourceId)!.accepted, [0])
  assert.equal(after.entries.filter(e => e.state === "ready").length, 1)
  await queue.observeOldSource({ kind: "local-storage", raw: source.raw })
  assert.equal((await queue.read(origin)).token.revision, after.token.revision)
  await assert.rejects(queue.acceptReview(token, view.sources, selections), /queue_changed/)
})

test("stale review, same-slot and session settlement never change retained state", async () => {
  const { queue, view, token, selections, switchSession } = await reviewSetup()
  await queue.enqueue(input(9), { epoch: token.epoch, entryRevision: null })
  await assert.rejects(queue.acceptReview(token, view.sources, selections), /queue_changed/)
  const before = await queue.read(origin)
  const fresh = await queue.prepareReview(origin)
  switchSession()
  await assert.rejects(queue.acceptReview(fresh, before.sources, selections), /queue_changed/)
  assert.deepEqual((await queue.read(origin)).sources, before.sources)
})

test("failed storage never reports acceptance, queueing or completion", async () => {
  const { store, queue } = await setup()
  const before = await store.get(LEGACY_QUEUE_KEY), token = (await queue.read(origin)).token
  const broken = createLegacyQueue({ ...store, update: async () => { throw new Error("synthetic_quota") } }, () => ({ session: "session", origin }))
  await assert.rejects(broken.enqueue(input(1), { epoch: token.epoch, entryRevision: null }), /synthetic_quota/)
  assert.deepEqual(await store.get(LEGACY_QUEUE_KEY), before)
  const badClone = { ...input(1), unsupported: () => undefined }
  await assert.rejects(queue.enqueue(badClone, { epoch: token.epoch, entryRevision: null }))
  assert.deepEqual(await store.get(LEGACY_QUEUE_KEY), before)
})

test("unknown cannot be rewritten or settled by later 409; completed request evidence survives", async () => {
  const { queue } = await setup(), { epoch } = (await queue.read(origin)).token
  await queue.enqueue(input(1), { epoch, entryRevision: null })
  const claim = (await queue.claim(origin, "session", "one", 0))!
  assert.equal(await queue.settle(claim, { kind: "unknown", code: "reply_lost" }), true)
  const unknown = (await queue.read(origin)).entries[0]
  await queue.enqueue(input(1), { epoch, entryRevision: unknown.revision })
  assert.equal(await queue.settle(claim, { kind: "known-rejection", category: "conflict", code: "row_conflict" }), false)
  assert.equal(await queue.claim(origin, "session", "two", 90000), null)
  assert.deepEqual((await queue.read(origin)).entries[0], unknown)
  await queue.enqueue(input(2), { epoch, entryRevision: null })
  const other = (await queue.claim(origin, "session", "two", 90001))!
  await queue.settle(other, { kind: "acknowledged", item: null, activityEventId: "synthetic-event" })
  const completed = (await queue.read(origin)).entries.find(e => e.entryId === other.entryId)!
  assert.equal(completed.state, "completed")
  assert.deepEqual(completed.request, other.request)
  assert.deepEqual(completed.settlement, { kind: "acknowledged", item: null, activityEventId: "synthetic-event" })
})

test("malformed envelope and future fields stay intact; unbound drafts are evidence only", async () => {
  const { store, queue } = await setup(), { epoch } = (await queue.read(origin)).token
  await queue.enqueue({ type: "delete", pokemonId: 2 }, { epoch, entryRevision: null })
  const before = await store.get<Record<string, unknown>>(LEGACY_QUEUE_KEY)
  const malformed = { ...before, extraFutureField: true }
  await store.set(LEGACY_QUEUE_KEY, malformed)
  await assert.rejects(queue.observeOldSource({ kind: "local-storage", raw: "bad" }), /unsupported_legacy_queue/)
  assert.deepEqual(await store.get(LEGACY_QUEUE_KEY), malformed)
  assert.equal((before!.entries as { state: string }[])[0].state, "paused")
})

test("atomic initialization primitive rolls back all writes on transform, scope or clone failure", async () => {
  const store = createMemoryStore({ a: 1, b: 2 })
  await assert.rejects(store.updateMany(["a", "b"], () => ({ writes: [["a", 3], ["b", () => undefined]], result: true })))
  await assert.rejects(store.updateMany(["a"], () => ({ writes: [["b", 3]], result: true })), /outside named/)
  await assert.rejects(store.updateMany(["a"], () => { throw new Error("synthetic_abort") }), /synthetic_abort/)
  assert.deepEqual(await store.getMany(["a", "b"]), [1, 2])
  const result = await store.updateMany(["a", "b"], values => ({ writes: [["a", Number(values.a) + Number(values.b)]], result: { committed: true } }))
  assert.deepEqual(result, { committed: true })
  assert.deepEqual(await store.getMany(["a", "b"]), [3, 2])
})

test("nested acceptance, duplicate copies, malformed data and foreign scope fail closed", async () => {
  const { queue } = await setup()
  const nestedRaw = JSON.stringify([historical])
  const { sourceDigest } = await import("../lib/collection/legacy-source")
  const wrapper = { legacyQueueSource: { version: 1, raw: nestedRaw, digest: sourceDigest(nestedRaw), accepted: [0] } }
  await queue.observeOldSource({ kind: "local-storage", raw: JSON.stringify([wrapper, historical]) })
  const view = await queue.read(origin), token = await queue.prepareReview(origin)
  const source = view.sources.find(s => s.raw?.includes("legacyQueueSource"))!
  await assert.rejects(queue.acceptReview(token, view.sources, [{ sourceId: source.sourceId, ordinal: 1, input: input(7) }]), /nested_source_reconciliation_required/)
  assert.deepEqual((await queue.read(origin)).sources, view.sources)
  await queue.observeOldSource({ kind: "local-storage", raw: "{malformed exact original" })
  assert.ok((await queue.read(origin)).sources.some(s => s.raw === "{malformed exact original"))
  await assert.rejects(queue.read({ ...origin, actorUserId: "foreign" }), /queue_session_changed/)
  const foreign = { ...historical, origin: { ...origin, actorUserId: "foreign" } }
  await queue.observeOldSource({ kind: "local-storage", raw: JSON.stringify([foreign]) })
  assert.equal((await queue.read(origin)).sources.some(s => s.raw === JSON.stringify([foreign])), false)
})

test("storage equality does not erase sparse-array length or object alias evidence", async () => {
  const { sameLegacyValue } = await import("../lib/collection/legacy-queue-record")
  assert.equal(sameLegacyValue([], Array(2)), false)
  const shared = {}
  assert.equal(sameLegacyValue({ a: {}, b: {} }, { a: shared, b: shared }), false)
  assert.equal(sameLegacyValue({ a: shared, b: shared }, { a: {}, b: {} }), false)
})

test("review rejection atomically pauses its unsent batch and preserves frozen request", async () => {
  const { queue } = await setup()
  const raw = JSON.stringify([historical, { ...historical, id: "guest-second", pokemonId: 8 }])
  await queue.observeOldSource({ kind: "local-storage", raw })
  const view = await queue.read(origin), token = await queue.prepareReview(origin), source = view.sources.find(s => s.raw === raw)!
  await queue.acceptReview(token, view.sources, [{ sourceId: source.sourceId, ordinal: 0, input: input(7) }, { sourceId: source.sourceId, ordinal: 1, input: input(8) }])
  const claim = (await queue.claim(origin, "session", "one", 0))!
  await queue.settle(claim, { kind: "known-rejection", category: "recipient", code: "collection_recipient_changed" })
  const entries = (await queue.read(origin)).entries, paused = entries[0]
  assert.equal(paused.state, "paused")
  assert.equal(entries[1].state, "paused")
  assert.equal(entries[1].reason, "review_batch_paused")
  assert.deepEqual(paused.request, claim.request)
  assert.deepEqual(paused.rejectedRequests, [{ request: claim.request, code: "collection_recipient_changed" }])
  assert.equal(await queue.claim(origin, "session", "two", 90000), null)
})

test("divergent same-slot sources and changed exact review bytes cannot authorize acceptance", async () => {
  const { queue, view, source, token, selections } = await reviewSetup()
  const changed = structuredClone(view.sources)
  changed.find(s => s.sourceId === source.sourceId)!.raw += " "
  await assert.rejects(queue.acceptReview(token, changed, selections), /queue_changed/)
  await queue.observeOldSource({ kind: "collection-mirror", retainedValue: { pendingOperations: [{ ...historical, id: "different-original-id" }] } })
  const fresh = await queue.read(origin), freshToken = await queue.prepareReview(origin)
  await assert.rejects(queue.acceptReview(freshToken, fresh.sources, selections), /source_review_unresolved/)
  assert.ok((await queue.read(origin)).sources.every(s => s.accepted.length === 0))
})

test("initialization storage failure retains old values and never activates an envelope", async () => {
  const store = createMemoryStore({ collection: { pendingOperations: [historical] } })
  const raw = ` ${JSON.stringify([historical])} `
  const queue = createLegacyQueue({ ...store, updateMany: async () => { throw new Error("synthetic_open_failure") } }, () => null)
  await assert.rejects(queue.initialize({ getItem: () => raw }), /synthetic_open_failure/)
  assert.equal(await store.get(LEGACY_QUEUE_KEY), undefined)
  assert.deepEqual(await store.get("collection"), { pendingOperations: [historical] })
})

test("future source origin stays exact evidence and cannot be reviewed into a new recipient", async () => {
  const { queue } = await setup()
  const raw = JSON.stringify([{ ...historical, origin: { kind: "future", workspaceId: "unknown" } }])
  await queue.observeOldSource({ kind: "local-storage", raw })
  const view = await queue.read(origin), token = await queue.prepareReview(origin), source = view.sources.find(s => s.raw === raw)!
  await assert.rejects(queue.acceptReview(token, view.sources, [{ sourceId: source.sourceId, ordinal: 0, input: input(7) }]), /source_review_unresolved/)
  assert.equal((await queue.read(origin)).sources.find(s => s.sourceId === source.sourceId)!.raw, raw)
})
