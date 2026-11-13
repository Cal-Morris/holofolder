import { test, expect, openSettingsPage, type Harness } from './fixtures';

// Show mode's offline prep: "Download scanner for offline" fetches the picture scanner's model, runtime and
// fingerprint index into IndexedDB, shows progress and size, and can be removed. The files are synthetic stand-ins
// (a few bytes each) routed in place of assets.holofolder.com; no real model runs here.

test.use({ signedIn: true });

const ASSETS = 'https://assets.holofolder.com/pokemon/tcg';
const DIM = 384;

async function mockScannerAssets(harness: Harness) {
  const requests: string[] = [];
  await harness.page.route(`${ASSETS}/**`, (route) => {
    const url = route.request().url();
    requests.push(url.slice(ASSETS.length));
    if (url.endsWith('/manifest.json'))
      return route.fulfill({
        json: {
          version: 1,
          languages: {
            en: { count: 2, vectors: 'en-0000000000000000.bin', ids: 'en-0000000000000000.ids.json', bytes: 2 * DIM },
            ja: { count: 1, vectors: 'ja-0000000000000000.bin', ids: 'ja-0000000000000000.ids.json', bytes: DIM },
          },
        },
      });
    if (url.endsWith('en-0000000000000000.bin')) return route.fulfill({ body: Buffer.alloc(2 * DIM, 1) });
    if (url.endsWith('en-0000000000000000.ids.json')) return route.fulfill({ json: ['synthetic-1', 'synthetic-2'] });
    if (url.includes('/models/')) return route.fulfill({ body: Buffer.alloc(64, 7) });
    return route.fulfill({ status: 404, body: '' });
  });
  return requests;
}

/** Settings → Offline & app, which every binder reaches (Show mode's Prepare offline carries the same switch). */
async function openPrep(harness: Harness) {
  const { page } = harness;
  await page.locator('nav').first().getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  await openSettingsPage(page.getByRole('dialog', { name: /settings/i }), 'Offline & app');
  return page.getByRole('region', { name: 'Picture scanner', exact: true });
}

test('downloads the picture scanner for the collected languages, then removes it', async ({ harness }) => {
  const requests = await mockScannerAssets(harness);
  await harness.open();
  const section = await openPrep(harness);
  const toggle = section.getByRole('switch', { name: 'Download scanner for offline' });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(section).toContainText('best on Wi-Fi');
  await harness.expectMinTapTarget(toggle);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(section).toContainText('on this device');
  // English only: the seeded collection has no Japanese cards, so the Japanese index isn't fetched.
  expect(requests.some((url) => url.includes('/fingerprints/v1/dinov3-vits16-q8/en-'))).toBe(true);
  expect(requests.some((url) => url.includes('ja-0000000000000000'))).toBe(false);
  expect(requests.filter((url) => url.includes('/models/dinov3-vits16-q8/'))).toHaveLength(3);
  await harness.expectNoHorizontalOverflow();

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(section).toContainText('best on Wi-Fi');
});

test('a failed download says so and leaves the switch off', async ({ harness }) => {
  await harness.page.route(`${ASSETS}/**`, (route) => route.fulfill({ status: 503, body: '' }));
  await harness.open();
  const section = await openPrep(harness);
  const toggle = section.getByRole('switch', { name: 'Download scanner for offline' });
  await harness.expectMinTapTarget(toggle);
  await toggle.click();
  await expect(section.getByRole('status')).toContainText('isn’t available');
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await harness.expectNoHorizontalOverflow();
});
