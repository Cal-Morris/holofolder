import { test } from "node:test"
import assert from "node:assert/strict"
import { createMemoryStore } from "@/lib/offline-store/kv"
import { createLegacyQueue } from "@/lib/collection/legacy-queue-store"
import { createLegacyQueueRuntime } from "@/lib/collection/legacy-queue-runtime"
import { LEGACY_QUEUE_KEY } from "@/lib/collection/legacy-queue-record"
const origin = { kind: "account" as const, actorUserId: "synthetic-a", ownerUserId: "synthetic-a", binderId: "synthetic-binder" }
const storage = { getItem: () => " [] \n" }
test("guest workspace allocation commits once across callers and guest review never sends automatically", async () => {
  const store = createMemoryStore()
  const queue = createLegacyQueue(store, () => null)
  await queue.initialize(storage)
  const [a, b] = await Promise.all([queue.guestOrigin(null, null), queue.guestOrigin(null, null)])
  assert.deepEqual(a, b)
  assert.equal((await store.get<{ guestWorkspaceId: string }>(LEGACY_QUEUE_KEY))!.guestWorkspaceId, a.workspaceId)
})
test("runtime enqueue and claim commits precede transport, unknown never replays", async () => {
  const store = createMemoryStore()
  let calls = 0
  const runtime = createLegacyQueueRuntime(store, () => ({ session: "one", origin }), async () => {
    calls++
    const saved = await store.get<{ entries: { state: string }[] }>(LEGACY_QUEUE_KEY)
    assert.equal(saved!.entries[0].state, "sending")
    throw new Error("synthetic lost response")
  })
  await runtime.initialize(storage)
  await runtime.refresh()
  await runtime.enqueue({ type: "delete", pokemonId: 1, base: null, binderId: origin.binderId, origin })
  assert.equal(calls, 0)
  await runtime.flush()
  await runtime.flush()
  assert.equal(calls, 1)
  assert.equal(runtime.view()!.entries[0].state, "unknown")
})
test("failed enqueue transaction cannot publish or send a draft", async () => {
  const base = createMemoryStore()
  let abort = false, sends = 0
  const store = { ...base, update: async (...args: Parameters<typeof base.update>) => { if (abort) throw new Error("QuotaExceededError"); await base.update(...args) } }
  const runtime = createLegacyQueueRuntime(store, () => ({ session: "one", origin }), async () => { sends++; return new Response('{"success":true}') })
  await runtime.initialize(storage); await runtime.refresh(); abort = true
  await assert.rejects(runtime.enqueue({ type: "delete", pokemonId: 1, base: null, binderId: origin.binderId, origin }), /Quota/)
  assert.equal(runtime.view()!.entries.length, 0)
  assert.equal(sends, 0)
})

