import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { selectTrackedPriceLookups } from '../lib/server/tracked-price-selection';
import { trackedPriceIdentity, trackedPriceRequests } from '../lib/tracked-price-identity';

// All IDs, identities and records below are synthetic; no database/provider access.
type Row = Record<string, unknown>;
function fixtures() {
  return {
    inventory_owner_state: [{ owner_user_id: 'owner', inventory_revision: 3 }],
    storage_collection_state: [{ collection_id: 'native', owner_user_id: 'owner', version: 2, layout_revision: 1 }],
    binders: [{ id: 'native', owner_user_id: 'owner' }],
    pokemon_collection: [
      {
        id: 'frozen',
        user_id: 'owner',
        binder_id: 'native',
        card_id: 'stale',
        card_language: 'en',
        card_finish: null,
        wanted_cards: [],
      },
    ],
    inventory_items: [
      {
        id: 'unassigned-trainer',
        owner_user_id: 'owner',
        identity: { kind: 'card', cardId: 'trainer', language: 'ja', finish: 'holo' },
      },
      {
        id: 'copy-two',
        owner_user_id: 'owner',
        identity: { kind: 'card', cardId: 'trainer', language: 'ja', finish: 'reverse_holo' },
      },
      { id: 'unknown', owner_user_id: 'owner', identity: { kind: 'card', cardId: 'no-language' } },
      { id: 'species', owner_user_id: 'owner', identity: { kind: 'pokemon', pokemonId: 1 } },
    ],
    binder_slots: [
      {
        id: 'empty-target',
        target: { kind: 'card', cardId: 'not-an-owned-or-wanted-card' },
        owner_user_id: 'owner',
        collection_id: 'native',
        wanted_cards: [],
      },
      {
        id: 'want',
        owner_user_id: 'owner',
        collection_id: 'native',
        wanted_cards: [{ card_id: 'energy', card_language: 'de', card_finish: 'normal' }],
      },
    ],
  } as Record<string, Row[]>;
}
interface Call {
  table: string;
  projection: string;
  options: unknown;
  filters: [string, unknown][];
  from: number;
  to: number;
  key: string;
}
interface RpcResult {
  data: unknown;
  error: { code: string } | null;
}
/** The 128 function over the synthetic slots: distinct wants, null keys stripped, as one array. */
function wantIdentities(data: Record<string, Row[]>, owner: string | null) {
  const out = new Map<string, Row>();
  for (const slot of data.binder_slots ?? []) {
    if (owner !== null && slot.owner_user_id !== owner) continue;
    for (const want of slot.wanted_cards as Row[]) {
      const identity = Object.fromEntries(
        ['card_id', 'card_language', 'card_finish'].flatMap((k) => (want?.[k] == null ? [] : [[k, want[k]]])),
      );
      out.set(JSON.stringify(identity), identity);
    }
  }
  return [...out.values()];
}
function database(
  data = fixtures(),
  alter?: (call: Call, result: { data: Row[] | null; count: number | null; error: { code: string } | null }) => void,
  rpc: (owner: string | null) => RpcResult = (owner) => ({ data: wantIdentities(data, owner), error: null }),
) {
  const calls: Call[] = [];
  const rpcs: unknown[] = [];
  const sorted = new Map<string, Row[]>();
  const client = {
    rpc(name: string, args: { p_owner: string | null }) {
      assert.equal(name, 'tracked_price_want_identities_v1');
      return {
        async abortSignal(signal: AbortSignal) {
          assert.equal(signal.aborted, false);
          rpcs.push(args);
          return rpc(args.p_owner);
        },
      };
    },
    from(table: string) {
      const call: Call = { table, projection: '', options: undefined, filters: [], from: 0, to: 0, key: '' };
      const builder = {
        select(projection: string, options: unknown) {
          call.projection = projection;
          call.options = options;
          return builder;
        },
        order(key: string) {
          call.key = key;
          return builder;
        },
        range(from: number, to: number) {
          call.from = from;
          call.to = to;
          return builder;
        },
        eq(key: string, value: unknown) {
          call.filters.push([key, value]);
          return builder;
        },
        async abortSignal(signal: AbortSignal) {
          assert.equal(signal.aborted, false);
          calls.push(call);
          const cacheKey = JSON.stringify([table, call.filters, call.key]);
          if (!sorted.has(cacheKey))
            sorted.set(
              cacheKey,
              (data[table] ?? [])
                .filter((r) => call.filters.every(([k, v]) => r[k] === v))
                .sort((a, b) => String(a[call.key]).localeCompare(String(b[call.key]))),
            );
          const rows = sorted.get(cacheKey)!;
          const result = {
            data: rows
              .slice(call.from, call.to + 1)
              .map((r) => Object.fromEntries(call.projection.split(',').map((k) => [k, r[k]]))),
            count: (call.options as { count?: string } | undefined)?.count === 'exact' ? rows.length : null,
            error: null,
          } as { data: Row[] | null; count: number | null; error: { code: string } | null };
          alter?.(call, result);
          return result;
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, calls, rpcs };
}
const missing = (): RpcResult => ({ data: null, error: { code: 'PGRST202' } });

describe('tracked price selection', () => {
  test('includes Unassigned/non-Pokémon copies and explicit wants, never frozen legacy rows or empty targets, and deduplicates transport', async () => {
    for (const rpc of [undefined, missing]) {
      const db = database(fixtures(), undefined, rpc);
      assert.deepEqual(await selectTrackedPriceLookups(db.client, 'owner'), [
        { cardId: 'trainer', language: 'ja' },
        { cardId: 'energy', language: 'de' },
      ]);
      for (const call of db.calls) {
        assert.deepEqual(call.filters, [['owner_user_id', 'owner']]);
        assert.equal(call.to - call.from, 499);
      }
      assert.deepEqual(db.rpcs, [{ p_owner: 'owner' }]);
      assert.ok(!db.calls.some((c) => c.table === 'inventory_placements' || c.table === 'pokemon_collection'));
      assert.deepEqual(await selectTrackedPriceLookups(database(fixtures(), undefined, rpc).client, 'empty-owner'), []);
    }
  });
  test('reads wants through the distinct-identity function, without slot rows or collection metadata', async () => {
    const db = database();
    await selectTrackedPriceLookups(db.client, null);
    assert.deepEqual(
      db.calls.map((c) => [c.table, c.projection, c.key]),
      [['inventory_items', 'id,owner_user_id,identity', 'id']],
    );
    assert.deepEqual(db.rpcs, [{ p_owner: null }]);
  });
  test('pages every stream beyond 1000, counting once, including lifetime copies and duplicate quote identities', async () => {
    const data = fixtures();
    data.inventory_items = Array.from({ length: 1201 }, (_, i) => ({
      id: `copy-${String(i).padStart(4, '0')}`,
      owner_user_id: 'owner',
      identity: { kind: 'card', cardId: `card-${i % 1001}`, language: 'en' },
    }));
    data.binder_slots = Array.from({ length: 1201 }, (_, i) => ({
      id: `slot-${i}`,
      owner_user_id: 'owner',
      collection_id: 'native',
      wanted_cards: [],
    }));
    const db = database(data, undefined, missing);
    assert.equal((await selectTrackedPriceLookups(db.client, null)).length, 1001);
    for (const table of ['inventory_items', 'binder_slots']) {
      const calls = db.calls.filter((c) => c.table === table);
      assert.deepEqual(
        calls.map((c) => [c.from, c.options]),
        [
          [0, { count: 'exact' }],
          [500, undefined],
          [1000, undefined],
        ],
      );
    }
    assert.ok(db.calls.every((c) => c.filters.length === 0));
  });
  test('falls back to slot rows only when the function is missing, projecting only selector columns', async () => {
    const db = database(fixtures(), undefined, missing);
    await selectTrackedPriceLookups(db.client, 'owner');
    const expected: Record<string, [string, string]> = {
      inventory_items: ['id,owner_user_id,identity', 'id'],
      binder_slots: ['id,owner_user_id,wanted_cards', 'id'],
    };
    assert.deepEqual(db.calls.map((c) => c.table).sort(), ['binder_slots', 'inventory_items']);
    for (const c of db.calls) assert.deepEqual([c.projection, c.key], expected[c.table]);
    for (const code of ['42501', 'PGRST301', 'NETWORK'])
      await assert.rejects(
        selectTrackedPriceLookups(
          database(fixtures(), undefined, () => ({ data: null, error: { code } })).client,
          'owner',
        ),
      );
    await assert.rejects(
      selectTrackedPriceLookups(database(fixtures(), undefined, () => ({ data: {}, error: null })).client, 'owner'),
    );
  });
  test('isolates owner', async () => {
    const data = fixtures();
    data.inventory_items.push({
      id: 'private-other',
      owner_user_id: 'other',
      identity: { kind: 'card', cardId: 'private', language: 'en' },
    });
    data.binder_slots.push({
      id: 'other-want',
      owner_user_id: 'other',
      collection_id: 'other-binder',
      wanted_cards: [{ card_id: 'private-want', card_language: 'en' }],
    });
    for (const rpc of [undefined, missing]) {
      const lookups = await selectTrackedPriceLookups(database(data, undefined, rpc).client, 'owner');
      assert.ok(!lookups.some((x) => x.cardId === 'private' || x.cardId === 'private-want'));
    }
  });
  test('any read error fails closed, including missing tables', async () => {
    for (const code of ['42P01', 'PGRST205', '42501', '42703', 'NETWORK']) {
      for (const table of ['inventory_items', 'binder_slots'])
        await assert.rejects(
          selectTrackedPriceLookups(
            database(
              fixtures(),
              (c, r) => {
                if (c.table === table) r.error = { code };
              },
              missing,
            ).client,
            'owner',
          ),
        );
    }
  });
  test('root survives last collection deletion, retaining Unassigned', async () => {
    const data = fixtures();
    data.binders = [];
    data.storage_collection_state = [];
    data.binder_slots = [];
    for (const rpc of [undefined, missing])
      assert.deepEqual(await selectTrackedPriceLookups(database(data, undefined, rpc).client, 'owner'), [
        { cardId: 'trainer', language: 'ja' },
      ]);
  });
  test('rejects incomplete/malformed pages, duplicates and wants', async () => {
    for (const alter of [
      (_c: Call, r: { data: Row[] | null }) => {
        r.data = null;
      },
      (_c: Call, r: { data: Row[] | null }) => {
        delete r.data![0].owner_user_id;
      },
      (c: Call, r: { count: number | null }) => {
        if (c.from === 0) r.count = null;
      },
      (c: Call, r: { count: number | null }) => {
        if (c.from === 0) r.count = (r.count ?? 0) + 1;
      },
    ])
      await assert.rejects(selectTrackedPriceLookups(database(fixtures(), alter).client, 'owner'));
    for (const [mutate, rpc] of [
      [
        (d: Record<string, Row[]>) => {
          d.inventory_items.push(d.inventory_items[0]);
        },
        undefined,
      ],
      [
        (d: Record<string, Row[]>) => {
          d.binder_slots[0].wanted_cards = {};
        },
        missing,
      ],
      [
        (d: Record<string, Row[]>) => {
          d.binder_slots[0].wanted_cards = [null];
        },
        missing,
      ],
      [
        (d: Record<string, Row[]>) => {
          d.binder_slots[0].wanted_cards = [{ card_id: 'bad', card_language: 'zz' }];
        },
        undefined,
      ],
      [
        (d: Record<string, Row[]>) => {
          d.inventory_items[0].identity = { kind: 'card', cardId: 'bad', language: 'zz' };
        },
        undefined,
      ],
    ] as const) {
      const data = fixtures();
      mutate(data);
      await assert.rejects(selectTrackedPriceLookups(database(data, undefined, rpc).client, 'owner'));
    }
    await assert.rejects(
      selectTrackedPriceLookups(database(fixtures(), undefined, () => ({ data: [null], error: null })).client, 'owner'),
    );
  });
  test('rejects oversized reads and cross-owner responses despite query filters', async () => {
    await assert.rejects(
      selectTrackedPriceLookups(
        database(fixtures(), (c, r) => {
          if (c.table === 'inventory_items')
            r.data![0].identity = { kind: 'card', cardId: 'x'.repeat(33 * 1024 * 1024) };
        }).client,
        'owner',
      ),
    );
    await assert.rejects(
      selectTrackedPriceLookups(
        database(fixtures(), undefined, () => ({
          data: [{ card_id: 'x'.repeat(33 * 1024 * 1024), card_language: 'en' }],
          error: null,
        })).client,
        'owner',
      ),
    );
    await assert.rejects(
      selectTrackedPriceLookups(
        database(fixtures(), (c, r) => {
          if (c.table === 'inventory_items') r.data![0].owner_user_id = 'other';
        }).client,
        'owner',
      ),
    );
  });
  test('stops at request budget', async () => {
    const data = fixtures();
    data.inventory_items = Array.from({ length: 256001 }, (_, i) => ({
      id: `copy-${i}`,
      owner_user_id: 'owner',
      identity: { kind: 'card', cardId: 'copy', language: 'en' },
    }));
    const db = database(data);
    await assert.rejects(selectTrackedPriceLookups(db.client, 'owner'));
    assert.equal(db.calls.length, 512);
  });
});

describe('tracked identity contract', () => {
  test('preserves exact IDs and known finishes, deduplicates by existing card/language key', () => {
    const identities = [
      trackedPriceIdentity('set-1-stamped', ' JA ', 'holo')!,
      trackedPriceIdentity('set-1-stamped', 'ja', 'reverse_holo')!,
    ];
    assert.equal(identities[0].finish, 'holo');
    assert.deepEqual(trackedPriceRequests(identities), [{ cardId: 'set-1-stamped', language: 'ja' }]);
    assert.equal(trackedPriceIdentity('card', null, null), null);
    assert.throws(() => trackedPriceIdentity('card', 'zz', 'normal'));
    assert.throws(() => trackedPriceIdentity('card', 'en', 'foil'));
    assert.throws(() => trackedPriceIdentity(' ', 'en', null));
  });
});
