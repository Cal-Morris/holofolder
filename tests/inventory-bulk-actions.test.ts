import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syntheticSlotPickerSnapshot } from './fixtures/slot-picker';
import { pickerCandidate } from '../lib/slot-picker';
import { prepareInventoryBulkAction } from '../lib/inventory-bulk-actions';
import { projectSlotIntent } from '../lib/collection/slot-optimistic';

const context = {
  source: 'app' as const,
  clientId: null,
  operationId: 'synthetic-bulk-operation',
  batchId: null,
  clientOccurredAt: null,
};
function setup() {
  const data = syntheticSlotPickerSnapshot();
  return {
    snapshot: data.inventory,
    catalog: (id: string) => {
      const c = data.cards.find((c) => c.id === id);
      return c ? pickerCandidate(c) : undefined;
    },
  };
}
function many(count: number) {
  const { snapshot, catalog } = setup();
  const collectionId = snapshot.collections[0].id;
  snapshot.items = [];
  snapshot.placements = [];
  snapshot.binders[0].slots = [];
  for (let n = 0; n < count; n++) {
    snapshot.items.push({
      id: `copy-${n}`,
      ownerUserId: snapshot.ownerUserId,
      identity: { kind: 'card', cardId: 'unknown' },
      grading: null,
      acquiredAt: null,
      version: 0,
    });
    for (const suffix of ['source', 'dest'])
      snapshot.binders[0].slots.push({
        id: `${suffix}-${n}`,
        collectionId,
        ownerUserId: snapshot.ownerUserId,
        target: null,
        inventoryItemId: suffix === 'source' ? `copy-${n}` : null,
        status: suffix === 'source' ? 'collected' : null,
        wantedCards: [],
        version: 0,
        presetOrigin: null,
      });
    snapshot.placements.push({ inventoryItemId: `copy-${n}`, collectionId, slotId: `source-${n}`, version: 0 });
  }
  const mapping = snapshot.items.map((i) => ({ itemId: i.id, collectionId, slotId: i.id.replace('copy', 'dest') }));
  return { snapshot, catalog, mapping };
}
test('ordered bulk Move is one atomic request preserving exact private copies and slot goals', () => {
  const { snapshot, catalog, mapping } = many(3);
  const before = structuredClone(snapshot);
  const result = prepareInventoryBulkAction(
    snapshot,
    { kind: 'move', mapping: [mapping[2], mapping[0]] },
    context,
    catalog,
  );
  assert.deepEqual(
    result.intent.request.commands.map((c) => (c.kind === 'move' ? c.item.itemId : null)),
    ['copy-2', 'copy-0'],
  );
  assert.deepEqual(result.preview.items, before.items);
  assert.equal(result.preview.placements.find((p) => p.inventoryItemId === 'copy-1')?.slotId, 'source-1');
  assert.deepEqual(
    result.preview.binders[0].slots.map((s) => [s.id, s.target, s.wantedCards, s.presetOrigin]),
    before.binders[0].slots.map((s) => [s.id, s.target, s.wantedCards, s.presetOrigin]),
  );
  assert.deepEqual(snapshot, before);
  const unassign = prepareInventoryBulkAction(
    result.preview,
    { kind: 'unassign', itemIds: ['copy-2', 'copy-0'] },
    context,
    catalog,
  );
  assert.deepEqual(unassign.preview.items, before.items);
  assert.equal(unassign.preview.placements.length, 1);
});
test('whole selection refuses empty, duplicates, graded, missing, already Unassigned and occupied/repeated destinations', () => {
  const { snapshot, catalog, mapping } = many(3);
  for (const itemIds of [[], ['copy-0', 'copy-0'], ['copy-0', 'missing']])
    assert.throws(() => prepareInventoryBulkAction(snapshot, { kind: 'unassign', itemIds }, context, catalog));
  const data = setup();
  assert.throws(() =>
    prepareInventoryBulkAction(
      data.snapshot,
      { kind: 'unassign', itemIds: ['item-a', 'unassigned-grade'] },
      context,
      data.catalog,
    ),
  );
  assert.throws(() =>
    prepareInventoryBulkAction(
      data.snapshot,
      { kind: 'unassign', itemIds: ['item-a', 'unassigned-b'] },
      context,
      data.catalog,
    ),
  );
  for (const bad of [
    [mapping[0], { ...mapping[1], slotId: mapping[0].slotId }],
    [mapping[0], { ...mapping[1], slotId: 'source-2' }],
  ])
    assert.throws(() => prepareInventoryBulkAction(snapshot, { kind: 'move', mapping: bad }, context, catalog));
});
test('existing whole-request work, count and bytes caps fail without truncation or input mutation', () => {
  for (const [count, kind] of [
    [86, 'move'],
    [101, 'unassign'],
  ] as const) {
    const { snapshot, catalog, mapping } = many(count),
      before = structuredClone(snapshot);
    assert.throws(() =>
      prepareInventoryBulkAction(
        snapshot,
        kind === 'move' ? { kind, mapping } : { kind, itemIds: mapping.map((m) => m.itemId) },
        context,
        catalog,
      ),
    );
    assert.deepEqual(snapshot, before);
  }
  const { snapshot, catalog, mapping } = many(85);
  assert.equal(
    prepareInventoryBulkAction(snapshot, { kind: 'move', mapping }, context, catalog).intent.request.commands.length,
    85,
  );
  for (let n = 0; n < snapshot.items.length; n++) {
    const id = `${'\u0001'.repeat(180)}${n}`;
    snapshot.items[n].id = id;
    snapshot.placements[n].inventoryItemId = id;
    snapshot.binders[0].slots[n * 2].inventoryItemId = id;
    for (const offset of [0, 1]) snapshot.binders[0].slots[n * 2 + offset].id = `${id}-${offset}`;
    snapshot.placements[n].slotId = `${id}-0`;
    mapping[n] = { ...mapping[n], itemId: id, slotId: `${id}-1` };
  }
  assert.throws(() => prepareInventoryBulkAction(snapshot, { kind: 'move', mapping }, context, catalog), /oversized/);
});
test('immutable bulk request fences later item, placement, slot, collection, root and layout changes', () => {
  const { snapshot, catalog, mapping } = many(2);
  const { intent } = prepareInventoryBulkAction(snapshot, { kind: 'move', mapping }, context, catalog);
  for (const change of [
    (s: typeof snapshot) => {
      s.inventoryRevision++;
    },
    (s: typeof snapshot) => {
      s.items[1].version++;
    },
    (s: typeof snapshot) => {
      s.placements[1].version++;
    },
    (s: typeof snapshot) => {
      s.binders[0].slots[3].version++;
    },
    (s: typeof snapshot) => {
      s.collections[0].version++;
    },
    (s: typeof snapshot) => {
      s.binders[0].layoutRevision++;
    },
    (s: typeof snapshot) => {
      s.items[1].ownerUserId = 'other';
    },
  ]) {
    const current = structuredClone(snapshot);
    change(current);
    assert.throws(() => projectSlotIntent(current, intent, catalog));
  }
});

