import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { Client } from 'pg'
import { rawOwner as owner, rawPartner as partner, rawCollection as collection } from './fixtures/raw-restore'
import { planRawContentRestore  } from '@/lib/raw-restore-plan'
import { normalizeStorageResult } from '@/lib/server/operations/storage-contract'
import type { RawRestoreCommand } from '@/lib/domain/raw-restore'

const enabled = process.env.RAW_RESTORE_V4_TEST_SOCKET
const config = { host: '/Users/cal/.local/share/holofolder/raw-restore-100-local/s', port: 55600, user: 'restore100', database: 'preserve100' }
async function connect(database = config.database) {
  assert.equal(enabled, config.host)
  const db = new Client({ ...config, database }); await db.connect(); return db
}
const flush = (db: Client) => db.query('RESET ROLE; SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED')
async function send(db: Client, request: RawRestoreCommand | Record<string, unknown>, actor = partner, source = 'app', clientId: string | null = null, operation = 'backup.restore.raw') {
  await db.query('RESET ROLE')
  await db.query("SELECT set_config('request.headers',$1,true),set_config('request.jwt.claims',$2,true)", [JSON.stringify({ 'x-holo-audit-context': JSON.stringify({ actor: { kind: 'user', userId: actor }, source, clientId, operationId: request.operationId ?? 'synthetic-100-preview', batchId: request.operationId ?? 'synthetic-100-preview', clientOccurredAt: null }) }), JSON.stringify({ role: 'service_role' })])
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

/** SQL-backed private complete reader, with authentic RLS and 500-row pages. Synthetic data only. */
async function complete(db: Client, readOwner = owner, readActor = partner) {
  const { readCompleteInventorySnapshot } = await import('@/lib/collection/slot-snapshot')
  await db.query('RESET ROLE')
  await db.query("SELECT set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: readActor, role: 'authenticated' })])
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [readActor])
  await db.query('SET LOCAL ROLE authenticated')
  const revision = Number((await db.query('SELECT inventory_revision FROM public.inventory_owner_state WHERE owner_user_id=$1', [readOwner])).rows[0].inventory_revision)
  const all = async (table: string, order: string) => {
    const rows: import('pg').QueryResultRow[] = []
    for (let offset = 0;; offset += 500) {
      const page = (await db.query(`SELECT * FROM public.${table} WHERE owner_user_id=$1 ORDER BY ${order} LIMIT 500 OFFSET $2`, [readOwner, offset])).rows
      rows.push(...page); if (page.length < 500) return rows
    }
  }
  const items = (await all('inventory_items', 'id')).map(r => ({ id: r.id, ownerUserId: readOwner, identity: r.identity, grading: r.grading,
    acquiredAt: r.acquired_at?.toISOString() ?? null, legacySource: r.legacy_source, version: Number(r.version) }))
  const placements = (await all('inventory_placements', 'inventory_item_id')).map(r => ({ inventoryItemId: r.inventory_item_id, collectionId: r.collection_id, slotId: r.slot_id, version: Number(r.version) }))
  const mappings = await all('binder_legacy_rows', 'legacy_row_id')
  const roots = await all('storage_collection_state', 'collection_id'), bs = await all('binders', 'id'), slots = await all('binder_slots', 'collection_id,position')
  const collections = roots.map(r => ({ id: r.collection_id, ownerUserId: readOwner, name: bs.find(b => b.id === r.collection_id)!.name, kind: r.kind,
    defaultPresentation: r.default_presentation, location: r.location, version: Number(r.version) }))
  const binders = roots.map(r => ({ ownerUserId: readOwner, collectionId: r.collection_id, layoutRevision: Number(r.layout_revision), presetManifest: r.preset_manifest,
    slots: slots.filter(s => s.collection_id === r.collection_id).map(s => ({ id: s.id, ownerUserId: readOwner, collectionId: r.collection_id, version: Number(s.version),
      target: s.target, status: s.status, wantedCards: s.wanted_cards, inventoryItemId: placements.find(p => p.slotId === s.id)?.inventoryItemId ?? null, presetOrigin: s.preset_origin, legacySource: mappings.find(m => m.slot_id === s.id) ? { legacyRowId: mappings.find(m => m.slot_id === s.id)!.legacy_row_id, sourceRow: mappings.find(m => m.slot_id === s.id)!.source_row } : null })) }))
  const settings=(await db.query('SELECT binder_rows,binder_cols FROM public.user_settings WHERE user_id=$1',[readOwner])).rows[0]
  const layouts = roots.map(r => ({ collectionId: r.collection_id, layoutRevision: Number(r.layout_revision), rows: bs.find(b => b.id === r.collection_id)!.binder_rows ?? settings?.binder_rows ?? 4, cols: bs.find(b => b.id === r.collection_id)!.binder_cols ?? settings?.binder_cols ?? 4 }))
  const page = <T>(rows: T[]) => async (cursor?: string | null) => {
    const offset = Number(cursor ?? 0), next = offset + 500 < rows.length ? String(offset + 500) : null
    return { rows: rows.slice(offset, offset + 500), total: rows.length, inventoryRevision: revision, next }
  }
  const snapshot = await readCompleteInventorySnapshot(readOwner, revision, { items: page(items), placements: page(placements), collections: page(collections), binders: page(binders) })
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

const copyA = '01000000-0000-4000-8000-000000000021', copyB = '01000000-0000-4000-8000-000000000022'
const slotId = (n: number) => `legacy-dex-v1/${collection}/${n}`
async function seedConverted(db: Client) {
  await db.query('INSERT INTO auth.users(id) VALUES($1),($2)', [owner, partner])
  await db.query("INSERT INTO public.perpetual_licences(owner_user_id,source) VALUES($1,'manual')", [owner])
  await db.query("INSERT INTO public.partnerships(id,user1_id,user2_id,owner_user_id) VALUES('00940000-0000-4000-8000-000000000003',$1,$2,$1)", [owner, partner])
  await db.query("INSERT INTO public.binders(id,owner_user_id,name,is_default,binder_rows,binder_cols) VALUES($1,$2,'Synthetic converted restore',true,3,3)", [collection, owner])
  await db.query("INSERT INTO public.tcg_series(id) VALUES('synthetic100-series'); INSERT INTO public.tcg_sets(id,series_id) VALUES('synthetic100-set','synthetic100-series'); INSERT INTO public.tcg_cards(id,series_id,set_id,local_id) VALUES('synthetic100-print','synthetic100-series','synthetic100-set','1'); INSERT INTO public.tcg_card_dex_ids(card_id,dex_id) VALUES('synthetic100-print',1),('synthetic100-print',2)")
  await db.query(`INSERT INTO public.pokemon_collection(id,binder_id,user_id,pokemon_id,pokemon_name,status,card_id,card_name,collected_at) VALUES
    ($1,$3,$4,1,'Synthetic one','collected','synthetic100-print','Synthetic repeated printing','2020-01-01'),($2,$3,$4,2,'Synthetic two','finalized','synthetic100-print','Synthetic repeated printing','2020-01-02')`, [copyA,copyB,collection,owner])
  await flush(db)
  await db.query("SELECT public.convert_legacy_binder_v1($1,$2,public.legacy_binder_evidence_v1($1)->>'rowsDigest')",[collection,owner]);await flush(db)
}
async function frozen(db: Client) {
  await db.query('RESET ROLE')
  return (await db.query(`SELECT
    (SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.pokemon_collection c WHERE binder_id=$1) originals,
    (SELECT jsonb_agg(to_jsonb(m) ORDER BY legacy_row_id) FROM public.binder_legacy_rows m WHERE collection_id=$1) mappings,
    (SELECT to_jsonb(s)-ARRAY['version','layout_revision'] FROM public.storage_collection_state s WHERE collection_id=$1) provenance,
    (SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM public.inventory_items i WHERE owner_user_id=$2) items`,[collection,owner])).rows[0]
}
async function plan(db: Client, text: string, operationId: string) {
  const { snapshot, layouts } = await complete(db)
  const scope = { actorUserId: partner, ownerUserId: owner, source: 'app' as const, credentialId:null, authSessionId:'synthetic-100-session',
    partnershipId:'00940000-0000-4000-8000-000000000003',partnerUserId:partner }
  const desired = JSON.parse(text) as { placements: { inventoryItemId: string }[] }
  return planRawContentRestore({text,current:snapshot,layouts,evidence:scope,currentScope:scope,operationId,savedEntryRemaining:8192,
    choices:{collectionId:collection,slotIds:snapshot.binders[0].slots.map(s=>s.id),releaseItemIds:snapshot.placements.filter(p=>!desired.placements.some(d=>d.inventoryItemId===p.inventoryItemId)).map(p=>p.inventoryItemId).sort(),restoreContent:true}}).request
}
async function exportFile(db: Client) {
  const { createBinderBackupV2 } = await import('@/lib/binder-backup-v2')
  const read = await complete(db)
  return JSON.stringify(createBinderBackupV2({snapshot:read.snapshot,completeness:'complete-owner',scope:'collection',collectionId:collection,layouts:read.layouts}))
}
async function modify(db: Client) {
  const read = await complete(db)
  // Existing converted copy goes to Unassigned, then the other stable copy moves into its slot.
  const item = read.snapshot.items.find(i=>i.id===copyA)!, p=read.snapshot.placements.find(p=>p.inventoryItemId===copyA)!
  await inventory(db,'synthetic-100-unassign',[{kind:'unassign',item:{itemId:copyA,itemVersion:item.version,placement:{collectionId:collection,slot:beforeRef(read.snapshot,p.slotId)}}}])
  await flush(db)
}

for (const reorder of [false,true]) test(`100 actual converted 1025 export, content restore, COMMIT, exact native inverse and replay, reorder=${reorder}`, {skip:!enabled,timeout:120000},async()=>{
 const db=await connect('fresh100')
 try {
  await db.query('BEGIN');await seedConverted(db);await db.query('COMMIT')
  const preserved=await frozen(db), file=JSON.parse(await exportFile(db))
  if(reorder)file.binders[0].slots.reverse()
  const text=JSON.stringify(file)
  await db.query('BEGIN');await modify(db);await db.query('COMMIT')
  const before=(await complete(db)).snapshot
  await db.query('BEGIN');const request=await plan(db,text,'synthetic-100-restore');assert.equal(request.version,4)
  const receipt=await send(db,request);await flush(db);normalizeStorageResult('backup.restore.raw',receipt)
  assert.equal(receipt.version,4);assert.equal(receipt.layoutRevision,request.collection.layoutRevision+(reorder?1:0))
  await db.query('COMMIT');assert.deepEqual(await frozen(db),preserved)
  const after=(await complete(db)).snapshot
  assert.deepEqual(after.items[0].identity,after.items[1].identity)
  assert.equal(after.inventoryRevision,request.inventoryRevision+1)
  for(const pair of request.slots)assert.equal(after.binders[0].slots.find(s=>s.id===pair.before.id)!.version,pair.before.version+1)
  assert.equal(after.placements.find(p=>p.inventoryItemId===copyA)?.slotId,slotId(1))
  const event=(await db.query('SELECT id FROM public.collection_activity WHERE owner_user_id=$1 AND operation_id=$2',[owner,request.operationId])).rows[0].id
  await db.query('BEGIN')
  const preview=await send(db,{eventId:event,restoreUnassignedItemIds:[]},partner,'app',null,'recovery.preview')
  assert.equal(preview.supported,true);assert.deepEqual(preview.conflicts,[]);assert.ok(preview.planToken)
  await send(db,{operationId:'synthetic-100-inverse',eventId:event,restoreUnassignedItemIds:[],confirmed:true,planVersion:1,planToken:preview.planToken},partner,'app',null,'recovery.apply');await flush(db);await db.query('COMMIT')
  const recovered=(await complete(db)).snapshot
  assert.ok(recovered.inventoryRevision>after.inventoryRevision)
  for(const slot of recovered.binders[0].slots)assert.ok(slot.version>after.binders[0].slots.find(s=>s.id===slot.id)!.version)
  assert.deepEqual(recovered.placements.map(({version:_v,...p})=>p),before.placements.map(({version:_v,...p})=>p))
  assert.deepEqual(recovered.binders[0].slots.map(({version:_v,...s})=>s),before.binders[0].slots.map(({version:_v,...s})=>s))
  assert.deepEqual(await frozen(db),preserved)
  await db.query('BEGIN');assert.deepEqual(await send(db,request),receipt);await db.query('COMMIT')
 } finally { await db.query('ROLLBACK;RESET ROLE');await db.query('DELETE FROM auth.users WHERE id=ANY($1::uuid[])',[[owner,partner]]);await db.query("DELETE FROM public.tcg_series WHERE id='synthetic100-series'");await db.end() }
})

test('100 twice preserves original91 counts35 digests and ACLs and protected compiled definitions', { skip: !enabled }, async () => {
  const db = await connect(), baseline = await connect('preserve100baseline')
  try {
    const functions = async (c: Client) => (await c.query("SELECT p.oid::regprocedure::text name,md5(pg_get_functiondef(p.oid)) digest,proowner,proacl::text,proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','collection_audit_private') ORDER BY 1")).rows
    const prior = await functions(baseline), installed = await functions(db)
    assert.equal(installed.length, prior.length + 1)
    for (const old of prior) {
      const next = installed.find(f => f.name === old.name)!
      assert.equal(next.proowner, old.proowner); assert.equal(next.proacl, old.proacl); assert.deepEqual(next.proconfig, old.proconfig)
      if (old.name !== 'storage_execute_v1(text,uuid,jsonb)') assert.equal(next.digest, old.digest, old.name)
    }
    for (const query of [
      "SELECT c.oid::regclass::text name,relowner,relacl::text,relrowsecurity,relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','collection_audit_private','auth','storage') ORDER BY 1",
      'SELECT * FROM pg_policies ORDER BY schemaname,tablename,policyname',
      "SELECT attrelid::regclass::text name,attnum,attacl::text FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','collection_audit_private','auth','storage') AND attnum>0 ORDER BY 1,2",
    ]) assert.deepEqual((await db.query(query)).rows, (await baseline.query(query)).rows)
    const sql = readFileSync(new URL('../scripts/100_converted_raw_content_restore.sql', import.meta.url), 'utf8')
    await db.query(sql); await db.query(sql); assert.deepEqual(await functions(db), installed)
    
    for (const role of ['anon', 'authenticated', 'holo_mcp', 'service_role']) {
      assert.equal((await db.query("SELECT has_function_privilege($1,'collection_audit_private.restore_raw_content_v4(uuid,uuid,jsonb,jsonb)','EXECUTE') ok", [role])).rows[0].ok, false)
    }
    const archive = '/Users/cal/.local/share/holofolder/backups/2026-11-10T10-44-05Z-before-native-conversion/'
    const counts = JSON.parse(readFileSync(archive + 'source-counts.json', 'utf8')), digests = JSON.parse(readFileSync(archive + 'source-critical-digests.json', 'utf8'))
    assert.equal(Object.keys(counts).length, 91); assert.equal(Object.keys(digests).length, 35)
    await db.query("SET TIME ZONE 'UTC'")
    for (const [name, count] of Object.entries(counts)) {
      assert.match(name, /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/)
      const r = (await db.query(`SELECT count(*)::int n${name in digests ? ",md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) digest" : ''} FROM ${name} t`)).rows[0]
      assert.equal(r.n, count, name); if (name in digests) assert.equal(r.digest, digests[name], name)
    }
  } finally { await db.end(); await baseline.end() }
})

async function rollbackFixture(db: Client) {
 await db.query('BEGIN');await seedConverted(db)
 const text=await exportFile(db);await modify(db)
 return plan(db,text,'synthetic-100-guards')
}
test('100 actual SQL rollback, immutable guards, version/conflict/envelope refusal and cross-version fences', {skip:!enabled,timeout:120000},async()=>{
 const db=await connect()
 try {
  const r=await rollbackFixture(db), before=await state(db), provenance=await frozen(db)
  for(const query of ["UPDATE public.pokemon_collection SET pokemon_name='changed' WHERE binder_id=$1", "UPDATE public.storage_collection_state SET authority='legacy',conversion_version=NULL,converted_at=NULL,conversion_receipt=NULL WHERE collection_id=$1"]) {
   await fails(db,()=>db.query(query,[collection]),'55000')
  }
  const malformed=structuredClone(r)
  if(malformed.version!==4)throw new Error('fixture')
  malformed.slotOrder.after[0]=malformed.slotOrder.after[1]
  await fails(db,()=>send(db,malformed),'22023');assert.deepEqual(await state(db),before)
  await fails(db,()=>send(db,{...r,version:999}),'22023');assert.deepEqual(await state(db),before)
  await db.query('SAVEPOINT restore');const receipt=await send(db,r);assert.equal(receipt.version,4)
  await db.query('ROLLBACK TO SAVEPOINT restore');assert.deepEqual(await state(db),before);assert.deepEqual(await frozen(db),provenance)
  for(const [key,patch,code] of [
   ['inventory',{inventoryRevision:r.inventoryRevision-1},'inventory_revision_conflict'],
   ['collection',{collection:{...r.collection,version:r.collection.version-1}},'raw_restore_collection_conflict'],
  ] as const) {
   const command={...r,...patch,operationId:`synthetic-100-${key}`}
   const rejected=await send(db,command);assert.equal(rejected.version,4);assert.equal(rejected.code,code)
   assert.deepEqual(await send(db,command),rejected)
   await fails(db,()=>send(db,{...command,version:3}),'40001')
  }
  const slotConflict={...r,operationId:'synthetic-100-slot-conflict',slots:r.slots.map((p,n)=>n?p:{...p,before:{...p.before,version:p.before.version+1}})}
  await fails(db,()=>send(db,slotConflict),'40001')
  await db.query('RESET ROLE')
  assert.equal((await db.query('SELECT count(*)::int n FROM public.developer_idempotency WHERE request_key=$1',[slotConflict.operationId])).rows[0].n,0)
  assert.deepEqual(await frozen(db),provenance)
  await db.query('ROLLBACK')
  assert.equal((await db.query('SELECT count(*)::int n FROM auth.users WHERE id=$1',[owner])).rows[0].n,0)
 }finally{await db.query('ROLLBACK');await db.end()}
})

async function blocked(db: Client,pid:number){
 for(let n=0;n<100;n++){
  if((await db.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[pid])).rows[0]?.wait_event_type==='Lock')return
  await new Promise(resolve=>setTimeout(resolve,10))
 }
 assert.fail('concurrent session did not reach lock wait')
}
test('100 real identical-delivery/edit/unlink races, accepted/rejected failed COMMIT has no terminal proof', {skip:!enabled,timeout:120000},async()=>{
 const a=await connect('fresh100'),b=await connect('fresh100'),observer=await connect('fresh100')
 try{
  const r=await rollbackFixture(a);await a.query('COMMIT')
  const preserved=await frozen(a)
  for(const accepted of [true,false]){
   const request={...r,operationId:`synthetic-100-failed-${accepted}`,inventoryRevision:r.inventoryRevision-(accepted?0:1)}
   await a.query(`BEGIN; CREATE FUNCTION pg_temp.fail_terminal_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic deferred failure' USING ERRCODE='23514'; END $$;
    CREATE CONSTRAINT TRIGGER synthetic_fail_commit AFTER INSERT ON public.developer_idempotency DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_terminal_commit()`)
   const provisional=await send(a,request);assert.equal(provisional.outcome==='rejected',!accepted)
   await assert.rejects(a.query('COMMIT'),(e:unknown)=>!!e&&typeof e==='object'&&'code' in e&&e.code==='23514')
   assert.equal((await a.query('SELECT count(*)::int n FROM public.developer_idempotency WHERE request_key=$1',[request.operationId])).rows[0].n,0)
   assert.deepEqual(await frozen(a),preserved)
  }
  const pid=(await b.query('SELECT pg_backend_pid() pid')).rows[0].pid
  await a.query('BEGIN');await b.query('BEGIN')
  const accepted=await send(a,r), waiting=send(b,r)
  await blocked(observer,pid);await a.query('COMMIT');assert.deepEqual(await waiting,accepted);await b.query('COMMIT')
  assert.equal((await observer.query('SELECT count(*)::int n FROM public.collection_activity WHERE owner_user_id=$1 AND operation_id=$2',[owner,r.operationId])).rows[0].n,1)
  assert.deepEqual(await frozen(a),preserved)
  const current=(await complete(a)).snapshot.inventoryRevision
  await a.query('BEGIN');await b.query('BEGIN')
  await a.query('UPDATE public.inventory_owner_state SET inventory_revision=inventory_revision+1 WHERE owner_user_id=$1',[owner])
  const stale=send(b,{...r,operationId:'synthetic-100-edit-first',inventoryRevision:current});await blocked(observer,pid)
  await a.query('COMMIT');assert.equal((await stale).code,'inventory_revision_conflict');await b.query('COMMIT')
  await a.query('BEGIN');await b.query('BEGIN')
  await a.query('DELETE FROM public.partnerships WHERE owner_user_id=$1',[owner])
  const denial=assert.rejects(send(b,r),(e:unknown)=>!!e&&typeof e==='object'&&'code' in e&&e.code==='42501')
  await blocked(observer,pid);await a.query('COMMIT');await denial;await b.query('ROLLBACK')
 }finally{
  await a.query('ROLLBACK;RESET ROLE');await b.query('ROLLBACK;RESET ROLE')
  await a.query('DELETE FROM auth.users WHERE id=ANY($1::uuid[])',[[owner,partner]])
  await a.query("DELETE FROM public.tcg_series WHERE id='synthetic100-series'")
  await Promise.all([a.end(),b.end(),observer.end()])
 }
})

test('100 pre-migration refusal, converted reorder inverse, exact graph ceiling and rolled-back EXPLAIN', {skip:!enabled,timeout:120000},async()=>{
 const db=await connect(),old=await connect('preserve100baseline')
 try{
  const r=await rollbackFixture(db)
  if(r.version!==4)throw new Error('fixture')
  await rollbackFixture(old);await fails(old,()=>send(old,r),'22023');await old.query('ROLLBACK')
  const reversed={...r,operationId:'synthetic-100-reorder',slotOrder:{before:r.slotOrder.before,after:[...r.slotOrder.before].reverse()}}
  await db.query('SAVEPOINT reordered')
  const restored=await send(db,reversed);assert.equal(restored.layoutRevision,r.collection.layoutRevision+1)
  await db.query('RESET ROLE')
  const event=(await db.query("SELECT id FROM public.collection_activity WHERE operation_id='synthetic-100-reorder'")).rows[0].id
  const preview=await send(db,{eventId:event,restoreUnassignedItemIds:[]},partner,'app',null,'recovery.preview')
  assert.equal(preview.supported,true);assert.deepEqual(preview.conflicts,[])
  await send(db,{operationId:'synthetic-100-reorder-inverse',eventId:event,restoreUnassignedItemIds:[],confirmed:true,planVersion:1,planToken:preview.planToken},partner,'app',null,'recovery.apply')
  await db.query('ROLLBACK TO SAVEPOINT reordered;RESET ROLE')
  await db.query("SAVEPOINT graph; SELECT set_config('request.headers','{}',true)")
  // Synthetic old wants alone exceed the actual graph ceiling. The reviewed request remains small.
  await db.query("UPDATE public.binder_slots SET wanted_cards=jsonb_build_array(jsonb_build_object('card_id','synthetic','card_name',repeat('x',2700000),'added_at','2020-01-01')) WHERE id=$1",[slotId(3)])
  await flush(db);const oversized=await state(db)
  await fails(db,()=>send(db,{...r,operationId:'synthetic-100-graph-over'}),'22023');assert.deepEqual(await state(db),oversized)
  await db.query('ROLLBACK TO SAVEPOINT graph;RESET ROLE')
  await db.query('SAVEPOINT explanation');await send(db,r);await db.query('ROLLBACK TO SAVEPOINT explanation')
  await db.query("SELECT set_config('request.headers',$1,true),set_config('request.jwt.claims',$2,true)",[JSON.stringify({'x-holo-audit-context':JSON.stringify({actor:{kind:'user',userId:partner},source:'app',clientId:null,operationId:r.operationId,batchId:r.operationId,clientOccurredAt:null})}),JSON.stringify({role:'service_role'})])
  await db.query('SET LOCAL ROLE service_role')
  const explain=await db.query('EXPLAIN (ANALYZE,BUFFERS) SELECT public.storage_execute_v1($1,$2,$3)',['backup.restore.raw',owner,r])
  assert.ok(explain.rows.some(row=>String(row['QUERY PLAN']).includes('Execution Time:')))
 }finally{await db.query('ROLLBACK');await old.query('ROLLBACK');await db.end();await old.end()}
})

test('100 private archived11 binders convert locally and restore reviewed current content without committed fixture changes', {skip:!enabled,timeout:300000},async()=>{
 const db=await connect()
 let phase='begin'
 try{
  await db.query('BEGIN')
  const binders=(await db.query('SELECT b.id,b.owner_user_id FROM public.binders b ORDER BY b.owner_user_id,b.id')).rows
  assert.equal(binders.length,11)
  const {createBinderBackupV2}=await import('@/lib/binder-backup-v2')
  let changed=0, restored=0, assetExcluded=0
  for(const binder of binders){
   phase='local archived conversion'
   await db.query('RESET ROLE;SELECT set_config(\'request.headers\',\'{}\',true)')
   await db.query("SELECT public.convert_legacy_binder_v1($1,$2,public.legacy_binder_evidence_v1($1)->>'rowsDigest')",[binder.id,binder.owner_user_id]);await flush(db)
  }
  for(const binder of binders){
   phase='complete private current export'
   const readOwner=String(binder.owner_user_id),collectionId=String(binder.id)
   const membership=(await db.query('SELECT * FROM public.partnerships WHERE owner_user_id=$1',[readOwner])).rows[0]
   const livePartner=membership?(membership.user1_id===readOwner?membership.user2_id:membership.user1_id):null
   const read=await complete(db,readOwner,readOwner)
   let text:string
   try { text=JSON.stringify(createBinderBackupV2({snapshot:read.snapshot,completeness:'complete-owner',scope:'collection',collectionId,layouts:read.layouts,partnerUserId:livePartner??undefined})) }
   catch(error){
    if(error instanceof Error && error.message==='Unverified asset URL'){assetExcluded++;continue}
    throw error
   }
   const dispatch=async(operation:string,request:Record<string,unknown>)=>{
    await db.query('RESET ROLE')
    await db.query("SELECT set_config('request.headers',$1,true),set_config('request.jwt.claims',$2,true)",[JSON.stringify({'x-holo-audit-context':JSON.stringify({actor:{kind:'user',userId:readOwner},source:'app',clientId:null,operationId:request.operationId,batchId:request.operationId,clientOccurredAt:null})}),JSON.stringify({role:'service_role'})])
    await db.query('SET LOCAL ROLE service_role')
    return (await db.query('SELECT public.storage_execute_v1($1,$2,$3) r',[operation,readOwner,request])).rows[0].r
   }
   phase='reviewed existing copy unassign'
   const placed=read.snapshot.placements.find(p=>p.collectionId===collectionId)
   if(placed){
    const slot=read.snapshot.binders.find(b=>b.collectionId===collectionId)!.slots.find(s=>s.id===placed.slotId)!,item=read.snapshot.items.find(i=>i.id===placed.inventoryItemId)!
    await dispatch('inventory',{operationId:crypto.randomUUID(),inventoryRevision:read.snapshot.inventoryRevision,
     collections:[{collectionId,version:read.snapshot.collections.find(c=>c.id===collectionId)!.version,layoutRevision:read.snapshot.binders.find(b=>b.collectionId===collectionId)!.layoutRevision}],
     commands:[{kind:'unassign',item:{itemId:item.id,itemVersion:item.version,placement:{collectionId,slot:{id:slot.id,version:slot.version,inventoryItemId:item.id,itemVersion:item.version,placementVersion:placed.version}}}}]});await flush(db);changed++
   }
   phase='trusted bounded private restore plan'
   const current=await complete(db,readOwner,readOwner)
   const scope={actorUserId:readOwner,ownerUserId:readOwner,source:'app' as const,credentialId:null,authSessionId:'synthetic-100-archive-session',partnerUserId:livePartner,partnershipId:membership?.id??null}
   const plan=planRawContentRestore({text,current:current.snapshot,layouts:current.layouts,evidence:scope,currentScope:scope,operationId:crypto.randomUUID(),savedEntryRemaining:8192,
    choices:{collectionId,slotIds:current.snapshot.binders.find(b=>b.collectionId===collectionId)!.slots.map(s=>s.id),releaseItemIds:[],restoreContent:true}})
   assert.equal(plan.request.version,4)
   phase='actual bounded private restore and inverse validation'
   const result=await dispatch('backup.restore.raw',{...plan.request})
   if(result.changed!==true||result.version!==4)throw new Error('unexpected private fixture outcome')
   await flush(db);restored++
  }
  assert.equal(restored+assetExcluded,11)
  console.log(`private archived fixture: ${restored} eligible binders restored, ${assetExcluded} refused by unchanged asset URL policy, ${changed} reviewed copies returned from Unassigned; all rolled back`)
  await db.query('ROLLBACK')
 }catch(error){
  writeFileSync('/Users/cal/.local/share/holofolder/raw-restore-100-local/private-archive-proof-error.log',String(error instanceof Error?error.stack:error),{mode:0o600})
  throw new Error(`private archive proof failed at ${phase}; details retained privately`)
 }finally{await db.query('ROLLBACK');await db.end()}
})

test('100 fixture cleanup preserves all91 original counts and35 digests in both archive-restored databases', {skip:!enabled},async()=>{
 const archive='/Users/cal/.local/share/holofolder/backups/2026-11-10T10-44-05Z-before-native-conversion/'
 const counts=JSON.parse(readFileSync(archive+'source-counts.json','utf8')),digests=JSON.parse(readFileSync(archive+'source-critical-digests.json','utf8'))
 for(const database of ['preserve100','fresh100']){
  const db=await connect(database)
  try{
   await db.query("SET TIME ZONE 'UTC'")
   for(const [name,count] of Object.entries(counts)){
    assert.match(name,/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/)
    const r=(await db.query(`SELECT count(*)::int n${name in digests?",md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) digest":''} FROM ${name} t`)).rows[0]
    assert.equal(r.n,count,name);if(name in digests)assert.equal(r.digest,digests[name],name)
   }
  }finally{await db.end()}
 }
})

