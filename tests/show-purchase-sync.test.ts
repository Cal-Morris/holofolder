import test from "node:test"
import assert from "node:assert/strict"
import {
  fromShowPurchaseRow,
  parseShowPurchaseQueue,
  queueShowPurchaseAdds,
  queueShowPurchaseRemovals,
  reconcileShowSession,
  showSyncWindowStart,
  syncShowPurchases,
  toShowPurchaseRow,
  type ShowPurchaseOp,
  type ShowPurchaseRemote,
  type ShowPurchaseRow,
  type ShowPurchaseStore,
} from "../lib/show-purchase-sync"
import { SHOW_SESSION_MAX_AGE_MS, addShowPurchase, clearedShowSession, emptyShowSession, parseShowSession, type ShowPurchase, type ShowSession } from "../lib/show-session"

const OWNER = "00000000-0000-4000-8000-00000000000a"
const NOW = Date.parse("2026-10-24T12:00:00Z")
const purchase = (id: string, minutesAgo: number, price = 5): ShowPurchase => ({
  id, cardId: "sv03.5-006", cardName: "Charizard ex", language: "en", finish: "holo", price, marketPrice: 10, currency: "GBP", at: NOW - minutesAgo * 60_000,
})

/** An account table with the real unique key: (owner_user_id, client_id), inserts ignore duplicates. */
class FakeAccount implements ShowPurchaseRemote {
  rows = new Map<string, ShowPurchaseRow>()
  inserts = 0
  failNext = false
  async insert(rows: ShowPurchaseRow[]) {
    if (this.failNext) { this.failNext = false; throw new Error("offline") }
    this.inserts += 1
    for (const row of rows) if (!this.rows.has(row.client_id)) this.rows.set(row.client_id, row)
  }
  async remove(ids: string[]) {
    for (const id of ids) this.rows.delete(id)
  }
  async listSince(sinceIso: string) {
    return [...this.rows.values()].filter((row) => row.bought_at >= sinceIso)
  }
}

class MemoryStore implements ShowPurchaseStore {
  constructor(public session: ShowSession = emptyShowSession(NOW), public queue: ShowPurchaseOp[] = []) {}
  readQueue() { return this.queue }
  writeQueue(queue: ShowPurchaseOp[]) { this.queue = queue }
  readSession(now: number) { return parseShowSession(JSON.stringify(this.session), now) }
  writeSession(session: ShowSession) { this.session = session }
}

const log = (store: MemoryStore, ...purchases: ShowPurchase[]) => {
  for (const entry of purchases) store.session = addShowPurchase(store.session, entry, NOW)
  store.queue = queueShowPurchaseAdds(store.queue, purchases)
}

test("an undo before syncing just drops the queued purchase; after syncing it queues a delete", () => {
  let queue = queueShowPurchaseAdds([], [purchase("a", 5), purchase("b", 4)])
  queue = queueShowPurchaseRemovals(queue, ["a"])
  assert.deepEqual(queue.map((op) => op.op === "add" ? `add:${op.purchase.id}` : `remove:${op.id}`), ["add:b"])
  queue = queueShowPurchaseRemovals([], ["c"])
  assert.deepEqual(queue, [{ op: "remove", id: "c" }])
  assert.deepEqual(parseShowPurchaseQueue(JSON.stringify([...queue, { op: "add" }, "junk"])), queue)
  assert.deepEqual(parseShowPurchaseQueue("{nope"), [])
})

test("purchases round-trip through account rows", () => {
  const entry = { ...purchase("a", 3), bundleId: "bundle-1" }
  const row = toShowPurchaseRow(entry, OWNER)
  assert.equal(row.owner_user_id, OWNER)
  assert.equal(row.client_id, "a")
  assert.equal(row.bought_at, new Date(entry.at).toISOString())
  // PostgREST may send numeric columns as strings.
  assert.deepEqual(fromShowPurchaseRow({ ...row, price: "5.00", market_price: "10" }), entry)
  assert.equal(fromShowPurchaseRow({ ...row, price: -1 }), null)
  assert.equal(fromShowPurchaseRow({ ...row, bought_at: "not a date" }), null)
})

