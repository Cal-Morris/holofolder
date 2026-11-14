import assert from 'node:assert/strict';
import { loadPriceCheckSubject } from '../../lib/server/ebay-listings';
import { loadCardPriceChecks } from '../../lib/server/card-price-checks';
import { summarizeSoldComps } from '../../lib/sold-comps';
import { matchesPriceCheckTitle } from '../../lib/ebay-listings';

async function run() {
  // Real catalog identity; synthetic catalog rows, prices and provider responses. No network access.
  const id = 'mep-070~685563';
  let unsupported = false;
  let regular = false;
  let stamp = 'pokemon-center';
  let label = 'Pokémon Center';
  let productId = '685563';
  let ambiguousFinish = false;
  let missingFinishEvidence = false;
  const saved: Record<string, unknown> = {};
  let soldCalls = 0;
  let calls = 0;
  let paid = true;
  let limited = false;
  const accountBudgets: Array<{ budget_bucket: string; request_limit: number }> = [];
  for (const name of ['SUPABASE_SERVICE_ROLE_KEY', 'EBAY_CLIENT_ID', 'EBAY_CLIENT_SECRET', 'SOLDCOMPS_API_KEY'])
    process.env[name] = 'synthetic';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://synthetic.supabase.test';
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/rpc/consume_developer_budget')) {
      accountBudgets.push(JSON.parse(String(init?.body)));
      return Response.json({ allowed: !limited, retry_after: 23 });
    }
    if (url.pathname.endsWith('/rpc/get_billing_access'))
      return Response.json({ enforced: true, perpetual: paid, saved_card_count: 2 });
    if (url.pathname.endsWith('/rpc/billing_partner_allowed')) return Response.json(true);
    if (url.pathname.endsWith('/partnerships') && !url.searchParams.has('id') && !url.searchParams.has('owner_user_id'))
      return Response.json(null);

    if (url.pathname.includes('/tcg_cards')) {
      if (url.searchParams.get('select')?.startsWith('rawId:raw_json->id,'))
        return Response.json([
          {
            rawId: 'mep-070',
            variants_detailed: missingFinishEvidence
              ? []
              : [
                  {
                    type: 'holo',
                    size: 'standard',
                    stamp: [stamp],
                    variantId: 'synthetic-variant',
                    thirdParty: { tcgplayer: 685563 },
                  },
                  ...(ambiguousFinish
                    ? [{ type: 'normal', size: 'standard', stamp: [stamp], thirdParty: { tcgplayer: 123 } }]
                    : []),
                ],
          },
        ]);
      assert.equal(url.searchParams.get('id'), `eq.${regular ? 'mep-070' : id}`);
      return Response.json([
        {
          id: regular ? 'mep-070' : id,
          name_en: regular ? 'Tyrunt' : `Tyrunt (${label})`,
          local_id: regular ? '070' : '070~685563',
          set_id: 'mep',
          catalog: regular
            ? null
            : {
                localId: '070',
                tcgdexCardId: 'mep-070',
                variantId: 'synthetic-variant',
                productId,
                printingLabel: unsupported ? 'Unknown stamp' : label,
              },
          variant: {
            variantId: 'synthetic-variant',
            type: 'holo',
            size: 'standard',
            stamp: [unsupported ? 'unknown' : stamp],
            thirdParty: { tcgplayer: 685563 },
          },
          tcg_sets: { name_en: 'MEP Black Star Promos' },
        },
      ]);
    }
    if (url.pathname.includes('/rpc/claim_card_price_check')) {
      assert.equal(JSON.parse(String(init?.body)).p_card_id, id);
      return Response.json(true);
    }
    if (url.pathname.includes('/card_price_checks')) {
      if (url.searchParams.get('select') === 'source,result_json')
        return Response.json(
          Object.entries(saved).map(([source, result_json]) => ({ source: source.slice(3), result_json })),
        );
      assert.equal(url.searchParams.get('card_id'), `eq.${id}`);
      assert.equal(url.searchParams.get('finish'), 'eq.holo');
      const source = url.searchParams.get('source')!;
      if (init?.method === 'PATCH') {
        saved[source] = JSON.parse(String(init.body)).result_json;
        return new Response(null, { status: 204 });
      }
      return Response.json(saved[source] ? [{ result_json: saved[source] }] : []);
    }
    if (url.pathname.includes('/oauth2/token')) return Response.json({ access_token: 'synthetic', expires_in: 7200 });
    if (url.pathname.includes('/item_summary/search')) {
      calls++;
      assert.equal(url.searchParams.get('q'), 'Tyrunt 070 Pokémon Center');
      return Response.json({
        itemSummaries: [
          'Tyrunt (Pokemon Center Exclusive) #070 Holo Pokémon ME: Mega Evolution Promo NM',
          'Pokémon TCG Tyrunt MEP070 Pokémon Center Stamped Black Star Promo NM',
          'Tyrunt 070 MEP Holo',
        ].map((title, i) => ({
          itemId: `synthetic-${i}`,
          title,
          price: { value: i === 2 ? '1' : '12', currency: 'GBP' },
          itemLocation: { country: 'GB' },
          buyingOptions: ['FIXED_PRICE'],
        })),
      });
    }
    if (url.hostname === 'www.soldcomps.io') {
      soldCalls++;
      assert.equal(url.searchParams.get('q'), 'Tyrunt 070 Pokémon Center');
      return Response.json({
        items: [
          {
            item_id: 'synthetic-sale',
            title: 'Pokémon TCG Tyrunt MEP070 Pokémon Center Stamped Black Star Promo NM',
            sold_price: { value: 12, currency: 'GBP' },
            sold_at: new Date().toISOString().slice(0, 10),
            best_offer_price_known: true,
            best_offer_accepted: false,
            flags: [],
          },
        ],
      });
    }
    throw new Error(`Unexpected request ${url.pathname}`);
  }) as typeof fetch;

  // Bun module mocks are confined to this subprocess; the application uses node:test.
  // @ts-expect-error Bun test types are not part of the application's TypeScript environment.
  const { mock } = await import('bun:test');
  mock.module('next/cache', () => ({ cacheLife: () => {} }));
  mock.module('../../lib/supabase/server', () => ({
    createClient: async () => ({
      from: () => ({
        select() {
          return this;
        },
        or() {
          return this;
        },
        limit() {
          return this;
        },
        maybeSingle: async () => ({ data: null, error: null }),
      }),
      auth: { getUser: async () => ({ data: { user: { id: 'synthetic' } } }) },
    }),
  }));
  mock.module('../../lib/supabase/session-user', () => ({
    getFirstPartyUser: async (client: { auth: { getUser: () => Promise<unknown> } }) => client.auth.getUser(),
    getSessionUser: async () => ({ id: 'synthetic' }),
  }));
  const routes = await import('../../app/api/card-price-checks/route');
  const legacy = await import('../../app/api/ebay/listings/route');
  const request = (cardId: string, finish = 'holo') =>
    new Request(`https://synthetic.test/app/api/card-price-checks?${new URLSearchParams({ cardId, finish })}`);
  assert.equal((await routes.GET(request(id))).status, 200);
  limited = true;
  for (const handler of [routes.GET, routes.POST, legacy.GET]) {
    const response = await handler(request(id));
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('Retry-After'), '23');
  }
  assert.ok(accountBudgets.some((row) => row.budget_bucket.endsWith(':write') && row.request_limit === 20));
  assert.ok(accountBudgets.some((row) => row.budget_bucket.endsWith(':read') && row.request_limit === 60));
  limited = false;

  for (const handler of [routes.GET, routes.POST, legacy.GET]) {
    for (const bad of ['', '../card', 'a/b', 'a?b', 'a~', 'a~~123', 'a:123', 'a~123~456', 'x'.repeat(101)])
      assert.equal((await handler(request(bad))).status, 400, bad);
    assert.equal((await handler(request(id, 'invalid'))).status, 400);
  }
  const lookup = await loadPriceCheckSubject(id, 'holo');
  assert.ok(lookup, 'supported catalog printing must load');
  assert.equal(lookup.subject.cardId, id);
  assert.equal(lookup.subject.localId, '070');
  assert.equal(matchesPriceCheckTitle(lookup.subject, 'Tyrunt 070 Pokémon Center MEP Holo'), true);
  for (const title of [
    'Tyrunt 070 MEP Holo',
    'Tyrunt 070 GameStop MEP Holo',
    'Tyrunt 070 Pokemon Center Staff MEP Holo',
    'Tyrunt 070 Pokemon Center MEP Holo lot',
    'Tyrunt 070 Pokemon Center MEP Holo PSA 10',
    'Tyrunt 070 Pokemon Center MEP Reverse Holo',
    'Tyrunt 071 Pokemon Center MEP Holo',
    'Tyrunt 070 Pokemon Center Holo',
    'Tyrunt 070 non Pokemon Center MEP Holo',
  ]) {
    assert.equal(matchesPriceCheckTitle(lookup.subject, title), false, title);
  }
  // Public title formats supplied by the reproduction; amounts and provider records are synthetic.
  const realTitles = [
    'Tyrunt (Pokemon Center Exclusive) #070 Holo Pokémon ME: Mega Evolution Promo NM',
    'Pokémon TCG Tyrunt MEP070 Pokémon Center Stamped Black Star Promo NM',
  ];
  for (const title of realTitles) assert.equal(matchesPriceCheckTitle(lookup.subject, title), true, title);
  for (const title of [
    'Tyrunt 070 Pokemon Center Scarlet Violet Promo Holo',
    'Tyrunt SVP070 Pokemon Center Holo',
    'Tyrunt SVP070 Pokemon Center Mega Evolution Promo Holo',
    'Tyrunt MEP071 Pokemon Center',
    'Tyrunt MEP070 Pokemon Center Reverse',
    'Tyrunt MEP070 Pokemon Center non-holo',
    'Tyrunt MEP070 Pokemon Center cosmos holo',
    'Tyrunt MEP070 Pokemon Center regular',
    'Tyrunt MEP070 Pokemon Center PSA 10',
    'Tyrunt MEP070 Pokemon Center lot',
    'Sealed Pokemon Center Tyrunt 070 Black Star Promo',
  ])
    assert.equal(matchesPriceCheckTitle(lookup.subject, title), false, title);
  for (const mode of ['ambiguous', 'missing']) {
    ambiguousFinish = mode === 'ambiguous';
    missingFinishEvidence = mode === 'missing';
    const uncertain = await loadPriceCheckSubject(id, 'holo');
    assert.ok(uncertain);
    assert.equal(matchesPriceCheckTitle(uncertain.subject, realTitles[1]), false, mode);
  }
  ambiguousFinish = missingFinishEvidence = false;
  assert.equal(await loadPriceCheckSubject(id, 'normal'), null, 'catalog finish conflicts with requested finish');
  const sold = summarizeSoldComps(
    lookup.subject,
    [...realTitles, 'Tyrunt 070 MEP Holo'].map((title, i) => ({
      item_id: `synthetic-${i}`,
      title,
      sold_price: { value: i === 2 ? 1 : 12, currency: 'GBP' },
      sold_at: '2026-11-01',
      best_offer_price_known: true,
      best_offer_accepted: false,
      flags: [],
    })),
    Date.parse('2026-11-06'),
  );
  assert.equal(sold.summary.count, 2);
  assert.equal(sold.summary.median, 12);
  const response = await routes.POST(new Request(`${request(id).url}&source=ebay`, { method: 'POST' }));
  assert.equal(response.status, 200);
  const checked = await response.json();
  assert.equal(checked?.ebay?.summary.median, 12);
  assert.equal(checked?.ebay?.summary.count, 2);
  assert.deepEqual((await loadCardPriceChecks(id, 'holo', true, 'ebay'))?.ebay, checked?.ebay);
  assert.equal(calls, 1);
  const uiSold = await routes.POST(new Request(`${request(id).url}&source=soldcomps`, { method: 'POST' }));
  assert.equal(uiSold.status, 200, 'the signed-in app may still initiate sold checks');
  assert.equal((await uiSold.json()).soldcomps.summary.count, 1);
  assert.equal(soldCalls, 1);
  // Existing zero samples remain fresh for 30 hours; deploying a matcher fix spends no allowance.
  saved['eq.ebay'] = {
    summary: { kind: 'asking', currency: 'GBP', count: 0, median: null, low: null, high: null },
    checkedAt: new Date().toISOString(),
    listings: [],
  };
  assert.equal((await loadCardPriceChecks(id, 'holo', true, 'ebay'))?.ebay?.summary.count, 0);
  assert.equal(calls, 1);
  assert.equal((await legacy.GET(request(id))).status, 200);
  unsupported = true;
  assert.equal((await routes.GET(request(id))).status, 422);
  assert.equal((await legacy.GET(request(id))).status, 422);
  assert.equal(await loadCardPriceChecks(id, 'holo', true), null);
  assert.equal(calls, 2);
  unsupported = false;
  productId = '123';
  assert.equal(await loadPriceCheckSubject(id, 'holo'), null, 'conflicting product provenance is unsupported');
  productId = '685563';
  for (const [knownStamp, knownLabel] of [
    ['staff', 'Staff'],
    ['pre-release', 'Prerelease'],
  ]) {
    stamp = knownStamp;
    label = knownLabel;
    const known = await loadPriceCheckSubject(id, 'holo');
    assert.ok(known);
    assert.equal(matchesPriceCheckTitle(known.subject, `Tyrunt 070 ${knownLabel} MEP Holo`), true);
    assert.equal(matchesPriceCheckTitle(known.subject, 'Tyrunt 070 MEP Holo'), false);
  }
  regular = true;
  const base = await loadPriceCheckSubject('mep-070', 'holo');
  assert.ok(base);
  assert.equal(matchesPriceCheckTitle(base.subject, 'Tyrunt 070 MEP Holo'), true);
  assert.equal(matchesPriceCheckTitle(base.subject, 'Tyrunt 070 Pokemon Center MEP Holo'), false);
  paid = false;
  const beforeFree = { calls, soldCalls };
  for (const handler of [routes.GET, routes.POST, legacy.GET]) assert.equal((await handler(request(id))).status, 402);
  assert.deepEqual(
    { calls, soldCalls },
    beforeFree,
    'free users cannot spend provider quota or read saved comparisons',
  );
}
void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
