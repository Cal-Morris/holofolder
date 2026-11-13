import { test, expect, type Harness } from './fixtures';

const header = (harness: Harness) => harness.page.getByTestId('app-header');
const pager = (harness: Harness) => harness.page.getByTestId('mobile-header-pager');

test('active binder page outline stays inside every clipping container', async ({ harness }) => {
  const { page } = harness;
  for (const viewport of [
    harness.viewport,
    { width: 768, height: 667 },
    { width: 1280, height: 800 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    await expect
      .poll(
        async () =>
          page.locator('[data-binder-page]').evaluateAll((pages) => {
            const activePage = pages.find((element) => getComputedStyle(element).boxShadow !== 'none');
            if (!activePage) return -Infinity;
            const rect = activePage.getBoundingClientRect();
            let clearance = Infinity;
            for (let parent = activePage.parentElement; parent; parent = parent.parentElement) {
              const style = getComputedStyle(parent);
              const bounds = parent.getBoundingClientRect();
              if (style.overflowX === 'hidden' || style.overflowX === 'clip') {
                clearance = Math.min(clearance, rect.left - bounds.left, bounds.right - rect.right);
              }
              if (style.overflowY === 'hidden' || style.overflowY === 'clip') {
                clearance = Math.min(clearance, rect.top - bounds.top, bounds.bottom - rect.bottom);
              }
            }
            return clearance;
          }),
        { message: `the 2px page outline must fit at ${viewport.width}×${viewport.height}` },
      )
      .toBeGreaterThanOrEqual(1.9);
    await harness.expectNoHorizontalOverflow();
  }
});

test('desktop attribution reserves space below the whole binder', async ({ harness }) => {
  for (const viewport of [
    { width: 768, height: 667 },
    { width: 1280, height: 800 },
    { width: 1920, height: 1080 },
  ]) {
    await harness.page.setViewportSize(viewport);
    const footer = harness.page.locator('footer').filter({ has: harness.page.getByTestId('credits-notice') });
    await expect(footer).toBeVisible();
    await expect
      .poll(async () => {
        const footerBox = (await footer.boundingBox())!;
        const contentBox = (await harness.page.getByTestId('main-content').boundingBox())!;
        return contentBox.y + contentBox.height - footerBox.y;
      })
      .toBeLessThanOrEqual(0.5);
    await expect
      .poll(async () => {
        const footerBox = (await footer.boundingBox())!;
        const slots = await harness.page
          .locator('button[data-dex-id]:visible')
          .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().bottom));
        return Math.max(...slots) - footerBox.y;
      })
      .toBeLessThanOrEqual(0.5);
    await harness.expectNoHorizontalOverflow();
  }
});

for (const signedIn of [false, true]) {
  test.describe(`binder header pager (${signedIn ? 'signed in' : 'signed out'})`, () => {
    test.use({ signedIn });

    test('lives in the header, fits on one row and pages the binder', { tag: '@matrix' }, async ({ harness }) => {
      await expect(pager(harness)).toBeVisible();
      const headerBox = (await header(harness).boundingBox())!;
      const pagerBox = (await pager(harness).boundingBox())!;
      expect(pagerBox.y).toBeGreaterThanOrEqual(headerBox.y - 0.5);
      expect(pagerBox.y + pagerBox.height).toBeLessThanOrEqual(headerBox.y + headerBox.height + 0.5);
      // Nothing in the pager wraps onto a second line.
      expect(pagerBox.height).toBeLessThanOrEqual(46);
      // Header controls stay on a single row (no wrapping) and inside the safe area.
      await harness.expectWithinSafeViewport(pager(harness));
      await harness.expectWithinSafeViewport(header(harness).getByRole('button', { name: 'More', exact: true }));
      await harness.expectNoHorizontalOverflow();

      const pageInput = harness.page.getByRole('spinbutton', { name: 'Binder page number' });
      const next = pager(harness).getByRole('button', { name: /^next binder/i });
      const prev = pager(harness).getByRole('button', { name: /^previous binder/i });
      await harness.expectMinTapTarget(next);
      await harness.expectMinTapTarget(prev);
      // Nothing else in the header (e.g. Sign in) covers the pager controls.
      for (const control of await pager(harness).locator('button:not([disabled])').all()) {
        if (await control.isVisible()) await harness.expectHittable(control);
      }
      await harness.expectHittable(pageInput);
      await expect(pageInput).toHaveValue('1');
      await expect(prev).toBeDisabled();
      await next.click();
      await expect(pageInput).toHaveValue('2');
      await prev.click();
      await expect(pageInput).toHaveValue('1');
    });

    test('is not shown outside the binder view', async ({ harness }) => {
      await harness.listTab().click();
      await expect(pager(harness)).toHaveCount(0);
    });
  });
}

