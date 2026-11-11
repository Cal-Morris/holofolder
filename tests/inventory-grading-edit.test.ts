import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inventoryGradingReference, prepareInventoryGradingIntent } from '@/lib/grading/inventory-edit';
import { emptyGradingRecord, gradingEditCommand } from '@/lib/grading/draft';
import { projectSlotIntent } from '@/lib/collection/slot-optimistic';
import type { InventorySnapshot } from '@/lib/domain/inventory';

// Synthetic private evidence, including opaque legacy fields and an unknown catalog identity.
const owner = 'synthetic-owner',
  collectionId = '22222222-2222-4222-8222-222222222222';
function snapshot(): InventorySnapshot {
  return {
    ownerUserId: owner,
    inventoryRevision: 7,
    items: ['psa', 'ace', 'raw'].map((id, n) => ({
      id,
      ownerUserId: owner,
      version: 2,
      identity: { kind: 'card', cardId: 'synthetic-unknown', language: 'ja', finish: 'holo' },
      acquiredAt: '2026-01-01T00:00:00Z',
      grading:
        id === 'raw'
          ? null
          : {
              ...emptyGradingRecord(),
              provider: { kind: 'known', id: n ? 'ace' : 'psa' },
              grade: n ? 'Legacy / unknown' : null,
              certificate: '00001234',
              label: { variant: 'Legacy', assetIds: ['private-label'] },
            },
    })),
    placements: [{ inventoryItemId: 'psa', collectionId, slotId: 'synthetic-slot', version: 3 }],
    collections: [
      {
        id: collectionId,
        ownerUserId: owner,
        name: 'Synthetic',
        kind: 'custom',
        defaultPresentation: 'list',
        version: 4,
        location: 'Private shelf',
      },
    ],
    binders: [
      {
        ownerUserId: owner,
        collectionId,
        layoutRevision: 5,
        presetManifest: null,
        slots: [
          {
            id: 'synthetic-slot',
            ownerUserId: owner,
            collectionId,
            version: 6,
            inventoryItemId: 'psa',
            status: 'collected',
            wantedCards: [],
            target: null,
            presetOrigin: null,
          },
        ],
      },
    ],
  };
}
const context = {
  source: 'app' as const,
  clientId: 'synthetic-device',
  operationId: 'synthetic-grading-operation',
  batchId: null,
  clientOccurredAt: null,
};
function intent(s: InventorySnapshot, id: string, raw = false) {
  const item = s.items.find((i) => i.id === id)!;
  return prepareInventoryGradingIntent(
    s,
    gradingEditCommand(
      item,
      inventoryGradingReference(s, id),
      raw ? null : { ...item.grading!, grade: 'Authentic / vintage' },
    ),
    context,
  );
}
test('placed grading edit captures every original fence, keeps private fields and independent copies', () => {
  const s = snapshot(),
    before = structuredClone(s),
    draft = intent(s, 'psa');
  assert.equal(draft.kind, 'inventory');
  if (draft.kind !== 'inventory') return;
  assert.deepEqual(draft.request.collections, [{ collectionId, version: 4, layoutRevision: 5 }]);
  assert.deepEqual(draft.request.commands[0], {
    kind: 'edit',
    item: {
      itemId: 'psa',
      itemVersion: 2,
      placement: {
        collectionId,
        slot: { id: 'synthetic-slot', version: 6, inventoryItemId: 'psa', itemVersion: 2, placementVersion: 3 },
      },
    },
    grading: { ...s.items[0].grading!, grade: 'Authentic / vintage' },
  });
  const next = projectSlotIntent(s, draft, () => undefined);
  assert.deepEqual(next.items[0], {
    ...before.items[0],
    version: 3,
    grading: { ...before.items[0].grading!, grade: 'Authentic / vintage' },
  });
  assert.deepEqual(next.items.slice(1), before.items.slice(1));
  assert.deepEqual(next.placements, before.placements);
  assert.deepEqual(next.binders, before.binders);
  assert.equal(next.collections[0].location, 'Private shelf');
  assert.deepEqual(s, before);
});
test('unassigned copy edits do not invent collection tokens or a placement; raw clear only changes grading', () => {
  const s = snapshot(),
    draft = intent(s, 'ace', true);
  if (draft.kind !== 'inventory') throw new Error('Expected inventory');
  assert.deepEqual(draft.request.collections, []);
  const next = projectSlotIntent(s, draft, () => undefined);
  assert.deepEqual(next.items[1], { ...s.items[1], grading: null, version: 3 });
  assert.deepEqual(next.collections, s.collections);
  assert.deepEqual(next.placements, s.placements);
  assert.deepEqual(next.items[0], s.items[0]);
  assert.deepEqual(next.items[2], s.items[2]);
});
test('stale item, slot, placement, collection, inventory and owner evidence cannot retarget original draft', () => {
  const s = snapshot(),
    draft = intent(s, 'psa');
  for (const mutate of [
    (v: InventorySnapshot) => {
      v.items[0].version++;
    },
    (v: InventorySnapshot) => {
      v.binders[0].slots[0].version++;
    },
    (v: InventorySnapshot) => {
      v.placements[0].version++;
    },
    (v: InventorySnapshot) => {
      v.collections[0].version++;
    },
    (v: InventorySnapshot) => {
      v.binders[0].layoutRevision++;
    },
    (v: InventorySnapshot) => {
      v.inventoryRevision++;
    },
    (v: InventorySnapshot) => {
      v.items[0].ownerUserId = 'other-owner';
    },
  ]) {
    const changed = structuredClone(s);
    mutate(changed);
    assert.throws(() => projectSlotIntent(changed, draft, () => undefined));
  }
  const stale = gradingEditCommand(s.items[0], inventoryGradingReference(s, 'psa'), null);
  stale.item.placement = null;
  assert.throws(() => prepareInventoryGradingIntent(s, stale, context), /copy-changed/);
  assert.throws(() => inventoryGradingReference(s, 'missing'));
});
