import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { createDeveloperKey } from "../../lib/server/developer-access/key-secret"

async function main() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://synthetic.supabase.test"
  process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-service-role"
  // @ts-expect-error Bun module mocks are confined to this subprocess.
  const { mock } = await import("bun:test")
  mock.module("server-only", () => ({}))
  const actor = "00820000-0000-4000-8000-000000000002", owner = "00820000-0000-4000-8000-000000000001"
  let oauthSession = false, signedIn = true, revoked = false, paid = true, readonly = false, errorCode: string | null = null
  const credentialId = createHash("sha256").update("synthetic").digest("hex")
  const permissions = () => readonly ? ["collection:read", "binders:read"] : ["collection:write", "binders:write"]
  mock.module("../../lib/supabase/server", () => ({ createClient: async () => ({ auth: {
    getClaims: async () => ({ data: { claims: { sub: actor, ...(oauthSession ? { client_id: "synthetic-client" } : {}) } } }),
    getUser: async () => ({ data: { user: signedIn ? { id: actor } : null } }),
  } }) }))
  mock.module("../../lib/server/developer-access/grants", () => ({ authenticateMcpToken: async () => {
    if (revoked) throw new Error("revoked")
    return { actorId: actor, credentialId, transport: "mcp", permissions: permissions() }
  } }))
  const calls: Array<{ path: string; body: Record<string, unknown>; header: Record<string, unknown> | null }> = []
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url)
    assert.equal(url.hostname, "synthetic.supabase.test")
    const body = init?.body ? JSON.parse(String(init.body)) : {}
    const header = JSON.parse(new Headers(init?.headers).get("x-holo-audit-context") ?? "null")
    calls.push({ path: url.pathname, body, header })
    if (url.pathname.endsWith("/authenticate_developer_request")) return Response.json(revoked ? { error: "invalid_api_key" } : {
      actor_id: actor, credential_id: credentialId, permissions: permissions(), owner_user_id: owner, member_ids: [owner, actor],
      billing_access: { perpetual: paid }, budget: { allowed: true },
    })
    if (url.pathname.endsWith("/resolve_developer_access")) return Response.json({ owner_user_id: owner, member_ids: [owner, actor], billing_access: { perpetual: paid }, budget: { allowed: true } })
    if (url.pathname.endsWith("/partnerships")) return Response.json({ owner_user_id: owner, user1_id: owner, user2_id: actor })
    if (url.pathname.endsWith("/billing_partner_allowed")) return Response.json(true)
    if (url.pathname.endsWith("/storage_execute_v1")) {
      assert.ok(init?.signal instanceof AbortSignal)
      assert.equal(init.signal.aborted, false)
      assert.equal(body.owner_id, owner)
      assert.deepEqual(header?.actor, { kind: "user", userId: actor })
      assert.equal(header?.operationId, "synthetic-bridge-auth")
      assert.equal(header?.batchId, "synthetic-bridge-auth")
      assert.equal("actor" in body, false)
      assert.equal("source" in body, false)
      if (errorCode === "ABORT") throw new DOMException("synthetic transport timeout", "AbortError")
      if (errorCode) return Response.json({ code: errorCode, message: "private SQL certificate", details: "secret" }, { status: 400 })
      return Response.json({ inventoryRevision: 2, changed: true, selectedItemIds: [], acquiredItemIds: [], evidence: { certificate: "private" } })
    }
    throw new Error("Unexpected request " + url.pathname)
  }
  const { executeAppStorageRequest, executeRestStorageRequest, executeMcpStorageRequest, executeDeveloperStorageOperation } = await import("../../lib/server/operations/storage-execution")
  const command = { operationId: "synthetic-bridge-auth", inventoryRevision: 1, collections: [], commands: [{ kind: "add", itemId: "synthetic-copy", identity: { kind: "pokemon", pokemonId: 1 }, grading: null, acquiredAt: null }] }
  const key = createDeveloperKey()
  const request = (extra: Record<string, string> = {}, value: unknown = command) => new Request("https://holofolder.com/app/api/inventory", {
    method: "POST", headers: { "content-type": "application/json", "X-Binder-Owner": owner,
      "x-holo-audit-context": '{"actor":{"kind":"user","userId":"forged"},"source":"migration"}', ...extra }, body: JSON.stringify(value),
  })
  const count = () => calls.filter(c => c.path.endsWith("/storage_execute_v1")).length
  await executeAppStorageRequest(request(), "inventory")
  assert.equal(calls.at(-1)?.header?.source, "app")
  await executeAppStorageRequest(request(), "inventory")
  assert.deepEqual(calls.at(-1)?.header, calls.filter(c => c.path.endsWith("/storage_execute_v1"))[0].header, "delivery retry preserves trusted ledger intent")
  let before = count()
  oauthSession = true
  await assert.rejects(executeAppStorageRequest(request(), "inventory")); oauthSession = false
  signedIn = false
  await assert.rejects(executeAppStorageRequest(request(), "inventory")); signedIn = true
  await assert.rejects(executeAppStorageRequest(request({ origin: "https://attacker.invalid" }), "inventory"))
  await assert.rejects(executeAppStorageRequest(request({ "X-Binder-Owner": actor }), "inventory"))
  await assert.rejects(executeAppStorageRequest(request({}, { ...command, source: "app" }), "inventory"))
  assert.equal(count(), before)
  await executeRestStorageRequest(request({ authorization: "Bearer " + key.key }), "inventory")
  assert.equal(calls.at(-1)?.header?.source, "rest")
  assert.equal(calls.at(-1)?.header?.clientId, credentialId)
  await executeMcpStorageRequest(request({ authorization: "Bearer synthetic-oauth" }), "inventory", command)
  assert.equal(calls.at(-1)?.header?.source, "mcp")
  before = count()
  readonly = true
  await assert.rejects(executeRestStorageRequest(request({ authorization: "Bearer " + key.key }), "inventory"))
  await assert.rejects(executeMcpStorageRequest(request({ authorization: "Bearer synthetic-oauth" }), "inventory", command))
  readonly = false; paid = false
  await assert.rejects(executeRestStorageRequest(request({ authorization: "Bearer " + key.key }), "inventory"))
  await assert.rejects(executeMcpStorageRequest(request({ authorization: "Bearer synthetic-oauth" }), "inventory", command))
  paid = true; revoked = true
  await assert.rejects(executeRestStorageRequest(request({ authorization: "Bearer " + key.key }), "inventory"))
  await assert.rejects(executeMcpStorageRequest(request({ authorization: "Bearer synthetic-oauth" }), "inventory", command))
  revoked = false
  await assert.rejects(executeDeveloperStorageOperation({ principal: { actorId: actor, credentialId, transport: "rest", permissions: ["collection:read"] }, ownerUserId: owner, memberIds: [actor], requestId: "synthetic" }, "inventory", command))
  await assert.rejects(executeDeveloperStorageOperation({ principal: { actorId: actor, credentialId, transport: "rest", permissions: ["binders:write"] }, ownerUserId: owner, memberIds: [actor], requestId: "synthetic" }, "slots", {}))
  assert.equal(count(), before)
  errorCode = "40001"
  await assert.rejects(executeAppStorageRequest(request(), "inventory"), (e: unknown) => e instanceof Error && !e.message.includes("certificate") && "status" in e && e.status === 409)
  errorCode = "ABORT"
  await assert.rejects(executeAppStorageRequest(request(), "inventory"), (e: unknown) => e instanceof Error && "status" in e && e.status === 503)
  assert.ok(calls.every(c => c.header?.source !== "migration"))
}
main().catch(error => { console.error(error); process.exitCode = 1 })
