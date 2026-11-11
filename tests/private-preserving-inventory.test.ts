import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInventoryCommand, isGradingPatch } from '@/lib/domain/inventory-commands';
import { nativeInventorySchema, nativeCommandIntent } from '@/lib/developer-api/storage';

const collectionId = '00900000-0000-4000-8000-000000000011';
const base = {
  operationId: 'synthetic-090-patch',
  inventoryRevision: 3,
  collections: [{ collectionId, version: 1, layoutRevision: 0 }],
};
const item = { itemId: 'synthetic-copy', itemVersion: 2, placement: null };
const patch = {
  ...base,
  commands: [{ kind: 'patchGrading', item, patch: { grade: null, labelVariant: null, subgrades: [] } }],
};

test('public grading patches preserve omission and explicit null without accepting private fields', () => {
  assert.deepEqual(parseInventoryCommand(patch), patch);
  for (const value of [
    {},
    null,
    { certificate: null },
    { assetIds: [] },
    { legacySource: null },
    { provider: null },
    { grade: '' },
    { labelVariant: '' },
    { label: { variant: null } },
  ]) {
    assert.equal(isGradingPatch(value), false, JSON.stringify(value));
    assert.throws(() => parseInventoryCommand({ ...base, commands: [{ kind: 'patchGrading', item, patch: value }] }));
  }
  assert.equal(isGradingPatch({ grade: null }), true);
  assert.equal(isGradingPatch({ holder: 'Synthetic holder' }), true);
  const preserving = { ...patch, privateFields: 'preserve', expectedOwnerUserId: collectionId };
  assert.equal(nativeInventorySchema.safeParse(preserving).success, true);
  assert.deepEqual(
    nativeCommandIntent(preserving),
    patch,
    'original patch intent reaches SQL without metadata reconstruction',
  );
  assert.equal(nativeInventorySchema.safeParse({ ...preserving, expectedOwnerUserId: undefined }).success, false);
  assert.deepEqual(parseInventoryCommand({ ...base, commands: [{ kind: 'edit', item, grading: null }] }).commands, [
    { kind: 'edit', item, grading: null },
  ]);
});

test('selected public want requires a bounded exact index, destination versions and no hidden values', () => {
  const selected = {
    ...base,
    commands: [
      {
        kind: 'assign',
        selection: { kind: 'existing', inventoryItemId: item.itemId, itemVersion: item.itemVersion },
        destination: {
          collectionId,
          slot: { id: 'synthetic-slot', version: 4, inventoryItemId: null, itemVersion: null, placementVersion: null },
        },
        occupied: 'cancel',
        fulfillWant: {
          index: 1,
          expectedPublic: { card_id: 'synthetic-card', card_name: 'Synthetic', added_at: '2020-01-01' },
        },
      },
    ],
  };
  assert.deepEqual(parseInventoryCommand(selected), selected);
  assert.equal(
    nativeInventorySchema.safeParse({ ...selected, privateFields: 'preserve', expectedOwnerUserId: collectionId })
      .success,
    true,
  );
  for (const fulfillWant of [
    { ...selected.commands[0].fulfillWant, index: 100 },
    { ...selected.commands[0].fulfillWant, index: -1 },
    { ...selected.commands[0].fulfillWant, expected: selected.commands[0].fulfillWant.expectedPublic },
    ...['wanted_by', 'card_image', 'legacy_source'].map((key) => ({
      index: 0,
      expectedPublic: { ...selected.commands[0].fulfillWant.expectedPublic, [key]: null },
    })),
  ]) {
    assert.throws(() => parseInventoryCommand({ ...selected, commands: [{ ...selected.commands[0], fulfillWant }] }));
    assert.equal(
      nativeInventorySchema.safeParse({ ...selected, commands: [{ ...selected.commands[0], fulfillWant }] }).success,
      false,
    );
  }
});
