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
    { binders: backup.binders.map((b: { slots: object[] }) => ({ ...b, slots: b.slots.slice().reverse() })) },
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
