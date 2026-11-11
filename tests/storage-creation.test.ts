import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCollectionCreation,
  projectCollectionCreation,
  COLLECTION_CREATION_LIMITS,
} from '@/lib/domain/storage-creation';
import { blankPreset, speciesPreset } from '@/lib/binder-creation-draft';
import {
  parseStorageRequest,
  normalizeStorageResult,
  storageExecutionError,
} from '@/lib/server/operations/storage-contract';

const owner = '00830000-0000-4000-8000-000000000001';
export const command = {
  version: 1,
  operationId: 'synthetic-creation-1',
  inventoryRevision: 0,
  collectionId: '00830000-0000-4000-8000-000000000011',
  name: 'Synthetic collection',
  kind: 'binder',
  defaultPresentation: 'binder',
  location: null,
  grid: null,
  manifest: blankPreset(),
  slotIds: [],
};
test('creation strictly parses detached intent, never a UI owner or attribution', () => {
  assert.deepEqual(parseCollectionCreation(command), command);
  assert.deepEqual(parseStorageRequest('collection.create', command), command);
  for (const extra of [
    { ownerUserId: owner },
    { actor: owner },
    { source: 'app' },
    { context: {} },
    { status: 'collected' },
  ]) {
    assert.throws(() => parseCollectionCreation({ ...command, ...extra }));
  }
  for (const extra of [
    { version: 2 },
    { name: ' ' },
    { name: 'x'.repeat(41) },
    { name: 'two  spaces' },
    { kind: 'box' },
    { defaultPresentation: 'slabs' },
    { inventoryRevision: -1 },
    { grid: { rows: 9, cols: 4 } },
    { grid: { rows: 4 } },
    { location: 'location' },
    { slotIds: ['unmatched'] },
  ]) {
    assert.throws(() => parseCollectionCreation({ ...command, ...extra }));
  }
  assert.equal(
    parseCollectionCreation({ ...command, kind: 'custom', defaultPresentation: 'list', location: 'Shelf 1' }).location,
    'Shelf 1',
  );
  assert.equal(parseCollectionCreation({ ...command, kind: 'slab', defaultPresentation: 'slabs' }).kind, 'slab');
});
test('pure projection copies exact ordered provenance, blank has no padding and targets cost zero', () => {
  const manifest = speciesPreset('Synthetic multispecies', [925, 924, 143]);
  const input = { ...command, manifest, slotIds: ['third', 'first', 'second'] };
  const plan = projectCollectionCreation(input, owner);
  assert.deepEqual(
    plan.slots.map((s) => s.id),
    input.slotIds,
  );
  assert.deepEqual(
    plan.slots.map((s) => s.target),
    manifest.entries.map((e) => e.target),
  );
  assert.ok(
    plan.slots.every(
      (s) => s.ownerUserId === owner && s.inventoryItemId === null && s.status === null && s.wantedCards.length === 0,
    ),
  );
  assert.deepEqual(plan.slots[0].presetOrigin, { source: manifest.source, entryId: manifest.entries[0].id });
  manifest.entries.reverse();
  assert.equal(plan.slots[0].target?.kind === 'pokemon' && plan.slots[0].target.pokemonId, 925);
  assert.equal(projectCollectionCreation(command, owner).slots.length, 0);
});
test('creation admits entire Dex and 4096 entries without the 256 slot-edit batch limit', () => {
  for (const count of [151, 1025, 4096]) {
    const manifest = {
      source: { id: 'synthetic', version: '1' },
      name: 'Synthetic bounds',
      entries: Array.from({ length: count }, (_, i) => ({
        id: `entry-${i}`,
        target: { kind: 'pokemon', pokemonId: (i % 1025) + 1 },
      })),
    };
    const input = { ...command, manifest, slotIds: manifest.entries.map((e) => `slot-${e.id}`) };
    assert.equal(projectCollectionCreation(input, owner).slots.length, count);
    if (count === 4096) {
      assert.throws(() =>
        parseCollectionCreation({
          ...input,
          manifest: { ...manifest, entries: [...manifest.entries, { id: 'extra', target: null }] },
          slotIds: [...input.slotIds, 'extra'],
        }),
      );
      assert.throws(() => parseCollectionCreation({ ...input, slotIds: input.slotIds.map(() => 'duplicate') }));
    }
  }
  assert.equal(COLLECTION_CREATION_LIMITS.capacity, 4096);
  assert.throws(() =>
    parseCollectionCreation({
      ...command,
      manifest: speciesPreset('Synthetic', [1]),
      slotIds: ['x'],
      name: 'x'.repeat(COLLECTION_CREATION_LIMITS.bytes),
    }),
  );
  assert.throws(() =>
    parseCollectionCreation({
      ...command,
      manifest: { ...blankPreset(), entries: [{ id: 'bad', target: { kind: 'pokemon', pokemonId: 1026 } }] },
      slotIds: ['bad'],
    }),
  );
});
test('creation receipts omit evidence, validate exact identities and expose honest recovery gate', () => {
  const receipt = {
    collectionId: command.collectionId,
    inventoryRevision: 1,
    collectionVersion: 0,
    layoutRevision: 0,
    changed: true,
    slotIds: [],
    recoverySupported: false,
  };
  assert.deepEqual(
    normalizeStorageResult('collection.create', { ...receipt, evidence: { certificate: 'private' } }),
    receipt,
  );
  assert.throws(() => normalizeStorageResult('collection.create', { ...receipt, recoverySupported: true }));
  assert.throws(() => normalizeStorageResult('collection.create', { ...receipt, slotIds: ['same', 'same'] }));
  assert.equal(storageExecutionError({ code: 'P0001', message: 'binder_limit_reached' }).status, 402);
  assert.equal(storageExecutionError({ code: 'P0001', message: 'upgrade_required' }).status, 402);
});

test('native creation is registered independently from the legacy schema', async () => {
  const { matchRestOperation, DEVELOPER_OPERATIONS } = await import('@/lib/developer-api/operations');
  assert.equal(matchRestOperation('POST', '/storage/collections')?.operation.admission, undefined);
  assert.equal(
    DEVELOPER_OPERATIONS.find((op) => op.name === 'create_binder')?.schema.safeParse(command).success,
    false,
  );
});
