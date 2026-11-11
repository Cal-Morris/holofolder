import { test, expect } from './fixtures';
import { clearCardPriceCache, mockCardPrices } from './price-fixtures';

// The National Dex dashboard (binder value, collection overview) that signed-out visitors browse.
// Native owners get their own Analytics view (e2e/native-analytics.e2e.ts).
test.describe('analytics dashboard', () => {
  test('binder and Analytics include TCGplayer-only exact-finish prices', async ({ harness }) => {
    const page = harness.page;
    // Synthetic prices from two providers, never live market data.
    await mockCardPrices(page, {
      'base1-44': { market: 12, confidence: 'high', finishes: [{ finish: 'normal', market: 12 }] },
      'base1-46': { source: 'tcgplayer', market: 8, confidence: 'medium', finishes: [{ finish: 'normal', market: 8 }] },
    });
    await harness.reload();
    const value = page.getByRole('button', { name: 'View binder value in Analytics' });
    await expect(value).toContainText('£20.00');
    await expect(value).toContainText('2 of 2 owned cards priced');
    await expect(value).toContainText('All price sources');
    await value.click();
    const overview = page.getByRole('region', { name: 'Collection overview' });
    await expect(overview.getByText('£20.00', { exact: true })).toBeVisible();
    await expect(overview.getByText('2 of 2 owned cards priced', { exact: false })).toBeVisible();
    await harness.expectNoHorizontalOverflow();
    await page.context().setOffline(true);
    await expect(overview.getByText('£20.00', { exact: true })).toBeVisible();
    await page.context().setOffline(false);
  });
  test('generic prices are included and marked as finish estimates', async ({ harness }) => {
    const page = harness.page;
    // Synthetic generic headline quote, no verified finish row.
    await mockCardPrices(page, { 'base1-44': { source: 'tcgplayer', market: 12, confidence: 'medium' } });
    await harness.reload();
    const value = page.getByRole('button', { name: 'View binder value in Analytics' });
    await expect(value).toContainText('£12.00');
    await expect(value).toContainText('Includes 1 finish estimate');
    await value.click();
    const overview = page.getByRole('region', { name: 'Collection overview' });
    await expect(overview.getByText('0 exact finish · 1 finish estimate', { exact: false })).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Explore collection cards' }).getByText('Finish estimate', { exact: true }),
    ).toBeVisible();
  });
  test('binder value leads to a readable market valuation without paid checks', async ({ harness }) => {
    const page = harness.page;
    let checks = 0;
    await page.route('**/app/api/card-price-checks**', (route) => {
      checks++;
      return route.fulfill({ json: { ebay: null, soldcomps: null, errors: {} } });
    });
    // Synthetic Cardmarket prices, no live provider calls.
    await mockCardPrices(page, {
      'base1-44': { market: 12, confidence: 'high', finishes: [{ finish: 'normal', market: 12 }] },
    });
    await harness.reload();
    const value = page.getByRole('button', { name: 'View binder value in Analytics' });
    await expect(value).toContainText('£12.00');
    await expect(value).toContainText('1 of 2');
    await harness.expectMinTapTarget(value);
    await value.click();
    const overview = page.getByRole('region', { name: 'Collection overview' });
    await expect(overview.getByRole('heading', { name: 'Binder value' })).toBeVisible();
    await expect(overview.getByText('Market estimate', { exact: false })).toBeVisible();
    const amount = overview.getByText('£12.00', { exact: true });
    const geometry = await amount.evaluate((node) => ({
      font: parseFloat(getComputedStyle(node).fontSize),
      width: node.parentElement!.getBoundingClientRect().width,
    }));
    expect(geometry.font).toBeGreaterThanOrEqual(32);
    expect(geometry.width).toBeGreaterThan(300);
    expect(checks).toBe(0);
    // Paid valuation refinement is for owners; a visitor's dashboard never offers it.
    await expect(page.getByRole('button', { name: 'Refine valuation', exact: true })).toHaveCount(0);
    await harness.expectNoHorizontalOverflow();
  });
  for (const theme of ['light', 'dark']) {
    test(`collection breakdown and card paths in ${theme}`, async ({ harness }, testInfo) => {
      const page = harness.page;
      // Synthetic exact-finish prices, never real provider requests.
      await mockCardPrices(page, {
        'base1-44': { market: 12, confidence: 'high', finishes: [{ finish: 'normal', market: 12 }] },
      });
      await clearCardPriceCache(page);
      await harness.reload();
      await page.evaluate((theme) => document.documentElement.classList.toggle('dark', theme === 'dark'), theme);
      await page.getByRole('button', { name: 'More', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Analytics', exact: true }).click();
      const overview = page.getByRole('region', { name: 'Collection overview' });
      await expect(overview.getByText('£12.00', { exact: true })).toBeVisible();
      await expect(overview.getByText('1 of 2 owned cards priced', { exact: false })).toBeVisible();
      await harness.expectNoHorizontalOverflow();
      await page.screenshot({ path: testInfo.outputPath(`analytics-${theme}.png`) });
      const cards = page.getByRole('region', { name: 'Explore collection cards' });
      await overview.getByRole('button', { name: '1 unpriced, excluded from value' }).click();
      await expect(cards.getByRole('button', { name: 'Browse Charmander cards' })).toBeVisible();
      await page.getByRole('region', { name: 'Owned cards by set' }).getByRole('button', { name: 'Base Set' }).click();
      await expect(cards.getByRole('button', { name: 'Browse Bulbasaur cards' })).toBeVisible();
      await expect(cards.getByRole('button', { name: 'Browse Charmander cards' })).toBeVisible();
      const browse = cards.getByRole('button', { name: 'Browse Bulbasaur cards' });
      await harness.expectMinTapTarget(browse);
      await browse.click();
      const dialog = page.getByRole('dialog', { name: 'All Bulbasaur cards', exact: true });
      await expect(dialog).toBeVisible();
      await harness.closeControl(dialog).click();
      await cards.getByRole('button', { name: 'Price details for Bulbasaur' }).click();
      await expect(page.getByRole('region', { name: 'Card price history' })).toBeFocused();
      await expect(page.getByLabel('History card', { exact: true })).toHaveValue(/base1-44/);
      await page.context().setOffline(true);
      await expect(page.getByText('Offline, showing cached collection', { exact: false })).toBeVisible();
      await harness.expectNoHorizontalOverflow();
      await page.context().setOffline(false);
    });
  }
  test('desktop overview uses two columns', async ({ harness }, testInfo) => {
    test.skip(testInfo.project.name !== 'browser-390x844', 'One desktop check');
    await harness.page.setViewportSize({ width: 1440, height: 1000 });
    await harness.page.getByRole('button', { name: 'More', exact: true }).click();
    await harness.page.getByRole('menuitem', { name: 'Analytics', exact: true }).click();
    const sets = await harness.page.getByRole('region', { name: 'Owned cards by set' }).boundingBox();
    const cards = await harness.page.getByRole('region', { name: 'Explore collection cards' }).boundingBox();
    expect(cards!.x).toBeGreaterThan(sets!.x + sets!.width);
    await harness.expectNoHorizontalOverflow();
    await harness.page.screenshot({ path: testInfo.outputPath('analytics-desktop.png') });
  });
});
