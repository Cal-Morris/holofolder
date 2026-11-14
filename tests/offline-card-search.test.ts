import test from 'node:test';
import assert from 'node:assert/strict';
import type { CollectedPokemon } from '../lib/domain/cards';
import {
  buildOfflineCardIndex,
  readOfflineSets,
  collectionToSearchCards,
  extractCardsFromCachedResponse,
  extractSetsFromCachedResponse,
  mergeSearchCards,
  searchOfflineCards,
  searchOfflineSets,
} from '../lib/offline-card-index';
import {
  inspectSavedShowSets,
  ESTIMATE_SAMPLE_SIZE,
  FALLBACK_THUMBNAIL_BYTES,
  downloadCardShowImages,
  downloadCardShowPrices,
  estimateCardShowBytes,
  formatBytes,
  getProxiedThumbnailUrl,
  getSetSlotsUrl,
  getSetThumbnailUrls,
  planCardShowPrep,
} from '../lib/card-show-prep';

const BASE = { id: 'base1', name: 'Base Set', officialCardCount: 102 };
const card = (id: string, name: string, localId: string, set = BASE) => ({
  id,
  localId,
  name,
  image: `https://assets.tcgdex.net/en/base/${set.id}/${localId}/high.webp`,
  set,
  rarity: 'Common',
  language: 'en' as const,
  inferredFinish: 'normal' as const,
});
const setSlots = {
  sets: [BASE],
  selectedSet: BASE,
  slots: [
    { dexId: 1, pokemonName: 'Bulbasaur', cards: [card('base1-44', 'Bulbasaur', '44')] },
    { dexId: 4, pokemonName: 'Charmander', cards: [card('base1-46', 'Charmander', '46')] },
  ],
};

const charmander: CollectedPokemon = {
  id: 'row-4',
  pokemon_id: 4,
  pokemon_name: 'charmander',
  card_id: 'sv03.5-168',
  card_name: 'Charmander',
  card_set: '151',
  card_language: 'en',
  card_finish: 'holo',
  wanted_cards: [
    {
      card_id: 'swsh12pt5-001',
      card_name: 'Charmander',
      card_set: 'Crown Zenith',
      local_id: '001',
      added_at: '2026-10-01',
    },
  ],
  status: 'collected',
  collected_at: '2026-10-01',
};

test('cached set coverage, per-Pokémon lists and earlier searches all become searchable cards', () => {
  const fromSet = extractCardsFromCachedResponse('http://x/app/api/tcg-set-slots?query=Base+Set&setId=base1', setSlots);
  assert.deepEqual(
    fromSet.map((entry) => [entry.id, entry.dexIds]),
    [
      ['base1-44', [1]],
      ['base1-46', [4]],
    ],
  );

  const fromPokemon = extractCardsFromCachedResponse('/app/api/tcgdex-cache?pokemonId=6&language=en', {
    cards: [card('sv03.5-006', 'Charizard ex', '006', { id: 'sv03.5', name: '151', officialCardCount: 165 })],
  });
  assert.deepEqual(fromPokemon[0].dexIds, [6]);

  const fromSearch = extractCardsFromCachedResponse('/app/api/tcg-card-search?q=pika', {
    cards: [
      { ...card('base1-58', 'Pikachu', '58'), dexIds: [25] },
      { ...card('x-1', 'No dex', '1'), dexIds: [] },
    ],
  });
  assert.deepEqual(
    fromSearch.map((entry) => entry.id),
    ['base1-58', 'x-1'],
  );
  assert.deepEqual(fromSearch[1].dexIds, []);

  assert.deepEqual(
    extractCardsFromCachedResponse('/app/api/tcgdex-cache?pokemonId=0', { cards: [card('a-1', 'A', '1')] }),
    [],
  );
  assert.deepEqual(extractCardsFromCachedResponse('/app/api/other', setSlots), []);
  assert.deepEqual(
    extractSetsFromCachedResponse('/app/api/tcg-set-slots?recent=1', setSlots).map((set) => set.id),
    ['base1', 'base1'],
  );
});

