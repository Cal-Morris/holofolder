import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  catalogueCardFromSearch,
  facetOptions,
  filterCatalogueCards,
  foldText,
  knownRarity,
  matchesWords,
  paddedCardNumbers,
  parseCardNumberQuery,
  publicCardPath,
  type CatalogueCard,
} from '@/lib/catalogue-cards';

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

describe('matchesWords', () => {
  test('matches word starts, any order', () => {
    assert.equal(matchesWords('197 Umbreon', 'umbr'), true);
    assert.equal(matchesWords('197 Umbreon', '197'), true);
    assert.equal(matchesWords('Mr. Mime 122', 'mime mr'), true);
    assert.equal(matchesWords('197 Umbreon', 'breon'), false);
  });
  test('an empty query matches everything', () => assert.equal(matchesWords('anything', '  '), true));
});

describe('catalogueCardFromSearch', () => {
  const search = {
    id: 'sv03.5-6',
    localId: '6',
    name: 'Charizard ex',
    dexIds: [6],
    set: { id: 'sv03.5', name: '151', officialCardCount: 165, releaseDate: '2023-09-22' },
    rarity: 'Double rare',
  };
  test('links English cards to their set by id, with the printed number', () => {
    const card = catalogueCardFromSearch(search);
    assert.equal(card.setSlug, 'sv03.5');
    assert.equal(card.number, '6/165');
    assert.equal(card.releaseDate, '2023-09-22');
  });
  test('gives other languages no set link', () =>
    assert.equal(catalogueCardFromSearch({ ...search, language: 'ja' }).setSlug, ''));
});

describe('knownRarity', () => {
  test('treats the catalogue\'s "None" as no rarity', () => {
    assert.equal(knownRarity('None'), undefined);
    assert.equal(knownRarity('Rare'), 'Rare');
  });
});

describe('parseCardNumberQuery', () => {
  test('reads number and printed total, with or without a name', () => {
    assert.deepEqual(parseCardNumberQuery('161/131'), { number: '161', total: 131, text: '' });
    assert.deepEqual(parseCardNumberQuery('Flabébé 161 / 131'), { number: '161', total: 131, text: 'Flabébé' });
    assert.deepEqual(parseCardNumberQuery('#006/165 charizard'), { number: '6', total: 165, text: 'charizard' });
  });
  test('ignores plain numbers and words', () => {
    assert.equal(parseCardNumberQuery('umbreon 215'), null);
    assert.equal(parseCardNumberQuery('ex1/2x'), null);
  });
  test('pads numbers the ways sets store them', () => {
    assert.deepEqual(paddedCardNumbers('6'), ['6', '06', '006']);
    assert.deepEqual(paddedCardNumbers('161'), ['161']);
  });
});

describe('publicCardPath', () => {
  test('links cards in a public set to their page, keeping ids with promo suffixes intact', () => {
    assert.equal(publicCardPath({ id: 'sv10-1', setSlug: 'destined-rivals' }), '/cards/sv10-1');
    assert.equal(publicCardPath({ id: 'svp-013~490730', setSlug: 'svp' }), '/cards/svp-013~490730');
    assert.equal(publicCardPath({ id: 'ja-1', setSlug: '' }), undefined);
  });
});
