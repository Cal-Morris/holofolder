import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { applyHistoryAction, emptyHistory, historyStorageKey, normalizeHistoryCard, normalizeHistorySearch, parseHistoryStore, queueHistoryAction, syncBinderHistory, type HistorySnapshot, type HistoryStore, type HistoryStorage } from "../lib/binder-history"

const store = (): HistoryStore => ({ ...emptyHistory(), clientId: crypto.randomUUID(), sequence: 0, pending: [] })
const card = { id: "synthetic-1", name: "Fixture", number: "#1", setName: "Synthetic", dexId: 63, pokemonName: "abra", viewedAt: "2000-01-01" }

function memoryStorage(read: () => HistoryStore, write: (value: HistoryStore) => void): HistoryStorage {
  let tail = Promise.resolve()
  return {
    async update(change) { const next = change(read()); write(next); return next },
    sync(run) { const result = tail.then(run); tail = result.then(() => {}, () => {}); return result },
  }
}

describe("binder history offline sync", () => {
  test("account, owner and binder caches are isolated, old unscoped data is never imported", () => {
    const scope = { accountId: "owner", ownerId: "owner", binderId: "one" }
    const keys = [scope, { ...scope, accountId: "partner" }, { ...scope, ownerId: "other" }, { ...scope, binderId: "two" }].map(historyStorageKey)
    assert.equal(new Set(keys).size, 4)
    assert.equal(parseHistoryStore(JSON.stringify([card])), null)
    assert.equal(parseHistoryStore(JSON.stringify(["abra"])), null)
  })
  test("normalizes committed searches and cards, bounds displayed history", () => {
    assert.equal(normalizeHistorySearch("  Abra   151  "), "Abra 151")
    assert.equal(normalizeHistorySearch("a"), null)
    assert.equal(normalizeHistoryCard({ ...card, dexId: -1 }), null)
    assert.equal(normalizeHistoryCard({ ...card, name: " " }), null)
    assert.equal(normalizeHistoryCard({ ...card, name: "x".repeat(201) }), null)
    assert.equal(normalizeHistoryCard({ ...card, injected: true })?.id, card.id)
    let local = store()
    for (let index = 0; index < 30; index++) local = queueHistoryAction(local, "card", "add", { ...card, id: `synthetic-${index}` })
    assert.equal(local.cards.length, 20)
    assert.equal(parseHistoryStore(JSON.stringify(local))?.pending.length, 30)
  })
  test("two clients merge committed entries; a clear discards the other device's stale queued history", async () => {
    let remote: HistorySnapshot = emptyHistory()
    let a = queueHistoryAction(store(), "card", "add", card)
    let b = queueHistoryAction(store(), "search", "add", "abra 151")
    const server = { async sync(_id: string, actions: Parameters<typeof applyHistoryAction>[1][]) {
      remote = actions.reduce(applyHistoryAction, remote)
      return remote
    } }
    const aStore = memoryStorage(() => a, value => { a = value })
    const bStore = memoryStorage(() => b, value => { b = value })
    await syncBinderHistory(aStore, server)
    await syncBinderHistory(bStore, server)
    await syncBinderHistory(aStore, server)
    assert.equal(a.searches[0], "abra 151")
    assert.equal(b.cards[0].id, card.id)
    b = queueHistoryAction(b, "card", "add", { ...card, id: "stale-offline" })
    a = queueHistoryAction(a, "card", "clear")
    await syncBinderHistory(aStore, server)
    await syncBinderHistory(bStore, server)
    assert.deepEqual(b.cards, [])
    assert.equal(remote.cards.length, 0)
    assert.deepEqual(b.pending, [])
    assert.equal(b.searches[0], "abra 151")
    b = queueHistoryAction(b, "card", "add", { ...card, id: "after-clear" })
    await syncBinderHistory(bStore, server)
    assert.equal(remote.cards[0].id, "after-clear")
  })
  test("failed requests retain actions; newer changes during sync survive the response", async () => {
    let local = queueHistoryAction(store(), "search", "add", "abra")
    const storage = memoryStorage(() => local, value => { local = value })
    await assert.rejects(syncBinderHistory(storage, { async sync() { throw new Error("offline") } }))
    assert.equal(local.pending.length, 1)
    await syncBinderHistory(storage, { async sync(_id, actions) {
      local = queueHistoryAction(local, "search", "clear")
      local = queueHistoryAction(local, "search", "add", "kadabra 151")
      return actions.reduce(applyHistoryAction, emptyHistory())
    } })
    assert.deepEqual(local.searches, ["kadabra 151"])
    assert.equal(local.pending.length, 2)
    await syncBinderHistory(storage, { async sync(_id, actions) { return actions.reduce(applyHistoryAction, emptyHistory()) } })
    assert.deepEqual(local.searches, ["kadabra 151"])
    assert.equal(local.pending.length, 0)
  })
})

test("a delayed sync cannot overwrite a clear from another tab, edits do not wait for the network", async () => {
  let local = queueHistoryAction(store(), "search", "add", "abra")
  const storage = memoryStorage(() => local, value => { local = value })
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let started!: () => void
  const ready = new Promise<void>(resolve => { started = resolve })
  let server = emptyHistory()
  let receipt = 0
  let requests = 0
  const remote = { async sync(_id: string, actions: Parameters<typeof applyHistoryAction>[1][]) {
    for (const action of actions) {
      if (action.seq <= receipt) continue
      receipt = action.seq
      server = applyHistoryAction(server, action)
    }
    const snapshot = server
    if (++requests === 1) { started(); await gate }
    return snapshot
  } }
  const first = syncBinderHistory(storage, remote)
  await ready
  await storage.update(current => queueHistoryAction(current, "search", "clear"))
  await storage.update(current => queueHistoryAction(current, "search", "add", "kadabra"))
  const second = syncBinderHistory(storage, remote)
  assert.deepEqual(local.searches, ["kadabra"])
  assert.equal(requests, 1)
  release()
  await Promise.all([first, second])
  assert.deepEqual(local.searches, ["kadabra"])
  assert.deepEqual(server.searches, ["kadabra"])
  assert.equal(local.pending.length, 0)
  assert.equal(receipt, 3)
})

test("obsolete hook responses leave the durable queue untouched for the next active instance", async () => {
  let local = queueHistoryAction(store(), "search", "add", "abra")
  const storage = memoryStorage(() => local, value => { local = value })
  const before = structuredClone(local)
  let active = true
  await syncBinderHistory(storage, { async sync() { active = false; return emptyHistory() } }, () => active)
  assert.deepEqual(local, before)
})