test("the user's owned and wanted printings are searchable with set ids and numbers", () => {
  const cards = collectionToSearchCards([charmander]);
  assert.deepEqual(
    cards.map((entry) => [entry.id, entry.set.id, entry.localId, entry.set.name]),
    [
      ['sv03.5-168', 'sv03.5', '168', '151'],
      ['swsh12pt5-001', 'swsh12pt5', '001', 'Crown Zenith'],
    ],
  );
  assert.deepEqual(collectionToSearchCards([{ ...charmander, status: 'wishlisted', wanted_cards: [] }]), []);
});

test("offline search follows the server's rules: name, set name, set id, number, card id", () => {
  const index = mergeSearchCards([
    collectionToSearchCards([charmander]),
    extractCardsFromCachedResponse('/app/api/tcg-set-slots?setId=base1', setSlots),
  ]);
  const ids = (query: string) => searchOfflineCards(index, query).map((entry) => entry.id);
  assert.deepEqual(ids('charm'), ['sv03.5-168', 'swsh12pt5-001', 'base1-46']);
  assert.deepEqual(ids('charmander 46/102'), ['base1-46']);
  assert.deepEqual(ids('charmander 168'), ['sv03.5-168']);
  assert.deepEqual(ids('base set'), ['base1-44', 'base1-46']);
  assert.deepEqual(ids('base1'), ['base1-44', 'base1-46']);
  assert.deepEqual(ids('base1-44'), ['base1-44']);
  assert.deepEqual(ids('crown zenith'), ['swsh12pt5-001']);
  assert.deepEqual(ids('mewtwo'), []);
});

test('duplicates across sources are merged and keep every Pokémon', () => {
  const merged = mergeSearchCards([
    [{ ...card('a-1', 'Nidoran', '1'), dexIds: [29] }],
    [{ ...card('a-1', 'Nidoran', '1'), dexIds: [32] }],
  ]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].dexIds, [29, 32]);
});

test('saved sets can be found offline by name or id', () => {
  const sets = [BASE, { id: 'sv03.5', name: '151' }, BASE];
  assert.deepEqual(
    searchOfflineSets(sets, 'base').map((set) => set.id),
    ['base1'],
  );
  assert.deepEqual(searchOfflineSets(sets, 'sv03'), [{ id: 'sv03.5', name: '151' }]);
  assert.deepEqual(searchOfflineSets(sets, 'b'), []);
});

test("the index reads JSON card data from the service worker's data caches only", async () => {
  const responses = new Map<string, unknown>([
    ['http://x/app/api/tcg-set-slots?setId=base1', setSlots],
    ['http://x/app/api/card-prices', { prices: [] }],
  ]);
  const fakeCaches = {
    keys: async () => ['binderdex-v3-data', 'binderdex-v3-images'],
    open: async (name: string) => ({
      keys: async () =>
        name.endsWith('-data')
          ? [...responses.keys()].map((url) => ({ url }))
          : [{ url: 'http://x/app/api/tcg-set-slots?setId=evil' }],
      match: async (request: { url: string }) => new Response(JSON.stringify(responses.get(request.url))),
    }),
  } as unknown as CacheStorage;
  const index = await buildOfflineCardIndex([charmander], fakeCaches);
  assert.deepEqual(index.map((entry) => entry.id).sort(), ['base1-44', 'base1-46', 'sv03.5-168', 'swsh12pt5-001']);
});

test("card show prep uses the Sets view's exact URLs and proxied low-res thumbnails", () => {
  assert.equal(getSetSlotsUrl(BASE), '/app/api/tcg-set-slots?query=Base+Set&setId=base1&v=2');
  assert.equal(
    getProxiedThumbnailUrl('https://assets.tcgdex.net/en/base/base1/44/high.webp'),
    `/app/api/card-image-proxy?url=${encodeURIComponent('https://assets.tcgdex.net/en/base/base1/44/low.webp')}`,
  );
  assert.equal(getProxiedThumbnailUrl('/app/api/card-image-proxy?url=x'), '/app/api/card-image-proxy?url=x');
  assert.equal(getProxiedThumbnailUrl('javascript:alert(1)'), null);
  assert.equal(getProxiedThumbnailUrl(undefined), null);
  assert.equal(getSetThumbnailUrls(setSlots).length, 2);
});

