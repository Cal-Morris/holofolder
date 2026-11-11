import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSlotCommand, readSlotPage } from '../lib/server/operations/binder-slots';

const binder = '03620000-0000-4000-8000-000000000011';
const command = () => ({
  collectionId: binder,
  operationId: 'synthetic-operation',
  inventoryRevision: 0,
  collectionVersion: 0,
  layoutRevision: 0,
  commands: [{ kind: 'create', ids: ['synthetic-slot'], beforeSlotId: null }],
});
describe('slot command contract', () => {
  test('accepts bounded blank insertion without manufacturing inventory', () =>
    assert.deepEqual(parseSlotCommand(command()), command()));
  test('rejects actor/source spoofing, unknown fields, mixed binders and oversized work', () => {
    for (const input of [
      { ...command(), actor: 'other' },
      { ...command(), source: 'system' },
      { ...command(), commands: [{ ...command().commands[0], collectionId: binder }] },
      { ...command(), commands: Array.from({ length: 101 }, () => command().commands[0]) },
      {
        ...command(),
        commands: [{ kind: 'create', ids: Array.from({ length: 257 }, (_, i) => `slot-${i}`), beforeSlotId: null }],
      },
      { ...command(), inventoryRevision: -1 },
      { ...command(), commands: [{ kind: 'clear', slots: [{ id: 'x', version: 0 }] }] },
    ])
      assert.throws(() => parseSlotCommand(input));
  });
  test('paging validates scope, bounds and revision token and propagates errors', async () => {
    const calls: unknown[] = [];
    const page = await readSlotPage(
      async (input) => {
        calls.push(input);
        return {
          inventoryRevision: 7,
          collectionVersion: 2,
          layoutRevision: 3,
          slots: [{ id: 'x', position: 0 }],
          nextPosition: 0,
        };
      },
      { ownerUserId: 'owner', actorId: 'actor', collectionId: binder, limit: 1 },
    );
    assert.equal(page.nextPosition, 0);
    assert.equal(calls.length, 1);
    await assert.rejects(
      readSlotPage(
        async () => {
          throw new Error('denied');
        },
        { ownerUserId: 'owner', actorId: 'actor', collectionId: binder, limit: 1 },
      ),
      /denied/,
    );
    await assert.rejects(
      readSlotPage(async () => page, { ownerUserId: 'owner', actorId: 'actor', collectionId: binder, limit: 501 }),
    );
    await assert.rejects(
      readSlotPage(async () => page, {
        ownerUserId: 'owner',
        actorId: 'actor',
        collectionId: binder,
        limit: 1,
        afterPosition: 0,
      }),
    );
  });
});
