import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planRawContentRestore } from '@/lib/raw-restore-plan'
import { parseRawRestoreCommand } from '@/lib/domain/raw-restore'
import { rawRestoreFixture } from './fixtures/raw-restore'

test('raw restore requires a live complete read, exact current session and explicit whole-collection choices', async () => {
  const f = await rawRestoreFixture()
  const plan = planRawContentRestore(f.input)
  assert.equal(plan.request.inventoryRevision, 8)
  assert.equal(plan.request.collection.version, 2)
  assert.deepEqual(plan.request.releaseItemIds, ['copy-b'])
  assert.deepEqual(plan.request.slots.map(s => s.after.inventoryItemId), ['copy-a', null])
  assert.deepEqual(plan.placements, [{ itemId: 'copy-a', from: 'slot-b', to: 'slot-a' }, { itemId: 'copy-b', from: 'slot-a', to: null }])
  assert.ok(Object.isFrozen(plan.request.slots[0].after))
  assert.deepEqual(parseRawRestoreCommand(plan.request), plan.request)
  for (const patch of [
    { current: structuredClone(f.input.current) }, { choices: { ...f.input.choices, slotIds: ['slot-a'] } },
    { choices: { ...f.input.choices, releaseItemIds: [] } }, { currentScope: { ...f.input.currentScope, authSessionId: 'other-session' } },
    { evidence: { ...f.input.evidence, partnerUserId: undefined } },
  ]) assert.throws(() => planRawContentRestore({ ...f.input, ...patch } as typeof f.input))
})

test('raw restore rejects lossy subsets, other placements, missing/graded/changed copies, configuration and budgets', async () => {
  const f = await rawRestoreFixture()
  const backup = JSON.parse(f.input.text)
  for (const patch of [
    { scope: 'all-inventory' }, { appearance: [{}] }, { layouts: [{ ...backup.layouts[0], rows: 4 }] },
    { items: backup.items.map((i: object) => ({ ...i, acquiredAt: '2020-01-02T00:00:00Z' })) },
    { binders: backup.binders.map((b: { slots: object[] }) => ({ ...b, slots: b.slots.slice(1) })) },
    { collections: backup.collections.map((c: object) => ({ ...c, name: 'Other name' })) },
  ]) assert.throws(() => planRawContentRestore({ ...f.input, text: JSON.stringify({ ...backup, ...patch }) }))
  const absent = structuredClone(f.snapshot); absent.items = absent.items.filter(i => i.id !== 'copy-a'); absent.placements = absent.placements.filter(p => p.inventoryItemId !== 'copy-a'); absent.binders[0].slots[1].inventoryItemId = null; absent.binders[0].slots[1].status = null
  const branded = await f.brand(absent)
  assert.throws(() => planRawContentRestore({ ...f.input, current: branded }))
  assert.throws(() => parseRawRestoreCommand({ ...planRawContentRestore(f.input).request, addedItemIds: [] }))
  assert.throws(() => planRawContentRestore({ ...f.input, savedEntryRemaining: -1 }))
})

test('raw restore app confirmation, original retry, session fence and terminal response use the shared gateway', async () => {
  const { execFileSync } = await import('node:child_process')
  execFileSync(process.execPath, [new URL('./fixtures/raw-restore-consumer.ts', import.meta.url).pathname], { stdio: 'pipe' })
})

test('raw restore maps explicit current wanted people and preserves separate identical physical IDs', async () => {
  const f = await rawRestoreFixture(), backup = JSON.parse(f.input.text)
  backup.binders[0].slots[1].wantedCards = [{ card_id: 'synthetic-raw-trainer', card_name: 'Synthetic Trainer', added_at: '2020-01-01', wantedRoles: ['partner'] }]
  const plan = planRawContentRestore({ ...f.input, text: JSON.stringify(backup) })
  assert.deepEqual(plan.request.slots[1].after.wantedCards[0].wanted_by, [f.input.evidence.partnerUserId])
  assert.deepEqual(plan.request.items.map(i => i.itemId), ['copy-a', 'copy-b'])
  assert.throws(() => planRawContentRestore({ ...f.input, text: JSON.stringify(backup), savedEntryRemaining: 0 }))
})


test('raw restore preserves the unchanged empty Blank manifest used by native creation', async () => {
  const f = await rawRestoreFixture(true)
  const plan = planRawContentRestore(f.input)
  assert.deepEqual(plan.request.slots.map(s => s.after.inventoryItemId), ['copy-a', null])
  const backup = JSON.parse(f.input.text)
  backup.binders[0].presetManifest.source.version = '2'
  assert.throws(() => planRawContentRestore({ ...f.input, text: JSON.stringify(backup) }))
  backup.binders[0].presetManifest = null
  assert.throws(() => planRawContentRestore({ ...f.input, text: JSON.stringify(backup) }))
})

