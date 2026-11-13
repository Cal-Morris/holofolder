import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '@/lib/offline-store/kv';
import { blockedDiscardable, createSlotOfflineQueue, offlineScopeKey } from '@/lib/collection/slot-offline-queue';
import { readCompleteInventorySnapshot } from '@/lib/collection/slot-snapshot';
import { projectSlotIntent } from '@/lib/collection/slot-optimistic';
import type { InventorySnapshot } from '@/lib/domain/inventory';
import type { SlotCommandRequest } from '@/lib/domain/slot-commands';

// Every identity, card and account in this suite is synthetic.
const collectionId = '00000000-0000-4000-8000-000000000001';
const scope = {
  deviceId: 'synthetic-device',
  workspaceId: 'synthetic-workspace',
  accountId: 'account-a',
  ownerUserId: 'owner-a',
};
const context = {
  source: 'app' as const,
  clientId: 'synthetic-device',
  batchId: 'synthetic-batch',
  clientOccurredAt: '2026-01-01T00:00:00Z',
};
function snapshot(): InventorySnapshot {
  return {
    ownerUserId: scope.ownerUserId,
    inventoryRevision: 1,
    items: [],
    placements: [],
    collections: [
      {
        id: collectionId,
        ownerUserId: scope.ownerUserId,
        name: 'Synthetic',
        kind: 'binder',
        defaultPresentation: 'binder',
        version: 1,
      },
    ],
    binders: [
      {
        ownerUserId: scope.ownerUserId,
        collectionId,
        layoutRevision: 1,
        presetManifest: null,
        slots: ['a', 'b', 'c'].map((id) => ({
          id,
          ownerUserId: scope.ownerUserId,
          collectionId,
          version: 0,
          target: null,
          inventoryItemId: null,
          wantedCards: [],
          status: null,
          presetOrigin: null,
        })),
      },
    ],
  };
}
async function complete(s: InventorySnapshot) {
  const page =
    <T>(rows: T[]) =>
    async () => ({ inventoryRevision: s.inventoryRevision, total: rows.length, rows, next: null });
  return readCompleteInventorySnapshot(s.ownerUserId, s.inventoryRevision, {
    items: page(s.items),
    placements: page(s.placements),
    collections: page(s.collections),
    binders: page(s.binders),
  });
}
function request(operationId = 'operation-one'): SlotCommandRequest {
  return {
    collectionId,
    operationId,
    inventoryRevision: 1,
    collectionVersion: 1,
    layoutRevision: 1,
    commands: [
      {
        kind: 'move',
        slots: [{ id: 'c', version: 0, inventoryItemId: null, itemVersion: null, placementVersion: null }],
        beforeSlotId: 'a',
      },
    ],
  };
}
const intent = (operationId = 'operation-one') => ({
  kind: 'slots' as const,
  request: request(operationId),
  context: { ...context, operationId },
});
const catalog = () => undefined;

