/* eslint-disable react-hooks/rules-of-hooks -- Playwright fixture `use` is not a React hook. */
import {
  test as base,
  expect,
  MOCK_CARDS,
  Harness,
  mockBackends,
  emulateStandalone,
  openSettingsPage,
} from './fixtures';
import { mockCardPrices } from './price-fixtures';
import { seedWantList } from './wanted-fixtures';
import type { Locator, Page } from '@playwright/test';

class ScrollHarness extends Harness {
  override async openCardDetail() {
    // Short desktop windows have tiny slots whose centre is covered by hover Add/Want controls.
    await this.page
      .locator('button[data-dex-id="1"]')
      .first()
      .click({ position: { x: 8, y: 8 } });
    const dialog = this.page.getByRole('dialog', { name: /bulbasaur details/i });
    await expect(dialog).toBeVisible();
    return dialog;
  }
}

// Unlike the phone-only Harness.open(), this also supports desktop's header navigation.
const test = base.extend({
  harness: async ({ page, standalone, insets, signedIn, baseURL }, use) => {
    if (standalone) await emulateStandalone(page, insets);
    await mockBackends(page, page.context(), { signedIn, baseURL });
    const harness = new ScrollHarness(page, insets, signedIn);
    await page.goto(harness.path);
    await expect(page.locator('button[data-dex-id="1"]').first()).toBeVisible();
    await use(harness);
  },
});

// Synthetic printings make the grid overflow on desktop as well as phones.
const cards = Array.from({ length: 35 }, (_, index) => ({
  ...MOCK_CARDS[0],
  variants: { normal: true, reverse: true },
  id: `scroll-${index}`,
  localId: String(index + 1),
  set: { ...MOCK_CARDS[0].set, name: `Scroll fixture ${index + 1}` },
}));
const top = (body: Locator) => body.evaluate((el) => el.scrollTop);
const range = (body: Locator) => body.evaluate((el) => el.scrollHeight - el.clientHeight);
const scrollBody = (dialog: Locator) => dialog.locator('.overflow-y-auto').last();
const nav = (h: Harness) =>
  h.page.getByRole('navigation', {
    name: h.viewport.width >= 640 ? 'Binder navigation' : 'Main navigation',
    exact: true,
  });

async function openAll(h: Harness) {
  const detail = await h.openCardDetail();
  await detail.getByRole('button', { name: /all bulbasaur cards/i }).click();
  const dialog = h.page.getByRole('dialog', { name: 'All Bulbasaur cards', exact: true });
  await expect(dialog.getByRole('listitem')).toHaveCount(35);
  return dialog;
}

async function wheel(page: Page, target: Locator, delta: number) {
  await target.hover();
  await page.mouse.wheel(0, delta);
}

// Browser input, not dispatched DOM events or assigned scrollTop. Native hit-testing and scrolling run.
async function touch(page: Page, body: Locator, delta: number) {
  const box = (await body.boundingBox())!;
  const x = box.x + box.width * 0.25;
  const y = box.y + (delta < 0 ? box.height * 0.75 : box.height * 0.25);
  const distance = Math.min(150, box.height * 0.45) * Math.sign(delta);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let step = 1; step <= 10; step++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: y + (distance * step) / 10 }],
    });
    await page.waitForTimeout(20);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  // Let native momentum finish before measuring a reverse gesture or another overlay.
  await page.waitForTimeout(500);
}

async function background(page: Page) {
  return page.evaluate(() => [
    window.scrollY,
    ...Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="main-content"], [data-testid="view-scroller"]'),
    ).map((el) => el.scrollTop),
  ]);
}

