import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseInventoryCommand, type InsertAssignCommand } from '@/lib/domain/inventory-commands'
import { projectSlotIntent, parseSlotIntent, type SlotOfflineIntent } from '@/lib/collection/slot-optimistic'
import { nativeInventorySchema } from '@/lib/developer-api/storage'
import type { InventorySnapshot } from '@/lib/domain/inventory'

const owner = '00910000-0000-4000-8000-000000000001', collectionId = '00910000-0000-4000-8000-000000000011'
const identity = { kind: 'pokemon' as const, pokemonId: 25 }
const base = (): InventorySnapshot => ({ ownerUserId: owner, inventoryRevision: 0,
  collections: [{ id: collectionId, ownerUserId: owner, name: 'Synthetic', kind: 'binder', defaultPresentation: 'binder', version: 0 }],
  binders: [{ ownerUserId: owner, collectionId, layoutRevision: 0, presetManifest: null,
    slots: ['first', 'last'].map(id => ({ id, ownerUserId: owner, collectionId, version: 0, target: identity, inventoryItemId: null, wantedCards: [], status: null, presetOrigin: null })) }],
  items: [{ id: 'synthetic-copy', ownerUserId: owner, identity, grading: null, acquiredAt: '2020-01-01T00:00:00Z', version: 3 }], placements: [] })
const command = (): InsertAssignCommand => ({ kind: 'insertAssign', collectionId, slotId: 'synthetic-new-slot', before: { id: 'first', version: 0, inventoryItemId: null, itemVersion: null, placementVersion: null }, target: null,
  selection: { kind: 'existing', inventoryItemId: 'synthetic-copy', itemVersion: 3 } })
function intent(s: InventorySnapshot, commands = [command()]): Extract<SlotOfflineIntent, { kind: "inventory" }> {
  return { kind: 'inventory', context: { source: 'app', clientId: 'synthetic-device', operationId: 'synthetic-insert-operation', batchId: null, clientOccurredAt: null },
    request: { operationId: 'synthetic-insert-operation', inventoryRevision: s.inventoryRevision, collections: [{ collectionId, version: 0, layoutRevision: 0 }], commands } }
}
const catalog = () => undefined

test('insertAssign survives strict persisted intent/REST/MCP schema without inventing a destination reference', () => {
  const draft = intent(base())
  assert.deepEqual(parseSlotIntent(JSON.parse(JSON.stringify(draft))), draft)
  assert.deepEqual(nativeInventorySchema.parse({ ...draft.request, privateFields: 'preserve', expectedOwnerUserId: owner }).commands, draft.request.commands)
  for (const patch of [{ destination: {} }, { before: undefined }, { target: undefined }, { selection: { kind: 'catalog', identity, newItemId: 'ambiguous' } }, { selection: { ...command().selection, grading: null } }]) {
    assert.throws(() => parseInventoryCommand({ ...draft.request, commands: [{ ...command(), ...patch }] }))
  }
})
test('insertion preserves existing target/order/copy metadata and advances each root once', () => {
  const s = base(), original = structuredClone(s), next = projectSlotIntent(s, intent(s), catalog)
  assert.deepEqual(s, original)
  assert.deepEqual(next.binders[0].slots.map(s => s.id), ['synthetic-new-slot', 'first', 'last'])
  assert.deepEqual(next.binders[0].slots.slice(1), s.binders[0].slots)
  assert.deepEqual(next.items, s.items)
  assert.equal(next.binders[0].slots[0].inventoryItemId, 'synthetic-copy')
  assert.equal(next.binders[0].slots[0].version, 1)
  assert.deepEqual([next.inventoryRevision, next.collections[0].version, next.binders[0].layoutRevision], [1, 1, 1])
})
test('append null selection creates no ownership; explicit new identity is one acquisition with stable IDs', () => {
  const s = base(), c = command(); c.before = null; c.selection = null; c.target = identity
  const empty = projectSlotIntent(s, intent(s, [c]), catalog)
  assert.deepEqual(empty.items, s.items); assert.deepEqual(empty.placements, [])
  assert.equal(empty.binders[0].slots.at(-1)!.target?.kind, 'pokemon')
  c.selection = { kind: 'new', itemId: 'stable-new-item', identity, grading: null, acquiredAt: null }
  const next = projectSlotIntent(s, intent(s, [c]), catalog)
  assert.equal(next.items.length, 2); assert.equal(next.placements[0].inventoryItemId, 'stable-new-item')
  assert.equal(next.items[1].grading, null)
})
test('stale anchors, item versions, assigned copies, mismatched targets and duplicate IDs reject the whole draft', () => {
  const s = base(), c = command()
  for (const changed of [
    { ...c, before: { ...c.before!, version: 5 } }, { ...c, slotId: 'first' },
    { ...c, selection: { kind: 'existing' as const, inventoryItemId: 'synthetic-copy', itemVersion: 4 } },
    { ...c, target: { kind: 'pokemon' as const, pokemonId: 1 } },
  ]) assert.throws(() => projectSlotIntent(s, intent(s, [changed]), catalog), /conflict|mismatch/)
  assert.throws(() => projectSlotIntent(s, intent(s, [c, { ...c, slotId: 'second-new' }]), catalog), /overlapping|placement/)
  const occupied = base(); occupied.binders[0].slots[0].inventoryItemId = 'synthetic-copy'; occupied.binders[0].slots[0].status = 'collected'
  occupied.placements.push({ inventoryItemId: 'synthetic-copy', collectionId, slotId: 'first', version: 0 })
  assert.throws(() => projectSlotIntent(occupied, intent(occupied, [{ ...c, before: null }]), catalog), /placement/)
})
test('4095 to 4096 near-start insertion is complete; capacity and repeated order work fail without truncation', () => {
  const s = base(), exemplar = s.binders[0].slots[0]
  s.binders[0].slots = Array.from({ length: 4095 }, (_, i) => ({ ...exemplar, id: `slot-${i}` }))
  const c = command(); c.before = { ...c.before!, id: 'slot-1' }; c.selection = null
  const next = projectSlotIntent(s, intent(s, [c]), catalog)
  assert.equal(next.binders[0].slots.length, 4096)
  assert.deepEqual(next.binders[0].slots.map(s => s.id), ['slot-0', c.slotId, ...s.binders[0].slots.slice(1).map(s => s.id)])
  assert.throws(() => projectSlotIntent(s, intent(s, [c, { ...c, slotId: 'overflow' }]), catalog), /capacity/)
})