test('v2 copied1025 manifests and edited targets preserve exact per-slot origins including a null-origin append', async () => {
  const { instantiatePreset } = await import('@/lib/domain/binder-presets')
  const { speciesPreset } = await import('@/lib/binder-creation-draft')
  const { createBinderBackupV2 } = await import('@/lib/binder-backup-v2')
  const { rawRestoreSchema, rawRestoreV1Schema, rawRestoreV2Schema } = await import('@/lib/developer-api/storage')
  const f = await rawRestoreFixture(), collectionId = f.snapshot.collections[0].id
  const manifest = speciesPreset('Synthetic copied Dex', Array.from({ length: 1025 }, (_, n) => n+1), 'synthetic-dex')
  const binder = instantiatePreset(manifest, { ownerUserId: f.snapshot.ownerUserId, collectionId }, manifest.entries.map((_,n)=>'synthetic-slot-'+n))!
  // An edited copied target remains legitimate provenance; original target/order are not required.
  binder.slots[0].target = null
  binder.slots[1024].presetOrigin = null
  const snapshot = { ...f.snapshot, items: [], placements: [], binders: [binder] }
  const input = { ...f.input, current: await f.brand(snapshot), choices: { collectionId,slotIds:binder.slots.map(s=>s.id),releaseItemIds:[],restoreContent:true as const } }
  const backup = createBinderBackupV2({snapshot,completeness:'complete-owner',scope:'collection',collectionId,layouts:[{...f.input.layouts[0],layoutRevision:0}]})
  input.layouts = [{...f.input.layouts[0],layoutRevision:0}]
  const request = planRawContentRestore({...input,text:JSON.stringify(backup)}).request
  assert.equal(request.version,2); assert.equal(request.slots.length,1025)
  assert.equal(rawRestoreSchema.safeParse(request).success,true)
  assert.equal(rawRestoreV2Schema.safeParse(request).success,true)
  assert.equal(rawRestoreV1Schema.safeParse(request).success,false)
  assert.deepEqual(request.slots[0].after.presetOrigin,binder.slots[0].presetOrigin)
  assert.equal(request.slots[1024].after.presetOrigin,null)
  for (const mutate of [
    (r: typeof request) => {r.slots[0].after.presetOrigin=binder.slots[1].presetOrigin},
    (r: typeof request) => {if(r.version===2)r.manifest!.name='Changed'},
  ]) {
    const changed=structuredClone(backup)
    const r=structuredClone(request);mutate(r)
    if(r.version===2)changed.binders[0].presetManifest=r.manifest
    changed.binders[0].slots[0].presetOrigin=r.slots[0].after.presetOrigin
    assert.throws(()=>planRawContentRestore({...input,text:JSON.stringify(changed)}))
  }
  for (const value of [{...request,version:3}, {...request,manifest:{...manifest,unknown:true}},
    {...request,slots:[...request.slots,request.slots[0]]}, {...request,version:1}]) {
    assert.throws(()=>parseRawRestoreCommand(value)); assert.equal(rawRestoreSchema.safeParse(value).success,false)
  }
  const small=planRawContentRestore(f.input).request
  const {manifest:_m,...v1}=small as Extract<typeof small,{version:2}>
  const original={...v1,version:1 as const}
  assert.deepEqual(parseRawRestoreCommand(original),original)
  assert.equal(rawRestoreSchema.safeParse(original).success,true)
  assert.equal(rawRestoreV1Schema.safeParse(original).success,true)
})

test('v2 byte admission budgets UTF-8/JSONB separators and refuses the old 4-MiB envelope', async () => {
  const { RAW_RESTORE_V2_LIMITS: limits, rawRestoreV2JsonbBytes } = await import('@/lib/domain/raw-restore')
  const { rawRestoreV2Schema } = await import('@/lib/developer-api/storage')
  const r = structuredClone(planRawContentRestore((await rawRestoreFixture()).input).request)
  r.slots[1].after.wantedCards = [{ card_id: 'synthetic-raw-trainer', card_name: '', added_at: '2020-01-01' }]
  const pad = limits.bytes - rawRestoreV2JsonbBytes(r)
  r.slots[1].after.wantedCards[0].card_name = '猫'.repeat(Math.floor(pad / 3)) + 'a'.repeat(pad % 3)
  assert.equal(rawRestoreV2JsonbBytes(r), limits.bytes)
  assert.ok(Buffer.byteLength(JSON.stringify(r)) < limits.bytes)
  assert.deepEqual(parseRawRestoreCommand(r), r)
  assert.equal(rawRestoreV2Schema.safeParse(r).success, true)
  r.slots[1].after.wantedCards[0].card_name += 'a'
  assert.throws(() => parseRawRestoreCommand(r), /1.75 MiB/)
  assert.equal(rawRestoreV2Schema.safeParse(r).success, false)
})

test('trusted planning refuses complete old-wants recovery graphs', async () => {
  const { RAW_RESTORE_V2_LIMITS: limits } = await import('@/lib/domain/raw-restore')
  const f = await rawRestoreFixture()
  const old = structuredClone(f.snapshot)
  old.binders[0].slots[0].wantedCards = [{ card_id: 'synthetic-raw-trainer', card_name: '猫'.repeat(limits.graphBytes / 3), added_at: '2020-01-01' }]
  const current = await f.brand(old)
  assert.throws(() => planRawContentRestore({ ...f.input, current }), /2.5 MiB/)
})

test('trusted planning budgets both manifest roots even when the command fits 1.75 MiB', async () => {
  const f = await rawRestoreFixture(true), snapshot = structuredClone(f.snapshot), backup = JSON.parse(f.input.text)
  snapshot.binders[0].presetManifest!.name = 'x'.repeat(1600000)
  backup.binders[0].presetManifest = snapshot.binders[0].presetManifest
  const current = await f.brand(snapshot)
  assert.throws(() => planRawContentRestore({ ...f.input, current, text: JSON.stringify(backup) }), /2.5 MiB/)
})
