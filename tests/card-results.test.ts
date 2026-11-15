import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { cardResultFilterOptions, cardResultPriceLabels, filterCardResults } from '../lib/card-results';
import type { CardPriceSnapshot } from '../lib/card-pricing';

// Synthetic cards and prices, not catalogue data.
const cards = [
  { id: 'a', set: { id: 's2', name: 'Beta' }, rarity: 'Rare', illustrator: 'Artist B', dexIds: [4] },
  { id: 'b', set: { id: 's1', name: 'Alpha' }, rarity: 'Common', illustrator: 'Artist A', dexIds: [4, 5] },
  { id: 'c', set: { id: 's1', name: 'Alpha' }, dexIds: [] },
];

describe('card results', () => {
  test('offers the sets, rarities and artists the cards have', () => {
    assert.deepEqual(cardResultFilterOptions(cards), {
      sets: [
        { id: 's1', name: 'Alpha' },
        { id: 's2', name: 'Beta' },
      ],
      rarities: ['Rare', 'Common'],
      illustrators: ['Artist A', 'Artist B'],
    });
  });

  test('filters by set, rarity, artist and Pokémon together', () => {
    const ids = (filters: Parameters<typeof filterCardResults>[1]) =>
      filterCardResults(cards, filters).map((c) => c.id);
    assert.deepEqual(ids({}), ['a', 'b', 'c']);
    assert.deepEqual(ids({ set: 's1' }), ['b', 'c']);
    assert.deepEqual(ids({ pokemon: 5 }), ['b']);
    assert.deepEqual(ids({ pokemon: 4, illustrator: 'Artist B' }), ['a']);
    assert.deepEqual(ids({ rarity: 'Rare', set: 's1' }), []);
  });

  test('price lines leave unknowns empty and show one amount for a flat range', () => {
    const format = (amount: number | null | undefined) => (typeof amount === 'number' ? `£${amount}` : null);
    assert.deepEqual(cardResultPriceLabels(undefined, format), {
      good: null,
      market: null,
      range: null,
      confidence: null,
    });
    const price = {
      goodGbpAmount: 1,
      gbpAmount: 2,
      lowGbpAmount: 3,
      highGbpAmount: 3,
      confidence: 'high',
    } as CardPriceSnapshot;
    assert.deepEqual(cardResultPriceLabels(price, format), {
      good: '£1',
      market: '£2',
      range: '£3',
      confidence: 'High',
    });
  });
});
