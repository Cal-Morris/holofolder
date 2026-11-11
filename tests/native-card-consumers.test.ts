import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nativeCardConsumers,
  nativeCardState,
  nativeSpeciesCollection,
  nativeWantSelections,
  prepareNativeWant,
} from '@/lib/collection/native-card-consumers';
import { getSetCompletion } from '@/lib/set-completion';
import { getSetCardState } from '@/lib/set-checklist';
import { completeInventoryBrowseFixture, inventoryProjectionCatalog } from './fixtures/inventory-browse';

import { nativeConsumerFixture } from './fixtures/native-card-consumers';

test('distinct copies, Unassigned, repeated explicit wants, nullable species and no target wants', async () => {
  const { binding } = await nativeConsumerFixture();
  const model = nativeCardConsumers(binding)!;
  assert.equal(model.projection.owned.length, 6);
  assert.equal(model.projection.owned.filter((c) => !c.placement).length, 4);
  assert.equal(model.wants.length, 3);
  assert.equal(new Set(model.wants.map((w) => w.key)).size, 3);
  const trainer = { ...inventoryProjectionCatalog[1].card, dexIds: [] };
  assert.deepEqual(nativeCardState(model, trainer), {
    known: true,
    owned: true,
    wanted: true,
    ownedCount: 1,
    wantedCount: 3,
  });
  assert.equal(nativeCardState(model, inventoryProjectionCatalog[0].card).ownedCount, 3);
  const selected = nativeCardConsumers({
    ...binding,
    collectionId: binding.read.evidence.kind !== 'unavailable' ? binding.read.evidence.snapshot.collections[0].id : '',
  })!;
  assert.equal(selected.projection.owned.length, 1);
  assert.equal(selected.wants.length, 3);
  assert.equal(
    nativeWantSelections(selected, selected.wants[0].destination)[0].selection.inventoryItemId,
    'copy-00004',
  );
  assert.equal(nativeCardConsumers({ ...binding, collectionId: 'missing' }), null);
});

test('chosen exact copy and wanted index use the existing assign command, no species destination', async () => {
  const { binding } = await nativeConsumerFixture();
  const entry = nativeCardConsumers(binding)!.wants[1];
  const choices = nativeWantSelections(nativeCardConsumers(binding), entry.destination);
  assert.equal(choices.length, 1);
  const prepared = prepareNativeWant(binding, entry.destination, choices[0].selection);
  assert.equal(prepared.intent.kind, 'inventory');
  if (prepared.intent.kind !== 'inventory') return;
  const command = prepared.intent.request.commands[0];
  assert.equal(command.kind, 'assign');
  if (command.kind !== 'assign') return;
  assert.equal(command.destination.slot.id, entry.destination.slotId);
  assert.equal(command.fulfillWant?.index, 1);
  assert.equal(prepared.preview.binders[0].slots[0].wantedCards.length, 1);
  assert.equal(prepared.preview.binders[0].slots[1].wantedCards.length, 1);
  assert.equal(prepared.preview.items.length, 6);
});

test('cached reads, unavailable admission and changed session/versions fail closed', async () => {
  const { binding, snapshot } = await nativeConsumerFixture();
  const destination = nativeCardConsumers(binding)!.wants[0].destination;
  const selection = nativeWantSelections(nativeCardConsumers(binding), destination)[0].selection;
  const original = binding.admit()!;
  for (const changed of [
    { ...binding, editingAvailable: false },
    { ...binding, admit: () => null },
    { ...binding, admit: () => ({ ...original, scope: { ...binding.scope, sessionId: 'new-session' } }) },
    {
      ...binding,
      admit: () => ({ ...original, read: { ...binding.read, evidence: { kind: 'cached' as const, snapshot } } }),
    },
  ])
    assert.throws(() => prepareNativeWant(changed, destination, selection));
  for (const field of ['inventoryRevision', 'collectionVersion', 'layoutRevision', 'slotVersion'] as const) {
    assert.throws(() => prepareNativeWant(binding, { ...destination, [field]: destination[field] + 1 }, selection));
  }
  assert.throws(() => prepareNativeWant(binding, { ...destination, wantedIndex: 99 }, selection));
  assert.equal(nativeCardConsumers({ ...binding, scope: { ...binding.scope, sessionId: 'other' } }), null);
});

