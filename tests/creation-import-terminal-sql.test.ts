import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'

const enabled = process.env.CREATION_IMPORT_TERMINAL_TEST_SOCKET
const config = { host: '/Users/cal/.local/share/holofolder/terminal-093-local/s', port: 55593, user: 'terminal093', database: 'postgres' }
const owner = '00930000-0000-4000-8000-000000000001', partner = '00930000-0000-4000-8000-000000000002'
const stranger = '00930000-0000-4000-8000-000000000099'
const source = { source: 'app', clientId: null, batchId: null, clientOccurredAt: null }
const flush = (db: Client) => db.query('RESET ROLE; SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED')
const operationId = () => 'synthetic-' + randomUUID()
async function seed(db: Client) {
  assert.equal(enabled, config.host)
  await db.query("INSERT INTO auth.users(id,created_at) VALUES($1,'2020-01-01'),($2,'2020-01-01')", [owner, partner])
  await db.query('UPDATE public.billing_configuration SET enforced=false')
  await db.query('INSERT INTO public.partnerships(user1_id,user2_id,owner_user_id) VALUES($1,$2,$1)', [owner, partner])
  await db.query('INSERT INTO public.inventory_owner_state(owner_user_id) VALUES($1)', [owner])
  await flush(db)
}
async function revision(db: Client) {
  await db.query('RESET ROLE')
  return Number((await db.query('SELECT inventory_revision FROM public.inventory_owner_state WHERE owner_user_id=$1', [owner])).rows[0]?.inventory_revision)
}
async function creation(db: Client, count = 0) {
  const id = randomUUID()
  return { version: 1, operationId: operationId(), inventoryRevision: await revision(db), collectionId: id, name: 'Synthetic 093', kind: 'binder', defaultPresentation: 'binder', location: null, grid: null,
    manifest: { source: { id: 'synthetic', version: '1' }, name: 'Synthetic goals', entries: Array.from({ length: count }, (_, n) => ({ id: 'entry-' + n, target: null })) },
    slotIds: Array.from({ length: count }, (_, n) => id + '/slot-' + n) }
}
async function send(db: Client, operation: string, request: Record<string, unknown>, actor = partner, transport = 'app', recipient = owner, clientId: string | null = null) {
  await db.query('RESET ROLE')
  await db.query("SELECT set_config('request.headers',$1,true),set_config('request.jwt.claims',$2,true)", [JSON.stringify({ 'x-holo-audit-context': JSON.stringify({ actor: { kind: 'user', userId: actor }, ...source, source: transport, clientId, operationId: request.operationId ?? operationId() }) }), JSON.stringify({ role: 'service_role' })])
  await db.query('SET LOCAL ROLE service_role')
  return (await db.query('SELECT public.storage_execute_v1($1,$2,$3) r', [operation, recipient, request])).rows[0].r
}
async function arrangement(db: Client, count = 1, copies = 1) {
  const dest = await creation(db)
  await send(db, 'collection.create', dest); await flush(db)
  const items = Array.from({ length: copies }, (_, n) => ({ kind: 'add', ref: null, item: { id: dest.collectionId + '/copy-' + n, identity: { kind: 'pokemon', pokemonId: 1 }, grading: null, acquiredAt: null, version: 0 } }))
  return { version: 1, operationId: operationId(), inventoryRevision: await revision(db), destinationCollectionId: dest.collectionId, collections: [{ collectionId: dest.collectionId, version: 0, layoutRevision: 0 }], emptyDestinationSlots: [], manifest: dest.manifest,
    copies: items, slots: Array.from({ length: count }, (_, n) => ({ id: dest.collectionId + '/import-' + n, target: null, status: n < copies ? 'collected' : null, wantedCards: [], inventoryItemId: n < copies ? items[n].item.id : null, presetOrigin: null })) }
}
async function state(db: Client) {
  await db.query('RESET ROLE')
  return (await db.query(`SELECT jsonb_build_object(
    'root',(SELECT to_jsonb(s) FROM public.inventory_owner_state s WHERE owner_user_id=$1),
    'binders',(SELECT coalesce(jsonb_agg(b ORDER BY id),'[]') FROM public.binders b WHERE owner_user_id=$1),
    'collections',(SELECT coalesce(jsonb_agg(c ORDER BY collection_id),'[]') FROM public.storage_collection_state c WHERE owner_user_id=$1),
    'slots',(SELECT coalesce(jsonb_agg(s ORDER BY id),'[]') FROM public.binder_slots s WHERE owner_user_id=$1),
    'items',(SELECT coalesce(jsonb_agg(i ORDER BY id),'[]') FROM public.inventory_items i WHERE owner_user_id=$1),
    'placements',(SELECT coalesce(jsonb_agg(p ORDER BY inventory_item_id),'[]') FROM public.inventory_placements p WHERE owner_user_id=$1),
    'history',(SELECT coalesce(jsonb_agg(a ORDER BY id),'[]') FROM public.collection_activity a WHERE owner_user_id=$1),
    'legacy',(SELECT coalesce(jsonb_agg(l ORDER BY id),'[]') FROM public.pokemon_collection l WHERE user_id=$1),
    'pending',(SELECT coalesce(jsonb_agg(p),'[]') FROM collection_audit_private.pending p WHERE owner_id=$1)) r`, [owner])).rows[0].r
}
async function fails(db: Client, run: () => Promise<unknown>, code: string) {
  await db.query('SAVEPOINT failure')
  await assert.rejects(run(), (e: unknown) => !!e && typeof e === 'object' && 'code' in e && e.code === code)
  await db.query('ROLLBACK TO SAVEPOINT failure; RESET ROLE')
}
async function noReceipt(db: Client, request: { operationId: string }) {
  await db.query('RESET ROLE')
  assert.equal((await db.query('SELECT count(*)::int n FROM public.developer_idempotency WHERE request_key=$1', [request.operationId])).rows[0].n, 0)
}
async function recover(db: Client, request: { operationId: string }) {
  await db.query('RESET ROLE')
  const eventId = (await db.query('SELECT id::text FROM public.collection_activity WHERE owner_user_id=$1 AND operation_id=$2', [owner, request.operationId])).rows[0].id
  const p = await send(db, 'recovery.preview', { eventId, restoreUnassignedItemIds: [] })
  assert.equal(p.supported, true)
  await send(db, 'recovery.apply', { eventId, restoreUnassignedItemIds: [], planVersion: 1, confirmed: true, planToken: p.planToken, operationId: operationId() }); await flush(db)
}

