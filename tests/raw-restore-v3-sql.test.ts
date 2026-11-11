import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Client } from 'pg'
import { rawRestoreFixture, rawOwner as owner, rawPartner as partner, rawCollection as collection } from './fixtures/raw-restore'
import { planRawContentRestore  } from '@/lib/raw-restore-plan'
import { normalizeStorageResult } from '@/lib/server/operations/storage-contract'
import type { RawRestoreCommand } from '@/lib/domain/raw-restore'

const enabled = process.env.RAW_RESTORE_V3_TEST_SOCKET
const config = { host: '/Users/cal/.local/share/holofolder/raw-restore-097-local/s', port: 55597, user: 'restore097', database: 'preserve097' }
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
  const command = planRawContentRestore(f.input).request
  if (command.version !== 2) throw new Error('fixture')
  return { ...command, version: 3 as const, slotOrder: { before: command.slots.map(p=>p.before.id), after: command.slots.map(p=>p.after.id).reverse() } }
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
    acquiredAt: r.acquired_at?.toISOString() ?? null, version: Number(r.version) }))
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

test('097 genuine083 1025 copied Dex, supported raw population, actual complete export, disjoint retained-ID restore and generated inverse', { skip: !enabled, timeout: 300000 }, async () => {
  const db = await connect('holofolder_fresh_raw097')
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
    const preMove = await complete(db)
    await send(db, { operationId: 'synthetic-097-real-reorder', collectionId: collection, inventoryRevision: preMove.snapshot.inventoryRevision,
      collectionVersion: preMove.snapshot.collections[0].version, layoutRevision: preMove.snapshot.binders[0].layoutRevision,
      commands: [{ kind: 'move', slots: [beforeRef(preMove.snapshot, slotIds[0])], beforeSlotId: null }] }, partner, 'app', null, 'slots')
    await flush(db); await db.query('COMMIT'); await db.query('BEGIN')
    const current = await complete(db), original = (await db.query('SELECT * FROM public.inventory_items WHERE owner_user_id=$1 ORDER BY id',[owner])).rows, f = await rawRestoreFixture()
    const request = planRawContentRestore({ ...f.input, text, current: current.snapshot, layouts: current.layouts, savedEntryRemaining: 8192,
      operationId: 'synthetic-dex-restore-v3', choices: { collectionId: collection, slotIds: current.snapshot.binders[0].slots.map(s=>s.id), releaseItemIds: slotIds.map((_,n) => `synthetic-b-${n}`).sort(), restoreContent: true } }).request
    assert.equal(request.version,3); assert.equal(request.slots.length,1025); assert.equal(request.items.length,2050)
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
    assert.deepEqual(recovered.snapshot.binders[0].slots.map(s=>s.id),current.snapshot.binders[0].slots.map(s=>s.id))
    assert.equal(recovered.snapshot.binders[0].layoutRevision,current.snapshot.binders[0].layoutRevision+2)
    assert.deepEqual(recovered.snapshot.placements.map(p=>[p.inventoryItemId,p.slotId]),current.snapshot.placements.map(p=>[p.inventoryItemId,p.slotId]))
    assert.deepEqual(await send(db,request),receipt,'lifetime replay after inverse precedes reconstruction')
    const bad={...request,version:999};assert.throws(()=>parseRawRestoreCommand(bad));await fails(db,()=>send(db,bad),'22023')
    console.log(JSON.stringify({synthetic:true,slots:1025,refs:2050,wants:1025,commandBytes:Buffer.byteLength(JSON.stringify(request)),auditEntities:event.recovery_state.length,auditBytes:Buffer.byteLength(JSON.stringify(event.recovery_state)),applyMs,deferredMs,previewMs,inverseMs,commitMs}))
  } finally { await db.query('ROLLBACK');await db.end() }
})

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
  const graph=r.slots.map(p=>{const before=slots.find(s=>s.id===p.before.id);return {table:'binder_slots',id:before.id,before,after:{...before,target:p.after.target,status:p.after.status,wanted_cards:p.after.wantedCards,position:r.version===3?r.slotOrder.after.indexOf(before.id):before.position,version:before.version+1}}})
  for(const ref of r.items){const before=placements.find(p=>p.inventory_item_id===ref.itemId)??null,slot=r.slots.find(p=>p.after.inventoryItemId===ref.itemId)
    graph.push({table:'inventory_placements',id:ref.itemId,before,after:slot?{inventory_item_id:ref.itemId,owner_user_id:owner,collection_id:collection,slot_id:slot.after.id,version:before?before.version+1:0}:null})}
  const root=roots.find(v=>v.collection_id===collection),o=owners[0]
  graph.push({table:'storage_collection_state',id:collection,before:root,after:{...root,version:root.version+1,layout_revision:root.layout_revision+(r.version===3?1:0)}},
    {table:'inventory_owner_state',id:owner,before:o,after:{...o,inventory_revision:o.inventory_revision+1}})
  const {rawRestoreV2JsonbBytes}=await import('@/lib/domain/raw-restore')
  return rawRestoreV2JsonbBytes(graph)
}

