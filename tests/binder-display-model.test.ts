import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  adaptLegacyDisplaySlots,
  buildSlotDisplay,
  displaySlotImageUrl,
  displaySlotPreview,
  paginateDisplaySlots,
  resolveDisplaySelection,
  speciesPocket,
} from '@/lib/binder-display-model';
import { syntheticSlotDisplaySnapshot } from '@/tests/fixtures/slot-display';

describe('stable binder display', () => {
  test('references two actual Snorlax copies and never treats target art as ownership', () => {
    const { binder, inventory, catalog } = syntheticSlotDisplaySnapshot();
    const slots = buildSlotDisplay(binder, inventory, (id) => catalog[id]);
    assert.equal(slots[0].item, inventory.items[0]);
    assert.equal(slots[1].item, inventory.items[1]);
    assert.notEqual(slots[0].id, slots[1].id);
    assert.equal(resolveDisplaySelection(slots, slots[1].id)?.card?.name, 'Snorlax B');
    assert.equal(slots[4].item, null);
    assert.equal(slots[4].target?.kind, 'pokemon');
    assert.equal(slots[5].target?.kind, 'card');
    assert.equal(slots[6].target, null);
    assert.equal(slots[2].pokemon, null);
    assert.equal(slots[3].pokemon, null);
    assert.equal(slots[1].item?.grading?.grade, '9');
    // Separately serialized but equivalent snapshots need not share property insertion order.
    const { slots: entries, ...rest } = binder;
    const equivalent = { slots: entries, ...rest };
    assert.deepEqual(
      buildSlotDisplay(equivalent, inventory, (id) => catalog[id]).map((s) => s.id),
      slots.map((s) => s.id),
    );
  });
  test('a Pokémon result opens its needed pocket first, then its first pocket, and nothing it has no pocket for', () => {
    const { binder, inventory } = syntheticSlotDisplaySnapshot();
    // Synthetic catalog evidence: only the trainer-less cards name a species.
    const cardSpecies = (id: string) =>
      ({ 'synthetic-snorlax-a': [143], 'synthetic-snorlax-b': [143], 'synthetic-energy': [25] })[id];
    assert.deepEqual(speciesPocket({ binder, inventory }, 143, cardSpecies), {
      slotId: 'slot-e',
      index: 4,
      item: null,
      want: null,
    });
    const filled = { ...binder, slots: binder.slots.filter((slot) => slot.id !== 'slot-e') };
    assert.equal(speciesPocket({ binder: filled, inventory }, 143, cardSpecies)?.slotId, 'slot-a');
    // A card pocket with no species target is still found through its card.
    assert.equal(speciesPocket({ binder, inventory }, 25, cardSpecies)?.slotId, 'slot-d');
    assert.equal(speciesPocket({ binder, inventory }, 6, cardSpecies), null);
    assert.equal(speciesPocket({ binder, inventory }, 143, () => undefined)?.slotId, 'slot-e');
  });
  test('card detail retains human catalog metadata alongside the exact copy reference', () => {
    const { binder, inventory } = syntheticSlotDisplaySnapshot();
    const card = {
      name: 'Synthetic Snorlax',
      image: 'https://assets.tcgdex.net/en/synthetic/1/high.webp',
      localId: '1',
      set: { name: 'Synthetic set' },
    };
    const slot = buildSlotDisplay(binder, inventory, () => card)[0];
    assert.equal(slot.card, card);
    assert.equal(slot.card?.set?.name, 'Synthetic set');
    assert.equal(slot.card?.localId, '1');
    assert.equal(slot.item?.id, 'item-a');
    assert.equal(slot.id, 'slot-a');
  });
  test('all 1–8 dimensions preserve order, stored blanks and stable identity', () => {
    const { binder, inventory, catalog } = syntheticSlotDisplaySnapshot();
    const slots = buildSlotDisplay(binder, inventory, (id) => catalog[id]);
    for (let rows = 1; rows <= 8; rows++)
      for (let cols = 1; cols <= 8; cols++) {
        const pages = paginateDisplaySlots(slots, rows, cols);
        assert.equal(pages.length, Math.ceil(slots.length / (rows * cols)));
        assert.deepEqual(
          pages
            .flat()
            .filter(Boolean)
            .map((s) => s!.id),
          slots.map((s) => s.id),
        );
        assert.ok(pages.every((p) => p.length === rows * cols));
        assert.equal(
          resolveDisplaySelection(
            pages.flat().filter((s) => s !== null),
            slots[1].id,
          )?.item?.id,
          'item-b',
        );
      }
    assert.equal(paginateDisplaySlots([], 8, 8).length, 0);
    assert.throws(() => paginateDisplaySlots(slots, 0, 9));
  });
  test('filter masking retains saved positions and does not mutate snapshot or grading', () => {
    const { binder, inventory, catalog } = syntheticSlotDisplaySnapshot();
    const before = JSON.stringify(inventory);
    const slots = buildSlotDisplay(binder, inventory, (id) => catalog[id]);
    const page = paginateDisplaySlots(slots, 2, 4, (slot) => slot.id === 'slot-b')[0];
    assert.equal(page[0], null);
    assert.equal(page[1]?.id, 'slot-b');
    assert.equal(page[7], null);
    assert.equal(JSON.stringify(inventory), before);
    assert.equal(resolveDisplaySelection(slots, 'missing'), null);
  });
  test('rejects incomplete, foreign or divergent snapshots', () => {
    const { binder, inventory } = syntheticSlotDisplaySnapshot();
    assert.throws(() => buildSlotDisplay(binder, { ...inventory, items: [] }, () => undefined));
    assert.throws(() => buildSlotDisplay({ ...binder, ownerUserId: 'other' }, inventory, () => undefined));
    assert.throws(() => buildSlotDisplay({ ...binder, slots: [] }, inventory, () => undefined));
  });
  test('legacy adapter retains species, collection references and deterministic scoped keys', () => {
    const pokemon = [{ id: 143, name: 'snorlax' }];
    const a = adaptLegacyDisplaySlots('legacy-a', pokemon, () => undefined);
    assert.equal(a[0].pokemon, pokemon[0]);
    assert.equal(a[0].legacyPokemonId, 143);
    assert.equal(a[0].id, adaptLegacyDisplaySlots('legacy-a', pokemon, () => undefined)[0].id);
    assert.notEqual(a[0].id, adaptLegacyDisplaySlots('legacy-b', pokemon, () => undefined)[0].id);
  });
});

