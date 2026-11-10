import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { Client } from 'pg'

// Explicit private Unix socket only. No environment credentials or hosted mode.
const socket = process.env.EMPTY_OWNER_CREATION_TEST_SOCKET
const database = process.env.EMPTY_OWNER_CREATION_TEST_DATABASE ?? 'postgres'
const config = { host: '/Users/cal/.local/share/holofolder/onboarding098-local', port: 55598, user: 'onboarding098', database }
const owner = '00980000-0000-4000-8000-000000000001'
const partner = '00980000-0000-4000-8000-000000000002'
const stranger = '00980000-0000-4000-8000-000000000003'
const migration = readFileSync(new URL('../scripts/098_empty_owner_first_creation.sql', import.meta.url), 'utf8')
function request(count = 0) {
  const collectionId = randomUUID()
  return { version: 1, operationId: 'synthetic-' + randomUUID(), inventoryRevision: 0, collectionId, name: 'Synthetic first collection',
    kind: 'binder', defaultPresentation: 'binder', location: null, grid: { rows: 3, cols: 3 },
    manifest: { source: { id: 'blank', version: '1' }, name: 'Synthetic blank', entries: Array.from({ length: count }, (_, n) => ({ id: 'entry-' + n, target: { kind: 'pokemon', pokemonId: n + 1 } })) },
    slotIds: Array.from({ length: count }, (_, n) => collectionId + '/slot-' + n) }
}
async function seed(db: Client) {
  await db.query("INSERT INTO auth.users(id,created_at) VALUES($1,'2020-01-01'),($2,'2020-01-01'),($3,'2020-01-01')", [owner, partner, stranger])
  await db.query('INSERT INTO public.billing_configuration(id,enforced) VALUES(true,false) ON CONFLICT(id) DO UPDATE SET enforced=false')
  await db.query('INSERT INTO public.partnerships(user1_id,user2_id,owner_user_id) VALUES($1,$2,$1)', [owner, partner])
}
async function send(db: Client, input: Record<string, unknown>, actor = owner, recipient = owner, source = 'app', operation = 'collection.create') {
  await db.query('RESET ROLE')
  await db.query("SELECT set_config('request.headers',$1,true),set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)", [JSON.stringify({ 'x-holo-audit-context': JSON.stringify({ actor: { kind: 'user', userId: actor }, source, clientId: null, batchId: null, clientOccurredAt: null, operationId: input.operationId }) })])
  await db.query('SET LOCAL ROLE service_role')
  return (await db.query('SELECT public.storage_execute_v1($1,$2,$3) r', [operation, recipient, input])).rows[0].r
}
async function flush(db: Client) { await db.query('RESET ROLE; SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED') }
async function fails(db: Client, call: () => Promise<unknown>, code: string) {
  await db.query('RESET ROLE; SAVEPOINT rejected')
  await assert.rejects(call(), (e: unknown) => !!e && typeof e === 'object' && 'code' in e && e.code === code)
  await db.query('ROLLBACK TO SAVEPOINT rejected; RESET ROLE')
}
async function state(db: Client) {
  await db.query('RESET ROLE')
  return (await db.query(`SELECT jsonb_build_object(
    'roots',(SELECT jsonb_agg(to_jsonb(t)) FROM public.inventory_owner_state t WHERE owner_user_id=$1),
    'binders',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.binders t WHERE owner_user_id=$1),
    'states',(SELECT jsonb_agg(to_jsonb(t) ORDER BY collection_id) FROM public.storage_collection_state t WHERE owner_user_id=$1),
    'slots',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.binder_slots t WHERE owner_user_id=$1),
    'items',(SELECT jsonb_agg(to_jsonb(t)) FROM public.inventory_items t WHERE owner_user_id=$1),
    'placements',(SELECT jsonb_agg(to_jsonb(t)) FROM public.inventory_placements t WHERE owner_user_id=$1),
    'events',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.collection_activity t WHERE owner_user_id=$1),
    'receipts',(SELECT jsonb_agg(to_jsonb(t) ORDER BY request_key) FROM public.developer_idempotency t WHERE actor_id IN ($1,$2)),
    'acquisitions',(SELECT count(*) FROM public.partner_acquisitions WHERE owner_user_id=$1)) r`, [owner, partner])).rows[0].r
}
function allowLocal() {
  assert.equal(socket, config.host)
  assert.ok(['postgres', 'holofolder_fresh_onboarding098'].includes(database))
}

