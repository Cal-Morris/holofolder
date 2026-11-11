import { test as base, expect } from '@playwright/test';
import { E2E_USER, SEEDED_COLLECTION, test } from './fixtures';

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

// BinderStart races this device's saved binder against the server's collection (here delayed on purpose).
test.describe('binder start', () => {
  test.use({ signedIn: true });
  const snapshot = JSON.stringify({
    ownerUserId: E2E_USER.id,
    savedAt: '2026-01-01T00:00:00.000Z',
    collection: SEEDED_COLLECTION,
  });

  test('paints the saved binder without waiting for the server', async ({ harness }) => {
    const { page } = harness;
    await page.addInitScript(
      ({ snapshot, marker }) => {
        window.localStorage.setItem('pokemon_collection_snapshot_v1', snapshot);
        window.localStorage.setItem('binderdex_start_v1', marker);
      },
      {
        snapshot,
        marker: JSON.stringify({ userId: E2E_USER.id, ownerUserId: E2E_USER.id, binderId: null, binders: [] }),
      },
    );
    const started = Date.now();
    // The server's collection would take 20 s; the binder has to come from the saved one.
    await page.goto('/app/e2e-harness/binder-start?serverDelay=20000', { waitUntil: 'commit' });
    await expect(harness.dock()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('button[data-dex-id="1"]').first()).toBeVisible();
    expect(Date.now() - started).toBeLessThan(15_000);
    await expect(page.getByTestId('binder-skeleton')).toHaveCount(0);
  });

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

  test("another account's saved binder is not shown", async ({ harness }) => {
    const { page } = harness;
    await page.addInitScript(
      ({ snapshot, marker }) => {
        window.localStorage.setItem('pokemon_collection_snapshot_v1', snapshot);
        window.localStorage.setItem('binderdex_start_v1', marker);
      },
      {
        snapshot: JSON.stringify({ ownerUserId: 'someone-else', savedAt: 'x', collection: SEEDED_COLLECTION }),
        marker: JSON.stringify({ userId: 'someone-else', ownerUserId: 'someone-else', binderId: null, binders: [] }),
      },
    );
    await page.goto('/app/e2e-harness/binder-start?serverDelay=3000', { waitUntil: 'commit' });
    await expect(page.getByTestId('binder-skeleton')).toBeVisible();
    await page.waitForTimeout(1_000);
    await expect(harness.dock()).toHaveCount(0);
    await expect(harness.dock()).toBeVisible({ timeout: 30_000 });
  });
});
