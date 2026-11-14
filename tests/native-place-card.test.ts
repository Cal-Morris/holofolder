import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nativePlacePocket,
  nativeTargetPocket,
  planNativePlaceCard,
  planNativeSwapIntoPocket,
} from '@/lib/collection/native-card-consumers';
import { prepareInventoryAction } from '@/lib/inventory-actions';
import { pickerCandidate } from '@/lib/slot-picker';
import { projectSlotIntent } from '@/lib/collection/slot-optimistic';
import { normalizeInventorySnapshot, type InventorySnapshot } from '@/lib/domain/inventory';
import type { SlotTarget } from '@/lib/domain/binder-slots';
import type { SearchCardResult } from '@/lib/pokemon-card-browse';

// Synthetic snapshot: a Meowth pocket, a Persian pocket holding a raw copy, and a free pocket.
const OWNER = '00000000-0000-4000-8000-0000000000a1';
const BINDER = '00000000-0000-4000-8000-0000000000b1';
const NEW_ITEM = '00000000-0000-4000-8000-0000000000c1';
function snapshot(): InventorySnapshot {
  const slot = (n: number, target: SlotTarget | null, inventoryItemId: string | null) => ({
    id: `slot-${n}`,
    ownerUserId: OWNER,
    collectionId: BINDER,
    target,
    inventoryItemId,
    wantedCards: [],
    status: inventoryItemId ? ('collected' as const) : null,
    version: 3,
    presetOrigin: null,
  });
  return normalizeInventorySnapshot({
    ownerUserId: OWNER,
    inventoryRevision: 7,
    items: [
      {
        id: 'held',
        ownerUserId: OWNER,
        identity: { kind: 'card', cardId: 'sv06.5-049', language: 'en', finish: 'normal' },
        grading: null,
        acquiredAt: null,
        version: 1,
      },
    ],
    placements: [{ inventoryItemId: 'held', collectionId: BINDER, slotId: 'slot-2', version: 1 }],
    collections: [
      { id: BINDER, ownerUserId: OWNER, name: 'Dex', kind: 'binder', defaultPresentation: 'binder', version: 2 },
    ],
    binders: [
      {
        ownerUserId: OWNER,
        collectionId: BINDER,
        layoutRevision: 1,
        presetManifest: null,
        slots: [
          slot(1, { kind: 'pokemon', pokemonId: 52 }, null),
          slot(2, { kind: 'pokemon', pokemonId: 53 }, 'held'),
          slot(3, null, null),
        ],
      },
    ],
  })!;
}
const context = {
  source: 'app' as const,
  clientId: null,
  operationId: '00000000-0000-4000-8000-000000000902',
  batchId: null,
  clientOccurredAt: null,
};
// Synthetic printings: Persian, Shrouded Fable 078, and Meowth.
const persian: SearchCardResult = {
  id: 'sv06.5-078',
  localId: '078',
  name: 'Persian',
  language: 'en',
  set: { id: 'sv06.5', name: 'Shrouded Fable', officialCardCount: 64 },
  rarity: 'Illustration rare',
  dexIds: [53],
};
const meowth: SearchCardResult = { ...persian, id: 'sv06.5-052', localId: '052', name: 'Meowth', dexIds: [52] };
// The held copy's own printing, so the catalog can resolve it.
const held = { ...persian, id: 'sv06.5-049', localId: '049' };
const catalog = (id: string) => {
  const card = [persian, meowth, held].find((c) => c.id === id);
  return card ? pickerCandidate(card) : undefined;
};

const place = (data: InventorySnapshot, slotId: string, card: SearchCardResult) => {
  const plan = planNativePlaceCard(data, BINDER, slotId, card, 'holo', context, catalog, NEW_ITEM);
  return { plan, after: projectSlotIntent(data, plan.draft.intent, plan.resolver) };
};

