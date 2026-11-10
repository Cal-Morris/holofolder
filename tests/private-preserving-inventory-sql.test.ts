import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isStorageCommandRejection } from '@/lib/collection/storage-command-rejection'
import { normalizeStorageResult } from '@/lib/server/operations/storage-contract'

const socket = process.env.PRIVATE_PATCH_TEST_SOCKET
const owner = '00900000-0000-4000-8000-000000000001', partner = '00900000-0000-4000-8000-000000000002'
const other = '00900000-0000-4000-8000-000000000003', binder = '00900000-0000-4000-8000-000000000011'
const grade = { provider: { kind: 'known', id: 'psa' }, grade: '9', scale: '10', designation: null,
  subgrades: [], certificate: 'synthetic-private-certificate', holder: 'synthetic holder', label: { variant: 'synthetic label', assetIds: ['synthetic-private-asset'] } }
const publicWant = { card_id: 'synthetic-090-card', card_name: 'Synthetic proof', added_at: '2020-01-01T00:00:00Z' }
const want = { ...publicWant, card_image: 'https://example.invalid/synthetic-private-image', wanted_by: [owner] }

test('090 real SQL: original intent replay, private patch and selected want, races, atomic audit, ACLs and recovery gate', { skip: !socket, timeout: 60000 }, async () => {
  const parentSocket = !!socket?.startsWith('/Users/cal/.local/share/holofolder/backups/') && socket.endsWith('/s')
  assert.ok(parentSocket || socket === '/Users/cal/.local/share/holofolder/issue376-parity-090/socket')
  const { Client } = await import('pg')
  assert.match(process.env.PRIVATE_PATCH_TEST_DATABASE ?? '', /^parity090_[a-z0-9_]+$/)
  const config = { host: socket, port: parentSocket ? 55482 : 55590, user: parentSocket ? 'backup_verify' : 'parity_test', database: process.env.PRIVATE_PATCH_TEST_DATABASE ?? 'postgres' }
  const db = new Client(config), concurrent = new Client(config)
  await db.connect(); await concurrent.connect()
  try {
    const metadata = async () => (await db.query(`SELECT n.nspname,c.relname,c.relacl::text,c.relowner,c.relrowsecurity,c.relforcerowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth','storage','collection_audit_private') ORDER BY 1,2`)).rows
    const funcs = async () => (await db.query(`SELECT p.oid::regprocedure::text name,p.proacl::text acl,md5(pg_get_functiondef(p.oid)) digest
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','collection_audit_private') ORDER BY 1`)).rows
    const terminalMode = (await db.query("SELECT to_regprocedure('collection_audit_private.execute_command_v1(text,uuid,uuid,jsonb,jsonb)') IS NOT NULL enabled")).rows[0].enabled
    const terminalReceipts = new Map<string, { actor: string; operation: string; id: string; result: unknown }>()
    const tables = await metadata(), before = await funcs()
    const migration = readFileSync(new URL('../scripts/090_private_preserving_inventory.sql', import.meta.url), 'utf8')
    await db.query(migration); const after = await funcs(); await db.query(migration)
    assert.deepEqual(await funcs(), after); assert.deepEqual(await metadata(), tables)
    assert.deepEqual(after.filter(p => p.name !== 'inventory_command_v1(uuid,uuid,jsonb,jsonb)'), before.filter(p => p.name !== 'inventory_command_v1(uuid,uuid,jsonb,jsonb)'))
    assert.deepEqual(after.map(p => [p.name, p.acl]), before.map(p => [p.name, p.acl]))
    const definition = (await db.query("SELECT pg_get_functiondef('public.inventory_command_v1(uuid,uuid,jsonb,jsonb)'::regprocedure) body")).rows[0].body
    assert.ok(definition.indexOf('RETURN prior.result;') < definition.indexOf('-- private_preserving_intent_090'))
    assert.match(definition, /statement_timeout TO '10s'/)
    for (const role of ['anon', 'authenticated', 'holo_mcp', 'service_role']) {
      assert.equal((await db.query("SELECT has_function_privilege($1,'public.inventory_command_v1(uuid,uuid,jsonb,jsonb)','EXECUTE') allowed", [role])).rows[0].allowed, false)
      assert.equal((await db.query("SELECT has_function_privilege($1,'public.storage_execute_v1(text,uuid,jsonb)','EXECUTE') allowed", [role])).rows[0].allowed, role === 'service_role')
    }
    await db.query('BEGIN')
    await db.query("INSERT INTO auth.users(id,created_at) VALUES($1,'2020-01-01'),($2,'2020-01-01'),($3,'2020-01-01')", [owner, partner, other])
    await db.query('INSERT INTO public.perpetual_licences(owner_user_id,source) VALUES($1,$2)', [owner, 'manual'])
    await db.query('INSERT INTO public.partnerships(user1_id,user2_id,owner_user_id) VALUES($1,$2,$1)', [owner, partner])
    await db.query("INSERT INTO public.binders(id,owner_user_id,name,is_default) VALUES($1,$2,'Synthetic 090',true)", [binder, owner])
    await db.query('INSERT INTO public.inventory_owner_state(owner_user_id) VALUES($1)', [owner])
    await db.query("INSERT INTO public.storage_collection_state(collection_id,owner_user_id,authority) VALUES($1,$2,'slots')", [binder, owner])
    await db.query("INSERT INTO public.tcg_series(id) VALUES('synthetic-090-series')")
    await db.query("INSERT INTO public.tcg_sets(id,series_id) VALUES('synthetic-090-set','synthetic-090-series')")
    await db.query("INSERT INTO public.tcg_cards(id,series_id,set_id,local_id) VALUES('synthetic-090-card','synthetic-090-series','synthetic-090-set','1')")
    await db.query("INSERT INTO public.inventory_items(id,owner_user_id,identity,grading,legacy_source,acquired_at) VALUES('synthetic-090-copy',$1,'{\"kind\":\"card\",\"cardId\":\"synthetic-090-card\"}',$2,'{\"syntheticImmutable\":true}','2020-01-01')", [owner, grade])
    await db.query("INSERT INTO public.binder_slots(id,owner_user_id,collection_id,position,wanted_cards) VALUES('synthetic-090-slot',$1,$2,0,$3)", [owner, binder, JSON.stringify([want, { ...want, wanted_by: [partner] }])])
    await db.query('COMMIT')
    const revisions = async () => (await db.query(`SELECT i.inventory_revision::int "inventoryRevision",s.version::int version,s.layout_revision::int "layoutRevision"
      FROM public.inventory_owner_state i JOIN public.storage_collection_state s USING(owner_user_id) WHERE s.collection_id=$1`, [binder])).rows[0]
    const item = async () => (await db.query("SELECT version::int,grading FROM public.inventory_items WHERE id='synthetic-090-copy'")).rows[0]
    const ref = async () => {
      const row = (await db.query(`SELECT s.version::int,p.inventory_item_id,i.version::int item_version,p.version::int placement_version
        FROM public.binder_slots s LEFT JOIN public.inventory_placements p ON p.slot_id=s.id LEFT JOIN public.inventory_items i ON i.id=p.inventory_item_id WHERE s.id='synthetic-090-slot'`)).rows[0]
      return { collectionId: binder, slot: { id: 'synthetic-090-slot', version: row.version, inventoryItemId: row.inventory_item_id, itemVersion: row.item_version, placementVersion: row.placement_version } }
    }
    const request = async (commands: unknown[], operationId: string) => { const r = await revisions(); return { operationId, inventoryRevision: r.inventoryRevision,
      collections: [{ collectionId: binder, version: r.version, layoutRevision: r.layoutRevision }], commands } }
    const patch = async (value: object) => ({ kind: 'patchGrading', item: { itemId: 'synthetic-090-copy', itemVersion: (await item()).version, placement: (await ref()).slot.inventoryItemId ? await ref() : null }, patch: value })
    const header = async (client: typeof db, operationId: string, actor = partner, source = 'rest') => {
      await client.query("SELECT set_config('request.headers',$1,true),set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)", [JSON.stringify({ 'x-holo-audit-context': JSON.stringify({ actor: { kind: 'user', userId: actor }, source, clientId: 'synthetic-090-key', operationId, batchId: operationId, clientOccurredAt: null }) })])
      await client.query('SET LOCAL ROLE service_role')
    }
    const run = async (input: { operationId: string; commands?: unknown[] }, actor = partner, target = owner, client = db, operation = 'inventory') => {
      await client.query('BEGIN')
      try {
        await header(client, input.operationId, actor)
        const result = (await client.query('SELECT public.storage_execute_v1($1,$2,$3) r', [operation, target, input])).rows[0].r
        await client.query('COMMIT')
        if (isStorageCommandRejection(result, input.operationId)) {
          assert.equal(terminalMode, true)
          const ledgerOperation = operation === 'slots' ? 'binder_slots_v1' : 'inventory_v1'
          const saved = (await client.query('SELECT result FROM public.developer_idempotency WHERE actor_id=$1 AND operation=$2 AND request_key=$3', [actor, ledgerOperation, input.operationId])).rows
          assert.equal(saved.length, 1); assert.deepEqual(saved[0].result, result)
          terminalReceipts.set(`${actor}:${ledgerOperation}:${input.operationId}`, { actor, operation: ledgerOperation, id: input.operationId, result })
          // The fixture's conflict assertions work in both modes. In089 mode this
          // error is raised only AFTER the actual terminal receipt committed and
          // its exact lifetime ledger row was verified, never instead of SQL proof.
          throw new Error(result.code)
        }
        return result
      } catch (e) { await client.query('ROLLBACK'); throw e }
    }
    const state = async () => (await db.query(`SELECT
      (SELECT jsonb_agg(to_jsonb(t)) FROM public.inventory_items t WHERE owner_user_id=$1) items,
      (SELECT jsonb_agg(to_jsonb(t)) FROM public.binder_slots t WHERE owner_user_id=$1) slots,
      (SELECT jsonb_agg(to_jsonb(t)) FROM public.inventory_placements t WHERE owner_user_id=$1) placements,
      (SELECT count(*)::int FROM public.collection_activity WHERE owner_user_id=$1) events,
      (SELECT count(*)::int FROM public.developer_idempotency WHERE actor_id IN ($1,$2) AND result->>'outcome' IS DISTINCT FROM 'rejected') ledger,
      (SELECT inventory_revision::int FROM public.inventory_owner_state WHERE owner_user_id=$1) revision`, [owner, partner])).rows[0]
    const original = await request([await patch({ grade: '10', holder: null })], 'synthetic-090-original')
    const receipt = await run(original)
    assert.deepEqual(normalizeStorageResult('inventory', receipt), receipt)
    assert.equal(JSON.stringify(receipt).includes('certificate'), false)
    assert.deepEqual((await item()).grading, { ...grade, grade: '10', holder: null })
    const later = await request([await patch({ designation: 'Later partner edit' })], 'synthetic-090-later')
    await run(later, owner)
    const committed = await state()
    assert.deepEqual(await run(original), receipt, 'lost reply after commit then later edit returns original receipt')
    assert.deepEqual(await state(), committed, 'replay writes no metadata, ledger or history')
    await assert.rejects(run({ ...original, commands: [{ ...original.commands[0] as object, patch: { grade: '8' } }] }), /idempotency_conflict/)
    await assert.rejects(run(original, owner), /inventory_revision_conflict/)
    await assert.rejects(run(original, partner, other), /access_denied/)
    await assert.rejects(run(original, other), /access_denied/)
    assert.deepEqual(await state(), committed)
    await db.query('BEGIN'); await header(db, original.operationId, partner, 'mcp')
    await assert.rejects(db.query('SELECT public.storage_execute_v1($1,$2,$3)', ['inventory', owner, original]), /idempotency_conflict/)
    await db.query('ROLLBACK'); assert.deepEqual(await state(), committed)
    // Two genuine transactions compete on the same immutable original preconditions.
    const raceA = await request([await patch({ scale: null })], 'synthetic-090-race-a')
    const raceB = { ...raceA, operationId: 'synthetic-090-race-b' }
    const race = await Promise.allSettled([run(raceA), run(raceB, partner, owner, concurrent)])
    assert.equal(race.filter(r => r.status === 'fulfilled').length, 1)
    assert.match(String((race.find(r => r.status === 'rejected') as PromiseRejectedResult).reason), /inventory_revision_conflict/)
    assert.equal((await item()).grading.certificate, grade.certificate)
    assert.deepEqual((await item()).grading.label, grade.label)
    const dest = await ref()
    const fulfill = await request([{ kind: 'assign', selection: { kind: 'existing', inventoryItemId: 'synthetic-090-copy', itemVersion: (await item()).version },
      destination: dest, occupied: 'cancel', fulfillWant: { index: 1, expectedPublic: publicWant } }], 'synthetic-090-fulfill')
    const fulfilled = await run(fulfill)
    assert.deepEqual((await state()).slots[0].wanted_cards, [want], 'only exact second duplicate consumed, first private entry unchanged')
    const final = await state(); assert.deepEqual(await run(fulfill), fulfilled); assert.deepEqual(await state(), final)
    // Later want edit and placement change each invalidate stale original preconditions.
    const stale = await request([await patch({ grade: '8' })], 'synthetic-090-stale-place')
    const unassign = await request([{ kind: 'unassign', item: (stale.commands[0] as { item: unknown }).item }], 'synthetic-090-unassign')
    await run(unassign)
    await assert.rejects(run(stale), /inventory_revision_conflict/)
    assert.deepEqual(await run(fulfill), fulfilled, 'fulfillment replay after unassign cannot place the copy again')
    const wrongWant = await request([{ kind: 'assign', selection: { kind: 'existing', inventoryItemId: 'synthetic-090-copy', itemVersion: (await item()).version },
      destination: await ref(), occupied: 'cancel', fulfillWant: { index: 0, expectedPublic: { ...publicWant, card_name: 'Wrong public precondition' } } }], 'synthetic-090-wrong-want')
    const beforeWrongWant = await state(); await assert.rejects(run(wrongWant), /inventory_want_conflict/); assert.deepEqual(await state(), beforeWrongWant)
    const current = await revisions(), wantDest = await ref()
    const competingFulfill = await request([{ kind: 'assign', selection: { kind: 'existing', inventoryItemId: 'synthetic-090-copy', itemVersion: (await item()).version },
      destination: wantDest, occupied: 'cancel', fulfillWant: { index: 0, expectedPublic: publicWant } }], 'synthetic-090-want-race')
    const wantEdit = { collectionId: binder, operationId: 'synthetic-090-want-edit-race', inventoryRevision: current.inventoryRevision,
      collectionVersion: current.version, layoutRevision: current.layoutRevision, commands: [{ kind: 'update', slot: wantDest.slot,
        wantedCards: [want, { ...want, card_name: 'Synthetic concurrent added want' }] }] }
    const wantRace = await Promise.allSettled([run(competingFulfill), run(wantEdit, partner, owner, concurrent, 'slots')])
    assert.equal(wantRace.filter(r => r.status === 'fulfilled').length, 1)
    assert.match(String((wantRace.find(r => r.status === 'rejected') as PromiseRejectedResult).reason), /revision_conflict/)
    const afterWantRace = await state()
    assert.equal(afterWantRace.slots[0].wanted_cards.length, wantRace[0].status === 'fulfilled' ? 0 : 2)
    assert.deepEqual(afterWantRace.items[0].legacy_source, { syntheticImmutable: true })
    assert.equal(new Date(afterWantRace.items[0].acquired_at).toISOString(), '2020-01-01T00:00:00.000Z')
    if (!(await ref()).slot.inventoryItemId) {
      await run(await request([{ kind: 'assign', selection: { kind: 'existing', inventoryItemId: 'synthetic-090-copy', itemVersion: (await item()).version },
        destination: await ref(), occupied: 'cancel', fulfillWant: null }], 'synthetic-090-placement-setup'))
    }
    const gradeRace = await request([await patch({ designation: 'Synthetic placement race' })], 'synthetic-090-grade-place-race')
    const placeRace = await request([{ kind: 'unassign', item: (gradeRace.commands[0] as { item: unknown }).item }], 'synthetic-090-place-grade-race')
    const placementRace = await Promise.allSettled([run(gradeRace), run(placeRace, partner, owner, concurrent)])
    assert.equal(placementRace.filter(r => r.status === 'fulfilled').length, 1)
    assert.match(String((placementRace.find(r => r.status === 'rejected') as PromiseRejectedResult).reason), /inventory_revision_conflict/)
    const invalid = await request([await patch({ certificate: null })], 'synthetic-090-private-rejected')
    const unchanged = await state(); await assert.rejects(run(invalid), /grading_patch/); assert.deepEqual(await state(), unchanged)
    const rollback = await request([await patch({ grade: '8' }), { kind: 'unassign', item: { itemId: 'synthetic-missing', itemVersion: 0, placement: null } }], 'synthetic-090-rollback')
    await assert.rejects(run(rollback), /item_conflict/); assert.deepEqual(await state(), unchanged)
    // Audit failure aborts at COMMIT too, including the original-intent ledger.
    const failed = await request([await patch({ grade: '8' })], 'synthetic-090-audit-fail')
    await db.query('BEGIN')
    await db.query("CREATE OR REPLACE FUNCTION collection_audit_private.flush() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic_090_audit_failure'; END $$")
    await header(db, 'synthetic-090-audit-fail')
    await db.query('SELECT public.storage_execute_v1($1,$2,$3)', ['inventory', owner, failed])
    await assert.rejects(db.query('COMMIT'), /synthetic_090_audit_failure/); await db.query('ROLLBACK')
    assert.deepEqual(await state(), unchanged)
    // Paid access is checked before receipt replay, regardless of app trial state.
    await db.query('BEGIN; DELETE FROM public.perpetual_licences WHERE owner_user_id=\'' + owner + "'")
    await header(db, original.operationId, owner)
    await assert.rejects(db.query('SELECT public.storage_execute_v1($1,$2,$3)', ['inventory', owner, original]), /premium_required/)
    await db.query('ROLLBACK'); assert.deepEqual(await state(), unchanged)
    const over = await request([await patch({ grade: '8' }), { kind: 'add', itemId: 'synthetic-090-over-limit', identity: { kind: 'pokemon', pokemonId: 1 }, grading: null, acquiredAt: null }], 'synthetic-090-billing-rollback')
    await db.query('BEGIN')
    await db.query('DELETE FROM public.perpetual_licences WHERE owner_user_id=$1', [owner])
    await db.query('UPDATE public.billing_configuration SET enforced=true,free_card_limit=10')
    await db.query(`INSERT INTO public.inventory_items(id,owner_user_id,identity)
      SELECT 'synthetic-090-cap-'||n,$1,'{"kind":"pokemon","pokemonId":1}' FROM generate_series(1,10) n`, [owner])
    await header(db, over.operationId, owner, 'app')
    await assert.rejects(db.query('SELECT public.storage_execute_v1($1,$2,$3)', ['inventory', owner, over]), /card_limit_reached/)
    await db.query('ROLLBACK'); assert.deepEqual(await state(), unchanged)
    await db.query('BEGIN'); await db.query('DELETE FROM public.partnerships WHERE owner_user_id=$1', [owner]); await header(db, original.operationId)
    await assert.rejects(db.query('SELECT public.storage_execute_v1($1,$2,$3)', ['inventory', owner, original]), /access_denied/)
    await db.query('ROLLBACK'); assert.deepEqual(await state(), unchanged)
    for (const actor of [owner, partner, other]) {
      await db.query('BEGIN')
      await db.query("SELECT set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role: 'authenticated', sub: actor })])
      await db.query('SET LOCAL ROLE authenticated')
      const visible = (await db.query("SELECT grading FROM public.inventory_items WHERE id='synthetic-090-copy'")).rows
      assert.equal(visible.length, actor === other ? 0 : 1)
      if (visible[0]) assert.equal(visible[0].grading.certificate, grade.certificate)
      await assert.rejects(db.query("UPDATE public.inventory_items SET grading=NULL WHERE id='synthetic-090-copy'"), /permission denied/)
      await db.query('ROLLBACK')
    }
    assert.deepEqual(await state(), unchanged)
    const event = (await db.query('SELECT id FROM public.collection_activity WHERE owner_user_id=$1 AND operation_id=$2', [owner, original.operationId])).rows[0]
    assert.ok(event)
    const audit = (await db.query('SELECT actor_user_id,source FROM public.collection_activity WHERE id=$1', [event.id])).rows[0]
    assert.equal(audit.actor_user_id, partner); assert.equal(audit.source, 'rest')
    await db.query('BEGIN'); await header(db, 'synthetic-090-preview')
    const preview = (await db.query('SELECT public.storage_execute_v1($1,$2,$3) r', ['recovery.preview', owner, { eventId: String(event.id), restoreUnassignedItemIds: [] }])).rows[0].r
    assert.equal(preview.supported, false)
    assert.ok(preview.unsupported.includes('private_assets_unverifiable'), 'existing private-asset recovery gate remains explicit')
    await db.query('ROLLBACK')
    // State comparisons above include accepted receipts. Check every committed
    // terminal receipt separately so rejected rows are neither hidden nor lost.
    const terminalRows = (await db.query("SELECT actor_id::text actor,operation,request_key id,result FROM public.developer_idempotency WHERE actor_id IN ($1,$2) AND result->>'outcome'='rejected' ORDER BY actor_id,operation,request_key", [owner, partner])).rows
    const expectedTerminal = [...terminalReceipts.values()].sort((a, b) => `${a.actor}:${a.operation}:${a.id}`.localeCompare(`${b.actor}:${b.operation}:${b.id}`))
    assert.deepEqual(terminalRows, expectedTerminal)
    assert.equal(terminalRows.length > 0, terminalMode)
  } finally { await db.query('ROLLBACK'); await concurrent.end(); await db.end() }
})
