import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  capBinderSnapshots,
  evictableSnapshotKeys,
  isQuotaError,
  MAX_LOCAL_BINDER_SNAPSHOTS,
  setItemMakingRoom,
} from '../lib/storage/make-room';

const DEFAULT_KEY = 'pokemon_collection_snapshot_v1';
const binderKey = (id: string) => `${DEFAULT_KEY}:${id}`;
const snapshot = (savedAt: string, size = 10) => JSON.stringify({ savedAt, collection: [], pad: 'x'.repeat(size) });

/** A localStorage stand-in with a byte quota, throwing like WebKit/Chromium when it is exceeded. */
function quotaStorage(limit: number, entries: Record<string, string> = {}) {
  const data = new Map(Object.entries(entries));
  const used = () => [...data].reduce((sum, [key, value]) => sum + key.length + value.length, 0);
  return {
    data,
    get length() {
      return data.size;
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    removeItem: (key: string) => void data.delete(key),
    setItem(key: string, value: string) {
      const previous = data.get(key);
      const next = used() - (previous === undefined ? 0 : key.length + previous.length) + key.length + value.length;
      if (next > limit) {
        const error = new Error('quota') as Error & { code: number };
        error.name = 'QuotaExceededError';
        error.code = 22;
        throw error;
      }
      data.set(key, value);
    },
  };
}

describe('setItemMakingRoom', () => {
  test("a pref saves into full storage by dropping other binders' snapshots, oldest first", () => {
    const storage = quotaStorage(1200, {
      [DEFAULT_KEY]: snapshot('2026-10-01T00:00:00Z', 300),
      [binderKey('old')]: snapshot('2026-09-01T00:00:00Z', 300),
      [binderKey('new')]: snapshot('2026-10-20T00:00:00Z', 300),
      price_cache: 'p'.repeat(150),
    });
    assert.throws(() => storage.setItem('binderdex_show_mode', 'x'.repeat(200)));

    setItemMakingRoom(storage, 'binderdex_show_mode', 'x'.repeat(200));

    assert.equal(storage.getItem('binderdex_show_mode'), 'x'.repeat(200));
    assert.equal(storage.getItem(binderKey('old')), null);
    assert.notEqual(storage.getItem(binderKey('new')), null);
    // Never touched: the default binder's copy (offline shell boot) and anything that isn't a binder snapshot.
    assert.notEqual(storage.getItem(DEFAULT_KEY), null);
    assert.equal(storage.getItem('price_cache'), 'p'.repeat(150));
  });

  test('throws the quota error when nothing reclaimable is left', () => {
    const storage = quotaStorage(100, { [DEFAULT_KEY]: snapshot('2026-10-01T00:00:00Z', 40) });
    assert.throws(
      () => setItemMakingRoom(storage, 'pref', 'x'.repeat(80)),
      (error: unknown) => isQuotaError(error),
    );
    assert.notEqual(storage.getItem(DEFAULT_KEY), null);
  });

  test('non-quota errors are rethrown without evicting', () => {
    const storage = quotaStorage(10_000, { [binderKey('a')]: snapshot('2026-10-01T00:00:00Z') });
    storage.setItem = () => {
      throw new Error('SecurityError');
    };
    assert.throws(() => setItemMakingRoom(storage, 'pref', '1'), /SecurityError/);
    assert.notEqual(storage.getItem(binderKey('a')), null);
  });

  test('a binder snapshot never evicts itself', () => {
    const storage = quotaStorage(400, { [binderKey('a')]: snapshot('2026-01-01T00:00:00Z', 200) });
    assert.deepEqual(evictableSnapshotKeys(storage, [binderKey('a')]), []);
  });
});

describe('capBinderSnapshots', () => {
  test(`keeps at most ${MAX_LOCAL_BINDER_SNAPSHOTS} other-binder snapshots, counting the one being written`, () => {
    const storage = quotaStorage(1_000_000, {
      [DEFAULT_KEY]: snapshot('2026-01-01T00:00:00Z'),
      [binderKey('a')]: snapshot('2026-01-01T00:00:00Z'),
      [binderKey('b')]: snapshot('2026-02-01T00:00:00Z'),
      [binderKey('c')]: snapshot('2026-03-01T00:00:00Z'),
      [binderKey('d')]: snapshot('2026-04-01T00:00:00Z'),
    });
    assert.deepEqual(capBinderSnapshots(storage, binderKey('d')), [binderKey('a')]);
    assert.deepEqual([...storage.data.keys()].sort(), [DEFAULT_KEY, binderKey('b'), binderKey('c'), binderKey('d')]);
  });

  test('writing the default binder keeps up to the cap of others', () => {
    const storage = quotaStorage(1_000_000, {
      [binderKey('a')]: snapshot('2026-01-01T00:00:00Z'),
      [binderKey('b')]: snapshot('2026-02-01T00:00:00Z'),
      [binderKey('c')]: snapshot('2026-03-01T00:00:00Z'),
    });
    assert.deepEqual(capBinderSnapshots(storage, DEFAULT_KEY), []);
  });
});
