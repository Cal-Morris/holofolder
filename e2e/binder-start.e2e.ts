import { test as base, expect } from '@playwright/test';
import { E2E_USER, test } from './fixtures';

// The binder's prerendered HTML is a skeleton of the binder (header, card pockets, dock), not a spinner,
// so something binder-shaped paints before any JavaScript runs.
base('/app/app-shell paints a binder skeleton before JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto('/app/app-shell');
  const skeleton = page.getByTestId('binder-skeleton');
  await expect(skeleton).toBeVisible();
  await expect(skeleton).toHaveAttribute('aria-busy', 'true');
  await expect(skeleton.locator('[data-skeleton="pocket"]:visible')).toHaveCount(9);
  // The app's own frame is already there: brand, and the dock's destinations on a phone.
  await expect(skeleton.getByText('Holo Folder', { exact: true })).toBeVisible();
  await expect(skeleton.getByText('Inventory', { exact: true }).last()).toBeVisible();
  await expect(page.locator('.animate-spin')).toHaveCount(0);
  await context.close();
});

// BinderStart shows the skeleton until the server's collection arrives (here delayed on purpose).
test.describe('binder start', () => {
  test.use({ signedIn: true });
  test("a first visit shows the skeleton until the server's binder arrives", async ({ harness }) => {
    const { page } = harness;
    await page.goto('/app/e2e-harness/binder-start?serverDelay=3000', { waitUntil: 'commit' });
    await expect(page.getByTestId('binder-skeleton')).toBeVisible();
    await expect(harness.dock()).toHaveCount(0);
    await expect(harness.dock()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('button[data-dex-id="1"]').first()).toBeVisible();
    expect(
      JSON.parse((await page.evaluate(() => window.localStorage.getItem('binderdex_start_v1'))) ?? 'null'),
    ).toEqual({ userId: E2E_USER.id, ownerUserId: E2E_USER.id, binderId: null, binders: [] });
  });
});