test("A to B to A and binder/partner changes cannot settle a suspended request", async () => {
  for (const replacement of [{ ...origin, actorUserId: "synthetic-b" }, { ...origin, ownerUserId: "partner-b" }, { ...origin, binderId: "binder-b" }]) {
    const store = createMemoryStore()
    let context = { session: "a-one", origin }
    let reply!: (response: Response) => void
    const runtime = createLegacyQueueRuntime(store, () => context, () => new Promise(resolve => { reply = resolve }))
    await runtime.initialize(storage); await runtime.refresh()
    await runtime.enqueue({ type: "delete", pokemonId: 1, base: null, binderId: origin.binderId, origin })
    const flush = runtime.flush()
    while (!reply) await Promise.resolve()
    context = { session: "b", origin: replacement }
    assert.equal(runtime.view(), null)
    context = { session: "a-two", origin }
    reply(new Response('{"success":true}'))
    await flush
    await runtime.refresh()
    assert.equal(runtime.view()!.entries[0].state, "sending")
    assert.equal(runtime.view()!.entries[0].settlement, null)
  }
})
test("ACK storage failure retains frozen request and cannot invoke committed callback", async () => {
  const base = createMemoryStore()
  let abort = false, callbacks = 0
  const store = { ...base, update: async (...args: Parameters<typeof base.update>) => { if (abort) throw new Error("synthetic ACK abort"); await base.update(...args) } }
  const runtime = createLegacyQueueRuntime(store, () => ({ session: "one", origin }), async () => { abort = true; return new Response('{"success":true}') })
  await runtime.initialize(storage); await runtime.refresh()
  await runtime.enqueue({ type: "delete", pokemonId: 1, base: null, binderId: origin.binderId, origin })
  await assert.rejects(runtime.flush(() => { callbacks++ }), /ACK abort/)
  assert.equal(callbacks, 0)
  const saved = await base.get<{ entries: { state: string; request: unknown; settlement: unknown }[] }>(LEGACY_QUEUE_KEY)
  assert.equal(saved!.entries[0].state, "sending")
  assert.ok(saved!.entries[0].request)
  assert.equal(saved!.entries[0].settlement, null)
})
test("explicit review to another binder uses the same claimed sender and preserves source acceptance", async () => {
  const store = createMemoryStore()
  const raw = JSON.stringify([{ id: "synthetic-historical", type: "delete", pokemonId: 25, base: null, queuedAt: "synthetic-time" }])
  let calls = 0
  const runtime = createLegacyQueueRuntime(store, () => ({ session: "one", origin }), async url => {
    calls++; assert.equal(new URL(String(url), "http://localhost").searchParams.get("binderId"), "review-binder")
    return new Response('{"success":true}')
  })
  await runtime.initialize({ getItem: () => raw }); await runtime.refresh()
  const recipient = { ...origin, binderId: "review-binder" }
  const review = await runtime.prepareReview(recipient)
  await runtime.acceptReview(review, [{ sourceId: review.sources[0].sourceId, ordinal: 0, input: { type: "delete", pokemonId: 25, base: null, origin: recipient, binderId: recipient.binderId } }])
  assert.equal(calls, 0)
  await runtime.flush()
  assert.equal(calls, 1)
  await runtime.observe({ getItem: () => raw }, ["[]"])
  await runtime.flush()
  assert.equal(calls, 1)
  assert.deepEqual(runtime.view()!.sources.find(source => source.raw === raw)!.accepted, [0])
})
test("guest work gets durable identity, remains explicit review evidence on login", async () => {
  const store = createMemoryStore()
  let context: { session: string; origin: import("@/lib/collection/recipient").CollectionOrigin } | null = null
  let sends = 0
  const runtime = createLegacyQueueRuntime(store, () => context, async () => { sends++; return new Response('{"success":true}') })
  await runtime.initialize({ getItem: () => null })
  const guest = await runtime.queue.guestOrigin(null, "existing-guest-workspace")
  context = { session: "guest", origin: guest }; await runtime.refresh()
  await runtime.enqueue({ type: "delete", pokemonId: 25, base: null, origin: guest })
  await runtime.flush(); assert.equal(sends, 0)
  context = { session: "account", origin }; await runtime.refresh(); await runtime.flush()
  assert.equal(sends, 0)
  const review = await runtime.prepareReview(origin)
  assert.equal(review.projections.filter(source => source.legacyQueueSource.raw.includes("existing-guest-workspace")).length, 1)
})
test("a foreign-account mirror snapshot is retained internally but excluded from downloads", async () => {
  const store = createMemoryStore({ collection: { ownerUserId: "foreign-owner", collection: [{ card_name: "PRIVATE_MIRROR" }], pendingOperations: [] } })
  const runtime = createLegacyQueueRuntime(store, () => ({ session: "one", origin }))
  await runtime.initialize({ getItem: () => null }); await runtime.refresh()
  assert.equal(JSON.stringify(runtime.view()).includes("PRIVATE_MIRROR"), false)
  assert.equal(JSON.stringify(await store.get(LEGACY_QUEUE_KEY)).includes("PRIVATE_MIRROR"), true)
})
test("transactional cancellation never rewrites the in-flight request or frozen unknown successor", async () => {
  const store = createMemoryStore()
  const raw = JSON.stringify([1, 2].map(pokemonId => ({ id: `guest-${pokemonId}`, type: "delete", pokemonId, base: null, queuedAt: "synthetic" })))
  const runtime = createLegacyQueueRuntime(store, () => ({ session: "one", origin }))
  await runtime.initialize({ getItem: () => raw }); await runtime.refresh()
  const review = await runtime.prepareReview(origin)
  await runtime.acceptReview(review, [1, 2].map((pokemonId, ordinal) => ({ sourceId: review.sources[0].sourceId, ordinal, input: { type: "delete", pokemonId, origin, binderId: origin.binderId, base: null } })))
  const claim = (await runtime.queue.claim(origin, "one", "first", 0))!
  await runtime.cancelReview(review)
  const saved = runtime.view()!.entries
  assert.deepEqual(saved.find(entry => entry.entryId === claim.entryId)!.request, claim.request)
  assert.equal(saved.find(entry => entry.operation.recoverySource && entry.operation.pokemonId === 2)!.reason, "cancelled_review_upload")
})
test("future envelope and blocked/open failure prevent runtime admission without overwriting sources", async () => {
  const store = createMemoryStore({ [LEGACY_QUEUE_KEY]: { version: 999, private: "future" } })
  const runtime = createLegacyQueueRuntime(store, () => ({ session: "one", origin }))
  await assert.rejects(runtime.initialize(storage), /unsupported_legacy_queue/)
  assert.deepEqual(await store.get(LEGACY_QUEUE_KEY), { version: 999, private: "future" })
  assert.equal(runtime.view(), null)
})
test("a committed enqueue survives a subsequent failed view read without becoming an unsaved second intent", async () => {
  const base = createMemoryStore()
  let failRead = false
  const store = { ...base, get: async <T = unknown>(key: string) => { if (failRead && key === LEGACY_QUEUE_KEY) throw new Error("synthetic read failure"); return base.get<T>(key) } }
  const runtime = createLegacyQueueRuntime(store, () => ({ session: "one", origin }))
  await runtime.initialize(storage); await runtime.refresh(); failRead = true
  const result = await runtime.enqueue({ type: "delete", pokemonId: 1, base: null, origin, binderId: origin.binderId })
  assert.equal(runtime.view(), null)
  const saved = await base.get<{ entries: { operation: { id: string } }[] }>(LEGACY_QUEUE_KEY)
  assert.equal(saved!.entries[0].operation.id, result.id)
  assert.equal(saved!.entries.length, 1)
})
for (const payload of [
  { code: "collection_queue_upgrade_required", retainOnDevice: true },
]) test(`recognized inactive-fence preparation response retains the exact frozen request: ${payload.code}`, async () => {
  const store = createMemoryStore()
  let sends = 0
  const runtime = createLegacyQueueRuntime(store, () => ({ session: "one", origin }), async () => { sends++; return new Response(JSON.stringify(payload), { status: 503 }) })
  await runtime.initialize(storage); await runtime.refresh()
  await runtime.enqueue({ type: "delete", pokemonId: 1, base: null, origin, binderId: origin.binderId })
  await runtime.flush(); await runtime.flush()
  const entry = runtime.view()!.entries[0]
  assert.equal(entry.state, "paused")
  assert.equal(entry.reason, "collection_queue_upgrade_required")
  assert.deepEqual(entry.rejectedRequests[0].request, entry.request)
  assert.equal(sends, 1)
})

