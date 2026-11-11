import type { Locator } from '@playwright/test';
import { test, expect } from './fixtures';

test.use({ signedIn: true });

// The shared harness boots through the mobile dock; resize after setup for desktop checks.
test.beforeEach(async ({ harness }, testInfo) => {
  if (testInfo.project.name === 'desktop') await harness.page.setViewportSize({ width: 1440, height: 1000 });
});

async function links(comparison: Locator, query: string) {
  for (const sold of [false, true]) {
    const link = comparison.getByRole('link', { name: sold ? 'View sold listings' : 'View open listings' });
    await expect(link).toHaveCount(1);
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await expect.poll(async () => new URL((await link.getAttribute('href'))!).searchParams.get('_nkw')).toBe(query);
    const url = new URL((await link.getAttribute('href'))!);
    expect(url.origin).toBe('https://www.ebay.co.uk');
    expect(url.searchParams.get('_nkw')).toBe(query);
    expect(url.searchParams.get('LH_PrefLoc')).toBe('1');
    expect(url.searchParams.get(sold ? 'LH_Sold' : 'LH_BIN')).toBe('1');
    if (sold) expect(url.searchParams.get('LH_Complete')).toBe('1');
  }
}

for (const surface of ['detail', 'analytics', 'Show', 'Quick'] as const) {
  test(`${surface} has listing links before checks, offline and after saved results`, async ({ harness, context }) => {
    let requests = 0;
    await harness.page.route('**/app/api/card-price-checks?**', async (route) => {
      requests++;
      // Synthetic empty checks with trusted URLs deliberately different from the fallback.
      const check = {
        summary: { currency: 'GBP', count: 0, median: null, low: null, high: null },
        checkedAt: new Date().toISOString(),
      };
      await route.fulfill({
        json: {
          ebay: {
            ...check,
            summary: { ...check.summary, kind: 'asking' },
            searchUrl: 'https://www.ebay.co.uk/sch/i.html?_nkw=saved&LH_BIN=1&LH_PrefLoc=1',
          },
          soldcomps: {
            ...check,
            summary: { ...check.summary, kind: 'sold' },
            searchUrl: 'https://www.ebay.co.uk/sch/i.html?_nkw=saved&LH_Sold=1&LH_Complete=1&LH_PrefLoc=1',
          },
          errors: {},
        },
      });
    });
    if (surface === 'detail') await harness.openCardDetail();
    else if (surface === 'analytics') {
      await harness.page.getByRole('button', { name: 'More', exact: true }).click();
      await harness.page.getByRole('menuitem', { name: 'Analytics', exact: true }).click();
      await harness.page.getByText('Current price evidence', { exact: true }).click();
    } else {
      if (surface === 'Show') await harness.page.getByRole('button', { name: 'Show mode', exact: true }).click();
      await harness.page.keyboard.press('Control+k');
      const dialog = harness.page.getByRole('dialog', { name: 'Quick mode' });
      await dialog.getByRole('searchbox').fill('charmeleon');
      await dialog
        .getByRole('region', { name: 'Cards' })
        .getByRole('button', { name: /^Charmeleon, 151 / })
        .first()
        .click();
      await dialog.getByTestId('quick-card-check').getByRole('textbox', { name: /price/i }).press('Enter');
    }
    const comparison = harness.page.getByRole('region', { name: 'Price comparisons' });
    const query =
      surface === 'detail' || surface === 'analytics'
        ? 'Bulbasaur 44 Base Set non holo -reverse'
        : 'Charmeleon 005 151 non holo -reverse';
    await links(comparison, query);
    expect(requests).toBe(0);
    for (const link of await comparison.getByRole('link').all()) {
      await harness.expectMinTapTarget(link);
      await link.scrollIntoViewIfNeeded();
      await harness.expectHittable(link);
    }
    await context.setOffline(true);
    await links(comparison, query);
    await context.setOffline(false);
    await comparison.getByRole('button', { name: 'Check prices', exact: true }).click();
    await links(comparison, 'saved');
    expect(requests).toBe(2);
    if (surface === 'Show' || surface === 'Quick') {
      await harness.page.getByRole('radio', { name: /reverse/i }).click();
      await links(comparison, 'Charmeleon 005 151 reverse holo');
      expect(requests).toBe(2);
    }
    await harness.expectNoHorizontalOverflow();
  });
}

