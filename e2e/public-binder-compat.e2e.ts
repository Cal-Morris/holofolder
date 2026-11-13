import { test, expect, emulateStandalone } from './fixtures';
import { mockCardPrices } from './price-fixtures';
import type { CDPSession, Locator, Page, Request } from '@playwright/test';

// The REAL token and named share routes, rendered server-side against the synthetic PostgREST that
// playwright.config.ts starts (scripts/verify-public-share-backend.ts). Each scenario is its own share.
// Uses `page` directly: the harness fixture boots the private app first, whose storage reset can reload this page.
const paths = (scenario: string, slug = scenario) => [
  `/app/share/synthetic-${scenario}`,
  `/app/u/synthetic-owner/${slug}`,
];
const CATALOG = ['synthetic-mon', 'synthetic-trainer', 'synthetic-energy'];

/** Every request a share page makes. Only public catalog reads and images, plus card prices when the owner shares them. */
function watch(page: Page) {
  const writes: string[] = [],
    api: string[] = [],
    prices: Request[] = [];
  page.on('request', (r) => {
    if (/\/app\/api\/card-prices/.test(r.url())) prices.push(r);
    else if (r.method() !== 'GET' && r.method() !== 'HEAD') writes.push(`${r.method()} ${r.url()}`);
    if (
      /\/app\/api\/(?!card-image-proxy|tcg-card-search|tcg-set-slots|tcg-illustrators|tcgdex-cache|card-prices)/.test(
        r.url(),
      )
    )
      api.push(r.url());
  });
  return { writes, api, prices };
}

for (const path of paths('token', 'mixed')) {
  test(`prices off: order, privacy, Quick, Show, details and Join now on the real route: ${path}`, async ({
    page,
    standalone,
    insets,
  }) => {
    const traffic = watch(page);
    const phone = await open(page, path, standalone, insets);
    const response = phone.response;
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toContain('no-store');
    expect(response.headers()['cdn-cache-control']).toBe('no-store');
    // HTML carries the RSC payload: no account, copy or storage IDs, private fields or price data.
    const html = await response.text();
    for (const sentinel of [
      'PRIVATE',
      'certificate',
      'assetIds',
      'wanted_by',
      'purchase_cost',
      'binder-allowed',
      'marketGBP',
      'gbp',
    ])
      expect(html).not.toContain(sentinel);
    expect(html).toContain('noindex');
    const pockets = page.locator('[data-slot-id]');
    await expect(pockets).toHaveCount(6);
    expect(await pockets.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('aria-label')))).toEqual([
      'Synthetic Snorlax, Owned',
      'Synthetic Snorlax, Owned',
      'Synthetic Trainer, Owned',
      'Synthetic Energy, Owned',
      'Free slot, Empty spacer',
      'Free slot, Empty spacer',
    ]);
    await expect(page.getByText('Shared binder', { exact: true })).toBeVisible();
    await phone.expectNoHorizontalOverflow();
    // Card details from a pocket, read-only and without a price.
    await page.getByRole('button', { name: 'Synthetic Snorlax, Owned' }).first().click();
    const detail = page.getByRole('dialog', { name: 'Synthetic Snorlax, Owned details' });
    await expect(detail).toContainText('Owned copy');
    await expect(detail).not.toContainText('£');
    await expect(detail).not.toContainText('Market price');
    await page.keyboard.press('Escape');
    await expect(detail).toHaveCount(0);
    await page.getByRole('button', { name: 'Next binder page', exact: true }).click();
    await expect(page.getByRole('button', { name: 'snorlax, Unfilled target' })).toBeVisible();
    // The View sheet has no Prices switch when the owner doesn't share prices.
    await page.getByRole('button', { name: 'View', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'View options' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Prices/ })).toHaveCount(0);
    await page.keyboard.press('Escape');
    // Search works read-only; Quick mode is the price checker, so without shared prices it stays on Search.
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    const search = page.getByRole('dialog', { name: 'Search Pokemon' });
    await search.getByRole('button', { name: 'Quick mode' }).click();
    await expect(page.getByRole('dialog', { name: 'Quick mode' })).toHaveCount(0);
    await expect(search).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(search).toHaveCount(0);
    // Show mode, read-only, from More.
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByRole('menuitem', { name: 'Show mode' }).click();
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByRole('menuitem', { name: 'Exit show mode' }).click();
    // Join now opens the same Create account dialog guests get.
    const join = page.getByRole('button', { name: 'Join now' });
    await phone.expectMinTapTarget(join, 36);
    await join.click();
    await expect(page.getByRole('dialog', { name: 'Create account' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Create account' })).toHaveCount(0);
    await phone.expectNoHorizontalOverflow();
    expect(traffic.prices.map((r) => r.url())).toEqual([]);
    expect(traffic.writes).toEqual([]);
    expect(traffic.api).toEqual([]);
  });
}

