import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectionDeletionEvidence, prepareCollectionDeletion } from '@/lib/native-collection-deletion';
import { projectSlotIntent } from '@/lib/collection/slot-optimistic';
import { createSlotOfflineQueue } from '@/lib/collection/slot-offline-queue';
import { createMemoryStore } from '@/lib/offline-store/kv';
import { parseInventoryCommand } from '@/lib/domain/inventory-commands';
import { emptyGradingRecord } from '@/lib/grading/draft';
import { deletionRead, deletionCollection, deletionRemaining, deletionOwner } from './fixtures/collection-deletion';

const context = {
  source: 'app' as const,
  clientId: null,
  operationId: 'synthetic-delete-operation',
  batchId: null,
  clientOccurredAt: '2026-01-01',
};
for (const count of [0, 1025, 4096])
  test(`whole ${count}-slot preview keeps every exact target, want and physical copy in one bounded command`, async () => {
    const read = await deletionRead(count);
    if (read.evidence.kind !== 'complete') throw new Error('fixture');
    const before = structuredClone(read.evidence.snapshot);
    const draft = prepareCollectionDeletion(read, deletionCollection, deletionRemaining, context);
    assert.deepEqual(draft.counts, {
      slots: count,
      targets: count,
      wants: count,
      cards: count,
      graded: 0,
      removed: 0,
      unassigned: count,
    });
    assert.equal('removeOwned' in draft.intent.request.commands[0], false);
    assert.equal(draft.intent.kind, 'inventory');
    assert.equal(draft.intent.request.commands.length, 1);
    assert.deepEqual(
      draft.rows.map((r) => r.slot.id),
      before.binders[0].slots.map((s) => s.id),
    );
    const after = projectSlotIntent(read.evidence.snapshot, draft.intent, () => undefined);
    assert.deepEqual(after.items, before.items);
    assert.deepEqual(after.placements, []);
    assert.deepEqual(
      after.collections.map((c) => c.id),
      [deletionRemaining],
    );
    assert.deepEqual(read.evidence.snapshot, before);
  });
test('unknown default, cached/clone/mixed legacy evidence, last collection, implicit or invalid replacements fail closed', async () => {
  const read = await deletionRead();
  if (read.evidence.kind !== 'complete') throw new Error('fixture');
  assert.throws(() => prepareCollectionDeletion(read, deletionCollection, null, context), /replacement/);
  assert.throws(() => prepareCollectionDeletion(read, deletionCollection, deletionCollection, context), /replacement/);
  assert.throws(() => prepareCollectionDeletion(read, deletionRemaining, deletionCollection, context), /replacement/);
  for (const r of [
    structuredClone(read),
    { ...read, defaultCollectionId: undefined },
    { ...read, partnerUserId: undefined },
    { ...read, evidence: { ...read.evidence, kind: 'cached' as const } },
  ])
    assert.throws(() => collectionDeletionEvidence(r));
  if (read.evidence.kind !== 'complete') throw new Error('fixture');
  read.evidence.snapshot.collections.pop();
  read.evidence.snapshot.binders.pop();
  assert.throws(() => prepareCollectionDeletion(read, deletionCollection, deletionRemaining, context), /at least one/);
});
test('owner/session/default/partner/revisions and exact wants fence an existing review', async () => {
  const read = await deletionRead(),
    evidence = collectionDeletionEvidence(read);
  for (const mutate of [
    () => {
      read.scope.sessionId += 'changed';
    },
    () => {
      read.defaultCollectionId = deletionRemaining;
    },
    () => {
      read.partnerUserId = 'another-partner';
    },
    () => {
      if (read.evidence.kind === 'complete') read.evidence.snapshot.inventoryRevision++;
    },
    () => {
      if (read.evidence.kind === 'complete') read.evidence.snapshot.binders[0].slots[0].wantedCards.pop();
    },
  ]) {
    mutate();
    assert.notEqual(collectionDeletionEvidence(read), evidence);
  }
});
test('queue atomically fences competing ordinary work, exclusive deletion and unverified planning bases', async () => {
  const read = await deletionRead();
  if (read.evidence.kind !== 'complete') throw new Error('fixture');
  const snapshot = read.evidence.snapshot,
    draft = prepareCollectionDeletion(read, deletionCollection, deletionRemaining, context);
  const queue = createSlotOfflineQueue(createMemoryStore(), {
    deviceId: 'synthetic-device',
    workspaceId: 'holofolder',
    accountId: deletionOwner,
    ownerUserId: deletionOwner,
  });
  await queue.saveSnapshot(snapshot);
  await assert.rejects(
    queue.enqueue(draft.intent, () => undefined),
    /verified-complete/,
  );
  const ordinary = {
    kind: 'slots' as const,
    context: { ...context, operationId: 'synthetic-ordinary' },
    request: {
      operationId: 'synthetic-ordinary',
      inventoryRevision: 7,
      collectionId: deletionRemaining,
      collectionVersion: 3,
      layoutRevision: 0,
      commands: [{ kind: 'create' as const, ids: ['synthetic-new-slot'], beforeSlotId: null }],
    },
  };
  await queue.enqueue(ordinary, () => undefined);
  await assert.rejects(
    queue.enqueue(draft.intent, () => undefined, snapshot),
    /verified-complete/,
  );
  const emptyQueue = createSlotOfflineQueue(createMemoryStore(), {
    deviceId: 'synthetic-device',
    workspaceId: 'holofolder',
    accountId: deletionOwner,
    ownerUserId: deletionOwner,
  });
  await emptyQueue.saveSnapshot(snapshot);
  await emptyQueue.enqueue(draft.intent, () => undefined, snapshot);
  await emptyQueue.enqueue(draft.intent, () => undefined, snapshot);
  assert.equal((await emptyQueue.read()).pending.length, 1);
  await assert.rejects(
    emptyQueue.enqueue(ordinary, () => undefined),
    /deletion-pending/,
  );
});

