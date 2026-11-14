import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { facetOptions, filterCatalogueCards, foldText, type CatalogueCard } from '@/lib/catalogue-cards';

// Synthetic cards for the filter logic; not real catalogue data.
const card = (id: string, extra: Partial<CatalogueCard>): CatalogueCard => ({
  id,
  name: id,
  number: '1/100',
  setName: 'Test Set',
  setSlug: 'test-set',
  ...extra,
});
const cards = [
  card('a', { name: 'Pikachu', number: '12/100', rarity: 'Common', illustrator: 'Atsuko Nishida', series: 'New' }),
  card('b', { name: 'Flabébé', number: '161/131', rarity: 'Rare', illustrator: 'Saya Tsuruta', series: 'New' }),
  card('c', { name: 'Charizard ex', number: '199/165', rarity: 'Rare', series: 'Old', setName: 'Older Set' }),
];
const ids = (list: CatalogueCard[]) => list.map((c) => c.id);

describe('foldText', () => {
  test('drops accents and punctuation', () => assert.equal(foldText('Flabébé 161/131'), 'flabebe 161 131'));
});

describe('filterCatalogueCards', () => {
  test('no filter keeps the page order', () => assert.deepEqual(ids(filterCatalogueCards(cards, {})), ['a', 'b', 'c']));
  test('matches names without accents', () =>
    assert.deepEqual(ids(filterCatalogueCards(cards, { text: 'flabebe' })), ['b']));
  test('matches a number with or without its set total', () => {
    assert.deepEqual(ids(filterCatalogueCards(cards, { text: '161' })), ['b']);
    assert.deepEqual(ids(filterCatalogueCards(cards, { text: '161/131' })), ['b']);
  });
  test('matches word starts only, every word', () => {
    assert.deepEqual(ids(filterCatalogueCards(cards, { text: 'izard' })), []);
    assert.deepEqual(ids(filterCatalogueCards(cards, { text: 'char ex' })), ['c']);
  });
  test('matches the illustrator', () => assert.deepEqual(ids(filterCatalogueCards(cards, { text: 'nishida' })), ['a']));
  test('combines facets', () => {
    assert.deepEqual(ids(filterCatalogueCards(cards, { facets: { rarity: 'Rare' } })), ['b', 'c']);
    assert.deepEqual(ids(filterCatalogueCards(cards, { facets: { rarity: 'Rare', series: 'Old' } })), ['c']);
    assert.deepEqual(ids(filterCatalogueCards(cards, { facets: { rarity: '' } })), ['a', 'b', 'c']);
  });
  test('sorts', () => {
    assert.deepEqual(ids(filterCatalogueCards(cards, { sort: 'reverse' })), ['c', 'b', 'a']);
    assert.deepEqual(ids(filterCatalogueCards(cards, { sort: 'name' })), ['c', 'b', 'a']);
  });
});

describe('facetOptions', () => {
  test('counts values, alphabetical for rarity', () =>
    assert.deepEqual(facetOptions(cards, 'rarity'), [
      { value: 'Common', count: 1 },
      { value: 'Rare', count: 2 },
    ]));
  test('keeps card order for sets and skips missing values', () => {
    assert.deepEqual(facetOptions(cards, 'setName'), [
      { value: 'Test Set', count: 2 },
      { value: 'Older Set', count: 1 },
    ]);
    assert.equal(facetOptions(cards, 'illustrator').length, 2);
  });
});
