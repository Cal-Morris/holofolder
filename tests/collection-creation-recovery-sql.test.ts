import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { Client } from "pg"
import { normalizeStorageResult } from "@/lib/server/operations/storage-contract"

const socket = process.env.CREATION_RECOVERY_TEST_SOCKET
const config = { host: "/Users/cal/.local/share/holofolder/issue396-creation-recovery-local/socket", port: 55585, user: "creation_recovery_test", database: "postgres" }
const owner = "00840000-0000-4000-8000-000000000001", partner = "00840000-0000-4000-8000-000000000002"
const intent = { source: "app", clientId: null, batchId: null, clientOccurredAt: null }

async function create(db: Client, count = 0, actor = owner, long = false) {
  const id = randomUUID(), op = `synthetic-create-${id}`
  const revision = Number((await db.query("SELECT inventory_revision FROM public.inventory_owner_state WHERE owner_user_id=$1", [owner])).rows[0]?.inventory_revision ?? 0)
  const input = { version: 1, operationId: op, inventoryRevision: revision, collectionId: id, name: `Synthetic ${id.slice(0, 8)}`,
    kind: "binder", defaultPresentation: "binder", location: null, grid: null,
    manifest: { source: { id: "synthetic", version: "1" }, name: "Synthetic species", entries: Array.from({ length: count }, (_, n) => ({ id: `entry-${n}`, target: n % 2 ? null : { kind: "pokemon", pokemonId: n % 1025 + 1 } })) },
    slotIds: Array.from({ length: count }, (_, n) => `${id}/slot-${n}`) }
  if (long) {
    input.manifest.source = { id: "synthetic/" + "s".repeat(190), version: "v".repeat(200) }
    input.manifest.entries.forEach(e => { e.id += "/" + "e".repeat(150) })
    input.slotIds = input.slotIds.map(key => key + "/" + "s".repeat(110))
    assert.ok(Buffer.byteLength(JSON.stringify(input)) > 1048576)
  }
  const ctx = { actor: { kind: "user", userId: actor }, ...intent, operationId: op, action: "collection.create" }
  const receipt = (await db.query("SELECT collection_audit_private.create_collection_v1($1,$2,$3,$4) r", [actor, owner, input, ctx])).rows[0].r
  await db.query("SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED")
  const event = (await db.query("SELECT * FROM public.collection_activity WHERE owner_user_id=$1 AND operation_id=$2", [owner, op])).rows[0]
  return { input, receipt, event, id }
}
const preview = async (db: Client, event: string, actor = owner) => (await db.query("SELECT collection_audit_private.recovery_preview_v1($1,$2,$3,'{}') r", [actor, owner, event])).rows[0].r
const request = (event: string, token: string, operationId = `synthetic-recovery-${randomUUID()}`) => ({ eventId: event, planVersion: 1, planToken: token, operationId, restoreUnassignedItemIds: [], confirmed: true })
const apply = async (db: Client, input: object, actor = owner) => (await db.query("SELECT collection_audit_private.recovery_apply_v1($1,$2,$3,$4) r", [actor, owner, input, intent])).rows[0].r
const flush = (db: Client) => db.query("SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED")

