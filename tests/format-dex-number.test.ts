import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDexNumber } from '../lib/pokemon-catalog';

test('formatDexNumber pads to four digits with a leading #', () => {
  assert.equal(formatDexNumber(1), '#0001');
  assert.equal(formatDexNumber(25), '#0025');
  assert.equal(formatDexNumber(1025), '#1025');
});
