import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '@/lib/offline-store/kv';
import { createSlotOfflineQueue, offlineScopeKey } from '@/lib/collection/slot-offline-queue';
import { prepareLayoutIntent } from '@/lib/binder-slot-editing';
import { isCompleteInventorySnapshot } from '@/lib/collection/slot-snapshot';
import { readSyntheticComplete } from './fixtures/slot-durable-session';
import type { InventorySnapshot } from '@/lib/domain/inventory';

// Synthetic identities and graph only.
const scope = { deviceId: 'device', workspaceId: 'holofolder', accountId: 'account', ownerUserId: 'owner' };
const collectionId = '00000000-0000-4000-8000-000000000001';
const auth = 'origin-session';
const snapshot: InventorySnapshot = {
  ownerUserId: 'owner',
  inventoryRevision: 1,
  items: [],
  placements: [],
  collections: [
    {
      id: collectionId,
      ownerUserId: 'owner',
      name: 'Synthetic',
      kind: 'binder',
      defaultPresentation: 'binder',
      version: 1,
    },
  ],
  binders: [{ collectionId, ownerUserId: 'owner', layoutRevision: 1, presetManifest: null, slots: [] }],
};
const navigation = { catalog: [], layouts: [{ collectionId, layoutRevision: 1, rows: 3, cols: 3 }] };
const context = (operationId: string) => ({
  source: 'app' as const,
  clientId: 'device',
  operationId,
  batchId: null,
  clientOccurredAt: '2026-01-01T00:00:00Z',
});
async function fixture() {
  const store = createMemoryStore(),
    queue = createSlotOfflineQueue(store, scope);
  await queue.saveSnapshotWithNavigation(await readSyntheticComplete(snapshot), navigation);
  return { store, queue };
}
function append(base: InventorySnapshot, operationId = 'operation-one') {
  return prepareLayoutIntent(
    base,
    { ownerUserId: 'owner', collectionId, slotId: null },
    { kind: 'append', newSlotId: operationId + '-slot' },
    context(operationId),
    () => undefined,
  );
}
test('local planning reads canonical saved evidence and chains exact durable commands', async () => {
  const { store, queue } = await fixture();
  const local = await queue.readLocalPlanning(auth);
  assert.equal(isCompleteInventorySnapshot(local.snapshot), false);
  await queue.enqueueLocal(append(local.snapshot), auth, () => scope);
  const next = await createSlotOfflineQueue(store, scope).readLocalPlanning(auth);
  assert.equal(next.snapshot.binders[0].slots.length, 1);
  await queue.enqueueLocal(append(next.snapshot, 'operation-two'), auth, () => scope);
  const record = await queue.read();
  assert.equal(record.pending.length, 2);
  assert.equal(record.pending[0].originAuthSessionId, auth);
  assert.equal(record.optimistic!.binders[0].slots.length, 2);
  assert.equal((await queue.readLocalPlanning(auth)).layouts[0].layoutRevision, 3);
});
test('DTO cannot seed local admission, stale drafts and inactive lifetimes leave bytes unchanged', async () => {
  const empty = createSlotOfflineQueue(createMemoryStore(), scope);
  await assert.rejects(empty.saveSnapshotWithNavigation(snapshot, navigation), /unverified/);
  await assert.rejects(
    empty.enqueueLocal(append(snapshot), auth, () => scope),
    /not-saved/,
  );
  const { store, queue } = await fixture(),
    draft = append(snapshot);
  await assert.rejects(
    queue.enqueueLocal(draft, auth, () => null),
    /inactive/,
  );
  await queue.enqueueLocal(draft, auth, () => scope);
  const bytes = await store.get(offlineScopeKey(scope));
  await assert.rejects(queue.enqueueLocal(append(snapshot, 'stale-operation'), auth, () => scope));
  assert.deepEqual(await store.get(offlineScopeKey(scope)), bytes);
});
test('different auth session cannot lease or send and retained baseline metadata stays paired', async () => {
  const { store, queue } = await fixture();
  await queue.enqueueLocal(append(snapshot), auth, () => scope);
  const bytes = await store.get(offlineScopeKey(scope));
  await queue.replay(
    async () => {
      throw new Error('must not send');
    },
    () => scope,
    0,
    () => undefined,
    undefined,
    'different-session',
  );
  assert.deepEqual(await store.get(offlineScopeKey(scope)), bytes);
  const changed = structuredClone(snapshot);
  changed.inventoryRevision = 2;
  changed.binders[0].layoutRevision = 2;
  assert.equal(
    await queue.saveSnapshotWithNavigation(await readSyntheticComplete(changed), {
      ...navigation,
      layouts: [{ ...navigation.layouts[0], layoutRevision: 2 }],
    }),
    false,
  );
  assert.equal((await queue.readLocalPlanning(auth)).snapshot.binders[0].slots.length, 1);
});