test('unknown finish/language/catalog stays unknown; private grading is absent from consumer choices', async () => {
  const { binding, snapshot } = await nativeConsumerFixture();
  delete snapshot.binders[0].slots[0].wantedCards[0].card_language;
  snapshot.items[3].grading = structuredClone(snapshot.items[2].grading);
  binding.read = { ...binding.read, evidence: { kind: 'cached', snapshot } };
  const model = nativeCardConsumers(binding)!;
  assert.equal(model.wants[0].card, null);
  assert.equal(nativeWantSelections(nativeCardConsumers(binding), model.wants[0].destination).length, 0);
  assert.doesNotMatch(JSON.stringify(model.wants), /SYNTHETIC-PRIVATE/);
  assert.doesNotMatch(
    JSON.stringify(nativeWantSelections(nativeCardConsumers(binding), model.wants[1].destination)),
    /SYNTHETIC-PRIVATE|psa|cgc/i,
  );
  snapshot.items[0].identity = { kind: 'card', cardId: 'synthetic-snorlax', language: 'en' };
  assert.equal(nativeCardState(nativeCardConsumers(binding), inventoryProjectionCatalog[0].card).ownedCount, 3);
  assert.equal(
    nativeCardState(nativeCardConsumers(binding), inventoryProjectionCatalog[0].card, 'normal').ownedCount,
    2,
  );
});

test('repeated identical unassigned copies are each offered without grade grouping', async () => {
  const { binding, snapshot } = await nativeConsumerFixture();
  const original = snapshot.items[3];
  snapshot.items.push({ ...structuredClone(original), id: 'another-trainer-copy' });
  binding.read = {
    ...binding.read,
    evidence: { kind: 'complete', snapshot: await completeInventoryBrowseFixture(snapshot) },
  };
  const entry = nativeCardConsumers(binding)!.wants[0];
  assert.deepEqual(
    nativeWantSelections(nativeCardConsumers(binding), entry.destination).map((c) => c.selection.inventoryItemId),
    ['copy-00004', 'another-trainer-copy'],
  );
});

test('new Raw cannot bypass existing-copy choice or a mismatched printing', async () => {
  const { binding } = await nativeConsumerFixture();
  const entry = nativeCardConsumers(binding)!.wants[0];
  assert.throws(
    () =>
      prepareNativeWant(binding, entry.destination, {
        kind: 'catalog',
        newItemId: 'synthetic-new-copy',
        identity: { kind: 'card', cardId: 'synthetic-trainer', language: 'en', finish: 'normal' },
      }),
    /Choose an exact copy/,
  );
  assert.throws(
    () =>
      prepareNativeWant(binding, entry.destination, {
        kind: 'existing',
        inventoryItemId: 'copy-00003',
        itemVersion: 1,
      }),
    /Choose an exact copy/,
  );
});

test('first-party exact wanted evidence is forwarded without reconstructing private attribution', async () => {
  const { binding, snapshot } = await nativeConsumerFixture();
  snapshot.binders[0].slots[0].wantedCards[1].wanted_by = ['11111111-1111-4111-8111-111111111111'];
  snapshot.binders[0].slots[0].wantedCards[1].card_image =
    'https://assets.tcgdex.net/en/synthetic/private-evidence/high.webp';
  binding.read = {
    ...binding.read,
    evidence: { kind: 'complete', snapshot: await completeInventoryBrowseFixture(snapshot) },
  };
  const original = { ...binding.admit()!, read: binding.read };
  binding.admit = () => original;
  const entry = nativeCardConsumers(binding)!.wants[1];
  assert.equal('wanted_by' in entry.destination.expectedPublic, false);
  const prepared = prepareNativeWant(
    binding,
    entry.destination,
    nativeWantSelections(nativeCardConsumers(binding), entry.destination)[0].selection,
  );
  if (prepared.intent.kind !== 'inventory' || prepared.intent.request.commands[0].kind !== 'assign') assert.fail();
  assert.deepEqual(prepared.intent.request.commands[0].fulfillWant, {
    index: 1,
    expected: snapshot.binders[0].slots[0].wantedCards[1],
  });
});

