import assert from "node:assert/strict"
import { NextRequest } from "next/server"
import { getDefaultBinderSettings } from "../../lib/settings"
import { BillingAccessError } from "../../lib/billing"

async function run() {
  // Synthetic partner session and database; no network requests.
  // @ts-expect-error Bun mock types stay isolated from the application.
  const { mock } = await import("bun:test")
  const binderId = "00000000-0000-4000-8000-000000000001"
  let paid = false, exists = true, billingChecks = 0
  let grid = { binder_rows: 4, binder_cols: 4 }
  const writes: Array<{ table: string; row: Record<string, unknown>; filters: Record<string, unknown> }> = []
  const admin = { from(table: string) {
    const filters: Record<string, unknown> = {}
    let write: Record<string, unknown> | null = null
    const result = () => ({ data: table === "binders" ? grid : { user_id: "owner", binder_rows: 4, binder_cols: 4 }, error: null })
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { filters[key] = value; return query },
      single: async () => result(), maybeSingle: async () => result(),
      update: (row: Record<string, unknown>) => { write = row; return query },
      insert: (row: Record<string, unknown>) => { write = row; return query },
      then: (resolve: (value: unknown) => unknown) => { if (write) writes.push({ table, row: write, filters }); return Promise.resolve(result()).then(resolve) },
    }
    return query
  } }
  mock.module("../../lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "partner" } } }) } }) }))
  mock.module("../../lib/supabase/admin", () => ({ createAdminClient: () => admin }))
  mock.module("../../lib/server/collection-owner", () => ({ resolveCollectionOwnerUserId: async () => "owner" }))
  const { BinderAccessError } = await import("../../lib/server/binders")
  mock.module("../../lib/server/binders", () => ({ BinderAccessError, resolveWriteBinderId: async (_admin: unknown, owner: string, id: string) => { assert.equal(owner, "owner"); if (!exists) throw new BinderAccessError(); return id } }))
  mock.module("../../lib/server/billing", () => ({ requirePaidAccess: async (owner: string) => { billingChecks++; assert.equal(owner, "owner"); if (!paid) throw new BillingAccessError() }, billingErrorResponse: () => Response.json({ code: "upgrade_required" }, { status: 402 }) }))
  const { PUT } = await import("../../app/api/settings/route")
  const put = (rows: unknown, cols: unknown) => PUT(new NextRequest("https://holofolder.com/app/api/settings", { method: "PUT", body: JSON.stringify({ ...getDefaultBinderSettings(), binderRows: rows, binderCols: cols, binderId }) }))
  for (const [rows, cols] of [[9, 8], [2.5, 4], ["8", 8], [null, 8], [0, 4]]) assert.equal((await put(rows, cols)).status, 400)
  assert.equal(writes.length, 0)
  assert.equal((await put(8, 8)).status, 402)
  assert.equal(writes.length, 0)
  paid = true
  assert.equal((await put(8, 8)).status, 200)
  assert.deepEqual(writes[0], { table: "binders", row: { binder_rows: 8, binder_cols: 8 }, filters: { id: binderId, owner_user_id: "owner" } })
  assert.equal(writes[1].table, "user_settings")
  assert.equal(writes[1].row.binder_rows, undefined)
  assert.equal(writes[1].row.binder_cols, undefined)
  paid = false; grid = { binder_rows: 8, binder_cols: 8 }
  const before = billingChecks
  assert.equal((await put(8, 8)).status, 200)
  assert.equal((await put(3, 4)).status, 200)
  assert.equal(billingChecks, before)
  exists = false
  assert.equal((await put(4, 4)).status, 404)
}
run().catch(error => { console.error(error); process.exitCode = 1 })
