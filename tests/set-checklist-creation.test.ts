import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSetChecklist } from '@/lib/set-preset';
import { parseBinderCreationDraft, prepareBinderCreation } from '@/lib/binder-creation-draft';
import { normalizePresetManifest } from '@/lib/domain/binder-presets';
import { parseCollectionCreation, projectCollectionCreation } from '@/lib/domain/storage-creation';
import { readCompleteInventorySnapshot } from '@/lib/collection/slot-snapshot';
import { createSlotOfflineQueue } from '@/lib/collection/slot-offline-queue';
import { createMemoryStore } from '@/lib/offline-store/kv';
import { nativeCreationSchema, nativeArrangementSchema } from '@/lib/developer-api/storage';
import { syntheticPresetCards, syntheticPresetSet, syntheticPresetPromo } from './fixtures/set-preset';
import { jsonRoundTrip } from './fixtures/json-round-trip';

const owner = '01010000-0000-4000-8000-000000000001',
  collection = '01010000-0000-4000-8000-000000000002';
function checklist() {
  return generateSetChecklist({
    set: syntheticPresetSet,
    cards: syntheticPresetCards,
    promos: [syntheticPresetPromo],
    language: 'en',
    finishes: ['normal', 'reverse_holo'],
    excludedCardIds: ['synthetic-set-2'],
    capturedAt: '2026-11-10T12:00:00.000Z',
  });
}
async function base() {
  return readCompleteInventorySnapshot(owner, 0, {
    items: async () => ({ inventoryRevision: 0, total: 0, rows: [], next: null }),
    placements: async () => ({ inventoryRevision: 0, total: 0, rows: [], next: null }),
    collections: async () => ({ inventoryRevision: 0, total: 0, rows: [], next: null }),
    binders: async () => ({ inventoryRevision: 0, total: 0, rows: [], next: null }),
  });
}
test('reviewed set evidence crosses preparation, strict API parsing, durable queue reload and copied projection unchanged', async () => {
  const set = checklist(),
    operationId = 'synthetic-checklist-creation';
  const draft = parseBinderCreationDraft({
    version: 1,
    operationId,
    ownerUserId: owner,
    name: 'Synthetic set',
    manifest: set.manifest,
    setChecklist: set,
  });
  const snapshot = await base(),
    context = {
      source: 'app',
      clientId: 'synthetic-device',
      operationId,
      batchId: null,
      clientOccurredAt: set.scope.capturedAt,
    } as const;
  const intent = prepareBinderCreation(
    draft,
    snapshot,
    context,
    collection,
    set.manifest.entries.map((_, n) => 'synthetic-slot-' + n),
  );
  assert.equal(intent.kind, 'creation');
  assert.deepEqual(intent.request.manifest.setScope, set.scope);
  assert.deepEqual(parseCollectionCreation(jsonRoundTrip(intent.request)), intent.request);
  assert.deepEqual(nativeCreationSchema.parse(intent.request), intent.request);
  assert.equal(
    nativeArrangementSchema.shape.manifest.safeParse(intent.request.manifest).success,
    false,
    'scope is not advertised as executable by the independent import SQL',
  );
  const scope = { deviceId: 'synthetic-device', workspaceId: 'holofolder', accountId: owner, ownerUserId: owner },
    store = createMemoryStore();
  const queue = createSlotOfflineQueue(store, scope);
  await queue.saveSnapshot(snapshot);
  await queue.enqueue(intent, () => undefined, snapshot);
  const reopened = await createSlotOfflineQueue(store, scope).read();
  assert.deepEqual(reopened.pending[0].intent, intent);
  assert.equal(reopened.snapshot?.binders.length, 0, 'pending is not a fabricated usable collection');
  const first = projectCollectionCreation(intent.request, owner),
    second = projectCollectionCreation(
      {
        ...intent.request,
        collectionId: '01010000-0000-4000-8000-000000000003',
        slotIds: intent.request.slotIds.map((id) => id + '-other'),
      },
      owner,
    );
  first.slots.pop();
  assert.equal(second.slots.length, set.manifest.entries.length);
  assert.deepEqual(first.presetManifest, second.presetManifest);
  assert.deepEqual(first.presetManifest?.setScope, set.scope);
  assert.equal(
    first.slots.every((s) => s.inventoryItemId === null && s.wantedCards.length === 0),
    true,
  );
});
test('scope cannot be detached from its initial targets, evidence or disclosures; old manifests remain byte compatible', () => {
  const set = checklist(),
    manifest = { ...set.manifest, setScope: set.scope };
  assert.deepEqual(normalizePresetManifest(manifest), manifest);
  assert.deepEqual(normalizePresetManifest(set.manifest), set.manifest);
  for (const mutate of [
    (m: typeof manifest) => {
      m.setScope.language = 'fr';
    },
    (m: typeof manifest) => {
      m.setScope.excludedCardIds = [];
    },
    (m: typeof manifest) => {
      m.setScope.finishes = [];
    },
    (m: typeof manifest) => {
      m.setScope.warnings = [];
    },
    (m: typeof manifest) => {
      m.entries.pop();
    },
  ]) {
    const changed = structuredClone(manifest);
    mutate(changed);
    assert.equal(normalizePresetManifest(changed), undefined);
  }
});
