import { blankPreset } from '@/lib/binder-creation-draft'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Client } from 'pg'
import { rawRestoreFixture, rawOwner as owner, rawPartner as partner, rawCollection as collection } from './fixtures/raw-restore'
import { planRawContentRestore } from '@/lib/raw-restore-plan'
import { normalizeStorageResult } from '@/lib/server/operations/storage-contract'
import type { RawRestoreCommand } from '@/lib/domain/raw-restore'

const enabled = process.env.RAW_RESTORE_TEST_SOCKET
const config = { host: '/Users/cal/.local/share/holofolder/raw-restore-094-local/s', port: 55594, user: 'restore094', database: 'preserve094' }
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
  await db.query("INSERT INTO public.tcg_series(id,name_json) VALUES('synthetic-raw-series','{}'); INSERT INTO public.tcg_sets(id,series_id,name_json) VALUES('synthetic-raw-set','synthetic-raw-series','{}'); INSERT INTO public.tcg_cards(id,series_id,set_id,local_id,name_json) VALUES('synthetic-raw-trainer','synthetic-raw-series','synthetic-raw-set','1','{}')")
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

test('094 twice preserves source rows, table/column ACLs, RLS and unrelated compiled functions', { skip: !enabled }, async () => {
  const db = await connect()
  try {
    const access = async () => (await db.query(`SELECT c.oid::regclass::text name,relowner,relacl::text,relrowsecurity,relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','collection_audit_private','auth','storage') ORDER BY 1`)).rows
    const columns = async () => (await db.query(`SELECT attrelid,attnum,attacl::text FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','collection_audit_private','auth','storage') AND attnum>0 ORDER BY 1,2`)).rows
    const policies = async () => (await db.query('SELECT * FROM pg_policies ORDER BY schemaname,tablename,policyname')).rows
    const functions = async () => (await db.query("SELECT p.oid::regprocedure::text name,md5(pg_get_functiondef(p.oid)) digest,proowner,proacl::text,proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','collection_audit_private') ORDER BY 1")).rows
    const baseline = await connect('preserve094baseline')
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
    const sql = readFileSync(new URL('../scripts/094_raw_content_restore.sql', import.meta.url), 'utf8')
    await db.query(sql); const once = await functions(); await db.query(sql)
    assert.deepEqual(await functions(), once); assert.deepEqual(await access(), acl); assert.deepEqual(await columns(), cols); assert.deepEqual(await policies(), policy)
    assert.deepEqual(once, original, 'installed094 remains identical on repeated application')
    for (const role of ['anon', 'authenticated', 'holo_mcp', 'service_role']) assert.equal((await db.query("SELECT has_function_privilege($1,'collection_audit_private.restore_raw_content_v1(uuid,uuid,jsonb,jsonb)','EXECUTE') ok", [role])).rows[0].ok, false)
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

test('094 real transaction preserves physical IDs, terminal replay, actor scope, raw graph and safe inverse', { skip: !enabled }, async () => {
  const db = await connect()
  try {
    await db.query('BEGIN'); const request = structuredClone(await seed(db)), before = await state(db)
    request.slots[1].after.wantedCards = [{ card_id: 'synthetic-raw-trainer', card_name: 'Synthetic Trainer', added_at: '2020-01-01', wanted_by: [partner] }]
    const receipt = await send(db, request); await flush(db)
    assert.equal(receipt.changed, true, JSON.stringify(receipt))
    normalizeStorageResult('backup.restore.raw', receipt)
    assert.deepEqual(receipt, { inventoryRevision: 9, collectionId: collection, collectionVersion: 3, layoutRevision: 3, changed: true, slotIds: ['slot-a', 'slot-b'], releasedItemIds: ['copy-b'] })
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

test('094 rejects malformed/partial/over-budget/moved/graded intent, ordinary conflicts stay unknown; cancellation/allowance/audit rollback', { skip: !enabled }, async () => {
  const db = await connect()
  try {
    await db.query('BEGIN'); const r = await seed(db), original = await state(db)
    for (const patch of [{ ownerUserId: owner }, { releaseItemIds: [] }, { items: [...r.items, r.items[0]] },
      { slots: Array.from({ length: 257 }, () => r.slots[0]) }, { items: Array.from({ length: 513 }, () => r.items[0]) },
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
    await db.query('SAVEPOINT audit'); await send(db, r)
    await assert.rejects(flush(db)); await db.query('ROLLBACK TO SAVEPOINT audit; RESET ROLE')
    assert.equal((await db.query('SELECT count(*)::int n FROM public.developer_idempotency WHERE request_key=$1', [r.operationId])).rows[0].n, 0)
  } finally { await db.query('ROLLBACK'); await db.end() }
})

test('094 raw scope, saved allowance, ownership RLS and later ABA recovery conflicts', { skip: !enabled }, async () => {
  const db = await connect()
  try {
    await db.query('BEGIN'); const r = await seed(db)
    for (const role of ['anon', 'authenticated', 'holo_mcp']) {
      await fails(db, async () => { await db.query('SET LOCAL ROLE ' + role); await db.query('SELECT public.storage_execute_v1($1,$2,$3)', ['backup.restore.raw', owner, r]) }, '42501')
    }
    for (const [actor, count] of [[owner, 2], [partner, 2], ['00940000-0000-4000-8000-000000000099', 0]] as const) {
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
    const elsewhere = '00940000-0000-4000-8000-000000000012'
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

test('094 full 256-slot raw collection reconciles atomically and retained config is rechecked', { skip: !enabled }, async () => {
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

test('094 failed actual COMMIT loses provisional accepted/rejected rows, retry is not a false noncommit proof', { skip: !enabled }, async () => {
  const db = await connect()
  try {
    await db.query('BEGIN'); await seed(db); await db.query('ROLLBACK')
    // Use the fresh synthetic DB for committed seeds, never persist fixtures into the private restore.
  } finally { await db.end() }
  const fresh = await connect('holofolder_fresh_raw094')
  try {
    await fresh.query('BEGIN'); const r = await seed(fresh); await fresh.query('COMMIT')
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
test('094 concurrent delivery serializes once; edit-first rejects and unlink-first denies before replay', { skip: !enabled }, async () => {
  const a = await connect('holofolder_fresh_raw094'), b = await connect('holofolder_fresh_raw094'), observer = await connect('holofolder_fresh_raw094')
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


test('094 restores a real 083 Blank binder after 091 insertion without changing its manifest', { skip: !enabled }, async () => {
  const db = await connect()
  try {
    await db.query('BEGIN')
    await db.query('INSERT INTO auth.users(id) VALUES($1),($2)', [owner, partner])
    await db.query('UPDATE public.billing_configuration SET enforced=false')
    await db.query("INSERT INTO public.partnerships(id,user1_id,user2_id,owner_user_id) VALUES('00940000-0000-4000-8000-000000000003',$1,$2,$1)", [owner, partner])
    await db.query('INSERT INTO public.inventory_owner_state(owner_user_id,inventory_revision) VALUES($1,8)', [owner])
    await send(db, { version: 1, operationId: 'synthetic-094-blank-create', inventoryRevision: 8, collectionId: collection,
      name: 'Synthetic raw', kind: 'binder', defaultPresentation: 'binder', location: null, grid: { rows: 3, cols: 3 }, manifest: blankPreset(), slotIds: [] }, partner, 'app', null, 'collection.create')
    await flush(db)
    const created = await state(db)
    await send(db, { operationId: 'synthetic-094-blank-fill', inventoryRevision: created.root.inventory_revision,
      collections: [{ collectionId: collection, version: created.collections[0].version, layoutRevision: created.collections[0].layout_revision }],
      commands: ['a', 'b'].map((key, n) => ({ kind: 'insertAssign', collectionId: collection, slotId: 'slot-' + key, before: null, target: null,
        selection: { kind: 'new', itemId: 'copy-' + (n ? 'a' : 'b'), identity: { kind: 'pokemon', pokemonId: 1 }, grading: null, acquiredAt: null } })) }, partner, 'app', null, 'inventory')
    await flush(db)
    const current = await state(db), f = await rawRestoreFixture(true)
    f.snapshot.inventoryRevision = current.root.inventory_revision
    f.snapshot.collections[0].version = current.collections[0].version
    f.snapshot.binders[0].layoutRevision = current.collections[0].layout_revision
    f.input.layouts[0].layoutRevision = current.collections[0].layout_revision
    for (const slot of f.snapshot.binders[0].slots) slot.version = current.slots.find((s: { id: string }) => s.id === slot.id).version
    for (const item of f.snapshot.items) item.version = current.items.find((i: { id: string }) => i.id === item.id).version
    for (const placement of f.snapshot.placements) placement.version = current.placements.find((p: { inventory_item_id: string }) => p.inventory_item_id === placement.inventoryItemId).version
    const request = planRawContentRestore({ ...f.input, current: await f.brand(f.snapshot) }).request
    const result = await send(db, request); await flush(db)
    assert.equal(result.changed, true)
    assert.deepEqual(result.releasedItemIds, ['copy-b'])
    const restored = await state(db)
    assert.deepEqual(restored.collections[0].preset_manifest, blankPreset())
    assert.deepEqual(restored.items, current.items)
    assert.equal(restored.placements[0].inventory_item_id, 'copy-a')
    assert.equal(restored.placements[0].slot_id, 'slot-a')
    const manifest = { ...blankPreset(), entries: [{ id: 'synthetic-entry', target: { kind: 'pokemon', pokemonId: 1 } }] }
    await db.query('UPDATE public.storage_collection_state SET preset_manifest=$1 WHERE collection_id=$2', [manifest, collection])
    await fails(db, () => send(db, { ...request, operationId: 'synthetic-094-nonempty-rejected', inventoryRevision: restored.root.inventory_revision }), '0A000')
  } finally { await db.query('ROLLBACK'); await db.end() }
})
