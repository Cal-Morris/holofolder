import test from 'node:test';
import assert from 'node:assert/strict';
import { selectRestSetsForSupplement } from '../lib/card-db-sync';

test('selectRestSetsForSupplement includes sets missing from the git mirror', () => {
  const selected = selectRestSetsForSupplement(
    [
      { id: 'mep', name: 'MEP Black Star Promos', cardCount: { total: 52 } },
      { id: 'base1', name: 'Base Set', cardCount: { total: 102 } },
    ],
    new Map([['base1', 102]]),
  );

  assert.deepEqual(
    selected.map((set) => set.id),
    ['mep'],
  );
});

test('selectRestSetsForSupplement includes sets when REST has more cards than the mirror', () => {
  const selected = selectRestSetsForSupplement(
    [{ id: 'sv10', name: 'Destined Rivals', cardCount: { total: 244 } }],
    new Map([['sv10', 182]]),
  );

  assert.deepEqual(
    selected.map((set) => set.id),
    ['sv10'],
  );
});

test('selectRestSetsForSupplement skips excluded series when the set summary has series metadata', () => {
  const selected = selectRestSetsForSupplement(
    [{ id: 'tcgp-A1', name: 'Genetic Apex', serie: { id: 'tcgp', name: 'Pocket' }, cardCount: { total: 286 } }],
    new Map(),
  );

  assert.deepEqual(selected, []);
});
