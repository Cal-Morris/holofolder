import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findWantedPocket, planBought, planBoughtUndo } from '@/lib/collection/show-bought';
import { projectSlotIntent } from '@/lib/collection/slot-optimistic';
import { normalizeInventorySnapshot, type InventorySnapshot } from '@/lib/domain/inventory';
import type { WantedCard } from '@/lib/domain/cards';

// Synthetic snapshot: one 2×2 binder. Pocket 1 holds a copy, pocket 2 wants a holo Charizard (and a Mew), pocket 3
// wants a reverse holo Charizard, pocket 4 is empty.
const OWNER = '00000000-0000-4000-8000-0000000000a1';
const BINDER = '00000000-0000-4000-8000-0000000000b1';
const want = (card_id: string, card_finish: WantedCard['card_finish']): WantedCard => ({
  card_id,
  card_name: card_id,
  card_language: 'en',
  card_finish,
  added_at: '2026-11-01T00:00:00.000Z',
});
function snapshot(): InventorySnapshot {
  const slot = (n: number, inventoryItemId: string | null, wantedCards: WantedCard[]) => ({
    id: `slot-${n}`,
    ownerUserId: OWNER,
    collectionId: BINDER,
    target: null,
    inventoryItemId,
    wantedCards,
    status: inventoryItemId ? ('collected' as const) : null,
    version: 3,
    presetOrigin: null,
  });
  // Normalized, as every read the app plans on is.
  return normalizeInventorySnapshot({
    ownerUserId: OWNER,
    inventoryRevision: 7,
    items: [
      {
        id: 'held',
        ownerUserId: OWNER,
        identity: { kind: 'card', cardId: 'sv03.5-006', language: 'en', finish: 'holo' },
        grading: null,
        acquiredAt: null,
        version: 1,
      },
    ],
    placements: [{ inventoryItemId: 'held', collectionId: BINDER, slotId: 'slot-1', version: 1 }],
    collections: [
      { id: BINDER, ownerUserId: OWNER, name: 'My binder', kind: 'binder', defaultPresentation: 'binder', version: 2 },
    ],
    binders: [
      {
        ownerUserId: OWNER,
        collectionId: BINDER,
        layoutRevision: 1,
        presetManifest: null,
        slots: [
          // A copy already sits here, and its pocket still lists a want for the same printing: never chosen.
          slot(1, 'held', [want('sv03.5-006', 'holo')]),
          slot(2, null, [want('sv03.5-151', 'holo'), want('sv03.5-006', 'holo')]),
          slot(3, null, [want('sv03.5-006', 'reverse_holo')]),
          slot(4, null, []),
        ],
      },
    ],
  })!;
}
const layouts = [{ collectionId: BINDER, layoutRevision: 1, rows: 1, cols: 2 }];
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const operations = new Map<string, string>();
const context = (name: string) => ({
  source: 'app' as const,
  clientId: null,
  operationId: operations.get(name) ?? (operations.set(name, uuid(900 + operations.size)), operations.get(name)!),
  batchId: null,
  clientOccurredAt: null,
});
const ids = () => {
  let n = 0;
  return () => uuid(++n);
};
const NEW_1 = uuid(1);
const charizard = { cardId: 'sv03.5-006', language: 'en' as const, finish: 'holo' as const };
// The card's catalogue evidence, as the deal check hands it to the queue (synthetic).
const resolve = (id: string) => ({ kind: 'card' as const, id, pokemonIds: [6], language: 'en' as const });

test('the wanted pocket is the empty one wanting that exact printing; an occupied pocket is never picked', () => {
  const data = snapshot();
  assert.deepEqual(findWantedPocket(data, charizard), { collectionId: BINDER, slotIndex: 1, wantedIndex: 1 });
  assert.deepEqual(findWantedPocket(data, { ...charizard, finish: 'reverse_holo' })?.slotIndex, 2);
  assert.equal(findWantedPocket(data, { ...charizard, finish: 'normal' }), null);
  assert.equal(findWantedPocket(data, { ...charizard, language: 'ja' }), null);
  assert.equal(findWantedPocket(data, charizard, new Set(['slot-2'])), null);
});

