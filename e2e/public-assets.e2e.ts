/* eslint-disable react-hooks/rules-of-hooks -- Playwright fixtures call use. */
import { test as base, expect } from '@playwright/test';
import { Harness, SAFE_AREA, emulateStandalone, mockBackends } from './fixtures';

const test = base.extend<{ harness: Harness }>({
  serviceWorkers: 'allow',
  harness: async ({ page, baseURL }, use, testInfo) => {
    const standalone = Boolean(testInfo.project.metadata?.standalone),
      insets = standalone ? SAFE_AREA : { top: 0, bottom: 0, left: 0, right: 0 };
    if (standalone) await emulateStandalone(page, insets);
    await mockBackends(page.context(), page.context(), { signedIn: true, baseURL });
    await use(new Harness(page, insets, true));
  },
});

test('card images use the asset domain and remain cached offline', async ({ harness }) => {
  const { page } = harness;
  await page.goto(`${harness.path}&cardArtwork=1`);
  const image = page.locator('button[data-dex-id="1"] img').first();
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((img) => (img as HTMLImageElement).currentSrc))
    .toMatch(/^https:\/\/assets\.holofolder\.com\/cards\//);
  await expect.poll(() => image.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await harness.expectNoHorizontalOverflow();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  const url = 'https://assets.holofolder.com/pokemon/tcg/cards/en/base1/44/high.webp';
  // Synthetic image responses are supplied by the context mock, including worker fetches.
  await page.evaluate(async (url) => {
    await (await fetch(url)).arrayBuffer();
  }, url);
  await expect.poll(() => page.evaluate(async (url) => Boolean(await caches.match(url)), url)).toBe(true);
  await page.context().route(url, (route) => route.abort('internetdisconnected'));
  await page.context().setOffline(true);
  expect(await page.evaluate(async (url) => (await fetch(url)).ok, url)).toBe(true);
});

test('asset requests can reuse a pre-upgrade proxy image while offline', async ({ harness }) => {
  const { page } = harness;
  await harness.open();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await page.evaluate(async () => {
    const cache = await caches.open('binderdex-v3-images');
    const proxy =
      '/app/api/card-image-proxy?url=' +
      encodeURIComponent('https://assets.tcgdex.net/en/base/base1/999/high.webp') +
      '&w=160';
    await cache.put(proxy, new Response('synthetic pre-upgrade image', { headers: { 'Content-Type': 'image/webp' } }));
  });
  await page
    .context()
    .route('https://assets.holofolder.com/pokemon/tcg/cards/en/base1/999/low.webp', (route) =>
      route.abort('internetdisconnected'),
    );
  await page.context().setOffline(true);
  const text = await page.evaluate(
    async () => await (await fetch('https://assets.holofolder.com/pokemon/tcg/cards/en/base1/999/low.webp')).text(),
  );
  expect(text).toBe('synthetic pre-upgrade image');
});