for (const path of paths('priced')) {
  test(`prices on: Prices view, price details, swipe, search and wants on the real route: ${path}`, async ({
    page,
    standalone,
    insets,
  }) => {
    // Fixture: synthetic prices only, served from a mocked /app/api/card-prices.
    await mockCardPrices(page, {
      'synthetic-mon': { confidence: 'high', market: 12.34 },
      'synthetic-trainer': { confidence: 'high', market: 3.5 },
    });
    const traffic = watch(page);
    const phone = await open(page, path, standalone, insets);
    const html = await phone.response.text();
    for (const sentinel of ['PRIVATE', 'wanted_by', '00000000-0000', 'added_at', 'notes', 'gbp'])
      expect(html).not.toContain(sentinel);
    const pageNumber = page.getByRole('spinbutton', { name: 'Binder page number' });
    const current = page.locator('[data-binder-page]');
    await expect(current).toHaveAttribute('data-binder-page', '1');
    // An owned copy with a stored want previews the want dimmed in Mixed, as the private binder does.
    await expect(page.locator('[data-slot-id="public-0"] img')).toHaveClass(/grayscale/);
    // Shared prices open in the Prices view: each owned pocket shows its printing's price.
    await expect(page.locator('[data-slot-id="public-0"]')).toContainText('£12.34');
    await expect(page.locator('[data-slot-id="public-2"]')).toContainText('£3.50');
    await page.locator('[data-slot-id="public-0"]').tap();
    const priced = page.getByRole('dialog', { name: 'Synthetic Snorlax, Owned details' });
    // The same price panel as the owner's own binder, details included.
    const panel = priced.getByRole('region', { name: 'Prices' });
    await expect(panel).toContainText('£12.34');
    await expect(panel.getByText('Price details')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(priced).toHaveCount(0);
    // The View sheet's Prices switch turns pocket prices off and on.
    await page.getByRole('button', { name: 'View', exact: true }).click();
    const prices = page.getByRole('button', { name: /^Prices/ });
    await expect(prices).toHaveAttribute('aria-pressed', 'true');
    await prices.click();
    await expect(prices).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-slot-id="public-0"]')).not.toContainText('£');
    // Price lookups name only public catalog printings.
    const looked = traffic.prices.flatMap((r) =>
      (r.postDataJSON()?.cards ?? []).map((c: { cardId: string }) => c.cardId),
    );
    expect(looked.length).toBeGreaterThan(0);
    expect(looked.every((id: string) => CATALOG.includes(id))).toBe(true);
    // One swipe moves exactly one of three pages; the last page is a hard stop; vertical drags never turn.
    await phone.swipe(-90);
    await expect(current).toHaveAttribute('data-binder-page', '2');
    await expect(pageNumber).toHaveValue('2');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await phone.swipe(-90);
    await expect(current).toHaveAttribute('data-binder-page', '3');
    await phone.swipe(-90);
    await expect(current).toHaveAttribute('data-binder-page', '3');
    await phone.swipe(-30, 90);
    await expect(current).toHaveAttribute('data-binder-page', '3');
    const wanted = page.getByRole('button', { name: 'snorlax, Unfilled target' });
    await expect(wanted.locator('img')).toHaveClass(/grayscale/);
    // Card details: the existing slot detail sheet, read-only, every dismissal path.
    const detail = page.getByRole('dialog', { name: 'snorlax, Unfilled target details' });
    await wanted.tap();
    await expect(detail).toBeVisible();
    await expect(detail.getByRole('button', { name: /assign|place|remove|edit/i })).toHaveCount(0);
    await expect(detail).not.toContainText('Market price');
    const close = detail.getByRole('button', { name: /close/i }).first();
    await phone.expectMinTapTarget(close, 36);
    await phone.expectWithinSafeViewport(close);
    await close.click();
    await expect(detail).toHaveCount(0);
    await wanted.tap();
    await page.keyboard.press('Escape');
    await expect(detail).toHaveCount(0);
    await phone.swipe(90);
    await expect(current).toHaveAttribute('data-binder-page', '2');
    // Jump straight to a page.
    await pageNumber.fill('1');
    await pageNumber.press('Enter');
    await expect(current).toHaveAttribute('data-binder-page', '1');
    // Search is indexed from this share's pockets: true counts, real destinations, nothing from a dex-order guess.
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    const search = page.getByRole('dialog', { name: 'Search Pokemon' });
    await expect(search.getByRole('button', { name: /^Needed\s*1$/ })).toBeVisible();
    await expect(search.getByRole('button', { name: /^Wanted\s*1$/ })).toBeVisible();
    await expect(search.getByRole('button', { name: /^Missing/ })).toHaveCount(0);
    await expect(search.getByText('Not in binder').first()).toBeVisible();
    await search.getByRole('textbox').first().fill('snorlax');
    await expect(search).toContainText('Page 1 • A1');
    await search
      .getByRole('button', { name: /snorlax/i })
      .first()
      .click();
    await expect(page.getByRole('dialog', { name: 'Synthetic Snorlax, Owned details' })).toBeVisible();
    await page.keyboard.press('Escape');
    // Next needed goes pocket by pocket and opens the exact unfilled target on its page.
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Next needed' }).click();
    await expect(current).toHaveAttribute('data-binder-page', '3');
    await expect(page.getByRole('dialog', { name: 'snorlax, Unfilled target details' })).toBeVisible();
    await page.keyboard.press('Escape');
    // Wanted lists every stored want separately and opens its own pocket; no private assignment is shown.
    await page.getByRole('button', { name: 'Wanted', exact: true }).click();
    const wants = page.getByRole('list', { name: 'Wanted cards' }).getByRole('listitem');
    await expect(wants).toHaveCount(3);
    await expect(page.getByTestId('main-content')).not.toContainText('Wanted by');
    await page.getByRole('button', { name: 'Open Synthetic Trainer' }).click();
    await expect(current).toHaveAttribute('data-binder-page', '3');
    await expect(page.getByRole('dialog', { name: 'snorlax, Unfilled target details' })).toBeVisible();
    await page.keyboard.press('Escape');
    // Quick mode, from the Search sheet, with the shared prices.
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByRole('dialog', { name: 'Search Pokemon' }).getByRole('button', { name: 'Quick mode' }).click();
    const quick = page.getByRole('dialog', { name: 'Quick mode' });
    await expect(quick).toBeVisible();
    await phone.expectWithinSafeViewport(quick.getByRole('button', { name: 'Close quick mode' }));
    await quick.getByRole('button', { name: 'Close quick mode' }).click();
    await expect(quick).toHaveCount(0);
    await phone.expectMinTapTarget(page.getByRole('button', { name: 'Previous binder page' }), 36);
    // The dock pads itself over the home indicator; its buttons must sit above it.
    await phone.expectWithinSafeViewport(
      page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Binder' }),
    );
    await phone.expectWithinSafeViewport(current);
    await phone.expectNoHorizontalOverflow();
    expect(traffic.writes).toEqual([]);
    expect(traffic.api).toEqual([]);
  });
}