test("new claims freeze the agreed private protocol header, historical unknown requests keep their original headers", async () => {
  const store = createMemoryStore()
  let capturedHeader: string | null = null, calls = 0
  const runtime = createLegacyQueueRuntime(store, () => ({ session: "one", origin }), async (_url, init) => {
    calls++; capturedHeader = new Headers(init?.headers).get("X-Holo-Legacy-Queue")
    return new Response("{}", { status: 503 })
  })
  await runtime.initialize(storage); await runtime.refresh()
  await runtime.enqueue({ type: "delete", pokemonId: 1, base: null, origin, binderId: origin.binderId })
  await runtime.flush()
  assert.equal(capturedHeader, "2")
  const historical = await store.get<import("@/lib/collection/legacy-queue-record").LegacyQueueEnvelope>(LEGACY_QUEUE_KEY)
  historical!.entries[0].request!.headers = {}
  await store.set(LEGACY_QUEUE_KEY, historical)
  await runtime.refresh(); await runtime.flush()
  assert.deepEqual(runtime.view()!.entries[0].request!.headers, {})
  assert.equal(calls, 1)
  assert.equal(runtime.view()!.entries[0].state, "unknown")
})
test("the existing remote failure classifier retains the agreed protocol upgrade code", async () => {
  const { classifyWriteFailure } = await import("@/lib/collection/sync")
  const { CollectionWriteError } = await import("@/lib/collection/remote")
  assert.equal(classifyWriteFailure(new CollectionWriteError("synthetic upgrade needed", 503, null, "collection_queue_upgrade_required")), "recipient")
})
test("an unmapped or incomplete SQL failure remains unknown, never a fabricated known rejection", async () => {
  for (const payload of [{ error: "legacy_collection_write_paused" }, { code: "collection_queue_upgrade_required" }, { code: "PT503", message: "legacy_collection_write_paused" }]) {
    const runtime = createLegacyQueueRuntime(createMemoryStore(), () => ({ session: "one", origin }), async () => new Response(JSON.stringify(payload), { status: 503 }))
    await runtime.initialize(storage); await runtime.refresh()
    await runtime.enqueue({ type: "delete", pokemonId: 1, base: null, origin, binderId: origin.binderId })
    await runtime.flush()
    assert.equal(runtime.view()!.entries[0].state, "unknown")
  }
})