describe('staged durable slot intent', () => {
  test('persists before acknowledgment and reopens with original operation and optimistic order', async () => {
    const store = createMemoryStore(),
      queue = createSlotOfflineQueue(store, scope);
    await queue.saveSnapshot(await complete(snapshot()));
    await queue.enqueue(intent(), catalog);
    const restored = await createSlotOfflineQueue(store, scope).read();
    assert.deepEqual(restored.pending[0].intent, intent());
    assert.deepEqual(
      restored.optimistic!.binders[0].slots.map((s) => s.id),
      ['c', 'a', 'b'],
    );
    assert.equal(restored.pending[0].status, 'pending');
  });
  test('a pending edit saved with the retired empty legacy list still reopens', async () => {
    const store = createMemoryStore(),
      queue = createSlotOfflineQueue(store, scope);
    await queue.saveSnapshot(await complete(snapshot()));
    await queue.enqueue(intent(), catalog);
    const saved = await store.get<Record<string, unknown>>(offlineScopeKey(scope));
    await store.set(offlineScopeKey(scope), { ...saved, legacy: [] });
    assert.deepEqual((await createSlotOfflineQueue(store, scope).read()).pending[0].intent, intent());
  });
  test('concurrent tabs append without replacing either durable edit', async () => {
    const store = createMemoryStore(),
      a = createSlotOfflineQueue(store, scope),
      b = createSlotOfflineQueue(store, scope);
    await a.saveSnapshot(await complete(snapshot()));
    const next = intent('operation-two');
    next.request.inventoryRevision = 2;
    next.request.collectionVersion = 2;
    next.request.layoutRevision = 2;
    next.request.commands = [{ kind: 'create', ids: ['new-slot'], beforeSlotId: null }];
    await a.enqueue(intent(), catalog);
    await b.enqueue(next, catalog);
    assert.deepEqual(
      (await a.read()).pending.map((p) => p.intent.request.operationId),
      ['operation-one', 'operation-two'],
    );
  });
  test('storage failure never acknowledges or changes the saved snapshot', async () => {
    const store = createMemoryStore(),
      q = createSlotOfflineQueue(store, scope);
    await q.saveSnapshot(await complete(snapshot()));
    const failing = {
      ...store,
      update: async () => {
        throw new Error('quota');
      },
    };
    await assert.rejects(createSlotOfflineQueue(failing, scope).enqueue(intent(), catalog), /quota/);
    assert.equal((await q.read()).pending.length, 0);
  });
  test('503 and unknown outcome retain exact request and stop after bounded retries', async () => {
    const q = createSlotOfflineQueue(createMemoryStore(), scope);
    await q.saveSnapshot(await complete(snapshot()));
    await q.enqueue(intent(), catalog);
    for (let i = 0; i < 8; i++)
      await q.replay(
        async (sent) => {
          assert.deepEqual(sent, intent());
          return { status: 503 };
        },
        () => scope,
        i * 400000,
      );
    const state = await q.read();
    assert.equal(state.pending.length, 1);
    assert.equal(state.pending[0].status, 'unavailable');
    assert.equal(state.pending[0].attempts, 5);
    assert.deepEqual(state.pending[0].intent, intent());
  });
  test('an expired fifth send lease can explicitly resume the same operation after restart', async () => {
    const store = createMemoryStore(),
      q = createSlotOfflineQueue(store, scope);
    await q.saveSnapshot(await complete(snapshot()));
    await q.enqueue(intent(), catalog);
    for (let i = 0; i < 4; i++)
      await q.replay(
        async () => ({ status: 503 }),
        () => scope,
        i * 400000,
      );
    let active = true;
    const committed = await complete(projectSlotIntent(snapshot(), intent(), catalog));
    await q.replay(
      async () => {
        active = false;
        return { status: 200, operationId: 'operation-one', snapshot: committed };
      },
      () => (active ? scope : null),
      1600000,
    );
    const reopened = createSlotOfflineQueue(store, scope);
    assert.equal((await reopened.read()).pending[0].attempts, 5);
    await assert.rejects(reopened.resume('operation-one', 1659999), /reconciliation/);
    await reopened.resume('operation-one', 1660000);
    await reopened.replay(
      async (sent) => {
        assert.deepEqual(sent, intent());
        return { status: 200, operationId: 'operation-one', snapshot: committed };
      },
      () => scope,
      1660000,
      catalog,
      () => complete(committed),
    );
    assert.equal((await reopened.read()).pending.length, 0);
    assert.equal((await reopened.read()).receipts[0].operationId, 'operation-one');
  });
  test('a fresh complete snapshot older than the commit receipt cannot settle or roll back the saved edit', async () => {
    const q = createSlotOfflineQueue(createMemoryStore(), scope);
    await q.saveSnapshot(await complete(snapshot()));
    await q.enqueue(intent(), catalog);
    const projected = projectSlotIntent(snapshot(), intent(), catalog);
    await q.replay(
      async () => ({ status: 200, operationId: 'operation-one', inventoryRevision: projected.inventoryRevision + 1 }),
      () => scope,
      1000,
      catalog,
      () => complete(projected),
    );
    const state = await q.read();
    assert.equal(state.pending[0].status, 'acknowledged');
    assert.equal(state.receipts.length, 0);
    assert.deepEqual(state.optimistic, projected);
    await assert.rejects(q.saveSnapshot(await complete(projected), catalog), /stale-snapshot/);
  });
  test('permanent media and body-limit errors block without removing intent', async () => {
    for (const status of [405, 413, 415, 422]) {
      const q = createSlotOfflineQueue(createMemoryStore(), scope);
      await q.saveSnapshot(await complete(snapshot()));
      await q.enqueue(intent(), catalog);
      await q.replay(
        async () => ({ status }),
        () => scope,
        1000,
      );
      assert.equal((await q.read()).pending[0].status, 'blocked');
      assert.equal((await q.read()).receipts.length, 0);
    }
  });
  test("account switch during response cannot write or expose another owner's state", async () => {
    const store = createMemoryStore(),
      q = createSlotOfflineQueue(store, scope);
    await q.saveSnapshot(await complete(snapshot()));
    await q.enqueue(intent(), catalog);
    await q.replay(
      async () => ({ status: 200, operationId: 'operation-one', snapshot: snapshot() }),
      () => ({ ...scope, accountId: 'account-b' }),
    );
    assert.equal((await q.read()).pending.length, 1);
    assert.equal((await createSlotOfflineQueue(store, { ...scope, accountId: 'account-b' }).read()).snapshot, null);
  });
  test('409 retains visible original intent and current state; structural reconciliation is explicit', async () => {
    const q = createSlotOfflineQueue(createMemoryStore(), scope);
    await q.saveSnapshot(await complete(snapshot()));
    await q.enqueue(intent(), catalog);
    const remote = snapshot();
    remote.inventoryRevision++;
    remote.binders[0].layoutRevision++;
    await q.replay(
      async () => ({
        status: 409,
        code: 'slot_revision_conflict',
        rejection: {
          outcome: 'rejected',
          operationId: 'operation-one',
          code: 'slot_revision_conflict',
          inventoryRevision: remote.inventoryRevision,
        },
      }),
      () => scope,
      0,
      catalog,
      async () => ({ snapshot: await complete(remote), navigation: { catalog: [], layouts: [] } }),
    );
    const state = await q.read();
    assert.equal(state.pending[0].status, 'conflict');
    assert.deepEqual(state.pending[0].conflict!.current, remote);
    await assert.rejects(q.rebase('operation-one', 'operation-rebased', catalog), /structural/);
    assert.deepEqual((await q.read()).pending[0].intent, intent());
  });
  test('malformed or future persistence fails closed and stays byte-for-byte intact', async () => {
    const raw = { version: 99, pending: [{ private: 'synthetic' }] },
      store = createMemoryStore({ [offlineScopeKey(scope)]: raw });
    const q = createSlotOfflineQueue(store, scope);
    await assert.rejects(q.read(), /unsupported|malformed/);
    await assert.rejects(q.enqueue(intent(), catalog), /unsupported|malformed/);
    assert.deepEqual(await store.get(offlineScopeKey(scope)), raw);
  });
  test('late success must match real local operation ID and be a complete snapshot', async () => {
    const q = createSlotOfflineQueue(createMemoryStore(), scope);
    await q.saveSnapshot(await complete(snapshot()));
    await q.enqueue(intent(), catalog);
    await q.replay(
      async () => ({ status: 200, operationId: 'different', snapshot: snapshot() }),
      () => scope,
    );
    assert.equal((await q.read()).pending.length, 1);
  });
  test('projection cannot silently use another item when an explicit selected copy is missing', () => {
    assert.throws(
      () =>
        projectSlotIntent(
          snapshot(),
          {
            kind: 'inventory',
            context: { ...context, operationId: 'selected-copy' },
            request: {
              operationId: 'selected-copy',
              inventoryRevision: 1,
              collections: [{ collectionId, version: 1, layoutRevision: 1 }],
              commands: [
                {
                  kind: 'assign',
                  selection: { kind: 'existing', inventoryItemId: 'missing-graded-copy', itemVersion: 0 },
                  destination: {
                    collectionId,
                    slot: { id: 'a', version: 0, inventoryItemId: null, itemVersion: null, placementVersion: null },
                  },
                  occupied: 'cancel',
                  fulfillWant: null,
                },
              ],
            },
          },
          catalog,
        ),
      /item-conflict/,
    );
  });
  test('a partial but structurally valid response cannot acknowledge or replace durable intent', async () => {
    const q = createSlotOfflineQueue(createMemoryStore(), scope);
    await assert.rejects(q.saveSnapshot(snapshot()), /partial/);
    await q.saveSnapshot(await complete(snapshot()));
    await q.enqueue(intent(), catalog);
    const partial = snapshot();
    partial.binders[0].slots = [];
    await q.replay(
      async () => ({ status: 200, operationId: 'operation-one', snapshot: partial }),
      () => scope,
    );
    assert.equal((await q.read()).pending.length, 1);
    assert.equal((await q.read()).snapshot!.binders[0].slots.length, 3);
  });
  test('lost response and restart replay the original operation exactly once, preserving concurrent appended work', async () => {
    const store = createMemoryStore(),
      q = createSlotOfflineQueue(store, scope);
    await q.saveSnapshot(await complete(snapshot()));
    await q.enqueue(intent(), catalog);
    const committed = await complete(projectSlotIntent(snapshot(), intent(), catalog));
    let serverCommits = 0,
      committedId: string | null = null;
    const server = async (sent: ReturnType<typeof intent>) => {
      if (!committedId) {
        committedId = sent.request.operationId;
        serverCommits++;
      }
      return { status: 200, operationId: committedId!, snapshot: committed };
    };
    await q.replay(
      async (sent) => {
        await server(sent as ReturnType<typeof intent>);
        throw new Error('lost-response');
      },
      () => scope,
      0,
    );
    const reopened = createSlotOfflineQueue(store, scope);
    await reopened.replay(
      (sent) => server(sent as ReturnType<typeof intent>),
      () => scope,
      400000,
      catalog,
      () => complete(committed),
    );
    assert.equal(serverCommits, 1);
    const state = await reopened.read();
    assert.equal(state.pending.length, 0);
    assert.equal(state.receipts[0].operationId, 'operation-one');
    await reopened.enqueue(intent(), catalog);
    assert.equal((await reopened.read()).pending.length, 0);
  });
  test('a crashed sending lease is reclaimed with the same ID; old late response cannot settle a newer lease', async () => {
    const store = createMemoryStore(),
      q = createSlotOfflineQueue(store, scope);
    await q.saveSnapshot(await complete(snapshot()));
    await q.enqueue(intent(), catalog);
    let finish!: (r: { status: number }) => void;
    const sending = q.replay(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      () => scope,
      0,
    );
    while (!finish) await Promise.resolve();
    const other = createSlotOfflineQueue(store, scope);
    await other.replay(
      async (sent) => {
        assert.equal(sent.request.operationId, 'operation-one');
        return { status: 503 };
      },
      () => scope,
      61000,
    );
    finish({ status: 409 });
    await sending;
    const p = (await q.read()).pending[0];
    assert.equal(p.attempts, 2);
    assert.equal(p.status, 'unavailable');
  });
  test('billing and unlink errors retain all intent, unknown outcomes cannot be cancelled', async () => {
    for (const status of [402, 403, 0]) {
      const q = createSlotOfflineQueue(createMemoryStore(), scope);
      await q.saveSnapshot(await complete(snapshot()));
      await q.enqueue(intent(), catalog);
      await q.replay(
        async () => ({ status }),
        () => scope,
        0,
      );
      assert.deepEqual((await q.read()).pending[0].intent, intent());
      await assert.rejects(q.reconcile('operation-one', { kind: 'keep-remote' }, catalog), /reconciliation/);
    }
  });
  test('a change the server refused can be discarded with what was queued on it; a sign-in block cannot', async () => {
    for (const status of [400, 422, 401, 403]) {
      const q = createSlotOfflineQueue(createMemoryStore(), scope);
      await q.saveSnapshot(await complete(snapshot()));
      const next = intent('operation-two');
      next.request.inventoryRevision = 2;
      next.request.collectionVersion = 2;
      next.request.layoutRevision = 2;
      next.request.commands = [{ kind: 'create', ids: ['new-slot'], beforeSlotId: null }];
      await q.enqueue(intent(), catalog);
      await q.enqueue(next, catalog);
      await q.replay(
        async () => ({ status }),
        () => scope,
        0,
      );
      const head = (await q.read()).pending[0];
      assert.equal(head.status, 'blocked');
      const discardable = status !== 401 && status !== 403;
      assert.equal(blockedDiscardable(head), discardable);
      const discard = q.discardBlocked(
        'operation-one',
        () => complete(snapshot()),
        () => scope,
      );
      if (!discardable) {
        await assert.rejects(discard, /reconciliation/);
        assert.equal((await q.read()).pending.length, 2);
        continue;
      }
      await discard;
      const record = await q.read();
      assert.equal(record.pending.length, 0);
      assert.deepEqual(
        record.receipts.map((r) => [r.operationId, r.outcome]),
        [
          ['operation-one', 'cancelled'],
          ['operation-two', 'cancelled'],
        ],
      );
      assert.deepEqual(record.optimistic, record.snapshot);
    }
  });
  test('non-overlapping target edit may explicitly rebase, retaining original provenance and rejected request', async () => {
    const q = createSlotOfflineQueue(createMemoryStore(), scope),
      edit = intent();
    edit.request.commands = [
      {
        kind: 'update',
        slot: { id: 'a', version: 0, inventoryItemId: null, itemVersion: null, placementVersion: null },
        target: { kind: 'pokemon', pokemonId: 25 },
      },
    ];
    await q.saveSnapshot(await complete(snapshot()));
    await q.enqueue(edit, catalog);
    const remote = snapshot();
    remote.inventoryRevision++;
    remote.collections[0].version++;
    remote.binders[0].slots[1].target = { kind: 'pokemon', pokemonId: 1 };
    remote.binders[0].slots[1].version++;
    await q.replay(
      async () => ({
        status: 409,
        code: 'slot_revision_conflict',
        rejection: {
          outcome: 'rejected',
          operationId: 'operation-one',
          code: 'slot_revision_conflict',
          inventoryRevision: remote.inventoryRevision,
        },
      }),
      () => scope,
      0,
      catalog,
      () => complete(remote),
    );
    await q.rebase('operation-one', 'operation-rebased', catalog);
    const record = await q.read();
    assert.deepEqual(record.receipts[0].intent, edit);
    assert.deepEqual(record.pending[0].intent.context, { ...edit.context, operationId: 'operation-rebased' });
    assert.deepEqual(
      record.optimistic!.binders[0].slots.slice(0, 2).map((s) => s.target),
      [
        { kind: 'pokemon', pokemonId: 25 },
        { kind: 'pokemon', pokemonId: 1 },
      ],
    );
  });
  test('structural conflict permits an explicit reviewed replacement, never an automatic rebase', async () => {
    const q = createSlotOfflineQueue(createMemoryStore(), scope);
    await q.saveSnapshot(await complete(snapshot()));
    await q.enqueue(intent(), catalog);
    const remote = snapshot();
    remote.inventoryRevision++;
    remote.collections[0].version++;
    remote.binders[0].layoutRevision++;
    remote.binders[0].slots = remote.binders[0].slots.filter((s) => s.id !== 'c');
    await q.replay(
      async () => ({
        status: 409,
        code: 'slot_revision_conflict',
        rejection: {
          outcome: 'rejected',
          operationId: 'operation-one',
          code: 'slot_revision_conflict',
          inventoryRevision: remote.inventoryRevision,
        },
      }),
      () => scope,
      0,
      catalog,
      () => complete(remote),
    );
    const replacement = intent('replacement-intent');
    replacement.request = {
      ...replacement.request,
      inventoryRevision: 2,
      collectionVersion: 2,
      layoutRevision: 2,
      commands: [{ kind: 'create', ids: ['explicit-new'], beforeSlotId: null }],
    };
    await q.reconcile('operation-one', { kind: 'replace', intent: replacement }, catalog);
    const record = await q.read();
    assert.equal(record.receipts[0].outcome, 'superseded');
    assert.deepEqual(
      record.optimistic!.binders[0].slots.map((s) => s.id),
      ['a', 'b', 'explicit-new'],
    );
  });
  test('audit authority is rejected from persisted intent, original source fields survive', async () => {
    const q = createSlotOfflineQueue(createMemoryStore(), scope);
    await q.saveSnapshot(await complete(snapshot()));
    const spoofed = { ...intent(), context: { ...intent().context, actor: { kind: 'user', userId: 'forged' } } };
    await assert.rejects(q.enqueue(spoofed, catalog), /invalid-intent/);
    assert.equal((await q.read()).pending.length, 0);
  });
  test('idempotency or unclassified 409 cannot be rewritten as a fresh copy-creating operation', async () => {
    for (const code of ['idempotency_conflict', undefined]) {
      const q = createSlotOfflineQueue(createMemoryStore(), scope);
      await q.saveSnapshot(await complete(snapshot()));
      await q.enqueue(intent(), catalog);
      await q.replay(
        async () => ({ status: 409, code, snapshot: await complete(snapshot()) }),
        () => scope,
      );
      await assert.rejects(q.reconcile('operation-one', { kind: 'keep-remote' }, catalog), /reconciliation/);
      assert.equal((await q.read()).pending[0].conflict!.rejected, false);
    }
  });

  test("an edit depending on a newly inserted stable slot survives restart and its parent's acknowledgment", async () => {
    const store = createMemoryStore(),
      q = createSlotOfflineQueue(store, scope),
      insert = intent();
    insert.request.commands = [{ kind: 'create', ids: ['new-stable-slot'], beforeSlotId: null }];
    await q.saveSnapshot(await complete(snapshot()));
    await q.enqueue(insert, catalog);
    const edit = intent('dependent-operation');
    edit.request.inventoryRevision = 2;
    edit.request.collectionVersion = 2;
    edit.request.layoutRevision = 2;
    edit.request.commands = [
      {
        kind: 'update',
        slot: { id: 'new-stable-slot', version: 0, inventoryItemId: null, itemVersion: null, placementVersion: null },
        target: { kind: 'pokemon', pokemonId: 143 },
      },
    ];
    await q.enqueue(edit, catalog);
    const reopened = createSlotOfflineQueue(store, scope);
    await reopened.replay(
      async () => ({
        status: 200,
        operationId: 'operation-one',
        snapshot: await complete(projectSlotIntent(snapshot(), insert, catalog)),
      }),
      () => scope,
      0,
      catalog,
      () => complete(projectSlotIntent(snapshot(), insert, catalog)),
    );
    const record = await reopened.read();
    assert.equal(record.pending[0].intent.request.operationId, 'dependent-operation');
    assert.equal(record.pending[0].status, 'pending');
    assert.deepEqual(record.optimistic!.binders[0].slots.at(-1)!.target, { kind: 'pokemon', pokemonId: 143 });
  });
  test('a full Dex insertion shifts following slots across page boundaries without losing any identity', () => {
    const s = snapshot();
    s.binders[0].slots = Array.from({ length: 1025 }, (_, i) => ({
      ...s.binders[0].slots[0],
      id: `synthetic-dex-${i + 1}`,
    }));
    const insert = intent();
    insert.request.commands = [{ kind: 'create', ids: ['inserted-spacer'], beforeSlotId: 'synthetic-dex-9' }];
    const result = projectSlotIntent(s, insert, catalog);
    assert.equal(result.binders[0].slots[8].id, 'inserted-spacer');
    assert.equal(result.binders[0].slots[9].id, 'synthetic-dex-9');
    assert.equal(result.binders[0].slots.at(-1)!.id, 'synthetic-dex-1025');
    assert.equal(result.binders[0].slots.length, 1026);
  });
});

