import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { blankPreset, speciesPreset } from "@/lib/binder-creation-draft"
import { normalizeStorageResult } from "@/lib/server/operations/storage-contract"

const socket = process.env.STORAGE_CREATION_TEST_SOCKET
const owner = "00830000-0000-4000-8000-000000000001", partner = "00830000-0000-4000-8000-000000000002"
const stranger = "00830000-0000-4000-8000-000000000003"
const config = { host: "/Users/cal/.local/share/holofolder/issue384-creation-local/socket", port: 55584, user: "creation_test", database: "postgres" }

test("private creation SQL: twice applied, existing ACL/RLS/helpers preserved, atomic large-layout creation and recovery gate", { skip: !socket, timeout: 120000 }, async () => {
  if (!socket) return
  assert.equal(socket, config.host)
  const { Client } = await import("pg")
  const db = new Client(config)
  await db.connect()
  try {
    const functions = async () => (await db.query(`SELECT p.oid::regprocedure::text name,p.proacl::text acl,p.proowner,md5(pg_get_functiondef(p.oid)) digest
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','collection_audit_private')
      AND p.proname NOT IN ('storage_execute_v1','create_collection_v1','state') ORDER BY 1`)).rows
    const access = async () => (await db.query(`SELECT n.nspname,c.relname,c.relacl::text,c.relowner,c.relrowsecurity,c.relforcerowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth','storage','collection_audit_private') ORDER BY 1,2`)).rows
    const beforeFunctions = await functions(), beforeAccess = await access()
    const functionAcls = async () => (await db.query(`SELECT p.oid::regprocedure::text name,p.proacl::text,p.proowner
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','collection_audit_private')
      AND p.proname<>'create_collection_v1' ORDER BY 1`)).rows
    const beforeAcls = await functionAcls()
    const gatewayAcl = (await db.query("SELECT proacl::text,proowner FROM pg_proc WHERE oid='public.storage_execute_v1(text,uuid,jsonb)'::regprocedure")).rows
    const migration = readFileSync(new URL("../scripts/083_atomic_storage_creation.sql", import.meta.url), "utf8")
    await db.query(migration); await db.query(migration)
    assert.deepEqual(await functions(), beforeFunctions)
    assert.deepEqual(await functionAcls(), beforeAcls)
    assert.deepEqual(await access(), beforeAccess)
    assert.deepEqual((await db.query("SELECT proacl::text,proowner FROM pg_proc WHERE oid='public.storage_execute_v1(text,uuid,jsonb)'::regprocedure")).rows, gatewayAcl)
    const historical = { collection_id: "synthetic", authority: "slots", version: 1, layout_revision: 1 }
    assert.deepEqual((await db.query("SELECT collection_audit_private.state('storage_collection_state',$1) r", [{ ...historical, location: null }])).rows[0].r, historical)
    assert.deepEqual((await db.query("SELECT collection_audit_private.state('storage_collection_state',$1) r", [{ ...historical, location: "Synthetic shelf" }])).rows[0].r, { ...historical, location: "Synthetic shelf" })
    for (const role of ["anon", "authenticated", "holo_mcp", "service_role"]) {
      assert.equal((await db.query("SELECT has_function_privilege($1,'collection_audit_private.create_collection_v1(uuid,uuid,jsonb,jsonb)','EXECUTE') allowed", [role])).rows[0].allowed, false)
      assert.equal((await db.query("SELECT has_function_privilege($1,'public.storage_execute_v1(text,uuid,jsonb)','EXECUTE') allowed", [role])).rows[0].allowed, role === "service_role")
      assert.ok((await db.query(`SELECT has_function_privilege($1,p.oid,'EXECUTE') allowed FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='collection_audit_private' OR p.proname IN ('slot_command_v1','inventory_command_v1','slot_catalog_card_v1','slot_saved_count_v1','slot_check_target_v1','inventory_object_v1')`, [role])).rows.every(r => !r.allowed))
    }
    await db.query("BEGIN; SET LOCAL TIME ZONE 'UTC'; SET LOCAL statement_timeout='20s'")
    const flush = () => db.query("RESET ROLE; SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED")
    const rejected = async (run: () => Promise<unknown>, code: string) => {
      await db.query("SAVEPOINT rejected")
      await assert.rejects(run(), (e: unknown) => !!e && typeof e === "object" && "code" in e && e.code === code)
      await db.query("ROLLBACK TO SAVEPOINT rejected")
    }
    await db.query("INSERT INTO auth.users(id,created_at) VALUES($1,'2020-01-01'),($2,'2020-01-01'),($3,'2020-01-01')", [owner, partner, stranger])
    await db.query("UPDATE public.billing_configuration SET enforced=false")
    await db.query("INSERT INTO public.partnerships(user1_id,user2_id,owner_user_id) VALUES($1,$2,$1)", [owner, partner])
    await flush()
    const header = async (op: string, actor = partner, source = "app", clientId: string | null = null) => {
      await db.query("RESET ROLE")
      await db.query("SELECT set_config('request.headers',$1,true),set_config('request.jwt.claims',$2,true)", [JSON.stringify({ "x-holo-audit-context": JSON.stringify({ actor: { kind: "user", userId: actor }, source, clientId, operationId: op, batchId: op, clientOccurredAt: null }) }), JSON.stringify({ role: "service_role" })])
      await db.query("SET LOCAL ROLE service_role")
    }
    const call = async (operation: string, input: unknown, recipient = owner) => (await db.query("SELECT public.storage_execute_v1($1,$2,$3) r", [operation, recipient, input])).rows[0].r
    const revision = async () => {
      await db.query("RESET ROLE")
      return Number((await db.query("SELECT inventory_revision FROM public.inventory_owner_state WHERE owner_user_id=$1", [owner])).rows[0]?.inventory_revision ?? 0)
    }
    const evidence = async () => {
      await db.query("RESET ROLE")
      return (await db.query(`SELECT
        (SELECT count(*)::int FROM public.binders WHERE owner_user_id=$1) binders,
        (SELECT count(*)::int FROM public.storage_collection_state WHERE owner_user_id=$1) collections,
        (SELECT count(*)::int FROM public.binder_slots WHERE owner_user_id=$1) slots,
        (SELECT count(*)::int FROM public.inventory_items WHERE owner_user_id=$1) items,
        (SELECT count(*)::int FROM public.inventory_placements WHERE owner_user_id=$1) placements,
        (SELECT count(*)::int FROM public.pokemon_collection WHERE user_id=$1) legacy,
        (SELECT count(*)::int FROM public.collection_activity WHERE owner_user_id=$1) events,
        (SELECT count(*)::int FROM public.developer_idempotency WHERE actor_id IN ($1,$2)) ledger,
        (SELECT inventory_revision::text FROM public.inventory_owner_state WHERE owner_user_id=$1) revision,
        public.slot_saved_count_v1($1)::text saved`, [owner, partner])).rows[0]
    }
    const make = async (count = 0) => {
      const collectionId = randomUUID()
      return { version: 1, operationId: `synthetic-${collectionId}`, inventoryRevision: await revision(), collectionId, name: "Synthetic creation",
        kind: "binder", defaultPresentation: "binder", location: null as string | null, grid: null as { rows: number; cols: number } | null,
        manifest: count ? { source: { id: "synthetic-copy", version: "1" }, name: "Synthetic repeated species", entries: Array.from({ length: count }, (_, n) => ({ id: `entry-${n}`, target: { kind: "pokemon", pokemonId: n % 1025 + 1 } as object | null })) } : blankPreset(),
        slotIds: Array.from({ length: count }, (_, n) => `${collectionId}/slot-${n}`) }
    }
    const blank = await make()
    await header(blank.operationId)
    const receipt = await call("collection.create", blank)
    assert.equal(normalizeStorageResult("collection.create", receipt).recoverySupported, false)
    await flush()
    assert.deepEqual((await db.query("SELECT name,is_default,sort_order,binder_rows,binder_cols FROM public.binders WHERE id=$1", [blank.collectionId])).rows[0],
      { name: blank.name, is_default: true, sort_order: 0, binder_rows: null, binder_cols: null })
    assert.equal((await evidence()).slots, 0)
    await header(blank.operationId)
    assert.deepEqual(await call("collection.create", blank), receipt, "retry with original zero revision returns exact receipt")
    await rejected(() => call("collection.create", { ...blank, name: "Changed body" }), "40001")
    await header(blank.operationId, owner)
    await rejected(() => call("collection.create", blank), "40001")
    await header(blank.operationId, partner, "rest")
    await rejected(() => call("collection.create", blank), "HF402")
    // Real generated creation event, including default/root state: no invented inverse support.
    await db.query("RESET ROLE")
    const event = (await db.query("SELECT id::text,action,actor_user_id,source,operation_id,batch_id,recovery_state FROM public.collection_activity WHERE owner_user_id=$1 AND operation_id=$2", [owner, blank.operationId])).rows[0]
    assert.equal(event.action, "collection.create"); assert.equal(event.actor_user_id, partner)
    assert.equal(event.operation_id, blank.operationId); assert.equal(event.batch_id, blank.operationId)
    assert.ok(event.recovery_state.some((v: { table: string }) => v.table === "inventory_owner_state"))
    await header("synthetic-preview")
    const preview = await call("recovery.preview", { eventId: event.id, restoreUnassignedItemIds: [] })
    assert.equal(preview.supported, false)
    assert.ok(preview.unsupported.includes("collection_creation_inverse"))
    assert.ok(preview.unsupported.includes("owner_authority_transition"))
    await header("synthetic-unsupported-apply")
    await rejected(() => call("recovery.apply", { operationId: "synthetic-unsupported-apply", eventId: event.id, restoreUnassignedItemIds: [], confirmed: true, planVersion: 1, planToken: "0".repeat(64) }), "0A000")
    await db.query("RESET ROLE; SAVEPOINT mixedfirst")
    const oldDefault = randomUUID()
    await db.query("INSERT INTO public.binders(id,owner_user_id,name,is_default,sort_order) VALUES($1,$2,'Synthetic old default',true,4)", [oldDefault, stranger]); await flush()
    const firstNative = { ...await make(), inventoryRevision: 0 }
    await header(firstNative.operationId, stranger)
    await call("collection.create", firstNative, stranger); await flush()
    assert.deepEqual((await db.query("SELECT is_default,sort_order FROM public.binders WHERE id=$1", [firstNative.collectionId])).rows[0], { is_default: false, sort_order: 5 })
    assert.equal((await db.query("SELECT is_default FROM public.binders WHERE id=$1", [oldDefault])).rows[0].is_default, true)
    assert.equal((await db.query("SELECT count(*)::int n FROM public.storage_collection_state WHERE collection_id=$1", [oldDefault])).rows[0].n, 0)
    await db.query("ROLLBACK TO SAVEPOINT mixedfirst")
    const state = await evidence()
    assert.equal(state.items, 0); assert.equal(state.placements, 0); assert.equal(state.saved, "0")
    const stale = await make()
    await header(stale.operationId)
    await rejected(() => call("collection.create", { ...stale, inventoryRevision: 0 }), "40001")
    for (const extra of [{ ownerUserId: stranger }, { name: "two  spaces" }, { kind: "unknown" }, { defaultPresentation: "slabs" }, { location: "private" }, { grid: { rows: 9, cols: 1 } }]) {
      await rejected(() => call("collection.create", { ...stale, ...extra }), "22023")
    }
    assert.deepEqual(await evidence(), state)
    // Keep another binder legacy, preserving its identity/default/order without a forced conversion.
    const legacyId = randomUUID()
    await db.query("INSERT INTO public.binders(id,owner_user_id,name,sort_order) VALUES($1,$2,'Synthetic legacy',7)", [legacyId, owner]); await flush()
    const legacyBefore = (await db.query("SELECT * FROM public.binders WHERE id=$1", [legacyId])).rows
    const timings: Record<string, number> = {}
    let expectedSort = 8
    for (const count of [151, 1025, 4096]) {
      const input = await make(count)
      if (count === 4096) {
        input.manifest.source = { id: "synthetic/" + "s".repeat(190), version: "v".repeat(200) }
        input.manifest.entries.forEach((e, n) => { e.id = `entry-${n}/` + "e".repeat(150) })
        input.slotIds = input.slotIds.map(id => id + "/" + "s".repeat(110))
        assert.ok(Buffer.byteLength(JSON.stringify(input)) > 1048576, "creation must admit more than the ordinary 1 MiB transport body")
      }
      const before = await evidence()
      await header(input.operationId)
      const started = performance.now()
      const result = await call("collection.create", input)
      await flush()
      timings[String(count)] = Math.round(performance.now() - started)
      assert.deepEqual(result.slotIds, input.slotIds)
      const slots = (await db.query("SELECT id,target,status,wanted_cards,preset_origin FROM public.binder_slots WHERE collection_id=$1 ORDER BY position", [input.collectionId])).rows
      assert.equal(slots.length, count)
      assert.deepEqual(slots.map(s => s.target), input.manifest.entries.map(e => e.target))
      assert.ok(slots.every(s => s.status === null && s.wanted_cards.length === 0))
      assert.deepEqual(slots[0].preset_origin, { source: input.manifest.source, entryId: input.manifest.entries[0].id })
      assert.deepEqual((await db.query("SELECT sort_order,is_default FROM public.binders WHERE id=$1", [input.collectionId])).rows[0], { sort_order: expectedSort++, is_default: false })
      const after = await evidence()
      assert.equal(after.saved, before.saved); assert.equal(after.items, before.items); assert.equal(after.legacy, before.legacy)
      await header(input.operationId)
      assert.deepEqual(await call("collection.create", input), result)
      await flush()
      const original = (await db.query("SELECT id::text,recovery_state FROM public.collection_activity WHERE owner_user_id=$1 AND operation_id=$2", [owner, input.operationId])).rows[0]
      assert.equal(original.recovery_state.length, count + 3)
      await header("synthetic-preview-layout")
      const plan = await call("recovery.preview", { eventId: original.id, restoreUnassignedItemIds: [] })
      assert.equal(plan.supported, false)
      assert.ok(plan.unsupported.includes("collection_creation_inverse"))
    }
    await db.query("RESET ROLE")
    console.log("synthetic creation SQL create+audit milliseconds", JSON.stringify(timings))
    assert.deepEqual((await db.query("SELECT * FROM public.binders WHERE id=$1", [legacyId])).rows, legacyBefore)
    assert.equal((await db.query("SELECT count(*)::int n FROM public.storage_collection_state WHERE collection_id=$1", [legacyId])).rows[0].n, 0)
    const oversized = await make()
    await header(oversized.operationId)
    await rejected(() => call("collection.create", { ...oversized, name: "x".repeat(2097153) }), "22023")
    const over = await make(4097)
    await header(over.operationId)
    await rejected(() => call("collection.create", over), "22023")
    // Multi-species, selected printing + spacer, copied isolation and every storage kind.
    const multi = await make(3)
    multi.manifest = speciesPreset("Synthetic selected species", [925, 924, 143])
    multi.kind = "custom"; multi.defaultPresentation = "list"; multi.location = "Synthetic shelf"
    await header(multi.operationId); await call("collection.create", multi); await flush()
    await db.query("INSERT INTO public.tcg_series(id) VALUES('synthetic-creation-series')")
    await db.query("INSERT INTO public.tcg_sets(id,series_id) VALUES('synthetic-creation-set','synthetic-creation-series')")
    await db.query(`INSERT INTO public.tcg_cards(id,series_id,set_id,local_id,name_json,variants_json,external_ids_json) VALUES
      ('synthetic-creation-card','synthetic-creation-series','synthetic-creation-set','1','{"en":"Synthetic card"}','{"holo":true}','{"catalog":{"canonicalId":"synthetic-creation-canonical","aliasIds":["synthetic-creation-alias"]}}')`)
    const printing = await make(2)
    printing.kind = "slab"; printing.defaultPresentation = "slabs"
    printing.manifest.entries[0].target = { kind: "card", cardId: "synthetic-creation-alias", language: "en", finish: "holo" }
    printing.manifest.entries[1].target = null
    await header(printing.operationId); await call("collection.create", printing); await flush()
    const duplicate = await make(2)
    await header(duplicate.operationId)
    await rejected(() => call("collection.create", { ...duplicate, slotIds: [duplicate.slotIds[0], duplicate.slotIds[0]] }), "22023")
    await rejected(() => call("collection.create", { ...duplicate, manifest: { ...duplicate.manifest, entries: [duplicate.manifest.entries[0], duplicate.manifest.entries[0]] } }), "22023")
    const invalid = await make(1)
    for (const target of [{ kind: "pokemon", pokemonId: 1026 }, { kind: "card", cardId: "invented" },
      { kind: "card", cardId: "synthetic-creation-card", language: "ja" }, { kind: "card", cardId: "synthetic-creation-card", finish: "reverse_holo" }]) {
      invalid.manifest.entries[0].target = target
      await header(invalid.operationId)
      await rejected(() => call("collection.create", invalid), "22023")
    }
    // Existing saved-entry allowance is already full, target creation still costs zero.
    await db.query("RESET ROLE; SAVEPOINT allowance; UPDATE public.billing_configuration SET enforced=true,free_card_limit=1,free_binder_limit=20")
    await db.query("INSERT INTO public.inventory_items(id,owner_user_id,identity) VALUES('synthetic-creation-owned',$1,'{\"kind\":\"pokemon\",\"pokemonId\":1}')", [owner]); await flush()
    const full = await evidence()
    const free = await make(1025)
    await header(free.operationId, owner); await call("collection.create", free); await flush()
    assert.equal((await evidence()).saved, full.saved)
    await db.query("UPDATE public.billing_configuration SET free_binder_limit=1")
    const limited = await make()
    const limitedBefore = await evidence()
    await header(limited.operationId, owner); await rejected(() => call("collection.create", limited), "P0001")
    assert.deepEqual(await evidence(), limitedBefore)
    await db.query("UPDATE public.billing_configuration SET free_binder_limit=20")
    const custom = await make(); custom.grid = { rows: 8, cols: 8 }
    await header(custom.operationId, owner); await rejected(() => call("collection.create", custom), "P0001")
    assert.deepEqual(await evidence(), limitedBefore)
    custom.grid = { rows: 3, cols: 3 }
    await header(custom.operationId, owner); await call("collection.create", custom); await flush()
    await db.query("ROLLBACK TO SAVEPOINT allowance")
    const afterAllowance = await evidence()
    await db.query("SAVEPOINT ceiling")
    await db.query(`INSERT INTO public.binders(id,owner_user_id,name,sort_order)
      SELECT gen_random_uuid(),$1,'Synthetic ceiling '||n,100+n FROM generate_series(1,20-(SELECT count(*)::int FROM public.binders WHERE owner_user_id=$1)) n`, [owner])
    await flush()
    const capped = await make()
    await header(capped.operationId, owner)
    await rejected(() => call("collection.create", capped), "P0001")
    await db.query("ROLLBACK TO SAVEPOINT ceiling")
    assert.deepEqual(await evidence(), afterAllowance)
    await db.query("SAVEPOINT paidgrid; INSERT INTO public.perpetual_licences(owner_user_id,source) VALUES('" + owner + "','manual')")
    const paidGrid = await make(); paidGrid.grid = { rows: 8, cols: 8 }
    for (const source of ["rest", "mcp"]) {
      const intent = { ...paidGrid, collectionId: randomUUID(), operationId: `synthetic-paid-${source}`, inventoryRevision: await revision() }
      await header(intent.operationId, partner, source, "synthetic-credential")
      await call("collection.create", intent); await flush()
      const attribution = (await db.query("SELECT actor_user_id,source,client_id,batch_id FROM public.collection_activity WHERE owner_user_id=$1 AND operation_id=$2", [owner, intent.operationId])).rows[0]
      assert.deepEqual(attribution, { actor_user_id: partner, source, client_id: "synthetic-credential", batch_id: intent.operationId })
      await header(intent.operationId, partner, source, "changed-credential")
      await rejected(() => call("collection.create", intent), "40001")
    }
    await db.query("ROLLBACK TO SAVEPOINT paidgrid")
    assert.deepEqual(await evidence(), afterAllowance)
    // Complete cancellation and recorder failure roll back binder/root/slots/ledger together.
    await db.query("SAVEPOINT cancellation")
    await db.query(`CREATE FUNCTION public.synthetic_creation_pause() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.25); RETURN NEW; END $$;
      CREATE TRIGGER synthetic_creation_pause AFTER INSERT ON public.binder_slots FOR EACH ROW EXECUTE FUNCTION public.synthetic_creation_pause()`)
    const timed = await make(1)
    await header(timed.operationId); await db.query("SET LOCAL statement_timeout='50ms'")
    await rejected(() => call("collection.create", timed), "57014")
    await db.query("ROLLBACK TO SAVEPOINT cancellation; SET LOCAL statement_timeout='20s'")
    assert.deepEqual(await evidence(), afterAllowance)
    await db.query("SAVEPOINT recorder; CREATE OR REPLACE FUNCTION collection_audit_private.flush() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic_creation_recorder_failure'; END $$")
    const failed = await make(3)
    await header(failed.operationId)
    await assert.rejects(async () => { await call("collection.create", failed); await flush() }, /synthetic_creation_recorder_failure/)
    await db.query("ROLLBACK TO SAVEPOINT recorder")
    assert.deepEqual(await evidence(), afterAllowance)
    // Reusing IDs from another owner is never an upsert. Whole intent rolls back.
    const foreign = randomUUID()
    await db.query("INSERT INTO public.binders(id,owner_user_id,name,is_default) VALUES($1,$2,'Synthetic foreign',true)", [foreign, stranger]); await flush()
    const conflict = await make(); conflict.collectionId = foreign
    await header(conflict.operationId); await rejected(() => call("collection.create", conflict), "40001")
    const occupied = await make(1); occupied.slotIds = [multi.slotIds[0]]
    await header(occupied.operationId); await rejected(() => call("collection.create", occupied), "40001")
    const strangerRequest = await make()
    await header(strangerRequest.operationId, stranger)
    await rejected(() => call("collection.create", strangerRequest), "42501")
    await header(strangerRequest.operationId, owner)
    await rejected(() => call("collection.create", strangerRequest, stranger), "42501")
    // Actual editing affects only a copied slot, never either stored manifest or another collection.
    await db.query("RESET ROLE")
    const copied = (await db.query("SELECT preset_manifest FROM public.storage_collection_state WHERE collection_id=$1", [multi.collectionId])).rows[0]
    await db.query("UPDATE public.binder_slots SET target=NULL,version=version+1 WHERE id=$1", [multi.slotIds[0]])
    assert.deepEqual((await db.query("SELECT preset_manifest FROM public.storage_collection_state WHERE collection_id=$1", [multi.collectionId])).rows[0], copied)
    await flush()
    // Generate a real pre-location event using 076's exact old projection, then recover under 083.
    await db.query("SAVEPOINT historical")
    const currentProjection = (await db.query("SELECT pg_get_functiondef('collection_audit_private.state(text,jsonb)'::regprocedure) body")).rows[0].body
    const oldProjection = readFileSync(new URL("../scripts/076_transactional_collection_audit.sql", import.meta.url), "utf8")
      .match(/CREATE OR REPLACE FUNCTION collection_audit_private\.state\(table_name text,row_data jsonb\)[\s\S]*?END \$\$;/)?.[0]
    assert.ok(oldProjection)
    await db.query("ALTER TABLE public.storage_collection_state DROP COLUMN location")
    await db.query(oldProjection)
    const oldInput = { operationId: "synthetic-historical-layout", inventoryRevision: await revision(), collectionId: blank.collectionId,
      collectionVersion: 0, layoutRevision: 0, commands: [{ kind: "create", ids: ["synthetic-historical-slot"], beforeSlotId: null }] }
    await header(oldInput.operationId)
    await call("slots", oldInput); await flush()
    const oldEvent = (await db.query("SELECT id::text FROM public.collection_activity WHERE owner_user_id=$1 AND operation_id=$2", [owner, oldInput.operationId])).rows[0]
    await db.query("ALTER TABLE public.storage_collection_state ADD COLUMN location text")
    await db.query(currentProjection)
    await header("synthetic-historical-preview")
    const oldPlan = await call("recovery.preview", { eventId: oldEvent.id, restoreUnassignedItemIds: [] })
    assert.equal(oldPlan.supported, true)
    assert.deepEqual(oldPlan.conflicts, [])
    await header("synthetic-historical-apply")
    await call("recovery.apply", { eventId: oldEvent.id, restoreUnassignedItemIds: [], operationId: "synthetic-historical-apply", confirmed: true, planVersion: 1, planToken: oldPlan.planToken })
    await flush()
    assert.equal((await db.query("SELECT count(*)::int n FROM public.binder_slots WHERE id='synthetic-historical-slot'")).rows[0].n, 0)
    assert.equal((await db.query("SELECT is_default FROM public.binders WHERE id=$1", [blank.collectionId])).rows[0].is_default, true)
    await db.query("ROLLBACK TO SAVEPOINT historical")
    // Every runtime role except service can neither call gateway nor escalate through a GUC/header.
    for (const role of ["anon", "authenticated", "holo_mcp"]) {
      await db.query("RESET ROLE; SET SESSION AUTHORIZATION " + role)
      await rejected(() => db.query("SELECT set_config('role','service_role',true)"), "42501")
      await rejected(() => call("collection.create", strangerRequest), "42501")
      await db.query("RESET SESSION AUTHORIZATION")
    }
    await db.query("RESET ROLE; DELETE FROM public.partnerships WHERE owner_user_id='" + owner + "'")
    await header(blank.operationId)
    await rejected(() => call("collection.create", blank), "42501")
  } finally { await db.query("ROLLBACK"); await db.end() }
})

