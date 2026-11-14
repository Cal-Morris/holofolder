// Runs the real developer dispatcher over REST and MCP contexts with synthetic data modules (bun mocks are
// process-wide, so this runs in its own subprocess). All data here is synthetic.
import assert from 'node:assert/strict';
import type { OperationContext } from '../../lib/developer-api/types';
import type { CardPriceSnapshot } from '../../lib/card-pricing';

// oxlint-disable-next-line typescript/no-explicit-any -- synthetic JSON responses are walked loosely below.
type Json = Record<string, any>;

async function main() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://synthetic.supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-service-role';
  globalThis.fetch = async () => {
    throw new Error('no network in this fixture');
  };
  // @ts-expect-error Bun module mocks are isolated to this subprocess.
  const { mock } = await import('bun:test');
  mock.module('server-only', () => ({}));

  const card = (id: string) => ({ id, name: 'Synthetic', details: { id, attacks: ['synthetic'] } });
  const catalog = await import('../../lib/server/operations/catalog');
  mock.module('../../lib/server/operations/catalog', () => ({
    ...catalog,
    listCatalogCards: async (params: string) => {
      assert.doesNotMatch(params, /includeDetails/, 'include flags stay out of the cached query and cursor');
      return { data: [card('synthetic-1')], nextCursor: null, correction: null };
    },
    getCatalogCard: async (id: string) => card(id),
    getCatalogSimilarCards: async (id: string) => ({
      cardId: id,
      language: 'en',
      sameArtwork: [{ similarity: 0.9, card: card('synthetic-2') }],
      similarLook: [{ similarity: 0.5, card: card('synthetic-3') }],
    }),
    suggestCatalogCards: async () => ({ language: 'en', cards: [card('synthetic-4')] }),
    getCatalogCardsByIds: async () => new Map(),
    listCatalogGroups: async () => ({ data: [], nextCursor: null }),
    getCatalogGroup: async (_kind: string, id: string) => ({
      id,
      game: 'pokemon',
      name_json: { en: 'Synthetic Set' },
      raw_json: { id, abbreviation: 'SYN', cards: [{ id: 'synthetic-1' }], supplementalSources: { other: {} } },
    }),
  }));

  const snapshot = (summary: boolean): CardPriceSnapshot => {
    const quote = (finish: 'normal' | 'holo') => ({
      cardId: 'synthetic-1',
      language: 'en' as const,
      finish,
      variantKey: finish,
      gbpAmount: 10,
      marketGbpAmount: 10,
      goodGbpAmount: null,
      lowGbpAmount: 9,
      highGbpAmount: 11,
      confidence: 'high' as const,
      sourcePrices: [],
      trendPoints: [
        {
          label: 'synthetic',
          source: 'tcgplayer' as const,
          gbpAmount: 10,
          originalAmount: 12,
          originalCurrency: 'USD' as const,
        },
      ],
      buySignal: null,
      originalAmount: 12,
      originalCurrency: 'USD' as const,
      source: 'tcgplayer' as const,
      variantLabel: null,
      updatedAt: '2026-11-01T00:00:00.000Z',
      fxDate: null,
    });
    return {
      ...quote('holo'),
      ...(summary ? {} : { historyPoints: [{ date: '2026-11-01', gbpAmount: 10 }] as never }),
      trendPoints: summary ? [] : quote('holo').trendPoints,
      fxDate: summary ? null : '2026-11-01',
      finishPrices: [quote('normal'), quote('holo')],
    } as CardPriceSnapshot;
  };
  const summaryReads: boolean[] = [];
  const pricing = await import('../../lib/card-pricing');
  mock.module('../../lib/card-pricing', () => ({
    ...pricing,
    loadSavedCardPrices: async (_lookups: unknown, options: { summary?: boolean } = {}) => {
      summaryReads.push(options.summary === true);
      return [snapshot(options.summary === true)];
    },
    refreshCardPriceLookups: async () => ({ prices: [snapshot(false)], refreshed: 1, cached: 0, unpriced: 0 }),
    loadDisplayFxRates: async () => ({ date: '2026-11-01', eurToGbp: 0.85, usdToGbp: 0.8 }),
  }));

  const check = (kind: 'asking' | 'sold') => ({
    summary: { kind, currency: 'GBP', count: 1, low: 10, median: 10, high: 10 },
    checkedAt: '2026-11-01T00:00:00.000Z',
    ...(kind === 'sold' ? { sales: [{ amount: 10 }] } : { listings: [{ amount: 10 }] }),
  });
  const priceChecks = await import('../../lib/server/card-price-checks');
  mock.module('../../lib/server/card-price-checks', () => ({
    ...priceChecks,
    loadCardPriceChecks: async () => ({ ebay: check('asking'), soldcomps: check('sold'), errors: {} }),
  }));

  let auditInput: Record<string, unknown> = {};
  const audit = await import('../../lib/server/operations/audit');
  mock.module('../../lib/server/operations/audit', () => ({
    ...audit,
    readCollectionAudit: async (_context: unknown, input: Record<string, unknown>, detail = false) => {
      auditInput = input;
      const event = {
        id: '1',
        action: 'synthetic',
        changes: [
          {
            table: 'inventory_items',
            id: 'item-1',
            before: { finish: 'normal', grade: null },
            after: { finish: 'holo', grade: null },
          },
          { table: 'binder_slots', id: 'slot-1', before: null, after: { target: 'synthetic-1' } },
        ],
      };
      return detail ? event : { data: [event], nextCursor: null };
    },
  }));

  const { executeDeveloperOperation } = await import('../../lib/server/operations/developer-dispatch');
  const context = (transport: 'rest' | 'mcp'): OperationContext => ({
    principal: { actorId: 'synthetic-actor', credentialId: 'synthetic-credential', transport, permissions: [] },
    ownerUserId: 'synthetic-owner',
    memberIds: [],
    requestId: 'synthetic-request',
  });
  const run = (transport: 'rest' | 'mcp', name: string, input: Record<string, unknown>) =>
    executeDeveloperOperation(context(transport), name, input) as Promise<Json>;

  // Catalog cards: details on by default for REST, off for MCP, either way when asked.
  for (const [transport, input, expected] of [
    ['rest', {}, true],
    ['mcp', {}, false],
    ['rest', { includeDetails: false }, false],
    ['mcp', { includeDetails: true }, true],
  ] as const) {
    const has = (value: Record<string, unknown>) => 'details' in value;
    assert.equal(has((await run(transport, 'list_cards', { ...input })).data[0]), expected, `list_cards ${transport}`);
    assert.equal(has(await run(transport, 'get_card', { id: 'synthetic-1', ...input })), expected);
    const similar = await run(transport, 'get_similar_cards', { id: 'synthetic-1', ...input });
    assert.equal(has(similar.sameArtwork[0].card), expected);
    assert.equal(has(similar.similarLook[0].card), expected);
    assert.equal(similar.sameArtwork[0].similarity, 0.9);
    assert.equal(
      has((await run(transport, 'suggest_cards', { cardIds: ['synthetic-1'], ...input })).cards[0]),
      expected,
    );
  }

  // Set/series detail: raw card list behind includeRaw.
  for (const name of ['get_set', 'get_series']) {
    const rest = await run('rest', name, { id: 'synthetic-set' }),
      mcp = await run('mcp', name, { id: 'synthetic-set' });
    assert.equal(rest.raw_json.cards.length, 1);
    assert.deepEqual(mcp.raw_json, { id: 'synthetic-set', abbreviation: 'SYN' });
    assert.equal((await run('mcp', name, { id: 'synthetic-set', includeRaw: true })).raw_json.cards.length, 1);
  }

  // Prices: history only when asked; MCP reads the summary columns.
  const cards = [{ cardId: 'synthetic-1' }];
  const restPrices = (await run('rest', 'get_prices', { cards })).prices[0];
  assert.ok(restPrices.historyPoints && restPrices.trendPoints.length && restPrices.finishPrices[0].trendPoints);
  const mcpPrices = (await run('mcp', 'get_prices', { cards })).prices[0];
  for (const key of ['historyPoints', 'trendPoints', 'buySignal', 'fxDate']) assert.equal(key in mcpPrices, false, key);
  assert.equal('trendPoints' in mcpPrices.finishPrices[0], false);
  assert.equal(mcpPrices.gbpAmount, 10);
  assert.ok((await run('mcp', 'get_prices', { cards, includeHistory: true })).prices[0].historyPoints);
  assert.deepEqual(summaryReads, [false, true, false]);
  // finish is honoured: only the quotes that price it.
  const holo = (await run('rest', 'get_prices', { cards: [{ cardId: 'synthetic-1', finish: 'holo' }] })).prices[0];
  assert.deepEqual(
    holo.finishPrices.map((quote: { finish: string }) => quote.finish),
    ['holo'],
  );
  const rarity = (await run('rest', 'get_prices', { cards: [{ cardId: 'synthetic-1', finish: 'illustration_rare' }] }))
    .prices[0];
  assert.deepEqual(
    rarity.finishPrices.map((quote: { finish: string }) => quote.finish),
    ['holo'],
  );

  const refreshed = await run('mcp', 'refresh_prices', { cards });
  assert.equal(refreshed.refreshed, 1);
  assert.equal('historyPoints' in refreshed.prices[0], false);
  assert.ok((await run('rest', 'refresh_prices', { cards })).prices[0].historyPoints);

  // check_deal: MCP gets the headline price only.
  const deal = { cardId: 'synthetic-1', askingPrice: 5, currency: 'GBP' };
  const restDeal = await run('rest', 'check_deal', deal);
  assert.ok(restDeal.price.historyPoints && restDeal.verdict);
  const mcpDeal = await run('mcp', 'check_deal', deal);
  assert.deepEqual(mcpDeal.price, { gbpAmount: 10, confidence: 'high', updatedAt: '2026-11-01T00:00:00.000Z' });
  assert.deepEqual(mcpDeal.verdict, restDeal.verdict, 'the verdict is the same; only the price is shorter');
  assert.ok((await run('mcp', 'check_deal', { ...deal, includeHistory: true })).price.historyPoints);

  // Price checks: items behind includeItems.
  for (const name of ['get_price_checks', 'refresh_price_checks']) {
    const input = { id: 'synthetic-1', source: 'ebay' };
    const rest = await run('rest', name, input),
      mcp = await run('mcp', name, input);
    assert.equal(rest.ebay.listings.length, 1);
    assert.equal(rest.soldcomps.sales.length, 1);
    assert.equal('listings' in mcp.ebay, false);
    assert.equal('sales' in mcp.soldcomps, false);
    assert.equal(mcp.ebay.summary.median, 10);
    assert.equal((await run('mcp', name, { ...input, includeItems: true })).ebay.listings.length, 1);
  }

  // Collection audit list: changes behind includeChanges, summarised otherwise; the detail read keeps them.
  const restAudit = (await run('rest', 'list_collection_audit', { limit: 10 })).data[0];
  assert.equal(restAudit.changes.length, 2);
  const mcpAudit = (await run('mcp', 'list_collection_audit', { limit: 10, includeChanges: false })).data[0];
  assert.equal('changes' in mcpAudit, false);
  assert.equal(mcpAudit.changeCount, 2);
  assert.deepEqual(mcpAudit.changedFields, ['finish', 'target']);
  assert.equal('includeChanges' in auditInput, false, 'the flag stays out of the audit query and cursor');
  assert.equal((await run('mcp', 'list_collection_audit', { includeChanges: true })).data[0].changes.length, 2);
  assert.equal((await run('mcp', 'get_collection_audit', { id: '1' })).changes.length, 2);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
