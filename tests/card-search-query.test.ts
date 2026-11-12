import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { correctedCardSearchQuery, resolveCardSearchQuery } from '../lib/card-search-query';
import { searchOfflineCards, searchOfflineCardsWithCorrection } from '../lib/offline-card-index';

// Synthetic cards using catalog set identifiers/names, never pricing evidence.
const sets = [
  { id: 'sv03.5', name: '151' },
  { id: 'base1', name: 'Base Set' },
  { id: 'me06', name: 'Delta Reign' },
];
const cards = [
  { id: 'sv03.5-063', name: 'Abra', localId: '063', set: sets[0], dexIds: [63] },
  { id: 'sv03.5-064', name: 'Kadabra', localId: '064', set: sets[0], dexIds: [64] },
  { id: 'base1-43', name: 'Abra', localId: '43', set: sets[1], dexIds: [63] },
  { id: 'base1-151', name: 'Abra', localId: '151', set: sets[1], dexIds: [63] },
  { id: 'base1-44', name: 'Bulbasaur', localId: '44', set: sets[1], dexIds: [1] },
  { id: 'me06-063', name: 'Abra', localId: '063', set: sets[2], dexIds: [63] },
];
const ids = (query: string) => searchOfflineCards(cards, query).map((card) => card.id);

describe('catalog-backed compound card search', () => {
  test('151 is a known set, with card name matching as a separate AND constraint', () => {
    for (const query of ['abra 151', '151 abra', 'Abra sv03.5']) {
      assert.deepEqual(resolveCardSearchQuery(query, sets), {
        text: 'abra',
        number: null,
        cardId: null,
        setIds: ['sv03.5'],
      });
      assert.deepEqual(ids(query), ['sv03.5-063', 'sv03.5-064']);
    }
    assert.deepEqual(ids('pikachu 151'), []);
  });
  test('multiword catalog names and the existing verified DLR alias work', () => {
    assert.deepEqual(ids('abra base set'), ['base1-43', 'base1-151']);
    assert.deepEqual(ids('base set abra'), ['base1-43', 'base1-151']);
    assert.deepEqual(ids('abra delta reign'), ['me06-063']);
    assert.deepEqual(ids('abra DLR'), ['me06-063']);
    assert.deepEqual(ids('DLR 63'), ['me06-063']);
  });
  test('explicit collector numbers and card ids retain their meaning', () => {
    assert.deepEqual(ids('abra #151'), ['base1-151']);
    assert.deepEqual(ids('bulbasaur 44/102'), ['base1-44']);
    assert.deepEqual(ids('44/102 bulbasaur'), ['base1-44']);
    assert.deepEqual(ids('abra 151 #063'), ['sv03.5-063']);
    assert.deepEqual(ids('abra 151 063/165'), ['sv03.5-063']);
    assert.deepEqual(ids('sv03.5-063'), ['sv03.5-063']);
    assert.equal(resolveCardSearchQuery('mep-070~685563', sets).cardId, 'mep-070~685563');
  });
  test('unknown bare numbers remain collector numbers, no catalog data is invented', () => {
    assert.deepEqual(ids('abra 43'), ['base1-43']);
    assert.deepEqual(resolveCardSearchQuery('abra 151', []), { text: 'abra', number: '151', cardId: null, setIds: [] });
    assert.deepEqual(ids('abra made up set'), []);
  });
});

// Synthetic card rows using catalog names; these do not assert real printings or prices.
const neoSets = [
  { id: 'neo1', name: 'Neo Genesis' },
  { id: 'neo3', name: 'Neo Revelation' },
  { id: 'neo4', name: 'Neo Destiny' },
];
const neoCards = neoSets.map((set) => ({ id: `${set.id}-1`, name: 'Lugia', localId: '1', set, dexIds: [249] }));

test('partial set families constrain card names across cached catalog names', () => {
  assert.deepEqual(searchOfflineCards(neoCards, 'Lugia neo'), neoCards);
  assert.deepEqual(searchOfflineCards(neoCards, 'neo gen Lugia'), [neoCards[0]]);
  assert.deepEqual(searchOfflineCards(neoCards, 'Lugia genesis'), [neoCards[0]]);
  assert.deepEqual(searchOfflineCards(neoCards, 'Lugia ne'), []);
  assert.deepEqual(searchOfflineCards(neoCards, 'Lugia eon'), []);
});

test('unique Pokémon typos retry against the same set family and retain collector constraints', () => {
  for (const query of ['Lucia neo', 'Lguia neo', 'Lugai neo', 'Lguai neo']) {
    const result = searchOfflineCardsWithCorrection(neoCards, query);
    assert.deepEqual(result.cards, neoCards, query);
    assert.equal(result.correction, 'lugia neo', query);
  }
  assert.deepEqual(searchOfflineCardsWithCorrection(neoCards, 'Lucia neo #2'), { cards: [], correction: null });
  assert.equal(correctedCardSearchQuery('Lucia neo #1', neoSets), 'lugia neo #1');
  assert.equal(correctedCardSearchQuery('neo Lucia 1/111', neoSets), 'neo lugia 1/111');
});

