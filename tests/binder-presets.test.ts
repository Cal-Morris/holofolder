import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  instantiatePreset,
  normalizePresetDefinition,
  normalizePresetManifest,
  type PresetDefinition,
} from '@/lib/domain/binder-presets';
import { getBinderCompletion, normalizeBinderSnapshot } from '@/lib/domain/binder-slots';
import { getInventoryCounts, normalizeInventorySnapshot, type InventorySnapshot } from '@/lib/domain/inventory';
import { planRemoveSlots } from '@/lib/binder-slot-plans';

// Synthetic source definitions and IDs, not catalog records.
function definition(): PresetDefinition {
  return {
    source: { id: 'synthetic-preset', version: 'v1' },
    name: 'Synthetic preset',
    entries: [
      { id: 'first', target: { kind: 'card', cardId: 'synthetic-card' } },
      { id: 'second', target: { kind: 'card', cardId: 'synthetic-card' } },
      { id: 'spacer', target: null },
    ],
  };
}
const scope = { ownerUserId: 'owner', collectionId: 'binder' };

describe('copied preset contracts', () => {
  test('independent instantiations copy sources, targets and provenance without ownership/wants', () => {
    const source = definition();
    const first = instantiatePreset(source, scope, ['a', 'b', 'c'])!;
    const second = instantiatePreset(source, scope, ['d', 'e', 'f'])!;
    assert.deepEqual(normalizeBinderSnapshot(first), first);
    assert.equal(first.layoutRevision, 0);
    assert.equal(first.slots[0].inventoryItemId, null);
    assert.equal(first.slots[0].status, null);
    assert.deepEqual(first.slots[0].wantedCards, []);
    assert.deepEqual(first.slots[0].presetOrigin, { source: source.source, entryId: 'first' });
    assert.deepEqual(first.slots[0].target, first.slots[1].target);
    assert.notEqual(first.slots[0].id, first.slots[1].id);
    source.entries[0].target = null;
    source.source.version = 'v2';
    first.slots[0].target = null;
    first.presetManifest!.entries[1].target = null;
    first.slots[0].presetOrigin!.source.version = 'edited';
    assert.deepEqual(second.slots[0].target, { kind: 'card', cardId: 'synthetic-card' });
    assert.deepEqual(first.slots[1].target, { kind: 'card', cardId: 'synthetic-card' });
    assert.deepEqual(second.presetManifest, definition());
    assert.equal(second.slots[0].presetOrigin!.source.version, 'v1');
    assert.equal(first.presetManifest!.source.version, 'v1');
  });

  test('copied repeat targets and spacers contribute no owner inventory', () => {
    const binder = instantiatePreset(definition(), scope, ['a', 'b', 'c'])!;
    const inventory: InventorySnapshot = {
      ownerUserId: scope.ownerUserId,
      inventoryRevision: 0,
      items: [],
      placements: [],
      binders: [binder],
      collections: [
        {
          id: scope.collectionId,
          ownerUserId: scope.ownerUserId,
          name: 'Synthetic',
          kind: 'binder',
          defaultPresentation: 'binder',
          version: 0,
        },
      ],
    };
    assert.ok(normalizeInventorySnapshot(inventory));
    assert.deepEqual(getInventoryCounts(inventory), {
      total: 0,
      assigned: 0,
      unassigned: 0,
      byCollection: { binder: 0 },
    });
    assert.deepEqual(
      binder.slots.map((s) => s.inventoryItemId),
      [null, null, null],
    );
  });

  test('blank generates no implicit targets or slots', () => {
    const blank = { ...definition(), entries: [] };
    assert.deepEqual(instantiatePreset(blank, scope, [])?.slots, []);
    assert.equal(instantiatePreset(blank, scope, ['unrequested']), undefined);
  });

  test('rejects malformed definitions, source versions, duplicate entry/slot IDs and unsupported constraints', () => {
    for (const input of [
      null,
      {},
      { ...definition(), source: { id: 'x' } },
      { ...definition(), unknown: true },
      { ...definition(), entries: [{ id: 'a', target: undefined }] },
      {
        ...definition(),
        entries: [
          { id: 'a', target: null },
          { id: 'a', target: null },
        ],
      },
      { ...definition(), entries: [{ id: 'a', target: { kind: 'card', cardId: 'x', grade: '10' } }] },
    ]) {
      assert.equal(normalizePresetDefinition(input), undefined);
      assert.equal(normalizePresetManifest(input), undefined);
    }
    assert.equal(instantiatePreset(definition(), scope, ['a', 'a', 'b']), undefined);
    assert.equal(instantiatePreset(definition(), scope, ['a']), undefined);
    assert.equal(
      instantiatePreset({ ...definition(), entries: [{ id: 'one', target: null }] }, scope, Array(1)),
      undefined,
    );
  });

  test('removed slots never reappear from provenance; malformed provenance fails validation', () => {
    const initial = instantiatePreset(definition(), scope, ['a', 'b', 'c'])!;
    const result = planRemoveSlots(initial, 0, ['a']);
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.equal(result.snapshot.presetManifest!.entries.length, 3);
    assert.deepEqual(
      result.snapshot.slots.map((s) => s.id),
      ['b', 'c'],
    );
    assert.ok(normalizeBinderSnapshot(result.snapshot));
    assert.deepEqual(
      getBinderCompletion(result.snapshot, () => undefined),
      { targetCount: 1, completedTargetCount: 0 },
    );
    result.snapshot.slots[0].presetOrigin!.entryId = 'missing';
    assert.equal(normalizeBinderSnapshot(result.snapshot), undefined);
  });
});
