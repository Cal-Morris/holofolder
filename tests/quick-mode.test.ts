import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  QUICK_DESTINATIONS,
  addRecentQuickSearch,
  matchQuickDestinations,
  parseRecentQuickSearches,
  readRecentQuickSearches,
  writeRecentQuickSearches,
  RECENT_QUICK_SEARCHES_LIMIT,
} from '@/lib/quick-mode';

describe('matchQuickDestinations', () => {
  test('an empty query lists every destination', () => {
    assert.equal(matchQuickDestinations('').length, QUICK_DESTINATIONS.length);
  });
  test('matches labels and keywords by prefix', () => {
    assert.equal(matchQuickDestinations('want')[0].id, 'wanted');
    assert.equal(matchQuickDestinations('wishlist')[0].id, 'wanted');
    assert.equal(matchQuickDestinations('sett')[0].id, 'settings');
    assert.equal(matchQuickDestinations('csv')[0].id, 'analytics');
  });
  test('exact matches rank first and unrelated queries match nothing', () => {
    assert.equal(matchQuickDestinations('sets')[0].id, 'sets');
    assert.deepEqual(matchQuickDestinations('charizard'), []);
  });
  test('ignores accents and case', () => {
    assert.equal(matchQuickDestinations('POKÉMON')[0].id, 'pokemon');
  });
});

describe('recent quick searches', () => {
  test('newest first, de-duplicated case-insensitively, capped', () => {
    let list: string[] = [];
    for (let index = 0; index < 12; index += 1) list = addRecentQuickSearch(list, `query ${index}`);
    list = addRecentQuickSearch(list, 'QUERY 11');
    assert.equal(list.length, RECENT_QUICK_SEARCHES_LIMIT);
    assert.equal(list[0], 'QUERY 11');
    assert.equal(list.filter((entry) => entry.toLowerCase() === 'query 11').length, 1);
  });
  test('drops blank and one-letter queries', () => {
    assert.deepEqual(addRecentQuickSearch([], ' '), []);
    assert.deepEqual(addRecentQuickSearch([], 'a'), []);
  });
  test('parses defensively', () => {
    assert.deepEqual(parseRecentQuickSearches('not json'), []);
    assert.deepEqual(parseRecentQuickSearches(JSON.stringify(['mew', 4, '', 'pika'])), ['mew', 'pika']);
  });
  test('round-trips through storage and survives a throwing one', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    };
    writeRecentQuickSearches(storage, ['mew']);
    assert.deepEqual(readRecentQuickSearches(storage), ['mew']);
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
    };
    assert.deepEqual(readRecentQuickSearches(broken), []);
    assert.doesNotThrow(() => writeRecentQuickSearches(broken, ['x']));
  });
});
