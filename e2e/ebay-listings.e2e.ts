import { test, expect, type Harness } from './fixtures';
import { mockCardPrices } from './price-fixtures';

test.use({ signedIn: true });

/** Open Bulbasaur's details with its Price details disclosure (closed by default) expanded. Opening reads saved
 * checks with a GET; unless `saved`, that read finds none, so only Check prices (POST) reaches the test's route. */
async function openPriceDetails(harness: Harness, { saved = false } = {}) {
  if (!saved)
    await harness.page.route('**/app/api/card-price-checks?**', (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ json: { ebay: null, soldcomps: null, errors: {} } })
        : route.fallback(),
    );
  const detail = await harness.openCardDetail();
  const summary = detail.locator('summary').filter({ hasText: 'Price details' });
  await summary.click();
  await expect(summary.locator('..')).toHaveAttribute('open', '');
  return detail;
}

// Synthetic independent asking and sold samples, not market data.
const comparisonFixture = {
  ebay: {
    summary: { kind: 'asking', currency: 'GBP', count: 3, median: 12, low: 10, high: 20 },
    checkedAt: '2026-10-27T12:00:00Z',
    searchUrl: 'https://www.ebay.co.uk/sch/i.html?_nkw=Bulbasaur',
  },
  soldcomps: {
    summary: { kind: 'sold', currency: 'GBP', count: 2, median: 9, low: 8, high: 10 },
    checkedAt: '2026-10-27T12:00:00Z',
    searchUrl: 'https://www.ebay.co.uk/sch/i.html?_nkw=Bulbasaur&LH_Sold=1&LH_Complete=1',
  },
  errors: {},
};

