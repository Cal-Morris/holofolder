import { readCurrentCollectionNavigation } from '@/lib/collection/inventory-navigation-read';
import { navigationIndex, navigationLocation } from '@/lib/collection-navigation';
import { fetchCurrentInventorySnapshot } from '@/lib/collection/inventory-read-browser';
import type { InventoryReadScope } from '@/lib/collection/inventory-read-transport';
import { createSlotOfflineQueue } from '@/lib/collection/slot-offline-queue';
import { createIndexedDbStore } from '@/lib/offline-store/kv';
import { isCompleteInventorySnapshot } from '@/lib/collection/slot-snapshot';

// Synthetic browser-only proof entry. Never imported by the application.
const owner = '11111111-1111-4111-8111-111111111111',
  collectionId = '22222222-2222-4222-8222-222222222222';
const scope = {
  deviceId: 'synthetic-device',
  workspaceId: 'synthetic-workspace',
  accountId: owner,
  ownerUserId: owner,
};
let live: InventoryReadScope | null = {
  actorUserId: owner,
  ownerUserId: owner,
  authSessionId: 'synthetic-auth-session',
  sessionId: 'synthetic-lifecycle',
};
const queue = createSlotOfflineQueue(createIndexedDbStore(indexedDB, 'synthetic-inventory-transport'), scope);
let retained: ReturnType<typeof fetchCurrentInventorySnapshot> | undefined;
const read = () => fetchCurrentInventorySnapshot(() => live);
const api = {
  async seed() {
    const result = await read();
    if (result.status !== 'complete') throw new Error(result.code);
    await queue.saveSnapshot(result.snapshot);
    return {
      count: result.snapshot.items.length,
      branded: isCompleteInventorySnapshot(result.snapshot),
      jsonBranded: isCompleteInventorySnapshot(JSON.parse(JSON.stringify(result.snapshot))),
    };
  },
  async navigation() {
    const read = await readCurrentCollectionNavigation(() => live);
    const index = navigationIndex(read.scope, read);
    const location = navigationLocation(read.scope, read, {
      itemId: 'synthetic-01030',
      collectionId: 'obsolete',
      slotId: 'obsolete',
    });
    return {
      scope: read.scope,
      indexKind: index.kind,
      location,
      privateLocation: read.evidence.kind === 'complete' ? read.evidence.snapshot.collections[0].location : undefined,
    };
  },
  partner() {
    if (live) live = { ...live, actorUserId: '33333333-3333-4333-8333-333333333333' };
  },
  async enqueue() {
    await queue.enqueue(
      {
        kind: 'slots',
        request: {
          collectionId,
          operationId: 'synthetic-transport-command',
          inventoryRevision: 7,
          collectionVersion: 3,
          layoutRevision: 4,
          commands: [{ kind: 'create', ids: ['synthetic-transport-slot'], beforeSlotId: null }],
        },
        context: {
          source: 'app',
          clientId: scope.deviceId,
          operationId: 'synthetic-transport-command',
          batchId: null,
          clientOccurredAt: '2026-01-01T00:00:00Z',
        },
      },
      () => undefined,
    );
  },
  startRead() {
    retained = read();
  },
  async settleRead() {
    return (await retained)?.status;
  },
  async replay(mode: 'retained' | 'fresh', now: number) {
    // Synthetic successful execution reply only. No real command endpoint or hosted write.
    await queue.replay(
      async () => ({ status: 200, operationId: 'synthetic-transport-command' }),
      () => scope,
      now,
      () => undefined,
      async () => {
        const result = await (mode === 'fresh' ? read() : retained);
        return result?.status === 'complete' ? result.snapshot : undefined;
      },
    );
    return queue.read();
  },
  state: () => queue.read(),
  switchSession() {
    live = live ? { ...live, sessionId: 'synthetic-relinked' } : null;
  },
  read,
};
Object.assign(globalThis, { inventoryReadProof: api });
export type InventoryReadProof = typeof api;
