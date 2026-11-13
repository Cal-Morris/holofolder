import { test, expect, type Harness } from './fixtures';
import type { Locator } from '@playwright/test';

// Simulates the browser reporting "offline" (the network itself stays up so lazy chunks,
// which the service worker would serve in the real PWA, still load in the test).
async function goOffline(harness: Harness) {
  await harness.page.evaluate(() => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false });
    window.dispatchEvent(new Event('offline'));
  });
  await expect(harness.page.getByText(/^Offline · /)).toBeVisible();
}

function intersects(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

async function expectBannerClearOf(harness: Harness, dialog: Locator) {
  const banner = harness.page.locator('[data-top-banner-slot] > *').first();
  await expect(banner).toBeVisible();
  const bannerBox = (await banner.boundingBox())!;
  const close = harness.closeControl(dialog);
  await expect(close).toBeVisible();
  await expect.poll(async () => (await close.boundingBox()) !== null).toBe(true);
  expect(intersects(bannerBox, (await close.boundingBox())!), 'banner must not overlap the close button').toBe(false);
  await harness.expectHittable(close);
  await harness.expectWithinSafeViewport(close);
  // The sheet itself starts below the banner, so the pill never sits on top of its header.
  const dialogBox = (await dialog.boundingBox())!;
  expect(dialogBox.y, 'sheet starts below the banner').toBeGreaterThanOrEqual(bannerBox.y + bannerBox.height);
}

test.describe('top banner slot (offline / sync pill) with overlays', () => {
  test('card detail close button is never covered by the offline banner', { tag: '@matrix' }, async ({ harness }) => {
    await goOffline(harness);
    const dialog = await harness.openCardDetail();
    await expectBannerClearOf(harness, dialog);
    await harness.closeControl(dialog).click();
    await expect(dialog).toBeHidden();
    // Back on top of the page once no overlay is open.
    await expect(harness.page.locator('[data-top-banner-slot]')).not.toHaveAttribute('data-overlay-open', '');
  });

  test('all cards view close button is never covered by the offline banner', async ({ harness }) => {
    await goOffline(harness);
    const detail = await harness.openCardDetail();
    await detail.getByRole('button', { name: /all bulbasaur cards/i }).click();
    const dialog = harness.page.getByRole('dialog', { name: /all bulbasaur cards/i });
    await expect(dialog).toBeVisible();
    await expectBannerClearOf(harness, dialog);
  });

  test('the banner yields to any open overlay', async ({ harness }) => {
    await goOffline(harness);
    await harness.page.getByRole('button', { name: 'View', exact: true }).click();
    const sheet = harness.page.getByRole('dialog', { name: 'View options' });
    await expect(sheet).toBeVisible();
    await expect(harness.page.locator('[data-top-banner-slot]')).toHaveAttribute('data-overlay-open', '');
    await harness.expectHittable(harness.closeControl(sheet));
  });
});