test('asking and sold comparisons load on demand and remain separate from the card valuation', async ({ harness }) => {
  // Synthetic market quote and asking-price sample, never real sale data.
  await mockCardPrices(harness.page, { 'base1-44': { confidence: 'medium', market: 8, trend: { '7d': 7, Trend: 8 } } });
  await harness.page.addInitScript(() => localStorage.removeItem('binderdex_card_price_cache_v7'));
  let lookups = 0;
  await harness.page.route('**/app/api/card-price-checks?**', async (route) => {
    // Opening the card reads saved checks (GET, none here); only Check prices asks the providers (POST).
    if (route.request().method() === 'GET') return route.fulfill({ json: { ebay: null, soldcomps: null, errors: {} } });
    lookups++;
    expect(new URL(route.request().url()).searchParams.get('cardId')).toBe('base1-44');
    await route.fulfill({ json: comparisonFixture });
  });
  await harness.page.reload();
  const detail = await openPriceDetails(harness);
  const market = detail.getByText('Market', { exact: true }).locator('..');
  await expect(market).toContainText('£8.00');
  const indicator = detail.getByRole('region', { name: 'Price comparisons' });
  await expect(indicator.getByText(/Manual checks/)).toBeVisible();
  expect(lookups).toBe(0);
  const check = indicator.getByRole('button', { name: 'Check prices' });
  await detail.getByText('Price details', { exact: true }).click();
  await expect(check).toBeHidden();
  await detail.getByText('Price details', { exact: true }).click();
  await expect(check).toBeVisible();
  expect(lookups).toBe(0);
  // The manual action precedes both comparison results and catalogue evidence.
  expect(
    await check.evaluate((button) => {
      const details = button.closest('details')!;
      const evidence = details.querySelector('section + div');
      return !!evidence && !!(button.compareDocumentPosition(evidence) & Node.DOCUMENT_POSITION_FOLLOWING);
    }),
  ).toBe(true);
  await harness.expectMinTapTarget(check);
  await check.click();
  await expect(indicator.getByText(/£12.00.*median asking price.*3 matched listings/)).toBeVisible();
  await indicator.getByText('Evidence', { exact: true }).click();
  await expect(indicator.getByText(/Postage excluded/).first()).toBeVisible();
  await expect(indicator.getByText(/£9.00.*median sold price.*2 matched sales/)).toBeVisible();
  await expect(market).toContainText('£8.00');
  const link = indicator.getByRole('link', { name: 'View open listings' });
  await expect(link).toHaveAttribute('href', /^https:\/\/www\.ebay\.co\.uk\//);
  await harness.expectMinTapTarget(link);
  const soldLink = indicator.getByRole('link', { name: 'View sold listings' });
  await expect(soldLink).toHaveAttribute('href', /^https:\/\/www\.ebay\.co\.uk\/sch\/.*LH_Sold=1/);
  await harness.expectMinTapTarget(soldLink);
  await harness.expectNoHorizontalOverflow();
});

test('eBay lookup degrades clearly offline without making a request', async ({ harness, context }) => {
  let lookups = 0;
  await harness.page.route('**/app/api/card-price-checks?**', async (route) => {
    lookups++;
    await route.abort();
  });
  await expect(harness.slot(1)).toBeVisible();
  // Dropping the connection swaps in the device's saved binder, so open the card once offline.
  await context.setOffline(true);
  await expect(harness.page.getByText('Offline · using saved cards and prices')).toBeVisible();
  const detail = await openPriceDetails(harness);
  await detail.getByRole('button', { name: 'Check prices' }).click();
  await expect(detail.getByRole('status')).toHaveText('Connect to the internet to check prices.');
  expect(lookups).toBe(0);
  await context.setOffline(false);
});

test('eBay lookup failure and an empty sample do not invent a price', async ({ harness }) => {
  let failed = true;
  await harness.page.route('**/app/api/card-price-checks?**', async (route) => {
    if (failed)
      await route.fulfill({
        status: 503,
        json: { error: 'eBay listings are temporarily unavailable. Try again later.' },
      });
    else
      await route.fulfill({
        json: {
          ebay: {
            summary: { kind: 'asking', currency: 'GBP', count: 0, median: null, low: null, high: null },
            checkedAt: '2026-10-27T12:00:00Z',
          },
          soldcomps: null,
          errors: { soldcomps: 'Monthly allowance used up.' },
        },
      });
  });
  const detail = await openPriceDetails(harness);
  const indicator = detail.getByRole('region', { name: 'Price comparisons' });
  await indicator.getByRole('button', { name: 'Check prices' }).click();
  await expect(indicator.getByRole('status').first()).toContainText('temporarily unavailable');
  failed = false;
  await indicator.getByRole('button', { name: 'Check prices' }).click();
  await expect(indicator.getByText('No matching listings in the search sample.')).toBeVisible();
  await expect(indicator.getByText(/median asking price/)).toHaveCount(0);
  await harness.expectNoHorizontalOverflow();
});

test('eBay lookup is available when the card has no market quote', async ({ harness }) => {
  await mockCardPrices(harness.page, {});
  await harness.page.addInitScript(() => localStorage.removeItem('binderdex_card_price_cache_v7'));
  await harness.page.reload();
  const detail = await openPriceDetails(harness);
  await expect(detail.getByRole('button', { name: 'Check prices' })).toBeVisible();
  await expect(detail.getByRole('region', { name: 'Price comparisons' })).toContainText('Manual checks');
});

test('eBay listings API requires a signed-in session', async ({ request }) => {
  const response = await request.get('/app/api/ebay/listings?cardId=base1-44');
  expect(response.status()).toBe(401);
  expect(response.headers()['cache-control']).toBe('no-store');
});

test('Show mode checks both sources on tap and resets comparisons when the finish changes', async ({ harness }) => {
  let requests = 0;
  await harness.page.route('**/app/api/card-price-checks?**', async (route) => {
    requests++;
    expect(route.request().method()).toBe('POST');
    expect(new URL(route.request().url()).searchParams.get('cardId')).toBe('sv03.5-005');
    await route.fulfill({ json: comparisonFixture });
  });
  await harness.page.getByRole('button', { name: 'Show mode', exact: true }).click();
  await harness.dock().getByRole('button', { name: 'Search', exact: true }).click();
  const dialog = harness.page.getByRole('dialog', { name: 'Quick mode' });
  await dialog.getByRole('searchbox').fill('charmeleon');
  await dialog
    .getByRole('region', { name: 'Cards' })
    .getByRole('button', { name: /^Charmeleon, 151 / })
    .first()
    .click();
  const check = dialog.getByTestId('quick-card-check');
  const button = check.getByRole('button', { name: 'Check prices', exact: true });
  await expect(button).toBeVisible();
  expect(requests).toBe(0);
  await harness.expectMinTapTarget(button);
  await button.click();
  await expect(check.getByText(/£9.00.*median sold price/)).toBeVisible();
  await expect(check.getByText(/£12.00.*median asking price/)).toBeVisible();
  expect(
    await button.evaluate((button) => {
      const section = button.closest('section')!;
      const results = section.querySelector('[aria-live="polite"]')!;
      return !!(button.compareDocumentPosition(results) & Node.DOCUMENT_POSITION_FOLLOWING);
    }),
  ).toBe(true);
  await harness.expectNoHorizontalOverflow();
  const finish = check.getByRole('radiogroup', { name: 'Variant' }).getByRole('radio', { name: /reverse/i });
  await finish.click();
  await expect(finish).toHaveAttribute('aria-checked', 'true');
  await expect(check.getByText(/median sold price/)).toHaveCount(0);
  expect(requests).toBe(2);
});

test('price check writes and saved reads require authentication', async ({ request }) => {
  for (const method of ['GET', 'POST']) {
    const response = await request.fetch('/app/api/card-price-checks?cardId=base1-44&finish=normal', { method });
    expect(response.status()).toBe(401);
    expect(response.headers()['cache-control']).toBe('no-store');
  }
});

for (const fast of ['ebay', 'soldcomps'] as const) {
  test(`${fast} appears independently while the other source is pending`, async ({ harness }) => {
    const slow = fast === 'ebay' ? 'soldcomps' : 'ebay';
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await harness.page.route('**/app/api/card-price-checks?**', async (route) => {
      const source = new URL(route.request().url()).searchParams.get('source');
      if (source === slow) await gate;
      await route.fulfill({ json: comparisonFixture });
    });
    const detail = await openPriceDetails(harness);
    const comparison = detail.getByRole('region', { name: 'Price comparisons' });
    await comparison.getByRole('button', { name: 'Check prices', exact: true }).click();
    try {
      await expect(
        comparison.getByText(fast === 'ebay' ? /£12.00.*median asking price/ : /£9.00.*median sold price/),
      ).toBeVisible();
      await expect(
        comparison.getByText(slow === 'ebay' ? 'Checking eBay…' : 'Checking sold comps…', { exact: true }),
      ).toBeVisible();
    } finally {
      release?.();
    }
    await expect(comparison.getByText(/£12.00.*median asking price/)).toBeVisible();
    await expect(comparison.getByText(/£9.00.*median sold price/)).toBeVisible();
    await harness.expectNoHorizontalOverflow();
  });
}

// Synthetic fresh, concentrated sales which qualify for a buying guide.
const qualifyingFixture = () => ({
  ...comparisonFixture,
  soldcomps: {
    summary: { kind: 'sold', currency: 'GBP', count: 10, median: 9.8, low: 9.6, high: 10 },
    checkedAt: new Date().toISOString(),
    sales: Array.from({ length: 10 }, (_, i) => ({
      amount: [9.6, 9.7, 9.8, 9.9, 10][i % 5],
      soldAt: new Date(Date.now() - ((i % 3) + 1) * 86400_000).toISOString().slice(0, 10),
    })),
  },
});

test('qualified sold guide changes Show mode verdict, plots an overlay and resets on finish change', async ({
  harness,
}) => {
  await mockCardPrices(harness.page, {
    'sv03.5-005': {
      market: 10,
      confidence: 'high',
      finishes: [
        { finish: 'normal', market: 10 },
        { finish: 'reverse_holo', market: 20 },
      ],
    },
  });
  let requests = 0;
  await harness.page.route('**/app/api/card-price-checks?**', async (route) => {
    requests++;
    await route.fulfill({ json: qualifyingFixture() });
  });
  await harness.page.getByRole('button', { name: 'Show mode', exact: true }).click();
  await harness.dock().getByRole('button', { name: 'Search', exact: true }).click();
  const dialog = harness.page.getByRole('dialog', { name: 'Quick mode' });
  await dialog.getByRole('searchbox').fill('charmeleon');
  await dialog
    .getByRole('region', { name: 'Cards' })
    .getByRole('button', { name: /^Charmeleon, 151 / })
    .first()
    .click();
  const check = dialog.getByTestId('quick-card-check');
  await expect(check.getByTestId('quick-card-market-price')).toHaveText('£10.00');
  await check.getByRole('textbox', { name: 'Asking price' }).fill('10.9');
  await check.getByRole('textbox', { name: 'Asking price' }).press('Enter');
  await expect(check.getByTestId('deal-verdict')).toHaveAttribute('data-verdict', 'fair');
  expect(requests).toBe(0);
  await check.getByRole('button', { name: 'Check prices', exact: true }).click();
  await expect(check.getByTestId('quick-card-market-price')).toHaveText('£9.80');
  await expect(check.getByTestId('deal-verdict')).toHaveAttribute('data-verdict', 'overpriced');
  await expect(check.getByTestId('offer-price-dot')).toHaveAttribute('data-price', '10.9');
  await expect(check.getByRole('figure', { name: 'Buying range', exact: true })).toBeVisible();
  const chart = check.getByRole('figure', { name: 'Sold price history' });
  const overlay = chart.getByRole('button', { name: 'Show full sale range' });
  await expect(overlay).toBeVisible();
  await harness.expectMinTapTarget(overlay);
  await overlay.click();
  await expect(chart.getByRole('button', { name: 'Hide full sale range' })).toHaveAttribute('aria-pressed', 'true');
  await harness.expectNoHorizontalOverflow();
  if (test.info().project.name === 'standalone-390x844' && test.info().repeatEachIndex === 0)
    await harness.page.screenshot({ path: '/tmp/holofolder-price-comparison-chart.png' });
  await check
    .getByRole('radiogroup', { name: 'Variant' })
    .getByRole('radio', { name: /reverse/i })
    .click();
  await expect(check.getByTestId('quick-card-market-price')).toHaveText('£20.00');
  await expect(check.getByText(/median sold price/)).toHaveCount(0);
  expect(requests).toBe(2);
});

test('card details updates its good-price band only after a user checks qualifying sold evidence', async ({
  harness,
}) => {
  await mockCardPrices(harness.page, { 'base1-44': { market: 10, confidence: 'high' } });
  await harness.page.addInitScript(() => localStorage.removeItem('binderdex_card_price_cache_v7'));
  await harness.page.route('**/app/api/card-price-checks?**', (route) => route.fulfill({ json: qualifyingFixture() }));
  await harness.page.reload();
  const detail = await openPriceDetails(harness);
  await expect(detail.getByText('Fair range · sold', { exact: true })).toHaveCount(0);
  await detail.getByRole('button', { name: 'Check prices', exact: true }).click();
  await expect(detail.getByText('Fair range · sold', { exact: true })).toBeVisible();
  await expect(detail.getByRole('figure', { name: 'Buying range', exact: true })).toBeVisible();
  await harness.expectNoHorizontalOverflow();
});

test('card details compares sold evidence with the tracked finish quote', async ({ harness }) => {
  await mockCardPrices(harness.page, {
    'base1-44': {
      market: 10,
      confidence: 'high',
      finishes: [
        { finish: 'normal', market: 10 },
        { finish: 'reverse_holo', market: 20 },
      ],
    },
  });
  await harness.page.addInitScript(() => localStorage.removeItem('binderdex_card_price_cache_v7'));
  await harness.page.route('**/app/api/card-price-checks?**', (route) => route.fulfill({ json: qualifyingFixture() }));
  await harness.page.reload();
  const detail = await openPriceDetails(harness);
  await detail.locator('summary').filter({ hasText: 'Card & variant' }).click();
  await detail.getByRole('button', { name: /^Reverse/ }).click();
  await expect(detail.getByText('Market', { exact: true }).locator('..')).toContainText('£20.00');
  await detail.getByRole('button', { name: 'Check prices', exact: true }).click();
  await detail.getByText('Evidence', { exact: true }).click();
  await expect(detail.getByText(/sold and catalogue buying ranges do not overlap/)).toBeVisible();
  await expect(detail.getByText('Fair range · sold', { exact: true })).toHaveCount(0);
});

test('switching finishes cancels the old check before it can overwrite new evidence', async ({ harness }) => {
  await mockCardPrices(harness.page, {
    'sv03.5-005': {
      market: 10,
      confidence: 'high',
      finishes: [
        { finish: 'normal', market: 10 },
        { finish: 'reverse_holo', market: 20 },
      ],
    },
  });
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await harness.page.route('**/app/api/card-price-checks?**', async (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get('source') === 'soldcomps' && params.get('finish') === 'normal') await gate;
    const fixture = qualifyingFixture();
    if (params.get('finish') === 'reverse_holo') {
      fixture.soldcomps.summary = { ...fixture.soldcomps.summary, median: 19.6, low: 19.2, high: 20 };
      fixture.soldcomps.sales = fixture.soldcomps.sales.map((sale) => ({ ...sale, amount: sale.amount * 2 }));
    }
    await route.fulfill({ json: fixture }).catch(() => undefined);
  });
  await harness.page.getByRole('button', { name: 'Show mode', exact: true }).click();
  await harness.dock().getByRole('button', { name: 'Search', exact: true }).click();
  const dialog = harness.page.getByRole('dialog', { name: 'Quick mode' });
  await dialog.getByRole('searchbox').fill('charmeleon');
  await dialog
    .getByRole('region', { name: 'Cards' })
    .getByRole('button', { name: /^Charmeleon, 151 / })
    .first()
    .click();
  const check = dialog.getByTestId('quick-card-check');
  try {
    await check.getByRole('button', { name: 'Check prices', exact: true }).click();
    await expect(check.getByText(/£12.00.*median asking price/)).toBeVisible();
    const cancelled = harness.page.waitForEvent('requestfailed', {
      predicate: (request) => request.url().includes('source=soldcomps') && request.url().includes('finish=normal'),
    });
    await check
      .getByRole('radiogroup', { name: 'Variant' })
      .getByRole('radio', { name: /reverse/i })
      .click();
    await cancelled;
    await check.getByRole('button', { name: 'Check prices', exact: true }).click();
    await expect(check.getByTestId('quick-card-market-price')).toHaveText('£19.60');
    await expect(check.getByRole('figure', { name: 'Buying range', exact: true })).toBeVisible();
  } finally {
    release?.();
  }
});