test('a matching historical complete ledger result cannot ACK without a new all-stream read', async () => {
  const q = createSlotOfflineQueue(createMemoryStore(), scope);
  await q.saveSnapshot(await complete(snapshot()));
  await q.enqueue(intent(), catalog);
  const ledger = await complete(projectSlotIntent(snapshot(), intent(), catalog));
  await q.replay(
    async () => ({ status: 200, operationId: 'operation-one', snapshot: ledger }),
    () => scope,
    0,
  );
  assert.equal((await q.read()).pending.length, 1);
  const latest = structuredClone(ledger);
  latest.inventoryRevision++;
  latest.collections[0].name = 'Later partner edit';
  let executed = false;
  await q.replay(
    async () => {
      executed = true;
      return { status: 200, operationId: 'operation-one', snapshot: ledger };
    },
    () => scope,
    400000,
    catalog,
    async () => {
      assert.equal(executed, true);
      return complete(latest);
    },
  );
  assert.equal((await q.read()).pending.length, 0);
  assert.equal((await q.read()).snapshot!.collections[0].name, 'Later partner edit');
});

test('fresh-read failures, plain JSON and stale revision retain the original intent', async () => {
  for (const read of [
    async () => {
      throw new Error('partial');
    },
    async () => snapshot(),
    async () => complete(snapshot()),
  ]) {
    const q = createSlotOfflineQueue(createMemoryStore(), scope);
    await q.saveSnapshot(await complete(snapshot()));
    await q.enqueue(intent(), catalog);
    await q.replay(
      async () => ({ status: 200, operationId: 'operation-one' }),
      () => scope,
      0,
      catalog,
      read,
    );
    assert.deepEqual((await q.read()).pending[0].intent, intent());
  }
});