test('Pokémon Center identity stays stamped through holo and reverse searches', async ({ harness }) => {
  let requests = 0;
  await harness.page.route('**/app/api/card-price-checks?**', (route) => {
    requests++;
    return route.abort();
  });
  await harness.page.route('**/app/api/tcg-card-search**', (route) =>
    route.fulfill({
      json: {
        // Synthetic decorated printing with two finishes to exercise switching.
        cards: [
          {
            id: 'mep-001~12345',
            localId: '001~12345',
            name: 'Bulbasaur (Pokémon Center)',
            set: { id: 'mep', name: 'MEP Black Star Promos' },
            dexIds: [1],
            variants: { holo: true, reverse: true },
          },
        ],
        hasMore: false,
      },
    }),
  );
  await harness.page.keyboard.press('Control+k');
  const dialog = harness.page.getByRole('dialog', { name: 'Quick mode' });
  await dialog.getByRole('searchbox').fill('pokemon center');
  await dialog
    .getByRole('region', { name: 'Cards' })
    .getByRole('button', { name: /Bulbasaur/ })
    .first()
    .click();
  const check = dialog.getByTestId('quick-card-check');
  await expect(check).toContainText('Bulbasaur (Pokémon Center)');
  await check.getByRole('textbox', { name: /price/i }).press('Enter');
  const comparison = check.getByRole('region', { name: 'Price comparisons' });
  await check.getByRole('radio', { name: 'Holo', exact: true }).click();
  await links(comparison, 'Bulbasaur 001 Pokémon Center holo -reverse');
  await check.getByRole('radio', { name: /reverse/i }).click();
  await links(comparison, 'Bulbasaur 001 Pokémon Center reverse holo');
  expect(requests).toBe(0);
  await harness.expectNoHorizontalOverflow();
});

test('Classic Collection links use printed numbers before checks, after old saved results and offline', async ({
  harness,
  context,
}) => {
  let requests = 0;
  await harness.page.route('**/app/api/tcg-card-search**', (route) =>
    route.fulfill({
      json: {
        // Real catalog identity, synthetic search response and empty comparison samples.
        cards: [
          {
            id: '30th-c-018',
            localId: '018',
            name: 'Gengar',
            set: { id: '30th-c', name: '30th Classic Collection' },
            dexIds: [94],
            variants: { holo: true },
          },
        ],
        hasMore: false,
      },
    }),
  );
  await harness.page.route('**/app/api/card-price-checks?**', (route) => {
    requests++;
    const check = {
      summary: { currency: 'GBP', count: 0, median: null, low: null, high: null },
      checkedAt: new Date().toISOString(),
      searchUrl: 'https://www.ebay.co.uk/sch/i.html?_nkw=Gengar+018+30th+Classic+Collection',
    };
    return route.fulfill({
      json: {
        ebay: { ...check, summary: { ...check.summary, kind: 'asking' } },
        soldcomps: { ...check, summary: { ...check.summary, kind: 'sold' } },
        errors: {},
      },
    });
  });
  await harness.page.keyboard.press('Control+k');
  const dialog = harness.page.getByRole('dialog', { name: 'Quick mode' });
  await dialog.getByRole('searchbox').fill('gengar');
  await dialog
    .getByRole('region', { name: 'Cards' })
    .getByRole('button', { name: /Gengar/ })
    .first()
    .click();
  const check = dialog.getByTestId('quick-card-check');
  await check.getByRole('textbox', { name: /price/i }).press('Enter');
  const comparison = check.getByRole('region', { name: 'Price comparisons' });
  const query = 'Gengar 94/102 30th Classic Collection holo -reverse';
  await links(comparison, query);
  expect(requests).toBe(0);
  await comparison.getByRole('button', { name: 'Check prices', exact: true }).click();
  await expect(comparison.getByRole('button', { name: 'Refresh prices', exact: true })).toBeEnabled();
  expect(requests).toBe(2);
  await links(comparison, query);
  await context.setOffline(true);
  await links(comparison, query);
  for (const link of await comparison.getByRole('link').all()) {
    await harness.expectMinTapTarget(link);
    await link.scrollIntoViewIfNeeded();
    await harness.expectHittable(link);
  }
  await harness.expectNoHorizontalOverflow();
});
