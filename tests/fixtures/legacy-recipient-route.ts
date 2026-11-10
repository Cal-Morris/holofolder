import assert from "node:assert/strict"
async function main() {
  // Synthetic identities; module mocks are isolated in this subprocess.
  // @ts-expect-error Bun module mocks are confined to subprocesses.
  const { mock } = await import("bun:test")
  mock.module("server-only", () => ({}))
  const actor = "00000000-0000-4000-8000-000000000001", owner = "00000000-0000-4000-8000-000000000002", binder = "00000000-0000-4000-8000-000000000003"
  let signedIn = actor, currentOwner = owner, accessible = true, schemaMissing = false, writes = 0, defaultCalls = 0, billingAllowed = true, billingSchemaMissing = false
  const session = { auth: { getClaims: async () => ({ data: { claims: signedIn ? { sub: signedIn } : null } }), getUser: async () => ({ data: { user: signedIn ? { id: signedIn } : null } }) } }
  const admin = {
    from(table: string) {
      const q = { select() { return q }, eq() { return q }, or() { return q }, limit() { return q }, async maybeSingle() {
        if (table === "partnerships") return { data: { owner_user_id: currentOwner, user1_id: signedIn, user2_id: currentOwner }, error: null }
        return { data: accessible && !schemaMissing ? { id: binder } : null, error: schemaMissing ? { code: "42P01" } : null }
      } }
      return q
    },
    rpc: async (name: string) => { if (name === "ensure_default_binder") defaultCalls++; return { data: billingAllowed, error: billingSchemaMissing ? { code: "PGRST202" } : null } },
  }
  mock.module("../../lib/supabase/server", () => ({ createClient: async () => session }))
  mock.module("../../lib/supabase/admin", () => ({ createAdminClient: () => admin }))
  mock.module("../../lib/server/operations/collection", () => ({
    saveCollectionItem: async (_request: unknown, user: { id: string }, atomic: boolean, membership: { ownerUserId: string }) => { writes++; assert.equal(user.id, actor); assert.equal(atomic, false); assert.equal(membership.ownerUserId, owner); return Response.json({ item: {} }) },
    updateCollectionStatus: async (_request: unknown, _user: unknown, verifiedOwner: string) => { writes++; assert.equal(verifiedOwner, owner); return Response.json({ item: {} }) },
    deleteCollectionItem: async (_request: unknown, _user: unknown, atomic: boolean, verifiedOwner: string) => { writes++; assert.equal(atomic, true); assert.equal(verifiedOwner, owner); return Response.json({ success: true }) },
  }))
  const { NextRequest } = await import("next/server")
  const routes = await import("../../app/api/collection/route")
  // Exercise the handlers over real local HTTP; the synthetic auth/database adapters cannot write hosted data.
  // @ts-expect-error Bun HTTP server is confined to this subprocess.
  const { serve } = await import("bun")
  const server = serve({ hostname: "127.0.0.1", port: 0, fetch: async (request: Request) => routes[request.method as "POST" | "PATCH" | "DELETE"](new NextRequest(request)) })
  for (const method of ["POST", "PATCH", "DELETE"] as const) {
    function request(binding: unknown = { kind: "account", actorUserId: actor, ownerUserId: owner, binderId: binder }, explicit: string | null = binder) {
      const params = new URLSearchParams({ pokemonId: "25" })
      if (explicit) params.set("binderId", explicit)
      if (binding && typeof binding === "object") {
        const value = binding as Record<string, string>
        if (value.actorUserId) params.set("actorUserId", value.actorUserId)
        if (value.ownerUserId) params.set("ownerUserId", value.ownerUserId)
      }
      return fetch(`http://127.0.0.1:${server.port}/app/api/collection?${params}`, { method, ...(method === "DELETE" ? {} : { body: JSON.stringify({ pokemonId: 25, pokemonName: "Synthetic", binderId: explicit, recipient: binding }), headers: { "Content-Type": "application/json" } }) })
    }
    let response = await request(null)
    assert.equal(response.status, 503); assert.equal((await response.json()).code, "collection_recipient_required")
    response = await request(undefined, null); assert.equal(response.status, 503)
    response = await request(); assert.equal(response.status, 200)
    const before = writes
    signedIn = "other-account"; response = await request(); assert.equal(response.status, 503); assert.equal((await response.json()).code, "collection_recipient_changed"); signedIn = actor
    currentOwner = actor; response = await request(); assert.equal(response.status, 503); currentOwner = owner
    accessible = false; response = await request(); assert.equal(response.status, 503); assert.equal((await response.json()).code, "collection_recipient_inaccessible"); accessible = true
    schemaMissing = true; response = await request(); assert.equal(response.status, 503); schemaMissing = false
    billingAllowed = false; response = await request(); assert.equal(response.status, 402); billingAllowed = true
    billingSchemaMissing = true; response = await request(); assert.equal(response.status, 503); billingSchemaMissing = false
    signedIn = ""; response = await request(); assert.equal(response.status, 401); signedIn = actor
    assert.equal(writes, before)
    // Unlink/relink to the same owner restores authority to this exact recipient, without changing intent.
    response = await request(); assert.equal(response.status, 200)
  }
  server.stop(true)
  assert.equal(defaultCalls, 0)
}
void main()
