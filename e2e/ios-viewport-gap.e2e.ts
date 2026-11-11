import { test, expect, emulateStandalone, type Harness } from './fixtures';
import type { Page } from '@playwright/test';
import { seedWantList } from './wanted-fixtures';

// iOS 26 installed apps can get a web view that is short at the bottom by the status-bar height
// (lib/ios-viewport-gap.ts). Then the dock drops its duplicate home-indicator padding and sits near
// the bottom of the tappable view; everywhere else (browser tabs, a full-height installed app, a view
// below an opaque status bar) the dock keeps clear of the home indicator exactly as before.

async function fakeScreen(page: Page, width: number, height: number) {
  await page.addInitScript(
    ([w, h]) => {
      Object.defineProperty(window.screen, 'width', { get: () => w, configurable: true });
      Object.defineProperty(window.screen, 'height', { get: () => h, configurable: true });
    },
    [width, height],
  );
}

async function setInsets(page: Page, top: number, bottom: number) {
  const session = await page.context().newCDPSession(page);
  await session
    .send('Emulation.setSafeAreaInsetsOverride' as never, { insets: { top, bottom, left: 0, right: 0 } } as never)
    .catch(() => undefined);
}

async function dockBar(harness: Harness) {
  const bar = harness.dock().locator(':scope > div').first();
  await expect(bar).toBeVisible();
  return (await bar.boundingBox())!;
}

async function reloadAt(harness: Harness, width: number, height: number) {
  await harness.page.setViewportSize({ width, height });
  await harness.page.reload();
  await expect(harness.page.locator('button[data-dex-id="1"]').first()).toBeVisible();
  await harness.page.waitForTimeout(150);
}

test.describe('installed app', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(
      !testInfo.project.metadata?.standalone || !testInfo.project.name.includes('390'),
      'one installed-app run',
    );
  });

  test('a short iOS 26 view: the dock drops the duplicate padding and stays inside the view', async ({ harness }) => {
    // 393x852 phone, 59px status bar: the view is 852 - 59 = 793 tall.
    await fakeScreen(harness.page, 393, 852);
    await reloadAt(harness, 393, 793);
    await expect(harness.page.locator('html')).toHaveAttribute('data-ios-viewport-gap', '59');
    const bar = await dockBar(harness);
    expect(bar.y + bar.height, 'dock sits near the bottom of the view').toBeGreaterThanOrEqual(793 - 12);
    expect(bar.y + bar.height, 'dock stays inside the tappable view').toBeLessThanOrEqual(793 + 0.5);
    for (const name of ['Search', 'Binder', 'List', 'Wanted', 'Browse'])
      await harness.expectHittable(harness.dock().getByRole('button', { name, exact: true }));
    await harness.expectNoHorizontalOverflow();
  });

  test('a full-height view keeps the dock clear of the home indicator', async ({ harness }) => {
    await fakeScreen(harness.page, 393, 852);
    await reloadAt(harness, 393, 852);
    await expect(harness.page.locator('html')).toHaveAttribute('data-ios-viewport-gap', '0');
    const bar = await dockBar(harness);
    expect(bar.y + bar.height).toBeLessThanOrEqual(852 - harness.insets.bottom + 0.5);
    expect(bar.y + bar.height).toBeGreaterThanOrEqual(852 - harness.insets.bottom - 12);
  });

  test('a view below an opaque status bar (no top inset) keeps the home-indicator padding', async ({ harness }) => {
    await fakeScreen(harness.page, 393, 852);
    await setInsets(harness.page, 0, 34);
    await reloadAt(harness, 393, 793);
    await expect(harness.page.locator('html')).toHaveAttribute('data-ios-viewport-gap', '0');
    const bar = await dockBar(harness);
    expect(bar.y + bar.height).toBeLessThanOrEqual(793 - 34 + 0.5);
  });
});

