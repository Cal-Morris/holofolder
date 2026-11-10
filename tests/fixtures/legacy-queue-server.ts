import assert from "node:assert/strict"
import { collectionFingerprint } from "../../lib/collection/sync"
import { auditContextHeader, withAuditActor } from "../../lib/server/audit-context"

async function main() {
  // Synthetic identities and database transport, isolated from other tests and hosted services.
  // @ts-expect-error Bun module mocks are confined to subprocesses.
  const { mock } = await import("bun:test")
  mock.module("server-only", () => ({}))
  const actor = "00000000-0000-4000-8000-000000000001", owner = "00000000-0000-4000-8000-000000000002", binder = "00000000-0000-4000-8000-000000000003"
  const row = { id: "synthetic", user_id: owner, binder_id: binder, pokemon_id: 25, pokemon_name: "Synthetic", status: "collected" as const, wanted_cards: [], collected_at: "2026-11-10" }
  let signedIn = true, currentOwner = owner, accessible = true, conflict = false
  let dbError: unknown = null, throwDbError = false
  const contexts: Record<string, unknown>[] = []
  const writes: Record<string, unknown>[] = []
  let fallback = false, directWrites = 0
  mock.module("../../lib/supabase/server", () => ({ createClient: async () => ({}) }))
  mock.module("../../lib/supabase/session-user", () => ({ getFirstPartyUser: async () => ({ data: { user: signedIn ? { id: actor, user_metadata: {} } : null } }) }))
  mock.module("../../lib/server/collector-funnel", () => ({ scheduleCollectorTracking() {}, recordCollectorSave() {} }))
  mock.module("../../lib/supabase/admin", () => ({ createAdminClient: () => ({
    from(table: string) {
      const directResult = () => { directWrites++; return { data: null, error: dbError } }
      const q = { select() { return q }, eq() { return q }, or() { return q },
        in(_key: string, values: string[]) { assert.ok(values.includes(String(contexts.at(-1)!.operationId))); return q },
        order() { return q }, limit() { return q }, upsert() { return q }, update() { return q },
        delete() {
          const deletion = { eq() { return deletion }, then(resolve: (value: ReturnType<typeof directResult>) => unknown) { return Promise.resolve(directResult()).then(resolve) } }
          return deletion
        }, single: async () => directResult(), async maybeSingle() {
        return { data: table === "partnerships" ? { owner_user_id: currentOwner, user1_id: actor, user2_id: currentOwner }
          : table === "binders" ? accessible ? { id: binder } : null
          : table === "pokemon_collection" ? row : table === "collection_activity" ? { id: "123" } : null, error: null }
      } }
      return q
    },
    async rpc(name: string, input: Record<string, unknown>) {
      if (name === "billing_partner_allowed") return { data: true, error: null }
      if (fallback && name === "save_collection_with_acquisition") return { data: null, error: { code: "PGRST202" } }
      assert.ok(["save_collection_with_acquisition", "developer_delete_collection"].includes(name), name)
      assert.equal(input.p_owner ?? input.owner_id, owner)
      assert.equal(input.p_binder ?? input.binder, binder)
      assert.equal(input.p_actor ?? input.actor, actor)
      assert.deepEqual(input.p_expected ?? input.expected, row)
      writes.push(input)
      contexts.push(JSON.parse(auditContextHeader()!))
      if (throwDbError) throw dbError
      return { data: dbError ? null : conflict ? { conflict: true } : { item: row, deleted: true }, error: dbError }
    },
  }) }))
  const { NextRequest } = await import("next/server")
  const routes = await import("../../app/api/collection/route")
  const operations = await import("../../lib/server/operations/collection")
  type Method = "POST" | "PATCH" | "DELETE"
  function request(method: Method, protocol: string | null = "2", binding = true, base: string | null = collectionFingerprint(row)) {
    const params = new URLSearchParams({ pokemonId: "25", binderId: binder })
    if (binding) { params.set("actorUserId", actor); params.set("ownerUserId", owner) }
    if (base !== null) params.set("baseFingerprint", base)
    const headers = new Headers({ "Content-Type": "application/json", "X-Holo-Audit-Context": JSON.stringify({ source: "rest", actor: { userId: "forged" }, legacyQueueGeneration: 999, purpose: "forged" }) })
    if (protocol !== null) headers.set("X-Holo-Legacy-Queue", protocol)
    return new NextRequest(`https://synthetic.test/app/api/collection?${params}`, { method, headers,
      ...(method === "DELETE" ? {} : { body: JSON.stringify({ pokemonId: 25, pokemonName: "Synthetic", status: "finalized", binderId: binder, wantedCards: [],
        ...(base !== null ? { baseFingerprint: base } : {}), ...(binding ? { recipient: { kind: "account", actorUserId: actor, ownerUserId: owner, binderId: binder } } : {}),
        source: "mcp", actor: "forged", auditContext: { legacyQueueGeneration: 2, purpose: "legacy.queue" } }) }) })
  }
  for (const method of ["POST", "PATCH", "DELETE"] as const) {
    let before = writes.length
    let response = await routes[method](request(method, "1", false))
    assert.equal(response.status, 503); assert.equal((await response.json()).code, "collection_recipient_required")
    for (const protocol of ["", "1", "02", "2.0", "2, 2", "3"]) {
      response = await routes[method](request(method, protocol))
      assert.equal(response.status, 503)
      assert.deepEqual(await response.json(), { error: "Collection uploads are paused. Keep this change on this device and reload the app before reviewing it.", code: "collection_queue_upgrade_required", retainOnDevice: true })
      assert.equal(response.headers.get("Cache-Control"), "private, no-store")
    }
    assert.equal(writes.length, before, "unsupported protocols must never execute a write")
    signedIn = false
    assert.equal((await routes[method](request(method))).status, 401)
    signedIn = true; currentOwner = actor
    response = await routes[method](request(method)); assert.equal((await response.json()).code, "collection_recipient_changed")
    currentOwner = owner; accessible = false
    response = await routes[method](request(method)); assert.equal((await response.json()).code, "collection_recipient_inaccessible")
    accessible = true
    response = await routes[method](request(method, "2", true, "stale")); assert.equal(response.status, 409)
    if (method === "PATCH") {
      response = await routes[method](request(method, "2", true, null)); assert.equal((await response.json()).code, "collection_precondition_required")
    }
    assert.equal(writes.length, before)
    response = await routes[method](request(method))
    assert.equal(response.status, 200); assert.equal(response.headers.get("X-Activity-Event"), "123")
    const tagged = contexts.at(-1)!
    assert.equal(tagged.source, "app"); assert.deepEqual(tagged.actor, { kind: "user", userId: actor })
    assert.equal(tagged.legacyQueueGeneration, 2); assert.equal(tagged.purpose, "legacy.queue")
    assert.equal(tagged.clientId, null); assert.ok(tagged.operationId); assert.ok(tagged.batchId)
    assert.equal(auditContextHeader(), undefined)
    response = await routes[method](request(method, null))
    assert.equal(response.status, 200)
    assert.equal(Object.hasOwn(contexts.at(-1)!, "legacyQueueGeneration"), false)
    assert.equal(Object.hasOwn(contexts.at(-1)!, "purpose"), false)
    conflict = true
    response = await routes[method](request(method)); assert.equal(response.status, 409); assert.equal((await response.json()).item.id, row.id)
    conflict = false
    for (const wrapped of [false, true]) {
      const pause = { code: "PT503", message: "legacy_collection_write_paused", details: "retainOnDevice=true secret SQL detail", hint: "private" }
      dbError = wrapped ? new Error("private wrapper", { cause: new Error("private nested wrapper", { cause: pause }) }) : pause
      throwDbError = wrapped
      response = await routes[method](request(method))
      assert.equal(response.status, 503); assert.equal(response.headers.get("X-Activity-Event"), null)
      assert.deepEqual(await response.json(), { error: "Collection uploads are paused. Keep this change on this device and reload the app before reviewing it.", code: "collection_queue_upgrade_required", retainOnDevice: true })
    }
    dbError = null; throwDbError = false
    before = writes.length
    assert.ok(before > 0)
  }
  const user = { id: actor, user_metadata: {} } as Parameters<typeof operations.saveCollectionItem>[1]
  for (const transport of ["rest", "mcp"] as const) {
    await withAuditActor(actor, async () => {
      assert.equal((await operations.saveCollectionItem(request("POST"), user, true, { ownerUserId: owner, memberIds: [actor, owner] })).status, 200)
      assert.equal((await operations.deleteCollectionItem(request("DELETE"), user, true, owner)).status, 200)
    }, { principal: { actorId: actor, transport, credentialId: "synthetic-credential", permissions: [] }, ownerUserId: owner, memberIds: [actor, owner], requestId: "synthetic-request" })
    for (const context of contexts.slice(-2)) {
      assert.equal(context.source, transport); assert.equal(context.clientId, "synthetic-credential")
      assert.equal(Object.hasOwn(context, "purpose"), false); assert.equal(Object.hasOwn(context, "legacyQueueGeneration"), false)
    }
  }
  // Existing non-first-party fallback handlers also retain a typed database pause.
  // First-party requests above must never reach these direct mutation methods.
  assert.equal(directWrites, 0)
  fallback = true
  for (const wrapped of [false, true]) {
    const pause = { code: "PT503", message: "legacy_collection_write_paused", details: "private SQL" }
    dbError = wrapped ? { cause: new Error("private", { cause: pause }) } : pause
    for (const run of [
      () => operations.saveCollectionItem(request("POST"), user),
      () => operations.updateCollectionStatus(request("PATCH"), user),
      () => operations.deleteCollectionItem(request("DELETE"), user),
    ]) {
      const response = await withAuditActor(actor, run)
      assert.equal(response.status, 503); assert.equal((await response.json()).code, "collection_queue_upgrade_required")
    }
  }
  assert.equal(directWrites, 6)
  assert.equal(auditContextHeader(), undefined)
}
void main()
