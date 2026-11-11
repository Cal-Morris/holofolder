import { test, expect } from './fixtures';

test.describe('settings', () => {
  test.use({ signedIn: true });

  // A reload paints this device's saved copy while the account check runs, then swaps in the live binder.
  // Settings opened on the saved copy used to close itself when that swap unmounted it.
  test('Settings opened for the first time stays open', async ({ harness }) => {
    const { page } = harness;
    // Hold the account check's membership read until Settings is open, so the swap lands while it is.
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/rest/v1/partnerships*', async (route) => {
      await held;
      await route.fallback();
    });
    await page.reload();
    await page
      .getByRole('navigation', { name: 'Binder navigation' })
      .getByRole('button', { name: 'More', exact: true })
      .click();
    await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
    await expect(dialog).toBeVisible();
    release();
    await page.waitForTimeout(1000);
    await expect(dialog).toBeVisible();
    // Once it closes, the live binder takes over.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: 'Edit layout', exact: true })).toBeEnabled();
  });
});
