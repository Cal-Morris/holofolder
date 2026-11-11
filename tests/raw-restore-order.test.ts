import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rawRestoreFixture } from './fixtures/raw-restore'
import { planRawContentRestore } from '@/lib/raw-restore-plan'
import { parseRawRestoreCommand, isRawRestoreRejection } from '@/lib/domain/raw-restore'
import { isRawRestoreReceipt } from '@/lib/collection/raw-restore-delivery'
import { rawRestoreSchema } from '@/lib/developer-api/storage'

async function reordered() {
  const f = await rawRestoreFixture(true), backup = JSON.parse(f.input.text)
  backup.binders[0].slots.reverse()
  const request = planRawContentRestore({ ...f.input, text: JSON.stringify(backup) }).request
  assert.equal(request.version, 4)
  return { f, request }
}
test('reordered restore binds both orders; an unchanged order sends the same order twice', async () => {
  const { f, request } = await reordered()
  const unchanged = planRawContentRestore(f.input).request
  assert.deepEqual(unchanged.slotOrder.before, unchanged.slotOrder.after)
  assert.deepEqual(request.slotOrder, { before: ['slot-a', 'slot-b'], after: ['slot-b', 'slot-a'] })
  assert.deepEqual(request.slots.map(p => [p.before.id, p.after.id, p.after.inventoryItemId]), [['slot-a', 'slot-a', 'copy-a'], ['slot-b', 'slot-b', null]])
  assert.deepEqual(parseRawRestoreCommand(request), request)
  assert.equal(rawRestoreSchema.safeParse(request).success, true)
  const receipt = { version: 4, changed: true, inventoryRevision: 9, collectionId: request.collection.collectionId,
    collectionVersion: 3, layoutRevision: 4, slotIds: request.slotOrder.after, slotOrder: request.slotOrder, releasedItemIds: ['copy-b'] }
  assert.equal(isRawRestoreReceipt(receipt, request), true)
  for (const patch of [{ version: 3 }, { inventoryRevision: 10 }, { collectionVersion: 4 }, { layoutRevision: 3 }, { slotIds: request.slotOrder.before }, { slotOrder: { before: request.slotOrder.after, after: request.slotOrder.after } }]) {
    assert.equal(isRawRestoreReceipt({ ...receipt, ...patch }, request), false)
  }
  const rejection = { version: 4, outcome: 'rejected', operationId: request.operationId, code: 'raw_restore_content_conflict', inventoryRevision: 9 }
  assert.equal(isRawRestoreRejection(rejection, request.operationId), true)
  assert.equal(isRawRestoreRejection({ ...rejection, version: 3 }, request.operationId), false)
})
test('restore refuses duplicate, missing, invented and forged before orders without coercion', async () => {
  const { request } = await reordered()
  for (const slotOrder of [
    { ...request.slotOrder, after: ['slot-a', 'slot-a'] }, { ...request.slotOrder, after: ['slot-a'] },
    { ...request.slotOrder, after: ['slot-a', 'new-slot'] },
    { ...request.slotOrder, before: request.slotOrder.after }, { ...request.slotOrder, extra: true },
  ]) {
    const bad = { ...request, slotOrder }
    assert.throws(() => parseRawRestoreCommand(bad)); assert.equal(rawRestoreSchema.safeParse(bad).success, false)
  }
  assert.throws(() => parseRawRestoreCommand({ ...request, version: 2 }))
  assert.throws(() => parseRawRestoreCommand({ ...request, version: 999 }))
})

test('reordered restore keeps copied origins, targets, wanted roles and physical metadata on the stable slot identity', async () => {
  const f = await rawRestoreFixture(), backup = JSON.parse(f.input.text)
  const { speciesPreset } = await import('@/lib/binder-creation-draft')
  const manifest = speciesPreset('Synthetic copied goals', [1, 2])
  const origin = (n: number) => ({ source: manifest.source, entryId: manifest.entries[n].id })
  f.snapshot.binders[0].presetManifest = manifest
  f.snapshot.binders[0].slots.forEach((s, n) => { s.presetOrigin = origin(n) })
  backup.binders[0].presetManifest = manifest
  backup.binders[0].slots.forEach((s: { presetOrigin: unknown }, n: number) => { s.presetOrigin = origin(n) })
  backup.binders[0].slots[0].target = { kind: 'pokemon', pokemonId: 1 }
  backup.binders[0].slots[0].wantedCards = [{ card_id: 'synthetic-want', card_name: 'Synthetic want', added_at: '2020-01-01', wantedRoles: ['partner'] }]
  backup.binders[0].slots.reverse()
  const plan = () => planRawContentRestore({ ...f.input, current: f.input.current, text: JSON.stringify(backup) })
  f.input.current = await f.brand(f.snapshot)
  const r = plan().request
  assert.equal(r.version, 4)
  assert.deepEqual(r.slots[0].after.presetOrigin, origin(0))
  assert.deepEqual(r.slots[0].after.target, { kind: 'pokemon', pokemonId: 1 })
  assert.deepEqual(r.slots[0].after.wantedCards[0].wanted_by, [f.input.evidence.partnerUserId])
  assert.equal(r.slots[0].after.inventoryItemId, 'copy-a')
  assert.deepEqual(r.slots[1].after.presetOrigin, origin(1))
  backup.binders[0].slots[0].presetOrigin = origin(0)
  assert.throws(plan)
})