test('literal results win, ambiguous names, fragments and unknown sets are never corrected', () => {
  const literal = { ...neoCards[0], id: 'synthetic-lucia', name: 'Lucia' };
  assert.deepEqual(searchOfflineCardsWithCorrection([...neoCards, literal], 'Lucia neo'), {
    cards: [literal],
    correction: null,
  });
  for (const query of [
    'Lugia neo',
    'mew neo',
    'lug neo',
    'nidoran neo',
    'latixs neo',
    'xxxxxx neo',
    'Lucia unknown',
    'Lucia',
    'neo1-1',
    'arita neo',
  ]) {
    assert.equal(correctedCardSearchQuery(query, neoSets), null, query);
  }
  assert.deepEqual(searchOfflineCardsWithCorrection([], 'Lucia neo'), { cards: [], correction: null });
});

test('partial sets still honor explicit numbers and exact set-name precedence', () => {
  assert.deepEqual(searchOfflineCards(neoCards, 'Lugia neo #1'), neoCards);
  assert.deepEqual(searchOfflineCards(neoCards, 'Lugia neo 1/111'), neoCards);
  assert.deepEqual(searchOfflineCards(neoCards, 'Lugia neo #2'), []);
  assert.deepEqual(resolveCardSearchQuery('Lugia neo', [...neoSets, { id: 'synthetic-neo', name: 'Neo' }]).setIds, [
    'synthetic-neo',
  ]);
  assert.deepEqual(
    searchOfflineCardsWithCorrection([{ ...neoCards[0], illustrator: 'Mitsuhiro Arita' }], 'Mitsuhiro Arita'),
    {
      cards: [{ ...neoCards[0], illustrator: 'Mitsuhiro Arita' }],
      correction: null,
    },
  );
});

test('MEW is read as a Pokémon unless the rest of the query names one', () => {
  const catalog = [...sets, { id: '30th', name: '30th Celebration' }];
  const mewCards = [
    { id: 'sv03.5-151', name: 'Mew ex', localId: '151', set: sets[0], dexIds: [151] },
    { id: '30th-152', name: 'Mew ex', localId: '152', set: catalog[3], dexIds: [151] },
    { id: 'sv03.5-025', name: 'Pikachu', localId: '025', set: sets[0], dexIds: [25] },
  ];
  assert.deepEqual(resolveCardSearchQuery('Mew 30th', catalog), {
    text: 'mew',
    number: null,
    cardId: null,
    setIds: ['30th'],
  });
  assert.deepEqual(resolveCardSearchQuery('Mew ex 152', catalog).setIds, []);
  assert.deepEqual(
    searchOfflineCards(mewCards, 'Mew ex 152/128').map((card) => card.id),
    ['30th-152'],
  );
  assert.deepEqual(
    searchOfflineCards(mewCards, 'Pikachu MEW').map((card) => card.id),
    ['sv03.5-025'],
  );
  assert.deepEqual(
    searchOfflineCards(mewCards, 'Mew 151').map((card) => card.id),
    ['sv03.5-151'],
  );
});

// Synthetic cards on real catalog set ids/names (30th Celebration, 151); not real printings or prices.
const celebrationSets = [
  { id: 'sv03.5', name: '151' },
  { id: '30th', name: '30th Celebration' },
  { id: '30th-c', name: '30th Classic Collection' },
];
const celebrationCards = [
  { id: 'sv03.5-030', name: 'Nidorina', localId: '030', set: celebrationSets[0], dexIds: [30] },
  { id: 'synthetic-30th-mew', name: 'Mew', localId: '12', set: celebrationSets[1], dexIds: [151] },
  { id: 'synthetic-30th-lugia', name: 'Lugia', localId: '40', set: celebrationSets[1], dexIds: [249] },
  { id: 'synthetic-30th-c-lugia', name: 'Lugia', localId: '9', set: celebrationSets[2], dexIds: [249] },
];

test('a Pokémon with an anniversary set beats the MEW printed code', () => {
  const found = (query: string) => searchOfflineCards(celebrationCards, query).map((card) => card.id);
  for (const query of ['mew 30th', 'Mew 30', '30th mew', 'mew 30th celebration'])
    assert.deepEqual(found(query), ['synthetic-30th-mew'], query);
  assert.deepEqual(found('lugia 30th'), ['synthetic-30th-lugia']);
  assert.deepEqual(found('lugia 30').sort(), ['synthetic-30th-c-lugia', 'synthetic-30th-lugia']);
  // Without a Pokémon name the printed code and collector number still win.
  assert.deepEqual(found('MEW 030'), ['sv03.5-030']);
  assert.deepEqual(resolveCardSearchQuery('abra 130', celebrationSets).setIds, []);
});

test('a bare number read as an anniversary set falls back to the collector number when the set has no match', () => {
  const pikachu25 = {
    id: 'synthetic-pikachu-25',
    name: 'Pikachu',
    localId: '25',
    set: { id: 'fx2', name: 'Fixture' },
    dexIds: [25],
  };
  const jp25th = {
    id: 'synthetic-25th-mew',
    name: 'Mew',
    localId: '1',
    set: { id: 'S8a', name: '25th Anniversary Collection' },
    dexIds: [151],
  };
  assert.deepEqual(searchOfflineCardsWithCorrection([pikachu25, jp25th], 'pikachu 25'), {
    cards: [pikachu25],
    correction: 'pikachu #25',
  });
  assert.deepEqual(searchOfflineCardsWithCorrection([pikachu25, jp25th], 'mew 25').cards, [jp25th]);
});
