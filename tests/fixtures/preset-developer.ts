import assert from "node:assert/strict"
import { fixture, owner, collection } from "./inventory-read-server"
import { createDeveloperKey } from "../../lib/server/developer-access/key-secret"
import type { OperationContext } from "../../lib/developer-api/types"
import { PRESET_OPERATIONS, PRESET_PERMISSIONS, PRESET_PREVIEW_LIMITS } from "../../lib/developer-api/presets"
import { assertSmokeResponse } from "../../scripts/api-smoke-assertions"
import { parseBinderCreationDraft } from "../../lib/binder-creation-draft"
import { parseCollectionCreation } from "../../lib/domain/storage-creation"
import { captureCompleteInventoryReadFence, isCompleteInventoryReadAfter, isCompleteInventorySnapshot } from "../../lib/collection/slot-snapshot"

async function main() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://synthetic.supabase.test"
  process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-service-role"
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "synthetic-anon"
  // @ts-expect-error Bun mocks stay isolated to this synthetic subprocess.
  const { mock } = await import("bun:test")
  mock.module("server-only", () => ({}))
  const key = createDeveloperKey(), partner = "33333333-3333-4333-8333-333333333333", grantId = "44444444-4444-4444-8444-444444444444"
  const oauth = { sessionId: "55555555-5555-4555-8555-555555555555", clientId: "66666666-6666-4666-8666-666666666666", expiresAt: Date.now() / 1000 + 3600 }
  let permissions: readonly string[] = PRESET_PERMISSIONS, paid = true, grant = true, allowed = true, budget = true, actor = owner
  let resolvedOwner = owner, members = [owner], f = fixture(0)
  let race: ((table: string, url: URL) => Response | void) | undefined
  const context = (transport: "rest" | "mcp"): OperationContext => ({ principal: { actorId: actor,
    credentialId: transport === "rest" ? key.id : grantId, permissions: [...PRESET_PERMISSIONS], transport, ...(transport === "mcp" ? { oauth } : {}) },
    ownerUserId: resolvedOwner, memberIds: [...members], requestId: "synthetic" })
  function reset() {
    f = fixture(0); permissions = PRESET_PERMISSIONS; paid = grant = allowed = budget = true; actor = resolvedOwner = owner; members = [owner]; race = undefined
    f.tables.developer_api_keys = [{ id: key.id, actor_id: actor, permissions: [...permissions], expires_at: "2099-01-01", revoked_at: null }]
    f.tables.tcg_cards = Array.from({ length: 25 }, (_, n) => ({ id: `synthetic-${String(n).padStart(2, "0")}`, set_id: "synthetic-set", local_id: String(n + 1),
      name_json: { en: `Synthetic ${n % 2 ? "Trainer" : "Energy"} ${n}`, fr: `Synthetic French ${n}` }, variants_json: { normal: true, reverse: true, holo: false }, external_ids_json: {} }))
    f.tables.tcg_sets = [{ id: "synthetic-set", name_en: "Synthetic set" }]
  }
  reset()
  let operationQueries = 0
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url)
    assert.equal(url.hostname, "synthetic.supabase.test", "never access hosted transport")
    const table = url.pathname.split("/").at(-1)!
    const overridden = race?.(table, url)
    if (overridden) return overridden
    if (url.pathname.includes("/auth/v1/admin/users/")) return Response.json({ id: actor, aud: "authenticated" })
    if (table === "authenticate_developer_request") return Response.json({ actor_id: actor, credential_id: key.id,
      owner_user_id: resolvedOwner, member_ids: members, permissions, billing_access: { perpetual: paid }, budget: { allowed: budget } })
    if (table === "verify_developer_oauth_session") return Response.json(grant ? { id: grantId, permissions } : null)
    if (table === "get_billing_access") return Response.json({ perpetual: paid })
    if (table === "resolve_developer_access") return Response.json({ owner_user_id: resolvedOwner, member_ids: members, billing_access: { perpetual: paid }, budget: { allowed: budget } })
    if (table === "consume_developer_preauth" || table === "consume_developer_request") return Response.json({ allowed: budget })
    if (table === "billing_partner_allowed") return Response.json(allowed)
    assert.ok(["developer_api_keys", "partnerships", "tcg_cards", "tcg_sets"].includes(table), "no executor/private state/cookie reader: " + table)
    operationQueries++
    return f.transport(input, init)
  }
  mock.module("../../lib/server/developer-access/grants", () => ({ authenticateMcpToken: async () => context("mcp").principal }))
  const { executeDeveloperOperation } = await import("../../lib/server/operations/developer-dispatch")
  const { handleRestRequest } = await import("../../lib/server/developer-access/http")
  const { handleMcpRequest } = await import("../../lib/server/mcp/http")
  async function call(transport: "rest" | "mcp", name: string, input: Record<string, unknown>) {
    const op = PRESET_OPERATIONS.find(o => o.name === name)!, query = new URLSearchParams(Object.entries(input).map(([k, v]) => [k, String(v)]))
    const headers = { authorization: "Bearer " + (transport === "rest" ? key.key : "synthetic-oauth"), "Content-Type": "application/json", Accept: "application/json, text/event-stream" }
    const response = transport === "rest"
      ? await handleRestRequest(new Request(`https://synthetic.test/app/api/v1${op.path}${op.method === "GET" ? "?" + query : ""}`, { headers, method: op.method, ...(op.method === "GET" ? {} : { body: JSON.stringify(input) }) }), { params: Promise.resolve({ path: op.path.slice(1).split("/") }) })
      : await handleMcpRequest(new Request("https://synthetic.test/app/mcp", { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: input } }) }))
    assert.equal(response.headers.get("cache-control"), "private, no-store")
    const body = await response.json(), result = transport === "mcp" && body.result ? body.result.structuredContent : body
    return { status: response.status, result }
  }
  for (const op of PRESET_OPERATIONS) for (const transport of ["rest", "mcp"] as const) {
    const input = op.name === "preview_storage_preset" ? { presetId: "blank", version: "1" } : {}
    const { result } = await call(transport, op.name, input)
    assertSmokeResponse(op.name, result, input)
  }
  const preview = (input: Record<string, unknown>, ctx = context("rest")) => executeDeveloperOperation(ctx, "preview_storage_preset", { version: "1", ...input }) as Promise<any> // eslint-disable-line @typescript-eslint/no-explicit-any
  const read = (input: Record<string, unknown> = {}) => executeDeveloperOperation(context("rest"), "list_storage_presets", input) as Promise<any> // eslint-disable-line @typescript-eslint/no-explicit-any
  const seen = new Set<string>(); let cursor: string | null = null
  do { const page = await read({ limit: 2, ...(cursor ? { cursor } : {}) }); page.data.forEach((p: { id: string }) => { assert.ok(!seen.has(p.id)); seen.add(p.id) }); cursor = page.nextCursor } while (cursor)
  assert.equal(seen.size, 15)
  assert.equal((await read()).data.filter((p: { supported: boolean }) => !p.supported).length, 2)
  const first = await read({ limit: 2 })
  await assert.rejects(read({ limit: 3, cursor: first.nextCursor }), { code: "invalid_pagination" })
  await assert.rejects(read({ limit: 101 }), { code: "invalid_input" })
  const national = await preview({ presetId: "national-dex" })
  assert.equal(national.targetCount, 1025); assert.equal(national.manifest.entries[1024].target.pokemonId, 1025)
  assert.equal((await preview({ presetId: "generation-1" })).targetCount, 151)
  assert.equal((await preview({ presetId: "generation-9" })).targetCount, 120)
  const selected = await preview({ presetId: "selected-species", speciesIds: [925, 924, 143] })
  assert.deepEqual(selected.manifest.entries.map((e: { target: { pokemonId: number } }) => e.target.pokemonId), [925, 924, 143])
  const blank = await preview({ presetId: "blank" }); assert.equal(blank.targetCount, 0); assert.deepEqual(blank.manifest.entries, [])
  assert.equal((await preview({ presetId: "selected-species", speciesIds: [] })).targetCount, 0)
  for (const speciesIds of [[25, 25], [0], [1026], Array(1026).fill(1)]) await assert.rejects(preview({ presetId: "selected-species", speciesIds }), { code: "invalid_input" })
  for (const presetId of ["set", "master-set"]) await assert.rejects(preview({ presetId }), { code: "unsupported_preset_scope" })
  await assert.rejects(preview({ presetId: "unknown" }), { code: "not_found" })
  for (const input of [{ presetId: "blank", speciesIds: [] }, { presetId: "blank", ownerUserId: owner }, { presetId: "selected-species" }, { presetId: "blank", version: "2" }, { presetId: " blank" }, { presetId: "selected-species", speciesIds: [25], forms: ["alolan"] }]) await assert.rejects(preview(input), { code: "invalid_input" })
  const printing = { cardId: "synthetic-00", language: "en", finish: "reverse_holo" }
  const targets = await preview({ presetId: "selected-printings", printings: [printing, printing, { cardId: "synthetic-01", language: "fr" }] })
  assert.equal(targets.targetCount, 3); assert.equal(targets.manifest.entries[0].target.finish, "reverse_holo")
  assert.notEqual(targets.manifest.entries[0].id, targets.manifest.entries[1].id)
  assert.equal(targets.manifest.entries[2].target.language, "fr"); assert.equal(targets.unknowns.length, 1)
  assert.equal((await preview({ presetId: "selected-printings", printings: [] })).targetCount, 0)
  const all = f.tables.tcg_cards.map(c => ({ cardId: c.id, language: "en" }))
  assert.equal((await preview({ presetId: "selected-printings", printings: all })).targetCount, 25)
  assert.ok(f.requests.some(r => r.table === "tcg_cards" && r.url.searchParams.getAll("id").some(v => v.startsWith("gt."))), "real keyset continuation")
  assert.ok(f.requests.filter(r => r.table === "tcg_cards").every(r => r.url.searchParams.get("limit") === "10"))
  for (const printings of [[{ ...printing, language: "ja" }], [{ ...printing, cardId: "unknown" }], [{ ...printing, finish: "holo" }], [{ ...printing, finish: "ultra_rare" }]]) await assert.rejects(preview({ presetId: "selected-printings", printings }), { code: "preset_catalog_unavailable" })
  await assert.rejects(preview({ presetId: "selected-printings", printings: [...all, { cardId: "synthetic-26", language: "en" }] }), { code: "preset_scope_too_large" })
  await assert.rejects(preview({ presetId: "selected-printings", printings: Array(101).fill(printing) }), { code: "invalid_input" })
  const fence = captureCompleteInventoryReadFence()
  assert.equal(isCompleteInventorySnapshot(targets), false); assert.equal(isCompleteInventoryReadAfter(targets, fence), false)
  for (const text of [national, targets, await read()].map(v => JSON.stringify(v))) for (const secret of [owner, partner, key.id, "operationId", "collectionId", "slotIds", "certificate", "assetIds", "history", "wantedCards", "inventoryRevision", "completeSnapshot\":true"]) assert.equal(text.includes(secret), false, secret)
  const draft = parseBinderCreationDraft({ version: 1, operationId: "synthetic-creation-1", ownerUserId: owner, name: "Synthetic", manifest: targets.manifest })
  assert.ok(Object.isFrozen(draft.manifest.entries))
  const command = parseCollectionCreation({ version: 1, operationId: draft.operationId, inventoryRevision: 0, collectionId: collection, name: draft.name, kind: "binder", defaultPresentation: "binder", location: null, grid: null, manifest: draft.manifest, slotIds: ["synthetic-slot-1", "synthetic-slot-2", "synthetic-slot-3"] })
  assert.deepEqual(command.manifest, targets.manifest)
  targets.manifest.entries.pop(); assert.equal(draft.manifest.entries.length, 3)
  assert.deepEqual((await preview({ presetId: "national-dex" })), national, "no new read-time intent")
  for (const transport of ["rest", "mcp"] as const) {
    reset(); actor = partner; members = [owner, partner]; f.tables.developer_api_keys[0].actor_id = partner
    f.tables.partnerships = [{ id: collection, owner_user_id: owner, user1_id: owner, user2_id: partner }]
    assert.equal((await call(transport, "preview_storage_preset", { version: "1", presetId: "generation-1" })).result.targetCount, 151)
    for (const mode of ["revoked", "permissions", "billing", "partner", "unlink", "owner"]) {
      const saved = structuredClone(f.tables), originalMembers = [...members]
      race = table => {
        if (table !== "tcg_cards") return
        if (mode === "revoked") { grant = false; f.tables.developer_api_keys[0].revoked_at = "2026-01-01" }
        if (mode === "permissions") { permissions = []; f.tables.developer_api_keys[0].permissions = [] }
        if (mode === "billing") paid = false
        if (mode === "partner") allowed = false
        if (mode === "unlink") f.tables.partnerships = []
        if (mode === "owner") resolvedOwner = partner
      }
      await assert.rejects(preview({ presetId: "selected-printings", printings: [printing] }, context(transport)), mode)
      race = undefined; Object.assign(f.tables, saved); members = originalMembers; resolvedOwner = owner; paid = grant = allowed = true; permissions = PRESET_PERMISSIONS
    }
    for (const mode of ["revoked", "permissions", "billing", "owner"]) {
      const ctx = context(transport), saved = structuredClone(f.tables)
      if (mode === "revoked") { grant = false; f.tables.developer_api_keys[0].revoked_at = "2026-01-01" }
      if (mode === "permissions") { permissions = []; f.tables.developer_api_keys[0].permissions = [] }
      if (mode === "billing") paid = false
      if (mode === "owner") ctx.ownerUserId = partner
      await assert.rejects(executeDeveloperOperation(ctx, "list_storage_presets", {}), mode)
      Object.assign(f.tables, saved); paid = grant = true; permissions = PRESET_PERMISSIONS
    }
    reset(); paid = false
    assert.equal((await call(transport, "list_storage_presets", {})).result.error.code, "premium_required")
    paid = true; budget = false
    assert.equal((await call(transport, "list_storage_presets", {})).result.error.code, "rate_limited")
  }
  for (const permission of PRESET_PERMISSIONS) {
    reset(); const ctx = context("rest"); ctx.principal.permissions = PRESET_PERMISSIONS.filter(p => p !== permission)
    const before = operationQueries
    await assert.rejects(executeDeveloperOperation(ctx, "list_storage_presets", {}), { code: "insufficient_permissions" })
    assert.equal(operationQueries, before)
  }
  for (const mode of ["alias", "canonical", "missing-set", "missing-number", "oversized", "short-page", "duplicate", "error"]) {
    reset()
    if (mode === "alias" || mode === "canonical") f.tables.tcg_cards[1].external_ids_json = { catalog: mode === "alias" ? { aliasIds: [printing.cardId] } : { canonicalId: printing.cardId } }
    if (mode === "missing-set") f.tables.tcg_sets = []
    if (mode === "missing-number") f.tables.tcg_cards[0].local_id = ""
    if (mode === "oversized") f.tables.tcg_cards[0].name_json = { en: "x".repeat(PRESET_PREVIEW_LIMITS.catalogBytes + 1) }
    if (mode === "short-page") race = (table, url) => table === "tcg_cards" && url.searchParams.get("id")?.startsWith("in.") ? Response.json([]) : undefined
    if (mode === "duplicate") race = (table, url) => table === "tcg_cards" && url.searchParams.get("id")?.startsWith("in.") ? Response.json([f.tables.tcg_cards[0], f.tables.tcg_cards[0]]) : undefined
    if (mode === "error") race = table => table === "tcg_cards" ? Response.json({ code: "42501", message: "PRIVATE DETAILS" }, { status: 403 }) : undefined
    await assert.rejects(preview({ presetId: "selected-printings", printings: [printing] }), error => !String(error).includes("PRIVATE"), mode)
  }
  reset()
  let canonicalReads = 0
  race = (table, url) => {
    if (table === "tcg_cards" && url.searchParams.get("id")?.startsWith("in.") && ++canonicalReads === 2) f.tables.tcg_cards[0].variants_json = { reverse: false }
  }
  await assert.rejects(preview({ presetId: "selected-printings", printings: [printing] }), { code: "preset_catalog_unavailable" })
  // An unbounded ambiguous stream cannot consume more than the shared finite request budget.
  reset()
  let requests = 0
  race = (table, url) => {
    if (table !== "tcg_cards" || !url.searchParams.has("external_ids_json")) return
    requests++
    const after = Number(url.searchParams.get("id")?.slice(3) ?? 0)
    return Response.json(Array.from({ length: 10 }, (_, n) => ({ id: String(after + n + 1).padStart(6, "0"), external_ids_json: { catalog: { aliasIds: [printing.cardId] } } })))
  }
  await assert.rejects(preview({ presetId: "selected-printings", printings: [printing] }), { code: "preset_read_unavailable" })
  assert.ok(requests <= PRESET_PREVIEW_LIMITS.catalogRequests)
  reset()
  const oldNow = Date.now
  let catalogStarted = false
  race = table => { if (table === "tcg_cards") catalogStarted = true }
  Date.now = () => oldNow() + (catalogStarted ? PRESET_PREVIEW_LIMITS.timeoutMs + 1 : 0)
  try { await assert.rejects(preview({ presetId: "selected-printings", printings: [printing] }), { code: "preset_read_unavailable" }) } finally { Date.now = oldNow }
  reset()
  for (const op of PRESET_OPERATIONS) for (const transport of ["rest", "mcp"] as const) {
    const input = op.name === "preview_storage_preset" ? { presetId: "selected-species", version: "1", speciesIds: [925, 924, 143] } : { limit: 2 }
    const result = await call(transport, op.name, input)
    assertSmokeResponse(op.name, result.result, input)
    assert.equal(op.responseSchema!.safeParse({ ...result.result, private: "forbidden" }).success, false)
  }
  const printingInput = { presetId: "selected-printings", version: "1", printings: [printing, printing] }
  const restPrinting = (await call("rest", "preview_storage_preset", printingInput)).result
  const mcpPrinting = (await call("mcp", "preview_storage_preset", printingInput)).result
  assert.deepEqual(restPrinting, mcpPrinting)
  for (const transport of ["rest", "mcp"] as const) {
    for (const [presetId, code] of [["set", "unsupported_preset_scope"], ["master-set", "unsupported_preset_scope"], ["unknown", "not_found"]]) {
      const result = await call(transport, "preview_storage_preset", { presetId, version: "1" })
      assert.equal(result.result.error.code, code)
      assert.equal("manifest" in result.result, false)
    }
  }
  const responseSchema = PRESET_OPERATIONS.find(o => o.name === "preview_storage_preset")!.responseSchema!
  for (const field of ["certificate", "assetIds", "ownerUserId", "history"]) {
    const bad = structuredClone(restPrinting); bad.manifest.entries[0].target[field] = "PRIVATE"
    assert.equal(responseSchema.safeParse(bad).success, false)
  }
  console.log("synthetic authority, copied targets, strict privacy, finite catalog and REST/MCP parity passed")
}
main().catch(error => { console.error(error); process.exitCode = 1 })