test("private native creation recovery: genuine 083 evidence, complete untouched inverse and first/default conflicts", { skip: !socket, timeout: 120000 }, async () => {
  if (!socket) return
  assert.equal(socket, config.host)
  const db = new Client(config); await db.connect()
  try {
    const functions = async () => (await db.query(`SELECT p.oid::regprocedure::text name,p.proacl::text,p.proowner,md5(pg_get_functiondef(p.oid)) digest
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','collection_audit_private')
      AND p.proname NOT IN ('recovery_plan_v1','recovery_apply_v1','creation_recovery_proof_v1') ORDER BY 1`)).rows
    const access = async () => (await db.query(`SELECT n.nspname,c.relname,c.relacl::text,c.relowner,c.relrowsecurity,c.relforcerowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth','storage','collection_audit_private') ORDER BY 1,2`)).rows
    const acl = async () => (await db.query(`SELECT p.oid::regprocedure::text name,p.proacl::text,p.proowner
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','collection_audit_private')
      AND p.proname<>'creation_recovery_proof_v1' ORDER BY 1`)).rows
    const beforeFunctions = await functions(), beforeAccess = await access(), beforeAcl = await acl()
    const baselinePlan = (await db.query("SELECT pg_get_functiondef('collection_audit_private.recovery_plan_v1(uuid,uuid,bigint,text[])'::regprocedure) body")).rows[0].body
    await db.query(baselinePlan.replace("collection_audit_private.recovery_plan_v1(", "pg_temp.pre_creation_recovery_plan("))
    // Set CREATION_RECOVERY_BASELINE=1 only to reproduce the pre-084 failing assertion.
    if (!process.env.CREATION_RECOVERY_BASELINE) {
      const migration = readFileSync(new URL("../scripts/084_native_collection_creation_recovery.sql", import.meta.url), "utf8")
      await db.query(migration); await db.query(migration)
    }
    assert.deepEqual(await functions(), beforeFunctions)
    assert.deepEqual(await access(), beforeAccess)
    assert.deepEqual(await acl(), beforeAcl)
    const executor = (await db.query("SELECT pg_get_functiondef('collection_audit_private.recovery_apply_v1(uuid,uuid,jsonb,jsonb)'::regprocedure) body")).rows[0].body
    assert.equal(executor.match(/plan:=collection_audit_private.recovery_plan_v1/g)?.length, 2)
    assert.equal(executor.match(/reviewed:=collection_audit_private.recovery_preview_v1/g)?.length, 1)
    assert.ok(executor.indexOf("FROM public.partnerships") < executor.indexOf("6102"))
    assert.ok(executor.indexOf("6102") < executor.indexOf("4701"))
    assert.ok(executor.includes("WHERE owner_user_id=owner_id FOR SHARE"))
    for (const role of ["anon", "authenticated", "holo_mcp", "service_role"]) {
      assert.ok((await db.query(`SELECT has_function_privilege($1,p.oid,'EXECUTE') allowed FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='collection_audit_private'`, [role])).rows.every(r => !r.allowed))
      assert.equal((await db.query("SELECT has_function_privilege($1,'public.storage_execute_v1(text,uuid,jsonb)','EXECUTE') allowed", [role])).rows[0].allowed, role === "service_role")
    }
    await db.query("BEGIN; SET LOCAL statement_timeout='10s'; SET LOCAL TIME ZONE 'Pacific/Auckland'")
    await db.query("INSERT INTO auth.users(id,created_at) VALUES($1,'2020-01-01'),($2,'2020-01-01')", [owner, partner])
    await db.query("UPDATE public.billing_configuration SET enforced=false")
    await db.query("INSERT INTO public.partnerships(user1_id,user2_id,owner_user_id) VALUES($1,$2,$1)", [owner, partner]); await flush(db)
    const first = await create(db, 2)
    const firstPlan = await preview(db, first.event.id)
    assert.equal(firstPlan.planToken, null)
    const second = await create(db, 4, partner)
    const plan = await preview(db, second.event.id, partner)
    assert.equal(plan.supported, true, JSON.stringify(plan.unsupported))
    assert.deepEqual(plan.conflicts, [])
    assert.ok(plan.planToken)
    assert.ok(firstPlan.conflicts.some((c: { reason: string }) => c.reason === "creation_default_requires_explicit_replacement"))
    const recover = request(second.event.id, plan.planToken)
    await db.query("SELECT set_config('request.headers',$1,true)", [JSON.stringify({ "x-holo-audit-context": JSON.stringify({ actor: { kind: "user", userId: partner }, ...intent, operationId: recover.operationId }) })])
    await db.query("SET LOCAL ROLE service_role")
    const receipt = (await db.query("SELECT public.storage_execute_v1('recovery.apply',$1,$2) r", [owner, recover])).rows[0].r
    await db.query("RESET ROLE")
    assert.deepEqual(receipt.collections, [])
    assert.equal(receipt.inventoryRevision, 3)
    assert.equal((await db.query("SELECT count(*)::int n FROM public.binders WHERE id=$1", [second.id])).rows[0].n, 0)
    assert.deepEqual((await db.query("SELECT * FROM public.collection_activity WHERE id=$1", [second.event.id])).rows[0], second.event)
    assert.equal((await db.query("SELECT recovery_of_event_id::text e FROM public.collection_activity WHERE id=$1", [receipt.eventId])).rows[0].e, String(second.event.id))
    assert.deepEqual(await apply(db, recover, partner), receipt)
    assert.equal((await db.query("SELECT is_default FROM public.binders WHERE id=$1", [first.id])).rows[0].is_default, true)
    await db.query("SAVEPOINT default_inverse")
    await assert.rejects(apply(db, request(first.event.id, "0".repeat(64))), /recovery_plan_conflict/)
    await db.query("ROLLBACK TO SAVEPOINT default_inverse")
    await db.query("UPDATE public.binder_slots SET target='{\"kind\":\"pokemon\",\"pokemonId\":2}',version=version+1 WHERE id=$1", [first.input.slotIds[0]]); await flush(db)
    const ordinary = (await db.query("SELECT id FROM public.collection_activity WHERE owner_user_id=$1 ORDER BY id DESC LIMIT 1", [owner])).rows[0].id
    assert.deepEqual((await db.query("SELECT collection_audit_private.recovery_plan_v1($1,$1,$2,'{}') p", [owner, ordinary])).rows[0].p,
      (await db.query("SELECT pg_temp.pre_creation_recovery_plan($1,$1,$2,'{}') p", [owner, ordinary])).rows[0].p, "ordinary native plans remain exactly equal to the installed pre-084 planner")
  } finally { await db.query("ROLLBACK"); await db.end() }
})

