import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSavedInventoryPrices, SAVED_INVENTORY_PRICE_CONCURRENCY } from '@/hooks/use-inventory-prices';
import { inventoryProjectionPrices } from './fixtures/inventory-browse';

test('saved inventory reader fetches distinct identities once, GET only, summary fields, <=100 per group, a few in flight', async () => {
  const sizes: number[] = [];
  let inFlight = 0,
    peak = 0;
  const requests = Array.from({ length: 655 }, (_, i) => ({ cardId: `synthetic-${i}`, language: 'en' as const }));
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input), 'https://synthetic.invalid');
    assert.equal(url.pathname, '/app/api/card-prices');
    assert.equal(url.searchParams.get('fields'), 'summary');
    assert.equal(init?.method, undefined);
    assert.equal(init?.cache, 'no-store');
    const cards = JSON.parse(url.searchParams.get('cards')!);
    sizes.push(cards.length);
    peak = Math.max(peak, ++inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight--;
    return Response.json({
      prices: cards.map((card: object) => ({ ...inventoryProjectionPrices()[0], ...card, historyPoints: undefined })),
    });
  };
  const result = await readSavedInventoryPrices([...requests, ...requests], new AbortController().signal, fetcher);
  assert.equal(result.length, 655);
  assert.deepEqual(sizes, [100, 100, 100, 100, 100, 100, 55]);
  assert.equal(peak, SAVED_INVENTORY_PRICE_CONCURRENCY);
});

test('a failed, malformed, duplicate or unrelated group leaves only its own cards unpriced (#570)', async () => {
  const requests = Array.from({ length: 300 }, (_, i) => ({ cardId: `synthetic-${i}`, language: 'en' as const }));
  const quote = (card: object) => ({ ...inventoryProjectionPrices()[0], ...card });
  for (const bad of [
    () => new Response('', { status: 503 }),
    () => Response.json({}),
    (cards: object[]) => Response.json({ prices: [...cards.map(quote), quote({ cardId: 'foreign' })] }),
    (cards: object[]) => Response.json({ prices: [...cards.map(quote), quote({ language: null })] }),
    (cards: object[]) => Response.json({ prices: [...cards.map(quote), ...cards.slice(0, 1).map(quote)] }),
    () => {
      throw new TypeError('synthetic network failure');
    },
  ]) {
    const fetcher: typeof fetch = async (input) => {
      const cards = JSON.parse(new URL(String(input), 'https://synthetic.invalid').searchParams.get('cards')!);
      return cards[0].cardId === 'synthetic-100' ? bad(cards) : Response.json({ prices: cards.map(quote) });
    };
    const original = console.error;
    console.error = () => {};
    try {
      const result = await readSavedInventoryPrices(requests, new AbortController().signal, fetcher);
      assert.equal(result.length, 200);
      assert.ok(!result.some((price) => ['synthetic-100', 'synthetic-199'].includes(price.cardId)));
    } finally {
      console.error = original;
    }
  }
  assert.deepEqual(
    await readSavedInventoryPrices(requests.slice(0, 1), new AbortController().signal, async () =>
      Response.json({ prices: [] }),
    ),
    [],
  );
});

test('an aborted read rejects instead of returning a partial set', async () => {
  const controller = new AbortController();
  const fetcher: typeof fetch = async (_input, init) => {
    controller.abort();
    init?.signal?.throwIfAborted();
    return Response.json({ prices: [] });
  };
  await assert.rejects(
    readSavedInventoryPrices([{ cardId: 'synthetic-1', language: 'en' }], controller.signal, fetcher),
  );
});

test('saved native finish evidence never defaults a missing nested identity to English', async () => {
  const root = inventoryProjectionPrices()[0];
  const finish = { ...root, finish: 'normal', variantKey: 'normal', gbpAmount: 100 };
  const requests = [{ cardId: root.cardId, language: root.language }];
  const prices = await readSavedInventoryPrices(requests, new AbortController().signal, async () =>
    Response.json({
      prices: [{ ...root, finishPrices: [finish, { ...finish, language: undefined }, { ...finish, cardId: 'other' }] }],
    }),
  );
  assert.equal(prices[0].finishPrices?.length, 1);
  assert.equal(prices[0].finishPrices?.[0].cardId, root.cardId);
});
