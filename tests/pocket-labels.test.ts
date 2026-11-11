import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { describeIdentity, displaySlotName, formatGradeLabel, pocketPlace } from '@/lib/pocket-labels';
import { displaySlotLabel } from '@/lib/binder-display-model';
import { layoutFailureMessage } from '@/lib/slot-draft-failure';

// Synthetic cards and grades only.
describe('pocket labels', () => {
  test('species pockets read as formatted Pokémon names, including hyphenated and gendered ones', () => {
    for (const [slug, id, name] of [
      ['walking-wake', 1009, 'Walking Wake'],
      ['iron-leaves', 1010, 'Iron Leaves'],
      ['forretress', 205, 'Forretress'],
      ['nidoran-f', 29, 'Nidoran♀'],
      ['mr-mime', 122, 'Mr. Mime'],
    ] as const) {
      const slot = {
        card: null,
        pokemon: { id, name: slug },
        target: { kind: 'pokemon' as const, pokemonId: id },
        item: null,
      };
      assert.equal(displaySlotName(slot), name);
      assert.equal(displaySlotLabel(slot), `${name}, Unfilled target`);
    }
  });

  test('a recorded card name is kept exactly as printed', () => {
    assert.equal(
      displaySlotName({
        card: { name: "Team Rocket's Murkrow", set: { name: 'Destined Rivals' } },
        pokemon: { id: 198, name: 'murkrow' },
        target: null,
      }),
      "Team Rocket's Murkrow",
    );
  });

  test('an unresolved card never shows its ID as a name', () => {
    assert.equal(displaySlotName({ card: { name: 'mfb-2' }, pokemon: null, target: { kind: 'card' } }), 'Card');
    assert.equal(
      displaySlotName({ card: { name: 'sv10-140' }, pokemon: { id: 205, name: 'forretress' }, target: null }),
      'Forretress',
    );
    // A real name that happens to contain a hyphen keeps showing once the catalog supplies any printing detail.
    assert.equal(displaySlotName({ card: { name: 'Ho-Oh', localId: '7' }, pokemon: null, target: null }), 'Ho-Oh');
  });

  test('free pockets and unknown species have plain names', () => {
    assert.equal(displaySlotName({ card: null, pokemon: null, target: null }), 'Empty pocket');
    assert.equal(
      displaySlotName({ card: null, pokemon: null, target: { kind: 'pokemon', pokemonId: 99999 } }),
      'Pokémon #99999',
    );
  });

  test('grades name the provider and grade, never a certificate', () => {
    const base = {
      scale: '10',
      designation: null,
      subgrades: [],
      certificate: 'synthetic-cert-1',
      holder: null,
      label: { variant: null, assetIds: [] },
    };
    assert.equal(formatGradeLabel({ ...base, provider: { kind: 'known', id: 'psa' }, grade: '9' }), 'PSA 9');
    assert.equal(
      formatGradeLabel({ ...base, provider: { kind: 'known', id: 'beckett' }, grade: '9.5' }),
      'Beckett 9.5',
    );
    assert.equal(
      formatGradeLabel({ ...base, provider: { kind: 'custom', name: 'Local grader' }, grade: null }),
      'Local grader · Unknown grade',
    );
  });

  test('places are a page and a pocket on that page', () => {
    assert.equal(pocketPlace(0, 4, 4), 'Page 1 · Pocket 1');
    assert.equal(pocketPlace(203, 4, 4), 'Page 13 · Pocket 12');
    assert.equal(pocketPlace(9, 3, 3), 'Page 2 · Pocket 1');
  });

  test('copies and reserved printings are described by name and printing, not by ID', () => {
    const namer = (id: string) =>
      id === 'synthetic-1'
        ? {
            name: 'Synthetic Trainer',
            set: { name: 'Synthetic Set' },
            localId: '012',
            image: 'https://example.test/card.webp',
          }
        : undefined;
    assert.deepEqual(
      describeIdentity({ kind: 'card', cardId: 'synthetic-1', language: 'en', finish: 'reverse_holo' }, namer),
      {
        name: 'Synthetic Trainer',
        image: 'https://example.test/card.webp',
        detail: 'Synthetic Set · #012 · English · Reverse holo',
      },
    );
    const unknown = describeIdentity({ kind: 'card', cardId: 'synthetic-unknown' }, namer);
    assert.equal(unknown.name, 'Card');
    assert.ok(!unknown.detail.includes('synthetic-unknown'));
    assert.deepEqual(describeIdentity({ kind: 'pokemon', pokemonId: 143 }), { name: 'Snorlax', detail: 'Any card' });
  });

  test('layout failures explain the actual cause', () => {
    assert.match(layoutFailureMessage(new Error('layout-capacity')), /4,096-pocket limit/);
    assert.match(layoutFailureMessage(new Error('selected-anchor')), /isn't selected/);
    assert.match(layoutFailureMessage(new Error('selection-limit')), /256 pockets/);
    assert.match(layoutFailureMessage(new Error('layout-review-required')), /changed/);
  });
});
