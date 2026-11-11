import { createIndexedDbStore } from '@/lib/offline-store/kv';
import { createSlotOfflineQueue } from '@/lib/collection/slot-offline-queue';
import { readCompleteInventorySnapshot } from '@/lib/collection/slot-snapshot';

// Browser-only synthetic proof entry, bundled by verify-slot-offline-storage.mjs, never served by the app.
const scope = {
  deviceId: 'synthetic-device',
  workspaceId: 'synthetic-workspace',
  accountId: 'synthetic-account',
  ownerUserId: 'synthetic-owner',
};
const store = createIndexedDbStore(indexedDB, 'synthetic-slot-offline-proof');
const queue = createSlotOfflineQueue(store, scope);
const collectionId = '00000000-0000-4000-8000-000000000001';
const api = {
  queue,
  async seed() {
    const page =
      <T>(rows: T[]) =>
      async () => ({ inventoryRevision: 1, total: rows.length, rows, next: null });
    const snapshot = await readCompleteInventorySnapshot(scope.ownerUserId, 1, {
      items: page([]),
      placements: page([]),
      collections: page([
        {
          id: collectionId,
          ownerUserId: scope.ownerUserId,
          name: 'Synthetic',
          kind: 'binder' as const,
          defaultPresentation: 'binder' as const,
          version: 1,
        },
      ]),
      binders: page([
        { ownerUserId: scope.ownerUserId, collectionId, layoutRevision: 1, presetManifest: null, slots: [] },
      ]),
    });
    await queue.saveSnapshot(snapshot);
    // Existing legacy protocol record must survive staged writes/reopens unchanged.
    await store.set('collection', { pendingOperations: [{ id: 'synthetic-legacy' }] });
  },
  async append(operationId: string, slotId: string, expectedRevision: number) {
    await queue.enqueue(
      {
        kind: 'slots',
        request: {
          collectionId,
          operationId,
          inventoryRevision: expectedRevision,
          collectionVersion: expectedRevision,
          layoutRevision: expectedRevision,
          commands: [{ kind: 'create', ids: [slotId], beforeSlotId: null }],
        },
        context: {
          source: 'app',
          clientId: scope.deviceId,
          operationId,
          batchId: null,
          clientOccurredAt: '2026-01-01T00:00:00Z',
        },
      },
      () => undefined,
    );
  },
  async crossTabAppend(operationId: string) {
    // Identical no-op metadata command against an empty-slot-free owner snapshot is not needed:
    // use the atomic primitive to prove independent simultaneous transactions preserve both writers.
    await store.update('synthetic-concurrent', (value) => [...((value as string[]) ?? []), operationId]);
  },
  async abort() {
    await store.update('synthetic-concurrent', () => {
      throw new Error('synthetic-crash');
    });
  },
  concurrent: () => store.get('synthetic-concurrent'),
  legacy: () => store.get('collection'),
};
Object.assign(globalThis, { slotOfflineProof: api });
