import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Client } from 'pg'
import { rawRestoreFixture, rawOwner as owner, rawPartner as partner, rawCollection as collection } from './fixtures/raw-restore'
import { planRawContentRestore  } from '@/lib/raw-restore-plan'
import { normalizeStorageResult } from '@/lib/server/operations/storage-contract'
import type { RawRestoreCommand } from '@/lib/domain/raw-restore'

const enabled = process.env.RAW_RESTORE_V2_TEST_SOCKET
const config = { host: '/Users/cal/.local/share/holofolder/raw-restore-095-local/s', port: 55595, user: 'restore095', database: 'preserve095' }
async function connect(database = config.database) {
  assert.equal(enabled, config.host)
  const db = new Client({ ...config, database }); await db.connect(); return db
}
const flush = (db: Client) => db.query('RESET ROLE; SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED')
async function seed(db: Client) {
  const f = await rawRestoreFixture()
  await db.query('INSERT INTO auth.users(id) VALUES($1),($2)', [owner, partner])
  await db.query('UPDATE public.billing_configuration SET enforced=false')
  await db.query("INSERT INTO public.partnerships(id,user1_id,user2_id,owner_user_id) VALUES('00940000-0000-4000-8000-000000000003',$1,$2,$1)", [owner, partner])
  await db.query('INSERT INTO public.inventory_owner_state(owner_user_id,inventory_revision) VALUES($1,8)', [owner])
  await db.query("INSERT INTO public.binders(id,owner_user_id,name,is_default,binder_rows,binder_cols) VALUES($1,$2,'Synthetic raw',true,3,3)", [collection, owner])
  await db.query("INSERT INTO public.storage_collection_state(collection_id,owner_user_id,authority,version,layout_revision) VALUES($1,$2,'slots',2,3)", [collection, owner])
  for (const item of f.snapshot.items) await db.query('INSERT INTO public.inventory_items(id,owner_user_id,identity,version) VALUES($1,$2,$3,1)', [item.id, owner, item.identity])
  for (const [n, s] of f.snapshot.binders[0].slots.entries()) await db.query('INSERT INTO public.binder_slots(id,owner_user_id,collection_id,position,status,version) VALUES($1,$2,$3,$4,$5,4)', [s.id, owner, collection, n, s.status])
  for (const p of f.snapshot.placements) await db.query('INSERT INTO public.inventory_placements(inventory_item_id,owner_user_id,collection_id,slot_id,version) VALUES($1,$2,$3,$4,2)', [p.inventoryItemId, owner, collection, p.slotId])
  await db.query("INSERT INTO public.tcg_series(id,name_json) VALUES('synthetic-raw-series','{}') ON CONFLICT DO NOTHING; INSERT INTO public.tcg_sets(id,series_id,name_json) VALUES('synthetic-raw-set','synthetic-raw-series','{}') ON CONFLICT DO NOTHING; INSERT INTO public.tcg_cards(id,series_id,set_id,local_id,name_json) VALUES('synthetic-raw-trainer','synthetic-raw-series','synthetic-raw-set','1','{}') ON CONFLICT DO NOTHING")
  await flush(db)
  return planRawContentRestore(f.input).request
}
async function send(db: Client, request: RawRestoreCommand | Record<string, unknown>, actor = partner, source = 'app', clientId: string | null = null, operation = 'backup.restore.raw') {
  await db.query('RESET ROLE')
  await db.query("SELECT set_config('request.headers',$1,true),set_config('request.jwt.claims',$2,true)", [JSON.stringify({ 'x-holo-audit-context': JSON.stringify({ actor: { kind: 'user', userId: actor }, source, clientId, operationId: request.operationId, batchId: request.operationId, clientOccurredAt: null }) }), JSON.stringify({ role: 'service_role' })])
  await db.query('SET LOCAL ROLE service_role')
  const body = { ...request }
  if (operation === 'recovery.preview') delete (body as Record<string, unknown>).operationId
  return (await db.query('SELECT public.storage_execute_v1($1,$2,$3) r', [operation, owner, body])).rows[0].r
}
async function state(db: Client) {
  await db.query('RESET ROLE')
  return (await db.query(`SELECT jsonb_build_object(
    'items',(SELECT jsonb_agg(i ORDER BY id) FROM public.inventory_items i WHERE owner_user_id=$1),
    'slots',(SELECT jsonb_agg(s ORDER BY position) FROM public.binder_slots s WHERE owner_user_id=$1),
    'placements',(SELECT jsonb_agg(p ORDER BY inventory_item_id) FROM public.inventory_placements p WHERE owner_user_id=$1),
    'root',(SELECT to_jsonb(r) FROM public.inventory_owner_state r WHERE owner_user_id=$1),
    'collections',(SELECT jsonb_agg(c ORDER BY collection_id) FROM public.storage_collection_state c WHERE owner_user_id=$1),
    'history',(SELECT jsonb_agg(a ORDER BY id) FROM public.collection_activity a WHERE owner_user_id=$1),
    'ledger',(SELECT jsonb_agg(l ORDER BY request_key) FROM public.developer_idempotency l WHERE actor_id IN ($1,$2))) r`, [owner, partner])).rows[0].r
}
async function fails(db: Client, run: () => Promise<unknown>, code: string) {
  await db.query('SAVEPOINT fail')
  await assert.rejects(run(), (e: unknown) => !!e && typeof e === 'object' && 'code' in e && e.code === code)
  await db.query('ROLLBACK TO SAVEPOINT fail; RESET ROLE')
}

test('095 twice preserves source rows, table/column ACLs, RLS and unrelated compiled functions', { skip: !enabled }, async () => {
  const db = await connect()
  try {
    const access = async () => (await db.query(`SELECT c.oid::regclass::text name,relowner,relacl::text,relrowsecurity,relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','collection_audit_private','auth','storage') ORDER BY 1`)).rows
    const columns = async () => (await db.query(`SELECT attrelid,attnum,attacl::text FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','collection_audit_private','auth','storage') AND attnum>0 ORDER BY 1,2`)).rows
    const policies = async () => (await db.query('SELECT * FROM pg_policies ORDER BY schemaname,tablename,policyname')).rows
    const functions = async () => (await db.query("SELECT p.oid::regprocedure::text name,md5(pg_get_functiondef(p.oid)) digest,proowner,proacl::text,proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','collection_audit_private') ORDER BY 1")).rows
    const baseline = await connect('preserve095baseline')
    try {
      const priorFunctions = (await baseline.query("SELECT p.oid::regprocedure::text name,md5(pg_get_functiondef(p.oid)) digest,proowner,proacl::text,proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','collection_audit_private') ORDER BY 1")).rows
      const installed = await functions()
      assert.equal(installed.length, priorFunctions.length + 1)
      for (const before of priorFunctions) {
        const next = installed.find(f => f.name === before.name)!
        assert.equal(next.proowner, before.proowner); assert.equal(next.proacl, before.proacl); assert.deepEqual(next.proconfig, before.proconfig)
        if (before.name !== 'storage_execute_v1(text,uuid,jsonb)') assert.equal(next.digest, before.digest)
      }
      assert.deepEqual(await access(), (await baseline.query("SELECT c.oid::regclass::text name,relowner,relacl::text,relrowsecurity,relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','collection_audit_private','auth','storage') ORDER BY 1")).rows)
      assert.deepEqual(await policies(), (await baseline.query('SELECT * FROM pg_policies ORDER BY schemaname,tablename,policyname')).rows)
      const columnAcl = "SELECT attrelid::regclass::text name,attnum,attacl::text FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','collection_audit_private','auth','storage') AND attnum>0 ORDER BY 1,2"
      assert.deepEqual((await db.query(columnAcl)).rows, (await baseline.query(columnAcl)).rows)
    } finally { await baseline.end() }
    const original = await functions(), acl = await access(), cols = await columns(), policy = await policies()
    const sql = readFileSync(new URL('../scripts/095_raw_content_restore_v2.sql', import.meta.url), 'utf8')
    await db.query(sql); const once = await functions(); await db.query(sql)
    assert.deepEqual(await functions(), once); assert.deepEqual(await access(), acl); assert.deepEqual(await columns(), cols); assert.deepEqual(await policies(), policy)
    assert.deepEqual(once, original, 'installed095 remains identical on repeated application')
    for (const role of ['anon', 'authenticated', 'holo_mcp', 'service_role']) assert.equal((await db.query("SELECT has_function_privilege($1,'collection_audit_private.restore_raw_content_v2(uuid,uuid,jsonb,jsonb)','EXECUTE') ok", [role])).rows[0].ok, false)
    const archive = '/Users/cal/.local/share/holofolder/backups/2026-11-10T03-19-03Z-before-093/'
    const counts = JSON.parse(readFileSync(archive + 'source-counts.json', 'utf8')), digests = JSON.parse(readFileSync(archive + 'source-critical-digests.json', 'utf8'))
    await db.query("SET TIME ZONE 'UTC'")
    for (const [name, count] of Object.entries(counts)) {
      assert.match(name, /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/)
      const r = (await db.query(`SELECT count(*)::int n${name in digests ? ",md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) digest" : ''} FROM ${name} t`)).rows[0]
      assert.equal(r.n, count); if (name in digests) assert.equal(r.digest, digests[name])
    }
  } finally { await db.end() }
})