test('selected catalog evidence survives serialized pending reprojection, missing or conflicting associations refuse acceptance', async () => {
  const { prepareSlotPickerIntent } = await import('@/lib/slot-picker');
  const { browserHostCatalog } = await import('@/lib/collection/browser-host-catalog');
  const { store, queue } = await fixture();
  await queue.enqueueLocal(append(snapshot), auth, () => scope);
  const base = (await queue.readLocalPlanning(auth)).snapshot;
  const evidence = [
    {
      card: {
        id: 'synthetic-card',
        localId: '1',
        name: 'Synthetic',
        set: { id: 'synthetic-set', name: 'Synthetic' },
        language: 'en' as const,
      },
      speciesNames: ['Synthetic'],
      pokemonIds: [25],
    },
  ];
  const prepared = prepareSlotPickerIntent(
    base,
    { ownerUserId: 'owner', collectionId, slotId: 'operation-one-slot' },
    {
      kind: 'assign',
      selection: {
        kind: 'catalog',
        identity: { kind: 'card', cardId: 'synthetic-card', language: 'en', finish: 'normal' },
        newItemId: 'synthetic-copy',
      },
      fulfillWant: null,
    },
    context('assign-operation'),
    browserHostCatalog(evidence),
  );
  const before = await store.get(offlineScopeKey(scope));
  await assert.rejects(
    queue.enqueueLocal(prepared, auth, () => scope),
    /catalog-unavailable/,
  );
  assert.deepEqual(await store.get(offlineScopeKey(scope)), before);
  await queue.enqueueLocal({ ...prepared, localCatalog: evidence }, auth, () => scope);
  const reopened = createSlotOfflineQueue(store, scope);
  assert.equal((await reopened.readLocalPlanning(auth)).resolver('synthetic-card')?.pokemonIds[0], 25);
  // A branded refreshed base must be able to project the retained assign without caller catalog caches.
  await reopened.saveSnapshot(await readSyntheticComplete(snapshot));
  assert.equal((await reopened.read()).optimistic!.items[0].id, 'synthetic-copy');
  assert.equal((await reopened.read()).pending[1].status, 'pending');
  const local = await reopened.readLocalPlanning(auth);
  const target = prepareSlotPickerIntent(
    local.snapshot,
    { ownerUserId: 'owner', collectionId, slotId: 'operation-one-slot' },
    { kind: 'target', target: null },
    context('target-operation'),
    local.resolver,
  );
  await reopened.enqueueLocal(target, auth, () => scope);
  await reopened.enqueueLocal(target, auth, () => scope);
  await assert.rejects(
    reopened.enqueueLocal({ ...target, localCatalog: [{ ...evidence[0], pokemonIds: [99] }] }, auth, () => scope),
    /catalog/,
  );
});
test('basic local admission excludes wanted mutation and wrong draft collection', async () => {
  const { queue } = await fixture();
  await queue.enqueueLocal(append(snapshot), auth, () => scope);
  const local = await queue.readLocalPlanning(auth);
  const { prepareSlotPickerIntent } = await import('@/lib/slot-picker');
  const draft = prepareSlotPickerIntent(
    local.snapshot,
    { ownerUserId: 'owner', collectionId, slotId: 'operation-one-slot' },
    { kind: 'target', target: null },
    context('target-operation'),
    local.resolver,
  );
  const c = draft.intent.kind === 'slots' ? draft.intent.request.commands[0] : null;
  assert.equal(c?.kind, 'update');
  for (const changed of [
    { ...draft, scope: { ...draft.scope, collectionId: 'other' } },
    {
      ...draft,
      intent: { ...draft.intent, request: { ...draft.intent.request, commands: [{ ...c, wantedCards: [] }] } },
    },
  ]) {
    await assert.rejects(
      queue.enqueueLocal(changed as typeof draft, auth, () => scope),
      /basic-local/,
    );
  }
});
test('ACK needs a separately fresh complete read and commits its exact navigation atomically', async () => {
  const { store, queue } = await fixture();
  await queue.enqueueLocal(append(snapshot), auth, () => scope);
  const original = (await queue.read()).pending[0].intent;
  const current = (await queue.read()).optimistic!;
  const metadata = {
    ...navigation,
    layouts: [{ ...navigation.layouts[0], layoutRevision: current.binders[0].layoutRevision }],
  };
  const result = { status: 200, operationId: original.request.operationId };
  await queue.replay(
    async () => result,
    () => scope,
    0,
    () => undefined,
    async () => current,
    auth,
  );
  assert.equal((await queue.read()).pending.length, 1);
  await queue.resume(original.request.operationId, 60001);
  const broken = {
    ...store,
    updateMany: (async (
      keys: string[],
      transform: (values: Record<string, unknown>) => { writes: Array<readonly [string, unknown]>; result: unknown },
    ) =>
      store.updateMany(keys, (values) => {
        const next = transform(values);
        if (next.writes.length === 2) throw new Error('metadata-write-abort');
        return next;
      })) as typeof store.updateMany,
  };
  const failed = createSlotOfflineQueue(broken, scope);
  await assert.rejects(
    failed.replay(
      async () => result,
      () => scope,
      60001,
      () => undefined,
      async () => ({ snapshot: await readSyntheticComplete(current), navigation: metadata }),
      auth,
    ),
    /metadata-write-abort/,
  );
  assert.equal((await queue.read()).snapshot!.inventoryRevision, 1);
  assert.equal((await queue.read()).pending.length, 1);
  await queue.resume(original.request.operationId, 120002);
  await queue.replay(
    async (sent) => {
      assert.deepEqual(sent, original);
      return result;
    },
    () => scope,
    120002,
    () => undefined,
    async () => ({ snapshot: await readSyntheticComplete(current), navigation: metadata }),
    auth,
  );
  assert.equal((await queue.read()).pending.length, 0);
  assert.equal((await queue.readLocalPlanning(auth)).layouts[0].layoutRevision, 2);
});
test('matching session survives a new queue instance, missing ACK metadata and invalidated reads retain exact intents', async () => {
  const { store, queue } = await fixture();
  await queue.enqueueLocal(append(snapshot), auth, () => scope);
  const reopened = createSlotOfflineQueue(store, scope),
    current = (await reopened.read()).optimistic!;
  let sends = 0;
  await assert.rejects(
    reopened.replay(
      async () => {
        sends++;
        return { status: 200, operationId: 'operation-one' };
      },
      () => scope,
      0,
      () => undefined,
      () => readSyntheticComplete(current),
      auth,
    ),
    /metadata-unavailable/,
  );
  assert.equal(sends, 1);
  assert.equal((await reopened.read()).pending[0].intent.request.operationId, 'operation-one');
  await reopened.resume('operation-one', 60001);
  let valid = true;
  await reopened.replay(
    async () => ({ status: 200, operationId: 'operation-one' }),
    () => (valid ? scope : null),
    60001,
    () => undefined,
    async () => {
      valid = false;
      return {
        snapshot: await readSyntheticComplete(current),
        navigation: { ...navigation, layouts: [{ ...navigation.layouts[0], layoutRevision: 2 }] },
      };
    },
    auth,
  );
  assert.equal((await reopened.read()).pending.length, 1);
  assert.equal((await reopened.read()).receipts.length, 0);
});
test('catalog display differences do not create duplicate persisted printing identities', async () => {
  const { localCatalogEvidence } = await import('@/lib/collection/slot-local-planning');
  const evidence = {
    card: {
      id: 'synthetic-card',
      localId: '1',
      name: 'Synthetic',
      set: { id: 'synthetic-set', name: 'Synthetic' },
      language: 'en' as const,
    },
    speciesNames: ['Synthetic'],
    pokemonIds: [25],
  };
  const merged = localCatalogEvidence(
    snapshot,
    [evidence],
    [{ ...evidence, card: { ...evidence.card, image: 'https://synthetic.invalid/card' } }],
  );
  assert.equal(merged.length, 1);
});