test("private native creation recovery: preserve legacy default, authority, copies/wants; refuse edits, dependencies and stale plans", { skip: !socket, timeout: 120000 }, async () => {
  if (!socket) return
  assert.equal(socket, config.host)
  const db = new Client(config); await db.connect()
  try {
    await db.query("BEGIN; SET LOCAL statement_timeout='10s'; SET LOCAL TIME ZONE 'UTC'")
    await db.query("INSERT INTO auth.users(id,created_at) VALUES($1,'2020-01-01'),($2,'2020-01-01')", [owner, partner])
    await db.query("UPDATE public.billing_configuration SET enforced=false")
    await db.query("INSERT INTO public.partnerships(user1_id,user2_id,owner_user_id) VALUES($1,$2,$1)", [owner, partner])
    const legacy = randomUUID()
    await db.query("INSERT INTO public.binders(id,owner_user_id,name,is_default) VALUES($1,$2,'Synthetic legacy default',true)", [legacy, owner])
    await db.query(`INSERT INTO public.pokemon_collection(user_id,binder_id,pokemon_id,pokemon_name,status,wanted_cards)
      VALUES($1,$2,1,'Synthetic want','wishlisted','[{"card_id":"synthetic-want","card_name":"Synthetic wanted card","added_at":"2020-01-01"}]')`, [owner, legacy])
    await flush(db)
    const legacyBefore = (await db.query("SELECT * FROM public.binders WHERE id=$1", [legacy])).rows
    const wantsBefore = (await db.query("SELECT * FROM public.pokemon_collection WHERE binder_id=$1", [legacy])).rows
    const firstNative = await create(db, 2)
    assert.ok(firstNative.event.recovery_state.some((e: { table: string; before: unknown }) => e.table === "inventory_owner_state" && e.before === null))
    await db.query("INSERT INTO public.inventory_items(id,owner_user_id,identity,acquired_at) VALUES('synthetic/independent-copy',$1,'{\"kind\":\"pokemon\",\"pokemonId\":1}','2021-01-02T03:04:05Z')", [owner]); await flush(db)
    const grade = { provider: { kind: "known", id: "psa" }, grade: "10", scale: null, designation: null, subgrades: [], certificate: "synthetic-private-cert", holder: null, label: { variant: null, assetIds: [] } }
    await db.query(`INSERT INTO public.inventory_items(id,owner_user_id,identity,grading,acquired_at)
      VALUES('synthetic/graded-copy-a',$1,'{"kind":"card","cardId":"synthetic-print"}',$2,'2021-01-01'),
      ('synthetic/graded-copy-b',$1,'{"kind":"card","cardId":"synthetic-print"}',$2,'2022-01-01')`, [owner, grade]); await flush(db)
    const copiesBefore = (await db.query("SELECT * FROM public.inventory_items WHERE owner_user_id=$1", [owner])).rows
    let plan = await preview(db, firstNative.event.id)
    assert.deepEqual(plan.conflicts, [])
    const recovered = await apply(db, request(firstNative.event.id, plan.planToken))
    assert.equal(recovered.inventoryRevision, 2)
    assert.deepEqual((await db.query("SELECT * FROM public.binders WHERE id=$1", [legacy])).rows, legacyBefore)
    assert.deepEqual((await db.query("SELECT * FROM public.pokemon_collection WHERE binder_id=$1", [legacy])).rows, wantsBefore)
    assert.deepEqual((await db.query("SELECT * FROM public.inventory_items WHERE owner_user_id=$1", [owner])).rows, copiesBefore)
    assert.equal((await db.query("SELECT count(*)::int n FROM public.storage_collection_state WHERE collection_id=$1", [legacy])).rows[0].n, 0)
    const sample = await create(db, 2)
    const conflict = async (sql: string, params: unknown[], reason: string) => {
      await db.query("SAVEPOINT changed")
      await db.query(sql, params); await flush(db)
      const p = await preview(db, sample.event.id)
      assert.equal(p.planToken, null)
      assert.ok(p.conflicts.some((c: { reason: string }) => c.reason === reason), JSON.stringify(p.conflicts))
      await db.query("ROLLBACK TO SAVEPOINT changed")
    }
    await conflict("UPDATE public.binder_slots SET wanted_cards='[{\"card_id\":\"synthetic-want\",\"card_name\":\"Synthetic want\",\"added_at\":\"2020-01-01\"}]',version=version+1 WHERE id=$1", [sample.input.slotIds[0]], "entity_changed_or_identity_occupied")
    await conflict("UPDATE public.storage_collection_state SET version=version+1 WHERE collection_id=$1", [sample.id], "creation_state_changed")
    await conflict("INSERT INTO public.binder_slots(id,owner_user_id,collection_id,position) VALUES('synthetic/extra',$1,$2,2)", [owner, sample.id], "creation_slot_set_changed")
    await conflict("WITH owned AS (UPDATE public.binder_slots SET status='collected',version=version+1 WHERE id=$3 RETURNING id) INSERT INTO public.inventory_placements(inventory_item_id,owner_user_id,collection_id,slot_id) SELECT 'synthetic/independent-copy',$1,$2,id FROM owned", [owner, sample.id, sample.input.slotIds[0]], "creation_dependent_rows")
    await conflict("INSERT INTO public.binder_shares(owner_user_id,binder_id,token) VALUES($1,$2,'synthetic-share-token')", [owner, sample.id], "creation_dependent_rows")
    await conflict("INSERT INTO public.binder_history_state(binder_id) VALUES($1)", [sample.id], "creation_dependent_rows")
    await conflict("UPDATE public.binders SET name='Synthetic renamed' WHERE id=$1", [sample.id], "entity_changed_or_identity_occupied")
    await conflict("INSERT INTO public.collection_activity(owner_user_id,before_state,after_state) VALUES($1,'{}','{}')", [owner], "creation_history_incomplete")
    // ABA metadata and even a subsequently removed dependent share must retain a conflict.
    await db.query("SAVEPOINT aba")
    await db.query("UPDATE public.binders SET name='Synthetic temporary' WHERE id=$1", [sample.id]); await flush(db)
    await db.query("UPDATE public.binders SET name=$2 WHERE id=$1", [sample.id, sample.input.name]); await flush(db)
    assert.ok((await preview(db, sample.event.id)).conflicts.some((c: { reason: string }) => c.reason === "creation_later_dependency_change"))
    await db.query("ROLLBACK TO SAVEPOINT aba")
    await db.query("SAVEPOINT share_aba")
    await db.query("INSERT INTO public.binder_shares(owner_user_id,binder_id,token) VALUES($1,$2,'synthetic-transient-share')", [owner, sample.id]); await flush(db)
    await db.query("DELETE FROM public.binder_shares WHERE binder_id=$1", [sample.id]); await flush(db)
    assert.ok((await preview(db, sample.event.id)).conflicts.some((c: { reason: string }) => c.reason === "creation_later_dependency_change"))
    await db.query("ROLLBACK TO SAVEPOINT share_aba")
    await db.query("SAVEPOINT incomplete")
    await db.query("INSERT INTO public.binders(owner_user_id,name) VALUES($1,'Synthetic incomplete creation')", [owner])
    const incompleteContext = { actor: { kind: "user", userId: owner }, ...intent, operationId: "synthetic-incomplete-create" }
    await db.query("SELECT collection_audit_private.command_result($1,$2,'collection.create')", [owner, { context: incompleteContext }]); await flush(db)
    const incomplete = (await db.query("SELECT id FROM public.collection_activity WHERE owner_user_id=$1 AND operation_id='synthetic-incomplete-create'", [owner])).rows[0].id
    const incompletePlan = await preview(db, incomplete)
    assert.equal(incompletePlan.planToken, null)
    assert.ok(incompletePlan.unsupported.includes("missing_native_creation_evidence"))
    await db.query("ROLLBACK TO SAVEPOINT incomplete")
    plan = await preview(db, sample.event.id)
    await db.query("UPDATE public.inventory_owner_state SET inventory_revision=inventory_revision+1 WHERE owner_user_id=$1", [owner]); await flush(db)
    await db.query("SAVEPOINT stale")
    await assert.rejects(apply(db, request(sample.event.id, plan.planToken)), /recovery_plan_conflict/)
    await db.query("ROLLBACK TO SAVEPOINT stale")
    plan = await preview(db, sample.event.id)
    const recover = request(sample.event.id, plan.planToken)
    await db.query("SAVEPOINT cancellation")
    await db.query(`CREATE FUNCTION pg_temp.pause_recovery() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.2); RETURN OLD; END $$;
      CREATE TRIGGER synthetic_pause_recovery BEFORE DELETE ON public.binder_slots FOR EACH ROW EXECUTE FUNCTION pg_temp.pause_recovery()`)
    await db.query("SET LOCAL statement_timeout='50ms'; SAVEPOINT interrupted")
    await assert.rejects(apply(db, recover), (e: unknown) => !!e && typeof e === "object" && "code" in e && e.code === "57014")
    await db.query("ROLLBACK TO SAVEPOINT interrupted")
    assert.equal((await db.query("SELECT count(*)::int n FROM public.binder_slots WHERE collection_id=$1", [sample.id])).rows[0].n, 2)
    assert.equal((await db.query("SELECT count(*)::int n FROM public.developer_idempotency WHERE request_key=$1", [recover.operationId])).rows[0].n, 0)
    await db.query("ROLLBACK TO SAVEPOINT cancellation")
    // A recorder exception after deletion must roll back roots, children and ledger together.
    await db.query("SAVEPOINT recorder")
    await db.query(`CREATE FUNCTION pg_temp.reject_recovery() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic recorder failure'; END $$;
      CREATE TRIGGER synthetic_reject_recovery BEFORE INSERT ON public.collection_activity FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_recovery()`)
    await db.query("SAVEPOINT failed_apply")
    await assert.rejects(apply(db, recover), /synthetic recorder failure/)
    await db.query("ROLLBACK TO SAVEPOINT failed_apply")
    assert.equal((await db.query("SELECT count(*)::int n FROM public.binder_slots WHERE collection_id=$1", [sample.id])).rows[0].n, 2)
    assert.equal((await db.query("SELECT count(*)::int n FROM public.developer_idempotency WHERE request_key=$1", [recover.operationId])).rows[0].n, 0)
    await db.query("ROLLBACK TO SAVEPOINT recorder")
    const receipt = await apply(db, recover)
    assert.deepEqual(await apply(db, recover), receipt)
    await db.query("SAVEPOINT changed_intent")
    await assert.rejects(apply(db, { ...recover, planToken: "0".repeat(64) }), /idempotency_conflict/)
    await db.query("ROLLBACK TO SAVEPOINT changed_intent")
    await db.query("SAVEPOINT changed_replay")
    await assert.rejects(apply(db, { ...recover, confirmed: false }), /invalid_recovery_request/)
    await db.query("ROLLBACK TO SAVEPOINT changed_replay")
    await db.query("SAVEPOINT revoked")
    await db.query("DELETE FROM public.partnerships WHERE owner_user_id=$1", [owner])
    await assert.rejects(apply(db, recover, partner), /recovery_access_denied/)
    await db.query("ROLLBACK TO SAVEPOINT revoked")
    await db.query("SAVEPOINT immutable")
    await assert.rejects(db.query("UPDATE public.collection_activity SET action='rewritten' WHERE id=$1", [sample.event.id]), /immutable/)
    await db.query("ROLLBACK TO SAVEPOINT immutable")
  } finally { await db.query("ROLLBACK"); await db.end() }
})