test.describe('vertical space by the dock', { tag: '@matrix' }, () => {
  test('main content ends just above the dock in every view, never under it', async ({ harness }) => {
    const dockBar = harness.dock().locator(':scope > div').first();
    for (const tab of ['Binder', 'List', 'Wanted', 'Browse'] as const) {
      await harness.dock().getByRole('button', { name: tab, exact: true }).click();
      await expect(harness.page.getByTestId('main-content')).toBeVisible();
      const dockTop = (await dockBar.boundingBox())!.y;
      const content = await harness.page.getByTestId('main-content').evaluate((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return rect.bottom - parseFloat(style.paddingBottom);
      });
      const gap = dockTop - content;
      expect(gap, `${tab}: content must not run under the dock`).toBeGreaterThanOrEqual(0);
      expect(gap, `${tab}: no wasted band above the dock`).toBeLessThanOrEqual(14);
    }
  });

  test('the whole binder page is visible between the header and the dock', async ({ harness }) => {
    const dockTop = (await harness.dock().locator(':scope > div').first().boundingBox())!.y;
    const slots = harness.page.locator('button[data-dex-id]:visible');
    await expect(slots.first()).toBeVisible();
    const last = (await slots.last().boundingBox())!;
    expect(last.y + last.height).toBeLessThanOrEqual(dockTop);
    const first = (await slots.first().boundingBox())!;
    expect(first.y).toBeGreaterThanOrEqual(harness.insets.top);
  });
});

test('binder controls stay reachable and cards keep their full proportions', async ({ harness }) => {
  const { page } = harness;
  const checkSlots = async () => {
    await expect
      .poll(async () =>
        page.locator('button[data-dex-id]:visible').evaluateAll((elements) =>
          Math.max(
            ...elements.map((element) => {
              const rect = element.getBoundingClientRect();
              return Math.abs(rect.width / rect.height - 63 / 88);
            }),
          ),
        ),
      )
      .toBeLessThan(0.002);
  };
  const display = page.getByRole('group', { name: 'Binder display' });
  await header(harness).getByRole('button', { name: 'View', exact: true }).click();
  await expect(display).toBeVisible();
  await harness.expectMinTapTarget(display.getByRole('button', { name: '2D', exact: true }));
  await harness.expectMinTapTarget(display.getByRole('button', { name: '3D', exact: true }));
  await harness.expectHittable(display.getByRole('button', { name: '3D', exact: true }));
  await checkSlots();
  await display.getByRole('button', { name: '3D', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Your 3D National Dex binder' })).toBeVisible();
  await header(harness).getByRole('button', { name: 'View', exact: true }).click();
  await display.getByRole('button', { name: '2D', exact: true }).click();
  await page.getByRole('button', { name: 'Close view options', exact: true }).click();
  await checkSlots();
  await page.goto('/app/e2e-harness?cardArtwork=1');
  await expect(page.locator('button[data-dex-id="1"] img').first()).toHaveCSS('object-fit', 'cover');
  for (const viewport of [
    { width: 768, height: 667 },
    { width: 1280, height: 800 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    await checkSlots();
    const view = header(harness).getByRole('button', { name: 'View', exact: true });
    await expect(view).toBeVisible();
    await view.click();
    const menu = page.getByRole('dialog', { name: 'View options', exact: true });
    const desktopDisplay = menu.getByRole('group', { name: 'Binder display' });
    await expect(desktopDisplay).toBeVisible();
    await harness.expectMinTapTarget(desktopDisplay.getByRole('button', { name: '2D', exact: true }));
    await harness.expectMinTapTarget(desktopDisplay.getByRole('button', { name: '3D', exact: true }));
    await harness.expectHittable(desktopDisplay.getByRole('button', { name: '3D', exact: true }));
    await menu.getByRole('button', { name: 'Close view options', exact: true }).click();
    await expect
      .poll(
        async () =>
          (
            await page
              .locator('footer')
              .filter({ has: page.getByTestId('credits-notice') })
              .boundingBox()
          )?.height ?? Infinity,
      )
      .toBeLessThan(36);
    await harness.expectNoHorizontalOverflow();
  }
});

test.describe('search sheet', () => {
  test('filter chips are full-size tap targets and report which one is active', async ({ harness }) => {
    await harness.open();
    await harness.dock().getByRole('button', { name: 'Search', exact: true }).click();
    const dialog = harness.page.getByRole('dialog');
    await dialog.getByRole('textbox').first().fill('pika');
    const chips = dialog.locator('button[aria-pressed]');
    await expect(chips.first()).toBeVisible();
    const heights = await chips.evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().height),
    );
    expect(heights.length).toBeGreaterThan(1);
    for (const height of heights) expect(height).toBeGreaterThanOrEqual(36);
    await expect(chips.filter({ hasText: /^All/ })).toHaveAttribute('aria-pressed', 'true');
    await harness.expectNoHorizontalOverflow();
  });
});