// Run after genuine083 in this same suite. Every seed and COMMIT is disposable synthetic data.
test('097 populated-history maximum combined command, before/after wants and duplicated-manifest graphs commit and recover', {skip:!enabled,timeout:180000},async()=>{
  const db=await connect('holofolder_fresh_raw097'),runId=crypto.randomUUID()
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
      for(const slot of desired.binders[0].slots){
        const n=Number(slot.id.replace('synthetic-dex-',''))
        slot.inventoryItemId='synthetic-'+desiredGroup+'-'+n
        const count=Math.min(remaining,100);remaining-=count
        slot.wantedCards=Array.from({length:count},()=>({card_id:'synthetic-dex-trainer',card_name:'Synthetic edge want',added_at:'2020-01-01',wanted_by:[owner,partner]}))
      }
      desired.placements=desired.binders[0].slots.map(s=>({inventoryItemId:s.inventoryItemId!,collectionId:collection,slotId:s.id,version:0}))
      desired.binders[0].slots.reverse()
      const backup=createBinderBackupV2({snapshot:desired,completeness:'complete-owner',scope:'collection',collectionId:collection,layouts:current.layouts,partnerUserId:partner})
      const request=structuredClone(planRawContentRestore({...f.input,text:JSON.stringify(backup),current:current.snapshot,layouts:current.layouts,savedEntryRemaining:8192,
        operationId:'synthetic-populated-'+edge+'-'+runId,choices:{collectionId:collection,slotIds:current.snapshot.binders[0].slots.map(s=>s.id),releaseItemIds:current.snapshot.placements.map(p=>p.inventoryItemId).sort(),restoreContent:true}}).request)
      const refresh=async()=>{
        current=await complete(db);request.inventoryRevision=current.snapshot.inventoryRevision;request.collection.version=current.snapshot.collections[0].version
        for(const p of request.slots)p.before=beforeRef(current.snapshot,p.before.id)
        for(const ref of request.items)if(ref.placement)ref.placement.slot=beforeRef(current.snapshot,ref.placement.slot.id)
      }
      const pad=(bytes:number)=>'猫'.repeat(Math.floor(bytes/3))+'a'.repeat(bytes%3)
      if(edge==='duplicated-manifest2.5MiB' && request.version===3){
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
          const slot=current.snapshot.binders[0].slots.find(s=>s.id==='synthetic-dex-1000')!,wants=structuredClone(slot.wantedCards)
          const name=wants[0].card_name
          wants[0].card_name=delta>=0?name+'a'.repeat(delta):name.slice(0,name.length+delta)
          await db.query('UPDATE public.binder_slots SET wanted_cards=$1,version=version+1 WHERE id=$2',[JSON.stringify(wants),slot.id]);await flush(db);await refresh()
        }
        assert.equal(await prospectiveBytes(db,request),limits.graphBytes)
      }
      assert.equal(request.items.length,2050);assert.equal(2*request.slots.length+request.items.length+desiredCount,4100+desiredCount)
      parseRawRestoreCommand(request)
      if(edge==='command1.75MiB-graph2.5MiB')assert.equal(rawRestoreV2JsonbBytes(request),limits.bytes)
      if(edge==='command1.75MiB-graph2.5MiB'){
        const over=structuredClone(request);over.slots[0].after.wantedCards[0].card_name+='a'
        assert.throws(()=>parseRawRestoreCommand(over));const prior=await stateDigest(db)
        await fails(db,()=>send(db,over),'22023');assert.deepEqual(await stateDigest(db),prior)
      }
      const expectedBytes=await prospectiveBytes(db,request)
      assert.ok(rawRestoreV2GraphBytes(current.snapshot,{...desired.binders[0],slots:desired.binders[0].slots.map(s=>({...s,wantedCards:request.slots.find(p=>p.after.id===s.id)!.after.wantedCards}))})>=expectedBytes)
      const historyBefore=Number((await db.query('SELECT count(*)::int n FROM public.collection_activity WHERE owner_user_id=$1',[owner])).rows[0].n)
      assert.ok(historyBefore>500)
      // Above-limit current state must refuse before writes, without even a terminal ledger row.
      if(edge!=='work8192'){
        await db.query('SAVEPOINT oversized_before')
        await db.query("UPDATE public.binder_slots SET wanted_cards=jsonb_set(wanted_cards,'{0,card_name}',to_jsonb((wanted_cards->0->>'card_name')||'a')) WHERE id=$1",[current.snapshot.binders[0].slots.find(s=>s.id==='synthetic-dex-1000')!.id]);await flush(db)
        const before=await stateDigest(db);await fails(db,()=>send(db,request),'22023');assert.deepEqual(await stateDigest(db),before)
        await db.query('ROLLBACK TO SAVEPOINT oversized_before; RESET ROLE')
      }
      if(edge==='work8192'){
        const workOver=structuredClone(request)
        workOver.slots.find(s=>s.after.wantedCards.length<100)!.after.wantedCards.push({card_id:'synthetic-dex-trainer',card_name:'Synthetic extra want',added_at:'2020-01-01'})
        assert.throws(()=>parseRawRestoreCommand(workOver))
        const prior=await stateDigest(db);await fails(db,()=>send(db,workOver),'22023');assert.deepEqual(await stateDigest(db),prior)
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

test('097 failed actual COMMIT loses provisional accepted/rejected rows, retry is not a false noncommit proof', { skip: !enabled }, async () => {
  const db = await connect()
  try {
    await db.query('BEGIN'); await seed(db); await db.query('ROLLBACK')
    // Use the fresh synthetic DB for committed seeds, never persist fixtures into the private restore.
  } finally { await db.end() }
  const fresh = await connect('holofolder_fresh_raw097')
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
test('097 concurrent delivery serializes once; edit-first rejects and unlink-first denies before replay', { skip: !enabled }, async () => {
  const a = await connect('holofolder_fresh_raw097'), b = await connect('holofolder_fresh_raw097'), observer = await connect('holofolder_fresh_raw097')
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




test('097 twice preserves original90 counts35 digests, ACLs, inactive096 and protected compiled definitions', { skip: !enabled }, async () => {
  const db = await connect(), baseline = await connect('preserve097baseline')
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
    const sql = readFileSync(new URL('../scripts/097_raw_content_restore_v3.sql', import.meta.url), 'utf8')
    await db.query(sql); await db.query(sql); assert.deepEqual(await functions(db), installed)
    assert.equal((await db.query('SELECT enforced FROM collection_audit_private.legacy_write_fence')).rows[0].enforced, false)
    for (const role of ['anon', 'authenticated', 'holo_mcp', 'service_role']) {
      assert.equal((await db.query("SELECT has_function_privilege($1,'collection_audit_private.restore_raw_content_v3(uuid,uuid,jsonb,jsonb)','EXECUTE') ok", [role])).rows[0].ok, false)
    }
    const archive = '/Users/cal/.local/share/holofolder/backups/2026-11-10T08-01-40Z-before-096/'
    const counts = JSON.parse(readFileSync(archive + 'source-counts.json', 'utf8')), digests = JSON.parse(readFileSync(archive + 'source-critical-digests.json', 'utf8'))
    assert.equal(Object.keys(counts).length, 90); assert.equal(Object.keys(digests).length, 35)
    await db.query("SET TIME ZONE 'UTC'")
    for (const [name, count] of Object.entries(counts)) {
      assert.match(name, /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/)
      const r = (await db.query(`SELECT count(*)::int n${name in digests ? ",md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) digest" : ''} FROM ${name} t`)).rows[0]
      assert.equal(r.n, count, name); if (name in digests) assert.equal(r.digest, digests[name], name)
    }
  } finally { await db.end(); await baseline.end() }
})
test('097 malformed permutations, version collisions, layout overflow and origin drift cannot mutate', { skip: !enabled }, async () => {
  const db = await connect()
  try {
    await db.query('BEGIN'); const r = await seed(db)
    for (const slotOrder of [ { ...r.slotOrder, after: r.slotOrder.before }, { ...r.slotOrder, after: ['slot-a','slot-a'] },
      { ...r.slotOrder, after: ['slot-a'] }, { ...r.slotOrder, after: ['slot-a','unknown-slot'] }, { ...r.slotOrder, before: r.slotOrder.after } ]) {
      const before = await state(db); await fails(db, () => send(db, { ...r, slotOrder }), '22023'); assert.deepEqual(await state(db), before)
    }
    await db.query('SAVEPOINT overflow')
    await db.query('UPDATE public.storage_collection_state SET layout_revision=9007199254740991 WHERE collection_id=$1',[collection])
    const overflow={...r,collection:{...r.collection,layoutRevision:9007199254740991}}
    const overflowState=await state(db);await fails(db,()=>send(db,overflow),'22023');assert.deepEqual(await state(db),overflowState)
    await db.query('ROLLBACK TO SAVEPOINT overflow')
    const drift=structuredClone(r);drift.operationId='synthetic-097-origin-drift'
    drift.slots[0].after.presetOrigin={source:{id:'synthetic-source',version:'1'},entryId:'invented'}
    const denied=await send(db,drift);assert.equal(denied.code,'raw_restore_content_conflict')
    assert.equal((await state(db)).root.inventory_revision,8)
    assert.equal((await db.query('SELECT count(*)::int n FROM public.collection_activity WHERE operation_id=$1',[drift.operationId])).rows[0].n,0)
    const { slotOrder: _order, ...v2 } = r
    const old = { ...v2, version: 2 as const }
    await db.query('SAVEPOINT old_v1')
    const { manifest: _manifest, ...v1body }=old
    const v1={...v1body,version:1 as const}
    const v1receipt=await send(db,v1);assert.equal(v1receipt.version,undefined)
    assert.deepEqual(await send(db,v1),v1receipt);await fails(db,()=>send(db,r),'40001')
    const v1rejected={...v1,operationId:'synthetic-v1-terminal-097',inventoryRevision:0}
    const v1proof=await send(db,v1rejected);assert.equal(v1proof.version,undefined)
    assert.deepEqual(await send(db,v1rejected),v1proof)
    await fails(db,()=>send(db,{...r,operationId:v1rejected.operationId}),'40001')
    await db.query('ROLLBACK TO SAVEPOINT old_v1')
    const accepted = await send(db, old); assert.equal(normalizeStorageResult('backup.restore.raw', accepted).version, 2)
    await fails(db, () => send(db, r), '40001')
    const rejected = { ...r, operationId: 'synthetic-097-terminal', inventoryRevision: 0 }
    const terminal = await send(db, rejected); assert.equal(terminal.version, 3); assert.equal(terminal.outcome, 'rejected')
    await fails(db, () => send(db, { ...old, operationId: rejected.operationId }), '40001')
    assert.deepEqual(await send(db, rejected), terminal)
  } finally { await db.query('ROLLBACK'); await db.end() }
})

test('pre097 server refuses v3 without proof or mutation and bounded EXPLAIN rolls back', { skip: !enabled }, async () => {
  const old = await connect('preserve097baseline'), db = await connect()
  try {
    await old.query('BEGIN'); const request = await seed(old), original = await state(old)
    await fails(old, () => send(old, request), '22023'); assert.deepEqual(await state(old), original)
    await db.query('BEGIN'); const r = await seed(db)
    await db.query('SAVEPOINT explanation')
    // Establish the real service-only bridge context, then roll its first execution back.
    await send(db, r); await db.query('ROLLBACK TO SAVEPOINT explanation')
    await db.query("SELECT set_config('request.headers',$1,true),set_config('request.jwt.claims',$2,true)", [JSON.stringify({ 'x-holo-audit-context': JSON.stringify({ actor: { kind: 'user', userId: partner }, source: 'app', clientId: null, operationId: r.operationId, batchId: r.operationId, clientOccurredAt: null }) }), JSON.stringify({ role: 'service_role' })])
    await db.query('SET LOCAL ROLE service_role')
    const plan = await db.query('EXPLAIN (ANALYZE,BUFFERS) SELECT public.storage_execute_v1($1,$2,$3)', ['backup.restore.raw', owner, r])
    assert.ok(plan.rows.some(row => String(row['QUERY PLAN']).includes('Execution Time:')))
    await db.query('ROLLBACK')
    console.log('synthetic bounded v3 EXPLAIN ANALYZE rolled back; pre097 v3 refuses without terminal proof')
  } finally { await old.query('ROLLBACK'); await db.query('ROLLBACK'); await old.end(); await db.end() }
})