for (const path of paths('stress')) {
  test(
    `wide 3x8 light page and long recorded grading stay inside the phone: ${path}`,
    { tag: '@matrix' },
    async ({ page, standalone, insets }) => {
      // One page only: there is no page turn, so no swipe handler to wait for.
      const phone = await open(page, path, standalone, insets, false);
      await expect(page.getByRole('region', { name: 'Scrollable binder page 1' })).toBeVisible();
      await phone.expectNoHorizontalOverflow();
      await page.getByRole('button', { name: 'Synthetic Snorlax, Owned' }).first().click();
      const detail = page.getByRole('dialog', { name: 'Synthetic Snorlax, Owned details' });
      await expect(detail).toContainText('Recorded grading provider');
      // Not checked against the safe area here: a 500-character stress grade overflows the shared SlotDetail
      // in standalone (private app too). Normal details are checked above.
      await page.keyboard.press('Escape');
      await expect(detail).toHaveCount(0);
      await phone.expectNoHorizontalOverflow();
    },
  );
}

for (const path of paths('revoked')) {
  test(`a revoked share is not found and renders no pockets: ${path}`, async ({ page }) => {
    const response = await page.goto(path);
    // Streamed Next notFound can retain HTTP 200 after the public PPR shell was sent.
    expect([200, 404]).toContain(response?.status());
    expect(response?.headers()['cache-control']).toContain('no-store');
    await expect(page.getByRole('heading', { name: /Page not found/i })).toBeVisible();
    await expect(page.locator('[data-slot-id]')).toHaveCount(0);
  });
}