test('durable insert keeps original slot/item IDs through lost reply and restart, ACK needs a separate fresh complete read', async () => {
  const { createMemoryStore } = await import('@/lib/offline-store/kv')
  const { createSlotOfflineQueue } = await import('@/lib/collection/slot-offline-queue')
  const { readCompleteInventorySnapshot } = await import('@/lib/collection/slot-snapshot')
  const s = base(), draft = intent(s), store = createMemoryStore()
  const scope = { deviceId: 'synthetic-device', workspaceId: 'synthetic-workspace', accountId: owner, ownerUserId: owner }
  const complete = (s: InventorySnapshot) => {
    const page = <T>(rows: T[]) => async () => ({ inventoryRevision: s.inventoryRevision, total: rows.length, rows, next: null })
    return readCompleteInventorySnapshot(owner, s.inventoryRevision, { items: page(s.items), placements: page(s.placements), collections: page(s.collections), binders: page(s.binders) })
  }
  const queue = createSlotOfflineQueue(store, scope)
  await queue.saveSnapshot(await complete(s)); await queue.enqueue(draft, catalog)
  await queue.replay(async sent => { assert.deepEqual(sent, draft); throw new Error('lost reply') }, () => scope, 0, catalog)
  const reopened = createSlotOfflineQueue(store, scope), committed = projectSlotIntent(s, draft, catalog)
  const cached = await complete(committed)
  await reopened.replay(async sent => ({ status: 200, operationId: sent.request.operationId, inventoryRevision: committed.inventoryRevision }), () => scope, 400000, catalog, async () => cached)
  assert.deepEqual((await reopened.read()).pending[0].intent, draft)
  await reopened.replay(async sent => { assert.deepEqual(sent, draft); return { status: 200, operationId: sent.request.operationId, inventoryRevision: committed.inventoryRevision } }, () => scope, 800000, catalog, () => complete(committed))
  const accepted = await reopened.read()
  assert.equal(accepted.pending.length, 0); assert.deepEqual(accepted.receipts[0].intent, draft)
  assert.deepEqual(accepted.snapshot, committed)
  await reopened.enqueue(draft, catalog)
  assert.equal((await reopened.read()).pending.length, 0)
})

test('insertion work is bounded even across many small commands, never split into partial drafts', () => {
  const s = base(), exemplar = s.binders[0].slots[0]
  s.binders[0].slots = Array.from({ length: 3000 }, (_, i) => ({ ...exemplar, id: `work-${i}` }))
  const commands = [0, 1, 2].map(i => ({ ...command(), slotId: `work-new-${i}`, before: null, selection: null }))
  assert.throws(() => projectSlotIntent(s, intent(s, commands), catalog), /capacity/)
  assert.equal(s.binders[0].slots.length, 3000)
})
