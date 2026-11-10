import assert from "node:assert/strict"
import { fixture, owner, collection } from "./inventory-read-server"
import { createDeveloperKey } from "../../lib/server/developer-access/key-secret"
import type { OperationContext } from "../../lib/developer-api/types"
import { isCompleteInventorySnapshot, captureCompleteInventoryReadFence, isCompleteInventoryReadAfter } from "../../lib/collection/slot-snapshot"

async function main() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://synthetic.supabase.test"
  process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-service-role"
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "synthetic-anon"
  // @ts-expect-error Bun module mocks stay in this isolated subprocess.
  const { mock } = await import("bun:test")
  mock.module("server-only", () => ({}))
  const key = createDeveloperKey(), partner = "33333333-3333-4333-8333-333333333333"
  const grantId = "44444444-4444-4444-8444-444444444444"
  const permissions = ["collection:read", "binders:read"] as const
  let grantPermissions: readonly string[] = permissions
  let actor = owner, paid = true, grant = true, budget = true
  let f = fixture()
  const oauth = { sessionId: "55555555-5555-4555-8555-555555555555", clientId: "66666666-6666-4666-8666-666666666666", expiresAt: Date.now() / 1000 + 3600 }
  const context = (transport: "rest" | "mcp"): OperationContext => ({ principal: { actorId: actor,
    credentialId: transport === "rest" ? key.id : grantId, permissions, transport, ...(transport === "mcp" ? { oauth } : {}) },
    ownerUserId: owner, memberIds: actor === owner ? [owner] : [owner, actor], requestId: "synthetic" })
  // The actual key authenticator and native recheck share the same synthetic current rows.
  function reset(size = 1031) {
    f = fixture(size); grantPermissions = permissions; paid = true; grant = true; budget = true; actor = owner
    f.tables.developer_api_keys = [{ id: key.id, actor_id: actor, permissions: [...permissions], expires_at: "2099-01-01", revoked_at: null }]
  }
  reset()
  let race: ((table: string, url: URL) => Response | void) | undefined
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url)
    assert.equal(url.hostname, "synthetic.supabase.test", "no hosted access")
    const table = url.pathname.split("/").at(-1)!
    const override = race?.(table, url)
    if (override) return override
    if (url.pathname.includes("/auth/v1/admin/users/")) return Response.json({ id: actor, aud: "authenticated" })
    if (table === "authenticate_developer_request") return Response.json({ actor_id: actor, credential_id: key.id,
      owner_user_id: owner, member_ids: context("rest").memberIds, permissions, billing_access: { perpetual: paid }, budget: { allowed: budget } })
    if (table === "verify_developer_oauth_session") {
      const args = JSON.parse(String(init?.body))
      assert.deepEqual(args, { session: oauth.sessionId, actor, client: oauth.clientId, grant_version: grantId })
      return Response.json(grant ? { id: grantId, permissions: grantPermissions } : null)
    }
    if (table === "get_billing_access") return Response.json({ perpetual: paid })
    if (table === "resolve_developer_access") return Response.json({ owner_user_id: owner, member_ids: context("mcp").memberIds,
      billing_access: { perpetual: paid }, budget: { allowed: budget } })
    if (table === "consume_developer_preauth" || table === "consume_developer_request") return Response.json({ allowed: true })
    assert.ok(!/storage_execute|command|audit|recovery/.test(table), "reads never execute a write or protected audit read")
    return f.transport(input, init)
  }
  // Only issuer verification is synthetic, current OAuth session/grant is rechecked by the real read adapter.
  mock.module("../../lib/server/developer-access/grants", () => ({ authenticateMcpToken: async () => context("mcp").principal }))
  const { executeDeveloperOperation } = await import("../../lib/server/operations/developer-dispatch")
  const { handleRestRequest } = await import("../../lib/server/developer-access/http")
  const { handleMcpRequest } = await import("../../lib/server/mcp/http")
  const { NATIVE_READ_OPERATIONS } = await import("../../lib/developer-api/native-read")
  async function call(transport: "rest" | "mcp", name: string, input: Record<string, unknown>) {
    const op = NATIVE_READ_OPERATIONS.find(o => o.name === name)!
    let path = op.path
    const query = new URLSearchParams()
    for (const [k, v] of Object.entries(input)) {
      if (path.includes(`{${k}}`)) path = path.replace(`{${k}}`, encodeURIComponent(String(v)))
      else query.set(k, String(v))
    }
    const headers = { authorization: "Bearer " + (transport === "rest" ? key.key : "synthetic-oauth"), "Content-Type": "application/json", Accept: "application/json, text/event-stream" }
    const response = transport === "rest"
      ? await handleRestRequest(new Request(`https://synthetic.test/app/api/v1${path}?${query}`, { headers }), { params: Promise.resolve({ path: path.slice(1).split("/") }) })
      : await handleMcpRequest(new Request("https://synthetic.test/app/mcp", { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: input } }) }))
    assert.equal(response.headers.get("cache-control"), "private, no-store")
    const body = await response.json()
    return { status: response.status, result: transport === "mcp" && body.result ? body.result.structuredContent : body, raw: body }
  }
  const inputs: Record<string, Record<string, unknown>> = { list_inventory_items: { limit: 100 }, get_inventory_item: { id: "synthetic-00001" },
    list_storage_collections: {}, list_storage_slots: { collectionId: collection, limit: 100 }, get_storage_slot: { collectionId: collection, id: "synthetic-00001" } }
  for (const op of NATIVE_READ_OPERATIONS) {
    for (const transport of ["rest", "mcp"] as const) {
      const result = await call(transport, op.name, inputs[op.name])
      assert.equal(result.result.error?.code, undefined, JSON.stringify(result))
      { assert.ok(op.responseSchema!.safeParse(result.result).success); assert.equal(result.result.completeSnapshot, false) }
    }
  }
  const read = (name = "list_inventory_items", input: Record<string, unknown> = {}, transport: "rest" | "mcp" = "rest") => executeDeveloperOperation(context(transport), name, input) as Promise<Record<string, any>> // eslint-disable-line @typescript-eslint/no-explicit-any
  const fence = captureCompleteInventoryReadFence()
  // Every immutable source stream also crosses the PostgREST 1000-row cap.
  f.tables.binder_legacy_rows = f.tables.binder_slots.map((s, n) => ({ legacy_row_id: `source-${String(n).padStart(5, "0")}`,
    owner_user_id: owner, collection_id: collection, slot_id: s.id, source_row: { synthetic: "PRIVATE SOURCE" } }))
  const first = await read("list_inventory_items", { limit: 100 })
  assert.equal(first.total, 1031); assert.equal(first.data.length, 100)
  assert.equal(isCompleteInventorySnapshot(first), false); assert.equal(isCompleteInventoryReadAfter(first, fence), false)
  let cursor = first.nextCursor, count = first.data.length
  const ids = new Set(first.data.map((i: { id: string }) => i.id))
  while (cursor) { const page = await read("list_inventory_items", { limit: 100, cursor }); count += page.data.length; page.data.forEach((i: { id: string }) => ids.add(i.id)); cursor = page.nextCursor }
  assert.equal(count, 1031); assert.equal(ids.size, 1031)
  assert.ok(f.requests.some(r => r.table === "inventory_items" && r.url.searchParams.has("id")))
  for (const bad of ["bad", first.nextCursor + "x", "a".repeat(1025)]) await assert.rejects(read("list_inventory_items", { limit: 100, cursor: bad }))
  for (const input of [{ limit: 99, cursor: first.nextCursor }, { limit: 100, cursor: first.nextCursor, cardId: "synthetic-energy" }]) await assert.rejects(read("list_inventory_items", input), { code: "invalid_pagination" })
  await assert.rejects(read("list_inventory_items", { limit: 100, cursor: first.nextCursor }, "mcp"), { code: "invalid_pagination" })
  const oauthPage = await read("list_inventory_items", { limit: 100 }, "mcp")
  for (const field of ["sessionId", "clientId", "expiresAt"] as const) {
    const saved = { ...oauth }
    if (field === "expiresAt") oauth.expiresAt += 60
    else oauth[field] = "77777777-7777-4777-8777-777777777777"
    await assert.rejects(read("list_inventory_items", { limit: 100, cursor: oauthPage.nextCursor }, "mcp"), { code: "invalid_pagination" })
    Object.assign(oauth, saved)
  }
  assert.equal((await read("list_inventory_items", { limit: 100, cursor: oauthPage.nextCursor }, "mcp")).data.length, 100)
  for (const change of ["inventory", "content", "layout", "metadata", "settings"]) {
    reset(3)
    const before = await read("list_inventory_items", { limit: 1 })
    if (change === "inventory") f.tables.inventory_owner_state[0].inventory_revision = 8
    if (change === "content") f.tables.storage_collection_state[0].version = 8
    if (change === "layout") f.tables.storage_collection_state[0].layout_revision = 8
    if (change === "metadata") f.tables.binders[0].name = "Synthetic changed"
    if (change === "settings") f.tables.user_settings.push({ user_id: owner, binder_rows: 4, binder_cols: 3, updated_at: "2099-01-01" })
    await assert.rejects(read("list_inventory_items", { limit: 1, cursor: before.nextCursor }), { code: "stale_native_cursor" })
  }
  // Slot continuations preserve persisted positions over the full >1000-slot stream.
  reset()
  let slotPage = await read("list_storage_slots", { collectionId: collection, limit: 100 })
  let slotCount = slotPage.data.length
  while (slotPage.nextCursor) {
    slotPage = await read("list_storage_slots", { collectionId: collection, limit: 100, cursor: slotPage.nextCursor })
    slotCount += slotPage.data.length
  }
  assert.equal(slotCount, 1031)
  assert.equal(slotPage.data.at(-1).position, 2060)
  reset(3)
  const rest = (await call("rest", "list_storage_slots", { collectionId: collection })).result
  const mcp = (await call("mcp", "list_storage_slots", { collectionId: collection })).result
  assert.deepEqual(rest, mcp)
  assert.deepEqual(rest.data.map((s: { position: number }) => s.position), [0, 2, 4])
  assert.equal(rest.data[1].placementVersion, 1); assert.equal(rest.data[1].itemVersion, 1)
  f.tables.inventory_items[1].grading = { provider: { kind: "known", id: "psa" }, grade: "10", scale: null, designation: null, holder: "recorded", subgrades: [], certificate: "PRIVATE CERTIFICATE", label: { variant: "recorded", assetIds: ["PRIVATE ASSET"] } }
  f.tables.inventory_items[1].legacy_source = { private: "PRIVATE SOURCE" }
  f.tables.binder_slots[1].wanted_cards = [{ card_id: "synthetic-energy", card_name: "Synthetic", added_at: "2026-01-01", card_image: "https://private.invalid/asset", wanted_by: [owner] }]
  const item = await read("get_inventory_item", { id: "synthetic-00001" })
  assert.equal(item.data.grading.grade, "10"); assert.equal(item.data.grading.labelVariant, "recorded")
  const slot = await read("get_storage_slot", { collectionId: collection, id: "synthetic-00001" })
  const text = JSON.stringify([item, slot])
  for (const forbidden of ["PRIVATE", "certificate", "assetIds", "legacySource", "wanted_by", "card_image", "private.invalid", "presetManifest"]) assert.equal(text.includes(forbidden), false, forbidden)
  for (const transport of ["rest", "mcp"] as const) {
    reset(2); actor = partner; f.tables.developer_api_keys[0].actor_id = partner
    f.tables.partnerships = [{ id: collection, owner_user_id: owner, user1_id: owner, user2_id: partner }]
    assert.equal((await read("list_inventory_items", {}, transport)).total, 2)
    for (const mode of ["unlink", "owner", "membership", "billing", "revoked", "permissions", "inventory", "content", "layout", "metadata", "count", "error"]) {
      const saved = structuredClone(f.tables)
      race = (table, url) => {
        if (table !== "inventory_items" || !url.searchParams.has("order")) return
        if (mode === "unlink") f.tables.partnerships = []
        if (mode === "owner") f.tables.partnerships[0].owner_user_id = partner
        if (mode === "membership") f.tables.partnerships[0].id = key.id
        if (mode === "billing") paid = false
        if (mode === "revoked") { f.tables.developer_api_keys[0].revoked_at = "2026-01-01"; grant = false }
        if (mode === "permissions") { f.tables.developer_api_keys[0].permissions = []; grantPermissions = [] }
        if (mode === "inventory") f.tables.inventory_owner_state[0].inventory_revision = 8
        if (mode === "content") f.tables.storage_collection_state[0].version = 8
        if (mode === "layout") f.tables.storage_collection_state[0].layout_revision = 8
        if (mode === "metadata") f.tables.binders[0].name = "Synthetic rename"
        if (mode === "count") f.tables.binder_slots.pop()
        if (mode === "error") return Response.json({ code: "42501", message: "PRIVATE DETAILS" }, { status: 403 })
      }
      await assert.rejects(read("list_inventory_items", {}, transport), mode)
      race = undefined; f.tables = Object.assign(f.tables, saved); paid = true; grant = true; grantPermissions = permissions
    }
  }
  reset(2)
  for (const scope of ["collection:read", "binders:read"] as const) {
    const ctx = context("rest"); ctx.principal.permissions = permissions.filter(p => p !== scope)
    const before = f.requests.length
    await assert.rejects(executeDeveloperOperation(ctx, "list_inventory_items", {}), { code: "insufficient_permissions" })
    assert.equal(f.requests.length, before)
  }
  for (const invalid of [{ ownerUserId: owner }, { limit: 101 }, { cursor: "x".repeat(1025) }]) await assert.rejects(read("list_inventory_items", invalid), { code: "invalid_input" })
  const expired = context("mcp"); expired.principal.oauth = { ...oauth, expiresAt: 0 }
  await assert.rejects(executeDeveloperOperation(expired, "list_inventory_items", {}), { code: "native_read_forbidden" })
  reset(2)
  f.tables.inventory_items[0].identity = { kind: "card", cardId: "synthetic-energy" }
  f.tables.inventory_items[1].identity = { kind: "card", cardId: "synthetic-energy" }
  f.tables.inventory_placements.pop(); f.tables.binder_slots.pop()
  assert.equal((await read("list_inventory_items", { assignment: "unassigned" })).data[0].id, "synthetic-00001")
  assert.equal((await read("list_inventory_items", { collectionId: collection })).total, 1)
  assert.equal((await read("list_inventory_items", { cardId: "synthetic-energy" })).total, 2)
  await assert.rejects(read("list_storage_slots", { collectionId: "99999999-9999-4999-8999-999999999999" }), { code: "not_found" })
  await assert.rejects(read("get_inventory_item", { id: "foreign" }), { code: "not_found" })
  for (const transport of ["rest", "mcp"] as const) {
    budget = false
    const limited = await call(transport, "list_inventory_items", {})
    assert.equal(limited.result.error.code, "rate_limited")
    budget = true
  }
  reset(1)
  f.tables.binder_slots[0].id = "__proto__"
  f.tables.inventory_placements[0].slot_id = "__proto__"
  assert.equal((await read("get_storage_slot", { collectionId: collection, id: "__proto__" })).data.position, 0)
  reset(1)
  f.tables.binder_slots[0].wanted_cards = [{ card_id: "synthetic-energy", card_name: "Synthetic".repeat(150000), added_at: "2026-01-01" }]
  await assert.rejects(read("list_storage_slots", { collectionId: collection }), { code: "native_read_too_large" })
  reset(0); f.tables.storage_collection_state[0].authority = "legacy"
  await assert.rejects(read(), { code: "legacy_inventory_incomplete" })
  for (const source of ["catalog", "alias", "dex", "set"]) {
    reset(1)
    const cardId = source === "alias" ? "synthetic-alias" : "synthetic-budget-card"
    f.tables.inventory_items[0].identity = { kind: "card", cardId, language: "en" }
    f.tables.tcg_cards = [{ id: "synthetic-budget-card", set_id: "synthetic-budget-set", local_id: "1", name_en: "Synthetic card", name_json: { en: "Synthetic card" },
      external_ids_json: source === "alias" ? { catalog: { aliasIds: [cardId] } } : {} }]
    f.tables.tcg_sets = [{ id: "synthetic-budget-set", name_en: "Synthetic set" }]
    f.tables.tcg_card_dex_ids = [{ card_id: "synthetic-budget-card", dex_id: 6 }]
    const oversized = "x".repeat(33 * 1024 * 1024)
    if (source === "catalog") f.tables.tcg_cards[0].name_json = { en: "Synthetic card", xx: oversized }
    if (source === "alias") f.tables.tcg_cards[0].external_ids_json = { catalog: { aliasIds: [cardId] }, synthetic: oversized }
    if (source === "dex") f.tables.tcg_card_dex_ids[0].dex_id = oversized
    if (source === "set") f.tables.tcg_sets[0].name_en = oversized
    await assert.rejects(read("list_inventory_items", {}), { code: "inventory_read_unavailable" }, source + " response must consume the source byte budget")
  }
  console.log("synthetic trusted authority, privacy, large paging, race and REST/MCP proof passed")
}
main().catch(error => { console.error(error); process.exitCode = 1 })
