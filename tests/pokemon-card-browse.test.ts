import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBrowseEntries,
  formatCardNumber,
  getCardVariantLabels,
  groupCardResultsByPokemon,
  inferCardFinish,
  normalizeLocalId,
  parseCardSearchQuery,
  type SearchCardResult,
} from '../lib/pokemon-card-browse';
import { getEditDistance, parseDexNumberQuery, searchPokemonItems } from '../lib/pokemon-search-state';

function card(id: string, localId: string, setId: string, releaseDate?: string, dexIds = [1]): SearchCardResult {
  return {
    id,
    localId,
    name: 'Bulbasaur',
    set: { id: setId, name: setId.toUpperCase(), officialCardCount: 102, releaseDate },
    dexIds,
  };
}

describe('buildBrowseEntries', () => {
  const cards = [
    card('base1-44', '44', 'base1', '1999-01-09'),
    card('sv01-1', '1', 'sv01', '2023-03-31'),
    card('promo-1', '1', 'promo'),
  ];

  test('sorts newest set first and marks owned/wanted printings', () => {
    const entries = buildBrowseEntries(cards, {
      card_id: 'base1-44',
      status: 'collected',
      wanted_cards: [{ card_id: 'sv01-1' }],
    });
    assert.deepEqual(
      entries.map((entry) => entry.card.id),
      ['sv01-1', 'base1-44', 'promo-1'],
    );
    assert.equal(entries[1].owned, true);
    assert.equal(entries[0].wanted, true);
    assert.equal(entries[2].owned || entries[2].wanted, false);
  });

  test('a wishlisted slot does not count its card as owned', () => {
    const entries = buildBrowseEntries(cards, { card_id: 'base1-44', status: 'wishlisted' });
    assert.equal(
      entries.some((entry) => entry.owned),
      false,
    );
  });

  test('filters owned and wanted', () => {
    const state = { card_id: 'base1-44', status: 'collected', wanted_cards: [{ card_id: 'sv01-1' }] };
    assert.deepEqual(
      buildBrowseEntries(cards, state, 'owned').map((entry) => entry.card.id),
      ['base1-44'],
    );
    assert.deepEqual(
      buildBrowseEntries(cards, state, 'wanted').map((entry) => entry.card.id),
      ['sv01-1'],
    );
  });
});

describe('card formatting', () => {
  test('number with set total', () => {
    assert.equal(
      formatCardNumber({ localId: '44', set: { id: 'base1', name: 'Base', officialCardCount: 102 } }),
      '44/102',
    );
    assert.equal(formatCardNumber({ localId: 'SWSH001', set: { id: 'p', name: 'Promo' } }), '#SWSH001');
  });
  test('variant labels', () => {
    assert.deepEqual(getCardVariantLabels({ normal: true, reverse: true, holo: false, firstEdition: true }), [
      'Normal',
      'Reverse',
      '1st Edition',
    ]);
    assert.deepEqual(getCardVariantLabels(undefined), []);
  });
  test('finish inference', () => {
    assert.equal(inferCardFinish('Special Illustration Rare', {}), 'special_illustration_rare');
    assert.equal(inferCardFinish('Rare', { holo: true }), 'holo');
    assert.equal(inferCardFinish(undefined, undefined), 'normal');
  });
});

describe('parseCardSearchQuery', () => {
  test('recognizes the stable ID of an individually catalogued printing', () => {
    assert.equal(parseCardSearchQuery('mep-070~685563').cardId, 'mep-070~685563');
  });
  test('name with card number', () => {
    assert.deepEqual(parseCardSearchQuery('Bulbasaur 44/102'), { text: 'bulbasaur', number: '44', cardId: null });
    assert.deepEqual(parseCardSearchQuery('pitch black #12'), { text: 'pitch black', number: '12', cardId: null });
    assert.deepEqual(parseCardSearchQuery('me05 12'), { text: 'me05', number: '12', cardId: null });
  });
  test('card ids', () => {
    assert.equal(parseCardSearchQuery('base1-44').cardId, 'base1-44');
    assert.equal(parseCardSearchQuery('sv03.5-001').cardId, 'sv03.5-001');
    assert.equal(parseCardSearchQuery('ho-oh').cardId, null);
  });
  test('plain names and lone numbers stay as text', () => {
    assert.deepEqual(parseCardSearchQuery('charizard'), { text: 'charizard', number: null, cardId: null });
    assert.deepEqual(parseCardSearchQuery('25'), { text: '25', number: null, cardId: null });
  });
  test('strips PostgREST-significant characters', () => {
    assert.equal(parseCardSearchQuery('pika,chu (ex%)').text, 'pika chu ex');
  });
  test('normalizes local ids', () => {
    assert.equal(normalizeLocalId('004'), '4');
    assert.equal(normalizeLocalId('12a'), '12a');
    assert.equal(normalizeLocalId('TG01'), 'tg01');
  });
});

