import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Session } from '@supabase/supabase-js';
import { cachedNativeIdentity, readCachedNativeStartup, rememberNativeStartup } from '@/lib/collection/native-startup';
import { BINDER_START_MARKER_KEY, readBinderStartMarker, writeBinderStartMarker } from '@/lib/binder-start';
import { createMemoryStore } from '@/lib/offline-store/kv';
import { createSlotOfflineQueue, offlineScopeKey } from '@/lib/collection/slot-offline-queue';
import { isCompleteInventorySnapshot } from '@/lib/collection/slot-snapshot';
import { inventoryBrowseFixture, inventoryBrowseLayouts, inventoryBrowseCatalog } from './fixtures/inventory-browse';
import { readSyntheticComplete } from './fixtures/slot-durable-session';

const now = 1_800_000_000_000;
function fixture(owner = 'owner') {
  const data = new Map<string, string>([['holofolder-slot-device-v1', 'device']]);
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
  const scope = {
    actorUserId: 'owner',
    ownerUserId: owner,
    authSessionId: 'auth-session',
    sessionId: 'never-persist-this-epoch',
  };
  rememberNativeStartup(storage, scope);
  const claims = { sub: 'owner', session_id: 'auth-session', exp: now / 1000 + 600 };
  const session = {
    user: { id: 'owner' },
    expires_at: claims.exp,
    access_token: `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.synthetic`,
  } as Session;
  return { storage, data, scope, session };
}