test('Bought places the copy in the wanted pocket and fills that want, with a page and pocket label', () => {
  const data = snapshot();
  const { intent, placements } = planBought({
    snapshot: data,
    layouts,
    cards: [charizard],
    context: context('bought'),
    newId: ids(),
  });
  assert.deepEqual(placements, [
    {
      kind: 'placed',
      itemId: NEW_1,
      collectionId: BINDER,
      slotId: 'slot-2',
      wantedBefore: data.binders[0].slots[1].wantedCards,
      label: 'Page 1 · Pocket 2',
    },
  ]);
  const after = projectSlotIntent(data, intent, resolve);
  const pocket = after.binders[0].slots[1];
  assert.equal(pocket.inventoryItemId, NEW_1);
  assert.deepEqual(
    pocket.wantedCards.map((w) => w.card_id),
    ['sv03.5-151'],
  );
  assert.deepEqual(after.items.find((i) => i.id === NEW_1)?.identity, { kind: 'card', ...charizard });
});

test('with no empty wanted pocket the copy is added unassigned, keeping only what is known', () => {
  const data = snapshot();
  const { intent, placements } = planBought({
    snapshot: data,
    layouts,
    cards: [{ cardId: 'sv03.5-007' }],
    context: context('bought'),
    newId: ids(),
  });
  assert.deepEqual(placements, [{ kind: 'unassigned', itemId: NEW_1, label: 'your inventory' }]);
  const after = projectSlotIntent(data, intent, resolve);
  assert.deepEqual(after.items.find((i) => i.id === NEW_1)?.identity, { kind: 'card', cardId: 'sv03.5-007' });
  assert.equal(
    after.placements.some((p) => p.inventoryItemId === NEW_1),
    false,
  );
  assert.deepEqual(after.binders, data.binders);
});

test('a bundle is one edit: two of the same printing fill one wanted pocket, the second goes unassigned', () => {
  const data = snapshot();
  const { intent, placements } = planBought({
    snapshot: data,
    layouts,
    cards: [charizard, charizard, { ...charizard, finish: 'reverse_holo' }],
    context: context('bundle'),
    newId: ids(),
  });
  assert.equal(intent.request.commands.length, 3);
  assert.deepEqual(
    placements.map((p) => [p.kind, p.label]),
    [
      ['placed', 'Page 1 · Pocket 2'],
      ['unassigned', 'your inventory'],
      ['placed', 'Page 2 · Pocket 1'],
    ],
  );
  const after = projectSlotIntent(data, intent, resolve);
  assert.equal(after.items.length, 4);
});

test('Undo removes the new copies and puts the filled want back, leaving no orphan copy', () => {
  const data = snapshot();
  const bought = planBought({
    snapshot: data,
    layouts,
    cards: [charizard, { cardId: 'sv03.5-007' }],
    context: context('bought'),
    newId: ids(),
  });
  let after = projectSlotIntent(data, bought.intent, resolve);
  let n = 0;
  const undo = planBoughtUndo({
    snapshot: after,
    placements: bought.placements,
    context: context('undo'),
    restoreContext: () => context(`restore-${++n}`),
  });
  assert.deepEqual(
    undo.map((i) => i.kind),
    ['inventory', 'slots'],
  );
  for (const intent of undo) after = projectSlotIntent(after, intent, resolve);
  assert.deepEqual(
    after.items.map((i) => i.id),
    ['held'],
  );
  assert.deepEqual(after.binders[0].slots[1].wantedCards, data.binders[0].slots[1].wantedCards);
  assert.equal(after.binders[0].slots[1].inventoryItemId, null);
});

test('Undo leaves a copy alone once it has moved, and a pocket filled again keeps what it has', () => {
  const data = snapshot();
  const bought = planBought({ snapshot: data, layouts, cards: [charizard], context: context('b'), newId: ids() });
  const after = projectSlotIntent(data, bought.intent, resolve);
  // Someone moved the new copy to pocket 4 before tapping Undo.
  const moved: InventorySnapshot = structuredClone(after);
  moved.placements = moved.placements.map((p) => (p.inventoryItemId === NEW_1 ? { ...p, slotId: 'slot-4' } : p));
  Object.assign(moved.binders[0].slots[1], { inventoryItemId: null, status: null });
  Object.assign(moved.binders[0].slots[3], { inventoryItemId: NEW_1, status: 'collected' });
  assert.deepEqual(
    planBoughtUndo({
      snapshot: moved,
      placements: bought.placements,
      context: context('u'),
      restoreContext: () => context('r'),
    }),
    [],
  );
});
