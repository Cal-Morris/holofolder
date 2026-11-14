import assert from 'node:assert/strict';
import { checkComparisonTarget, estimateComparisonSpend } from '../../lib/server/comparison-jobs';
import { loadCardPriceChecks } from '../../lib/server/card-price-checks';

// Synthetic isolated provider calls, never real market data or credentials.
async function run() {
  const originalFetch = globalThis.fetch;
  const names = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'EBAY_CLIENT_ID',
    'EBAY_CLIENT_SECRET',
    'SOLDCOMPS_API_KEY',
  ] as const;
  const originalEnv = names.map((name) => process.env[name]);
  for (const name of names)
    process.env[name] = name === 'NEXT_PUBLIC_SUPABASE_URL' ? 'https://synthetic.supabase.test' : 'synthetic-key';
  const rows = new Map<string, unknown>();
  let initialReads = 0,
    gateCatalog = true;
  let markSavedReadStarted: () => void = () => {};
  const savedReadStarted = new Promise<void>((resolve) => {
    markSavedReadStarted = resolve;
  });
  let browseCalls = 0,
    soldCalls = 0,
    failSold = false,
    claim = true;
  let blockedSource: string | null = null;
  let catalogReads = 0,
    jobStatusReads = 0;
  const savedFinishFilters: (string | null)[] = [];
  let unavailableBudget = false;
  const budgets: Array<{ budget_bucket: string; request_limit: number }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/rpc/consume_developer_budget')) {
      const body = JSON.parse(String(init?.body));
      budgets.push(body);
      if (unavailableBudget) return Response.json({ message: 'synthetic failure' }, { status: 503 });
      return Response.json({
        allowed: body.budget_bucket !== `price-check:provider:${blockedSource}`,
        retry_after: 17,
      });
    }
    const json = (data: unknown) => Response.json(data);
    if (url.pathname.includes('/comparison_jobs')) {
      jobStatusReads++;
      assert.equal(url.searchParams.get('select'), 'status');
      return json({ status: 'running' });
    }
    if (url.pathname.includes('/tcg_cards')) {
      catalogReads++;
      if (gateCatalog) await savedReadStarted;
      return json([
        {
          id: 'base1-44',
          name_en: 'Bulbasaur',
          local_id: '44',
          set_id: 'base1',
          catalog: null,
          tcg_sets: { name_en: 'Base Set' },
        },
      ]);
    }
    if (url.pathname.includes('/rpc/claim_card_price_check')) return json(claim);
    if (url.pathname.includes('/card_price_checks')) {
      if (url.searchParams.get('select') === 'source,result_json') {
        initialReads++;
        markSavedReadStarted();
        return Response.json([...rows].map(([source, result_json]) => ({ source, result_json })));
      }
      const source = url.searchParams.get('source')?.slice(3) ?? '';
      if (init?.method === 'PATCH') {
        rows.set(source, JSON.parse(String(init.body)).result_json);
        return new Response(null, { status: 204 });
      }
      if (url.searchParams.get('select') === 'card_id,finish,source,result_json')
        savedFinishFilters.push(url.searchParams.get('finish'));
      if (url.searchParams.get('select') !== 'result_json')
        return json(
          [...rows].map(([source, value]) => ({
            card_id: 'base1-44',
            finish: 'normal',
            source,
            result_json: value,
            checked_at: (value as { checkedAt: string }).checkedAt,
          })),
        );
      return json(rows.has(source) ? [{ result_json: rows.get(source) }] : []);
    }
    if (url.pathname.includes('/oauth2/token')) return json({ access_token: 'synthetic-token', expires_in: 7200 });
    if (url.pathname.includes('/item_summary/search')) {
      browseCalls++;
      return json({
        itemSummaries: [
          {
            itemId: 'synthetic-a',
            title: 'Bulbasaur 44/102 Base Set',
            itemWebUrl: 'https://www.ebay.co.uk/itm/123456789012?mkcid=1',
            condition: 'Used',
            price: { value: '12', currency: 'GBP' },
            itemLocation: { country: 'GB' },
            buyingOptions: ['FIXED_PRICE'],
          },
        ],
      });
    }
    if (url.hostname === 'www.soldcomps.io') {
      soldCalls++;
      assert.equal(url.searchParams.get('site'), 'EBAY_GB');
      if (failSold) return new Response(null, { status: 402 });
      return json({
        items: [
          {
            item_id: 'synthetic-s',
            title: 'Bulbasaur 44/102 Base Set',
            url: 'https://www.ebay.co.uk/itm/123456789013?mkcid=1',
            condition: 'Used',
            sold_price: { value: 9, currency: 'GBP' },
            sold_at: new Date().toISOString().slice(0, 10),
            best_offer_price_known: true,
            best_offer_accepted: false,
            flags: [],
          },
        ],
      });
    }
    throw new Error(`Unexpected synthetic request to ${url.pathname}`);
  }) as typeof fetch;
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const parallel = await Promise.race([
        loadCardPriceChecks('base1-44', 'normal', false),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Saved comparisons must start before the catalog read finishes')),
            1000,
          );
        }),
      ]);
      assert.deepEqual(parallel, { ebay: null, soldcomps: null, errors: {} });
    } finally {
      clearTimeout(timer);
      gateCatalog = false;
    }
    assert.equal(initialReads, 1, 'both saved sources must load in one bounded read');
    const onlyEbay = await loadCardPriceChecks('base1-44', 'normal', true, 'ebay');
    assert.equal(onlyEbay?.ebay?.summary.median, 12);
    assert.equal(onlyEbay?.soldcomps, null);
    assert.equal(onlyEbay?.ebay?.listings?.[0].url, 'https://www.ebay.co.uk/itm/123456789012');
    assert.deepEqual(rows.get('ebay'), onlyEbay?.ebay);
    assert.equal(soldCalls, 0, 'an eBay-only check cannot start a sold lookup');
    const first = await loadCardPriceChecks('base1-44', 'normal', true);
    assert.equal(first?.ebay?.summary.median, 12);
    assert.equal(first?.soldcomps?.summary.median, 9);
    assert.equal(rows.size, 2);
    assert.equal(first?.soldcomps?.sales?.[0].url, 'https://www.ebay.co.uk/itm/123456789013');
    assert.deepEqual((await loadCardPriceChecks('base1-44', 'normal', false))?.soldcomps, first?.soldcomps);
    await loadCardPriceChecks('base1-44', 'normal', true);
    await loadCardPriceChecks('base1-44', 'normal', true, 'soldcomps', true);
    assert.deepEqual([browseCalls, soldCalls], [1, 1], 'manual refresh still respects the cooldown');
    assert.equal(budgets.length, 2, 'saved and cached checks do not spend provider budget');
    // A background target with both sources missing reads its catalog subject once, and checks the job
    // once between the two provider calls (the workflow step checks it before the target starts).
    const savedRows = new Map(rows);
    rows.clear();
    catalogReads = jobStatusReads = 0;
    savedFinishFilters.length = 0;
    const background = { cardId: 'base1-44', finish: 'normal' as const, language: 'en' as const };
    assert.equal((await checkComparisonTarget(background, {}, 'synthetic-job')).result, 'checked');
    assert.deepEqual([catalogReads, jobStatusReads], [1, 1]);
    assert.deepEqual(savedFinishFilters, ['in.(normal)'], 'saved checks are filtered by the requested finish');
    for (const [source, value] of savedRows) rows.set(source, value);
    browseCalls--;
    soldCalls--;
    budgets.splice(2);
    const stale = {
      summary: { kind: 'sold', currency: 'GBP', count: 1, median: 9, low: 9, high: 9 },
      checkedAt: new Date(Date.now() - 365 * 24 * 3600_000).toISOString(),
    };
    rows.set('soldcomps', stale);
    const reused = await loadCardPriceChecks('base1-44', 'normal', true);
    assert.equal(reused?.soldcomps?.checkedAt, stale.checkedAt);
    assert.deepEqual([browseCalls, soldCalls], [1, 1], 'old saved checks never spend credits without explicit refresh');
    const refreshed = await loadCardPriceChecks('base1-44', 'normal', true, 'soldcomps', true);
    assert.notEqual(refreshed?.soldcomps?.checkedAt, stale.checkedAt);
    assert.equal(soldCalls, 2, 'explicit refresh requests a new check');
    rows.set('soldcomps', stale);
    failSold = true;
    const partial = await loadCardPriceChecks('base1-44', 'normal', true, 'soldcomps', true);
    assert.equal(partial?.soldcomps?.checkedAt, stale.checkedAt);
    assert.match(partial!.errors.soldcomps!, /allowance/);
    assert.deepEqual(rows.get('soldcomps'), stale);
    claim = false;
    await loadCardPriceChecks('base1-44', 'normal', true);
    assert.equal(soldCalls, 3);
    rows.set('ebay', { ...stale, summary: { ...stale.summary, kind: 'asking' } });
    const target = { cardId: 'base1-44', finish: 'normal' as const, language: 'en' as const };
    assert.equal(await estimateComparisonSpend([target]), 0, 'old shared checks do not count towards credit estimates');
    assert.equal((await checkComparisonTarget(target, {})).result, 'fresh', 'background jobs reuse old shared checks');
    assert.deepEqual([browseCalls, soldCalls], [1, 3]);
    const empty = { ...stale, summary: { ...stale.summary, count: 0, low: null, median: null, high: null } };
    rows.set('soldcomps', empty);
    assert.equal((await loadCardPriceChecks('base1-44', 'normal', true))?.soldcomps?.summary.count, 0);
    assert.equal(soldCalls, 3, 'an old empty search also remains saved');
    assert.ok(
      budgets.some((row) => row.budget_bucket === 'price-check:provider:soldcomps' && row.request_limit === 10),
    );
    assert.ok(budgets.some((row) => row.budget_bucket === 'price-check:provider:ebay' && row.request_limit === 60));
    rows.clear();
    claim = true;
    blockedSource = 'soldcomps';
    const beforeSold = soldCalls;
    await assert.rejects(loadCardPriceChecks('base1-44', 'normal', true, 'soldcomps'), (error) => {
      const value = error as { status: number; retryAfter: number };
      return value.status === 429 && value.retryAfter === 17;
    });
    assert.equal(soldCalls, beforeSold, 'a denied provider budget cannot call sold comps');
    assert.equal(
      (await checkComparisonTarget(target, {})).retryable,
      true,
      'background jobs back off on shared limits',
    );
    blockedSource = 'ebay';
    const beforeBrowse = browseCalls;
    const { fetchEbayListingIndicator, loadPriceCheckSubject } = await import('../../lib/server/ebay-listings');
    const lookup = await loadPriceCheckSubject('base1-44', 'normal');
    assert.ok(lookup);
    await assert.rejects(
      fetchEbayListingIndicator(lookup.subject, lookup.query),
      (error) => (error as { status: number }).status === 429,
    );
    assert.equal(browseCalls, beforeBrowse, 'a denied budget cannot call listing search');
    unavailableBudget = true;
    await assert.rejects(
      loadCardPriceChecks('base1-44', 'normal', true, 'soldcomps'),
      (error) => (error as { status: number }).status === 503,
    );
    assert.equal(soldCalls, beforeSold, 'budget failures fail closed');
  } finally {
    globalThis.fetch = originalFetch;
    names.forEach((name, i) => {
      if (originalEnv[i] === undefined) delete process.env[name];
      else process.env[name] = originalEnv[i];
    });
  }
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
