import { test, expect } from '@playwright/test';
import { emulateStandalone, SAFE_AREA } from './fixtures';

test.beforeEach(async ({ page }, info) => {
  if (info.project.metadata.standalone) await emulateStandalone(page, SAFE_AREA);
});

test('API key guide has readable typography, code blocks and visible AI onboarding', async ({ page }) => {
  await page.goto('/app/docs/api-keys');
  const title = page.getByRole('heading', { name: 'API keys', exact: true });
  await expect(title).toBeVisible();
  expect(await title.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(30);
  const section = page.getByRole('heading', { name: /Authentication/ });
  expect(await section.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(20);
  await expect(page.getByRole('link', { name: /Connect an AI assistant/ }).first()).toBeVisible();
  expect(
    await page
      .locator('pre')
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).paddingTop)),
  ).toBeGreaterThanOrEqual(12);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('docs search finds setup guides and keeps direct-origin navigation working', async ({ page }) => {
  await page.goto('/app/docs');
  await page
    .getByRole('button', { name: /Search/ })
    .first()
    .click();
  await page.getByRole('combobox', { name: 'Search' }).fill('Claude');
  await page
    .getByRole('option', { name: /Claude/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/app\/docs\/agents\/claude/);
  await expect(page.getByRole('heading', { name: 'Claude', exact: true })).toBeVisible();
});

test('native API explorer sends an authenticated request and displays its response', async ({ page }) => {
  await page.route('**/app/api/v1/cards?**', async (route) => {
    expect(route.request().headers().authorization).toBe('Bearer hf_SYNTHETIC.docs-test');
    await route.fulfill({ json: { data: [], nextCursor: null, requestId: 'synthetic-docs-check' } });
  });
  await page.goto('/app/docs/reference/catalog/list-cards');
  await expect(page.getByRole('heading', { name: 'Search cards', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Try in Playground/ }).click();
  await page.getByLabel('API key', { exact: true }).fill('hf_SYNTHETIC.docs-test');
  await page.getByRole('spinbutton', { name: 'limit', exact: true }).fill('10');
  await page.getByRole('button', { name: /Send/ }).click();
  await expect(page.getByText('synthetic-docs-check', { exact: false })).toBeVisible();
  expect(
    await page.evaluate(() => Object.values(localStorage).some((value) => value.includes('hf_SYNTHETIC.docs-test'))),
  ).toBe(false);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('sticky docs navigation stays below the status bar and resource groups appear once', async ({ page }, info) => {
  await page.goto('/app/docs/api-keys');
  await page.evaluate(() => window.scrollTo(0, 600));
  const search = page.getByRole('button', { name: 'Open Search', exact: true });
  await expect(search).toBeVisible();
  const bounds = await search.boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual(info.project.metadata.standalone ? SAFE_AREA.top : 0);
  await page.getByRole('button', { name: 'Open Sidebar', exact: true }).click();
  await expect(page.locator('#nd-sidebar-mobile').getByRole('button', { name: 'Catalog', exact: true })).toHaveCount(1);
  const drawer = await page.locator('#nd-sidebar-mobile').boundingBox();
  expect(drawer!.y).toBeGreaterThanOrEqual(info.project.metadata.standalone ? SAFE_AREA.top : 0);
  expect(drawer!.y + drawer!.height).toBeLessThanOrEqual(
    page.viewportSize()!.height - (info.project.metadata.standalone ? SAFE_AREA.bottom : 0),
  );
});

test('reference sidebar has compact subject groups and preserves saved operation links', async ({ page }) => {
  await page.goto('/app/docs/api-keys');
  await page.getByRole('button', { name: 'Open Sidebar', exact: true }).click();
  const sidebar = page.locator('#nd-sidebar-mobile');
  for (const name of [
    'Binders',
    'Collection',
    'History & recovery',
    'Imports',
    'Sharing & appearance',
    'Show purchases',
    'Native storage',
    'Prices',
    'Comparisons',
    'Analytics',
    'Deal checks',
  ]) {
    await expect(sidebar.getByRole('button', { name, exact: true })).toHaveAttribute('aria-expanded', 'false');
  }
  await expect(sidebar.getByRole('button', { name: 'Prices and insights', exact: true })).toHaveCount(0);
  await sidebar.getByRole('button', { name: 'Binders', exact: true }).click();
  await sidebar.getByRole('link', { name: /Create binder/ }).click();
  await expect(page).toHaveURL(/\/app\/docs\/reference\/collection\/create-binder$/);
  await expect(page.getByRole('heading', { name: 'Create binder', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open Sidebar', exact: true }).click();
  await expect(sidebar.getByRole('button', { name: 'Binders', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await sidebar.getByRole('button', { name: 'Prices', exact: true }).click();
  await sidebar.getByRole('link', { name: /Get prices/ }).click();
  await expect(page).toHaveURL(/\/app\/docs\/reference\/prices-and-insights\/get-prices$/);
  await expect(page.getByRole('heading', { name: 'Get prices', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('desktop reference sidebar uses the same subject groups', async ({ page }, info) => {
  test.skip(info.project.name !== 'browser-390x844');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/app/docs/reference/collection/create-binder');
  const sidebar = page.locator('#nd-sidebar');
  await expect(sidebar.getByRole('button', { name: 'Binders', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await expect(sidebar.getByRole('button', { name: 'History & recovery', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await sidebar.getByRole('button', { name: 'History & recovery', exact: true }).click();
  await sidebar.getByRole('link', { name: /Preview collection recovery/ }).click();
  await expect(page).toHaveURL(/\/app\/docs\/reference\/collection\/preview-collection-recovery$/);
  await expect(page.getByRole('heading', { name: 'Preview collection recovery', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
