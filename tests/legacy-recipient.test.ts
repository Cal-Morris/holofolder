import { test } from "node:test"
import assert from "node:assert/strict"
import { queuePendingCollectionOperation, readPendingCollectionOperations, readLegacyQueueSources, removePendingCollectionOperation, rebasePendingCollectionOperation, replacePendingCollectionOperation, prepareLegacyQueueReview, acceptLegacyQueueReview, LOCAL_COLLECTION_PENDING_OPS_KEY, writePendingCollectionOperations, pauseReviewedCollectionBatch, restorePendingCollectionOperations } from "../lib/collection/offline-queue"
import { legacyReviewEntries } from "../lib/collection/legacy-review"
import { sourceDigest } from "../lib/collection/legacy-source"
import { sameCollectionOrigin } from "../lib/collection/recipient"
import { classifyWriteFailure } from "../lib/collection/sync"
import { CollectionWriteError, saveRemoteCollectionItem, deleteRemoteCollectionItem } from "../lib/collection/remote"
import type { CollectedPokemon } from "../lib/domain/cards"

// Synthetic fixtures, no real collection data.
const a = { kind: "account" as const, actorUserId: "a", ownerUserId: "owner-a", binderId: "binder-a" }
const b = { ...a, actorUserId: "b", ownerUserId: "owner-b" }
const item: CollectedPokemon = { id: "synthetic-row", pokemon_id: 25, pokemon_name: "Synthetic Pikachu", status: "collected", wanted_cards: [], collected_at: "2026-11-10", card_language: "en", card_finish: "normal" }
function withQueue(run: (storage: Storage, fail: () => void) => void) {
  const previous = globalThis.window
  const map = new Map<string, string>(); let fail = false
  const storage = { clear: () => map.clear(), getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { if (fail) throw Error("full"); map.set(key, value) }, removeItem: (key: string) => map.delete(key), key: (i: number) => [...map.keys()][i], get length() { return map.size } } as Storage
  Object.assign(globalThis, { window: { localStorage: storage, dispatchEvent() {} } })
  try { run(storage, () => { fail = true }) } finally { if (previous) Object.assign(globalThis, { window: previous }); else Reflect.deleteProperty(globalThis, "window") }
}
test("full origins isolate coalescing, rebase and settlement across account/owner/default changes", () => withQueue(() => {
  const first = queuePendingCollectionOperation({ origin: a, binderId: a.binderId, type: "upsert", pokemonId: 25, item, base: null })
  const original = first.original!.raw
  queuePendingCollectionOperation({ origin: b, binderId: b.binderId, type: "delete", pokemonId: 25, base: item })
  queuePendingCollectionOperation({ origin: { ...a, binderId: "new-default" }, binderId: "new-default", type: "delete", pokemonId: 25 })
  queuePendingCollectionOperation({ origin: a, binderId: a.binderId, type: "upsert", pokemonId: 25, item: { ...item, status: "finalized" }, base: item })
  const ops = readPendingCollectionOperations()
  assert.equal(ops.length, 3)
  const edited = ops.find(op => op.id === first.id)!
  assert.equal(edited.original!.raw, original); assert.equal(edited.base, null)
  rebasePendingCollectionOperation(25, item, a.binderId, a)
  assert.deepEqual(readPendingCollectionOperations().find(op => sameCollectionOrigin(op.origin, b))!.base, item)
  removePendingCollectionOperation(first.id)
  assert.equal(readPendingCollectionOperations().length, 2)
  assert.equal(sameCollectionOrigin(a, { ...a, actorUserId: "other" }), false)
}))
test("unknown sent requests keep their ID/base/acquisition/original and cannot be coalesced", () => withQueue(() => {
  const first = queuePendingCollectionOperation({ origin: a, binderId: a.binderId, type: "upsert", pokemonId: 25, item, base: null })
  replacePendingCollectionOperation(first.id, { ...first, deliveryUnknown: true })
  queuePendingCollectionOperation({ origin: a, binderId: a.binderId, type: "delete", pokemonId: 25, base: item })
  assert.equal(readPendingCollectionOperations().length, 2)
  assert.equal(readPendingCollectionOperations()[0].id, first.id)
  assert.equal(readPendingCollectionOperations()[0].original!.raw, first.original!.raw)
}))
for (const raw of [" { invalid JSON ", JSON.stringify([null, { id: "duplicate", type: "future", pokemonId: 25 }, { id: "duplicate", type: "delete", pokemonId: 25, base: null }, { type: "delete" }], null, 3)]) {
  test("unrelated enqueue/ACK preserves exact opaque/mixed historical bytes", () => withQueue(storage => {
    storage.setItem(LOCAL_COLLECTION_PENDING_OPS_KEY, raw)
    assert.deepEqual(readPendingCollectionOperations(), [])
    const edit = queuePendingCollectionOperation({ origin: a, binderId: a.binderId, type: "delete", pokemonId: 1, base: null })
    removePendingCollectionOperation(edit.id)
    writePendingCollectionOperations(readPendingCollectionOperations())
    assert.equal(readLegacyQueueSources()[0].legacyQueueSource.raw, raw)
    assert.equal(readLegacyQueueSources()[0].legacyQueueSource.digest, sourceDigest(raw))
    assert.ok(legacyReviewEntries(readLegacyQueueSources()).every(entry => entry.unresolved))
  }))
}
test("guest review acceptance is atomic with evidence and links a NEW action to its source; cancel/reload has no upload", () => withQueue(storage => {
  const guest = queuePendingCollectionOperation({ origin: { kind: "guest", workspaceId: "stable-workspace", localBinderId: "guest-default" }, type: "upsert", pokemonId: 25, item, base: null })
  const raw = storage.getItem(LOCAL_COLLECTION_PENDING_OPS_KEY)!
  const sources = prepareLegacyQueueReview(), entries = legacyReviewEntries(sources)
  assert.equal(entries.length, 1); assert.equal(entries[0].unresolved, undefined)
  assert.equal(readPendingCollectionOperations().length, 0)
  assert.equal(sources[0].legacyQueueSource.raw, raw)
  const expected = storage.getItem(LOCAL_COLLECTION_PENDING_OPS_KEY)!
  assert.throws(() => acceptLegacyQueueReview("stale-review", sources, []))
  assert.equal(storage.getItem(LOCAL_COLLECTION_PENDING_OPS_KEY), expected)
  acceptLegacyQueueReview(expected, [{ legacyQueueSource: { ...sources[0].legacyQueueSource, accepted: [0] } }], [{ origin: a, binderId: a.binderId, type: "upsert", pokemonId: 25, item, base: null, recoverySource: { digest: sources[0].legacyQueueSource.digest, ordinal: 0, reviewEpoch: "review-1" } }])
  const recovered = readPendingCollectionOperations()[0]
  assert.notEqual(recovered.id, guest.id); assert.deepEqual(recovered.origin, a)
  assert.equal(readLegacyQueueSources()[0].legacyQueueSource.raw, raw)
  assert.equal(legacyReviewEntries(readLegacyQueueSources()).length, 0)
}))
test("acceptance storage failure cannot mark evidence accepted or queue a partially accepted batch", () => withQueue((storage, fail) => {
  storage.setItem(LOCAL_COLLECTION_PENDING_OPS_KEY, JSON.stringify([{ id: "old", type: "delete", pokemonId: 25, queuedAt: "original", base: null }]))
  const sources = prepareLegacyQueueReview(), expected = storage.getItem(LOCAL_COLLECTION_PENDING_OPS_KEY)!
  fail()
  assert.throws(() => acceptLegacyQueueReview(expected, [{ legacyQueueSource: { ...sources[0].legacyQueueSource, accepted: [0] } }], [{ origin: a, binderId: a.binderId, type: "delete", pokemonId: 25, base: null, recoverySource: { digest: sources[0].legacyQueueSource.digest, ordinal: 0, reviewEpoch: "review-1" } }]))
  assert.equal(storage.getItem(LOCAL_COLLECTION_PENDING_OPS_KEY), expected)
  assert.equal(legacyReviewEntries(readLegacyQueueSources()).length, 1)
}))
test("unknown fields, duplicate wants/IDs, acquisition and absent bases stay visibly unresolved", () => {
  const want = { card_id: "synthetic", card_name: "Synthetic", added_at: "original" }
  for (const extra of [{ item: { ...item, wanted_cards: [want, want] } }, { item: { ...item, future: true } }, { item: { ...item, wanted_cards: [{ ...want, wanted_by: ["old-actor"] }] } }, { acquisition: { operationId: "preserve" } }, { base: undefined }]) {
    const raw = JSON.stringify([{ id: "old", type: "upsert", pokemonId: 25, item, base: null, queuedAt: "original", ...extra }])
    const entries = legacyReviewEntries([{ legacyQueueSource: { version: 1, raw, digest: sourceDigest(raw) } }])
    assert.ok(entries[0].unresolved)
  }
})
test("retention codes win over generic 409/hard errors; unreadable 2xx is an unknown request", async () => {
  for (const status of [400, 404, 409, 503]) for (const code of ["collection_recipient_required", "collection_recipient_changed", "collection_recipient_inaccessible"])
    assert.equal(classifyWriteFailure(new CollectionWriteError("retained", status, null, code)), "recipient")
  const previous = globalThis.fetch
  try {
    globalThis.fetch = (async () => new Response("unreadable", { status: 200 })) as typeof fetch
    await assert.rejects(saveRemoteCollectionItem(item), error => error instanceof CollectionWriteError && error.status === null)
    await assert.rejects(deleteRemoteCollectionItem(25), error => error instanceof CollectionWriteError && error.status === null)
    globalThis.fetch = (async () => Response.json({ item: {} })) as typeof fetch
    await assert.rejects(saveRemoteCollectionItem(item), error => error instanceof CollectionWriteError && error.status === null)
  } finally { globalThis.fetch = previous }
})