for (const change of ['occupied', 'target', 'wanted', 'copy'] as const)
  test(`current ${change} change refuses the original destination without a sink call`, async () => {
    const { binding, snapshot } = await nativeConsumerFixture();
    const entry = nativeCardConsumers(binding)!.wants[0];
    const selection = nativeWantSelections(nativeCardConsumers(binding), entry.destination)[0].selection;
    if (change === 'target') snapshot.binders[0].slots[0].target = { kind: 'pokemon', pokemonId: 143 };
    if (change === 'wanted') snapshot.binders[0].slots[0].wantedCards[0].card_name = 'Changed synthetic want';
    if (change === 'copy') snapshot.items[3].version++;
    if (change === 'occupied') {
      snapshot.binders[0].slots[0].inventoryItemId = snapshot.items[3].id;
      snapshot.binders[0].slots[0].status = 'collected';
      snapshot.placements.push({
        inventoryItemId: snapshot.items[3].id,
        slotId: snapshot.binders[0].slots[0].id,
        collectionId: snapshot.binders[0].collectionId,
        version: 1,
      });
    }
    const read = {
      ...binding.read,
      evidence: { kind: 'complete' as const, snapshot: await completeInventoryBrowseFixture(snapshot) },
    };
    const admission = { ...binding.admit()!, read };
    binding.admit = () => admission;
    assert.throws(() => prepareNativeWant(binding, entry.destination, selection));
  });

test('public reconstruction is not branded complete evidence', async () => {
  const { binding } = await nativeConsumerFixture();
  if (binding.read.evidence.kind !== 'complete') assert.fail();
  const forged = {
    ...binding,
    read: {
      ...binding.read,
      evidence: { kind: 'complete' as const, snapshot: structuredClone(binding.read.evidence.snapshot) },
    },
  };
  assert.equal(nativeCardConsumers(forged), null);
});

test('explicit new Raw uses the original assign planner only when no matching Unassigned copy exists', async () => {
  const { binding, snapshot } = await nativeConsumerFixture();
  snapshot.items = snapshot.items.filter((i) => i.id !== 'copy-00004');
  const read = {
    ...binding.read,
    evidence: { kind: 'complete' as const, snapshot: await completeInventoryBrowseFixture(snapshot) },
  };
  binding.read = read;
  const admitted = { ...binding.admit()!, read };
  binding.admit = () => admitted;
  const entry = nativeCardConsumers(binding)!.wants[1];
  const selection = {
    kind: 'catalog' as const,
    newItemId: 'synthetic-new-raw',
    identity: {
      kind: 'card' as const,
      cardId: 'synthetic-trainer',
      language: 'en' as const,
      finish: 'normal' as const,
    },
  };
  const prepared = prepareNativeWant(binding, entry.destination, selection);
  assert.equal(prepared.preview.items.length, 6);
  assert.equal(prepared.preview.binders[0].slots[0].inventoryItemId, selection.newItemId);
  assert.equal(prepared.preview.items.find((i) => i.id === selection.newItemId)!.grading, null);
  assert.equal(prepared.preview.binders[0].slots[0].wantedCards.length, 1);
});

test('Wanted binding preserves Trainer and Energy destinations while empty card/species targets stay separate', async () => {
  const { binding, snapshot } = await nativeConsumerFixture();
  const binder = snapshot.binders[0];
  binder.slots[2].wantedCards = [
    { ...binder.slots[0].wantedCards[0], card_id: 'synthetic-energy', card_name: 'Synthetic Energy' },
  ];
  binder.slots[3].target = { kind: 'card', cardId: 'synthetic-energy', language: 'en', finish: 'normal' };
  binder.slots[4].target = { kind: 'pokemon', pokemonId: 143 };
  binding.read = {
    ...binding.read,
    evidence: { kind: 'complete', snapshot: await completeInventoryBrowseFixture(snapshot) },
  };
  const model = nativeCardConsumers({ ...binding, collectionId: binder.collectionId })!;
  assert.equal(model.wants.length, 4);
  assert.deepEqual(
    model.wants.map((w) => [w.destination.collectionId, w.destination.slotId, w.destination.wantedIndex]),
    [
      [binder.collectionId, binder.slots[0].id, 0],
      [binder.collectionId, binder.slots[0].id, 1],
      [binder.collectionId, binder.slots[1].id, 0],
      [binder.collectionId, binder.slots[2].id, 0],
    ],
  );
  assert.deepEqual(
    model.wants.map((w) => w.card?.name),
    ['Synthetic Trainer', 'Synthetic Trainer', 'Synthetic Trainer', 'Synthetic Energy'],
  );
  assert.ok(model.wants.every((w) => w.card?.dexIds.length === 0));
});