import { studioCardTextureKey } from '@/lib/binder-design';
test('3D texture identity separates placeholders and actual copies of the same image', () => {
  const owned = {
    id: 'slot-a',
    name: 'Snorlax, Owned',
    image: '/app/api/card-image-proxy?url=synthetic',
    presentation: 'owned' as const,
  };
  const target = { ...owned, presentation: 'target' as const };
  assert.notEqual(studioCardTextureKey(owned), studioCardTextureKey(target));
  assert.notEqual(studioCardTextureKey(owned), studioCardTextureKey({ ...owned, id: 'slot-b' }));
  assert.equal(studioCardTextureKey({ id: 'legacy', name: 'Legacy', image: 'legacy-image' }), 'legacy-image');
});

test('rearranging whole source slots preserves independent detail and item metadata', () => {
  const { binder, inventory, catalog } = syntheticSlotDisplaySnapshot();
  const original = buildSlotDisplay(binder, inventory, (id) => catalog[id]);
  const moved = { ...binder, slots: [...binder.slots].reverse(), layoutRevision: 2 };
  const reordered = buildSlotDisplay(moved, { ...inventory, binders: [moved] }, (id) => catalog[id]);
  assert.deepEqual(
    reordered.map((s) => s.id),
    [...original].reverse().map((s) => s.id),
  );
  assert.equal(resolveDisplaySelection(reordered, 'slot-b')?.item, original[1].item);
  assert.equal(resolveDisplaySelection(reordered, 'slot-b')?.item?.grading, inventory.items[1].grading);
  assert.equal(resolveDisplaySelection(reordered, 'slot-b')?.target, binder.slots[1].target);
  assert.equal(resolveDisplaySelection(reordered, 'slot-b')?.wantedCards, binder.slots[1].wantedCards);
});

test('native cover counts saved occupied targets and spacers independently', async () => {
  const { nativeBinderCoverStats } = await import('@/lib/binder-display-model');
  const { binder } = syntheticSlotDisplaySnapshot();
  assert.deepEqual(nativeBinderCoverStats(binder), { collected: 4, total: 6, percentage: 67, needed: 2 });
  assert.deepEqual(nativeBinderCoverStats({ ...binder, slots: [] }), {
    collected: 0,
    total: 0,
    percentage: 0,
    needed: 0,
  });
});

test('native National Dex cover reports 653 of 1025 from saved placements', async () => {
  const { nativeBinderCoverStats } = await import('@/lib/binder-display-model');
  const { binder } = syntheticSlotDisplaySnapshot();
  binder.slots = Array.from({ length: 1025 }, (_, i) => ({
    ...binder.slots[0],
    id: `synthetic-${i}`,
    inventoryItemId: i < 653 ? `synthetic-copy-${i}` : null,
    status: i < 653 ? 'collected' : null,
  }));
  assert.deepEqual(nativeBinderCoverStats(binder), {
    collected: 653,
    total: 1025,
    percentage: 64,
    needed: 372,
  });
});

describe('native page-turn image urls', () => {
  // Synthetic slots; prefetch must request exactly what OrderedSlot's CardImage renders.
  const owned = {
    id: 'a',
    target: { kind: 'pokemon' as const, pokemonId: 6 },
    item: { id: 'copy' } as never,
    card: { name: 'Synthetic', image: 'https://assets.tcgdex.net/en/base/base1/4/high.webp' },
    pokemon: { id: 6, name: 'charizard' },
    wantedCards: [],
  };
  const want = {
    card_id: 'base1-2',
    card_name: 'Synthetic want',
    card_image: 'https://assets.tcgdex.net/en/base/base1/2/high.webp',
    added_at: '2026-11-10T00:00:00Z',
  };
  test('owned printing uses the public asset, not Pokémon artwork', () => {
    assert.equal(displaySlotImageUrl(owned), 'https://assets.holofolder.com/pokemon/tcg/cards/en/base1/4/high.webp');
  });
  test('wants keep their dimmed printing outside current, and current shows the owned card', () => {
    const wanted = { ...owned, wantedCards: [want] };
    assert.equal(
      displaySlotImageUrl(wanted, 'mixed'),
      'https://assets.holofolder.com/pokemon/tcg/cards/en/base1/2/high.webp',
    );
    assert.equal(
      displaySlotImageUrl(wanted, 'current'),
      'https://assets.holofolder.com/pokemon/tcg/cards/en/base1/4/high.webp',
    );
  });
  test('unfilled targets keep the artwork fallback, spacers request nothing', () => {
    const target = { ...owned, item: null, card: null };
    assert.equal(displaySlotImageUrl(target), displaySlotPreview(target).image);
    assert.match(displaySlotImageUrl(target)!, /official-artwork%2F6\.png&w=/);
    assert.equal(displaySlotImageUrl({ ...target, target: null, pokemon: null }), null);
  });
});