test("delivery patches cannot alter origin, operation identity, original bytes or unknown request bases", () => withQueue(() => {
  const op = queuePendingCollectionOperation({ origin: a, binderId: a.binderId, type: "upsert", pokemonId: 25, item, base: null })
  replacePendingCollectionOperation(op.id, { ...op, id: "retargeted", origin: b, binderId: "new-default", original: { raw: "rewritten" }, deliveryUnknown: true })
  const retained = readPendingCollectionOperations()[0]
  assert.equal(retained.id, op.id); assert.deepEqual(retained.origin, a); assert.deepEqual(retained.original, op.original); assert.equal(retained.binderId, a.binderId)
  rebasePendingCollectionOperation(25, item, a.binderId, a)
  assert.equal(readPendingCollectionOperations()[0].base, null)
}))
test("acceptance refuses unresolved records or rewritten projections and leaves evidence untouched", () => withQueue(storage => {
  storage.setItem(LOCAL_COLLECTION_PENDING_OPS_KEY, JSON.stringify([{ id: "old", type: "upsert", pokemonId: 25, item, queuedAt: "original", base: null }]))
  const sources = prepareLegacyQueueReview(), expected = storage.getItem(LOCAL_COLLECTION_PENDING_OPS_KEY)!
  const accepted = [{ legacyQueueSource: { ...sources[0].legacyQueueSource, accepted: [0] } }]
  assert.throws(() => acceptLegacyQueueReview(expected, accepted, [{ origin: a, binderId: a.binderId, type: "upsert", pokemonId: 25, item: { ...item, card_id: "unreviewed" }, base: null, recoverySource: { digest: sources[0].legacyQueueSource.digest, ordinal: 0, reviewEpoch: "review-1" } }]))
  assert.equal(storage.getItem(LOCAL_COLLECTION_PENDING_OPS_KEY), expected)
}))