test('unresolved recovery and preserved legacy work fence deletion inside the same queue transaction', async () => {
  const read = await deletionRead();
  if (read.evidence.kind !== 'complete') throw new Error('fixture');
  const scope = {
    deviceId: 'synthetic-device',
    workspaceId: 'holofolder',
    accountId: deletionOwner,
    ownerUserId: deletionOwner,
  };
  const draft = prepareCollectionDeletion(read, deletionCollection, deletionRemaining, context);
  const recoveryQueue = createSlotOfflineQueue(createMemoryStore(), scope);
  await recoveryQueue.saveSnapshot(read.evidence.snapshot);
  await recoveryQueue.retainRecovery(
    {
      operation: 'recovery.apply',
      request: {
        eventId: '101',
        restoreUnassignedItemIds: [],
        planVersion: 1,
        planToken: 'a'.repeat(64),
        operationId: 'synthetic-recovery',
        confirmed: true,
      },
      context: { source: 'app', clientId: scope.deviceId, clientOccurredAt: context.clientOccurredAt },
    },
    () => scope,
  );
  await assert.rejects(
    recoveryQueue.enqueue(draft.intent, () => undefined, read.evidence.snapshot),
    /recovery-pending/,
  );
  const legacyQueue = createSlotOfflineQueue(createMemoryStore(), scope);
  await legacyQueue.saveSnapshot(read.evidence.snapshot);
  await legacyQueue.preserveLegacy({
    workspaceId: 'holofolder',
    collectionId: deletionCollection,
    rawSnapshot: null,
    rawQueue: 'synthetic preserved unknown intent',
  });
  await assert.rejects(
    legacyQueue.enqueue(draft.intent, () => undefined, read.evidence.snapshot),
    /verified-complete/,
  );
});

test('503 retains exact original whole-collection intent and a historical reply cannot ACK without fresh complete read', async () => {
  const read = await deletionRead();
  if (read.evidence.kind !== 'complete') throw new Error('fixture');
  const snapshot = read.evidence.snapshot,
    scope = {
      deviceId: 'synthetic-device',
      workspaceId: 'holofolder',
      accountId: deletionOwner,
      ownerUserId: deletionOwner,
    };
  const store = createMemoryStore(),
    queue = createSlotOfflineQueue(store, scope);
  const draft = prepareCollectionDeletion(read, deletionCollection, deletionRemaining, context);
  await queue.saveSnapshot(snapshot);
  await queue.enqueue(draft.intent, () => undefined, snapshot);
  await queue.replay(
    async (original) => {
      assert.deepEqual(original, draft.intent);
      return { status: 503 };
    },
    () => scope,
    100,
    () => undefined,
    async () => {
      throw new Error('must-not-read');
    },
  );
  assert.deepEqual((await createSlotOfflineQueue(store, scope).read()).pending[0].intent, draft.intent);
  await queue.resume(context.operationId);
  await queue.replay(
    async () => ({ status: 200, operationId: context.operationId, inventoryRevision: 8 }),
    () => scope,
    Date.now(),
    () => undefined,
    async () => snapshot,
  );
  assert.equal((await queue.read()).receipts.length, 0);
  assert.deepEqual((await queue.read()).pending[0].intent, draft.intent);
});

test('oversized collections fail closed without truncation, splitting or manual clearing guidance', async () => {
  const read = await deletionRead(4097);
  assert.throws(
    () => prepareCollectionDeletion(read, deletionCollection, deletionRemaining, context),
    /4096-slot atomic deletion bound/,
  );
});

test('removeOwned removes the binder raw copies in the same command and keeps graded ones Unassigned', async () => {
  const read = await deletionRead(3);
  if (read.evidence.kind !== 'complete') throw new Error('fixture');
  const graded = read.evidence.snapshot.items[0];
  graded.identity = { kind: 'card', cardId: 'synthetic-graded-card' };
  graded.grading = emptyGradingRecord();
  const unrelated = { ...read.evidence.snapshot.items[1], id: 'synthetic-unplaced-copy' };
  read.evidence.snapshot.items.push(unrelated);
  const draft = prepareCollectionDeletion(read, deletionCollection, deletionRemaining, context, true);
  assert.deepEqual(draft.counts, { slots: 3, targets: 3, wants: 3, cards: 3, graded: 1, removed: 2, unassigned: 1 });
  assert.equal(draft.intent.request.commands.length, 1);
  assert.deepEqual(parseInventoryCommand(draft.intent.request), draft.intent.request);
  const after = projectSlotIntent(read.evidence.snapshot, draft.intent, () => undefined);
  assert.deepEqual(after.items.map((i) => i.id).sort(), [graded.id, unrelated.id].sort());
  assert.deepEqual(after.placements, []);
});
test('deleteCollection accepts removeOwned only as true', () => {
  const request = (extra: object) => ({
    operationId: 'synthetic-delete-operation',
    inventoryRevision: 7,
    collections: [{ collectionId: deletionCollection, version: 3, layoutRevision: 4 }],
    commands: [
      {
        kind: 'deleteCollection',
        collectionId: deletionCollection,
        slots: [],
        replacementDefaultCollectionId: null,
        ...extra,
      },
    ],
  });
  assert.doesNotThrow(() => parseInventoryCommand(request({})));
  assert.doesNotThrow(() => parseInventoryCommand(request({ removeOwned: true })));
  for (const removeOwned of [false, 'true', 1]) assert.throws(() => parseInventoryCommand(request({ removeOwned })));
});
