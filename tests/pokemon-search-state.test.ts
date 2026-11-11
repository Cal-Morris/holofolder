import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getInitialPokemonSearchFilter,
  getPokemonSearchPageJump,
  getPokemonSearchTerms,
  matchesPokemonSearchStateFilter,
  normalizePokemonSearchText,
  searchPokemonItems,
} from '../lib/pokemon-search-state';
import { POKEMON_CATALOG } from '../lib/pokemon-catalog';

test('getInitialPokemonSearchFilter defaults search to all Pokemon', () => {
  assert.equal(getInitialPokemonSearchFilter(), 'all');
});

test('matchesPokemonSearchStateFilter separates missing slots from broader needed slots', () => {
  assert.equal(matchesPokemonSearchStateFilter('missing', { slotState: 'open' }), true);
  assert.equal(matchesPokemonSearchStateFilter('missing', { slotState: 'wanted' }), false);
  assert.equal(matchesPokemonSearchStateFilter('missing', { slotState: 'owned' }), false);
  assert.equal(matchesPokemonSearchStateFilter('missing', { slotState: 'perfect' }), false);
  assert.equal(matchesPokemonSearchStateFilter('missing', { slotState: 'upgrade' }), false);

  assert.equal(matchesPokemonSearchStateFilter('needed', { slotState: 'open' }), true);
  assert.equal(matchesPokemonSearchStateFilter('needed', { slotState: 'wanted' }), true);
});

test('getPokemonSearchPageJump detects numeric page queries', () => {
  assert.deepEqual(getPokemonSearchPageJump('6', 10), { page: 6, label: 'Jump to page 6' });
  assert.deepEqual(getPokemonSearchPageJump('page 6', 10), { page: 6, label: 'Jump to page 6' });
});

test('getPokemonSearchPageJump rejects out-of-range and mixed search queries', () => {
  assert.equal(getPokemonSearchPageJump('0', 10), null);
  assert.equal(getPokemonSearchPageJump('11', 10), null);
  assert.equal(getPokemonSearchPageJump('muk 6', 10), null);
});

test('normalizePokemonSearchText strips punctuation and normalizes gender symbols', () => {
  assert.equal(normalizePokemonSearchText('Mr. Mime'), 'mr mime');
  assert.equal(normalizePokemonSearchText('Nidoran♀'), 'nidoran female');
  assert.equal(normalizePokemonSearchText('Oricorio-Baile'), 'oricorio baile');
});

test('getPokemonSearchTerms adds base form and gender aliases', () => {
  assert.deepEqual(
    getPokemonSearchTerms('oricorio-baile').sort(),
    ['oricorio', 'oricoriobaile', 'oricorio baile'].sort(),
  );
  assert.ok(getPokemonSearchTerms('nidoran-f').includes('nidoran female'));
  assert.ok(getPokemonSearchTerms('nidoran-m').includes('nidoran male'));
});

test('searchPokemonItems matches form suffixes, compact punctuation, and gender words', () => {
  const pokemon = [
    { id: 29, name: 'nidoran-f' },
    { id: 32, name: 'nidoran-m' },
    { id: 122, name: 'mr-mime' },
    { id: 741, name: 'oricorio-baile' },
    { id: 772, name: 'type-null' },
  ];

  assert.equal(searchPokemonItems('oricorio', pokemon)[0]?.id, 741);
  assert.equal(searchPokemonItems('nidoran female', pokemon)[0]?.id, 29);
  assert.equal(searchPokemonItems('nidoran male', pokemon)[0]?.id, 32);
  assert.equal(searchPokemonItems('female', pokemon)[0]?.id, 29);
  assert.equal(searchPokemonItems('male', pokemon)[0]?.id, 32);
  assert.equal(searchPokemonItems('mr mime', pokemon)[0]?.id, 122);
  assert.equal(searchPokemonItems('typenull', pokemon)[0]?.id, 772);
});

test('searchPokemonItems with no limit returns every match, past the old 40-row cap (#592)', () => {
  const all = searchPokemonItems('an', POKEMON_CATALOG, Infinity);
  assert.ok(all.length > 40);
  assert.equal(all.length, POKEMON_CATALOG.filter((p) => searchPokemonItems('an', [p], 1).length === 1).length);
  assert.deepEqual(
    searchPokemonItems('an', POKEMON_CATALOG, 40).map((p) => p.id),
    all.slice(0, 40).map((p) => p.id),
  );
});
