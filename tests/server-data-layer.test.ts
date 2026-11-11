import test from "node:test"
import assert from "node:assert/strict"
import type { SupabaseClient } from "@supabase/supabase-js"
import { resolveCollectionOwnerUserId } from "../lib/server/collection-owner"
import { loadBinderBootstrap } from "../lib/server/binder-bootstrap"
import { DEFAULT_BINDER_SETTINGS } from "../lib/settings"

type Result = { data: unknown; error: unknown }
type Call = { table: string; ops: Array<[string, unknown[]]> }

// Minimal chainable fake of the Supabase query builder: records calls and resolves to a canned result.
function fakeClient(results: Record<string, Result>) {
  const calls: Call[] = []
  const client = {
    from(table: string) {
      const call: Call = { table, ops: [] }
      calls.push(call)
      const result = results[table] ?? { data: null, error: null }
      const builder: Record<string, unknown> = {}
      for (const method of ["select", "or", "eq", "order", "limit", "range"]) {
        builder[method] = (...args: unknown[]) => {
          call.ops.push([method, args])
          return builder
        }
      }
      builder.maybeSingle = () => {
        call.ops.push(["maybeSingle", []])
        return Promise.resolve(result)
      }
      builder.then = (resolve: (value: Result) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject)
      return builder
    },
  }
  return { client: client as unknown as SupabaseClient, calls }
}

test("resolveCollectionOwnerUserId returns the partnership owner for either partner", async () => {
  for (const userId of ["user-1", "user-2"]) {
    const { client, calls } = fakeClient({ partnerships: { data: { owner_user_id: "user-1" }, error: null } })
    assert.equal(await resolveCollectionOwnerUserId(client, userId), "user-1")
    assert.equal(calls[0].table, "partnerships")
    assert.deepEqual(calls[0].ops.find(([method]) => method === "or")?.[1], [`user1_id.eq.${userId},user2_id.eq.${userId}`])
  }
})

test("resolveCollectionOwnerUserId falls back to the user without a partnership", async () => {
  const { client } = fakeClient({ partnerships: { data: null, error: null } })
  assert.equal(await resolveCollectionOwnerUserId(client, "solo"), "solo")
})

test("resolveCollectionOwnerUserId throws lookup errors unless asked to fall back", async () => {
  const failure = new Error("boom")
  const { client } = fakeClient({ partnerships: { data: null, error: failure } })
  await assert.rejects(() => resolveCollectionOwnerUserId(client, "u"), /boom/)
  assert.equal(await resolveCollectionOwnerUserId(client, "u", { fallbackOnError: true }), "u")
})

test("loadBinderBootstrap maps stored settings and never reads legacy collection rows", async () => {
  const { client, calls } = fakeClient({
    user_settings: { data: { binder_rows: 3, binder_cols: 0, dark_mode: false }, error: null },
  })
  const bootstrap = await loadBinderBootstrap(client, "owner")

  assert.equal(bootstrap.hasStoredSettings, true)
  assert.equal(bootstrap.settings.binderRows, 3)
  assert.equal(bootstrap.settings.binderCols, 4)
  assert.equal(bootstrap.settings.darkMode, false)
  assert.deepEqual(calls.map(c => c.table), ["user_settings"])
  assert.deepEqual(calls[0].ops.find(([method]) => method === "eq")?.[1], ["user_id", "owner"])
})

test("loadBinderBootstrap defaults when nothing is stored", async () => {
  const { client } = fakeClient({ user_settings: { data: null, error: null } })
  const bootstrap = await loadBinderBootstrap(client, "owner")

  assert.equal(bootstrap.hasStoredSettings, false)
  assert.deepEqual(bootstrap.settings, DEFAULT_BINDER_SETTINGS)
})

test("strict native membership rejects denied partner billing instead of falling back to own storage", async () => {
  const { client } = fakeClient({ partnerships: { data: { owner_user_id: "shared-owner" }, error: null } })
  Object.assign(client, { rpc: async () => ({ data: false, error: null }) })
  await assert.rejects(() => resolveCollectionOwnerUserId(client, "partner", { strictBilling: true }))
  assert.equal(await resolveCollectionOwnerUserId(client, "partner"), "partner")
})

test("own-when-denied membership opens only the actor's collection on a definite denial", async () => {
  const { resolveCollectionMembership } = await import("../lib/server/collection-owner")
  const { client } = fakeClient({ partnerships: { data: { id: "p", owner_user_id: "shared-owner", user1_id: "shared-owner", user2_id: "partner" }, error: null } })
  const options = { strictBilling: true, ownWhenDenied: true }
  Object.assign(client, { rpc: async () => ({ data: false, error: null }) })
  assert.deepEqual(await resolveCollectionMembership(client, "partner", options),
    { ownerUserId: "partner", memberIds: ["partner"], partnershipId: null, partnerAccessDenied: true })
  Object.assign(client, { rpc: async () => ({ data: true, error: null }) })
  assert.equal((await resolveCollectionMembership(client, "partner", options)).ownerUserId, "shared-owner")
  Object.assign(client, { rpc: async () => ({ data: null, error: { code: "PGRST202", message: "missing" } }) })
  await assert.rejects(() => resolveCollectionMembership(client, "partner", options), "an unavailable billing check never selects own storage")
  for (const data of [null, undefined, 0, "false", {}, []]) {
    Object.assign(client, { rpc: async () => ({ data, error: null }) })
    await assert.rejects(() => resolveCollectionMembership(client, "partner", options), /billing_access_check_unavailable/)
  }
  const failing = fakeClient({ partnerships: { data: null, error: new Error("transient") } })
  await assert.rejects(() => resolveCollectionMembership(failing.client, "partner", options), /transient/)
})