test('species view: copies own their species, explicit wants mark it, plain targets do neither, scope is honoured', async () => {
  const { binding, snapshot } = await nativeConsumerFixture();
  const snorlaxWant = {
    card_id: 'synthetic-snorlax',
    card_name: 'Synthetic Snorlax',
    card_language: 'en' as const,
    card_finish: 'holo' as const,
    added_at: '2026-11-09T00:00:00Z',
  };
  snapshot.binders[1].slots[2].wantedCards = [snorlaxWant];
  snapshot.binders[1].slots[3].target = { kind: 'pokemon', pokemonId: 25 };
  snapshot.binders[1].slots[4].target = { kind: 'card', cardId: 'synthetic-energy', language: 'en', finish: 'normal' };
  binding.read = {
    ...binding.read,
    evidence: { kind: 'complete', snapshot: await completeInventoryBrowseFixture(snapshot) },
  };
  const all = nativeSpeciesCollection(binding)!;
  assert.deepEqual([...all.bySpecies.keys()], [143]);
  const snorlax = all.bySpecies.get(143)!;
  assert.equal(snorlax.status, 'collected');
  assert.equal(snorlax.card_id, 'synthetic-snorlax');
  assert.deepEqual(snorlax.wanted_cards, [snorlaxWant]);
  // Six physical copies stay six rows (three Snorlax, one Pokémon-only, Trainer, Energy) plus four explicit wants.
  assert.equal(all.rows.filter((r) => r.status !== 'wishlisted').length, 6);
  assert.equal(all.rows.filter((r) => r.status === 'wishlisted').length, 4);
  const set = { id: 'synthetic', name: 'Synthetic projection set' };
  const [snorlaxCard, trainerCard, energyCard] = inventoryProjectionCatalog.map((e) => ({
    ...e.card,
    language: 'en' as const,
    inferredFinish: 'normal' as const,
    set,
  }));
  assert.equal(
    getSetCompletion(
      { sets: [set], selectedSet: set, slots: [], cards: [snorlaxCard, trainerCard, energyCard] },
      all.rows,
    ).owned,
    3,
  );
  assert.deepEqual(getSetCardState(trainerCard, all.rows), { owned: true, wanted: true });
  assert.deepEqual(getSetCardState(energyCard, all.rows), { owned: true, wanted: false });

  const alpha = nativeSpeciesCollection({ ...binding, collectionId: snapshot.collections[0].id })!;
  assert.equal(alpha.rows.filter((r) => r.status !== 'wishlisted').length, 1);
  assert.deepEqual(alpha.bySpecies.get(143)?.wanted_cards, []);
  const trades = nativeSpeciesCollection({ ...binding, collectionId: snapshot.collections[1].id })!;
  assert.equal(trades.bySpecies.get(143)?.status, 'collected');
  assert.deepEqual(trades.bySpecies.get(143)?.wanted_cards, [snorlaxWant]);
  assert.equal(trades.bySpecies.has(25), false);
  assert.equal(nativeSpeciesCollection({ ...binding, collectionId: 'missing' }), null);
});

test('species view: an explicit want alone marks the species wanted, not owned', async () => {
  const { binding, snapshot } = await nativeConsumerFixture();
  snapshot.items = snapshot.items.filter(
    (i) => i.identity.kind === 'card' && i.identity.cardId !== 'synthetic-snorlax',
  );
  snapshot.placements = [];
  snapshot.binders.forEach((b) =>
    b.slots.forEach((s) => {
      s.inventoryItemId = null;
      s.status = null;
    }),
  );
  snapshot.binders[0].slots[2].wantedCards = [
    {
      card_id: 'synthetic-snorlax',
      card_name: 'Synthetic Snorlax',
      card_language: 'en',
      card_finish: 'normal',
      added_at: '2026-11-09T00:00:00Z',
    },
  ];
  binding.read = {
    ...binding.read,
    evidence: { kind: 'complete', snapshot: await completeInventoryBrowseFixture(snapshot) },
  };
  const model = nativeSpeciesCollection(binding)!;
  assert.equal(model.bySpecies.get(143)?.status, 'wishlisted');
  assert.equal(model.bySpecies.get(143)?.card_id, undefined);
  assert.equal(model.bySpecies.get(143)?.wanted_cards.length, 1);
});
