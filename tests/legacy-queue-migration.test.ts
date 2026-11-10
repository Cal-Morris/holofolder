import { test } from "node:test"
import assert from "node:assert/strict"
import { createMemoryStore } from "@/lib/offline-store/kv"
import { createLegacyQueueRuntime } from "@/lib/collection/legacy-queue-runtime"
import { LEGACY_QUEUE_KEY } from "@/lib/collection/legacy-queue-record"
import { mirrorDurableCollectionSnapshot } from "@/lib/offline-store/collection-mirror"
import { migrateLocalStorageToOfflineStore, MIGRATION_RECORD_KEY } from "@/lib/offline-store/records"
const origin = { kind: "account" as const, actorUserId: "synthetic", ownerUserId: "synthetic", binderId: "binder" }
const old = { id: "original", type: "delete", pokemonId: 1, base: null, queuedAt: "synthetic" }
for (const raw of [null, "[]", " [] \n", "invalid {", '{"future":true}', JSON.stringify([old])]) {
  test(`hydration ignores snapshot/old migration marker, preserves exact source ${raw}`, async () => {
    const mirror = { ownerUserId: origin.ownerUserId, collection: [], pendingOperations: [old, { ...old, future: true }] }
    const store = createMemoryStore({ collection: mirror, [MIGRATION_RECORD_KEY]: { at: "already" } })
    const runtime = createLegacyQueueRuntime(store, () => ({ session: "one", origin }))
    const storage = { getItem: () => raw }
    await runtime.initialize(storage); await runtime.refresh()
    const envelope = await store.get<{ sources: { raw: string | null; retainedValue?: unknown }[]; entries: { state: string }[] }>(LEGACY_QUEUE_KEY)
    assert.equal(envelope!.sources[0].raw, raw)
    assert.deepEqual(envelope!.sources[1].retainedValue, mirror)
    assert.equal(envelope!.entries.every(entry => entry.state === "paused"), true)
    assert.deepEqual(await store.get("collection"), mirror)
    assert.equal(storage.getItem(), raw)
  })
}
test("old [] and late mirror variants add evidence without replacing durable edits", async () => {
  const store = createMemoryStore()
  const runtime = createLegacyQueueRuntime(store, () => ({ session: "one", origin }))
  await runtime.initialize({ getItem: () => null }); await runtime.refresh()
  await runtime.enqueue({ type: "delete", pokemonId: 2, origin, binderId: origin.binderId, base: null })
  const edit = runtime.view()!.entries[0]
  for (const pendingOperations of [[], [old], [{ ...old, type: "unknown" }], { malformed: true }]) {
    await store.set("collection", { pendingOperations })
    await runtime.observe({ getItem: () => "[]" }, ["earlier original bytes", "[]"])
    assert.deepEqual(runtime.view()!.entries.find(entry => entry.entryId === edit.entryId), edit)
  }
})
test("snapshot-only writers preserve malformed and future old evidence exactly", async () => {
  for (const existing of [{ pendingOperations: { malformed: true }, future: "keep" }, [old], "unknown-mirror"]) {
    const store = createMemoryStore({ collection: existing })
    await mirrorDurableCollectionSnapshot({ collection: [], ownerUserId: origin.ownerUserId, savedAt: "synthetic" }, true, store)
    const next = await store.get("collection")
    if (Array.isArray(existing) || typeof existing === "string") assert.deepEqual(next, existing)
    else assert.deepEqual((next as typeof existing).pendingOperations, existing.pendingOperations)
  }
})
test("staged snapshot migration never copies queue or creates an empty-array tombstone", async () => {
  const store = createMemoryStore(), reads: string[] = []
  await migrateLocalStorageToOfflineStore({ getItem(key) { reads.push(key); return JSON.stringify({ collection: [], ownerUserId: origin.ownerUserId }) } }, store, { snapshot: "snapshot" })
  assert.deepEqual(reads, ["snapshot"])
  assert.equal(Object.hasOwn((await store.get("collection"))!, "pendingOperations"), false)
})
test("snapshot writes cannot overwrite any part of a late malformed mirror variant", async () => {
  const original = { ownerUserId: "original-owner", collection: [{ original: "unparsed-snapshot" }], pendingOperations: { malformed: "keep complete original" }, future: "preserve" }
  const store = createMemoryStore({ collection: original })
  await mirrorDurableCollectionSnapshot({ ownerUserId: origin.ownerUserId, collection: [], savedAt: "new-snapshot" }, true, store)
  assert.deepEqual(await store.get("collection"), original)
})