test("private native creation recovery: complete 1025/4096 layouts, later history, linked inverse and original receipts", { skip: !socket, timeout: 120000 }, async () => {
  if (!socket) return
  assert.equal(socket, config.host)
  const db = new Client(config); await db.connect()
  try {
    await db.query("BEGIN; SET LOCAL statement_timeout='10s'")
    await db.query("INSERT INTO auth.users(id,created_at) VALUES($1,'2020-01-01')", [owner])
    await db.query("UPDATE public.billing_configuration SET enforced=false"); await flush(db)
    await create(db)
    for (const count of [1025, 4096]) {
      await db.query("SAVEPOINT layout")
      const sample = await create(db, count, owner, count === 4096)
      // Populated later owner history is complete, not sampled to recent events.
      for (let n = 0; n < 512; n++) {
        await db.query("UPDATE public.inventory_owner_state SET inventory_revision=inventory_revision+1 WHERE owner_user_id=$1", [owner]); await flush(db)
      }
      const started = performance.now()
      const plan = await preview(db, sample.event.id)
      const previewMs = Math.round(performance.now() - started)
      assert.deepEqual(plan.conflicts, [])
      assert.equal(plan.changes.length, count + 2)
      assert.equal(normalizeStorageResult("recovery.preview", plan).planToken, plan.planToken)
      const applyStarted = performance.now()
      const receipt = await apply(db, request(sample.event.id, plan.planToken))
      const applyMs = Math.round(performance.now() - applyStarted)
      assert.equal((await db.query("SELECT count(*)::int n FROM public.binder_slots WHERE collection_id=$1", [sample.id])).rows[0].n, 0)
      assert.deepEqual((await db.query("SELECT * FROM public.collection_activity WHERE id=$1", [sample.event.id])).rows[0], sample.event)
      // Creation replay remains historical acceptance, never recreating removed entities.
      const ctx = { actor: { kind: "user", userId: owner }, ...intent, operationId: sample.input.operationId, action: "collection.create" }
      assert.deepEqual((await db.query("SELECT collection_audit_private.create_collection_v1($1,$1,$2,$3) r", [owner, sample.input, ctx])).rows[0].r, sample.receipt)
      assert.equal((await db.query("SELECT count(*)::int n FROM public.binders WHERE id=$1", [sample.id])).rows[0].n, 0)
      // Undoing this inverse reuses ordinary deletion recovery and the exact stable IDs.
      const undo = await preview(db, receipt.eventId)
      assert.deepEqual(undo.conflicts, [])
      await apply(db, request(receipt.eventId, undo.planToken))
      assert.deepEqual((await db.query("SELECT id FROM public.binder_slots WHERE collection_id=$1 ORDER BY position", [sample.id])).rows.map(r => r.id), sample.input.slotIds)
      console.log("synthetic creation recovery", JSON.stringify({ count, laterEvents: 512, previewMs, applyMs }))
      await db.query("ROLLBACK TO SAVEPOINT layout")
    }
  } finally { await db.query("ROLLBACK"); await db.end() }
})

