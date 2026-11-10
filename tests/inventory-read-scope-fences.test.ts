import { test } from "node:test"
import assert from "node:assert/strict"
import { fixture, owner } from "./fixtures/inventory-read-server"
import { readOwnerInventoryState } from "../lib/server/inventory-read"

// Synthetic fixture only. Records getUser and PostgREST tables in call order.
function traced(onTable: (f: ReturnType<typeof fixture>, table: string, n: number) => void = () => {}) {
  const f = fixture(3), events: string[] = [], seen: Record<string, number> = {}
  const getUser = f.client.auth.getUser.bind(f.client.auth)
  f.client.auth.getUser = (async () => { events.push("getUser"); return getUser() }) as never
  f.intercept(table => { events.push(table); onTable(f, table, seen[table] = (seen[table] ?? 0) + 1) })
  return { f, events }
}
const tally = (events: string[], name: string) => events.filter(e => e === name).length
const nth = (events: string[], name: string, n: number) => events.findIndex((e, i) => e === name && tally(events.slice(0, i + 1), name) === n)

test("attempt 0 reuses the initial scope; the before-brand and final fences still reauthorize", async () => {
  const { f, events } = traced()
  await readOwnerInventoryState(f.client)
  // Initial scope, before-brand fence, final fence. Previously 4 (a duplicate check at the top of attempt 0).
  for (const call of ["getUser", "partnerships", "billing_partner_allowed"]) assert.equal(tally(events, call), 3, call)
  assert.deepEqual(events.slice(0, 4), ["getUser", "partnerships", "billing_partner_allowed", "inventory_owner_state"])
})

test("an authority change during data reads never publishes", async () => {
  for (const change of ["actor", "billing"] as const) for (const attempts of [1, 2]) {
    const { f } = traced((f, table, n) => {
      if (table !== "binder_slots" || n !== 1) return
      if (change === "actor") f.setActor("33333333-3333-4333-8333-333333333333"); else f.deny()
    })
    await assert.rejects(readOwnerInventoryState(f.client, { attempts }), `${change} ${attempts}`)
  }
})

test("a retry reauthorizes before its first data read", async () => {
  const bump = (f: ReturnType<typeof fixture>, table: string, n: number) => {
    // The second revision read is attempt 0's before-brand fence.
    if (table === "inventory_owner_state" && n === 2) f.tables.inventory_owner_state = [{ owner_user_id: owner, inventory_revision: 8 }]
  }
  const ok = traced(bump)
  const result = await readOwnerInventoryState(ok.f.client)
  assert.equal(result.snapshot.inventoryRevision, 8)
  const retryScope = nth(ok.events, "getUser", 2)
  assert.ok(nth(ok.events, "inventory_owner_state", 2) < retryScope && retryScope < nth(ok.events, "inventory_owner_state", 3))
  assert.equal(tally(ok.events, "getUser"), 4)

  // Billing revoked alongside the conflict: the retry's scope check fails closed as forbidden.
  const denied = traced((f, table, n) => { bump(f, table, n); if (table === "inventory_owner_state" && n === 2) f.deny() })
  await assert.rejects(readOwnerInventoryState(denied.f.client), { code: "inventory_read_forbidden" })
  assert.equal(nth(denied.events, "inventory_owner_state", 3), -1)
})

test("initial scope failure denies before any data read", async () => {
  const { f, events } = traced()
  f.deny()
  await assert.rejects(readOwnerInventoryState(f.client), { code: "inventory_read_forbidden" })
  assert.deepEqual(events, ["getUser", "partnerships", "billing_partner_allowed"])
})
