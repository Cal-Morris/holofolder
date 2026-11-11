import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { filterSetGroups, getSetMonogram, groupSetsBySeries, listSetSeries, pickSetArtwork } from '../lib/set-browse';

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
