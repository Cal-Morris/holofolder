import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesSearchChip, searchChipKey, searchChipQuery, type SearchChip } from '../lib/search-chips';
import type { SearchCardResult } from '../lib/pokemon-card-browse';

// Synthetic cards, not catalogue data.
const card = (id: string, setId: string, dexIds: number[], illustrator?: string) =>
  ({
    id,
    localId: id.split('-')[1],
    name: 'Fixture',
    set: { id: setId, name: `Set ${setId}` },
    dexIds,
    illustrator,
  }) as SearchCardResult;

const pokemon: SearchChip = { kind: 'pokemon', id: 4, name: 'charmander' };
const set: SearchChip = { kind: 'set', set: { id: 'sv03.5', name: '151' } };
const artist: SearchChip = { kind: 'illustrator', name: 'Mitsuhiro Arita', cardCount: 3 };

describe('search chips', () => {
  test('rerun the search with the name, the set id or the full artist name', () => {
    assert.equal(searchChipQuery(pokemon), 'Charmander');
    assert.equal(searchChipQuery(set), 'sv03.5');
    assert.equal(searchChipQuery(artist), 'Mitsuhiro Arita');
  });

  test('keep only the cards of that Pokémon, set or exact artist', () => {
    assert.equal(matchesSearchChip(card('sv03.5-4', 'sv03.5', [4, 5]), pokemon), true);
    assert.equal(matchesSearchChip(card('sv03.5-7', 'sv03.5', [7]), pokemon), false);
    assert.equal(matchesSearchChip(card('sv03.5-7', 'sv03.5', [7]), set), true);
    assert.equal(matchesSearchChip(card('sv03-7', 'sv03', [7]), set), false);
    assert.equal(matchesSearchChip(card('base1-4', 'base1', [4], ' Mitsuhiro Arita '), artist), true);
    assert.equal(matchesSearchChip(card('base1-5', 'base1', [5], 'Mitsuhiro Aritas'), artist), false);
    assert.equal(matchesSearchChip(card('base1-6', 'base1', [6]), artist), false);
  });

  test('keys tell kinds apart', () => {
    assert.notEqual(searchChipKey(pokemon), searchChipKey({ kind: 'illustrator', name: '4', cardCount: 1 }));
  });
});