test('mixed exact Unassigned assignment and placed Move retain unknown identity and private source', () => {
  const { snapshot, catalog } = setup();
  const { intent, preview } = prepareInventoryBulkAction(
    snapshot,
    {
      kind: 'move',
      mapping: [
        { itemId: 'unassigned-a', collectionId: snapshot.collections[0].id, slotId: 'slot-e' },
        { itemId: 'item-a', collectionId: snapshot.collections[0].id, slotId: 'slot-g' },
      ],
    },
    context,
    catalog,
  );
  assert.deepEqual(
    intent.request.commands.map((c) => c.kind),
    ['assign', 'move'],
  );
  assert.deepEqual(preview.items, snapshot.items);
  assert.ok(
    intent.request.commands.every((c) => 'fulfillWant' in c && c.fulfillWant === null && c.occupied === 'cancel'),
  );
  snapshot.items.find((i) => i.id === 'unassigned-a')!.identity = { kind: 'card', cardId: 'unknown' };
  assert.throws(() =>
    prepareInventoryBulkAction(
      snapshot,
      {
        kind: 'move',
        mapping: [{ itemId: 'unassigned-a', collectionId: snapshot.collections[0].id, slotId: 'slot-e' }],
      },
      context,
      catalog,
    ),
  );
});

test('bulk graded placement and placed unassignment remain excluded as a whole', () => {
  const { snapshot, catalog } = setup();
  for (const action of [
    { kind: 'unassign', itemIds: ['item-a', 'item-b'] },
    {
      kind: 'move',
      mapping: [{ itemId: 'unassigned-grade', collectionId: snapshot.collections[0].id, slotId: 'slot-e' }],
    },
  ] as const) {
    assert.throws(() => prepareInventoryBulkAction(snapshot, action, context, catalog), /raw-copy-required/);
  }
});