test('a card picked for a sent edit is kept with it, so a newer read still projects the edit', async () => {
  const { prepareSlotPickerIntent } = await import('@/lib/slot-picker');
  const { browserHostCatalog } = await import('@/lib/collection/browser-host-catalog');
  const { queue } = await fixture();
  await queue.enqueue(append(snapshot).intent, () => undefined);
  const base = (await queue.read()).optimistic!;
  const evidence = [
    {
      card: {
        id: 'synthetic-card',
        localId: '1',
        name: 'Synthetic',
        set: { id: 'synthetic-set', name: 'Synthetic' },
        language: 'en' as const,
      },
      speciesNames: ['Synthetic'],
      pokemonIds: [25],
    },
  ];
  const assign = prepareSlotPickerIntent(
    base,
    { ownerUserId: 'owner', collectionId, slotId: 'operation-one-slot' },
    {
      kind: 'assign',
      selection: {
        kind: 'catalog',
        identity: { kind: 'card', cardId: 'synthetic-card', language: 'en', finish: 'normal' },
        newItemId: 'synthetic-copy',
      },
      fulfillWant: null,
    },
    context('assign-operation'),
    browserHostCatalog(evidence),
  );
  await queue.enqueue(assign.intent, browserHostCatalog(evidence), undefined, () => scope, undefined, evidence);
  // A refreshed read (no caller catalog) still projects the pick instead of failing it as a conflict.
  await queue.saveSnapshot(await readSyntheticComplete(snapshot));
  const record = await queue.read();
  assert.equal(record.pending[1].status, 'pending');
  assert.equal(record.optimistic!.items[0].id, 'synthetic-copy');
});