test('the size estimate uses measured samples, or a fallback per image', () => {
  assert.equal(estimateCardShowBytes(10, 1000, []), 1000 + 10 * FALLBACK_THUMBNAIL_BYTES);
  assert.equal(estimateCardShowBytes(10, 0, [10_000, 20_000]), 150_000);
  assert.equal(formatBytes(512), '1 KB');
  assert.equal(formatBytes(3.5 * 1024 * 1024), '3.5 MB');
  assert.equal(formatBytes(42 * 1024 * 1024), '42 MB');
});

test('planning downloads only set data and a few samples; downloading fetches the rest once', async () => {
  const many = {
    ...setSlots,
    slots: Array.from({ length: 10 }, (_, index) => ({
      dexId: index + 1,
      pokemonName: `P${index}`,
      cards: [card(`base1-${index}`, `P${index}`, String(index))],
    })),
  };
  const requested: string[] = [];
  const unmarkedImageRequests: string[] = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    requested.push(url);
    if (url.startsWith('/app/api/card-image-proxy') && new Headers(init?.headers).get('x-binderdex-save') !== 'show')
      unmarkedImageRequests.push(url);
    if (url.startsWith('/app/api/tcg-set-slots')) return new Response(JSON.stringify(many));
    return new Response(new Uint8Array(20_000));
  };

  const plan = await planCardShowPrep([BASE], { fetcher });
  assert.equal(plan.priceLookups.length, 10);
  assert.equal(plan.imageUrls.length, 10);
  assert.equal(requested.filter((url) => url.startsWith('/app/api/card-image-proxy')).length, ESTIMATE_SAMPLE_SIZE);
  assert.equal(plan.estimatedBytes, plan.dataBytes + 10 * 20_000);

  const updates: number[] = [];
  const result = await downloadCardShowImages(plan, { fetcher, onProgress: (progress) => updates.push(progress.done) });
  assert.deepEqual(result, { done: 10, total: 10, failed: 0 });
  const imageRequests = requested.filter((url) => url.startsWith('/app/api/card-image-proxy'));
  assert.equal(imageRequests.length, 10);
  assert.equal(new Set(imageRequests).size, 10, 'each image fetched exactly once');
  assert.equal(updates.at(-1), 10);
  assert.deepEqual(unmarkedImageRequests, [], 'every thumbnail is marked so the service worker keeps it for the show');
});

test('card show prep saves price batches and reports unknown cards without inventing prices', async () => {
  const saved: unknown[][] = [];
  const requested: string[] = [];
  const lookups = Array.from({ length: 26 }, (_, i) => ({ cardId: `fixture-${i}`, language: 'en' as const }));
  const result = await downloadCardShowPrices(
    { priceLookups: lookups },
    {
      savePrices: (prices) => {
        saved.push(prices);
      },
      fetcher: async (url, init) => {
        requested.push(url);
        assert.notEqual(init?.method, 'POST');
        const cards = JSON.parse(new URL(url, 'https://fixture.test').searchParams.get('cards')!);
        return Response.json({
          prices: cards.map((card: { cardId: string; language: string }) => ({
            ...card,
            marketGbpAmount: card.cardId === 'fixture-0' ? null : 5,
          })),
        });
      },
    },
  );
  assert.equal(requested.length, 2);
  assert.equal(saved.flat().length, 26);
  assert.deepEqual(result, { done: 26, total: 26, priced: 25, failed: 0 });
});

test('card show prep cannot claim prices saved when the API or local storage failed', async () => {
  const plan = { priceLookups: [{ cardId: 'fixture-1', language: 'en' as const }] };
  assert.equal(
    (
      await downloadCardShowPrices(plan, {
        retryDelay: async () => {},
        savePrices: () => {},
        fetcher: async () => new Response('down', { status: 503 }),
      })
    ).failed,
    1,
  );
  await assert.rejects(
    downloadCardShowPrices(plan, {
      savePrices: () => {
        throw new Error('Storage full');
      },
      fetcher: async () => Response.json({ prices: [{ cardId: 'fixture-1', language: 'en' }] }),
    }),
    /Storage full/,
  );
});