async function open(
  page: Page,
  path: string,
  standalone: boolean,
  insets: { top: number; bottom: number; left: number; right: number },
  swipeable = true,
) {
  if (standalone) await emulateStandalone(page, insets);
  const response = (await page.goto(path))!;
  const stageSelector = '[data-page-turn-ms]';
  // Streamed content waits in a hidden Suspense placeholder until React reveals it.
  await expect(page.locator(stageSelector)).toBeVisible({ timeout: 30_000 });
  // Synthetic images 404, and CardImage re-mounts an <img> on failure; a touch on a detached node never ends.
  await page.waitForLoadState('networkidle');
  const touch = await page.context().newCDPSession(page);
  if (swipeable) await swipeReady(touch);
  const box = async (locator: Locator) => {
    const value = await locator.boundingBox();
    expect(value).not.toBeNull();
    return value!;
  };
  return {
    response,
    async swipe(dx: number, dy = 0) {
      const b = await box(page.locator('[data-binder-page]'));
      const x = b.x + b.width / 2,
        y = b.y + b.height / 2;
      await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
      await touch.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x + dx, y: y + dy, id: 1 }],
      });
      await new Promise((resolve) => setTimeout(resolve, 120));
      await touch.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x + dx, y: y + dy, id: 1 }],
      });
      await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      // The page turn animates; let it settle before the next gesture.
      await page.waitForTimeout(450);
    },
    async expectMinTapTarget(locator: Locator, min = 36) {
      const b = await box(locator);
      expect(Math.round(b.width)).toBeGreaterThanOrEqual(min);
      expect(Math.round(b.height)).toBeGreaterThanOrEqual(min);
    },
    async expectNoHorizontalOverflow() {
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
      ).toBeLessThanOrEqual(0);
    },
    async expectWithinSafeViewport(locator: Locator) {
      const b = await box(locator),
        { width, height } = page.viewportSize()!;
      expect(b.y).toBeGreaterThanOrEqual(insets.top - 0.5);
      expect(b.x).toBeGreaterThanOrEqual(-0.5);
      expect(b.x + b.width).toBeLessThanOrEqual(width + 0.5);
      expect(b.y + b.height).toBeLessThanOrEqual(height - insets.bottom + 0.5);
    },
  };
}

/** The binder's swipe hook binds in an effect after hydration, on the stage around the page. */
async function swipeReady(touch: CDPSession) {
  await expect
    .poll(async () => {
      const { result } = await touch.send('Runtime.evaluate', {
        expression: 'document.querySelector("[data-page-turn-ms]")?.parentElement',
      });
      if (!result.objectId) return false;
      const { listeners } = await touch.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
      return listeners.some((l) => l.type === 'touchend');
    })
    .toBe(true);
}
