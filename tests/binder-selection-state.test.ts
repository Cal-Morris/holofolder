import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldClearSelectedPokemonForPage } from '../lib/binder-selection-state';

test('shouldClearSelectedPokemonForPage clears stale selections that are not visible', () => {
  assert.equal(shouldClearSelectedPokemonForPage(25, [1, 2, 3]), true);
  assert.equal(shouldClearSelectedPokemonForPage(25, [24, 25, 26]), false);
  assert.equal(shouldClearSelectedPokemonForPage(25, new Set([17, 18, 25])), false);
});

test('shouldClearSelectedPokemonForPage keeps empty selection empty', () => {
  assert.equal(shouldClearSelectedPokemonForPage(null, [1, 2, 3]), false);
});