test('session ends during the fresh read, retaining the claimed lease and original ID', async () => {
  const q = createSlotOfflineQueue(createMemoryStore(), scope);
  await q.saveSnapshot(await complete(snapshot()));
  await q.enqueue(intent(), catalog);
  let active = true;
  await q.replay(
    async () => ({ status: 200, operationId: 'operation-one' }),
    () => (active ? scope : null),
    0,
    catalog,
    async () => {
      active = false;
      return complete(projectSlotIntent(snapshot(), intent(), catalog));
    },
  );
  const r = await q.read();
  assert.equal(r.pending[0].lease?.until, 60000);
  assert.equal(r.receipts.length, 0);
});

test('a no-op command may ACK a fresh unchanged complete revision', async () => {
  const q = createSlotOfflineQueue(createMemoryStore(), scope),
    noop = intent();
  noop.request.commands = [
    {
      kind: 'move',
      slots: [{ id: 'c', version: 0, inventoryItemId: null, itemVersion: null, placementVersion: null }],
      beforeSlotId: null,
    },
  ];
  await q.saveSnapshot(await complete(snapshot()));
  await q.enqueue(noop, catalog);
  await q.replay(
    async () => ({ status: 200, operationId: 'operation-one' }),
    () => scope,
    0,
    catalog,
    () => complete(snapshot()),
  );
  assert.equal((await q.read()).pending.length, 0);
});

