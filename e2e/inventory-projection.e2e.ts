import { test, expect, emulateStandalone, mockBackends, Harness } from './fixtures';
import { inventoryProjectionPrices } from '../tests/fixtures/inventory-browse';

// Synthetic mixed copies and saved quotes, no providers, DB or production routes.
test('Inventory storage totals, explicit destinations and saved raw references survive filtering and offline', async ({
  page,
  standalone,
  insets,
  baseURL,
}) => {
  if (standalone) await emulateStandalone(page, insets);
  await mockBackends(page, page.context(), { signedIn: false, baseURL });
  const batches: string[][] = [];
  await page.route('**/api/card-prices?*', async (route) => {
    expect(route.request().method()).toBe('GET');
    const cards: { cardId: string }[] = JSON.parse(new URL(route.request().url()).searchParams.get('cards')!);
    batches.push(cards.map((c) => c.cardId));
    await route.fulfill({
      json: { prices: inventoryProjectionPrices().filter((p) => cards.some((c) => c.cardId === p.cardId)) },
    });
  });
  await page.goto('/app/e2e-harness/inventory');
  const inventory = page.getByRole('region', { name: 'Inventory', exact: true });
  await expect(inventory.locator('p[aria-live]')).toHaveText('5 cards');
  await page.getByRole('combobox', { name: 'Harness evidence' }).selectOption('projection');
  // One line says what the collection is worth and how many cards that covers; the breakdown opens under it.
  const totals = page.getByRole('region', { name: 'Collection totals' });
  await expect(totals.locator('summary').first()).toContainText('Worth about £25.00 · 4 of 5 cards priced');
  await totals.locator('summary').first().click();
  await expect(totals).toContainText('6 cards · 2 wanted · 1 Pokémon');
  await expect(totals).toContainText("1 graded card isn't valued, so it's left out of the total");
  const list = page.getByRole('list', { name: 'Owned copies' });
  await expect(list.getByText('Synthetic Snorlax', { exact: true })).toHaveCount(3);
  await expect(list.getByText('Synthetic Trainer', { exact: true })).toBeVisible();
  await expect(list.getByText('Synthetic Energy', { exact: true })).toBeVisible();
  // A graded card shows what an ungraded copy is worth, and says so.
  await expect(list.getByText('£10.00 ungraded')).toBeVisible();
  await page.getByText('Wanted cards and where they go', { exact: true }).click();
  const wants = page.getByRole('list', { name: 'Wanted cards' }).getByRole('listitem');
  await expect(wants).toHaveCount(2);
  await expect(wants.first()).toHaveText('Synthetic Trainer · Alpha · Page 1 · Pocket 1');
  await expect(page.getByRole('list', { name: 'Wanted cards' })).not.toContainText('alpha-empty');
  expect(batches.filter((b) => b.includes('synthetic-snorlax'))).toEqual([
    ['synthetic-snorlax', 'synthetic-trainer', 'synthetic-energy'],
  ]);
  const place = (name: string) =>
    page.getByRole('group', { name: 'Show cards from', exact: true }).getByRole('button', { name, exact: true });
  await place('Alpha').click();
  await expect(totals).toContainText('1 card · 2 wanted · 1 Pokémon');
  await expect(totals.locator('summary').first()).toContainText('Worth about £10.00 · 1 of 1 cards priced');
  await expect(list.getByRole('button')).toHaveCount(1);
  await page.context().setOffline(true);
  await place('All collections').click();
  await page.getByRole('searchbox', { name: 'Search inventory' }).fill('trainer');
  await expect(list.getByRole('button')).toHaveCount(1);
  // The total covers the whole collection, whatever is searched for.
  await expect(totals.locator('summary').first()).toContainText('Worth about £25.00');
  await new Harness(page, insets, false).expectNoHorizontalOverflow();
  await page.getByRole('combobox', { name: 'Harness evidence' }).selectOption('cached');
  await expect(inventory.locator('[data-saved-state]')).toContainText('last saved on this device');
  await page.getByRole('combobox', { name: 'Harness account' }).selectOption('synthetic-other');
  await expect(page.getByRole('heading', { name: "Your cards couldn't be loaded" })).toBeVisible();
  await expect(totals).toHaveCount(0);
  await expect(list).toHaveCount(0);
});

test('Inventory caps confidence for an older regional source after finish selection', async ({
  page,
  standalone,
  insets,
  baseURL,
}) => {
  if (standalone) await emulateStandalone(page, insets);
  await mockBackends(page, page.context(), { signedIn: false, baseURL });
  await page.route('**/api/card-prices?*', async (route) => {
    const prices = inventoryProjectionPrices();
    for (const price of prices) {
      const finish = price.finishPrices![0];
      finish.confidence = 'high';
      finish.updatedAt = new Date().toISOString();
      finish.sourcePrices = [
        {
          source: 'cardmarket',
          label: 'Synthetic older regional evidence',
          variantLabel: null,
          marketGbpAmount: finish.gbpAmount,
          lowGbpAmount: null,
          originalMarketAmount: 13,
          originalLowAmount: null,
          originalCurrency: 'EUR',
          updatedAt: '2020-01-01T00:00:00Z',
        },
      ];
    }
    await route.fulfill({ json: { prices } });
  });
  await page.goto('/app/e2e-harness/inventory');
  await page.getByRole('combobox', { name: 'Harness evidence' }).selectOption('projection');
  const list = page.getByRole('list', { name: 'Owned copies' });
  // An old source cannot back a confident price: every priced card is marked rough, none is shown as firm.
  const priced = list.getByRole('button').filter({ hasText: '£' });
  await expect(priced).toHaveCount(5);
  await expect(priced.filter({ hasText: '· rough' })).toHaveCount(5);
  await expect(list.getByText(/ungraded/)).toBeVisible();
  await new Harness(page, insets, false).expectNoHorizontalOverflow();
});