test("offline purchases are queued and sent once; retries and a second device don't duplicate", async () => {
  const account = new FakeAccount()
  const phone = new MemoryStore()
  log(phone, purchase("a", 10, 8), purchase("b", 5, 3))

  account.failNext = true
  await assert.rejects(syncShowPurchases({ remote: account, store: phone, ownerUserId: OWNER, now: NOW }))
  assert.equal(phone.queue.length, 2, "a failed push keeps the queue")
  assert.equal(phone.session.purchases.length, 2, "and the tally")

  const result = await syncShowPurchases({ remote: account, store: phone, ownerUserId: OWNER, now: NOW })
  assert.deepEqual({ pushed: result.pushed, pulled: result.pulled }, { pushed: 2, pulled: 2 })
  assert.equal(phone.queue.length, 0)
  assert.equal(account.rows.size, 2)

  // The same ops sent again (a lost response, another tab) change nothing.
  await account.insert([toShowPurchaseRow(purchase("a", 10, 8), OWNER)])
  await syncShowPurchases({ remote: account, store: phone, ownerUserId: OWNER, now: NOW })
  assert.equal(account.rows.size, 2)
  assert.deepEqual(phone.session.purchases.map((entry) => entry.id), ["a", "b"])
})

test("a reinstalled app or a partner's device gets the show's purchases from the account", async () => {
  const account = new FakeAccount()
  const phone = new MemoryStore()
  log(phone, purchase("a", 30, 8))
  await syncShowPurchases({ remote: account, store: phone, ownerUserId: OWNER, now: NOW })

  const partner = new MemoryStore()
  log(partner, purchase("p", 2, 4))
  await syncShowPurchases({ remote: account, store: partner, ownerUserId: OWNER, now: NOW })
  assert.deepEqual(partner.session.purchases.map((entry) => entry.id), ["a", "p"])
  assert.equal(partner.session.startedAt, NOW - 30 * 60_000, "the show started with the first purchase")

  const fresh = new MemoryStore()
  await syncShowPurchases({ remote: account, store: fresh, ownerUserId: OWNER, now: NOW })
  assert.deepEqual(fresh.session.purchases.map((entry) => entry.id), ["a", "p"])

  // Undo on the partner's phone reaches the account, then this phone.
  partner.queue = queueShowPurchaseRemovals(partner.queue, ["p"])
  await syncShowPurchases({ remote: account, store: partner, ownerUserId: OWNER, now: NOW })
  await syncShowPurchases({ remote: account, store: phone, ownerUserId: OWNER, now: NOW })
  assert.deepEqual(phone.session.purchases.map((entry) => entry.id), ["a"])
})

test("old shows and cleared tallies stay out", async () => {
  const account = new FakeAccount()
  await account.insert([toShowPurchaseRow(purchase("last-show", 60 * 24), OWNER), toShowPurchaseRow(purchase("today", 60), OWNER)])
  const fresh = new MemoryStore()
  await syncShowPurchases({ remote: account, store: fresh, ownerUserId: OWNER, now: NOW })
  assert.deepEqual(fresh.session.purchases.map((entry) => entry.id), ["today"])

  const cleared = new MemoryStore(clearedShowSession(NOW - 30 * 60_000))
  await syncShowPurchases({ remote: account, store: cleared, ownerUserId: OWNER, now: NOW })
  assert.deepEqual(cleared.session.purchases, [])
  assert.equal(showSyncWindowStart(cleared.session, NOW), NOW - 30 * 60_000)

  // A session that ran out is treated as cleared when it expired.
  const expired = parseShowSession(JSON.stringify({ startedAt: NOW - SHOW_SESSION_MAX_AGE_MS - 1000, purchases: [purchase("x", 60 * 19)] }), NOW)
  assert.equal(expired.clearedAt, NOW - 1000)
  assert.deepEqual(expired.purchases, [])
})

test("reconcile keeps unsent purchases and leaves out ones being removed", () => {
  const session = { startedAt: NOW - 600_000, purchases: [purchase("synced-gone", 9), purchase("unsent", 3), purchase("removing", 2)] }
  const queue: ShowPurchaseOp[] = [{ op: "add", purchase: purchase("unsent", 3) }, { op: "remove", id: "removing" }]
  const next = reconcileShowSession(session, [purchase("remote", 6), purchase("removing", 2)], queue, NOW - SHOW_SESSION_MAX_AGE_MS)
  assert.deepEqual(next.purchases.map((entry) => entry.id), ["remote", "unsent"])
})

test("a purchase sent in this sync isn't dropped if the read doesn't show it yet", async () => {
  const lagging = new FakeAccount()
  lagging.listSince = async () => []
  const phone = new MemoryStore()
  log(phone, purchase("a", 1, 8))
  await syncShowPurchases({ remote: lagging, store: phone, ownerUserId: OWNER, now: NOW })
  assert.deepEqual(phone.session.purchases.map((entry) => entry.id), ["a"])
})