test('card show preparation includes Trainer and Energy highlight thumbnails', () => {
  // Synthetic all-card payload, including a Trainer outside Pokémon dex slots.
  const payload = {
    ...setSlots,
    cards: [setSlots.slots[0].cards[0], card('synthetic-trainer', 'Trainer fixture', '99')],
  };
  assert.deepEqual(getSetThumbnailUrls(payload), [
    '/app/api/card-image-proxy?url=https%3A%2F%2Fassets.tcgdex.net%2Fen%2Fbase%2Fbase1%2F44%2Flow.webp',
    '/app/api/card-image-proxy?url=https%3A%2F%2Fassets.tcgdex.net%2Fen%2Fbase%2Fbase1%2F99%2Flow.webp',
  ]);
});

test('offline search also finds cards by illustrator once the query is 3+ characters', () => {
  const cards = [
    { ...card('sv03.5-166', 'Bulbasaur', '166'), dexIds: [1], illustrator: 'Mitsuhiro Arita' },
    { ...card('sv03.5-004', 'Charmander', '4'), dexIds: [4], illustrator: '5ban Graphics' },
  ];
  assert.deepEqual(
    searchOfflineCards(cards, 'arita').map((c) => c.id),
    ['sv03.5-166'],
  );
  assert.deepEqual(
    searchOfflineCards(cards, '5ban').map((c) => c.id),
    ['sv03.5-004'],
  );
  assert.deepEqual(
    searchOfflineCards(cards, 'ar')
      .map((c) => c.id)
      .includes('sv03.5-166'),
    false,
  );
});

test('offline set search reads only set responses and sees later cache updates', async () => {
  // Synthetic unrelated card responses must not consume the set reader's 600-response budget.
  const responses = new Map<string, unknown>(
    Array.from({ length: 600 }, (_, i) => [`http://x/app/api/tcgdex-cache?pokemonId=${i + 1}`, { cards: [] }]),
  );
  const setUrl = 'http://x/app/api/tcg-set-slots?query=base';
  responses.set(setUrl, { sets: [BASE] });
  const reads: string[] = [];
  const fakeCaches = {
    keys: async () => ['binderdex-v4-data', 'binderdex-v3-images'],
    open: async (name: string) => {
      assert.equal(name, 'binderdex-v4-data');
      return {
        keys: async () => [...responses.keys()].map((url) => ({ url })),
        match: async (request: { url: string }) => {
          reads.push(request.url);
          return new Response(JSON.stringify(responses.get(request.url)));
        },
      };
    },
  } as unknown as CacheStorage;
  assert.deepEqual(await readOfflineSets(fakeCaches), [BASE]);
  assert.deepEqual(reads, [setUrl]);
  responses.set(setUrl, { sets: [{ id: 'synthetic-new', name: 'Synthetic new set' }] });
  assert.deepEqual(await readOfflineSets(fakeCaches), [{ id: 'synthetic-new', name: 'Synthetic new set' }]);
  assert.deepEqual(reads, [setUrl, setUrl]);
});

test('failed estimate samples are retried and failed bodies never count as saved images', async () => {
  const attempts = new Map<string, number>();
  const fetcher = async (url: string) => {
    if (url.startsWith('/app/api/tcg-set-slots')) return Response.json(setSlots);
    const count = (attempts.get(url) ?? 0) + 1;
    attempts.set(url, count);
    return new Response('image', { status: count === 1 ? 503 : 200 });
  };
  const plan = await planCardShowPrep([BASE], { fetcher });
  assert.equal(plan.sampledImageUrls?.length, 2);
  const result = await downloadCardShowImages(plan, { fetcher });
  assert.equal(result.failed, 0);
  assert.equal(result.done, plan.imageUrls.length);
  assert.ok([...attempts.values()].every((count) => count === 2));
  const failed = await downloadCardShowImages(
    { imageUrls: ['/broken'] },
    {
      fetcher: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error('truncated'));
            },
          }),
        ),
    },
  );
  assert.deepEqual(failed, { done: 1, total: 1, failed: 1 });
});

