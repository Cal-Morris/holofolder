import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cardListingSearchQuery } from '../lib/ebay-search-urls';

test('Classic Collection browser searches use printed numbers, including hyphenated set IDs', () => {
  assert.equal(
    cardListingSearchQuery({
      cardId: '30th-c-018',
      name: 'Gengar',
      localId: '018',
      setName: '30th Classic Collection',
    }),
    'Gengar 94/102 30th Classic Collection',
  );
  assert.equal(
    cardListingSearchQuery({ cardId: '30th-c-018', name: 'Gengar' }, 'holo'),
    'Gengar 94/102 30th Classic Collection holo -reverse',
  );
  assert.equal(
    cardListingSearchQuery({ cardId: '30th-c-019', name: 'Darkrai & Cresselia LEGEND' }),
    'Darkrai & Cresselia LEGEND 99/102 30th Classic Collection',
  );
  assert.equal(
    cardListingSearchQuery({ cardId: '30th-c-020', name: 'Darkrai & Cresselia LEGEND' }),
    'Darkrai & Cresselia LEGEND 100/102 30th Classic Collection',
  );
  assert.equal(cardListingSearchQuery({ cardId: '30th-c-999', name: 'Unknown', localId: '999' }), 'Unknown 999');
});

test('Classic Collection printed identity reaches asking, sold and saved links without weakening matching', () => {
  execFileSync(process.execPath, [new URL('./fixtures/classic-price-check-service.ts', import.meta.url).pathname], {
    stdio: 'inherit',
  });
});