test('cached identity uses existing unexpired Supabase session, never persisted lifecycle or token', () => {
  const f = fixture();
  assert.ok(cachedNativeIdentity(f.storage, f.session, now));
  const bytes = f.data.get(BINDER_START_MARKER_KEY)!;
  assert.ok(!bytes.includes(f.scope.sessionId) && !bytes.includes(f.session.access_token));
  for (const session of [
    null,
    { ...f.session, expires_at: now / 1000 },
    { ...f.session, user: { id: 'someone-else' } },
    { ...f.session, access_token: 'broken' },
  ])
    assert.equal(cachedNativeIdentity(f.storage, session as Session | null, now), null);
  f.data.set('holofolder-slot-device-v1', 'another-device');
  assert.equal(cachedNativeIdentity(f.storage, f.session, now), null);
});
test('relinked auth session, expired JWT and old/malformed bootstrap are unavailable', () => {
  for (const claims of [
    { sub: 'owner', session_id: 'relinked', exp: now / 1000 + 60 },
    { sub: 'owner', session_id: 'auth-session', exp: now / 1000 - 1 },
  ]) {
    const f = fixture();
    f.session.access_token = `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.synthetic`;
    assert.equal(cachedNativeIdentity(f.storage, f.session, now), null);
  }
  for (const native of [
    undefined,
    { version: 0, deviceId: 'device', authSessionId: 'auth-session' },
    { version: 1, deviceId: null },
  ]) {
    const f = fixture();
    f.data.set(BINDER_START_MARKER_KEY, JSON.stringify({ userId: 'owner', ownerUserId: 'owner', native }));
    assert.equal(cachedNativeIdentity(f.storage, f.session, now), null);
  }
});
test('partner display retains exact legacy scoped billing-cache policy', () => {
  const f = fixture('partner');
  assert.equal(cachedNativeIdentity(f.storage, f.session, now), null);
  const access = { ownerUserId: 'partner', enforced: false, source: 'free', savedCardCount: 0 };
  f.data.set('holofolder_billing_v1', JSON.stringify({ accountId: 'owner', access }));
  assert.ok(cachedNativeIdentity(f.storage, f.session, now));
  f.data.set('holofolder_billing_v1', JSON.stringify({ accountId: 'other', access }));
  assert.equal(cachedNativeIdentity(f.storage, f.session, now), null);
  f.data.set('holofolder_billing_v1', JSON.stringify({ accountId: 'owner', access: { ...access, enforced: true } }));
  assert.equal(cachedNativeIdentity(f.storage, f.session, now), null);
});
test('server legacy marker keeps only same account/owner native pointer', () => {
  const f = fixture();
  writeBinderStartMarker(f.storage, { userId: 'owner', ownerUserId: 'owner', binderId: 'alpha', binders: [] });
  assert.ok(readBinderStartMarker(f.storage)?.native);
  writeBinderStartMarker(f.storage, { userId: 'owner', ownerUserId: 'other', binderId: null, binders: [] });
  assert.equal(readBinderStartMarker(f.storage)?.native, undefined);
});
test('canonical baseline plus pending layout reopens as cached only with unchanged queue/receipts', async () => {
  const f = fixture(),
    identity = cachedNativeIdentity(f.storage, f.session, now)!,
    store = createMemoryStore();
  const snapshot = inventoryBrowseFixture();
  snapshot.ownerUserId = 'owner';
  snapshot.items.forEach((i) => {
    i.ownerUserId = 'owner';
  });
  snapshot.collections.forEach((c) => {
    c.ownerUserId = 'owner';
  });
  snapshot.binders.forEach((b) => {
    b.ownerUserId = 'owner';
    b.slots.forEach((s) => {
      s.ownerUserId = 'owner';
    });
  });
  const alpha = '22222222-2222-4222-8222-222222222222';
  snapshot.collections[0].id = alpha;
  snapshot.binders[0].collectionId = alpha;
  snapshot.binders[0].slots.forEach((slot) => {
    slot.collectionId = alpha;
  });
  snapshot.placements[0].collectionId = alpha;
  const layouts = inventoryBrowseLayouts.map((l) => (l.collectionId === 'alpha' ? { ...l, collectionId: alpha } : l));
  const queue = createSlotOfflineQueue(store, identity.scope);
  await queue.saveSnapshot(await readSyntheticComplete(snapshot));
  const metadataKey = `slot-navigation-v1:${JSON.stringify(['device', 'owner', 'owner'])}`;
  await store.set(metadataKey, { catalog: inventoryBrowseCatalog, layouts });
  await queue.enqueue(
    {
      kind: 'slots',
      request: {
        collectionId: alpha,
        operationId: 'insert-operation',
        inventoryRevision: snapshot.inventoryRevision,
        collectionVersion: 1,
        layoutRevision: 1,
        commands: [{ kind: 'create', ids: ['new-slot'], beforeSlotId: null }],
      },
      context: {
        source: 'app',
        clientId: 'device',
        operationId: 'insert-operation',
        batchId: null,
        clientOccurredAt: '2026-01-01T00:00:00Z',
      },
    },
    () => undefined,
  );
  const before = await store.get(offlineScopeKey(identity.scope));
  const boot = await readCachedNativeStartup(store, identity, 'new-local-epoch');
  assert.equal(boot.pending, 1);
  assert.equal(boot.read.evidence.kind, 'cached');
  assert.equal(isCompleteInventorySnapshot(boot.read.evidence.snapshot), false);
  assert.equal(boot.read.layouts[0].layoutRevision, 2);
  assert.equal(boot.read.evidence.snapshot.binders[0].slots.length, 13);
  assert.deepEqual(await store.get(offlineScopeKey(identity.scope)), before);
  for (const metadata of [
    undefined,
    {},
    { catalog: inventoryBrowseCatalog, layouts: [] },
    { catalog: inventoryBrowseCatalog, layouts: [{ ...inventoryBrowseLayouts[0], layoutRevision: 99 }] },
  ]) {
    await store.set(metadataKey, metadata);
    await assert.rejects(readCachedNativeStartup(store, identity, 'epoch'), /metadata-unavailable/);
    assert.deepEqual(await store.get(offlineScopeKey(identity.scope)), before);
  }
});
test('cold uncached and unavailable storage never fabricate an empty complete inventory', async () => {
  const f = fixture(),
    identity = cachedNativeIdentity(f.storage, f.session, now)!,
    store = createMemoryStore();
  await assert.rejects(readCachedNativeStartup(store, identity, 'epoch'), /not-saved/);
  await assert.rejects(
    readCachedNativeStartup(
      {
        ...store,
        get: async () => {
          throw new Error('storage-failure');
        },
      },
      identity,
      'epoch',
    ),
    /storage-failure/,
  );
});

test('dead refresh cannot hold startup forever or establish cached identity', async () => {
  const { readDeviceStartupSession } = await import('@/lib/collection/native-startup');
  assert.equal(await readDeviceStartupSession(() => new Promise(() => {}), 5), null);
  assert.equal(
    await readDeviceStartupSession(async () => {
      throw new Error('network');
    }),
    null,
  );
  const { session } = fixture();
  assert.equal(await readDeviceStartupSession(async () => ({ data: { session } })), session);
});

test('cached identity expires at the earlier session or JWT deadline', () => {
  for (const [sessionSeconds, jwtSeconds] of [
    [600, 1],
    [1, 600],
  ]) {
    const f = fixture();
    f.session.expires_at = now / 1000 + sessionSeconds;
    const claims = { sub: 'owner', session_id: 'auth-session', exp: now / 1000 + jwtSeconds };
    f.session.access_token = `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.synthetic`;
    assert.equal(cachedNativeIdentity(f.storage, f.session, now)?.expiresAt, now + 1000);
    assert.equal(cachedNativeIdentity(f.storage, f.session, now + 2000), null);
  }
});