async function ends(page: Page, dialog: Locator) {
  const body = scrollBody(dialog);
  await expect.poll(() => range(body)).toBeGreaterThan(100);
  const before = await background(page);
  // The body midpoint hits actual card content, including overflow-hidden wrappers.
  await wheel(page, body, 100_000);
  await expect.poll(async () => Math.abs((await top(body)) - (await range(body)))).toBeLessThanOrEqual(1);
  await wheel(page, body, 800);
  await expect.poll(async () => Math.abs((await top(body)) - (await range(body)))).toBeLessThanOrEqual(1);
  expect(await background(page)).toEqual(before);
  await wheel(page, body, -100_000);
  await expect.poll(() => top(body)).toBe(0);
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(theme, () => {
    test.use({ signedIn: true, colorScheme: theme });
    test.beforeEach(async ({ harness }) => {
      await harness.page.evaluate(
        (value) => document.documentElement.classList.toggle('dark', value === 'dark'),
        theme,
      );
      await harness.page.route('**/app/api/tcgdex-cache**', (route) =>
        route.fulfill({ json: { cards, source: 'mirror' } }),
      );
    });

    test('all cards: artwork, text, ends, header, focus, reopening and tab return', async ({ harness }) => {
      const { page } = harness;
      const dialog = await openAll(harness);
      const body = scrollBody(dialog);
      const before = await background(page);
      await harness.expectWithinSafeViewport(harness.closeControl(dialog));
      await harness.expectHittable(harness.closeControl(dialog));
      await wheel(page, dialog.getByRole('listitem').first().locator('img'), 180);
      await expect.poll(() => top(body)).toBeGreaterThan(100);
      await ends(page, dialog);
      await wheel(page, dialog.getByRole('listitem').first().getByText('Scroll fixture 1', { exact: true }), 180);
      await expect.poll(() => top(body)).toBeGreaterThan(100);
      if (['standalone-375x667', 'browser-390x844', 'desktop-800x500'].includes(test.info().project.name)) {
        await page.screenshot({ path: test.info().outputPath('all-cards.png') });
      }
      const action = dialog.getByRole('button', { name: /^Want Bulbasaur/ }).first();
      await action.hover();
      const actionTop = await top(body);
      await page.mouse.wheel(0, 180);
      await expect.poll(() => top(body)).toBeGreaterThan(actionTop + 80);
      const current = await top(body);
      await wheel(page, dialog.getByRole('heading'), 250);
      await page.waitForTimeout(150);
      expect(await top(body)).toBe(current);
      expect(await background(page)).toEqual(before);
      const search = dialog.getByRole('searchbox');
      await search.fill('Scroll fixture 3');
      await expect(dialog.getByRole('listitem')).toHaveCount(7);
      await search.fill('');
      await ends(page, dialog);
      // Returning to the browser tab must leave the scroll lock and scroller usable.
      const other = await page.context().newPage();
      await other.bringToFront();
      await page.bringToFront();
      await other.close();
      await ends(page, dialog);
      for (let i = 0; i < 2; i++) {
        await harness.closeControl(dialog).click();
        await expect(page.getByRole('dialog', { name: /bulbasaur details/i })).toBeVisible();
        await page
          .getByRole('dialog', { name: /bulbasaur details/i })
          .getByRole('button', { name: /all bulbasaur cards/i })
          .click();
        await ends(page, dialog);
      }
      await harness.closeControl(dialog).click();
      await harness.closeControl(page.getByRole('dialog', { name: /bulbasaur details/i })).click();
      await harness.expectScrollUnlocked();
      await nav(harness).getByRole('button', { name: 'List', exact: true }).click();
      const list = page.getByTestId('view-scroller');
      await expect.poll(() => range(list)).toBeGreaterThan(100);
      await wheel(page, list, 400);
      await expect.poll(() => top(list)).toBeGreaterThan(100);
      await nav(harness).getByRole('button', { name: 'Binder', exact: true }).click();
      await openAll(harness);
      await ends(page, dialog);
      await harness.expectNoHorizontalOverflow();
    });

    test('all cards: native touch moves both ways without moving the background', async ({ harness, hasTouch }) => {
      test.skip(!hasTouch, 'Native touch is covered in the six phone projects');
      const { page } = harness;
      const dialog = await openAll(harness);
      const body = scrollBody(dialog);
      const before = await background(page);
      await touch(page, body, 150);
      expect(await top(body)).toBe(0);
      expect(await background(page)).toEqual(before);
      await touch(page, body, -150);
      const down = await top(body);
      expect(down).toBeGreaterThan(40);
      await touch(page, body, 150);
      expect(await top(body)).toBeLessThan(down);
      expect(await background(page)).toEqual(before);
      await harness.closeControl(dialog).click();
      await harness.closeControl(page.getByRole('dialog', { name: /bulbasaur details/i })).click();
      await harness.expectScrollUnlocked();
    });

    test('selector scroll survives nested filters and variant dismissal', async ({ harness, hasTouch }) => {
      const { page } = harness;
      const detail = await harness.openCardDetail();
      await detail.getByRole('button', { name: /change owned card/i }).click();
      const selector = page.getByRole('dialog', { name: 'Card selector', exact: true });
      const body = scrollBody(selector);
      await expect(selector.getByText('35 of 35 cards')).toBeVisible();
      await ends(page, selector);
      await selector.getByRole('button', { name: /filters · sort/i }).click();
      const filters = page.getByRole('dialog', { name: 'Filters and sort', exact: true });
      await expect(filters).toBeVisible();
      const lowerTop = await top(body);
      if ((await range(scrollBody(filters))) > 100) {
        await ends(page, filters);
        if (hasTouch) await touch(page, scrollBody(filters), -100);
      }
      expect(await top(body)).toBe(lowerTop);
      await harness.expectWithinSafeViewport(harness.closeControl(filters));
      await harness.closeControl(filters).click();
      await expect(page.locator('html')).toHaveAttribute('data-scroll-locked', '');
      await ends(page, selector);
      // Choosing a printing only opens its variant sheet; no collection mutation is made.
      await selector
        .getByRole('button', { name: /^Add card Bulbasaur from / })
        .first()
        .click();
      const variant = page.getByRole('dialog', { name: 'Which variant?', exact: true });
      await expect(variant).toBeVisible();
      await harness.expectWithinSafeViewport(variant.getByRole('button', { name: 'Back to cards' }));
      await variant.getByRole('button', { name: 'Back to cards' }).click();
      await ends(page, selector);
      if (hasTouch) {
        await touch(page, body, -150);
        expect(await top(body)).toBeGreaterThan(40);
      }
      await harness.closeControl(selector).click();
      await expect(detail).toBeVisible();
      await harness.closeControl(detail).click();
      await harness.expectScrollUnlocked();
    });

    test('illustrator grid scrolls over cards and reaches both ends', async ({ harness, hasTouch }) => {
      const { page } = harness;
      await page.route('**/app/api/tcg-illustrators**', (route) => {
        const name = new URL(route.request().url()).searchParams.get('name');
        return route.fulfill({
          json: name ? { illustrator: name, cards } : { illustrators: [{ name: 'Mitsuhiro Arita', cardCount: 35 }] },
        });
      });
      await nav(harness).getByRole('button', { name: 'Search', exact: true }).click();
      const search = page.getByRole('dialog', { name: /search pokemon/i });
      await search.getByRole('textbox').fill('arita');
      await search.getByRole('button', { name: /illustrator mitsuhiro arita/i }).click();
      const dialog = page.getByRole('dialog', { name: /cards illustrated by/i });
      await expect(dialog.getByRole('listitem')).toHaveCount(35);
      await ends(page, dialog);
      if (hasTouch) {
        await touch(page, scrollBody(dialog), -150);
        expect(await top(scrollBody(dialog))).toBeGreaterThan(40);
      }
      await harness.expectWithinSafeViewport(harness.closeControl(dialog));
      await harness.closeControl(dialog).click();
      await harness.expectScrollUnlocked();
    });

    test('search highlight and breakout jumps remain scrollable, keyboard keeps controls visible', async ({
      harness,
      hasTouch,
    }) => {
      const { page } = harness;
      await page.route('**/app/api/tcg-card-search**', (route) => route.fulfill({ json: { cards: [cards[30]] } }));
      await mockCardPrices(page, { 'scroll-30': { confidence: 'high', market: 15, trend: { '7d': 10, Trend: 15 } } });
      await nav(harness).getByRole('button', { name: 'Search', exact: true }).click();
      const search = page.getByRole('dialog', { name: /search pokemon/i });
      await search.getByRole('textbox').fill('bulbasaur');
      await search
        .getByRole('region', { name: 'Card results' })
        .getByRole('button', { name: /Bulbasaur 31.*Scroll fixture 31/ })
        .click();
      const dialog = page.getByRole('dialog', { name: 'All Bulbasaur cards', exact: true });
      const body = scrollBody(dialog);
      await expect.poll(() => top(body)).toBeGreaterThan(500);
      await ends(page, dialog);
      await dialog.getByRole('button', { name: /^Breakout 1:/ }).click();
      await expect.poll(() => top(body)).toBeGreaterThan(500);
      await ends(page, dialog);
      const field = dialog.getByRole('searchbox');
      await field.focus();
      if (hasTouch) {
        // Emulate the visual viewport change; this is not a physical iOS keyboard test.
        await page.evaluate(() => {
          Object.defineProperty(Object.getPrototypeOf(window.visualViewport!), 'height', {
            configurable: true,
            get: () => window.innerHeight - 300,
          });
          window.visualViewport!.dispatchEvent(new Event('resize'));
        });
        await expect(page.locator('html')).toHaveAttribute('data-keyboard-open', '');
        for (const control of [field, harness.closeControl(dialog)]) {
          await harness.expectWithinSafeViewport(control);
          expect((await control.boundingBox())!.y + (await control.boundingBox())!.height).toBeLessThanOrEqual(
            harness.viewport.height - 300,
          );
        }
        await ends(page, dialog);
        const last = dialog.locator('li[data-card-id]').last();
        await wheel(page, body, 100_000);
        await expect(last).toBeInViewport({ ratio: 0.1 });
      }
      await harness.closeControl(dialog).click();
      await harness.expectScrollUnlocked();
    });

    test('secondary sheets: More, Partner, want filters and actions', async ({ harness, hasTouch }) => {
      const { page } = harness;
      const view = await harness.openViewOptions();
      if ((await range(scrollBody(view))) > 100) await ends(page, view);
      await harness.expectWithinSafeViewport(harness.closeControl(view));
      await harness.closeControl(view).click();
      const more = page.getByTestId('app-header').getByRole('button', { name: 'More', exact: true });
      await more.click();
      const menu = page.getByRole('dialog', { name: 'More', exact: true });
      await harness.expectWithinSafeViewport(harness.closeControl(menu));
      if ((await range(scrollBody(menu))) > 100) await ends(page, menu);
      await menu.getByRole('menuitem', { name: 'Partner', exact: true }).click();
      const partner = page.getByRole('dialog', { name: 'Partner Mode', exact: true });
      await expect(partner).toBeVisible();
      if ((await range(scrollBody(partner))) > 100) await ends(page, partner);
      await harness.expectWithinSafeViewport(harness.closeControl(partner));
      await harness.closeControl(partner).click();
      await harness.expectScrollUnlocked();
      await seedWantList(page);
      await page.reload();
      await page.evaluate((value) => document.documentElement.classList.toggle('dark', value === 'dark'), theme);
      await nav(harness).getByRole('button', { name: 'Wanted', exact: true }).click();
      await page.getByTestId('wanted-sort-filter').click();
      const filters = page.getByRole('dialog', { name: 'Sort and filter want list', exact: true });
      await expect(filters).toBeVisible();
      if ((await range(scrollBody(filters))) > 100) {
        await ends(page, filters);
        if (hasTouch) await touch(page, scrollBody(filters), -100);
      }
      await harness.expectWithinSafeViewport(harness.closeControl(filters));
      await harness.closeControl(filters).click();
      await page.getByRole('button', { name: 'More actions for Bulbasaur' }).click();
      const actions = page.getByRole('dialog', { name: 'Actions for Bulbasaur', exact: true });
      await expect(actions).toBeVisible();
      await harness.expectWithinSafeViewport(actions.getByRole('button', { name: 'Cancel', exact: true }));
      await actions.getByRole('button', { name: 'Cancel', exact: true }).click();
      await harness.expectScrollUnlocked();
    });

    test('settings: clipped sections scroll, last controls and close stay reachable', async ({ harness, hasTouch }) => {
      const { page } = harness;
      await page.getByTestId('app-header').getByRole('button', { name: 'More', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
      await expect(dialog).toBeVisible();
      const before = await background(page);
      await openSettingsPage(dialog, 'Appearance');
      await ends(page, dialog);
      if (hasTouch) {
        await touch(page, scrollBody(dialog), -150);
        expect(await top(scrollBody(dialog))).toBeGreaterThan(40);
      }
      expect(await background(page)).toEqual(before);
      await harness.expectWithinSafeViewport(harness.closeControl(dialog));
      await harness.closeControl(dialog).click();
      await harness.expectScrollUnlocked();
    });
  });
}

// Smaller overlays get reachability checks; they do not all have enough content to overflow.
test.describe('overlay inventory', () => {
  test('auth form fits and keeps its close control reachable', async ({ harness }) => {
    const { page } = harness;
    await page.getByTestId('app-header').getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Sign in', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Welcome, sign in', exact: true });
    await expect(dialog).toBeVisible();
    const body = scrollBody(dialog);
    if ((await range(body)) > 100) await ends(page, dialog);
    await harness.expectWithinSafeViewport(harness.closeControl(dialog));
    await harness.expectHittable(harness.closeControl(dialog));
    await harness.closeControl(dialog).click();
    await harness.expectScrollUnlocked();
  });

  test.describe('signed in', () => {
    test.use({ signedIn: true });

    test('binder switcher scrolls a long list without losing its close control', async ({ harness, hasTouch }) => {
      const { page } = harness;
      // Synthetic binders, only list reads are permitted in this test.
      const binders = Array.from({ length: 30 }, (_, index) => ({
        id: `e2e00000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        ownerUserId: '00000000-0000-4000-8000-0000000000e2',
        name: `Fixture binder ${index + 1}`,
        sortOrder: index,
        isDefault: index === 0,
        slotCount: 2,
        color: null,
        rows: null,
        cols: null,
        createdAt: null,
        updatedAt: null,
      }));
      await page.route('**/app/api/binders**', (route) => route.fulfill({ json: { binders } }));
      await page.goto('/app/e2e-harness?signedIn=1&binders=1');
      await page.getByTestId('binder-switcher-trigger').click();
      const dialog = page.getByRole('dialog', { name: 'Binders', exact: true });
      await expect(dialog.getByRole('listitem')).toHaveCount(30);
      await ends(page, dialog);
      if (hasTouch) {
        await touch(page, scrollBody(dialog), -150);
        expect(await top(scrollBody(dialog))).toBeGreaterThan(40);
      }
      await harness.expectWithinSafeViewport(harness.closeControl(dialog));
      await harness.closeControl(dialog).click();
      await harness.expectScrollUnlocked();
    });
  });
});