test('098 missing-root creation through actual service gateway, no fabricated proof, atomic failure and scopes', { skip: !socket, timeout: 60000 }, async () => {
  allowLocal()
  const db = new Client(config); await db.connect()
  try {
    const definitions = async () => (await db.query(`SELECT p.oid::regprocedure::text name,pg_get_functiondef(p.oid) body,p.proacl::text acl,p.proowner,p.proconfig
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','collection_audit_private') AND p.prokind='f' ORDER BY 1`)).rows
    const before = await definitions()
    await db.query(migration); const after = await definitions(); await db.query(migration)
    assert.deepEqual(await definitions(), after, 'second application is byte-identical')
    const changed = before.filter((f, i) => f.body !== after[i].body).map(f => f.name)
    // Fresh replay already installed 098; restored 097 changes exactly these two helpers.
    assert.ok(changed.length === 0 || changed.length === 2)
    assert.ok(changed.every(n => n.startsWith('collection_audit_private.create_collection_v1(') || n.startsWith('collection_audit_private.execute_creation_import_v1(')))
    assert.deepEqual(before.map(({ body: _body, ...metadata }) => metadata), after.map(({ body: _body, ...metadata }) => metadata))
    for (const role of ['anon', 'authenticated', 'holo_mcp', 'service_role']) {
      for (const name of ['create_collection_v1(uuid,uuid,jsonb,jsonb)', 'execute_creation_import_v1(text,uuid,uuid,jsonb,jsonb)']) {
        assert.equal((await db.query('SELECT has_function_privilege($1,$2,\'EXECUTE\') allowed', [role, 'collection_audit_private.' + name])).rows[0].allowed, false)
      }
    }
    await db.query("BEGIN; SET LOCAL statement_timeout='10s'"); await seed(db); await flush(db)
    const empty = await state(db)
    assert.equal(empty.roots, null); assert.equal(empty.binders, null)
    for (const input of [{ ...request(), unknown: true }, { ...request(), manifest: null }, { ...request(), grid: { rows: 0, cols: 3 } }]) {
      await fails(db, () => send(db, input), '22023'); assert.deepEqual(await state(db), empty)
    }
    await fails(db, () => send(db, request(), owner, owner, 'app', 'synthetic.unknown'), '22023')
    for (const input of [{ ...request(), inventoryRevision: 1 }, { ...request(), collectionId: '00000000-0000-4000-8000-000000000099' }]) {
      if (input.inventoryRevision === 0) {
        await db.query('SAVEPOINT collision')
        await db.query("INSERT INTO public.binders(id,owner_user_id,name,is_default) VALUES($1,$2,'Synthetic other owner',true)", [input.collectionId, stranger]); await flush(db)
      }
      await fails(db, () => send(db, input), '55000')
      if (input.inventoryRevision === 0) await db.query('ROLLBACK TO SAVEPOINT collision')
      assert.deepEqual(await state(db), empty, 'no absent-state terminal receipt or partial root')
    }
    await fails(db, () => send(db, request(), stranger), '42501')
    await fails(db, () => send(db, request(), owner, partner), '42501')
    for (const source of ['rest', 'mcp']) await fails(db, () => send(db, request(), owner, owner, source), 'HF402')
    assert.deepEqual(await state(db), empty)
    const unknownTarget = request(1)
    unknownTarget.manifest.entries[0].target.pokemonId = 9999
    await fails(db, () => send(db, unknownTarget), '22023'); assert.deepEqual(await state(db), empty)
    await db.query('SAVEPOINT freeplan; UPDATE public.billing_configuration SET enforced=true')
    await fails(db, () => send(db, { ...request(), grid: { rows: 8, cols: 8 } }), 'P0001')
    assert.deepEqual(await state(db), empty); await db.query('ROLLBACK TO SAVEPOINT freeplan')
    // Legacy binder/source and native mixed owners cannot acquire a fictional empty root.
    await db.query('SAVEPOINT legacy')
    const legacy = randomUUID()
    await db.query("INSERT INTO public.binders(id,owner_user_id,name,is_default) VALUES($1,$2,'Synthetic legacy',true)", [legacy, owner]); await flush(db)
    await fails(db, () => send(db, request()), '55000')
    await db.query("INSERT INTO public.pokemon_collection(binder_id,user_id,pokemon_id,pokemon_name,status) VALUES($1,$2,1,'Synthetic legacy','collected')", [legacy, owner]); await flush(db)
    await fails(db, () => send(db, request()), '55000')
    await db.query('ROLLBACK TO SAVEPOINT legacy')
    // Each residue predicate independently, including otherwise impossible/corrupt orphan rows.
    // Disable triggers only inside this rolled-back superuser fixture, never in the executor.
    const residues = [
      ["INSERT INTO public.pokemon_collection(binder_id,user_id,pokemon_id,pokemon_name) VALUES($1,$2,1,'Synthetic orphan')", [randomUUID(), owner]],
      ["INSERT INTO public.storage_collection_state(collection_id,owner_user_id) VALUES($1,$2)", [randomUUID(), owner]],
      ["INSERT INTO public.binder_slots(id,collection_id,owner_user_id,position) VALUES('synthetic-orphan',$1,$2,0)", [randomUUID(), owner]],
      ["INSERT INTO public.inventory_items(id,owner_user_id,identity) VALUES('synthetic-orphan',$1,'{\"kind\":\"pokemon\",\"pokemonId\":1}')", [owner]],
      ["INSERT INTO public.inventory_placements(inventory_item_id,owner_user_id,collection_id,slot_id) VALUES('synthetic-orphan',$1,$2,'synthetic-slot')", [owner, randomUUID()]],
      ["INSERT INTO public.binder_legacy_rows(legacy_row_id,collection_id,owner_user_id,slot_id,source_row) VALUES($1,$2,$3,'synthetic-slot','{}')", [randomUUID(), randomUUID(), owner]],
    ] as const
    for (const [sql, params] of residues) {
      await db.query('SAVEPOINT residue; SET LOCAL session_replication_role=replica')
      await db.query(sql, [...params]); await db.query('SET LOCAL session_replication_role=origin')
      const baseline = await state(db); await fails(db, () => send(db, request()), '55000'); assert.deepEqual(await state(db), baseline)
      await db.query('ROLLBACK TO SAVEPOINT residue')
    }
    // Failure after original root INSERT must roll back all root/default/audit/receipt work.
    await db.query('SAVEPOINT recorder')
    await db.query("CREATE OR REPLACE FUNCTION collection_audit_private.command_result(owner_id uuid,result jsonb,action text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic recorder failure'; END $$")
    await fails(db, () => send(db, request(3)), 'P0001'); assert.deepEqual(await state(db), empty)
    await db.query('ROLLBACK TO SAVEPOINT recorder')
    await db.query('SAVEPOINT deferred')
    await db.query("CREATE FUNCTION public.synthetic_fail_commit_098() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic deferred failure'; END $$; CREATE CONSTRAINT TRIGGER synthetic_fail_commit_098 AFTER INSERT ON public.binders DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.synthetic_fail_commit_098()")
    await fails(db, async () => { await send(db, request()); await flush(db) }, 'P0001')
    assert.deepEqual(await state(db), empty); await db.query('ROLLBACK TO SAVEPOINT deferred')
    for (const count of [0, 3]) {
      await db.query('SAVEPOINT accepted')
      const input = request(count), result = await send(db, input, partner); await flush(db)
      assert.equal(result.inventoryRevision, 1); assert.deepEqual(result.slotIds, input.slotIds)
      const accepted = await state(db)
      assert.equal(accepted.roots.length, 1); assert.equal(accepted.binders.length, 1); assert.equal(accepted.binders[0].is_default, true)
      assert.equal(accepted.states[0].authority, 'slots'); assert.equal(accepted.states[0].conversion_receipt, null)
      assert.equal(accepted.slots?.length ?? 0, count); assert.equal(accepted.events.length, 1); assert.equal(accepted.receipts.length, 1)
      assert.equal(accepted.items, null); assert.equal(accepted.placements, null)
      assert.equal(accepted.events[0].actor_user_id, partner)
      for (let n = 0; n < count; n++) assert.deepEqual(accepted.slots.find((s: { id: string }) => s.id === input.slotIds[n]).target, input.manifest.entries[n].target)
      assert.deepEqual(await send(db, input, partner), result); await flush(db); assert.deepEqual(await state(db), accepted)
      await fails(db, () => send(db, { ...input, name: 'Changed' }, partner), '40001')
      const stale = request(), proof = await send(db, stale, partner); await flush(db)
      assert.deepEqual(proof, { outcome: 'rejected', operationId: stale.operationId, code: 'inventory_revision_conflict', inventoryRevision: 1 })
      assert.deepEqual(await send(db, stale, partner), proof)
      await db.query('RESET ROLE; SAVEPOINT revoked; DELETE FROM public.partnerships WHERE owner_user_id=\'' + owner + "'")
      await fails(db, () => send(db, input, partner), '42501'); await db.query('ROLLBACK TO SAVEPOINT revoked')
      await db.query('SAVEPOINT billing; UPDATE public.billing_configuration SET enforced=true')
      await fails(db, () => send(db, input, partner), '42501'); await db.query('ROLLBACK TO SAVEPOINT billing')
      await db.query('SAVEPOINT audit_residue; SET LOCAL session_replication_role=replica')
      for (const table of ['inventory_owner_state', 'binders', 'storage_collection_state', 'binder_slots']) await db.query(`DELETE FROM public.${table} WHERE owner_user_id=$1`, [owner])
      await db.query('SET LOCAL session_replication_role=origin')
      await fails(db, () => send(db, request()), '55000')
      await db.query('ROLLBACK TO SAVEPOINT audit_residue')
      await db.query('ROLLBACK TO SAVEPOINT accepted'); assert.deepEqual(await state(db), empty)
    }
    await db.query('ROLLBACK')
  } finally { await db.query('ROLLBACK'); await db.end() }
})

