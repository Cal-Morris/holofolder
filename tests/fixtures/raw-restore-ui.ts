import assert from 'node:assert/strict';
import { createBinderBackupV2 } from '@/lib/binder-backup-v2';
import { offlineScopeKey, createSlotOfflineQueue } from '@/lib/collection/slot-offline-queue';
import { createMemoryStore } from '@/lib/offline-store/kv';
import { sendStorageCommand } from '@/lib/collection/storage-command-browser';
import { rawRestoreIntent, requestNativeRawRestorePlan } from '@/lib/native-raw-restore';
import { readCurrentCollectionNavigation } from '@/lib/collection/inventory-navigation-read';
import type { NativeBackupBinding } from '@/lib/native-backup';
import type { SlotOfflineIntent } from '@/lib/collection/slot-optimistic';

async function main() {
  // @ts-expect-error Isolated Bun module mock; actual auth, HTTP, bridge and reader stay in use.
  const { mock } = await import('bun:test');
  mock.module('server-only', () => ({}));
  const { storageCommandHarness } = await import('./storage-command-harness');
  const { handleInventoryCompleteRead } = await import('@/lib/server/inventory-read-http');
  const collectionId = '22222222-2222-4222-8222-222222222222',
    actor = '00000000-0000-4000-8000-0000000000e2';
  const scope = {
    actorUserId: actor,
    ownerUserId: actor,
    authSessionId: 'synthetic-e2e-auth-session',
    sessionId: 'synthetic-ui-epoch',
  };
  const queueScope = {
    deviceId: 'synthetic-ui-device',
    workspaceId: 'synthetic-ui',
    accountId: actor,
    ownerUserId: actor,
  };
  let fixture = storageCommandHarness('restore-ui-' + crypto.randomUUID()),
    lose = false,
    malformed = false,
    reads = 0,
    sends = 0;
  mock.module('../../lib/supabase/server', () => ({ createClient: async () => fixture.client }));
  mock.module('../../lib/supabase/admin', () => ({ createAdminClient: () => fixture.client }));
  const { POST: restoreRoute } = await import('@/app/api/raw-content-restore/route');
  const nextFixture = () =>
    storageCommandHarness(
      (process.argv.includes('--converted') ? 'restore-converted-' : 'restore-ui-') + crypto.randomUUID(),
    );
  const bodies: string[] = [];
  globalThis.fetch = async (input, init) => {
    const path = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(path, 'http://localhost:3587');
    const headers = new Headers(init?.headers);
    headers.set('origin', url.origin);
    const request = new Request(url, { ...init, headers });
    if (request.method === 'GET') {
      reads++;
      return handleInventoryCompleteRead(request, fixture.client);
    }
    const command = JSON.parse(String(init?.body));
    if (!command.action) {
      sends++;
      bodies.push(String(init?.body));
    }
    const result = await restoreRoute(request);
    if (!command.action && lose) throw new Error('synthetic lost COMMIT reply');
    if (!command.action && malformed) result.headers.delete('X-Storage-Delivery');
    return result;
  };
  const currentScope = () => scope;
  const readCurrent = () => readCurrentCollectionNavigation(currentScope, true);
  const binding: NativeBackupBinding = {
    scope,
    currentScope,
    available: true,
    revisionKey: 'synthetic',
    assertReady: async () => {},
    readCurrent,
  };
  const prepare = async (reorder = process.argv.includes('--reorder')) => {
    const read = await readCurrent();
    assert.equal(read.evidence.kind, 'complete');
    if (read.evidence.kind !== 'complete') throw new Error('fixture');
    const desired = structuredClone(read.evidence.snapshot);
    desired.binders[0].slots[0].inventoryItemId = 'synthetic-restore-copy-1';
    desired.binders[0].slots[1].inventoryItemId = null;
    desired.binders[0].slots[1].status = null;
    desired.placements = [
      { inventoryItemId: 'synthetic-restore-copy-1', collectionId, slotId: 'synthetic-slot-0', version: 1 },
    ];
    if (reorder) desired.binders[0].slots.reverse();
    const backup = createBinderBackupV2({
      snapshot: desired,
      completeness: 'complete-owner',
      scope: 'collection',
      collectionId,
      layouts: [...read.layouts],
    });
    const input = {
      text: JSON.stringify(backup),
      operationId: crypto.randomUUID(),
      choices: {
        collectionId,
        slotIds: read.evidence.snapshot.binders[0].slots.map((s) => s.id),
        releaseItemIds: ['synthetic-restore-copy-0'],
        restoreContent: true as const,
      },
    };
    const command = await requestNativeRawRestorePlan(binding, input, () => true, true);
    return { base: read.evidence.snapshot, command, input };
  };
  const freshSnapshot = async () => {
    const r = await readCurrent();
    if (r.evidence.kind !== 'complete') throw new Error('incomplete');
    return r.evidence.snapshot;
  };
  const send = (intent: SlotOfflineIntent) =>
    sendStorageCommand(intent, currentScope, new AbortController().signal, true);
  const replay = (
    q: ReturnType<typeof createSlotOfflineQueue>,
    reader = freshSnapshot,
    authSessionId = scope.authSessionId,
  ) =>
    q.replay(
      send,
      () => queueScope,
      Date.now(),
      () => undefined,
      reader,
      authSessionId,
    );
  const setup = async (reorder = process.argv.includes('--reorder')) => {
    const p = await prepare(reorder),
      store = createMemoryStore(),
      q = createSlotOfflineQueue(store, queueScope);
    await q.saveSnapshot(p.base);
    return { ...p, store, q, intent: rawRestoreIntent(p.command, queueScope.deviceId) };
  };
  // The shared host may pair fresh complete reads with matching navigation for atomic ACK.
  const paired = await setup();
  await paired.q.enqueue(
    paired.intent,
    () => undefined,
    paired.base,
    () => queueScope,
    scope.authSessionId,
  );
  await paired.q.replay(
    send,
    () => queueScope,
    Date.now(),
    () => undefined,
    async () => {
      const r = await readCurrent();
      if (r.evidence.kind !== 'complete') throw new Error('incomplete');
      return { snapshot: r.evidence.snapshot, navigation: { catalog: r.catalog, layouts: r.layouts } };
    },
    scope.authSessionId,
  );
  assert.equal((await paired.q.read()).pending.length, 0);
  assert.equal((await paired.q.read()).receipts[0].outcome, 'acknowledged');
  const savedPair = await paired.q.readLocalPlanning(scope.authSessionId);
  assert.equal(savedPair.layouts[0].layoutRevision, savedPair.snapshot.binders[0].layoutRevision);
  fixture = nextFixture();
  // Future command versions fail closed in both reads and atomic updates, without resetting bytes.
  const unknown = await setup();
  await unknown.q.enqueue(
    unknown.intent,
    () => undefined,
    unknown.base,
    () => queueScope,
    scope.authSessionId,
  );
  const key = offlineScopeKey(queueScope),
    bytes = structuredClone(
      await unknown.store.get<import('@/lib/collection/slot-offline-queue').SlotOfflineRecord>(key),
    )!;
  Object.assign(bytes.pending[0].intent.request, { version: 999 });
  await unknown.store.set(key, bytes);
  await assert.rejects(unknown.q.read());
  await assert.rejects(unknown.q.saveSnapshot(await freshSnapshot()));
  assert.deepEqual(await unknown.store.get(key), bytes);
  // A previously admitted 4-MiB v2 intent is unsupported now, but remains byte-for-byte durable.
  const oldV2 = await setup(false);
  await oldV2.q.enqueue(
    oldV2.intent,
    () => undefined,
    oldV2.base,
    () => queueScope,
    scope.authSessionId,
  );
  const oldBytes = structuredClone(
    await oldV2.store.get<import('@/lib/collection/slot-offline-queue').SlotOfflineRecord>(key),
  )!;
  const oldCommand = oldBytes.pending[0].intent.request as import('@/lib/domain/raw-restore').RawRestoreCommand;
  oldCommand.slots[0].after.wantedCards = [
    { card_id: 'synthetic-card', card_name: 'x'.repeat(3 * 1024 * 1024), added_at: '2020-01-01' },
  ];
  await oldV2.store.set(key, oldBytes);
  await assert.rejects(oldV2.q.read());
  await assert.rejects(oldV2.q.saveSnapshot(await freshSnapshot()));
  assert.deepEqual(await oldV2.store.get(key), oldBytes);
  // Generic/file/clone state cannot become a reviewed original command or complete base.
  let f = await setup();
  await assert.rejects(
    f.q.enqueue(
      structuredClone(f.intent),
      () => undefined,
      f.base,
      () => queueScope,
      scope.authSessionId,
    ),
  );
  await assert.rejects(
    f.q.enqueue(
      f.intent,
      () => undefined,
      structuredClone(f.base),
      () => queueScope,
      scope.authSessionId,
    ),
  );
  const failing = createSlotOfflineQueue(
    {
      ...f.store,
      update: async () => {
        throw new Error('IDB failure');
      },
    },
    queueScope,
  );
  await assert.rejects(
    failing.enqueue(
      f.intent,
      () => undefined,
      f.base,
      () => queueScope,
      scope.authSessionId,
    ),
  );
  assert.equal((await f.q.read()).pending.length, 0);
  await f.q.enqueue(
    f.intent,
    () => undefined,
    f.base,
    () => queueScope,
    scope.authSessionId,
  );
  assert.deepEqual((await f.q.read()).optimistic, f.base);
  assert.equal((await f.q.read()).pending[0].base, null);
  await assert.rejects(f.q.saveSnapshot(await freshSnapshot()));
  // A lost response commits remotely, keeps the immutable original, and reload retries genuinely.
  lose = true;
  await replay(f.q);
  lose = false;
  assert.deepEqual((await f.q.read()).pending[0].intent, f.intent);
  const reopened = createSlotOfflineQueue(f.store, queueScope);
  await reopened.resume(f.command.operationId);
  await replay(reopened);
  assert.deepEqual(bodies.at(-1), bodies.at(-2));
  const done = await reopened.read();
  assert.equal(done.pending.length, 0);
  assert.equal(done.receipts[0].outcome, 'acknowledged');
  assert.equal(done.snapshot!.items.length, 2);
  assert.equal(done.snapshot!.placements.length, 1);
  assert.ok(!done.snapshot!.placements.some((p) => p.inventoryItemId === 'synthetic-restore-copy-0'));
  assert.ok(done.snapshot!.items.some((i) => i.id === 'synthetic-restore-copy-0'));
  // Persist acceptance first, then a separately fresh read. Retained and cloned reads fail ACK.
  fixture = nextFixture();
  f = await setup();
  await f.q.enqueue(
    f.intent,
    () => undefined,
    f.base,
    () => queueScope,
    scope.authSessionId,
  );
  const retained = await freshSnapshot(),
    beforeSend = sends;
  await replay(f.q, async () => retained);
  assert.equal((await f.q.read()).pending.length, 1);
  assert.ok((await f.q.read()).pending[0].rawRestoreProof?.receipt);
  await f.q.resume(f.command.operationId);
  await replay(f.q, async () => structuredClone(await freshSnapshot()));
  assert.equal((await f.q.read()).pending.length, 1);
  await f.q.resume(f.command.operationId);
  await replay(f.q);
  assert.equal(sends, beforeSend + 1, 'accepted proof resumes read without another apply');
  assert.equal((await f.q.read()).pending.length, 0);
  if (process.argv.includes('--reorder')) {
    fixture = nextFixture();
    f = await setup();
    await f.q.enqueue(
      f.intent,
      () => undefined,
      f.base,
      () => queueScope,
      scope.authSessionId,
    );
    let receiptPositions: unknown[] = [];
    await replay(f.q, async () => {
      receiptPositions = fixture.tables.binder_slots.map((s) => s.position);
      fixture.tables.binder_slots.forEach((s, n) => {
        s.position = n;
      });
      return freshSnapshot();
    });
    const pending = await f.q.read();
    assert.equal(pending.pending.length, 1);
    assert.ok(pending.pending[0].rawRestoreProof?.receipt);
    fixture.tables.binder_slots.forEach((s, n) => {
      s.position = receiptPositions[n];
    });
    const delivered = sends;
    await f.q.resume(f.command.operationId);
    await replay(f.q);
    assert.equal((await f.q.read()).pending.length, 0);
    assert.equal(sends, delivered);
  }
  // Malformed HTTP proof cannot ACK, and another authenticated session cannot replay it.
  fixture = nextFixture();
  f = await setup();
  await f.q.enqueue(
    f.intent,
    () => undefined,
    f.base,
    () => queueScope,
    scope.authSessionId,
  );
  malformed = true;
  await replay(f.q);
  malformed = false;
  assert.equal((await f.q.read()).pending[0].rawRestoreProof, undefined);
  await f.q.resume(f.command.operationId);
  const sent = sends;
  await replay(f.q, freshSnapshot, 'synthetic-changed-session');
  assert.equal(sends, sent);
  await assert.rejects(
    f.q.discardRawRestore(f.command.operationId, freshSnapshot, () => queueScope, scope.authSessionId),
  );
  // Dedicated bound rejection persists before reads, ordinary statuses/shaped results are unknown.
  fixture = storageCommandHarness('restore-rejection-' + crypto.randomUUID());
  f = await setup();
  await f.q.enqueue(
    f.intent,
    () => undefined,
    f.base,
    () => queueScope,
    scope.authSessionId,
  );
  await replay(f.q, async () => {
    throw new Error('synthetic read failure');
  });
  const rejected = await f.q.read();
  assert.ok(rejected.pending[0].rawRestoreProof?.rejection);
  assert.equal(rejected.pending[0].conflict?.rejected, true);
  await assert.rejects(f.q.rebase(f.command.operationId, crypto.randomUUID(), () => undefined));
  await assert.rejects(f.q.reconcile(f.command.operationId, { kind: 'keep-remote' }, () => undefined));
  await f.q.discardRawRestore(f.command.operationId, freshSnapshot, () => queueScope, scope.authSessionId);
  const discarded = await f.q.read();
  assert.equal(discarded.pending.length, 0);
  assert.ok(discarded.receipts[0].rawRestoreProof?.rejection);
  assert.equal(discarded.receipts[0].outcome, 'cancelled');
  // Untrusted shaped receipts, arbitrary 409/503/cancel and ordinary 4xx never clear intent.
  for (const status of [0, 503, 409, 400, 200]) {
    fixture = nextFixture();
    f = await setup();
    await f.q.enqueue(
      f.intent,
      () => undefined,
      f.base,
      () => queueScope,
      scope.authSessionId,
    );
    let readCalls = 0;
    const untrusted = status === 200 ? (await send(f.intent)).rawRestoreProof! : done.receipts[0].rawRestoreProof!;
    await f.q.replay(
      async () => ({
        status,
        operationId: f.command.operationId,
        inventoryRevision: 8,
        rawRestoreProof: structuredClone(untrusted),
      }),
      () => queueScope,
      Date.now(),
      () => undefined,
      async () => {
        readCalls++;
        return freshSnapshot();
      },
      scope.authSessionId,
    );
    assert.deepEqual((await f.q.read()).pending[0].intent, f.intent);
    assert.equal(readCalls, 0);
    assert.equal((await f.q.read()).pending[0].rawRestoreProof, undefined);
    await assert.rejects(
      f.q.discardRawRestore(f.command.operationId, freshSnapshot, () => queueScope, scope.authSessionId),
    );
  }
  // Failure while persisting a received acceptance leaves an exact retry, never an ACK.
  fixture = nextFixture();
  f = await setup();
  await f.q.enqueue(
    f.intent,
    () => undefined,
    f.base,
    () => queueScope,
    scope.authSessionId,
  );
  const update = f.store.update.bind(f.store);
  let failProof = true;
  f.store.update = (key, transform) =>
    update(key, (raw) => {
      const next = transform(raw) as { pending?: { rawRestoreProof?: unknown }[] };
      if (failProof && next.pending?.[0]?.rawRestoreProof) {
        failProof = false;
        throw new Error('Synthetic proof IDB failure');
      }
      return next;
    });
  await replay(f.q);
  assert.deepEqual((await f.q.read()).pending[0].intent, f.intent);
  assert.equal((await f.q.read()).pending[0].rawRestoreProof, undefined);
  await f.q.resume(f.command.operationId);
  await replay(f.q);
  assert.equal((await f.q.read()).pending.length, 0);
  assert.equal(bodies.at(-1), bodies.at(-2));
  // Same atomic leases fence a late complete read after another tab takes over.
  fixture = nextFixture();
  f = await setup();
  await f.q.enqueue(
    f.intent,
    () => undefined,
    f.base,
    () => queueScope,
    scope.authSessionId,
  );
  let release!: () => void, reading!: () => void;
  const blocked = new Promise<void>((resolve) => {
      release = resolve;
    }),
    startedReading = new Promise<void>((resolve) => {
      reading = resolve;
    });
  const now = Date.now();
  const oldReplay = f.q.replay(
    send,
    () => queueScope,
    now,
    () => undefined,
    async () => {
      reading();
      await blocked;
      return freshSnapshot();
    },
    scope.authSessionId,
  );
  await startedReading;
  const second = createSlotOfflineQueue(f.store, queueScope);
  await second.replay(
    send,
    () => queueScope,
    now + 61000,
    () => undefined,
    freshSnapshot,
    scope.authSessionId,
  );
  release();
  await oldReplay;
  assert.equal((await f.q.read()).pending.length, 0);
  assert.equal((await f.q.read()).receipts.length, 1);
  // Scope/owner/session teardown after receipt cannot ACK or retarget the retained request.
  fixture = nextFixture();
  f = await setup();
  await f.q.enqueue(
    f.intent,
    () => undefined,
    f.base,
    () => queueScope,
    scope.authSessionId,
  );
  let live = true;
  await f.q.replay(
    send,
    () => (live ? queueScope : null),
    now,
    () => undefined,
    async () => {
      const fresh = await freshSnapshot();
      live = false;
      return fresh;
    },
    scope.authSessionId,
  );
  assert.deepEqual((await f.q.read()).pending[0].intent, f.intent);
  assert.equal(
    (await createSlotOfflineQueue(f.store, { ...queueScope, ownerUserId: 'another-owner' }).read()).pending.length,
    0,
  );
  // Planning and delivery fail on live actor/config/version changes through actual handlers.
  for (const change of ['actor', 'config', 'version', 'partner'] as const) {
    fixture = nextFixture();
    const prepared = await prepare();
    if (change === 'partner')
      fixture.tables.partnerships.push({
        id: '00940000-0000-4000-8000-000000000003',
        owner_user_id: actor,
        user1_id: actor,
        user2_id: '00940000-0000-4000-8000-000000000002',
      });
    if (change === 'actor') fixture.setActor('00000000-0000-4000-8000-000000000099');
    if (change === 'config') fixture.tables.binders[0].name = 'Changed synthetic config';
    if (change === 'version') fixture.tables.inventory_owner_state[0].inventory_revision = 8;
    const result = await send(rawRestoreIntent(prepared.command, queueScope.deviceId));
    if (change === 'actor' || change === 'partner') {
      assert.equal(result.status, 403);
      assert.equal(result.rawRestoreProof, undefined);
    } else assert.ok(result.rawRestoreProof?.rejection);
  }
  assert.ok(reads > 0);
  const { POST } = await import('@/app/api/raw-content-restore/route');
  const denial = await POST(new Request('http://localhost:3529/app/api/raw-content-restore', { method: 'POST' }));
  assert.equal(denial.status, 403);
  assert.equal(denial.headers.get('cache-control'), 'private, no-store');
  console.log('synthetic raw restore UI HTTP/queue proof passed');
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
