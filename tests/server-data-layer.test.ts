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

test("loadBinderBootstrap loads the owner's collection and maps stored settings", async () => {
  const { client, calls } = fakeClient({
    pokemon_collection: { data: [{ pokemon_id: 1 }], error: null },
    user_settings: { data: { binder_rows: 3, binder_cols: 0, dark_mode: false }, error: null },
  })
  const bootstrap = await loadBinderBootstrap(client, "owner")

  assert.deepEqual(bootstrap.collection, [{ pokemon_id: 1 }])
  assert.equal(bootstrap.collectionError, null)
  assert.equal(bootstrap.hasStoredSettings, true)
  assert.equal(bootstrap.settings.binderRows, 3)
  assert.equal(bootstrap.settings.binderCols, 4)
  assert.equal(bootstrap.settings.darkMode, false)
  for (const call of calls) {
    assert.deepEqual(call.ops.find(([method]) => method === "eq")?.[1], ["user_id", "owner"])
  }  // Paged so owners with more than 1000 slots get every row.
  const collectionCall = calls.find((call) => call.table === "pokemon_collection")
  assert.deepEqual(collectionCall?.ops.find(([method]) => method === "range")?.[1], [0, 999])
})

test("loadBinderBootstrap defaults when nothing is stored and surfaces collection errors", async () => {
  const failure = new Error("nope")
  const { client } = fakeClient({
    pokemon_collection: { data: null, error: failure },
    user_settings: { data: null, error: null },
  })
  const bootstrap = await loadBinderBootstrap(client, "owner")

  assert.deepEqual(bootstrap.collection, [])
  assert.equal(bootstrap.collectionError, failure)
  assert.equal(bootstrap.hasStoredSettings, false)
  assert.deepEqual(bootstrap.settings, DEFAULT_BINDER_SETTINGS)
})

test('suspended shared-binder writes pause, while explicit own-binder writes remain allowed', async () => {
  const { assertCollectionWriteAccess } = await import('../lib/server/collection-owner')
  const { client } = fakeClient({
    partnerships: { data: { owner_user_id: 'owner', user1_id: 'owner', user2_id: 'partner' }, error: null },
    binders: { data: { owner_user_id: 'partner' }, error: null },
  })
  Object.assign(client, { rpc: async () => ({ data: false, error: null }) })
  await assert.rejects(assertCollectionWriteAccess(client, 'partner', null), { status: 402 })
  await assert.doesNotReject(assertCollectionWriteAccess(client, 'partner', 'own-binder'))
  const other = fakeClient({ partnerships: { data: { owner_user_id: 'owner' }, error: null }, binders: { data: { owner_user_id: 'owner' }, error: null } }).client
  Object.assign(other, { rpc: async () => ({ data: false, error: null }) })
  await assert.rejects(assertCollectionWriteAccess(other, 'partner', 'shared-binder'), { status: 402 })
})

test("native bootstrap reads display settings without consulting legacy collection rows", async () => {
  const { client, calls } = fakeClient({ user_settings: { data: { binder_rows: 3 }, error: null } })
  const boot = await loadBinderBootstrap(client, "owner", null, "native")
  assert.deepEqual(boot.collection, [])
  assert.equal(boot.settings.binderRows, 3)
  assert.equal(calls.some(c => c.table === "pokemon_collection"), false)
})

test("strict native membership rejects denied partner billing instead of falling back to own storage", async () => {
  const { client } = fakeClient({ partnerships: { data: { owner_user_id: "shared-owner" }, error: null } })
  Object.assign(client, { rpc: async () => ({ data: false, error: null }) })
  await assert.rejects(() => resolveCollectionOwnerUserId(client, "partner", { strictBilling: true }))
  assert.equal(await resolveCollectionOwnerUserId(client, "partner"), "partner")
})
