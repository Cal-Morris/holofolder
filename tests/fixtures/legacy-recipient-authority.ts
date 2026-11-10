import assert from "node:assert/strict"
async function main() {
  // Synthetic local-only adapters, and no mutation query is available in this fixture.
  // @ts-expect-error Bun module mocks are confined to subprocesses.
  const { mock } = await import("bun:test")
  mock.module("server-only", () => ({}))
  mock.module("../../lib/server/partner-push", () => ({ saveCollectionWithAcquisition: () => { throw Error("must not write") }, startPendingPartnerPush: () => { throw Error("must not notify") } }))
  mock.module("../../lib/server/collector-funnel", () => ({ scheduleCollectorTracking() {}, recordCollectorSave() {} }))
  const binder = "00000000-0000-4000-8000-000000000003", owner = "00000000-0000-4000-8000-000000000002", actor = "00000000-0000-4000-8000-000000000001"
  let schemaCode = "42P01", converted = false
  mock.module("../../lib/supabase/admin", () => ({ createAdminClient: () => ({ from(table: string) {
    assert.ok(["partnerships", "binders", "storage_collection_state"].includes(table))
    const q = { select() { return q }, eq() { return q }, or() { return q }, limit() { return q }, async maybeSingle() {
      if (table === "partnerships") return { data: null, error: null }
      if (table === "binders") return { data: { id: binder }, error: null }
      return converted ? { data: { authority: "slots", conversion_version: 1 }, error: null } : { data: null, error: { code: schemaCode } }
    } }
    return q
  } }) }))
  const { NextRequest } = await import("next/server")
  const { saveCollectionItem, updateCollectionStatus, deleteCollectionItem } = await import("../../lib/server/operations/collection")
  const user = { id: actor } as Parameters<typeof saveCollectionItem>[1]
  for (const code of ["42P01", "PGRST205", "network"]) {
    schemaCode = code
    for (const method of ["POST", "PATCH", "DELETE"]) {
      const request = new NextRequest(`https://synthetic.test/app/api/collection?pokemonId=25&binderId=${binder}`, { method, ...(method === "DELETE" ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pokemonId: 25, pokemonName: "Synthetic", status: "collected", binderId: binder }) }) })
      const response = method === "POST" ? await saveCollectionItem(request, user, false, { ownerUserId: owner, memberIds: [actor, owner] }) : method === "PATCH" ? await updateCollectionStatus(request, user, owner) : await deleteCollectionItem(request, user, false, owner)
      assert.equal(response.status, 503); assert.equal((await response.json()).code, "collection_recipient_inaccessible")
    }
  }
  converted = true
  const response = await deleteCollectionItem(new NextRequest(`https://synthetic.test/app/api/collection?pokemonId=25&binderId=${binder}`, { method: "DELETE" }), user, false, owner)
  assert.equal(response.status, 409); assert.equal((await response.json()).code, "binder_converted_requires_slot_commands")
}
void main()
