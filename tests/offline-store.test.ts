import test from 'node:test';
import assert from 'node:assert/strict';
import type { CollectedPokemon } from '../lib/domain/cards';
import { createMemoryStore } from '../lib/offline-store/kv';
import {
  MAX_STORED_SET_QUERIES,
  extractLastKnownPrices,
  loadLastKnownPrices,
  loadSetQuery,
  saveLastKnownPrices,
  saveSetQuery,
  selectWantlist,
} from '../lib/offline-store/records';
import type { TCGSetSlotsResponse } from '../lib/tcg-set-slots';

const pikachu: CollectedPokemon = {
  id: 'row-25',
  pokemon_id: 25,
  pokemon_name: 'Pikachu',
  card_language: 'en',
  card_finish: 'normal',
  wanted_cards: [],
  status: 'collected',
  collected_at: '2026-10-01T00:00:00.000Z',
};

const mew: CollectedPokemon = {
  ...pikachu,
  id: 'row-151',
  pokemon_id: 151,
  pokemon_name: 'Mew',
  status: 'wishlisted',
  wanted_cards: [{ card_id: 'base4-151', card_name: 'Mew', added_at: '2026-10-02T00:00:00.000Z' }],
};

const eevee: CollectedPokemon = {
  ...pikachu,
  id: 'row-133',
  pokemon_id: 133,
  pokemon_name: 'Eevee',
  status: 'wishlisted',
};

test('the wantlist lists wanted printings, and wishlisted Pokémon without a chosen printing', () => {
  assert.deepEqual(selectWantlist([pikachu, mew, eevee]), [
    { pokemonId: 151, pokemonName: 'Mew', card: mew.wanted_cards[0] },
    { pokemonId: 133, pokemonName: 'Eevee', card: null },
  ]);
});

test('last-known prices come from the existing client price cache and survive it being trimmed', async () => {
  const raw = JSON.stringify({
    'base1-4:en': {
      cardId: 'base1-4',
      language: 'en',
      gbpAmount: 210,
      marketGbpAmount: 199.5,
      source: 'cardmarket',
      updatedAt: '2026-10-07',
    },
    'base1-58:en': { cardId: 'base1-58', language: 'en', gbpAmount: null, marketGbpAmount: null },
    junk: 'nope',
  });
  const prices = extractLastKnownPrices(raw);
  assert.deepEqual(Object.keys(prices), ['base1-4:en']);
  assert.equal(prices['base1-4:en'].marketGbpAmount, 199.5);
  assert.deepEqual(extractLastKnownPrices('{oops'), {});
  assert.deepEqual(extractLastKnownPrices(null), {});

  const store = createMemoryStore();
  await saveLastKnownPrices(store, prices);
  await saveLastKnownPrices(
    store,
    extractLastKnownPrices(
      JSON.stringify({
        'sv3pt5-151:en': { cardId: 'sv3pt5-151', language: 'en', gbpAmount: 12, marketGbpAmount: 11 },
      }),
    ),
  );
  const stored = await loadLastKnownPrices(store);
  assert.deepEqual(Object.keys(stored).sort(), ['base1-4:en', 'sv3pt5-151:en']);
});

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
