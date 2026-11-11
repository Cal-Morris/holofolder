import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInventoryCommand } from '../lib/domain/inventory-commands';
import { projectSlotIntent } from '../lib/collection/slot-optimistic';
import { planReleaseInventorySlots } from '../lib/inventory-plans';
import type { InventorySnapshot } from '../lib/domain/inventory';

const owner = '03830000-0000-4000-8000-000000000001';
const collectionId = '03830000-0000-4000-8000-000000000011';
const remaining = '03830000-0000-4000-8000-000000000012';
const context = {
  source: 'app' as const,
  clientId: null,
  operationId: 'synthetic-whole-collection',
  batchId: null,
  clientOccurredAt: null,
};
// Synthetic repeated physical copies, goals, spacers and explicit wants, never real inventory.
function fixture(count: number) {
  const slots = Array.from({ length: count }, (_, n) => ({
    id: `synthetic/slot-${n}`,
    ownerUserId: owner,
    collectionId,
    target: n % 4 === 3 ? null : { kind: 'pokemon' as const, pokemonId: (n % 1025) + 1 },
    inventoryItemId: n % 4 === 0 ? `synthetic/copy-${n}` : null,
    wantedCards:
      n % 4 === 2 ? [{ card_id: 'synthetic-card', card_name: 'Synthetic', added_at: '2020-01-01T00:00:00Z' }] : [],
    status: n % 4 === 0 ? ('collected' as const) : null,
    version: 0,
    presetOrigin: null,
  }));
  const snapshot: InventorySnapshot = {
    ownerUserId: owner,
    inventoryRevision: 0,
    items: slots
      .filter((s) => s.inventoryItemId)
      .map((s) => ({
        id: s.inventoryItemId!,
        ownerUserId: owner,
        identity: { kind: 'card', cardId: 'synthetic-card' },
        grading: {
          provider: { kind: 'known', id: 'psa' },
          grade: '10',
          scale: null,
          designation: null,
          subgrades: [],
          certificate: '000123',
          holder: null,
          label: { variant: null, assetIds: [] },
        },
        acquiredAt: '2020-01-01T00:00:00Z',
        version: 0,
      })),
    placements: slots
      .filter((s) => s.inventoryItemId)
      .map((s) => ({ inventoryItemId: s.inventoryItemId!, slotId: s.id, collectionId, version: 0 })),
    collections: [collectionId, remaining].map((id) => ({
      id,
      ownerUserId: owner,
      name: 'Synthetic',
      kind: 'binder',
      defaultPresentation: 'binder',
      version: 0,
    })),
    binders: [
      { collectionId, ownerUserId: owner, layoutRevision: 0, presetManifest: null, slots },
      {
        collectionId: remaining,
        ownerUserId: owner,
        layoutRevision: 0,
        presetManifest: null,
        slots: [{ ...slots[1], id: 'synthetic/remaining', collectionId: remaining }],
      },
    ],
  };
  const command = {
    kind: 'deleteCollection' as const,
    collectionId,
    replacementDefaultCollectionId: null,
    slots: slots.map((s) => ({
      id: s.id,
      version: s.version,
      inventoryItemId: s.inventoryItemId,
      itemVersion: s.inventoryItemId ? 0 : null,
      placementVersion: s.inventoryItemId ? 0 : null,
    })),
  };
  const request = {
    operationId: context.operationId,
    inventoryRevision: 0,
    collections: [{ collectionId, version: 0, layoutRevision: 0 }],
    commands: [command],
  };
  return { snapshot, request, command };
}
for (const count of [1025, 4096])
  test(`atomic ${count}-slot deletion parses, releases and projects without losing physical copies`, () => {
    const { snapshot, request } = fixture(count),
      before = structuredClone(snapshot);
    assert.deepEqual(parseInventoryCommand(request), request);
    const release = planReleaseInventorySlots(snapshot, {
      inventoryRevision: 0,
      context: {
        ...context,
        actor: { kind: 'unknown' },
        affectedEntities: { inventoryItemIds: [], slotIds: [], collectionIds: [] },
      },
      collectionId,
      layoutRevision: 0,
      slotVersions: Object.fromEntries(request.commands[0].slots.map((s) => [s.id, s.version])),
    });
    assert.equal(release.ok, true);
    if (release.ok) {
      assert.deepEqual(release.snapshot.items, before.items);
      assert.deepEqual(release.snapshot.placements, []);
    }
    const projected = projectSlotIntent(snapshot, { kind: 'inventory', request, context }, () => undefined);
    assert.deepEqual(projected.items, before.items);
    assert.deepEqual(projected.placements, []);
    assert.deepEqual(projected.binders, [before.binders[1]]);
    assert.equal(projected.inventoryRevision, 1);
    assert.deepEqual(snapshot, before);
    assert.throws(
      () =>
        projectSlotIntent(
          snapshot,
          {
            kind: 'inventory',
            request: { ...request, commands: [{ ...request.commands[0], slots: request.commands[0].slots.slice(1) }] },
            context,
          },
          () => undefined,
        ),
      /partial-collection/,
    );
    const stale = structuredClone(request);
    stale.commands[0].slots[0].version++;
    assert.throws(
      () => projectSlotIntent(snapshot, { kind: 'inventory', request: stale, context }, () => undefined),
      /slot-conflict/,
    );
  });
test('large deletion is an exclusive intent with finite capacity; ordinary batch limits stay unchanged', () => {
  const { request, command } = fixture(4096);
  assert.throws(() => parseInventoryCommand({ ...request, commands: [command, command] }));
  assert.throws(() => parseInventoryCommand(fixture(4097).request));
  assert.throws(() =>
    parseInventoryCommand({
      ...request,
      commands: [{ kind: 'removeSlots', slots: command.slots.map((slot) => ({ collectionId, slot })) }],
    }),
  );
  const small = fixture(257);
  assert.throws(() =>
    parseInventoryCommand({
      ...small.request,
      commands: [{ kind: 'removeSlots', slots: small.command.slots.map((slot) => ({ collectionId, slot })) }],
    }),
  );
});

test('deletion accepts maximum-length UTF-8 preconditions but rejects excess declared scope', () => {
  const { request } = fixture(4096);
  request.commands[0].slots = request.commands[0].slots.map((s, n) => ({
    ...s,
    id: '界'.repeat(190) + n,
    inventoryItemId: '語'.repeat(190) + n,
    itemVersion: 0,
    placementVersion: 0,
  }));
  assert.ok(new TextEncoder().encode(JSON.stringify(request)).length > 4 * 1024 * 1024);
  assert.deepEqual(parseInventoryCommand(request), request);
  const escaped = structuredClone(request);
  escaped.commands[0].slots.forEach((s, n) => {
    s.id = '\u0001'.repeat(190) + n;
    s.inventoryItemId = '\u0002'.repeat(190) + n;
  });
  assert.ok(new TextEncoder().encode(JSON.stringify(escaped)).length > 8 * 1024 * 1024);
  assert.throws(() => parseInventoryCommand(escaped));
  assert.throws(() =>
    parseInventoryCommand({
      ...request,
      collections: [
        ...request.collections,
        { collectionId: remaining, version: 0, layoutRevision: 0 },
        { collectionId: owner, version: 0, layoutRevision: 0 },
      ],
    }),
  );
});
