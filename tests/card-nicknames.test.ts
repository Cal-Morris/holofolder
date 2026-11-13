import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import NICKNAMES from '../lib/card-nicknames.json';
import { matchCardNicknames, normalizeNickname } from '../lib/card-nicknames';
import { searchOfflineCards } from '../lib/offline-card-index';

// Synthetic nickname table and cards; ids are catalog-shaped but nothing here is real price or card data.
const table = { moonbreon: ['swsh7-215'], 'gold star': ['ex8-107', 'pop5-17'], alt: ['swsh7-189'], 'alt art': ['x-1'] };

describe('matchCardNicknames', () => {
  test('whole query, nickname at either end, and the longest nickname wins', () => {
    assert.deepEqual(matchCardNicknames('Moonbreon', table), { ids: ['swsh7-215'], rest: '' });
    assert.deepEqual(matchCardNicknames('gold star rayquaza', table), {
      ids: ['ex8-107', 'pop5-17'],
      rest: 'rayquaza',
    });
    assert.deepEqual(matchCardNicknames('umbreon alt', table), { ids: ['swsh7-189'], rest: 'umbreon' });
    assert.deepEqual(matchCardNicknames('umbreon alt art', table), { ids: ['x-1'], rest: 'umbreon' });
  });
  test('typing the start of a one-word nickname matches; words inside other words do not', () => {
    assert.deepEqual(matchCardNicknames('moonbr', table)?.ids, ['swsh7-215']);
    assert.equal(matchCardNicknames('moo', table), null);
    assert.equal(matchCardNicknames('gold', table), null);
    assert.equal(matchCardNicknames('salt', table), null);
    assert.equal(matchCardNicknames('golden star', table), null);
  });
});

describe('on-device search', () => {
  const set = { id: 'swsh7', name: 'Evolving Skies' };
  const cards = [
    { id: 'swsh7-95', name: 'Umbreon VMAX', localId: '95', set, dexIds: [197] },
    { id: 'swsh7-215', name: 'Umbreon VMAX', localId: '215', set, dexIds: [197] },
  ];
  test('a nickname finds its card first', () => {
    assert.deepEqual(
      searchOfflineCards(cards, 'moonbreon').map((card) => card.id),
      ['swsh7-215'],
    );
  });
});

describe('lib/card-nicknames.json', () => {
  test('is built from lib/card-nicknames.csv (run `bun run card-nicknames` after editing it)', () => {
    const json: Record<string, string[]> = NICKNAMES;
    const rows = readFileSync(new URL('../lib/card-nicknames.csv', import.meta.url), 'utf8')
      .split('\n')
      .filter((line) => line && !line.startsWith('#'))
      .slice(1);
    assert.ok(rows.length > 0);
    for (const row of rows) {
      const [nickname, cardId] = row.split(',');
      assert.ok(json[normalizeNickname(nickname)]?.includes(cardId), `${row} is missing from the JSON`);
    }
    for (const key of Object.keys(json)) assert.equal(normalizeNickname(key), key);
  });
});
