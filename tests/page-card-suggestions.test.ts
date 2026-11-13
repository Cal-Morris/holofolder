import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { InventorySnapshot } from '@/lib/domain/inventory';
import { pageSuggestionSeeds, rankPageSuggestions, type SuggestionTraits } from '@/lib/page-card-suggestions';

// Synthetic fixtures: ids and traits are made up, not real catalog data.
const card = (id: string, traits: Partial<SuggestionTraits> = {}): SuggestionTraits => ({
  id,
  setId: 'set-x',
  types: [],
  dexIds: [],
  ...traits,
});

describe('rankPageSuggestions', () => {
  test('ranks shared Pokémon over illustrator over type and set, and leaves out the page cards', () => {
    const seeds = [card('a', { dexIds: [25], illustrator: 'Artist A', types: ['Lightning'], setId: 's1' })];
    const ranked = rankPageSuggestions(
      seeds,
      [],
      [
        card('set-only', { setId: 's1' }),
        card('illustrator', { illustrator: 'Artist A' }),
        card('pokemon', { dexIds: [25] }),
        card('unrelated'),
        card('a', { dexIds: [25] }),
      ],
    );
    assert.deepEqual(
      ranked.map((c) => c.id),
      ['pokemon', 'illustrator', 'set-only'],
    );
  });

  test('a theme shared by several page cards beats a single strong match', () => {
    const seeds = ['a', 'b', 'c'].map((id) => card(id, { illustrator: 'Artist A' }));
    const ranked = rankPageSuggestions(
      seeds,
      [6],
      [card('one-pokemon', { dexIds: [6] }), card('same-artist', { illustrator: 'Artist A' })],
    );
    assert.deepEqual(
      ranked.map((c) => c.id),
      ['same-artist', 'one-pokemon'],
    );
  });
});

describe('pageSuggestionSeeds', () => {
  const snapshot = {
    items: [
      { id: 'i1', identity: { kind: 'card', cardId: 'owned-1' } },
      { id: 'i2', identity: { kind: 'pokemon', pokemonId: 4 } },
    ],
    binders: [
      {
        collectionId: 'b1',
        slots: [
          { id: 's0', inventoryItemId: 'i1', target: null },
          { id: 's1', inventoryItemId: null, target: { kind: 'card', cardId: 'reserved-1' } },
          { id: 's2', inventoryItemId: 'i2', target: null },
          { id: 's3', inventoryItemId: null, target: null },
          { id: 's4', inventoryItemId: null, target: { kind: 'card', cardId: 'next-page' } },
        ],
      },
    ],
  } as unknown as InventorySnapshot;

  test('reads the tapped pocket’s page and excludes every card in the binder', () => {
    assert.deepEqual(pageSuggestionSeeds(snapshot, 'b1', 's3', 4), {
      cardIds: ['owned-1', 'reserved-1'],
      pokemonIds: [4],
      binderCardIds: ['owned-1', 'reserved-1', 'next-page'],
    });
  });

  test('an empty page has nothing to suggest from', () => {
    assert.equal(pageSuggestionSeeds(snapshot, 'b1', 's3', 1), null);
    assert.equal(pageSuggestionSeeds(snapshot, 'b1', 'missing', 4), null);
  });
});
