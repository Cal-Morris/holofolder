import { prepareLayoutIntent, type StagedSlotCommandIntent } from "@/lib/binder-slot-editing"
import { slotNavigationKey } from "@/lib/collection/slot-local-planning"
import { readSyntheticComplete } from "./slot-durable-session"
import { createIndexedDbStore } from "@/lib/offline-store/kv"
import { createSlotOfflineQueue } from "@/lib/collection/slot-offline-queue"
import { readCompleteInventorySnapshot } from "@/lib/collection/slot-snapshot"

// Browser-only synthetic proof entry, bundled by verify-slot-offline-storage.mjs, never served by the app.
const scope = { deviceId: "synthetic-device", workspaceId: "synthetic-workspace", accountId: "synthetic-account", ownerUserId: "synthetic-owner" }
const store = createIndexedDbStore(indexedDB, "synthetic-slot-offline-proof")
const queue = createSlotOfflineQueue(store, scope)
const collectionId = "00000000-0000-4000-8000-000000000001"
const localStore = createIndexedDbStore(indexedDB, "synthetic-local-slot-proof")
const localQueue = createSlotOfflineQueue(localStore, scope)
const auth = "synthetic-origin-session"
const navigation = { catalog: [], layouts: [{ collectionId, layoutRevision: 1, rows: 3, cols: 3 }] }
const api = {
  localQueue,
  async localSeed() {
    const snapshot = (await queue.read()).snapshot!
    await localQueue.saveSnapshotWithNavigation(await readSyntheticComplete(snapshot), navigation)
  },
  async localDraft(operationId: string) {
    const local = await localQueue.readLocalPlanning(auth)
    return prepareLayoutIntent(local.snapshot, { ownerUserId: scope.ownerUserId, collectionId, slotId: null },
      { kind: "append", newSlotId: operationId + "-slot" }, { source: "app", clientId: scope.deviceId, operationId, batchId: null, clientOccurredAt: "2026-01-01T00:00:00Z" }, local.resolver)
  },
  localAccept: (draft: StagedSlotCommandIntent) => localQueue.enqueueLocal(draft, auth, () => scope),
  async localInvalidate(draft: StagedSlotCommandIntent) {
    let active = true
    const blocked = { ...localStore, updateMany: ((keys, transform) => localStore.updateMany(keys, values => {
      active = false
      return transform(values)
    })) as typeof localStore.updateMany }
    await createSlotOfflineQueue(blocked, scope).enqueueLocal(draft, auth, () => active ? scope : null)
  },
  async localWrongSession() {
    await localQueue.replay(async () => { throw new Error("unexpected-send") }, () => scope, 0, () => undefined, undefined, "another-session")
  },
  async localAck(abort: boolean) {
    const record = await localQueue.read()
    const current = record.pending[1]?.base ?? record.optimistic!
    const metadata = { ...navigation, layouts: [{ ...navigation.layouts[0], layoutRevision: current.binders[0].layoutRevision }] }
    const broken = { ...localStore, updateMany: ((keys, transform) => localStore.updateMany(keys, values => {
      const next = transform(values)
      // IDB queues the baseline put, then DataCloneError on the metadata put aborts both.
      if (abort && next.writes.length === 2) next.writes[1] = [next.writes[1][0], { uncloneable: () => {} }]
      return next
    })) as typeof localStore.updateMany }
    const pending = (await localQueue.read()).pending[0]
    if (pending.lease) await localQueue.resume(pending.intent.request.operationId, pending.lease.until)
    await createSlotOfflineQueue(broken, scope).replay(async () => ({ status: 200, operationId: pending.intent.request.operationId }),
      () => scope, Date.now(), () => undefined, async () => ({ snapshot: await readSyntheticComplete(current), navigation: metadata }), auth)
  },
  localMetadata: () => localStore.get(slotNavigationKey(scope)),
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