// Real multi-session races need visible fixtures. Use only the disposable synthetic fresh-schema database,
// never the archive database. The caller drops this entire database after proof.
const raceDatabase = process.env.STORAGE_CREATION_RACE_DATABASE
test("synthetic fresh-schema races: membership locks before owner locks, revocation wins, concurrent replay creates once", { skip: !socket || !raceDatabase, timeout: 30000 }, async () => {
  if (!socket || !raceDatabase) return
  assert.equal(socket, config.host)
  assert.equal(raceDatabase, "holofolder_fresh_creation")
  const { Client } = await import("pg")
  const a = new Client({ ...config, database: raceDatabase }), b = new Client({ ...config, database: raceDatabase })
  await a.connect(); await b.connect()
  const actor = "00830000-0000-4000-8000-000000000022", recipient = "00830000-0000-4000-8000-000000000021"
  const command = { version: 1, operationId: "synthetic-concurrent-create", inventoryRevision: 0, collectionId: "00830000-0000-4000-8000-000000000031",
    name: "Synthetic concurrent", kind: "binder", defaultPresentation: "binder", location: null, grid: null, manifest: blankPreset(), slotIds: [] }
  const header = JSON.stringify({ "x-holo-audit-context": JSON.stringify({ actor: { kind: "user", userId: actor }, source: "app", clientId: null, operationId: command.operationId, batchId: command.operationId, clientOccurredAt: null }) })
  const begin = async (db: InstanceType<typeof Client>) => {
    await db.query("BEGIN; SET LOCAL statement_timeout='5s'")
    await db.query("SELECT set_config('request.headers',$1,true)", [header])
    await db.query("SET LOCAL ROLE service_role")
  }
  const create = async (db: InstanceType<typeof Client>) => (await db.query("SELECT public.storage_execute_v1('collection.create',$1,$2) r", [recipient, command])).rows[0].r
  const assertWaiting = async (observer: InstanceType<typeof Client>, pid: number) => {
    for (let i = 0; i < 20; i++) {
      const row = (await observer.query("SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1", [pid])).rows[0]
      if (row?.wait_event_type === "Lock") return
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    assert.fail("synthetic concurrent call did not wait for the held transaction lock")
  }
  try {
    await a.query("INSERT INTO auth.users(id,created_at) VALUES($1,'2020-01-01'),($2,'2020-01-01')", [recipient, actor])
    await a.query("UPDATE public.billing_configuration SET enforced=false")
    await a.query("INSERT INTO public.partnerships(user1_id,user2_id,owner_user_id) VALUES($1,$2,$1)", [recipient, actor])
    const aPid = (await a.query("SELECT pg_backend_pid() pid")).rows[0].pid
    const bPid = (await b.query("SELECT pg_backend_pid() pid")).rows[0].pid
    await begin(a)
    await create(a)
    await b.query("BEGIN; SET LOCAL lock_timeout='100ms'")
    await assert.rejects(b.query("DELETE FROM public.partnerships WHERE owner_user_id=$1", [recipient]), (e: unknown) => !!e && typeof e === "object" && "code" in e && e.code === "55P03")
    await b.query("ROLLBACK")
    await b.query("BEGIN; SET LOCAL lock_timeout='100ms'")
    await assert.rejects(b.query("UPDATE public.partnerships SET owner_user_id=$1 WHERE owner_user_id=$2", [actor, recipient]), (e: unknown) => !!e && typeof e === "object" && "code" in e && e.code === "55P03")
    await b.query("ROLLBACK"); await a.query("ROLLBACK")
    // If unlink locks first, the waiting command must recheck and reject before obtaining 4701.
    await b.query("BEGIN; DELETE FROM public.partnerships WHERE owner_user_id='" + recipient + "'")
    await begin(a)
    const pendingDenied = assert.rejects(create(a), (e: unknown) => !!e && typeof e === "object" && "code" in e && e.code === "42501")
    await assertWaiting(b, aPid)
    assert.equal((await b.query("SELECT count(*)::int n FROM pg_locks WHERE pid=$1 AND locktype='advisory' AND granted", [aPid])).rows[0].n, 0)
    await b.query("COMMIT"); await pendingDenied; await a.query("ROLLBACK")
    assert.equal((await a.query("SELECT count(*)::int n FROM public.binders WHERE owner_user_id=$1", [recipient])).rows[0].n, 0)
    await a.query("INSERT INTO public.partnerships(user1_id,user2_id,owner_user_id) VALUES($1,$2,$1)", [recipient, actor])
    // Exact delivery while the first call is uncommitted waits then returns its receipt.
    await begin(a)
    const first = await create(a)
    await begin(b)
    const pendingReplay = create(b)
    await a.query("RESET ROLE")
    await assertWaiting(a, bPid)
    await a.query("COMMIT")
    assert.deepEqual(await pendingReplay, first)
    await b.query("ROLLBACK")
    assert.equal((await a.query("SELECT count(*)::int n FROM public.binders WHERE owner_user_id=$1", [recipient])).rows[0].n, 1)
    assert.equal((await a.query("SELECT count(*)::int n FROM public.collection_activity WHERE owner_user_id=$1 AND operation_id=$2", [recipient, command.operationId])).rows[0].n, 1)
    assert.equal((await a.query("SELECT count(*)::int n FROM public.developer_idempotency WHERE actor_id=$1", [actor])).rows[0].n, 1)
  } finally { await a.query("ROLLBACK"); await b.query("ROLLBACK"); await a.end(); await b.end() }
})
