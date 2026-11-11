import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPokemonDisplayName } from '../lib/pokemon-catalog';

test('formatPokemonDisplayName renders human Pokemon names from catalog slugs', () => {
  assert.equal(formatPokemonDisplayName('mr-mime'), 'Mr. Mime');
  assert.equal(formatPokemonDisplayName('mr-rime'), 'Mr. Rime');
  assert.equal(formatPokemonDisplayName('mime-jr'), 'Mime Jr.');
  assert.equal(formatPokemonDisplayName('type-null'), 'Type: Null');
  assert.equal(formatPokemonDisplayName('nidoran-f'), 'Nidoran♀');
  assert.equal(formatPokemonDisplayName('nidoran-m'), 'Nidoran♂');
  assert.equal(formatPokemonDisplayName('oricorio-baile'), 'Oricorio');
  assert.equal(formatPokemonDisplayName('tapu-koko'), 'Tapu Koko');
  assert.equal(formatPokemonDisplayName('ho-oh'), 'Ho-Oh');
  assert.equal(formatPokemonDisplayName('jangmo-o'), 'Jangmo-o');
});