const raceDatabase = process.env.CREATION_RECOVERY_RACE_DATABASE
test("synthetic disposable SQL races: replay once, membership and dependent inserts blocked, unlink-first and stale lock recheck", { skip: !socket || !raceDatabase, timeout: 30000 }, async () => {
  if (!socket) return
  assert.equal(socket, config.host)
  if (!raceDatabase) return
  assert.equal(raceDatabase, "holofolder_fresh_creation_recovery")
  const a = new Client({ ...config, database: raceDatabase }), b = new Client({ ...config, database: raceDatabase })
  await a.connect(); await b.connect()
  const waiting = async (observer: Client, pid: number) => {
    for (let n = 0; n < 100; n++) {
      if ((await observer.query("SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1", [pid])).rows[0]?.wait_event_type === "Lock") return
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    assert.fail("expected concurrent SQL to wait on the held lock")
  }
  const begin = (db: Client) => db.query("BEGIN; SET LOCAL statement_timeout='5s'")
  try {
    await a.query("INSERT INTO auth.users(id,created_at) VALUES($1,'2020-01-01'),($2,'2020-01-01')", [owner, partner])
    await a.query("UPDATE public.billing_configuration SET enforced=false")
    await a.query("INSERT INTO public.partnerships(user1_id,user2_id,owner_user_id) VALUES($1,$2,$1)", [owner, partner])
    const aPid = (await a.query("SELECT pg_backend_pid() pid")).rows[0].pid, bPid = (await b.query("SELECT pg_backend_pid() pid")).rows[0].pid
    await begin(a); await create(a); await a.query("COMMIT")
    await begin(a); const sample = await create(a, 4, partner); await a.query("COMMIT")
    const plan = await preview(a, sample.event.id, partner), recover = request(sample.event.id, plan.planToken)
    await begin(a)
    const first = await apply(a, recover, partner)
    for (const [sql, params] of [
      ["DELETE FROM public.partnerships WHERE owner_user_id=$1", [owner]],
      ["UPDATE public.partnerships SET owner_user_id=$2 WHERE owner_user_id=$1", [owner, partner]],
      ["INSERT INTO public.binder_shares(owner_user_id,binder_id,token) VALUES($1,$2,'synthetic-race-share')", [owner, sample.id]],
    ] as const) {
      await b.query("BEGIN; SET LOCAL lock_timeout='100ms'")
      await assert.rejects(b.query(sql, [...params]), (e: unknown) => !!e && typeof e === "object" && "code" in e && e.code === "55P03")
      await b.query("ROLLBACK")
    }
    await begin(b)
    const replay = apply(b, recover, partner)
    await waiting(a, bPid)
    await a.query("COMMIT")
    assert.deepEqual(await replay, first)
    await b.query("COMMIT")
    assert.equal((await a.query("SELECT count(*)::int n FROM public.collection_activity WHERE recovery_of_event_id=$1", [sample.event.id])).rows[0].n, 1)
    assert.equal((await a.query("SELECT count(*)::int n FROM public.developer_idempotency WHERE operation='recovery_v1' AND request_key=$1", [recover.operationId])).rows[0].n, 1)
    // Genuine service-only gateway replay has the same current-membership requirement.
    await begin(a); const staleSample = await create(a, 2); await a.query("COMMIT")
    const stalePlan = await preview(a, staleSample.event.id, partner), staleRequest = request(staleSample.event.id, stalePlan.planToken)
    await begin(b)
    await b.query("UPDATE public.binders SET name='Synthetic locked rename' WHERE id=$1", [staleSample.id])
    await begin(a)
    const stale = assert.rejects(apply(a, staleRequest, partner), /recovery_plan_conflict/)
    await waiting(b, aPid)
    await b.query("COMMIT"); await stale; await a.query("ROLLBACK")
    assert.equal((await a.query("SELECT name FROM public.binders WHERE id=$1", [staleSample.id])).rows[0].name, "Synthetic locked rename")
    const beforeUnlink = await preview(a, staleSample.event.id, partner)
    assert.equal(beforeUnlink.planToken, null)
    await begin(b); await b.query("DELETE FROM public.partnerships WHERE owner_user_id=$1", [owner])
    await begin(a)
    const denied = assert.rejects(apply(a, recover, partner), /recovery_access_denied/)
    await waiting(b, aPid)
    assert.equal((await b.query("SELECT count(*)::int n FROM pg_locks WHERE pid=$1 AND locktype='advisory' AND granted", [aPid])).rows[0].n, 0)
    await b.query("COMMIT"); await denied; await a.query("ROLLBACK")
  } finally { await a.query("ROLLBACK"); await b.query("ROLLBACK"); await a.end(); await b.end() }
})
