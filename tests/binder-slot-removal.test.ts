import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nativeInventorySchema } from '@/lib/developer-api/storage';
import { getBinderGoalPresentation } from '@/lib/binder-goals';
import { captureBulkSelection } from '@/lib/binder-bulk-editing';
import { prepareSlotRemoval } from '@/lib/binder-slot-removal';
import { syntheticSlotPickerSnapshot } from './fixtures/slot-picker';

const context = {
  source: 'app' as const,
  clientId: null,
  operationId: 'removal-operation',
  batchId: null,
  clientOccurredAt: null,
};
function setup() {
  const { inventory } = syntheticSlotPickerSnapshot();
  const scope = { ownerUserId: inventory.ownerUserId, collectionId: inventory.binders[0].collectionId, slotId: null };
  const source = { id: 'synthetic-original', version: '1' };
  inventory.binders[0].presetManifest = {
    source,
    name: 'Synthetic original goals',
    entries: [{ id: 'original', target: { kind: 'pokemon', pokemonId: 143 } }],
  };
  inventory.binders[0].slots[0].presetOrigin = { source, entryId: 'original' };
  inventory.binders[0].slots[0].wantedCards = [
    { card_id: 'synthetic-want', card_name: 'Synthetic want', added_at: '2026-01-01' },
  ];
  return { inventory, scope };
}

test('ordered consequences remove exact goals/wants/slots, retain all owned metadata and remaining order', () => {
  const { inventory, scope } = setup();
  const before = structuredClone(inventory);
  const ids = ['slot-c', 'slot-a', 'slot-b'];
  const result = prepareSlotRemoval(inventory, scope, captureBulkSelection(inventory, scope, ids), context);
  assert.deepEqual(
    result.rows.map((r) => r.slot.id),
    ['slot-a', 'slot-b', 'slot-c'],
  );
  assert.equal(result.counts.slots, 3);
  assert.equal(result.counts.targets, result.rows.filter((r) => r.slot.target).length);
  assert.equal(result.counts.wants, 1);
  assert.equal(result.counts.unassigned, result.rows.filter((r) => r.item).length);
  assert.equal(result.intent.kind, 'inventory');
  assert.equal(nativeInventorySchema.safeParse(result.intent.request).success, true);
  assert.equal(
    nativeInventorySchema.safeParse({
      ...result.intent.request,
      privateFields: 'preserve',
      expectedOwnerUserId: scope.collectionId,
    }).success,
    false,
  );
  assert.equal(result.intent.request.commands.length, 1);
  assert.equal(result.intent.request.commands[0].kind, 'removeSlots');
  assert.deepEqual(result.preview.items, inventory.items);
  assert.deepEqual(
    result.preview.binders[0].slots,
    inventory.binders[0].slots.filter((s) => !ids.includes(s.id)),
  );
  assert.deepEqual(result.preview.binders[0].presetManifest, inventory.binders[0].presetManifest);
  for (const row of result.rows)
    if (row.item) assert.ok(!result.preview.placements.some((p) => p.inventoryItemId === row.item!.id));
  assert.deepEqual(
    result.preview.placements,
    inventory.placements.filter((p) => !ids.includes(p.slotId)),
  );
  assert.equal(
    getBinderGoalPresentation(result.preview, result.preview.binders[0], () => undefined).targetCount,
    result.preview.binders[0].slots.filter((s) => s.target).length,
  );
  assert.deepEqual(inventory, before);
});

test('single free slot removal creates no ownership change and cannot become collection deletion', () => {
  const { inventory, scope } = setup();
  const slot = inventory.binders[0].slots.find((s) => !s.inventoryItemId && !s.target)!;
  const result = prepareSlotRemoval(inventory, scope, captureBulkSelection(inventory, scope, [slot.id]), context);
  assert.deepEqual(result.counts, { slots: 1, targets: 0, wants: 0, unassigned: 0 });
  assert.deepEqual(
    result.preview.collections.map((c) => c.id),
    inventory.collections.map((c) => c.id),
  );
});

test('stale copy/want/layout/owner evidence rejects without replacing the review', () => {
  const { inventory, scope } = setup();
  const selection = captureBulkSelection(inventory, scope, ['slot-a']);
  for (const change of [
    () => inventory.inventoryRevision++,
    () => inventory.binders[0].layoutRevision++,
    () => inventory.binders[0].slots[0].wantedCards.pop(),
    () => inventory.items[0].version++,
  ]) {
    const original = structuredClone(inventory);
    change();
    assert.throws(() => prepareSlotRemoval(inventory, scope, selection, context));
    Object.assign(inventory, original);
  }
  assert.throws(() => prepareSlotRemoval(inventory, { ...scope, ownerUserId: 'other' }, selection, context));
  assert.throws(() => prepareSlotRemoval(inventory, scope, captureBulkSelection(inventory, scope, []), context));
});

test('occupied selections count twice against ordinary work bound, no truncation or batching', () => {
  const { inventory, scope } = setup();
  const empty = inventory.binders[0].slots.find((s) => !s.inventoryItemId)!;
  inventory.binders[0].slots.push(
    ...Array.from({ length: 256 }, (_, i) => ({ ...structuredClone(empty), id: `empty-${i}` })),
  );
  const ids = inventory.binders[0].slots.slice(-256).map((s) => s.id);
  const accepted = prepareSlotRemoval(inventory, scope, captureBulkSelection(inventory, scope, ids), context);
  assert.equal(accepted.rows.length, 256);
  const occupied = inventory.binders[0].slots.find((s) => s.inventoryItemId)!;
  const bounded = [...ids.slice(0, 255), occupied.id];
  assert.throws(
    () => prepareSlotRemoval(inventory, scope, captureBulkSelection(inventory, scope, bounded), context),
    /bound/,
  );
});
