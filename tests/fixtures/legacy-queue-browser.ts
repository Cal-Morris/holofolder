import { createIndexedDbStore } from "@/lib/offline-store/kv"
import { createLegacyQueue } from "@/lib/collection/legacy-queue-store"
import { LEGACY_QUEUE_KEY, type Claim } from "@/lib/collection/legacy-queue-record"

// Synthetic storage-only entry. Two pages open independent connections to this database.
const origin = { kind: "account" as const, actorUserId: "synthetic-actor", ownerUserId: "synthetic-owner", binderId: "synthetic-binder" }
let session = "synthetic-session"
const name = "synthetic-legacy-atomic-proof"
let abortAfterPut = false, putSucceeded = false
// Delegate to real Chromium IDB, injecting an abort in the actual put-success event.
const factory = new Proxy(indexedDB, {
  get(target, property) {
    if (property !== "open") {
      const value = Reflect.get(target, property, target)
      return typeof value === "function" ? value.bind(target) : value
    }
    return (...args: Parameters<IDBFactory["open"]>) => {
      const request = target.open(...args)
      request.addEventListener("success", () => {
        const db = request.result, transaction = db.transaction.bind(db)
        db.transaction = (...transactionArgs: Parameters<IDBDatabase["transaction"]>) => {
          const tx = transaction(...transactionArgs), objectStore = tx.objectStore.bind(tx)
          tx.objectStore = (...storeArgs: Parameters<IDBTransaction["objectStore"]>) => {
            const store = objectStore(...storeArgs), put = store.put.bind(store)
            store.put = (...putArgs: Parameters<IDBObjectStore["put"]>) => {
              const putRequest = put(...putArgs)
              if (abortAfterPut) putRequest.addEventListener("success", () => {
                putSucceeded = true; abortAfterPut = false; tx.abort()
              }, { once: true })
              return putRequest
            }
            return store
          }
          return tx
        }
      })
      return request
    }
  },
})
const store = createIndexedDbStore(factory, name), queue = createLegacyQueue(store, () => ({ session, origin }))
const singleQueue = createLegacyQueue(createIndexedDbStore(indexedDB, `${name}-single`), () => ({ session, origin }))
const input = (pokemonId: number) => ({ origin, type: "delete" as const, pokemonId, binderId: origin.binderId, base: null })
const api = {
  queue, origin,
  async reviewRegressions() {
    const make = (suffix: string) => {
      const db = createIndexedDbStore(indexedDB, `${name}-${suffix}`)
      return { db, q: createLegacyQueue(db, () => ({ session, origin })) }
    }
    const compatibility = make("compatibility")
    await compatibility.q.initialize({ getItem: () => null })
    const { epoch } = (await compatibility.q.read(origin)).token
    for (const id of [1, 2]) await compatibility.q.enqueue(input(id), { epoch, entryRevision: null })
    const claim = (await compatibility.q.claim(origin, session, "one", 0))!
    await compatibility.q.settle(claim, { kind: "known-rejection", category: "compatibility", code: "binder_converted_requires_slot_commands" })
    const reopened = make("compatibility")
    const blocked = await reopened.q.claim(origin, session, "two", 1) === null
    const privacy = make("privacy")
    const raw = JSON.stringify([{ ...input(10), id: "nested-private", queuedAt: "synthetic", original: { raw: JSON.stringify({ origin: { ...origin, actorUserId: "foreign" }, private: "FOREIGN-SECRET" }) } }])
    await privacy.q.initialize({ getItem: () => raw })
    const hidden = !JSON.stringify(await privacy.q.read(origin)).includes("FOREIGN-SECRET")
    const retained = JSON.stringify(await privacy.db.get(LEGACY_QUEUE_KEY)).includes("FOREIGN-SECRET")
    const batch = make("review-expiry")
    await batch.q.initialize({ getItem: () => JSON.stringify([1, 2].map(pokemonId => ({ id: `guest${pokemonId}`, type: "delete", pokemonId, queuedAt: "synthetic", base: null }))) })
    const view = await batch.q.read(origin)
    await batch.q.acceptReview(await batch.q.prepareReview(origin), view.sources, [1, 2].map((pokemonId, ordinal) => ({ sourceId: view.sources[0].sourceId, ordinal, input: input(pokemonId) })))
    await batch.q.claim(origin, session, "one", 0)
    const paused = await batch.q.claim(origin, session, "two", 60001) === null
    const states = (await batch.q.read(origin)).entries.map(e => e.state)
    return { blocked, hidden, retained, paused, states }
  },
  async singleSeed() {
    await singleQueue.initialize({ getItem: () => null })
    const view = await singleQueue.read(origin)
    await singleQueue.enqueue(input(800), { epoch: view.token.epoch, entryRevision: null })
  },
  singleClaim: () => singleQueue.claim(origin, session, "competing", 0),
  initialize: () => queue.initialize({ getItem: () => ' [ {"id":"synthetic-guest","type":"delete","pokemonId":99,"queuedAt":"synthetic","base":null} ] ' }),
  read: () => queue.read(origin),
  envelope: () => store.get(LEGACY_QUEUE_KEY),
  async append(pokemonId: number, entryRevision: number | null = null) {
    const { token } = await queue.read(origin)
    return queue.enqueue(input(pokemonId), { epoch: token.epoch, entryRevision })
  },
  claim: (now: number, holder: string) => queue.claim(origin, session, holder, now),
  switchSession: () => { session = "synthetic-other-session" },
  async review() {
    const view = await queue.read(origin), token = await queue.prepareReview(origin)
    return { token, sources: view.sources, selections: [{ sourceId: view.sources[0].sourceId, ordinal: 0, input: input(99) }] }
  },
  async abortEnqueue() {
    abortAfterPut = true; putSucceeded = false
    try { await api.append(500) } finally { abortAfterPut = false }
  },
  async abortSettle(claim: Claim) {
    abortAfterPut = true; putSucceeded = false
    try { await queue.settle(claim, { kind: "acknowledged", item: null }) } finally { abortAfterPut = false }
  },
  async abortReview() {
    const review = await api.review()
    abortAfterPut = true; putSucceeded = false
    try { await queue.acceptReview(review.token, review.sources, review.selections) } finally { abortAfterPut = false }
  },
  async abortInitialization() {
    await store.delete(LEGACY_QUEUE_KEY)
    abortAfterPut = true; putSucceeded = false
    try { await api.initialize() } finally { abortAfterPut = false }
  },
  putSucceeded: () => putSucceeded,
  async primitiveFailure(kind: "throw" | "clone" | "outside") {
    await store.updateMany(["primitive-a", "primitive-b"], () => {
      if (kind === "throw") throw new Error("synthetic-transform-abort")
      return { writes: kind === "clone" ? [["primitive-a", 1], ["primitive-b", () => undefined]] : [["outside", 1]], result: true }
    })
  },
  primitiveValues: () => store.getMany(["primitive-a", "primitive-b", "outside"]),
  overwriteOld: () => store.set("collection", { pendingOperations: [] }),
}
Object.assign(globalThis, { legacyQueueProof: api })
