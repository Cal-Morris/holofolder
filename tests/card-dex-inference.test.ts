import test from 'node:test';
import assert from 'node:assert/strict';
import { inferDexIdsFromCardName } from '../lib/card-dex-inference';

test('inferDexIdsFromCardName maps 30th Classic Collection names to species', () => {
  const cases: Array<[string, number[]]> = [
    ['Charizard', [6]],
    ['Genesect EX', [649]],
    ['Dark Tyranitar', [248]],
    ['Pikachu & Zekrom GX', [25, 644]],
    ['Greninja BREAK', [658]],
    ['Crobat G', [169]],
    ["Erika's Jigglypuff", [39]],
    ['Darkrai & Cresselia LEGEND', [491, 488]],
    ['M Gardevoir EX', [282]],
    ['Shining Celebi', [251]],
    ['Mew VMAX', [151]],
    ['Arceus VSTAR', [493]],
    ['Alolan Exeggutor', [103]],
    ['Mr. Mime', [122]],
    ['Ho-Oh', [250]],
    ['Deoxys', [386]],
    ['Type: Null', [772]],
    ['Iron Treads ex', [990]],
    ['Mega Charizard X ex', [6]],
  ];
  for (const [name, expected] of cases) {
    assert.deepEqual(inferDexIdsFromCardName(name), expected, name);
  }
});

test('inferDexIdsFromCardName returns nothing for non-species names', () => {
  assert.deepEqual(inferDexIdsFromCardName("Professor's Research"), []);
  assert.deepEqual(inferDexIdsFromCardName(''), []);
  assert.deepEqual(inferDexIdsFromCardName(null), []);
});
