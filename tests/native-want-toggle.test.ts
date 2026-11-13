import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nativeWantPocket, planNativeAddWant, planNativeRemoveWant } from '@/lib/collection/native-card-consumers';
import { projectSlotIntent } from '@/lib/collection/slot-optimistic';
import { normalizeInventorySnapshot, type InventorySnapshot } from '@/lib/domain/inventory';
import type { SlotTarget } from '@/lib/domain/binder-slots';
import type { SearchCardResult } from '@/lib/pokemon-card-browse';

// Synthetic snapshot: one binder with a Meowth pocket, a Persian pocket holding a copy, and a free pocket.
const OWNER = '00000000-0000-4000-8000-0000000000a1';
const BINDER = '00000000-0000-4000-8000-0000000000b1';
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
        identity: { kind: 'card', cardId: 'sv03.5-053', language: 'en', finish: 'normal' },
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
  operationId: '00000000-0000-4000-8000-000000000901',
  batchId: null,
  clientOccurredAt: null,
};
// Synthetic printing: Persian, Shrouded Fable 078.
const persian: SearchCardResult = {
  id: 'sv06.5-078',
  localId: '078',
  name: 'Persian',
  language: 'en',
  set: { id: 'sv06.5', name: 'Shrouded Fable', officialCardCount: 64 },
  rarity: 'Illustration rare',
  dexIds: [53],
};
const AT = '2026-11-13T22:00:00.000Z';

test("a want goes on the Pokémon's pocket, even one already holding a copy (an upgrade want)", () => {
  const data = snapshot();
  assert.equal(nativeWantPocket(data, BINDER, persian)?.id, 'slot-2');
  const draft = planNativeAddWant(data, BINDER, persian, 'illustration_rare', context, AT)!;
  const after = projectSlotIntent(data, draft.intent, () => undefined);
  const slot = after.binders[0].slots.find((s) => s.id === 'slot-2')!;
  assert.equal(slot.inventoryItemId, 'held', 'the copy stays');
  assert.deepEqual(
    slot.wantedCards.map((w) => [w.card_id, w.card_language, w.card_finish, w.added_at]),
    [['sv06.5-078', 'en', 'illustration_rare', AT]],
  );
});

test('a pocket reserved for the exact printing wins over the species pocket', () => {
  const data = snapshot();
  data.binders[0].slots[2].target = { kind: 'card', cardId: 'sv06.5-078', language: 'en' };
  assert.equal(nativeWantPocket(data, BINDER, persian)?.id, 'slot-3');
});

test('no pocket for the card, or no open binder, plans nothing', () => {
  const data = snapshot();
  const mew = { ...persian, id: 'sv03.5-151', name: 'Mew', dexIds: [151] };
  assert.equal(planNativeAddWant(data, BINDER, mew, 'holo', context, AT), null);
  assert.equal(planNativeAddWant(data, undefined, persian, 'holo', context, AT), null);
  assert.equal(planNativeAddWant(data, BINDER, { ...persian, language: undefined }, 'holo', context, AT), null);
});

test('removing takes out exactly that want, and refuses when the pocket changed meanwhile', () => {
  const data = snapshot();
  const added = projectSlotIntent(
    data,
    planNativeAddWant(data, BINDER, persian, 'illustration_rare', context, AT)!.intent,
    () => undefined,
  );
  const want = added.binders[0].slots[1].wantedCards[0];
  const { wanted_by: _w, card_image: _i, ...expectedPublic } = want;
  const destination = { collectionId: BINDER, slotId: 'slot-2', wantedIndex: 0, expectedPublic };
  const removed = projectSlotIntent(added, planNativeRemoveWant(added, destination, context).intent, () => undefined);
  assert.deepEqual(removed.binders[0].slots[1].wantedCards, []);
  assert.throws(() =>
    planNativeRemoveWant(
      added,
      { ...destination, expectedPublic: { ...expectedPublic, card_finish: 'holo' } },
      context,
    ),
  );
});