test("future bound records and malformed evidence metadata are retained; other-account intent stays hidden", () => withQueue(storage => {
  const raw = JSON.stringify([{ intentProtocol: 1, origin: a, binderId: a.binderId, id: "future", type: "upsert", pokemonId: 25, queuedAt: "original", item: { ...item, future: true }, base: null }, { legacyQueueSource: { version: 1, raw: "[]", digest: sourceDigest("[]"), accepted: 7 } }], null, 2)
  storage.setItem(LOCAL_COLLECTION_PENDING_OPS_KEY, raw)
  assert.deepEqual(readPendingCollectionOperations(), [])
  const op = queuePendingCollectionOperation({ origin: b, binderId: b.binderId, type: "delete", pokemonId: 1, base: null })
  removePendingCollectionOperation(op.id)
  const sources = readLegacyQueueSources()
  assert.equal(sources[0].legacyQueueSource.raw, raw)
  assert.equal(legacyReviewEntries(sources, [], a.actorUserId).length, 2)
  assert.equal(legacyReviewEntries(sources, [], b.actorUserId).length, 1)
}))
test("a failed reviewed batch pauses only its exact origin and review epoch", () => withQueue(() => {
  const failed = queuePendingCollectionOperation({ origin: a, binderId: a.binderId, type: "delete", pokemonId: 25, base: null, recoverySource: { digest: "source", ordinal: 0, reviewEpoch: "review-3" } })
  queuePendingCollectionOperation({ origin: a, binderId: a.binderId, type: "delete", pokemonId: 7, base: null, recoverySource: { digest: "source", ordinal: 1, reviewEpoch: "review-3" } })
  queuePendingCollectionOperation({ origin: b, binderId: b.binderId, type: "delete", pokemonId: 1, base: null, recoverySource: { digest: "source", ordinal: 2, reviewEpoch: "review-3" } })
  pauseReviewedCollectionBatch(failed.id, "delivery_unknown")
  assert.equal(readPendingCollectionOperations().find(op => op.pokemonId === 7)!.recipientPause, "review_batch_paused")
  assert.equal(readPendingCollectionOperations().find(op => op.pokemonId === 1)!.recipientPause, undefined)
}))
test("the existing IndexedDB mirror and absent-key restore retain raw evidence with the same bound request", async () => {
  const { createMemoryStore } = await import("../lib/offline-store/kv")
  const { flushCollectionMirror } = await import("../lib/offline-store/collection-mirror")
  const { loadCollectionRecord } = await import("../lib/offline-store/records")
  const raw = "  [ null, {\"future\":true} ]\n"
  let operationId = ""
  withQueue(storage => {
    storage.setItem(LOCAL_COLLECTION_PENDING_OPS_KEY, raw)
    operationId = queuePendingCollectionOperation({ origin: a, binderId: a.binderId, type: "delete", pokemonId: 25, base: null }).id
  })
  const store = createMemoryStore()
  await flushCollectionMirror(store)
  const record = await loadCollectionRecord(store)
  withQueue(() => {
    assert.equal(restorePendingCollectionOperations(record!.pendingOperations), 1)
    assert.equal(readLegacyQueueSources()[0].legacyQueueSource.raw, raw)
    assert.equal(readPendingCollectionOperations()[0].id, operationId)
  })
})