test('fair market bands, quick eBay link and individually verifiable source records', async ({ harness }) => {
  await mockCardPrices(harness.page, { 'sv03.5-005': { market: 10, confidence: 'high' } });
  let calls = 0;
  await harness.page.route('**/app/api/card-price-checks?**', (route) => {
    calls++;
    const fixture = qualifyingFixture();
    const sold = {
      ...fixture.soldcomps,
      sales: fixture.soldcomps.sales.map((sale, index) => ({
        ...sale,
        title: `Synthetic Charmeleon 005/165 151 sale ${index + 1}`,
        url: `https://www.ebay.co.uk/itm/${123456789010 + index}`,
        condition: 'Used',
      })),
    };
    const ebay = {
      ...fixture.ebay,
      listings: [10, 12, 20].map((amount, index) => ({
        amount,
        title: `Synthetic Charmeleon 005/165 151 asking ${index + 1}`,
        url: `https://www.ebay.co.uk/itm/${123456789099 + index}`,
        condition: 'New',
      })),
    };
    return route.fulfill({ json: { ebay, soldcomps: sold, errors: {} } });
  });
  await harness.page.getByRole('button', { name: 'Show mode', exact: true }).click();
  await harness.dock().getByRole('button', { name: 'Search', exact: true }).click();
  const dialog = harness.page.getByRole('dialog', { name: 'Quick mode' });
  await dialog.getByRole('searchbox').fill('charmeleon');
  await dialog
    .getByRole('region', { name: 'Cards' })
    .getByRole('button', { name: /^Charmeleon, 151 / })
    .first()
    .click();
  const check = dialog.getByTestId('quick-card-check');
  expect(calls).toBe(0);
  await check.getByRole('button', { name: 'Check prices', exact: true }).click();
  const scale = check.getByRole('figure', { name: 'Buying range' });
  await expect(scale).toContainText('Fair / expected £8.82 to £10.78');
  await check.getByRole('textbox', { name: 'Asking price' }).fill('9.8');
  await expect(check.getByTestId('deal-verdict')).toHaveAttribute('data-verdict', 'fair');
  const quickLink = check.getByRole('link', { name: 'View open listings' });
  await expect(quickLink).toBeVisible();
  await harness.expectMinTapTarget(quickLink);
  await expect(check.getByText('Evidence', { exact: true }).locator('..')).not.toHaveAttribute('open', '');
  await check.getByText('Sold records · 10', { exact: true }).click();
  await expect(check.getByText(/supplied by SaleHistory/)).toBeVisible();
  const soldRows = check.getByRole('list', { name: 'Matched sold records' });
  await expect(soldRows.getByRole('listitem')).toHaveCount(10);
  await expect(soldRows.getByRole('link', { name: 'Verify sale on eBay' }).first()).toHaveAttribute(
    'href',
    /^https:\/\/www\.ebay\.co\.uk\/itm\/\d+$/,
  );
  await harness.expectMinTapTarget(soldRows.getByRole('link').first());
  await check.getByText('Asking records · 3', { exact: true }).click();
  await expect(check.getByText(/supplied by eBay Browse API/)).toBeVisible();
  await expect(check.getByRole('list', { name: 'Matched asking records' }).getByRole('link').first()).toHaveAttribute(
    'href',
    'https://www.ebay.co.uk/itm/123456789099',
  );
  expect(calls).toBe(2);
  await harness.expectNoHorizontalOverflow();
});

