import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareLayoutIntent } from '@/lib/binder-slot-editing';
import { syntheticSlotPickerSnapshot } from './fixtures/slot-picker';
import { pickerCandidate } from '@/lib/slot-picker';

const context = {
  source: 'app' as const,
  clientId: null,
  operationId: 'layout-operation',
  batchId: null,
  clientOccurredAt: null,
};
const setup = () => {
  const data = syntheticSlotPickerSnapshot();
  return {
    ...data,
    scope: { ownerUserId: data.inventory.ownerUserId, collectionId: data.binder.collectionId, slotId: 'slot-a' },
    catalog: (id: string) => {
      const card = data.cards.find((c) => c.id === id);
      return card ? pickerCandidate(card) : undefined;
    },
  };
};
test('insert before/after stable full-layout anchors, first/last and across pages', () => {
  for (const [anchor, side, index] of [
    ['slot-a', 'before', 0],
    ['slot-d', 'after', 4],
    ['slot-g', 'after', 7],
  ] as const) {
    const { inventory, scope, catalog } = setup();
    const before = structuredClone(inventory);
    const draft = prepareLayoutIntent(
      inventory,
      scope,
      { kind: 'insert', anchorId: anchor, side, newSlotId: 'inserted-slot' },
      context,
      catalog,
    );
    const slots = draft.preview.binders[0].slots;
    assert.equal(slots[index].id, 'inserted-slot');
    assert.deepEqual(
      slots.filter((s) => s.id !== 'inserted-slot'),
      inventory.binders[0].slots,
    );
    assert.deepEqual(draft.preview.items, inventory.items);
    assert.deepEqual(draft.preview.placements, inventory.placements);
    assert.deepEqual(inventory, before);
    assert.equal(draft.intent.context.operationId, context.operationId);
  }
});
test('append works with no selected slot, including an empty binder', () => {
  for (const empty of [false, true]) {
    const { inventory, scope, catalog } = setup();
    if (empty) {
      inventory.binders[0].slots = [];
      inventory.placements = [];
    }
    const draft = prepareLayoutIntent(
      inventory,
      { ...scope, slotId: null },
      { kind: 'append', newSlotId: 'appended-slot' },
      context,
      catalog,
    );
    assert.equal(draft.preview.binders[0].slots.at(-1)?.id, 'appended-slot');
    assert.equal(draft.preview.binders[0].slots.length, empty ? 1 : 8);
  }
});
test('whole-slot moves retain every slot field, owned IDs, wants and preset metadata', () => {
  const { inventory, scope, catalog } = setup();
  inventory.binders[0].slots[0].wantedCards = [
    { card_id: 'synthetic-snorlax-b', card_name: 'Synthetic', added_at: '2026-01-01' },
  ];
  const source = { id: 'synthetic-preset', version: '1' };
  inventory.binders[0].presetManifest = {
    source,
    name: 'Synthetic',
    entries: [{ id: 'entry-a', target: inventory.binders[0].slots[0].target }],
  };
  inventory.binders[0].slots[0].presetOrigin = { source, entryId: 'entry-a' };
  for (const destination of [
    { kind: 'position', position: 7 },
    { kind: 'after', slotId: 'slot-g' },
  ] as const) {
    const draft = prepareLayoutIntent(inventory, scope, { kind: 'move', destination }, context, catalog);
    assert.equal(draft.preview.binders[0].slots.at(-1)?.id, 'slot-a');
    assert.deepEqual(draft.preview.binders[0].slots.at(-1), inventory.binders[0].slots[0]);
    assert.deepEqual(draft.preview.items, inventory.items);
    assert.deepEqual(draft.preview.placements, inventory.placements);
  }
  const last = prepareLayoutIntent(
    inventory,
    { ...scope, slotId: 'slot-g' },
    { kind: 'move', destination: { kind: 'before', slotId: 'slot-a' } },
    context,
    catalog,
  );
  assert.equal(last.preview.binders[0].slots[0].id, 'slot-g');
});
test('reject stale scopes, missing anchors, self moves and invalid full-layout positions', () => {
  const { inventory, scope, catalog } = setup();
  for (const destination of [
    { kind: 'position', position: 0 },
    { kind: 'position', position: 8 },
    { kind: 'position', position: 1.5 },
    { kind: 'before', slotId: 'missing' },
    { kind: 'after', slotId: 'slot-a' },
  ] as const)
    assert.throws(() => prepareLayoutIntent(inventory, scope, { kind: 'move', destination }, context, catalog));
  assert.throws(
    () =>
      prepareLayoutIntent(
        inventory,
        { ...scope, ownerUserId: 'other' },
        { kind: 'append', newSlotId: 'new-slot' },
        context,
        catalog,
      ),
    /scope/,
  );
  assert.throws(
    () =>
      prepareLayoutIntent(
        inventory,
        scope,
        { kind: 'insert', anchorId: 'missing', side: 'after', newSlotId: 'new-slot' },
        context,
        catalog,
      ),
    /anchor/,
  );
});

test('no-op adjacency keeps layout revision and capacity rejects before emitting a draft', () => {
  const { inventory, scope, catalog } = setup();
  const unchanged = prepareLayoutIntent(
    inventory,
    scope,
    { kind: 'move', destination: { kind: 'before', slotId: 'slot-b' } },
    context,
    catalog,
  );
  assert.deepEqual(unchanged.preview, inventory);
  const preceding = prepareLayoutIntent(
    inventory,
    { ...scope, slotId: 'slot-b' },
    { kind: 'move', destination: { kind: 'after', slotId: 'slot-a' } },
    context,
    catalog,
  );
  assert.deepEqual(preceding.preview, inventory);
  const free = inventory.binders[0].slots[6];
  inventory.binders[0].slots.push(
    ...Array.from({ length: 4096 - inventory.binders[0].slots.length }, (_, i) => ({ ...free, id: `capacity-${i}` })),
  );
  assert.throws(
    () =>
      prepareLayoutIntent(
        inventory,
        { ...scope, slotId: null },
        { kind: 'append', newSlotId: 'over-capacity' },
        context,
        catalog,
      ),
    /capacity/,
  );
});