test('stopping image preparation does not start remaining downloads', async () => {
  const controller = new AbortController();
  let calls = 0;
  const result = await downloadCardShowImages(
    { imageUrls: ['/one', '/two', '/three'] },
    {
      signal: controller.signal,
      concurrency: 1,
      fetcher: async () => {
        calls++;
        controller.abort();
        throw new Error('aborted');
      },
    },
  );
  assert.equal(calls, 1);
  assert.deepEqual(result, { done: 0, total: 3, failed: 0 });
});

test('saved summary inspects current caches and positive stored prices, including eviction', async () => {
  const imageUrls = getSetThumbnailUrls(setSlots);
  const imageKeys = imageUrls.map((url) => new Request(new URL(url, 'https://fixture.test')));
  const request = new Request(`https://fixture.test${getSetSlotsUrl(BASE)}`);
  const storage = {
    keys: async () => ['binderdex-v4-data', 'binderdex-v1-show-images'],
    open: async (name: string) => ({
      keys: async () => (name.endsWith('-data') ? [request] : imageKeys),
      match: async () => Response.json({ ...setSlots, selectedSet: BASE }),
    }),
  } as unknown as CacheStorage;
  const options = {
    cacheStorage: storage,
    loadPrices: async () => [{ marketGbpAmount: 5 }, { marketGbpAmount: 0 }, { marketGbpAmount: -1 }],
  };
  const before = await inspectSavedShowSets(options);
  assert.equal(before[0].images, imageUrls.length);
  assert.equal(before[0].priced, 1);
  imageKeys.pop();
  const after = await inspectSavedShowSets(options);
  assert.equal(after[0].images, imageUrls.length - 1);
  assert.equal(after[0].imageTotal, imageUrls.length);
});

test('offline index keeps separate language printings of the same card', () => {
  const english = { ...card('base1-44', 'Bulbasaur', '44'), dexIds: [1] };
  const japanese = { ...english, language: 'ja', name: 'Japanese Bulbasaur' };
  assert.equal(mergeSearchCards([[english, japanese]]).length, 2);
});

test('offline search resolves exact stamped identities without parsing away their suffix', () => {
  const stamped = { ...card('base1-4-stamped', 'Synthetic stamped card', '4'), dexIds: [1] };
  assert.deepEqual(searchOfflineCards([stamped], 'base1-4-stamped'), [stamped]);
});

test('show image resume skips durably saved files and awaits each cache write', async () => {
  const saved = new Map<string, Response>();
  saved.set('/one', new Response('synthetic image', { headers: { 'Content-Type': 'image/webp' } }));
  const cache = {
    match: async (key: string) => saved.get(key)?.clone(),
    put: async (key: string, value: Response) => {
      saved.set(key, value.clone());
    },
  } as unknown as Cache;
  const calls: string[] = [];
  const result = await downloadCardShowImages(
    { imageUrls: ['/one', '/two'] },
    {
      cache,
      fetcher: async (url) => {
        calls.push(url);
        return new Response('synthetic image', { headers: { 'Content-Type': 'image/webp' } });
      },
    },
  );
  assert.deepEqual(calls, ['/two']);
  assert.equal(saved.size, 2);
  assert.equal(result.failed, 0);
});

test('a word that partly names a set falls back to card names when the set has no match', () => {
  // Synthetic cards: a set whose name holds "Pikachu", and a promo named after the Pokémon elsewhere.
  const detective = { id: 'det1', name: 'Detective Pikachu' };
  const promos = { id: 'jp-xy-promos', name: 'XY-P: XY Promos' };
  const cards = [
    { id: 'det1-1', name: 'Detective Pikachu', localId: '1', set: detective, dexIds: [25] },
    { id: 'tcgplayer-1', name: 'Mario Pikachu', localId: '294', set: promos, dexIds: [25] },
  ];
  assert.deepEqual(
    searchOfflineCards(cards, 'mario pikachu').map((card) => card.id),
    ['tcgplayer-1'],
  );
});
