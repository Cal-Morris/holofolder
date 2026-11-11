import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickerCandidate, prepareSlotPickerIntent } from '@/lib/slot-picker';
import { syntheticSlotPickerSnapshot } from '@/tests/fixtures/slot-picker';
import { createSlotOfflineQueue } from '@/lib/collection/slot-offline-queue';
import { createMemoryStore } from '@/lib/offline-store/kv';
import { readCompleteInventorySnapshot } from '@/lib/collection/slot-snapshot';
import { browserHostCatalog, withSelectedPrintings } from '@/lib/collection/browser-host-catalog';
import { slotDraftFailureMessage } from '@/lib/slot-draft-failure';
import type { InventoryCatalogResolver, InventorySnapshot } from '@/lib/domain/inventory';

// #609: a picked printing the read catalog has never seen (an unowned card) must still save on device.
const setup = async () => {
  const data = syntheticSlotPickerSnapshot(),
    s = data.inventory,
    owner = s.ownerUserId;
  const picked = data.cards.find((c) => c.name === 'Snorlax B')!;
  // The host read catalog only knows printings already referenced by the collection, so not Snorlax B.
  const host: InventoryCatalogResolver = (id) =>
    id === picked.id ? undefined : ((c) => (c ? pickerCandidate(c) : undefined))(data.cards.find((c) => c.id === id));
  const selected: InventoryCatalogResolver = (id) => (id === picked.id ? pickerCandidate(picked) : host(id));
  const scope = { deviceId: 'synthetic-device', workspaceId: 'holofolder', accountId: owner, ownerUserId: owner };
  const page =
    <T>(rows: T[]) =>
    async () => ({ inventoryRevision: s.inventoryRevision, total: rows.length, rows, next: null });
  const complete: InventorySnapshot = await readCompleteInventorySnapshot(owner, s.inventoryRevision, {
    items: page(s.items),
    placements: page(s.placements),
    collections: page(s.collections),
    binders: page(s.binders),
  });
  const queue = createSlotOfflineQueue(createMemoryStore(), scope);
  await queue.saveSnapshot(complete, host);
  const identity = { kind: 'card' as const, cardId: picked.id, language: 'en' as const, finish: 'normal' as const };
  const { intent } = prepareSlotPickerIntent(
    complete,
    { ownerUserId: owner, collectionId: data.binder.collectionId, slotId: 'slot-g' },
    { kind: 'assign', selection: { kind: 'catalog', identity, newItemId: 'synthetic-new-copy' }, fulfillWant: null },
    { source: 'app', clientId: null, operationId: 'synthetic-op', batchId: null, clientOccurredAt: null },
    selected,
  );
  return { queue, host, selected, intent, picked };
};

test('host catalog alone rejects the unowned pick: the production failure', async () => {
  const { queue, host, intent } = await setup();
  await assert.rejects(queue.enqueue(intent, host), /catalog-unavailable/);
  assert.equal((await queue.read()).pending.length, 0);
});

test('selected-printing evidence lets the same draft save once, and an exact retry is idempotent', async () => {
  const { queue, host, selected, intent } = await setup();
  await queue.enqueue(intent, withSelectedPrintings(host, [], selected));
  await queue.enqueue(intent, withSelectedPrintings(host, [], selected));
  const record = await queue.read();
  assert.equal(record.pending.length, 1);
  assert.equal(record.pending[0].intent.request.operationId, 'synthetic-op');
  assert.ok(record.optimistic!.items.some((i) => i.id === 'synthetic-new-copy'));
});

test('the read catalog stays authoritative over picker evidence for printings it knows', () => {
  const known = { kind: 'card' as const, id: 'known', canonicalId: 'known', aliasIds: [], pokemonIds: [1] };
  const forged = { kind: 'card' as const, id: 'known', canonicalId: 'other', aliasIds: [], pokemonIds: [2] };
  const fresh = { kind: 'card' as const, id: 'fresh', canonicalId: 'fresh', aliasIds: [], pokemonIds: [3] };
  const host: InventoryCatalogResolver = (id) => (id === 'known' ? known : undefined);
  const resolve = withSelectedPrintings(host, [], (id) =>
    id === 'known' ? forged : id === 'fresh' ? fresh : undefined,
  );
  assert.equal(resolve('known'), known);
  assert.equal(resolve('fresh'), fresh);
  assert.equal(resolve('missing'), undefined);
  assert.equal(withSelectedPrintings(host, []), host);
});

test('failures name their actual cause, not storage', () => {
  assert.match(slotDraftFailureMessage(new DOMException('full', 'QuotaExceededError')), /storage/);
  assert.doesNotMatch(slotDraftFailureMessage(new Error('catalog-unavailable')), /storage/);
  assert.doesNotMatch(slotDraftFailureMessage(new Error('fresh-scoped-read-required')), /storage/);
  assert.match(slotDraftFailureMessage(new Error('slot-conflict')), /changed/);
  for (const reason of ['catalog-unavailable', 'slot-conflict', 'fresh-scoped-read-required', 'anything'])
    assert.match(slotDraftFailureMessage(new Error(reason)), /Save not confirmed\.$/);
});

test('selected evidence cannot override an ambiguous own or alias ID already present in the read', () => {
  const card = {
    id: 'known',
    localId: '1',
    name: 'Known',
    set: { id: 'set', name: 'Set' },
    aliasIds: ['shared-alias'],
  };
  const evidence = [
    { card: { ...card, canonicalId: 'known' }, pokemonIds: [1], speciesNames: ['Synthetic one'] },
    { card: { ...card, canonicalId: 'other' }, pokemonIds: [2], speciesNames: ['Synthetic two'] },
  ];
  const host = browserHostCatalog(evidence);
  const picked = { kind: 'card' as const, id: 'known', pokemonIds: [1] };
  const resolve = withSelectedPrintings(host, evidence, () => picked);
  assert.equal(host('known'), undefined);
  assert.equal(host('shared-alias'), undefined);
  assert.equal(resolve('known'), undefined);
  assert.equal(resolve('shared-alias'), undefined);
  assert.equal(resolve('fresh'), picked);
});

test('aborted or unknown saves never invent a quota failure or assert no commit', () => {
  assert.doesNotMatch(
    slotDraftFailureMessage(new DOMException('aborted', 'AbortError')),
    /storage|Free|Nothing is saved/,
  );
  assert.doesNotMatch(slotDraftFailureMessage(new Error('IndexedDB transaction aborted')), /Free|Nothing is saved/);
  assert.doesNotMatch(slotDraftFailureMessage(new Error('unknown outcome')), /Nothing is saved/);
});