test('the clear pocket is the only one for the card, never a guess between several', () => {
  const data = snapshot();
  assert.equal(nativePlacePocket(data, BINDER, persian)?.id, 'slot-2');
  data.binders[0].slots[2].target = { kind: 'pokemon', pokemonId: 53 };
  assert.equal(nativePlacePocket(data, BINDER, persian), null, 'two Persian pockets');
  data.binders[0].slots[0].target = { kind: 'card', cardId: 'sv06.5-078', language: 'en' };
  assert.equal(nativePlacePocket(data, BINDER, persian)?.id, 'slot-1', 'a pocket reserved for the printing wins');
  assert.equal(nativePlacePocket(data, undefined, persian), null);
});

test('adding to an empty pocket places a new copy', () => {
  const { after, plan } = place(snapshot(), 'slot-1', meowth);
  assert.equal(plan.swappedOut, null);
  assert.equal(after.binders[0].slots[0].inventoryItemId, NEW_ITEM);
  assert.equal(after.items.length, 2);
});

test('a swap keeps the old card in the collection by default', () => {
  const { after, plan } = place(snapshot(), 'slot-2', persian);
  assert.equal(plan.swappedOut, 'held');
  assert.equal(after.binders[0].slots[1].inventoryItemId, NEW_ITEM);
  assert.ok(
    after.items.some((i) => i.id === 'held'),
    'old card still owned',
  );
  assert.ok(!after.placements.some((p) => p.inventoryItemId === 'held'), 'old card unplaced');
});

test('without keeping, the swapped-out card is then removed as a plain owned-copy removal', () => {
  const { after } = place(snapshot(), 'slot-2', persian);
  const removal = prepareInventoryAction(after, { kind: 'removeOwned', itemId: 'held' }, context, catalog);
  const removed = projectSlotIntent(after, removal.intent, catalog);
  assert.equal(removed.binders[0].slots[1].inventoryItemId, NEW_ITEM);
  assert.ok(!removed.items.some((i) => i.id === 'held'));
});

const swap = (data: InventorySnapshot, slotId: string, card: SearchCardResult) => {
  let n = 0;
  const ctx = () => ({ ...context, operationId: `00000000-0000-4000-8000-00000000091${n++}` });
  return planNativeSwapIntoPocket(data, BINDER, slotId, card, 'holo', ctx, catalog, NEW_ITEM);
};

test('swapping into the pocket the details came from re-reserves it for the new printing', () => {
  const data = snapshot();
  // A themed pocket reserved for the held printing; the new card is a different printing with no Pokémon match.
  data.binders[0].slots[1].target = { kind: 'card', cardId: 'sv06.5-049', language: 'en' };
  const plan = swap(data, 'slot-2', meowth);
  assert.equal(plan.drafts.length, 3, 'clear reservation, place, reserve');
  assert.equal(plan.swappedOut, 'held');
  const pocket = plan.after.binders[0].slots[1];
  assert.equal(pocket.inventoryItemId, NEW_ITEM);
  assert.deepEqual(pocket.target, { kind: 'card', cardId: 'sv06.5-052', language: 'en' });
  assert.ok(
    plan.after.items.some((i) => i.id === 'held'),
    'old card still owned',
  );
  // Replaying the drafts in order lands on the same result.
  const replayed = plan.drafts.reduce((state, d) => projectSlotIntent(state, d.intent, plan.resolver), data);
  assert.deepEqual(replayed.binders[0].slots[1].target, pocket.target);
});

test('a pocket whose reservation already fits the card is a plain swap', () => {
  const plan = swap(snapshot(), 'slot-2', persian);
  assert.equal(plan.drafts.length, 1);
  assert.deepEqual(plan.after.binders[0].slots[1].target, { kind: 'pokemon', pokemonId: 53 });
});

test("the pocket a grid was opened from wins over the card's own pocket, even with no Pokémon match", () => {
  const data = snapshot();
  const trainer = { ...meowth, id: 'sv06.5-090', name: 'Synthetic Trainer', dexIds: [] };
  assert.equal(nativeTargetPocket(data, BINDER, trainer), null, 'no pocket of its own');
  assert.equal(nativeTargetPocket(data, BINDER, trainer, 'slot-2')?.id, 'slot-2');
  assert.equal(nativeTargetPocket(data, BINDER, persian, 'slot-3')?.id, 'slot-3');
  assert.equal(nativeTargetPocket(data, BINDER, persian, 'gone'), null);
});