test('098 committed concurrent first creations serialize, exact replay commits once and stale intent retains existing-root proof', { skip: !socket || database !== 'holofolder_fresh_onboarding098', timeout: 60000 }, async () => {
  allowLocal()
  const a = new Client(config), b = new Client(config); await a.connect(); await b.connect()
  try {
    await a.query('BEGIN'); await seed(a); await a.query('COMMIT')
    const first = request(), competing = request()
    await a.query('BEGIN'); const receipt = await send(a, first); await flush(a)
    const bpid = (await b.query('SELECT pg_backend_pid() pid')).rows[0].pid
    await b.query('BEGIN'); const waiting = send(b, competing, partner)
    let blocked = false
    for (let n = 0; n < 100; n++) {
      blocked = (await a.query('SELECT cardinality(pg_blocking_pids($1))>0 blocked', [bpid])).rows[0].blocked
      if (blocked) break
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    assert.equal(blocked, true, 'second creation actually waits for the first transaction')
    await a.query('COMMIT'); const proof = await waiting; await flush(b); await b.query('COMMIT')
    assert.equal(proof.outcome, 'rejected'); assert.equal(proof.inventoryRevision, 1)
    await b.query('BEGIN'); assert.deepEqual(await send(b, first), receipt); await flush(b); await b.query('COMMIT')
    const saved = await state(a)
    assert.equal(saved.roots.length, 1); assert.equal(saved.binders.length, 1); assert.equal(saved.binders[0].is_default, true)
    assert.equal(saved.events.length, 1); assert.equal(saved.receipts.length, 2)
    assert.equal(saved.items, null); assert.equal(saved.placements, null)
    await a.query('BEGIN'); assert.deepEqual(await send(a, competing, partner), proof); await flush(a); await a.query('COMMIT')
    assert.deepEqual(await state(a), saved)
    // A committed blank first collection is visible from another connection.
    assert.equal((await b.query('SELECT count(*)::int n FROM public.binders WHERE id=$1', [first.collectionId])).rows[0].n, 1)
  } finally {
    await a.query('ROLLBACK; RESET ROLE'); await b.query('ROLLBACK; RESET ROLE')
    // Entire database is synthetic and explicitly disposable. Parent owns hosted cleanup.
    await a.end(); await b.end()
  }
})