test('an old saved check survives reload and offline, only explicit refresh requests new evidence', async ({
  harness,
}) => {
  let requests = 0;
  const oldDate = '2025-01-01T12:00:00Z';
  await harness.page.route('**/app/api/card-price-checks?**', async (route) => {
    requests++;
    expect(new URL(route.request().url()).searchParams.get('refresh')).toBe(requests > 2 ? 'true' : null);
    await route.fulfill({
      json: {
        ...comparisonFixture,
        ebay: { ...comparisonFixture.ebay, checkedAt: oldDate },
        soldcomps: { ...comparisonFixture.soldcomps, checkedAt: oldDate },
      },
    });
  });
  let detail = await openPriceDetails(harness);
  await detail.getByRole('button', { name: 'Check prices', exact: true }).click();
  await expect(detail.getByText(/£9.00.*median sold price/)).toBeVisible();
  expect(requests).toBe(2);
  await harness.page.reload();
  detail = await openPriceDetails(harness);
  const comparison = detail.getByRole('region', { name: 'Price comparisons' });
  await expect(comparison.getByText(/£9.00.*median sold price/)).toBeVisible();
  await expect(comparison.getByTestId('price-check-age-soldcomps')).toContainText('Last checked on 01/01/2025');
  await expect(comparison.getByTestId('price-check-age-soldcomps')).toContainText('older snapshot');
  expect(requests).toBe(2);
  const refresh = comparison.getByRole('button', { name: 'Refresh prices', exact: true });
  await harness.expectMinTapTarget(refresh);
  await harness.expectNoHorizontalOverflow();
  await harness.page.context().setOffline(true);
  await refresh.click();
  await expect(comparison.getByText('Connect to the internet to check prices.')).toBeVisible();
  await expect(comparison.getByText(/£9.00.*median sold price/)).toBeVisible();
  expect(requests).toBe(2);
  await harness.page.context().setOffline(false);
  await refresh.click();
  await expect(refresh).toBeEnabled();
  expect(requests).toBe(4);
});

test('a saved source can be refreshed when the other provider is unavailable', async ({ harness }) => {
  let soldRefreshes = 0;
  await harness.page.route('**/app/api/card-price-checks?**', async (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get('source') === 'soldcomps' && params.get('refresh') === 'true') soldRefreshes++;
    await route.fulfill({
      json: {
        ebay: null,
        soldcomps: { ...comparisonFixture.soldcomps, checkedAt: '2025-01-01T12:00:00Z' },
        errors: { ebay: 'eBay is not configured.' },
      },
    });
  });
  const detail = await openPriceDetails(harness);
  const comparison = detail.getByRole('region', { name: 'Price comparisons' });
  await comparison.getByRole('button', { name: 'Check prices', exact: true }).click();
  await expect(comparison.getByText(/£9.00.*median sold price/)).toBeVisible();
  const refresh = comparison.getByRole('button', { name: 'Refresh prices', exact: true });
  await expect(refresh).toBeVisible();
  await refresh.click();
  await expect(refresh).toBeEnabled();
  expect(soldRefreshes).toBe(1);
  await harness.expectNoHorizontalOverflow();
});