// Sheets and dialogs pad from --safe-bottom: the home-indicator inset minus the dead band.
for (const [label, height, gap] of [
  ['short iOS 26 view', 793, 59],
  ['full-height view', 852, 0],
] as const) {
  test.describe(`installed app, ${label}: sheets and dialogs`, () => {
    test.use({ signedIn: true });
    test.beforeEach(({}, testInfo) => {
      test.skip(
        !testInfo.project.metadata?.standalone || !testInfo.project.name.includes('390'),
        'one installed-app run',
      );
    });

    test('a bottom sheet pads once for the home indicator', async ({ harness }) => {
      const { page } = harness;
      await seedWantList(page);
      await fakeScreen(page, 393, 852);
      await reloadAt(harness, 393, height);
      await expect(page.locator('html')).toHaveAttribute('data-ios-viewport-gap', String(gap));
      await harness.dock().getByRole('button', { name: 'Wanted', exact: true }).click();
      await expect(page.getByTestId('wanted-row')).toHaveCount(6);
      await page.getByTestId('wanted-sort-filter').click();
      const sheet = page.getByRole('dialog', { name: 'Sort and filter want list' });
      await expect(sheet).toBeVisible();
      await page.waitForTimeout(400);
      const padding = await sheet.evaluate((element) => parseFloat(getComputedStyle(element).paddingBottom));
      expect(padding).toBeCloseTo(12 + (gap ? 0 : harness.insets.bottom), 0);
      const box = (await sheet.boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(height + 0.5);
      await harness.expectHittable(sheet.getByRole('button', { name: /^Show \d+ cards?$/ }));
    });

    test("Show mode's search, deal check and bundle footers pad once for the home indicator", async ({ harness }) => {
      const { page } = harness;
      await fakeScreen(page, 393, 852);
      await reloadAt(harness, 393, height);
      await expect(page.locator('html')).toHaveAttribute('data-ios-viewport-gap', String(gap));
      await page.getByRole('button', { name: 'Show mode', exact: true }).click();
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Quick mode' });
      const expected = 12 + (gap ? 0 : harness.insets.bottom);
      const footerPadding = (scope: ReturnType<Page['getByTestId']>) =>
        scope.evaluate((element) =>
          parseFloat(getComputedStyle(element.querySelector('.border-t.bg-card\\/95') ?? element).paddingBottom),
        );
      const footerBottom = (scope: ReturnType<Page['getByTestId']>) =>
        scope.evaluate(
          (element) => (element.querySelector('.border-t.bg-card\\/95') ?? element).getBoundingClientRect().bottom,
        );

      const search = dialog.getByRole('searchbox');
      await expect(search).toBeVisible();
      const searchFooter = await search.evaluate((element) => {
        const footer = element.closest('.border-t') as HTMLElement;
        return {
          padding: parseFloat(getComputedStyle(footer).paddingBottom),
          bottom: footer.getBoundingClientRect().bottom,
        };
      });
      expect(searchFooter.padding).toBeCloseTo(expected, 0);
      expect(searchFooter.bottom).toBeLessThanOrEqual(height + 0.5);

      await search.fill('charizard');
      await dialog
        .getByRole('region', { name: 'Cards' })
        .getByRole('button', { name: /^Charizard ex, 151 / })
        .first()
        .click();
      const check = dialog.getByTestId('quick-card-check');
      await expect(check).toBeVisible();
      expect(await footerPadding(check)).toBeCloseTo(expected, 0);
      expect(await footerBottom(check)).toBeLessThanOrEqual(height + 0.5);

      await check.getByRole('button', { name: 'Add to bundle' }).click();
      await check.getByRole('button', { name: 'Back to results' }).click();
      await dialog.getByRole('button', { name: /^Bundle · 1 card/ }).click();
      const bundle = dialog.getByTestId('quick-bundle');
      await expect(bundle).toBeVisible();
      expect(await footerPadding(bundle)).toBeCloseTo(expected, 0);
      expect(await footerBottom(bundle)).toBeLessThanOrEqual(height + 0.5);
    });

    test('a dialog stops above the dock and home indicator', async ({ harness }) => {
      const { page } = harness;
      await fakeScreen(page, 393, 852);
      await reloadAt(harness, 393, height);
      await expect(page.locator('html')).toHaveAttribute('data-ios-viewport-gap', String(gap));
      await page.getByRole('button', { name: 'More', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Settings' }).click();
      const settings = page.getByRole('dialog', { name: /settings/i });
      await expect(settings).toBeVisible();
      await page.waitForTimeout(400);
      const box = (await settings.boundingBox())!;
      const dock = (await harness.dock().boundingBox())!;
      expect(box.y + box.height).toBeCloseTo(dock.y - 12, 0);
    });
  });
}

test.describe('browser tab', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(
      Boolean(testInfo.project.metadata?.standalone) || !testInfo.project.name.includes('390'),
      'one browser-tab run',
    );
  });

  test('toolbars make the view shorter than the screen, and nothing changes', async ({ harness }) => {
    await fakeScreen(harness.page, 393, 852);
    await setInsets(harness.page, 59, 34);
    await reloadAt(harness, 393, 793);
    await expect(harness.page.locator('html')).toHaveAttribute('data-ios-viewport-gap', '0');
    const bar = await dockBar(harness);
    expect(bar.y + bar.height).toBeLessThanOrEqual(793 - 34 + 0.5);
  });

  test('standalone emulation is what switches it on', async ({ page, harness }) => {
    await emulateStandalone(page, { top: 59, bottom: 34, left: 0, right: 0 });
    await fakeScreen(page, 393, 852);
    await reloadAt(harness, 393, 793);
    await expect(page.locator('html')).toHaveAttribute('data-ios-viewport-gap', '59');
  });
});
