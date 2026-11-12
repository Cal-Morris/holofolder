import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  filterSetGroups,
  getSetMonogram,
  groupSetsBySeries,
  isSetInLanguage,
  listSetSeries,
  pickSetArtwork,
} from '../lib/set-browse';

// Synthetic sets, not real TCG data.
const sets = [
  { id: 'old1', name: 'Old Base', seriesName: 'Old Era', releaseDate: '2001-01-01' },
  { id: 'new2', name: 'New Storm', seriesName: 'New Era', releaseDate: '2026-05-01' },
  { id: 'new1', name: 'New Dawn', seriesName: 'New Era', releaseDate: '2026-01-01' },
  { id: 'old2', name: 'Old Jungle', seriesName: 'Old Era', releaseDate: '2002-01-01' },
  { id: 'loose', name: 'Loose Promo' },
];

describe('set browse', () => {
  test('groups by series, newest series and newest set first, unnamed series last as Other', () => {
    assert.deepEqual(
      groupSetsBySeries(sets).map((group) => [group.series, group.sets.map((set) => set.id)]),
      [
        ['New Era', ['new2', 'new1']],
        ['Old Era', ['old2', 'old1']],
        ['Other', ['loose']],
      ],
    );
    assert.deepEqual(listSetSeries(sets), [
      { series: 'New Era', count: 2 },
      { series: 'Old Era', count: 2 },
      { series: 'Other', count: 1 },
    ]);
  });

  test('filters by series and by name, code or series text, dropping empty groups', () => {
    assert.deepEqual(
      filterSetGroups(sets, { series: 'Old Era', query: '' }).map((group) => group.series),
      ['Old Era'],
    );
    assert.deepEqual(
      filterSetGroups(sets, { series: null, query: ' jungle ' }).flatMap((group) => group.sets.map((set) => set.id)),
      ['old2'],
    );
    assert.deepEqual(
      filterSetGroups(sets, { series: null, query: 'NEW1' }).flatMap((group) => group.sets.map((set) => set.id)),
      ['new1'],
    );
    assert.deepEqual(
      filterSetGroups(sets, { series: null, query: 'new era' }).flatMap((group) => group.sets.map((set) => set.id)),
      ['new2', 'new1'],
    );
    assert.deepEqual(filterSetGroups(sets, { series: 'Old Era', query: 'storm' }), []);
  });

  test('monogram falls back to initials or the start of a single word', () => {
    assert.equal(getSetMonogram({ id: 'x', name: 'Perfect Order' }), 'PO');
    assert.equal(getSetMonogram({ id: 'x', name: 'Scarlet & Violet: Black Star Promos' }), 'SVB');
    assert.equal(getSetMonogram({ id: 'sv03.5', name: '151' }), '151');
    assert.equal(getSetMonogram({ id: 'x', name: 'Base' }), 'BAS');
  });

  test('artwork uses only mirrored URLs: TCGdex logo first, pokemontcg symbol first', () => {
    assert.deepEqual(
      pickSetArtwork({
        tcgdexSymbol: 'https://assets.tcgdex.net/univ/x/x1/symbol',
        tcgdexLogo: 'https://assets.tcgdex.net/en/x/x1/logo',
        pokemonTcgImages: {
          symbol: 'https://images.pokemontcg.io/x1/symbol.png',
          logo: 'https://images.pokemontcg.io/x1/logo.png',
        },
      }),
      { symbol: 'https://images.pokemontcg.io/x1/symbol.png', logo: 'https://assets.tcgdex.net/en/x/x1/logo.png' },
    );
    assert.deepEqual(pickSetArtwork({ tcgdexSymbol: 'https://assets.tcgdex.net/univ/x/x1/symbol' }), {
      symbol: 'https://assets.tcgdex.net/univ/x/x1/symbol.png',
    });
    assert.deepEqual(pickSetArtwork({ tcgdexLogo: null, pokemonTcgImages: { logo: 'javascript:alert(1)' } }), {});
    assert.deepEqual(pickSetArtwork({}), {});
  });
});

test('browse filters by exact release year while retaining the series filter', () => {
  assert.deepEqual(
    filterSetGroups(sets, { series: null, query: '2026' }).flatMap((group) => group.sets.map((set) => set.id)),
    ['new2', 'new1'],
  );
  assert.deepEqual(filterSetGroups(sets, { series: 'Old Era', query: '2026' }), []);
});

test('a long-running collection with a brand new set does not jump the current era', () => {
  // Synthetic sets, not real TCG data.
  const mixed = [
    { id: 'era1', name: 'Era One', seriesName: 'Current Era', releaseDate: '2026-01-01' },
    { id: 'era2', name: 'Era Two', seriesName: 'Current Era', releaseDate: '2026-06-01' },
    { id: 'col1', name: 'Collection 2012', seriesName: 'Collection', releaseDate: '2012-01-01' },
    { id: 'col2', name: 'Collection 2018', seriesName: 'Collection', releaseDate: '2018-01-01' },
    { id: 'col3', name: 'Collection 2026', seriesName: 'Collection', releaseDate: '2026-11-01' },
    { id: 'prev', name: 'Previous', seriesName: 'Previous Era', releaseDate: '2024-01-01' },
  ];
  assert.deepEqual(
    groupSetsBySeries(mixed).map((group) => [group.series, group.sets.map((set) => set.id)]),
    [
      ['Current Era', ['era2', 'era1']],
      ['Previous Era', ['prev']],
      ['Collection', ['col3', 'col2', 'col1']],
    ],
  );
});

test('sets are kept only in the card language, Brazilian Portuguese matching TCGdex pt', () => {
  assert.equal(isSetInLanguage({ id: 'a', name: 'A', languages: ['en', 'fr'] }, 'en'), true);
  assert.equal(isSetInLanguage({ id: 'b', name: 'B', languages: ['ja'] }, 'en'), false);
  assert.equal(isSetInLanguage({ id: 'c', name: 'C', languages: ['en', 'pt'] }, 'pt-br'), true);
  assert.equal(isSetInLanguage({ id: 'd', name: 'D' }, 'ko'), true);
});