describe('groupCardResultsByPokemon', () => {
  test('groups by dex id in result order and lists multi-Pokémon cards under each', () => {
    const names: Record<number, string> = { 1: 'bulbasaur', 4: 'charmander' };
    const groups = groupCardResultsByPokemon(
      [
        card('a', '1', 's1', '2020-01-01', [4]),
        card('b', '2', 's1', '2020-01-01', [1, 4]),
        card('c', '3', 's2', '2021-01-01', [999]),
      ],
      (dexId) => names[dexId],
    );
    assert.deepEqual(
      groups.map((group) => group.dexId),
      [4, 1],
    );
    assert.deepEqual(
      groups[0].cards.map((entry) => entry.id),
      ['a', 'b'],
    );
    assert.deepEqual(
      groups[1].cards.map((entry) => entry.id),
      ['b'],
    );
  });
});

describe('fuzzy Pokémon search', () => {
  const items = [
    { id: 1, name: 'bulbasaur' },
    { id: 6, name: 'charizard' },
    { id: 25, name: 'pikachu' },
    { id: 250, name: 'ho-oh' },
    { id: 26, name: 'raichu' },
  ];
  test('dex numbers', () => {
    assert.equal(parseDexNumberQuery('#025'), 25);
    assert.equal(parseDexNumberQuery('no. 6'), 6);
    assert.equal(parseDexNumberQuery('pikachu'), null);
    assert.equal(searchPokemonItems('#25', items)[0].id, 25);
    assert.equal(searchPokemonItems('25', items)[0].id, 25);
  });
  test('tolerates typos', () => {
    assert.equal(searchPokemonItems('charzard', items)[0].id, 6);
    assert.equal(searchPokemonItems('pikachuu', items)[0].id, 25);
    assert.equal(searchPokemonItems('bulbasuar', items)[0].id, 1);
  });
  test('mid-length names allow two typos, four letters still one', () => {
    const fossils = [...items, { id: 138, name: 'omanyte' }, { id: 95, name: 'onix' }, { id: 495, name: 'snivy' }];
    assert.equal(searchPokemonItems('ominite', fossils)[0].id, 138);
    assert.equal(searchPokemonItems('omanite', fossils)[0].id, 138);
    assert.equal(searchPokemonItems('pikachu', fossils)[0].id, 25);
    assert.ok(searchPokemonItems('pikachu', fossils)[0].score > searchPokemonItems('ominite', fossils)[0].score);
    assert.deepEqual(
      searchPokemonItems('onix', fossils).map((item) => item.id),
      [95],
    );
  });
  test('exact and prefix matches still rank first', () => {
    assert.equal(searchPokemonItems('rai', items)[0].id, 26);
    assert.equal(searchPokemonItems('ho oh', items)[0].id, 250);
  });
  test('edit distance', () => {
    assert.equal(getEditDistance('charzard', 'charizard'), 1);
    assert.equal(getEditDistance('abcd', 'abdc'), 1);
    assert.equal(getEditDistance('abc', 'xyzuvw', 2), 3);
  });
});

test('browse owned and wanted flags use reviewed aliases but never merge a stamp', () => {
  const base = { ...card('base1-44', '44', 'base1'), aliasIds: ['old-provider-44'] };
  const stamp = { ...base, id: 'base1-44~123', aliasIds: undefined };
  const entries = buildBrowseEntries([base, stamp], {
    card_id: 'old-provider-44',
    status: 'collected',
    wanted_cards: [{ card_id: 'old-provider-44' }],
  });
  const byId = new Map(entries.map((entry) => [entry.card.id, { owned: entry.owned, wanted: entry.wanted }]));
  assert.deepEqual(byId.get(base.id), { owned: true, wanted: true });
  assert.deepEqual(byId.get(stamp.id), { owned: false, wanted: false });
});