test('a lease overtaken during the fresh read cannot settle the replacement lease', async () => {
  const store = createMemoryStore(),
    q = createSlotOfflineQueue(store, scope);
  await q.saveSnapshot(await complete(snapshot()));
  await q.enqueue(intent(), catalog);
  await q.replay(
    async () => ({ status: 200, operationId: 'operation-one' }),
    () => scope,
    0,
    catalog,
    async () => {
      await createSlotOfflineQueue(store, scope).replay(
        async () => ({ status: 503 }),
        () => scope,
        61000,
      );
      return complete(projectSlotIntent(snapshot(), intent(), catalog));
    },
  );
  const r = await q.read();
  assert.equal(r.pending[0].attempts, 2);
  assert.equal(r.pending[0].status, 'unavailable');
  assert.equal(r.receipts.length, 0);
});

test('cached complete brands cannot ACK even at the expected or a higher revision', async () => {
  for (const extraRevision of [0, 2]) {
    const q = createSlotOfflineQueue(createMemoryStore(), scope);
    await q.saveSnapshot(await complete(snapshot()));
    await q.enqueue(intent(), catalog);
    const old = projectSlotIntent(snapshot(), intent(), catalog);
    old.inventoryRevision += extraRevision;
    const cached = await complete(old);
    await q.replay(
      async () => ({ status: 200, operationId: 'operation-one' }),
      () => scope,
      0,
      catalog,
      async () => cached,
    );
    const record = await q.read();
    assert.equal(record.pending.length, 1);
    assert.equal(record.receipts.length, 0);
    assert.equal(record.snapshot!.inventoryRevision, 1);
  }
});

