import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVELOPER_OPERATIONS } from '@/lib/developer-api/operations';
import spec from '@/public/openapi.json';
import { formatEndpointMarkdown } from '@/lib/docs-markdown';

const owner = '00820000-0000-4000-8000-000000000001';
const collectionId = '00830000-0000-4000-8000-000000000011';
const slot = { id: 'synthetic-slot', version: 3, inventoryItemId: null, itemVersion: null, placementVersion: null };
const item = { itemId: 'synthetic-copy', itemVersion: 4, placement: null };
const inventory = {
  operationId: 'synthetic-private-mode',
  inventoryRevision: 7,
  collections: [{ collectionId, version: 2, layoutRevision: 1 }],
};
const slots = {
  operationId: inventory.operationId,
  inventoryRevision: 7,
  collectionId,
  collectionVersion: 2,
  layoutRevision: 1,
};
const schema = (name: string) => DEVELOPER_OPERATIONS.find((op) => op.name === name)!.schema;
const selected = { index: 0, expected: { card_id: 'synthetic-card', card_name: 'Synthetic', added_at: '2020-01-01' } };

test('private preserving commands use current redacted preconditions without replacing private fields', () => {
  for (const command of [
    { kind: 'unassign', item },
    { kind: 'removeOwned', item },
    {
      kind: 'assign',
      selection: { kind: 'existing', inventoryItemId: item.itemId, itemVersion: item.itemVersion },
      destination: { collectionId, slot },
      occupied: 'cancel',
      fulfillWant: null,
    },
    {
      kind: 'add',
      itemId: 'synthetic-new-copy',
      identity: { kind: 'pokemon', pokemonId: 1 },
      grading: null,
      acquiredAt: null,
    },
  ])
    assert.equal(
      schema('execute_inventory_commands').safeParse({
        ...inventory,
        privateFields: 'preserve',
        expectedOwnerUserId: owner,
        commands: [command],
      }).success,
      true,
      command.kind,
    );
  for (const command of [
    { kind: 'update', slot, target: null },
    { kind: 'create', ids: ['synthetic-new-slot'], beforeSlotId: null },
    { kind: 'move', slots: [slot], beforeSlotId: null },
  ])
    assert.equal(
      schema('execute_slot_commands').safeParse({
        ...slots,
        privateFields: 'preserve',
        expectedOwnerUserId: owner,
        commands: [command],
      }).success,
      true,
      command.kind,
    );
});

test('preserving mode rejects whole grading/wants replacement, selected redacted wants and destructive slot clearing', () => {
  for (const command of [
    { kind: 'edit', item, grading: null },
    {
      kind: 'assign',
      selection: { kind: 'existing', inventoryItemId: item.itemId, itemVersion: item.itemVersion },
      destination: { collectionId, slot },
      occupied: 'cancel',
      fulfillWant: selected,
    },
    { kind: 'removeSlots', slots: [{ collectionId, slot }] },
    { kind: 'deleteCollection', collectionId, slots: [slot], replacementDefaultCollectionId: null },
  ]) {
    assert.equal(
      schema('execute_inventory_commands').safeParse({
        ...inventory,
        privateFields: 'preserve',
        expectedOwnerUserId: owner,
        commands: [command],
      }).success,
      false,
      command.kind,
    );
    for (const mode of [undefined, 'replace'])
      assert.equal(
        schema('execute_inventory_commands').safeParse({
          ...inventory,
          ...(mode ? { privateFields: mode } : {}),
          commands: [command],
        }).success,
        true,
        command.kind,
      );
  }
  for (const command of [
    { kind: 'update', slot, wantedCards: [] },
    { kind: 'update', slot, target: null, wantedCards: [selected.expected] },
    { kind: 'clear', slots: [slot] },
    { kind: 'remove', slots: [slot] },
  ]) {
    assert.equal(
      schema('execute_slot_commands').safeParse({
        ...slots,
        privateFields: 'preserve',
        expectedOwnerUserId: owner,
        commands: [command],
      }).success,
      false,
      command.kind,
    );
    for (const mode of [undefined, 'replace'])
      assert.equal(
        schema('execute_slot_commands').safeParse({
          ...slots,
          ...(mode ? { privateFields: mode } : {}),
          commands: [command],
        }).success,
        true,
        command.kind,
      );
  }
});

test('mode never weakens canonical validation or admits authority or incomplete read DTOs', () => {
  const value = {
    ...slots,
    privateFields: 'preserve',
    expectedOwnerUserId: owner,
    commands: [{ kind: 'update', slot, target: null }],
  };
  for (const change of [
    { privateFields: 'guess' },
    { expectedOwnerUserId: undefined },
    { ownerUserId: collectionId },
    { inventoryRevision: -1 },
    { completeSnapshot: false },
    { commands: [{ kind: 'update', slot: { ...slot, placementVersion: 2 }, target: null }] },
    { commands: [{ kind: 'update', slot, grading: null }] },
  ])
    assert.equal(schema('execute_slot_commands').safeParse({ ...value, ...change }).success, false);
});

test('generated API and agent reference exports describe preserve and replacement compatibility', () => {
  for (const path of ['/storage/slots/commands', '/storage/inventory/commands'] as const) {
    const op = spec.paths[path].post;
    const field = op.requestBody.content['application/json'].schema.properties.privateFields;
    assert.deepEqual(field.enum, ['preserve', 'replace']);
    assert.match(field.description, /legacy default/);
    assert.match(op.description, /full-replacement/);
    const markdown = formatEndpointMarkdown({
      title: op.operationId,
      url: '/docs/reference/collection/' + op.operationId.replaceAll('_', '-'),
      method: 'POST',
      path,
      operation: op,
    });
    assert.match(markdown, /privateFields/);
    assert.doesNotMatch(markdown, /native_operations_staged/);
  }
});