test('093 local twice preserves unrelated compiled functions, owners, ACLs, RLS and deadlines', { skip: !enabled }, async () => {
  const db = new Client(config); await db.connect()
  try {
    const functions = async () => (await db.query("SELECT p.oid::regprocedure::text name,md5(pg_get_functiondef(p.oid)) digest,proowner,proacl::text,proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','collection_audit_private') ORDER BY 1")).rows
    const access = async () => (await db.query("SELECT c.oid::regclass::text name,relowner,relacl::text,relrowsecurity,relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','collection_audit_private','auth','storage') ORDER BY 1")).rows
    const before = await functions(), acl = await access(), sql = readFileSync(new URL('../scripts/093_creation_import_terminal_noncommit.sql', import.meta.url), 'utf8')
    await db.query(sql); const once = await functions(); await db.query(sql)
    assert.deepEqual(await functions(), once); assert.deepEqual(await access(), acl)
    const changed = new Set(['storage_execute_v1(text,uuid,jsonb)', 'collection_audit_private.create_collection_v1(uuid,uuid,jsonb,jsonb)', 'collection_audit_private.import_arrangement_v1(uuid,uuid,jsonb,jsonb)'])
    for (const f of before) { const next = once.find(n => n.name === f.name)!; assert.equal(next.proowner, f.proowner); assert.equal(next.proacl, f.proacl); assert.deepEqual(next.proconfig, f.proconfig); if (!changed.has(f.name)) assert.equal(next.digest, f.digest) }
    for (const role of ['anon', 'authenticated', 'holo_mcp', 'service_role']) assert.equal((await db.query("SELECT has_function_privilege($1,'collection_audit_private.execute_creation_import_v1(text,uuid,uuid,jsonb,jsonb)','EXECUTE') ok", [role])).rows[0].ok, false)
    assert.ok(once.find(f => f.name === 'storage_execute_v1(text,uuid,jsonb)').proconfig.includes('statement_timeout=10s'))
  } finally { await db.end() }
})
for (const family of ['collection.create', 'backup.arrangement']) {
  test('093 ' + family + ' accepted compatibility, immutable intent, terminal replay after later state/recovery, current authority and RLS', { skip: !enabled, timeout: 60000 }, async () => {
    const db = new Client(config); await db.connect()
    try {
      await db.query("BEGIN; SET LOCAL statement_timeout='10s'"); await seed(db)
      if (family === 'collection.create') { await send(db, family, await creation(db)); await flush(db) }
      const input = family === 'collection.create' ? await creation(db, 3) : await arrangement(db, 3, 2)
      // Execute via the original engine first. Existing accepted receipt bytes/digest must replay unchanged.
      await db.query('RESET ROLE')
      const ctx = { actor: { kind: 'user', userId: partner }, ...source, operationId: input.operationId }
      // Use gateway-normalized context, identical to original engines' digest (including action).
      await send(db, family, { ...input, operationId: operationId(), inventoryRevision: 999 })
      await db.query('RESET ROLE')
      const signature = family === 'collection.create' ? 'create_collection_v1' : 'import_arrangement_v1'
      const normalized = (await db.query('SELECT collection_audit_private.context($1) c', [owner])).rows[0].c
      const oldCtx = { ...normalized, ...ctx }
      const accepted = (await db.query(`SELECT collection_audit_private.${signature}($1,$2,$3,$4) r`, [partner, owner, input, oldCtx])).rows[0].r
      await flush(db)
      // Replay through wrapper using the same trusted context without a new engine execution.
      const wrapper = async (request = input) => { await db.query('RESET ROLE'); return (await db.query('SELECT collection_audit_private.execute_creation_import_v1($1,$2,$3,$4,$5) r', [family, partner, owner, request, oldCtx])).rows[0].r }
      assert.deepEqual(await wrapper(), accepted)
      const baseline = await state(db)
      await fails(db, () => wrapper({ ...input, inventoryRevision: 999 }), '40001')
      assert.deepEqual(await state(db), baseline)
      // A new gateway intent with original accepted request uses original digest context as the engine does.
      const next = await creation(db); await send(db, 'collection.create', next); await flush(db)
      assert.deepEqual(await wrapper(), accepted)
      const stale = { ...input, operationId: operationId() }
      const before = await state(db), proof = await send(db, family, stale)
      assert.deepEqual(proof, { outcome: 'rejected', operationId: stale.operationId, code: 'inventory_revision_conflict', inventoryRevision: before.root.inventory_revision })
      assert.deepEqual(await state(db), before)
      const later = await creation(db); await send(db, 'collection.create', later); await flush(db)
      assert.deepEqual(await send(db, family, stale), proof)
      await recover(db, later)
      assert.deepEqual(await send(db, family, stale), proof)
      await recover(db, input)
      const afterInverse = await state(db)
      assert.deepEqual(await wrapper(), accepted)
      assert.deepEqual(await state(db), afterInverse, 'accepted replay after deletion/recovery cannot recreate')
      for (const changed of [{ ...stale, inventoryRevision: await revision(db) }, { ...stale, version: 2 }]) await fails(db, () => send(db, family, changed), changed.version === 2 ? '22023' : '40001')
      const otherActor = await send(db, family, stale, owner); assert.equal(otherActor.outcome, 'rejected')
      await fails(db, () => send(db, family, stale, partner, 'app', partner), '42501')
      await fails(db, () => send(db, family, stale, partner, 'rest'), 'HF402')
      await db.query('INSERT INTO public.perpetual_licences(owner_user_id,source) VALUES($1,\'manual\')', [owner])
      for (const transport of ['rest', 'mcp']) await fails(db, () => send(db, family, stale, partner, transport), '40001')
      await fails(db, () => send(db, family, stale, partner, 'app', owner, 'synthetic-other-credential'), '40001')
      for (const actor of [owner, partner, stranger]) {
        await db.query("SELECT set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: actor, role: 'authenticated' })]); await db.query('SET LOCAL ROLE authenticated')
        assert.equal((await db.query('SELECT count(*)::int n FROM public.binders WHERE owner_user_id=$1', [owner])).rows[0].n > 0, actor !== stranger)
        await db.query('RESET ROLE')
      }
      await db.query('SAVEPOINT billing'); await db.query('DELETE FROM public.perpetual_licences WHERE owner_user_id=$1', [owner]); await db.query('UPDATE public.billing_configuration SET enforced=true')
      await fails(db, () => send(db, family, stale), '42501'); await db.query('ROLLBACK TO SAVEPOINT billing')
      await db.query('SAVEPOINT unlink'); await db.query('DELETE FROM public.partnerships WHERE owner_user_id=$1', [owner])
      await fails(db, () => send(db, family, stale), '42501'); await db.query('ROLLBACK TO SAVEPOINT unlink')
      await db.query('SAVEPOINT missing'); await db.query('DELETE FROM public.inventory_owner_state WHERE owner_user_id=$1', [owner])
      const missing = { ...input, operationId: operationId(), inventoryRevision: 0 }
      await fails(db, () => send(db, family, missing), '55000'); await noReceipt(db, missing); await db.query('ROLLBACK TO SAVEPOINT missing')
      await db.query('ROLLBACK')
    } finally { await db.query('ROLLBACK'); await db.end() }
  })
  test('093 ' + family + ' partial writes, spoofed SQL messages, recorder failure, failed COMMIT remain atomic', { skip: !enabled, timeout: 60000 }, async () => {
    const db = new Client(config); await db.connect()
    try {
      await db.query("BEGIN; SET LOCAL statement_timeout='10s'"); await seed(db)
      const input = family === 'collection.create' ? await creation(db, 3) : await arrangement(db, 3, 2)
      for (const code of ['40001', '23505', '57014', 'P0001']) {
        await db.query('RESET ROLE; SAVEPOINT injection')
        await db.query(`CREATE FUNCTION pg_temp.fail_slot() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'inventory_revision_conflict' USING ERRCODE=TG_ARGV[0]; END $$`)
        await db.query(`CREATE TRIGGER synthetic_fail AFTER INSERT ON public.binder_slots FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_slot('${code}')`)
        const before = await state(db); await fails(db, () => send(db, family, input), code)
        assert.deepEqual(await state(db), before); await noReceipt(db, input); await db.query('ROLLBACK TO SAVEPOINT injection')
      }
      // Deliberately controlled late predicate proves rollback includes earlier acquisition/root/audit work.
      await db.query('RESET ROLE; SAVEPOINT controlled')
      await db.query(`CREATE FUNCTION pg_temp.late_predicate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'untrusted text is not the code' USING ERRCODE='HF931'; END $$`)
      await db.query('CREATE TRIGGER synthetic_controlled AFTER INSERT ON public.binder_slots FOR EACH ROW EXECUTE FUNCTION pg_temp.late_predicate()')
      const before = await state(db), proof = await send(db, family, input)
      assert.equal(proof.code, 'inventory_revision_conflict'); assert.deepEqual(await state(db), before)
      await db.query('ROLLBACK TO SAVEPOINT controlled')
      await db.query(`CREATE FUNCTION pg_temp.fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'inventory_revision_conflict' USING ERRCODE='40001'; END $$`)
      await db.query('CREATE TRIGGER synthetic_audit BEFORE INSERT ON public.collection_activity FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_audit()')
      await db.query('SAVEPOINT audit')
      const base = await state(db)
      await send(db, family, input)
      await fails(db, () => flush(db), '40001')
      await db.query('ROLLBACK TO SAVEPOINT audit'); assert.deepEqual(await state(db), base); await noReceipt(db, input)
      // COMMIT itself fails, including an already returned accepted receipt and its ledger write.
      await send(db, family, input)
      await assert.rejects(db.query('COMMIT'), (e: unknown) => !!e && typeof e === 'object' && 'code' in e && e.code === '40001')
      await db.query('RESET ROLE'); await noReceipt(db, input)
      assert.equal((await db.query('SELECT count(*)::int n FROM auth.users WHERE id=$1', [owner])).rows[0].n, 0)
    } finally { await db.query('ROLLBACK'); await db.end() }
  })
}

for (const family of ['collection.create', 'backup.arrangement']) {
  test('093 ' + family + ' real concurrent delivery, rollback, cancellation and membership fences', { skip: !enabled, timeout: 60000 }, async () => {
    const a = new Client(config), b = new Client(config); await a.connect(); await b.connect()
    const originalEnforcement = (await a.query('SELECT enforced FROM public.billing_configuration WHERE id')).rows[0].enforced
    async function blocked(observer: Client, pid: number) {
      for (let n = 0; n < 300; n++) if ((await observer.query('SELECT cardinality(pg_blocking_pids($1))>0 b', [pid])).rows[0].b) return
      assert.fail('expected PostgreSQL lock wait')
    }
    try {
      await a.query("BEGIN; SET LOCAL statement_timeout='10s'"); await seed(a)
      const input = family === 'collection.create' ? await creation(a, 3) : await arrangement(a, 3, 2)
      await a.query('COMMIT')
      const pid = (await b.query('SELECT pg_backend_pid() pid')).rows[0].pid
      await a.query('BEGIN'); const accepted = await send(a, family, input)
      await b.query('BEGIN'); const waiting = send(b, family, input)
      await a.query('RESET ROLE'); await blocked(a, pid); await a.query('COMMIT')
      assert.deepEqual(await waiting, accepted); await b.query('COMMIT')
      const acceptedState = await state(a)
      assert.equal(acceptedState.items.length, family === 'collection.create' ? 0 : 2)
      assert.equal(acceptedState.binders.filter((v: { is_default: boolean }) => v.is_default).length, 1)
      const stale = { ...input, operationId: operationId() }
      await a.query('BEGIN'); const proof = await send(a, family, stale); assert.equal(proof.outcome, 'rejected')
      await a.query('RESET ROLE')
      assert.ok((await a.query("SELECT count(*)::int n FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory' AND granted")).rows[0].n >= 2)
      await b.query('BEGIN'); const rejectedWait = send(b, family, stale)
      await blocked(a, pid); await a.query('COMMIT'); assert.deepEqual(await rejectedWait, proof); await b.query('COMMIT')
      assert.deepEqual(await state(a), acceptedState, 'rejection adds no acquisitions/history/root changes')
      // A rejected response cannot survive an unrelated deferred constraint failure at COMMIT.
      await a.query(`CREATE FUNCTION pg_temp.fail_terminal_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'inventory_revision_conflict' USING ERRCODE='40001'; END $$`)
      await a.query('CREATE CONSTRAINT TRIGGER synthetic_terminal_commit AFTER INSERT ON public.developer_idempotency DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_terminal_commit()')
      const failedCommit = { ...stale, operationId: operationId() }
      await a.query('BEGIN'); assert.equal((await send(a, family, failedCommit)).outcome, 'rejected')
      await assert.rejects(a.query('COMMIT'), (e: unknown) => !!e && typeof e === 'object' && 'code' in e && e.code === '40001')
      await a.query('RESET ROLE'); await noReceipt(a, failedCommit)
      await a.query('DROP TRIGGER synthetic_terminal_commit ON public.developer_idempotency')
      const rolled = { ...stale, operationId: operationId() }
      await a.query('BEGIN'); await send(a, family, rolled); await a.query('ROLLBACK'); await noReceipt(a, rolled)
      // Cancel while waiting for the outer root lock.
      await a.query('BEGIN'); await a.query('SELECT pg_advisory_xact_lock(hashtextextended($1,4701))', [owner])
      await b.query('BEGIN'); const cancelled = { ...stale, operationId: operationId() }
      const cancelWait = assert.rejects(send(b, family, cancelled), (e: unknown) => !!e && typeof e === 'object' && 'code' in e && e.code === '57014')
      await blocked(a, pid); await a.query('SELECT pg_cancel_backend($1)', [pid]); await cancelWait; await b.query('ROLLBACK'); await a.query('COMMIT'); await noReceipt(a, cancelled)
      // Real cancellation inside the engine, after slot mutation and (for import) acquisition.
      await a.query('BEGIN')
      const live = family === 'collection.create' ? await creation(a, 3) : await arrangement(a, 3, 2)
      await a.query('COMMIT'); const before = await state(a)
      await a.query(`CREATE FUNCTION pg_temp.pause_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(30); RETURN NEW; END $$`)
      await a.query('CREATE TRIGGER synthetic_pause AFTER INSERT ON public.binder_slots FOR EACH ROW EXECUTE FUNCTION pg_temp.pause_write()')
      await a.query('BEGIN'); const aPid = (await a.query('SELECT pg_backend_pid() pid')).rows[0].pid
      const running = assert.rejects(send(a, family, live), (e: unknown) => !!e && typeof e === 'object' && 'code' in e && e.code === '57014')
      let sleeping = false
      for (let n = 0; n < 300; n++) if ((await b.query("SELECT wait_event='PgSleep' sleeping FROM pg_stat_activity WHERE pid=$1", [aPid])).rows[0].sleeping) { sleeping = true; break }
      assert.equal(sleeping, true); await b.query('SELECT pg_cancel_backend($1)', [aPid]); await running; await a.query('ROLLBACK')
      await a.query('DROP TRIGGER synthetic_pause ON public.binder_slots')
      assert.deepEqual(await state(a), before); await noReceipt(a, live)
      // Membership edits/unlink cannot pass terminal replay's retained SHARE lock.
      for (const unlink of [false, true]) {
        await a.query('BEGIN'); assert.deepEqual(await send(a, family, stale), proof); await a.query('RESET ROLE')
        await b.query('BEGIN'); const edit = unlink ? b.query('DELETE FROM public.partnerships WHERE owner_user_id=$1', [owner]) : b.query('UPDATE public.partnerships SET owner_user_id=$1 WHERE owner_user_id=$2', [partner, owner])
        await blocked(a, pid); await a.query('COMMIT'); await edit; await b.query('ROLLBACK')
      }
      // Re-resolve after waiting for a committed owner change before replay.
      await b.query('BEGIN'); await b.query('UPDATE public.partnerships SET owner_user_id=$1 WHERE owner_user_id=$2', [partner, owner])
      await a.query('BEGIN'); const denied = assert.rejects(send(a, family, stale), (e: unknown) => !!e && typeof e === 'object' && 'code' in e && e.code === '42501')
      await blocked(b, aPid); await b.query('COMMIT'); await denied; await a.query('ROLLBACK')
      await b.query('UPDATE public.partnerships SET owner_user_id=$1 WHERE owner_user_id=$2', [owner, partner])
    } finally {
      await a.query('ROLLBACK; RESET ROLE'); await b.query('ROLLBACK; RESET ROLE')
      await a.query('DROP TRIGGER IF EXISTS synthetic_pause ON public.binder_slots; DROP TRIGGER IF EXISTS synthetic_terminal_commit ON public.developer_idempotency')
      await a.query('DELETE FROM auth.users WHERE id IN ($1,$2)', [owner, partner]); await a.query('UPDATE public.billing_configuration SET enforced=$1 WHERE id', [originalEnforcement]); await a.end(); await b.end()
    }
  })
}

test('093 dedicated identity/collection/destination/copy predicates, limits, duplicate copies and frozen evidence', { skip: !enabled, timeout: 60000 }, async () => {
  const db = new Client(config); await db.connect()
  try {
    await db.query("BEGIN; SET LOCAL statement_timeout='10s'"); await seed(db)
    const first = await creation(db); await send(db, 'collection.create', first); await flush(db)
    const collision = { ...await creation(db), collectionId: first.collectionId }
    const baseline = await state(db)
    const identity = await send(db, 'collection.create', collision)
    assert.equal(identity.code, 'creation_identity_conflict'); assert.deepEqual(await state(db), baseline)
    const input = await arrangement(db, 2, 2)
    for (const [change, reason] of [
      [{ collections: [{ ...input.collections[0], version: 1 }] }, 'inventory_collection_conflict'],
      [{ manifest: null }, 'arrangement_destination_conflict'],
    ] as const) {
      const original = { ...input, ...change, operationId: operationId() }, before = await state(db)
      assert.equal((await send(db, 'backup.arrangement', original)).code, reason)
      assert.deepEqual(await state(db), before)
    }
    await db.query('SAVEPOINT copy_collision')
    await db.query("INSERT INTO public.inventory_items(id,owner_user_id,identity) VALUES($1,$2,$3)", [input.copies[0].item.id, owner, input.copies[0].item.identity]); await flush(db)
    const copy = { ...input, operationId: operationId() }, beforeCopy = await state(db)
    assert.equal((await send(db, 'backup.arrangement', copy)).code, 'import_copy_conflict'); assert.deepEqual(await state(db), beforeCopy)
    await db.query('ROLLBACK TO SAVEPOINT copy_collision')
    // Duplicate declarations are invalid input, never a guessed durable noncommit proof.
    const duplicate = { ...input, operationId: operationId(), copies: [...input.copies, input.copies[0]] }
    await fails(db, () => send(db, 'backup.arrangement', duplicate), '22023'); await noReceipt(db, duplicate)
    await db.query('SAVEPOINT converted')
    const convertedId = randomUUID()
    await db.query("INSERT INTO public.binders(id,owner_user_id,name) VALUES($1,$2,'Synthetic converted')", [convertedId, owner])
    await db.query("INSERT INTO public.pokemon_collection(user_id,binder_id,pokemon_id,pokemon_name,status,card_id,collected_at) VALUES($1,$2,1,'Synthetic species','collected','synthetic-frozen','2020-01-01')", [owner, convertedId]); await flush(db)
    const evidence = (await db.query('SELECT public.legacy_binder_evidence_v1($1) e', [convertedId])).rows[0].e
    await db.query('SELECT public.convert_legacy_binder_v1($1,$2,$3)', [convertedId, owner, evidence.rowsDigest]); await flush(db)
    const frozen = { ...input, operationId: operationId(), inventoryRevision: await revision(db), destinationCollectionId: convertedId, collections: [{ collectionId: convertedId, version: 0, layoutRevision: 0 }] }
    const beforeFrozen = await state(db)
    await fails(db, () => send(db, 'backup.arrangement', frozen), '0A000'); await noReceipt(db, frozen)
    assert.deepEqual(await state(db), beforeFrozen); await db.query('ROLLBACK TO SAVEPOINT converted')
    // Both explicit physical copies of the same identity survive, no implicit duplicate collapse.
    const accepted = await send(db, 'backup.arrangement', input); await flush(db)
    assert.equal(accepted.addedItemIds.length, 2)
    const after = await state(db); assert.equal(after.items.length, 2); assert.equal(after.placements.length, 2)
    await recover(db, input)
    const recovered = await state(db)
    assert.equal(recovered.items.length, 0)
    assert.deepEqual(await send(db, 'backup.arrangement', input), accepted)
    assert.deepEqual(await state(db), recovered, 'accepted replay after inverse never acquires again')
    // Creation safety bound, current billing and plan triggers remain ordinary errors.
    await db.query('RESET ROLE; SAVEPOINT safety_bound')
    await db.query("INSERT INTO public.binders(id,owner_user_id,name,sort_order,is_default) SELECT gen_random_uuid(),$1,'Synthetic limit',n+20,false FROM generate_series(1,18) n", [owner]); await flush(db)
    const limited = await creation(db)
    await fails(db, () => send(db, 'collection.create', limited), 'P0001'); await noReceipt(db, limited)
    await db.query('ROLLBACK TO SAVEPOINT safety_bound; ROLLBACK')
  } finally { await db.query('ROLLBACK'); await db.end() }
})

test('093 maximum bounded creation and arrangement workloads retain the 10s SQL deadline', { skip: !enabled, timeout: 120000 }, async () => {
  const db = new Client(config); await db.connect()
  try {
    await db.query("BEGIN; SET LOCAL statement_timeout='10s'"); await seed(db)
    const input = await creation(db, 4096), createStart = performance.now()
    const accepted = await send(db, 'collection.create', input); await flush(db)
    const creationMs = performance.now() - createStart
    assert.equal(accepted.slotIds.length, 4096); assert.ok(creationMs < 10000)
    const imported = await arrangement(db, 4096, 5000), importStart = performance.now()
    const receipt = await send(db, 'backup.arrangement', imported); await flush(db)
    const importMs = performance.now() - importStart
    assert.equal(receipt.slotIds.length, 4096); assert.equal(receipt.addedItemIds.length, 5000); assert.ok(importMs < 10000)
    const before = await state(db), replayStart = performance.now()
    assert.deepEqual(await send(db, 'backup.arrangement', imported), receipt)
    const replayMs = performance.now() - replayStart
    assert.deepEqual(await state(db), before)
    const rejected = { ...imported, operationId: operationId() }, rejectStart = performance.now()
    assert.equal((await send(db, 'backup.arrangement', rejected)).outcome, 'rejected')
    const rejectMs = performance.now() - rejectStart
    assert.deepEqual(await state(db), before)
    console.log(JSON.stringify({ syntheticLocalOnly: true, creationSlots: 4096, importSlots: 4096, importCopies: 5000, creationAndFlushMs: Math.round(creationMs), importAndFlushMs: Math.round(importMs), replayMs: Math.round(replayMs), rejectionMs: Math.round(rejectMs), sqlDeadlineMs: 10000 }))
    await db.query('ROLLBACK')
  } finally { await db.query('ROLLBACK'); await db.end() }
})

test('093 import explicit move retains source wants and metadata, cap failure rolls back every copy', { skip: !enabled, timeout: 60000 }, async () => {
  const db = new Client(config); await db.connect()
  try {
    await db.query("BEGIN; SET LOCAL statement_timeout='10s'"); await seed(db)
    await db.query("INSERT INTO public.tcg_series(id,name_json) VALUES('synthetic-093-series','{}'); INSERT INTO public.tcg_sets(id,series_id,name_json) VALUES('synthetic-093-set','synthetic-093-series','{}')")
    await db.query(`INSERT INTO public.tcg_cards(id,series_id,set_id,local_id,name_json,variants_json) VALUES('synthetic-093-card','synthetic-093-series','synthetic-093-set','1','{"en":"Synthetic card"}','{"normal":true}')`)
    const original = await arrangement(db, 2, 2)
    const wants = [{ card_id: 'synthetic-093-card', card_name: 'Synthetic card', added_at: '2020-01-01', wanted_by: [owner, partner], card_image: 'https://assets.tcgdex.net/en/synthetic/1' }]
    Object.assign(original.slots[0], { wantedCards: wants })
    await send(db, 'backup.arrangement', original); await flush(db)
    const move = await arrangement(db, 1, 0)
    const movedId = original.copies[0].item.id, sourceSlot = original.slots[0].id
    const intent = { ...move, collections: [...move.collections, { collectionId: original.destinationCollectionId, version: 1, layoutRevision: 1 }],
      copies: [{ kind: 'existing', item: original.copies[0].item, ref: { itemId: movedId, itemVersion: 0, placement: { collectionId: original.destinationCollectionId, slot: { id: sourceSlot, version: 0, inventoryItemId: movedId, itemVersion: 0, placementVersion: 0 } } } }],
      slots: [{ ...move.slots[0], status: 'collected', inventoryItemId: movedId }] }
    const receipt = await send(db, 'backup.arrangement', intent); await flush(db)
    const after = await state(db)
    assert.equal(after.items.length, 2); assert.equal(after.placements.length, 2)
    for (const actor of [owner, partner, stranger]) {
      await db.query("SELECT set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: actor, role: 'authenticated' })]); await db.query('SET LOCAL ROLE authenticated')
      assert.equal((await db.query('SELECT count(*)::int n FROM public.inventory_items WHERE owner_user_id=$1', [owner])).rows[0].n, actor === stranger ? 0 : 2)
      await db.query('RESET ROLE')
    }
    await db.query('SET LOCAL ROLE anon'); await fails(db, () => db.query('SELECT * FROM public.inventory_items'), '42501')
    const retained = after.slots.find((s: { id: string }) => s.id === sourceSlot)
    assert.deepEqual(retained.wanted_cards, wants); assert.equal(retained.status, null)
    assert.equal(after.placements.find((p: { inventory_item_id: string }) => p.inventory_item_id === movedId).slot_id, move.slots[0].id)
    assert.deepEqual(await send(db, 'backup.arrangement', intent), receipt); assert.deepEqual(await state(db), after)
    await recover(db, intent)
    const undone = await state(db)
    assert.deepEqual(undone.slots.find((s: { id: string }) => s.id === sourceSlot).wanted_cards, wants)
    assert.equal(undone.placements.find((p: { inventory_item_id: string }) => p.inventory_item_id === movedId).slot_id, sourceSlot)
    const capped = await arrangement(db, 1, 1)
    await db.query('UPDATE public.billing_configuration SET enforced=true,free_card_limit=1')
    const before = await state(db)
    await fails(db, () => send(db, 'backup.arrangement', capped, owner), 'P0001'); await noReceipt(db, capped)
    assert.deepEqual(await state(db), before)
    await db.query('ROLLBACK')
  } finally { await db.query('ROLLBACK'); await db.end() }
})

test('093 competing first creations preserve a single default, contiguous order and original rejection', { skip: !enabled, timeout: 60000 }, async () => {
  const a = new Client(config), b = new Client(config); await a.connect(); await b.connect()
    const originalEnforcement = (await a.query('SELECT enforced FROM public.billing_configuration WHERE id')).rows[0].enforced
  try {
    await a.query('BEGIN'); await seed(a)
    const first = await creation(a), competing = await creation(a); await a.query('COMMIT')
    await a.query('BEGIN'); await send(a, 'collection.create', first)
    await b.query('BEGIN'); const waiting = send(b, 'collection.create', competing)
    await a.query('RESET ROLE; COMMIT'); const proof = await waiting; await b.query('COMMIT')
    assert.equal(proof.outcome, 'rejected')
    await a.query('BEGIN'); const reviewed = { ...competing, operationId: operationId(), inventoryRevision: await revision(a) }
    await send(a, 'collection.create', reviewed); await a.query('RESET ROLE; COMMIT')
    await a.query('BEGIN'); assert.deepEqual(await send(a, 'collection.create', competing), proof); await a.query('RESET ROLE; COMMIT')
    const saved = await state(a)
    assert.deepEqual(saved.binders.map((v: { sort_order: number }) => v.sort_order).sort(), [0, 1])
    assert.equal(saved.binders.filter((v: { is_default: boolean }) => v.is_default).length, 1)
    assert.equal(saved.binders.find((v: { id: string }) => v.id === first.collectionId).is_default, true)
  } finally {
    await a.query('ROLLBACK; RESET ROLE'); await b.query('ROLLBACK; RESET ROLE')
    await a.query('DELETE FROM auth.users WHERE id IN ($1,$2)', [owner, partner]); await a.query('UPDATE public.billing_configuration SET enforced=$1 WHERE id', [originalEnforcement]); await a.end(); await b.end()
  }
})