test('a complete read begun before execution cannot ACK by finishing after the reply', async () => {
  const q = createSlotOfflineQueue(createMemoryStore(), scope);
  await q.saveSnapshot(await complete(snapshot()));
  await q.enqueue(intent(), catalog);
  const s = projectSlotIntent(snapshot(), intent(), catalog);
  let release!: () => void, signalReady!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    signalReady = resolve;
  });
  const page =
    <T>(rows: T[]) =>
    async () => ({ inventoryRevision: s.inventoryRevision, total: rows.length, rows, next: null });
  const earlierRead = readCompleteInventorySnapshot(
    s.ownerUserId,
    s.inventoryRevision,
    {
      items: page(s.items),
      placements: page(s.placements),
      collections: page(s.collections),
      binders: page(s.binders),
    },
    async () => {
      signalReady();
      await gate;
    },
  );
  await ready;
  await q.replay(
    async () => ({ status: 200, operationId: 'operation-one' }),
    () => scope,
    0,
    catalog,
    async () => {
      release();
      return earlierRead;
    },
  );
  const record = await q.read();
  assert.equal(record.pending.length, 1);
  assert.equal(record.receipts.length, 0);
});
test('terminal rejection survives failed fresh read/reload, needs current scope and never drops dependent work', async () => {
  const store = createMemoryStore(),
    q = createSlotOfflineQueue(store, scope);
  await q.saveSnapshot(await complete(snapshot()));
  await q.enqueue(intent(), catalog);
  const rejection = {
    outcome: 'rejected' as const,
    operationId: 'operation-one',
    code: 'slot_revision_conflict',
    inventoryRevision: 2,
  };
  await q.replay(
    async () => ({ status: 409, rejection }),
    () => scope,
    0,
    catalog,
    async () => {
      throw new Error('offline');
    },
  );
  const reopened = createSlotOfflineQueue(store, scope);
  assert.equal((await reopened.read()).pending[0].conflict?.rejected, true);
  assert.equal((await reopened.read()).pending[0].conflict?.current, null);
  await assert.rejects(reopened.reconcile('operation-one', { kind: 'keep-remote' }, catalog), /reconciliation/);
  const remote = snapshot();
  remote.inventoryRevision = 2;
  const cached = await complete(remote);
  await assert.rejects(
    reopened.refreshConflict(
      'operation-one',
      async () => cached,
      () => scope,
    ),
    /fresh-scoped/,
  );
  await assert.rejects(
    reopened.refreshConflict(
      'operation-one',
      () => complete(snapshot()),
      () => scope,
    ),
    /stale/,
  );
  let active = true;
  await assert.rejects(
    reopened.refreshConflict(
      'operation-one',
      async () => {
        active = false;
        return complete(remote);
      },
      () => (active ? scope : null),
    ),
    /fresh-scoped/,
  );
  await reopened.refreshConflict(
    'operation-one',
    async () => ({ snapshot: await complete(remote), navigation: { catalog: [], layouts: [] } }),
    () => scope,
  );
  await reopened.reconcile('operation-one', { kind: 'keep-remote' }, catalog);
  assert.equal((await reopened.read()).receipts[0].outcome, 'cancelled');
  assert.deepEqual((await reopened.read()).receipts[0].intent, intent());
});
test('a bare SQL conflict code and supplied snapshot never prove noncommit', async () => {
  const q = createSlotOfflineQueue(createMemoryStore(), scope);
  await q.saveSnapshot(await complete(snapshot()));
  await q.enqueue(intent(), catalog);
  await q.replay(
    async () => ({ status: 409, code: 'slot_revision_conflict', snapshot: await complete(snapshot()) }),
    () => scope,
  );
  assert.equal((await q.read()).pending[0].conflict?.rejected, false);
  await assert.rejects(
    q.refreshConflict(
      'operation-one',
      () => complete(snapshot()),
      () => scope,
    ),
    /reconciliation/,
  );
  await assert.rejects(q.reconcile('operation-one', { kind: 'keep-remote' }, catalog), /reconciliation/);
});
test('keeping the remote state cancels a rejected head with the edits planned on top of it; rebase still refuses', async () => {
  const q = createSlotOfflineQueue(createMemoryStore(), scope);
  await q.saveSnapshot(await complete(snapshot()));
  await q.enqueue(intent(), catalog);
  const dependent = intent('operation-dependent');
  dependent.request = {
    ...dependent.request,
    inventoryRevision: 2,
    collectionVersion: 2,
    layoutRevision: 2,
    commands: [{ kind: 'create', ids: ['dependent-slot'], beforeSlotId: null }],
  };
  await q.enqueue(dependent, catalog);
  const remote = snapshot();
  remote.inventoryRevision = 2;
  await q.replay(
    async () => ({
      status: 409,
      rejection: {
        outcome: 'rejected',
        operationId: 'operation-one',
        code: 'slot_revision_conflict',
        inventoryRevision: 2,
      },
    }),
    () => scope,
    0,
    catalog,
    () => complete(remote),
  );
  await assert.rejects(q.rebase('operation-one', 'operation-new', catalog), /reconciliation/);
  assert.deepEqual(
    (await q.read()).pending.map((p) => p.intent),
    [intent(), dependent],
  );
  await q.reconcile('operation-one', { kind: 'keep-remote' }, catalog);
  const after = await q.read();
  assert.equal(after.pending.length, 0);
  assert.deepEqual(
    after.receipts.map((r) => [r.operationId, r.outcome]),
    [
      ['operation-one', 'cancelled'],
      ['operation-dependent', 'cancelled'],
    ],
  );
  assert.equal(after.optimistic?.inventoryRevision, 2);
});
test('unknown conflict may explicitly retry only its unchanged original operation', async () => {
  const q = createSlotOfflineQueue(createMemoryStore(), scope);
  await q.saveSnapshot(await complete(snapshot()));
  await q.enqueue(intent(), catalog);
  await q.replay(
    async () => ({ status: 409, code: 'storage_conflict' }),
    () => scope,
    0,
  );
  await q.resume('operation-one', 1);
  await q.replay(
    async (sent) => {
      assert.deepEqual(sent, intent());
      return { status: 503 };
    },
    () => scope,
    1,
  );
  assert.deepEqual((await q.read()).pending[0].intent, intent());
});