test('095 real transaction preserves physical IDs, terminal replay, actor scope, raw graph and safe inverse', { skip: !enabled }, async () => {
  const db = await connect()
  try {
    await db.query('BEGIN'); const request = structuredClone(await seed(db)), before = await state(db)
    request.slots[1].after.wantedCards = [{ card_id: 'synthetic-raw-trainer', card_name: 'Synthetic Trainer', added_at: '2020-01-01', wanted_by: [partner] }]
    const receipt = await send(db, request); await flush(db)
    assert.equal(receipt.changed, true, JSON.stringify(receipt))
    normalizeStorageResult('backup.restore.raw', receipt)
    assert.deepEqual(receipt, { version: 2, inventoryRevision: 9, collectionId: collection, collectionVersion: 3, layoutRevision: 3, changed: true, slotIds: ['slot-a', 'slot-b'], releasedItemIds: ['copy-b'] })
    const after = await state(db)
    assert.deepEqual(after.items, before.items)
    assert.deepEqual(after.slots[1].wanted_cards, request.slots[1].after.wantedCards)
    assert.equal(after.placements.length, 1); assert.equal(after.placements[0].inventory_item_id, 'copy-a'); assert.equal(after.placements[0].slot_id, 'slot-a'); assert.equal(after.placements[0].version, 3)
    assert.deepEqual(after.slots.map((s: { id: string; version: number }) => [s.id, s.version]), [['slot-a', 5], ['slot-b', 5]])
    assert.equal(after.history.at(-1).action, 'backup.restore.raw'); assert.equal(after.history.at(-1).actor_user_id, partner)
    assert.deepEqual(await send(db, request), receipt); await flush(db); assert.deepEqual(await state(db), after)
    await fails(db, () => send(db, { ...request, inventoryRevision: 9 }), '40001')
    await fails(db, () => send(db, request, owner), '42501')
    const rejected = { ...request, operationId: 'synthetic-rejected-restore' }
    const terminal = await send(db, rejected); await flush(db)
    assert.equal(terminal.code, 'inventory_revision_conflict'); assert.equal(terminal.outcome, 'rejected')
    // Actual audit-generated inverse, no manual replacement or special restore recovery store.
    const eventId = after.history.at(-1).id.toString()
    const preview = await send(db, { operationId: 'synthetic-preview-recovery', eventId, restoreUnassignedItemIds: [] }, partner, 'app', null, 'recovery.preview')
    assert.equal(preview.supported, true); assert.equal(preview.conflicts.length, 0)
    await send(db, { operationId: 'synthetic-restore-inverse', eventId, restoreUnassignedItemIds: [], confirmed: true, planVersion: 1, planToken: preview.planToken }, partner, 'app', null, 'recovery.apply'); await flush(db)
    const recovered = await state(db)
    assert.deepEqual(recovered.items, before.items)
    assert.deepEqual(recovered.placements.map((p: { inventory_item_id: string; slot_id: string }) => [p.inventory_item_id, p.slot_id]), before.placements.map((p: { inventory_item_id: string; slot_id: string }) => [p.inventory_item_id, p.slot_id]))
    assert.ok(recovered.root.inventory_revision > after.root.inventory_revision)
    assert.deepEqual(await send(db, request), receipt); assert.deepEqual(await send(db, rejected), terminal)
    await flush(db)
    await db.query('DELETE FROM public.partnerships WHERE owner_user_id=$1', [owner])
    await fails(db, () => send(db, request), '42501')
  } finally { await db.query('ROLLBACK'); await db.end() }
})

test('095 rejects malformed/partial/over-budget/moved/graded intent, ordinary conflicts stay unknown; cancellation/allowance/audit rollback', { skip: !enabled }, async () => {
  const db = await connect()
  try {
    await db.query('BEGIN'); const r = await seed(db), original = await state(db)
    for (const patch of [{ ownerUserId: owner }, { releaseItemIds: [] }, { items: [...r.items, r.items[0]] },
      { slots: Array.from({ length: 1026 }, () => r.slots[0]) }, { items: Array.from({ length: 2051 }, () => r.items[0]) },
      { slots: [{ ...r.slots[0], after: { ...r.slots[0].after, target: { kind: 'pokemon', pokemonId: 0 } } }, r.slots[1]] }]) {
      await fails(db, () => send(db, { ...r, ...patch }), '22023')
    }
    assert.deepEqual(await state(db), original)
    const partial = await send(db, { ...r, operationId: 'synthetic-partial-restore', slots: r.slots.slice(0, 1) }); await flush(db)
    assert.equal(partial.code, 'raw_restore_content_conflict')
    const stale = await send(db, { ...r, operationId: 'synthetic-stale-content', collection: { ...r.collection, version: 1 } }); await flush(db)
    assert.equal(stale.code, 'raw_restore_collection_conflict')
    await db.query("UPDATE public.inventory_items SET version=version+1 WHERE id='copy-a'")
    await fails(db, () => send(db, r), '40001')
    assert.equal((await db.query('SELECT count(*)::int n FROM public.developer_idempotency WHERE request_key=$1', [r.operationId])).rows[0].n, 0)
    await db.query("UPDATE public.inventory_items SET version=version-1 WHERE id='copy-a'")
    await db.query('SAVEPOINT interruptions')
    await db.query(`CREATE FUNCTION pg_temp.interrupt_restore() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic cancel' USING ERRCODE='57014'; END $$;
      CREATE TRIGGER synthetic_interrupt BEFORE UPDATE ON public.binder_slots FOR EACH ROW EXECUTE FUNCTION pg_temp.interrupt_restore()`)
    const before = await state(db)
    await fails(db, () => send(db, r), '57014'); assert.deepEqual(await state(db), before)
    await db.query('ROLLBACK TO SAVEPOINT interruptions')
    await db.query(`CREATE FUNCTION pg_temp.reject_restore_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$;
      CREATE TRIGGER synthetic_audit BEFORE INSERT ON public.collection_activity FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_restore_audit()`)
    await db.query('SAVEPOINT audit'); await assert.rejects(send(db, r)); await db.query('ROLLBACK TO SAVEPOINT audit; RESET ROLE')
    assert.equal((await db.query('SELECT count(*)::int n FROM public.developer_idempotency WHERE request_key=$1', [r.operationId])).rows[0].n, 0)
  } finally { await db.query('ROLLBACK'); await db.end() }
})

