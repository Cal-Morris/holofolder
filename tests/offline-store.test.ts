import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../lib/offline-store/kv';
import { MAX_STORED_SET_QUERIES, loadSetQuery, saveSetQuery } from '../lib/offline-store/records';
import type { TCGSetSlotsResponse } from '../lib/tcg-set-slots';

test('set lookups are saved per query, readable later, and trimmed to the most recent', async () => {
  const store = createMemoryStore();
  const payload = (id: string): TCGSetSlotsResponse => ({
    sets: [],
    selectedSet: { id, name: id } as TCGSetSlotsResponse['selectedSet'],
    slots: [],
  });

  await saveSetQuery(store, 'setId=base1', payload('base1'), new Date('2026-10-01T00:00:00Z'));
  assert.equal((await loadSetQuery(store, 'setId=base1'))?.selectedSet?.id, 'base1');
  assert.equal(await loadSetQuery(store, 'setId=missing'), null);
  await saveSetQuery(store, 'bad', { nope: true } as unknown as TCGSetSlotsResponse);
  assert.equal(await loadSetQuery(store, 'bad'), null);

  for (let index = 0; index < MAX_STORED_SET_QUERIES; index += 1) {
    await saveSetQuery(store, `setId=s${index}`, payload(`s${index}`), new Date(Date.UTC(2026, 9, 2, 0, index)));
  }
  assert.equal(await loadSetQuery(store, 'setId=base1'), null, 'oldest lookup evicted');
  assert.equal((await store.keys('sets:query:')).length, MAX_STORED_SET_QUERIES);
});

test('batched store reads preserve key order and isolate values; failed writes leave no partial batch', async () => {
  const store = createMemoryStore();
  const value = { synthetic: true, count: 1 };
  await store.setMany([
    ['b', value],
    ['a', { count: 2 }],
  ]);
  value.count = 99;
  const result = await store.getMany<{ count: number }>(['a', 'missing', 'b', 'a']);
  assert.deepEqual(
    result.map((item) => item?.count),
    [2, undefined, 1, 2],
  );
  result[0]!.count = 3;
  assert.equal((await store.get<{ count: number }>('a'))?.count, 2);
  assert.equal(result[3]?.count, 2);
  await assert.rejects(
    store.setMany([
      ['a', 5],
      ['invalid', () => {}],
    ]),
  );
  assert.equal((await store.get<{ count: number }>('a'))?.count, 2);
  assert.deepEqual(await store.getMany([]), []);
  await store.setMany([]);
});
