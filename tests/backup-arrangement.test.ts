import { test } from 'node:test'
import assert from 'node:assert/strict'
import { arrangementFixture } from './fixtures/backup-arrangement'
import { execFileSync } from 'node:child_process'
import { previewBinderBackupImport } from '@/lib/binder-backup-preview'
import { parseBackupArrangementCommand } from '@/lib/domain/backup-import-command'
import { normalizeStorageResult } from '@/lib/server/operations/storage-contract'

test('immutable full-Dex arrangement executes as one retained import including wants/spacers/provenance and separate copies', () => {
  const o = arrangementFixture(), p = previewBinderBackupImport(o)
  assert.equal(p.execution.kind, 'arrangement-command')
  if (p.execution.kind !== 'arrangement-command') assert.fail()
  const request = p.execution.request
  assert.equal(request.slots.length, 1028)
  assert.equal(request.copies.length, 2)
  assert.equal(request.slots[1025].target, null)
  assert.deepEqual(request.slots[3].wantedCards, o.current.binders[0].slots[3].wantedCards)
  assert.deepEqual(request.manifest, o.current.binders[0].presetManifest)
  assert.ok(Object.isFrozen(request.copies[0].item))
  assert.deepEqual(parseBackupArrangementCommand(structuredClone(request)), request)
  for (const change of [{ version: 2 }, { ownerUserId: 'forged' }, { copies: [...request.copies, request.copies[0]] },
    { slots: [...request.slots, request.slots[0]] }, { settings: {} }, { slots: [{ ...request.slots[0], inventoryItemId: 'unselected' }] }]) {
    assert.throws(() => parseBackupArrangementCommand({ ...request, ...change }))
  }
  const receipt = { inventoryRevision: 9, collectionId: request.destinationCollectionId, collectionVersion: 3, layoutRevision: 4,
    changed: true, slotIds: request.slots.map(s => s.id), addedItemIds: request.copies.map(c => c.item.id), removedEmptySlotIds: [] }
  assert.deepEqual(normalizeStorageResult('backup.arrangement', { ...receipt, certificate: 'private' }), receipt)
  assert.throws(() => normalizeStorageResult('backup.arrangement', { error: 'native_operations_staged' }))
})
test('pristine copied preset targets can be replaced only with exact reviewed empty-slot preconditions', () => {
  const o = arrangementFixture()
  o.current.binders[1].slots = o.current.binders[0].slots.map(s => ({ ...structuredClone(s), id: 'destination/' + s.id, collectionId: o.destinationCollectionId,
    inventoryItemId: null, wantedCards: [], status: null }))
  const p = previewBinderBackupImport(o)
  assert.equal(p.execution.kind, 'arrangement-command')
  if (p.execution.kind !== 'arrangement-command') assert.fail()
  assert.equal(p.execution.request.emptyDestinationSlots.length, 1028)
  assert.deepEqual(p.replacedEmptySlotIds, o.current.binders[1].slots.map(s => s.id))
  o.current.binders[1].slots[0].status = 'considering'
  assert.equal(previewBinderBackupImport(o).execution.kind, 'blocked')
})
test('existing identities require explicit versioned moves; no printing/certificate merge or omitted-copy ownership loss', () => {
  const o = arrangementFixture()
  const moved = previewBinderBackupImport({ ...o, decisions: o.decisions.map(d => ({ sourceItemId: d.sourceItemId, kind: 'use-existing', itemId: d.sourceItemId })) })
  assert.equal(moved.execution.kind, 'arrangement-command')
  assert.equal(moved.addedCopies, 0)
  assert.equal(moved.moves.length, 2)
  if (moved.execution.kind !== 'arrangement-command') assert.fail()
  assert.equal(moved.execution.request.collections.length, 2)
  assert.equal(moved.execution.request.copies[0].ref?.placement?.slot.placementVersion, 2)
  assert.equal(previewBinderBackupImport({ ...o, decisions: [] }).execution.kind, 'blocked')
  assert.equal(previewBinderBackupImport({ ...o, savedEntryRemaining: 0 }).execution.kind, 'blocked')
  const occupied = structuredClone(o.current)
  occupied.binders[1].slots = structuredClone(occupied.binders[0].slots).map(s => ({ ...s, id: 'other/' + s.id, collectionId: o.destinationCollectionId, inventoryItemId: null, status: null }))
  assert.equal(previewBinderBackupImport({ ...o, current: occupied }).execution.kind, 'blocked')
  const changedManifest = structuredClone(o.current)
  changedManifest.binders[1].presetManifest = null
  assert.equal(previewBinderBackupImport({ ...o, current: changedManifest }).execution.kind, 'blocked')
})

test('app confirmation consumes immutable preview, reauthenticates and retains exact intent after unknown outcome', () => {
  execFileSync(process.execPath, [new URL('./fixtures/backup-import-consumer.ts', import.meta.url).pathname], { stdio: 'pipe' })
})

test('preview allowance includes considering status as well as explicit wanted entries', () => {
  const o = arrangementFixture(), backup = JSON.parse(o.text)
  backup.binders[0].slots[3].status = 'considering'
  const p = previewBinderBackupImport({ ...o, text: JSON.stringify(backup), savedEntryRemaining: 3 })
  assert.equal(p.addedWants, 2)
  assert.equal(p.execution.kind, 'blocked')
})