test('095 raw scope, saved allowance, ownership RLS and later ABA recovery conflicts', { skip: !enabled }, async () => {
  const db = await connect()
  try {
    await db.query('BEGIN'); const r = await seed(db)
    for (const role of ['anon', 'authenticated', 'holo_mcp']) {
      await fails(db, async () => { await db.query('SET LOCAL ROLE ' + role); await db.query('SELECT public.storage_execute_v1($1,$2,$3)', ['backup.restore.raw', owner, r]) }, '42501')
    }
    for (const [actor, count] of [[owner, 2], [partner, 2], ['00950000-0000-4000-8000-000000000099', 0]] as const) {
      await db.query("SELECT set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: actor, role: 'authenticated' })])
      await db.query('SET LOCAL ROLE authenticated')
      assert.equal((await db.query('SELECT count(*)::int n FROM public.inventory_items')).rows[0].n, count)
      await db.query('RESET ROLE')
    }
    await db.query('SAVEPOINT raw_only')
    const grade = { provider: { kind: 'known', id: 'psa' }, grade: '9', scale: null, designation: null, subgrades: [], certificate: 'synthetic-private', holder: null, label: { variant: null, assetIds: [] } }
    await db.query("UPDATE public.inventory_items SET identity='{\"kind\":\"card\",\"cardId\":\"synthetic\"}',grading=$1 WHERE id='copy-a'", [grade])
    await fails(db, () => send(db, r), '0A000')
    await db.query('ROLLBACK TO SAVEPOINT raw_only')
    await db.query('UPDATE public.billing_configuration SET enforced=true,free_card_limit=2')
    const wants = structuredClone(r); wants.slots[1].after.status = 'wishlisted'; wants.planning.actorUserId = owner
    const before = await state(db)
    await fails(db, () => send(db, wants, owner), 'P0001'); assert.deepEqual(await state(db), before)
    await db.query('UPDATE public.billing_configuration SET enforced=false')
    // Exact current copy already in another collection never moves automatically.
    await db.query('SAVEPOINT elsewhere')
    const elsewhere = '00950000-0000-4000-8000-000000000012'
    await db.query("INSERT INTO public.binders(id,owner_user_id,name) VALUES($1,$2,'Synthetic other')", [elsewhere, owner])
    await db.query("INSERT INTO public.storage_collection_state(collection_id,owner_user_id,authority) VALUES($1,$2,'slots')", [elsewhere, owner])
    await db.query("INSERT INTO public.binder_slots(id,collection_id,owner_user_id,position,status) VALUES('elsewhere-slot',$1,$2,0,'collected')", [elsewhere, owner])
    await db.query("UPDATE public.binder_slots SET status=null WHERE id='slot-b'")
    await db.query("UPDATE public.inventory_placements SET collection_id=$1,slot_id='elsewhere-slot' WHERE inventory_item_id='copy-a'", [elsewhere])
    await fails(db, () => send(db, r), '40001')
    await db.query('ROLLBACK TO SAVEPOINT elsewhere')
    await send(db, r); await flush(db)
    const eventId = (await db.query('SELECT id::text FROM public.collection_activity WHERE operation_id=$1 AND owner_user_id=$2', [r.operationId, owner])).rows[0].id
    await db.query("UPDATE public.binder_slots SET version=version+2 WHERE id='slot-a'")
    await flush(db)
    const preview = await send(db, { eventId, restoreUnassignedItemIds: [], operationId: 'synthetic-aba-preview' }, partner, 'app', null, 'recovery.preview')
    assert.ok(preview.conflicts.length > 0 || !preview.supported)
    // Even identical partner IDs after unlink/relink must not borrow the prior receipt.
    await db.query('RESET ROLE'); await db.query('DELETE FROM public.partnerships WHERE owner_user_id=$1', [owner])
    await db.query('INSERT INTO public.partnerships(user1_id,user2_id,owner_user_id) VALUES($1,$2,$1)', [owner, partner])
    await fails(db, () => send(db, r), '42501')
  } finally { await db.query('ROLLBACK'); await db.end() }
})

test('095 full 256-slot raw collection reconciles atomically and retained config is rechecked', { skip: !enabled }, async () => {
  const db = await connect()
  try {
    await db.query('BEGIN'); const r = structuredClone(await seed(db))
    await db.query("UPDATE public.binders SET name='Synthetic renamed' WHERE id=$1", [collection])
    const rejected = await send(db, { ...r, operationId: 'synthetic-config-changed' }); await flush(db)
    assert.equal(rejected.code, 'raw_restore_collection_conflict')
    await db.query("UPDATE public.binders SET name='Synthetic raw' WHERE id=$1", [collection])
    for (let n = 2; n < 256; n++) {
      const id = 'synthetic-bounded-slot-' + n
      await db.query('INSERT INTO public.binder_slots(id,owner_user_id,collection_id,position) VALUES($1,$2,$3,$4)', [id, owner, collection, n])
      r.slots.push({ before: { id, version: 0, inventoryItemId: null, itemVersion: null, placementVersion: null },
        after: { id, target: { kind: 'pokemon', pokemonId: 1 }, status: null, inventoryItemId: null, wantedCards: [], presetOrigin: null } })
    }
    await flush(db)
    const receipt = await send(db, r); await flush(db)
    assert.equal(receipt.slotIds.length, 256)
    assert.equal((await state(db)).items.length, 2)
  } finally { await db.query('ROLLBACK'); await db.end() }
})

test('095 failed actual COMMIT loses provisional accepted/rejected rows, retry is not a false noncommit proof', { skip: !enabled }, async () => {
  const db = await connect()
  try {
    await db.query('BEGIN'); await seed(db); await db.query('ROLLBACK')
    // Use the fresh synthetic DB for committed seeds, never persist fixtures into the private restore.
  } finally { await db.end() }
  const fresh = await connect('holofolder_fresh_raw095')
  try {
    await fresh.query('BEGIN'); await fresh.query('DELETE FROM auth.users WHERE id=ANY($1::uuid[])', [[owner,partner]]); await flush(fresh); const r = await seed(fresh); await fresh.query('COMMIT')
    for (const accepted of [true, false]) {
      const request = { ...r, operationId: 'synthetic-failed-commit-' + accepted, inventoryRevision: accepted ? 8 : 7 }
      await fresh.query(`BEGIN; CREATE FUNCTION pg_temp.fail_terminal_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic deferred failure' USING ERRCODE='23514'; END $$;
        CREATE CONSTRAINT TRIGGER synthetic_fail_commit AFTER INSERT ON public.developer_idempotency DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_terminal_commit()`)
      const provisional = await send(fresh, request)
      assert.equal(provisional.outcome === 'rejected', !accepted)
      await assert.rejects(fresh.query('COMMIT'), (e: unknown) => !!e && typeof e === 'object' && 'code' in e && e.code === '23514')
      assert.equal((await fresh.query('SELECT count(*)::int n FROM public.developer_idempotency WHERE request_key=$1', [request.operationId])).rows[0].n, 0)
      assert.equal((await fresh.query('SELECT inventory_revision FROM public.inventory_owner_state WHERE owner_user_id=$1', [owner])).rows[0].inventory_revision, '8')
    }
  } finally { await fresh.end() }
})

async function blocked(db: Client, pid: number) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const row = (await db.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1', [pid])).rows[0]
    if (row?.wait_event_type === 'Lock') return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.fail('concurrent session never reached its lock wait')
}
test('095 concurrent delivery serializes once; edit-first rejects and unlink-first denies before replay', { skip: !enabled }, async () => {
  const a = await connect('holofolder_fresh_raw095'), b = await connect('holofolder_fresh_raw095'), observer = await connect('holofolder_fresh_raw095')
  try {
    const r = planRawContentRestore((await rawRestoreFixture()).input).request
    const pid = (await b.query('SELECT pg_backend_pid() pid')).rows[0].pid
    await a.query('BEGIN'); await b.query('BEGIN')
    const accepted = await send(a, r)
    const waiting = send(b, r); await blocked(observer, pid)
    await a.query('COMMIT'); assert.deepEqual(await waiting, accepted); await b.query('COMMIT')
    assert.equal((await observer.query('SELECT count(*)::int n FROM public.collection_activity WHERE owner_user_id=$1 AND operation_id=$2', [owner, r.operationId])).rows[0].n, 1)
    await a.query('BEGIN'); await b.query('BEGIN')
    await a.query('UPDATE public.inventory_owner_state SET inventory_revision=inventory_revision+1 WHERE owner_user_id=$1', [owner])
    const stale = send(b, { ...r, operationId: 'synthetic-edit-first', inventoryRevision: 9 }); await blocked(observer, pid)
    await a.query('COMMIT'); assert.equal((await stale).code, 'inventory_revision_conflict'); await b.query('COMMIT')
    await a.query('BEGIN'); await b.query('BEGIN')
    await a.query('DELETE FROM public.partnerships WHERE owner_user_id=$1', [owner])
    const denied = send(b, r); const denial = assert.rejects(denied, (e: unknown) => !!e && typeof e === 'object' && 'code' in e && e.code === '42501')
    await blocked(observer, pid); await a.query('COMMIT'); await denial; await b.query('ROLLBACK')
  } finally { await a.query('ROLLBACK'); await b.query('ROLLBACK'); await Promise.all([a.end(), b.end(), observer.end()]) }
})



/** SQL-backed private complete reader, with authentic RLS and 500-row pages. Synthetic data only. */
async function complete(db: Client) {
  const { readCompleteInventorySnapshot } = await import('@/lib/collection/slot-snapshot')
  await db.query('RESET ROLE')
  await db.query("SELECT set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: partner, role: 'authenticated' })])
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [partner])
  await db.query('SET LOCAL ROLE authenticated')
  const revision = Number((await db.query('SELECT inventory_revision FROM public.inventory_owner_state WHERE owner_user_id=$1', [owner])).rows[0].inventory_revision)
  const all = async (table: string, order: string) => {
    const rows: import('pg').QueryResultRow[] = []
    for (let offset = 0;; offset += 500) {
      const page = (await db.query(`SELECT * FROM public.${table} WHERE owner_user_id=$1 ORDER BY ${order} LIMIT 500 OFFSET $2`, [owner, offset])).rows
      rows.push(...page); if (page.length < 500) return rows
    }
  }
  const items = (await all('inventory_items', 'id')).map(r => ({ id: r.id, ownerUserId: owner, identity: r.identity, grading: r.grading,
    acquiredAt: r.acquired_at?.toISOString() ?? null, legacySource: r.legacy_source, version: Number(r.version) }))
  const placements = (await all('inventory_placements', 'inventory_item_id')).map(r => ({ inventoryItemId: r.inventory_item_id, collectionId: r.collection_id, slotId: r.slot_id, version: Number(r.version) }))
  const roots = await all('storage_collection_state', 'collection_id'), bs = await all('binders', 'id'), slots = await all('binder_slots', 'collection_id,position')
  const collections = roots.map(r => ({ id: r.collection_id, ownerUserId: owner, name: bs.find(b => b.id === r.collection_id)!.name, kind: r.kind,
    defaultPresentation: r.default_presentation, location: r.location, version: Number(r.version) }))
  const binders = roots.map(r => ({ ownerUserId: owner, collectionId: r.collection_id, layoutRevision: Number(r.layout_revision), presetManifest: r.preset_manifest,
    slots: slots.filter(s => s.collection_id === r.collection_id).map(s => ({ id: s.id, ownerUserId: owner, collectionId: r.collection_id, version: Number(s.version),
      target: s.target, status: s.status, wantedCards: s.wanted_cards, inventoryItemId: placements.find(p => p.slotId === s.id)?.inventoryItemId ?? null, presetOrigin: s.preset_origin })) }))
  const layouts = roots.map(r => ({ collectionId: r.collection_id, layoutRevision: Number(r.layout_revision), rows: bs.find(b => b.id === r.collection_id)!.binder_rows, cols: bs.find(b => b.id === r.collection_id)!.binder_cols }))
  const page = <T>(rows: T[]) => async (cursor?: string | null) => {
    const offset = Number(cursor ?? 0), next = offset + 500 < rows.length ? String(offset + 500) : null
    return { rows: rows.slice(offset, offset + 500), total: rows.length, inventoryRevision: revision, next }
  }
  const snapshot = await readCompleteInventorySnapshot(owner, revision, { items: page(items), placements: page(placements), collections: page(collections), binders: page(binders) })
  await db.query('RESET ROLE')
  return { snapshot, layouts }
}
function beforeRef(s: Awaited<ReturnType<typeof complete>>['snapshot'], id: string) {
  const slot = s.binders.flatMap(b => b.slots).find(v => v.id === id)!, item = s.items.find(i => i.id === slot.inventoryItemId), p = s.placements.find(p => p.slotId === id)
  return { id, version: slot.version, inventoryItemId: slot.inventoryItemId, itemVersion: item?.version ?? null, placementVersion: p?.version ?? null }
}
async function inventory(db: Client, operationId: string, commands: unknown[], collectionRefs = true, current?: Awaited<ReturnType<typeof complete>>['snapshot']) {
  const snapshot = current ?? (await complete(db)).snapshot
  return send(db, { operationId, inventoryRevision: snapshot.inventoryRevision, collections: collectionRefs ? snapshot.collections.map(c => ({ collectionId: c.id, version: c.version,
    layoutRevision: snapshot.binders.find(b => b.collectionId === c.id)!.layoutRevision })) : [], commands }, partner, 'app', null, 'inventory')
}

test('095 genuine083 1025 copied Dex, supported raw population, actual complete export, disjoint retained-ID restore and generated inverse', { skip: !enabled, timeout: 300000 }, async () => {
  const db = await connect('holofolder_fresh_raw095')
  const { speciesPreset } = await import('@/lib/binder-creation-draft')
  const { createBinderBackupV2 } = await import('@/lib/binder-backup-v2')
  const { parseRawRestoreCommand } = await import('@/lib/domain/raw-restore')
  try {
    await db.query('BEGIN')
    // Prior committed race tests use a different synthetic owner. Isolate this fixture by rolling it back.
    await db.query('DELETE FROM auth.users WHERE id=ANY($1::uuid[])', [[owner, partner]]); await flush(db)
    await db.query('INSERT INTO auth.users(id) VALUES($1),($2)', [owner, partner])
    await db.query('UPDATE public.billing_configuration SET enforced=false')
    await db.query("INSERT INTO public.partnerships(id,user1_id,user2_id,owner_user_id) VALUES('00940000-0000-4000-8000-000000000003',$1,$2,$1)", [owner, partner])
    await db.query('INSERT INTO public.inventory_owner_state(owner_user_id,inventory_revision) VALUES($1,0)', [owner])
    const manifest = speciesPreset('National Dex', Array.from({ length: 1025 }, (_, n) => n + 1), 'national-dex')
    const slotIds = manifest.entries.map((_, n) => 'synthetic-dex-' + n)
    await send(db, { version: 1, operationId: 'synthetic-095-dex-create', inventoryRevision: 0, collectionId: collection, name: 'Synthetic Dex', kind: 'binder', defaultPresentation: 'binder', location: null,
      grid: { rows: 3, cols: 3 }, manifest, slotIds }, partner, 'app', null, 'collection.create'); await flush(db)
    await db.query("INSERT INTO public.tcg_series(id,name_json) VALUES('synthetic-dex-series','{}') ON CONFLICT DO NOTHING; INSERT INTO public.tcg_sets(id,series_id,name_json) VALUES('synthetic-dex-set','synthetic-dex-series','{}') ON CONFLICT DO NOTHING; INSERT INTO public.tcg_cards(id,series_id,set_id,local_id,name_json) VALUES('synthetic-dex-trainer','synthetic-dex-series','synthetic-dex-set','1','{}'),('synthetic-dex-energy','synthetic-dex-series','synthetic-dex-set','2','{}') ON CONFLICT DO NOTHING")
    // Copied Dex origins survive edited targets. Duplicate non-Pokémon printings stay physical IDs.
    const empty = await complete(db)
    await send(db, { operationId: 'synthetic-dex-edit-nonpokemon-targets', collectionId: collection, inventoryRevision: empty.snapshot.inventoryRevision,
      collectionVersion: empty.snapshot.collections[0].version, layoutRevision: empty.snapshot.binders[0].layoutRevision,
      commands: slotIds.slice(1021).map(id => ({ kind: 'update', slot: beforeRef(empty.snapshot,id), target: null })) }, partner,'app',null,'slots'); await flush(db)
    for (const group of ['a', 'b']) {
      for (let start = 0; start < 1025; start += 100) {
        const ids = slotIds.slice(start, start + 100)
        await inventory(db, `synthetic-add-${group}-${start}`, ids.map((_, n) => ({ kind: 'add', itemId: `synthetic-${group}-${start+n}`, identity: start+n < 1021 ? { kind: 'pokemon', pokemonId: start+n+1 } : { kind: 'card', cardId: (start+n)%2 ? 'synthetic-dex-trainer' : 'synthetic-dex-energy' }, grading: null, acquiredAt: '2020-01-02T00:00:00Z' })), false); await flush(db)
      }
    }
    const assign = async (group: string) => {
      for (let start = 0; start < 1025; start += 4) {
        const { snapshot } = await complete(db)
        await inventory(db, `synthetic-assign-${group}-${start}`, slotIds.slice(start, start+4).map((id, n) => ({ kind: 'assign',
          selection: { kind: 'existing', inventoryItemId: `synthetic-${group}-${start+n}`, itemVersion: 0 }, destination: { collectionId: collection, slot: beforeRef(snapshot, id) }, occupied: 'unassign', fulfillWant: null })), true, snapshot); await flush(db)
      }
    }
    await assign('a')
    for (let start = 0; start < 1025; start += 100) {
      const { snapshot } = await complete(db), c = snapshot.collections[0], b = snapshot.binders[0]
      await send(db, { operationId: `synthetic-wants-${start}`, collectionId: collection, inventoryRevision: snapshot.inventoryRevision, collectionVersion: c.version, layoutRevision: b.layoutRevision,
        commands: slotIds.slice(start, start+100).map(id => ({ kind: 'update', slot: beforeRef(snapshot, id), wantedCards: [{ card_id: 'synthetic-dex-trainer', card_name: 'Synthetic trainer', added_at: '2020-01-01', wanted_by: [owner,partner] }] })) }, partner,'app',null,'slots'); await flush(db)
    }
    const source = await complete(db)
    const backup = createBinderBackupV2({ snapshot: source.snapshot, completeness: 'complete-owner', scope: 'collection', collectionId: collection, layouts: source.layouts, partnerUserId: partner })
    for (const cardId of ['synthetic-dex-trainer','synthetic-dex-energy']) assert.equal(backup.items.filter(i=>i.identity.kind==='card' && i.identity.cardId===cardId).length,2)
    const text = JSON.stringify(backup)
    await assign('b')
    const current = await complete(db), original = (await db.query('SELECT * FROM public.inventory_items WHERE owner_user_id=$1 ORDER BY id',[owner])).rows, f = await rawRestoreFixture()
    const request = planRawContentRestore({ ...f.input, text, current: current.snapshot, layouts: current.layouts, savedEntryRemaining: 8192,
      operationId: 'synthetic-dex-restore-v2', choices: { collectionId: collection, slotIds, releaseItemIds: slotIds.map((_,n) => `synthetic-b-${n}`).sort(), restoreContent: true } }).request
    assert.equal(request.slots.length,1025); assert.equal(request.items.length,2050)
    assert.equal(request.slots.reduce((n,s)=>n+s.after.wantedCards.length,0),1025)
    await db.query('COMMIT'); await db.query("BEGIN; SET LOCAL statement_timeout='10s'")
    const t = performance.now(); const receipt = await send(db,request); const applyMs = performance.now()-t
    const f0 = performance.now(); await flush(db); const deferredMs = performance.now()-f0
    const c0=performance.now(); await db.query('COMMIT'); const commitMs=performance.now()-c0; await db.query('BEGIN')
    const restored = await complete(db), itemsAfter = (await db.query('SELECT * FROM public.inventory_items WHERE owner_user_id=$1 ORDER BY id',[owner])).rows
    assert.deepEqual(itemsAfter,original,'every physical private DB field remains exact')
    assert.deepEqual(restored.snapshot.binders[0].slots.map(s=>[s.id,s.target,s.status,s.wantedCards,s.presetOrigin,s.inventoryItemId]),source.snapshot.binders[0].slots.map(s=>[s.id,s.target,s.status,s.wantedCards,s.presetOrigin,s.inventoryItemId]))
    assert.deepEqual(restored.snapshot.binders[0].presetManifest,manifest)
    assert.equal(restored.snapshot.placements.length,1025); assert.equal(restored.snapshot.items.length,2050)
    const event = (await db.query('SELECT * FROM public.collection_activity WHERE owner_user_id=$1 AND operation_id=$2',[owner,request.operationId])).rows[0]
    assert.equal(event.recovery_state.length,3077); assert.equal(event.actor_user_id,partner); assert.equal(event.source,'app'); assert.equal(event.batch_id,request.operationId)
    const r0 = performance.now(); const preview = await send(db,{operationId:'synthetic-dex-inverse-preview',eventId:String(event.id),restoreUnassignedItemIds:[]},partner,'app',null,'recovery.preview')
    assert.equal(preview.supported,true); assert.deepEqual(preview.conflicts,[])
    const previewMs=performance.now()-r0, r1=performance.now()
    await send(db,{operationId:'synthetic-dex-inverse',eventId:String(event.id),restoreUnassignedItemIds:[],confirmed:true,planVersion:1,planToken:preview.planToken},partner,'app',null,'recovery.apply');await flush(db)
    await db.query('COMMIT'); const inverseMs=performance.now()-r1; await db.query('BEGIN')
    const recovered=await complete(db)
    assert.deepEqual(recovered.snapshot.placements.map(p=>[p.inventoryItemId,p.slotId]),current.snapshot.placements.map(p=>[p.inventoryItemId,p.slotId]))
    assert.deepEqual(await send(db,request),receipt,'lifetime replay after inverse precedes reconstruction')
    const bad={...request,version:3};assert.throws(()=>parseRawRestoreCommand(bad));await fails(db,()=>send(db,bad),'22023')
    console.log(JSON.stringify({synthetic:true,slots:1025,refs:2050,wants:1025,commandBytes:Buffer.byteLength(JSON.stringify(request)),auditEntities:event.recovery_state.length,auditBytes:Buffer.byteLength(JSON.stringify(event.recovery_state)),applyMs,deferredMs,previewMs,inverseMs,commitMs}))
  } finally { await db.query('ROLLBACK');await db.end() }
})

test('095 v1 exact unversioned replay remains compatible and cross-version keys include committed v1 rejections', {skip:!enabled},async()=>{
  const db=await connect()
  try{
    await db.query('BEGIN');const r=await seed(db)
    const {manifest:_manifest,...base}=r as Extract<RawRestoreCommand,{version:2}>
    const v1={...base,version:1 as const}
    const accepted=await send(db,v1);await flush(db);assert.equal(accepted.version,undefined)
    assert.deepEqual(await send(db,v1),accepted)
    await fails(db,()=>send(db,r),'40001')
    const oldRejected={...v1,operationId:'synthetic-v1-terminal-collision'}
    const rejection=await send(db,oldRejected);assert.equal(rejection.outcome,'rejected');assert.equal(rejection.version,undefined)
    await fails(db,()=>send(db,{...r,operationId:oldRejected.operationId}),'40001')
    const newRejected={...r,operationId:'synthetic-v2-terminal-collision'}
    const terminal=await send(db,newRejected);assert.equal(terminal.version,2);assert.equal(terminal.outcome,'rejected')
    await fails(db,()=>send(db,{...v1,operationId:newRejected.operationId}),'40001')
    await db.query('DELETE FROM public.binders WHERE id=$1',[collection]);await flush(db)
    assert.deepEqual(await send(db,oldRejected),rejection);assert.deepEqual(await send(db,newRejected),terminal)
  }finally{await db.query('ROLLBACK');await db.end()}
})

test('095 small copied non-Dex, edited target and appended null origin restore without provenance rewrites', {skip:!enabled},async()=>{
  const db=await connect()
  const {speciesPreset}=await import('@/lib/binder-creation-draft')
  const {createBinderBackupV2}=await import('@/lib/binder-backup-v2')
  try{
    await db.query('BEGIN')
    await db.query('INSERT INTO auth.users(id) VALUES($1),($2)',[owner,partner]);await db.query('UPDATE public.billing_configuration SET enforced=false')
    await db.query("INSERT INTO public.partnerships(id,user1_id,user2_id,owner_user_id) VALUES('00940000-0000-4000-8000-000000000003',$1,$2,$1)",[owner,partner])
    await db.query('INSERT INTO public.inventory_owner_state(owner_user_id,inventory_revision) VALUES($1,0)',[owner])
    const manifest=speciesPreset('Synthetic favourites',[143,25])
    await send(db,{version:1,operationId:'synthetic-small-create',inventoryRevision:0,collectionId:collection,name:'Synthetic favourites',kind:'binder',defaultPresentation:'binder',location:null,grid:{rows:3,cols:3},manifest,slotIds:['small-a','small-b']},partner,'app',null,'collection.create');await flush(db)
    const edit=async(op:string,commands:unknown[])=>{
      const {snapshot}=await complete(db)
      return send(db,{operationId:op,collectionId:collection,inventoryRevision:snapshot.inventoryRevision,collectionVersion:snapshot.collections[0].version,layoutRevision:snapshot.binders[0].layoutRevision,commands},partner,'app',null,'slots')
    }
    await edit('synthetic-append-null',[{kind:'create',ids:['small-append'],beforeSlotId:null}]);await flush(db)
    let c=await complete(db)
    await edit('synthetic-edit-copied',[{kind:'update',slot:beforeRef(c.snapshot,'small-a'),target:null}]);await flush(db)
    const source=await complete(db)
    const backup=createBinderBackupV2({snapshot:source.snapshot,completeness:'complete-owner',scope:'collection',collectionId:collection,layouts:source.layouts,partnerUserId:partner})
    c=await complete(db)
    await edit('synthetic-change-copied',[{kind:'update',slot:beforeRef(c.snapshot,'small-a'),target:{kind:'pokemon',pokemonId:1}}]);await flush(db)
    c=await complete(db)
    const f=await rawRestoreFixture(),r=planRawContentRestore({...f.input,text:JSON.stringify(backup),current:c.snapshot,layouts:c.layouts,choices:{collectionId:collection,slotIds:['small-a','small-b','small-append'],releaseItemIds:[],restoreContent:true}}).request
    const swapped=structuredClone(r);swapped.slots[0].after.presetOrigin=swapped.slots[1].after.presetOrigin
    const rejected=await send(db,{...swapped,operationId:'synthetic-origin-swap'});assert.equal(rejected.code,'raw_restore_content_conflict')
    await send(db,r);await flush(db)
    const after=await complete(db)
    assert.deepEqual(after.snapshot.binders[0].slots.map(s=>[s.id,s.target,s.presetOrigin]),source.snapshot.binders[0].slots.map(s=>[s.id,s.target,s.presetOrigin]))
    assert.equal(after.snapshot.binders[0].slots[2].presetOrigin,null)
  }finally{await db.query('ROLLBACK');await db.end()}
})

test('095 exact work8192, per-slot100 and slot1025 edges apply with complete audit and inverse', {skip:!enabled,timeout:30000},async()=>{
  const db=await connect()
  try{
    await db.query("BEGIN; SET LOCAL statement_timeout='10s'");const r=structuredClone(await seed(db))
    for(let n=2;n<1025;n++){
      const id='synthetic-edge-'+n
      await db.query('INSERT INTO public.binder_slots(id,owner_user_id,collection_id,position) VALUES($1,$2,$3,$4)',[id,owner,collection,n])
      r.slots.push({before:{id,version:0,inventoryItemId:null,itemVersion:null,placementVersion:null},after:{id,target:null,status:null,wantedCards:[],inventoryItemId:null,presetOrigin:null}})
    }
    await flush(db)
    await db.query('UPDATE public.billing_configuration SET enforced=true,free_card_limit=10'); await db.query("INSERT INTO public.perpetual_licences(owner_user_id,source) VALUES($1,'manual')",[owner])
    let remaining=8192-2*1025-r.items.length
    for(const pair of r.slots){const n=Math.min(remaining,100);remaining-=n;pair.after.wantedCards=Array.from({length:n},()=>({card_id:'synthetic-raw-trainer',card_name:'Synthetic work edge',added_at:'2020-01-01',wanted_by:[partner]}))}
    assert.equal(remaining,0)
    const over=structuredClone(r);over.slots.at(-1)!.after.wantedCards.push({card_id:'synthetic-raw-trainer',card_name:'One extra',added_at:'2020-01-01'})
    const initial=await state(db)
    await fails(db,()=>send(db,over),'22023');assert.deepEqual(await state(db),initial)
    const t=performance.now();await send(db,r);await flush(db);const applyDeferredMs=performance.now()-t
    const event=(await db.query('SELECT id,recovery_state FROM public.collection_activity WHERE owner_user_id=$1 AND operation_id=$2',[owner,r.operationId])).rows[0]
    const p0=performance.now(),preview=await send(db,{eventId:String(event.id),operationId:'synthetic-work-preview',restoreUnassignedItemIds:[]},partner,'app',null,'recovery.preview')
    assert.equal(preview.supported,true);const previewMs=performance.now()-p0,p1=performance.now()
    await send(db,{eventId:String(event.id),operationId:'synthetic-work-inverse',restoreUnassignedItemIds:[],confirmed:true,planVersion:1,planToken:preview.planToken},partner,'app',null,'recovery.apply');await flush(db)
    console.log(JSON.stringify({synthetic:true,edge:'work8192',applyDeferredMs,previewMs,inverseMs:performance.now()-p1,entities:event.recovery_state.length,commit:'rollback fixture'}))
  }finally{await db.query('ROLLBACK');await db.end()}
})

test('095 multibyte JSONB byte edge and prospective old-wants inverse bound refuse without mutation', {skip:!enabled,timeout:60000},async()=>{
  const db=await connect()
  const {rawRestoreV2JsonbBytes,parseRawRestoreCommand,RAW_RESTORE_V2_LIMITS}=await import('@/lib/domain/raw-restore')
  try{
    await db.query("BEGIN; SET LOCAL statement_timeout='10s'");const r=structuredClone(await seed(db))
    r.slots[1].after.wantedCards=[{card_id:'synthetic-raw-trainer',card_name:'',added_at:'2020-01-01'}]
    const padding=RAW_RESTORE_V2_LIMITS.bytes-rawRestoreV2JsonbBytes(r)
    r.slots[1].after.wantedCards[0].card_name='猫'.repeat(Math.floor(padding/3))+'a'.repeat(padding%3)
    assert.equal(rawRestoreV2JsonbBytes(r),RAW_RESTORE_V2_LIMITS.bytes)
    assert.equal((await db.query('SELECT octet_length($1::jsonb::text)::int n',[JSON.stringify(r)])).rows[0].n,RAW_RESTORE_V2_LIMITS.bytes)
    assert.deepEqual(parseRawRestoreCommand(r),r)
    const over=structuredClone(r);over.slots[1].after.wantedCards[0].card_name+='a'
    assert.throws(()=>parseRawRestoreCommand(over));await fails(db,()=>send(db,over),'22023')
    await db.query('SAVEPOINT byte_edge');const t=performance.now();await send(db,r);await flush(db)
    console.log(JSON.stringify({synthetic:true,edge:'jsonb1.75MiB-multibyte',applyDeferredMs:performance.now()-t}))
    await db.query('ROLLBACK TO SAVEPOINT byte_edge; RESET ROLE')
    // Each historical update is separately within 076. Their combined prospective inverse is not.
    const want=[{card_id:'synthetic-raw-trainer',card_name:'x'.repeat(8500000),added_at:'2020-01-01'}]
    for(const id of ['slot-a','slot-b']){await db.query('UPDATE public.binder_slots SET wanted_cards=$1 WHERE id=$2',[JSON.stringify(want),id]);await flush(db)}
    const small=structuredClone(await seedRequestOnly())
    const digest=async()=> (await db.query(`SELECT md5((SELECT jsonb_agg(s ORDER BY id)::text FROM public.binder_slots s WHERE owner_user_id=$1)) hash,(SELECT count(*)::int FROM public.collection_activity WHERE owner_user_id=$1) events,(SELECT count(*)::int FROM public.developer_idempotency WHERE actor_id=$2) ledger`,[owner,partner])).rows[0]
    const before=await digest();await fails(db,()=>send(db,small),'22023');assert.deepEqual(await digest(),before)
  }finally{await db.query('ROLLBACK');await db.end()}
})
async function seedRequestOnly(){return planRawContentRestore((await rawRestoreFixture()).input).request}

async function stateDigest(db: Client) {
  await db.query('RESET ROLE')
  const result: Record<string, unknown> = {}
  for (const table of ['inventory_items','binder_slots','inventory_placements','inventory_owner_state','storage_collection_state','collection_activity','developer_idempotency']) {
    const where=table==='developer_idempotency'?'actor_id IN ($1,$2)':'owner_user_id=$1'
    result[table]=(await db.query(`SELECT count(*)::int n,md5(coalesce(string_agg(hash,'' ORDER BY hash),'')) digest FROM (SELECT md5(to_jsonb(t)::text) hash FROM public.${table} t WHERE ${where}) rows`,table==='developer_idempotency'?[owner,partner]:[owner])).rows[0]
  }
  return result
}

// Independent byte model over actual private rows, checked against the real recorder below.
async function prospectiveBytes(db: Client, r: RawRestoreCommand) {
  await db.query('RESET ROLE')
  const rows = async (table: string) => (await db.query(`SELECT collection_audit_private.state('${table}',to_jsonb(t)) s FROM public.${table} t WHERE owner_user_id=$1`,[owner])).rows.map(v=>v.s)
  const slots=await rows('binder_slots'), placements=await rows('inventory_placements'), roots=await rows('storage_collection_state'), owners=await rows('inventory_owner_state')
  const graph=r.slots.map(p=>{const before=slots.find(s=>s.id===p.before.id);return {table:'binder_slots',id:before.id,before,after:{...before,target:p.after.target,status:p.after.status,wanted_cards:p.after.wantedCards,version:before.version+1}}})
  for(const ref of r.items){const before=placements.find(p=>p.inventory_item_id===ref.itemId)??null,slot=r.slots.find(p=>p.after.inventoryItemId===ref.itemId)
    graph.push({table:'inventory_placements',id:ref.itemId,before,after:slot?{inventory_item_id:ref.itemId,owner_user_id:owner,collection_id:collection,slot_id:slot.after.id,version:before?before.version+1:0}:null})}
  const root=roots.find(v=>v.collection_id===collection),o=owners[0]
  graph.push({table:'storage_collection_state',id:collection,before:root,after:{...root,version:root.version+1}},
    {table:'inventory_owner_state',id:owner,before:o,after:{...o,inventory_revision:o.inventory_revision+1}})
  const {rawRestoreV2JsonbBytes}=await import('@/lib/domain/raw-restore')
  return rawRestoreV2JsonbBytes(graph)
}

// Run after genuine083 in this same suite. Every seed and COMMIT is disposable synthetic data.
test('095 populated-history maximum combined command, before/after wants and duplicated-manifest graphs commit and recover', {skip:!enabled,timeout:180000},async()=>{
  const db=await connect('holofolder_fresh_raw095'),runId=crypto.randomUUID()
  const {createBinderBackupV2}=await import('@/lib/binder-backup-v2')
  const {rawRestoreV2JsonbBytes,parseRawRestoreCommand,RAW_RESTORE_V2_LIMITS:limits}=await import('@/lib/domain/raw-restore')
  const {rawRestoreV2GraphBytes}=await import('@/lib/raw-restore-envelope')
  try{
    await db.query("BEGIN; SET LOCAL statement_timeout='10s'")
    for(const edge of ['work8192','command1.75MiB-graph2.5MiB','before-wants2.5MiB','duplicated-manifest2.5MiB','sparse-before-wants2.5MiB'] as const){
      await db.query('RESET ROLE')
      // Reset only synthetic byte padding between independent cases, preserving populated history.
      await db.query("UPDATE public.binder_slots SET wanted_cards=$1,version=version+1 WHERE collection_id=$2",[JSON.stringify([{card_id:'synthetic-dex-trainer',card_name:'Synthetic trainer',added_at:'2020-01-01',wanted_by:[owner,partner]}]),collection])
      await db.query("UPDATE public.storage_collection_state SET preset_manifest=jsonb_set(preset_manifest,'{name}','\"National Dex\"'),version=version+1 WHERE collection_id=$1",[collection]);await flush(db)
      if(edge==='command1.75MiB-graph2.5MiB'){
        await db.query("UPDATE public.binder_slots SET wanted_cards='[]',version=version+1 WHERE collection_id=$1 AND id<>'synthetic-dex-1000'",[collection]);await flush(db)
      }
      let current=await complete(db)
      const desired=structuredClone(current.snapshot),f=await rawRestoreFixture()
      assert.equal(current.snapshot.binders[0].slots.length,1025)
      const desiredCount=edge==='sparse-before-wants2.5MiB'?0:4092
      const desiredGroup=current.snapshot.placements[0].inventoryItemId.startsWith('synthetic-a-')?'b':'a'
      let remaining=desiredCount
      for(const [n,slot] of desired.binders[0].slots.entries()){
        slot.inventoryItemId='synthetic-'+desiredGroup+'-'+n
        const count=Math.min(remaining,100);remaining-=count
        slot.wantedCards=Array.from({length:count},()=>({card_id:'synthetic-dex-trainer',card_name:'Synthetic edge want',added_at:'2020-01-01',wanted_by:[owner,partner]}))
      }
      desired.placements=desired.binders[0].slots.map(s=>({inventoryItemId:s.inventoryItemId!,collectionId:collection,slotId:s.id,version:0}))
      const backup=createBinderBackupV2({snapshot:desired,completeness:'complete-owner',scope:'collection',collectionId:collection,layouts:current.layouts,partnerUserId:partner})
      const request=structuredClone(planRawContentRestore({...f.input,text:JSON.stringify(backup),current:current.snapshot,layouts:current.layouts,savedEntryRemaining:8192,
        operationId:'synthetic-populated-'+edge+'-'+runId,choices:{collectionId:collection,slotIds:current.snapshot.binders[0].slots.map(s=>s.id),releaseItemIds:current.snapshot.placements.map(p=>p.inventoryItemId).sort(),restoreContent:true}}).request)
      const refresh=async()=>{
        current=await complete(db);request.inventoryRevision=current.snapshot.inventoryRevision;request.collection.version=current.snapshot.collections[0].version
        for(const p of request.slots)p.before=beforeRef(current.snapshot,p.before.id)
        for(const ref of request.items)if(ref.placement)ref.placement.slot=beforeRef(current.snapshot,ref.placement.slot.id)
      }
      const pad=(bytes:number)=>'猫'.repeat(Math.floor(bytes/3))+'a'.repeat(bytes%3)
      if(edge==='duplicated-manifest2.5MiB' && request.version===2){
        const extra=Math.floor((limits.graphBytes-await prospectiveBytes(db,request))/2)
        request.manifest!.name+=pad(extra)
        await db.query('UPDATE public.storage_collection_state SET preset_manifest=$1,version=version+1 WHERE collection_id=$2',[JSON.stringify(request.manifest),collection]);await flush(db);await refresh()
      }
      if(edge!=='work8192'){
        // Both JSON strings and the exact complete graph saturate the cap, including old wants.
        for(let attempt=0;attempt<4;attempt++){
          if(edge==='command1.75MiB-graph2.5MiB'){
            const want=request.slots[0].after.wantedCards[0]
            want.card_name='';want.card_name=pad(limits.bytes-rawRestoreV2JsonbBytes(request))
          }
          const delta=limits.graphBytes-await prospectiveBytes(db,request)
          if(delta===0)break
          const slot=current.snapshot.binders[0].slots[1000],wants=structuredClone(slot.wantedCards)
          const name=wants[0].card_name
          wants[0].card_name=delta>=0?name+'a'.repeat(delta):name.slice(0,name.length+delta)
          await db.query('UPDATE public.binder_slots SET wanted_cards=$1,version=version+1 WHERE id=$2',[JSON.stringify(wants),slot.id]);await flush(db);await refresh()
        }
        assert.equal(await prospectiveBytes(db,request),limits.graphBytes)
      }
      assert.equal(request.items.length,2050);assert.equal(2*request.slots.length+request.items.length+desiredCount,4100+desiredCount)
      parseRawRestoreCommand(request)
      if(edge==='command1.75MiB-graph2.5MiB')assert.equal(rawRestoreV2JsonbBytes(request),limits.bytes)
      const expectedBytes=await prospectiveBytes(db,request)
      assert.ok(rawRestoreV2GraphBytes(current.snapshot,{...desired.binders[0],slots:desired.binders[0].slots.map((s,n)=>({...s,wantedCards:request.slots[n].after.wantedCards}))})>=expectedBytes)
      const historyBefore=Number((await db.query('SELECT count(*)::int n FROM public.collection_activity WHERE owner_user_id=$1',[owner])).rows[0].n)
      assert.ok(historyBefore>500)
      // Above-limit current state must refuse before writes, without even a terminal ledger row.
      if(edge!=='work8192'){
        await db.query('SAVEPOINT oversized_before')
        await db.query("UPDATE public.binder_slots SET wanted_cards=jsonb_set(wanted_cards,'{0,card_name}',to_jsonb((wanted_cards->0->>'card_name')||'a')) WHERE id=$1",[current.snapshot.binders[0].slots[1000].id]);await flush(db)
        const before=await stateDigest(db);await fails(db,()=>send(db,request),'22023');assert.deepEqual(await stateDigest(db),before)
        await db.query('ROLLBACK TO SAVEPOINT oversized_before; RESET ROLE')
      }
      if(edge==='work8192'){
        const old=structuredClone(request),want=old.slots[0].after.wantedCards[0];want.card_name='';want.card_name=pad(4194304-rawRestoreV2JsonbBytes(old))
        assert.equal(rawRestoreV2JsonbBytes(old),4194304);assert.throws(()=>parseRawRestoreCommand(old))
        const before=await stateDigest(db);await fails(db,()=>send(db,old),'22023');assert.deepEqual(await stateDigest(db),before)
      }
      // Commit padding/history first so the measured command starts in its own real transaction.
      await db.query('COMMIT');await db.query("BEGIN; SET LOCAL statement_timeout='10s'")
      const t=performance.now(),receipt=await send(db,request),applyMs=performance.now()-t,d0=performance.now();await flush(db);const deferredMs=performance.now()-d0
      const c0=performance.now();await db.query('COMMIT');const commitMs=performance.now()-c0;await db.query("BEGIN; SET LOCAL statement_timeout='10s'")
      const event=(await db.query('SELECT id,jsonb_array_length(recovery_state) entities,octet_length(recovery_state::text) bytes FROM public.collection_activity WHERE owner_user_id=$1 AND operation_id=$2',[owner,request.operationId])).rows[0]
      assert.equal(event.bytes,expectedBytes);assert.equal(event.entities,3077)
      const p0=performance.now(),preview=await send(db,{eventId:String(event.id),operationId:'synthetic-preview-'+edge+'-'+runId,restoreUnassignedItemIds:[]},partner,'app',null,'recovery.preview'),previewMs=performance.now()-p0
      assert.equal(preview.supported,true);assert.deepEqual(preview.conflicts,[])
      console.log(JSON.stringify({synthetic:true,phase:'committed-forward-and-preview',edge,historyBefore,applyMs,deferredMs,commitMs,previewMs,auditJsonbBytes:event.bytes}))
      const i0=performance.now()
      await send(db,{eventId:String(event.id),operationId:'synthetic-inverse-'+edge+'-'+runId,restoreUnassignedItemIds:[],confirmed:true,planVersion:1,planToken:preview.planToken},partner,'app',null,'recovery.apply');await flush(db);await db.query('COMMIT')
      const inverseCommitMs=performance.now()-i0;await db.query("BEGIN; SET LOCAL statement_timeout='10s'")
      const recovered=await complete(db)
      assert.deepEqual(recovered.snapshot.placements.map(p=>[p.inventoryItemId,p.slotId]),current.snapshot.placements.map(p=>[p.inventoryItemId,p.slotId]))
      assert.deepEqual(recovered.snapshot.items,current.snapshot.items)
      assert.deepEqual(recovered.snapshot.binders[0].slots.map(s=>[s.id,s.target,s.status,s.wantedCards,s.presetOrigin]),current.snapshot.binders[0].slots.map(s=>[s.id,s.target,s.status,s.wantedCards,s.presetOrigin]))
      assert.deepEqual(recovered.snapshot.binders[0].presetManifest,current.snapshot.binders[0].presetManifest)
      assert.deepEqual(await send(db,request),receipt)
      console.log(JSON.stringify({synthetic:true,edge,slots:1025,refs:2050,wants:desiredCount,historyBefore,commandWireBytes:Buffer.byteLength(JSON.stringify(request)),commandJsonbBytes:rawRestoreV2JsonbBytes(request),auditEntities:event.entities,auditJsonbBytes:event.bytes,applyMs,deferredMs,commitMs,previewMs,inverseCommitMs}))
    }
  }finally{await db.query('ROLLBACK');await db.end()}
})

test('095 canonical empty Blank remains compatible with v1 and v2 without manifest or origin writes', {skip:!enabled},async()=>{
  const db=await connect()
  const {blankPreset}=await import('@/lib/binder-creation-draft')
  try{
    for(const version of [1,2] as const){
      await db.query('BEGIN');const original=await seed(db)
      await db.query('UPDATE public.storage_collection_state SET preset_manifest=$1 WHERE collection_id=$2',[blankPreset(),collection]);await flush(db)
      const {manifest:_manifest,...body}=original as Extract<RawRestoreCommand,{version:2}>
      const request=version===1?{...body,version}:{...body,version,manifest:blankPreset()}
      const result=await send(db,request);await flush(db)
      assert.equal(result.version,version===2?2:undefined)
      const after=await complete(db)
      assert.deepEqual(after.snapshot.binders[0].presetManifest,blankPreset())
      assert.ok(after.snapshot.binders[0].slots.every(s=>s.presetOrigin===null))
      await db.query('ROLLBACK')
    }
  }finally{await db.query('ROLLBACK');await db.end()}
})
