import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeCollectionItem,
  normalizeCollectionItems,
  normalizeWantedCards,
  numberArraysEqual,
} from '../lib/collection/normalize';

test('normalizeWantedCards drops invalid entries and de-duplicates by id, language and finish', () => {
  const cards = normalizeWantedCards([
    null,
    { card_id: 'sv1-1' },
    { card_id: 'sv1-1', card_name: 'A', card_language: 'EN', card_finish: 'holo', added_at: 't1' },
    { card_id: 'sv1-1', card_name: 'A again', card_language: 'en', card_finish: 'holo', added_at: 't2' },
    { card_id: 'sv1-1', card_name: 'A ja', card_language: 'ja', card_finish: 'holo', added_at: 't3' },
    { card_id: 'sv1-2', card_name: 'B', set_total: Number.NaN, added_at: 't4' },
  ]);

  assert.deepEqual(
    cards.map((card) => [card.card_id, card.card_language, card.card_finish]),
    [
      ['sv1-1', 'en', 'holo'],
      ['sv1-1', 'ja', 'holo'],
      ['sv1-2', 'en', 'normal'],
    ],
  );
  assert.equal(cards[0].card_name, 'A');
  assert.equal(cards[2].set_total, undefined);
  assert.deepEqual(normalizeWantedCards('nope'), []);
});

test('normalizeCollectionItem fills defaults for missing fields', () => {
  const item = normalizeCollectionItem({ pokemon_id: 4 });
  assert.equal(item.pokemon_id, 4);
  assert.equal(item.pokemon_name, 'Unknown Pokemon');
  assert.equal(item.status, 'collected');
  assert.equal(item.card_language, 'en');
  assert.equal(item.card_finish, 'normal');
  assert.deepEqual(item.wanted_cards, []);
  assert.equal(typeof item.id, 'string');
  assert.ok(!Number.isNaN(Date.parse(item.collected_at)));
});

test('wishlisted rows move a legacy single card into wanted_cards and clear the owned card', () => {
  const item = normalizeCollectionItem({
    id: 'row',
    pokemon_id: 25,
    pokemon_name: 'Pikachu',
    status: 'wishlisted',
    card_id: 'base-58',
    card_name: 'Pikachu',
    card_set: 'Base',
    card_language: 'fr',
    collected_at: '2026-01-01T00:00:00.000Z',
    wanted_cards: [],
  });

  assert.equal(item.card_id, undefined);
  assert.equal(item.card_name, undefined);
  assert.deepEqual(item.wanted_cards, [
    {
      card_id: 'base-58',
      card_name: 'Pikachu',
      card_image: undefined,
      card_set: 'Base',
      card_language: 'fr',
      card_finish: 'normal',
      added_at: '2026-01-01T00:00:00.000Z',
    },
  ]);
});

test('normalizeCollectionItems tolerates null and non-arrays', () => {
  assert.deepEqual(normalizeCollectionItems(null), []);
  assert.deepEqual(normalizeCollectionItems(undefined), []);
  assert.equal(normalizeCollectionItems([{ pokemon_id: 1 }, { pokemon_id: 2 }]).length, 2);
});

test('numberArraysEqual compares order and length', () => {
  assert.equal(numberArraysEqual([1, 2], [1, 2]), true);
  assert.equal(numberArraysEqual([1, 2], [2, 1]), false);
  assert.equal(numberArraysEqual([1], [1, 2]), false);
  assert.equal(numberArraysEqual([], []), true);
});
