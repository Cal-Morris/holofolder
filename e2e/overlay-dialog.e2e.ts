import { test, expect, mockBackends, emulateStandalone, Harness } from './fixtures';
import { fulfillWantedInventory, wantedEntry } from './native-wanted-layout-fixture';
import { syntheticSlotPickerSnapshot } from '../tests/fixtures/slot-picker';
import type { Locator, Page } from '@playwright/test';

/**
 * The shared native `<dialog>` overlay (components/ui/overlay-dialog.tsx), driven through the sheets built on it:
 * the want list filters (a top-level sheet) and the card picker filters (the deliberate stacked level, over the
 * card selector). Both use synthetic harness data only.
 */
type Case = {
  name: string;
  open: (harness: Harness) => Promise<{ dialog: Locator; opener: Locator }>;
  /** The overlay underneath that must survive closing this one. */
  returnsTo?: RegExp;
};

const cases: Case[] = [
  {
    name: 'want list filters',
    open: async ({ page }) => {
      await page.route('**/app/e2e-harness/storage/inventory?*', (route) => fulfillWantedInventory(route, 12));
      await page.route('**/app/e2e-harness/storage/inventory', (route) => route.abort('failed'));
      await page.goto(wantedEntry);
      await page.getByRole('button', { name: 'Wanted', exact: true }).filter({ visible: true }).click();
      await expect(page.getByRole('region', { name: 'Wanted cards', exact: true }).getByRole('listitem')).toHaveCount(
        12,
      );
      const opener = page.getByTestId('wanted-sort-filter');
      await opener.click();
      return { dialog: page.getByRole('dialog', { name: 'Sort and filter want list' }), opener };
    },
  },
  {
    name: 'card picker filters',
    open: async ({ page }) => {
      const { cards } = syntheticSlotPickerSnapshot();
      await page.route('**/app/api/tcg-card-search**', (route) => route.fulfill({ json: { cards } }));
      await page.route('**/app/api/card-prices', (route) => route.fulfill({ json: { prices: [] } }));
      await page.goto('/app/e2e-harness?signedIn=1&slots=picker&rows=2&cols=4');
      await page.locator('button[data-slot-id="slot-g"]').click();
      const selector = page.getByRole('dialog', { name: 'Card selector', exact: true });
      const opener = selector.getByRole('button', { name: /filters/i });
      await opener.click();
      return { dialog: page.getByRole('dialog', { name: 'Filters and sort', exact: true }), opener };
    },
    returnsTo: /^card selector$/i,
  },
];

async function expectClosed(harness: Harness, dialog: Locator, returnsTo?: RegExp) {
  await expect(dialog).toHaveCount(0);
  if (returnsTo) {
    // Exactly one level closes, so a single Escape/back never takes the overlay underneath with it.
    await expect(harness.page.getByRole('dialog', { name: returnsTo })).toBeVisible();
    await expect(harness.dialogs()).toHaveCount(1);
  } else {
    await expect(harness.dialogs()).toHaveCount(0);
    await harness.expectScrollUnlocked();
  }
  await expect(harness.page).toHaveURL(/\/app\/e2e-harness/);
}

/** A real (CDP) touch drag, so the browser decides between scrolling and the sheet drag like a phone does. */
async function touchDrag(page: Page, x: number, y: number, distance: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let step = 1; step <= 10; step += 1) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: y + (distance * step) / 10 }],
    });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

for (const overlay of cases) {
  test.describe(`overlay dialog: ${overlay.name}`, () => {
    test.use({
      signedIn: true,
      harness: async ({ page, context, standalone, insets, baseURL }, provide) => {
        if (standalone) await emulateStandalone(page, insets);
        await mockBackends(page, context, { signedIn: true, baseURL });
        await provide(new Harness(page, insets, true));
      },
    });

    test('opens as a native modal in the top layer, inside the safe viewport', async ({ harness }) => {
      const { dialog } = await overlay.open(harness);
      await expect(dialog).toBeVisible();
      expect(await dialog.evaluate((element) => element.tagName === 'DIALOG' && element.matches(':modal'))).toBe(true);
      const close = harness.closeControl(dialog);
      await harness.expectWithinSafeViewport(close);
      await harness.expectHittable(close);
      await harness.expectMinTapTarget(close);
      const box = (await dialog.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(harness.insets.top - 0.5);
      expect(box.y + box.height).toBeLessThanOrEqual(harness.viewport.height + 0.5);
      // Nothing from the page (header, dock, other overlays) paints over the backdrop.
      const hits = await harness.page.evaluate(
        ([width, top]) => [
          document.elementFromPoint(width / 2, top + 4)?.tagName,
          document.elementFromPoint(width / 2, window.innerHeight - 4)?.tagName,
        ],
        [harness.viewport.width, harness.insets.top] as const,
      );
      expect(hits).toEqual(['DIALOG', 'DIALOG']);
      await harness.expectNoHorizontalOverflow();
    });

    test('closes with the close button and returns focus', async ({ harness }) => {
      const { dialog, opener } = await overlay.open(harness);
      await expect(dialog).toBeVisible();
      await harness.closeControl(dialog).click();
      await expectClosed(harness, dialog, overlay.returnsTo);
      await expect(opener).toBeFocused();
    });

    test('traps Tab focus inside the dialog', async ({ harness }) => {
      const { dialog } = await overlay.open(harness);
      await expect(dialog).toBeVisible();
      for (const key of ['Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab']) {
        await harness.page.keyboard.press(key);
        expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
      }
      // Tabbing round from the last control lands back on the first.
      const count = await dialog.evaluate(
        (element) =>
          element.querySelectorAll('button:not([disabled]), select:not([disabled]), input:not([disabled])').length,
      );
      for (let index = 0; index <= count; index += 1) await harness.page.keyboard.press('Tab');
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    });

    test('closes with Escape, one level only', async ({ harness }) => {
      const { dialog } = await overlay.open(harness);
      await expect(dialog).toBeVisible();
      await harness.page.keyboard.press('Escape');
      await expectClosed(harness, dialog, overlay.returnsTo);
    });

    test('closes with the browser back button without leaving the page', async ({ harness }) => {
      const { dialog } = await overlay.open(harness);
      await expect(dialog).toBeVisible();
      await harness.page.goBack();
      await expectClosed(harness, dialog, overlay.returnsTo);
    });

    test('closes when tapping the backdrop', async ({ harness }) => {
      const { dialog } = await overlay.open(harness);
      await expect(dialog).toBeVisible();
      await harness.tapBackdrop(dialog);
      await expectClosed(harness, dialog, overlay.returnsTo);
    });

    test('closes with swipe down on the grabber', async ({ harness }) => {
      const { dialog } = await overlay.open(harness);
      await expect(dialog).toBeVisible();
      await harness.swipeDown(dialog);
      await expectClosed(harness, dialog, overlay.returnsTo);
    });

    test('closes with a touch pull down on its body from the top', async ({ harness }) => {
      const { dialog } = await overlay.open(harness);
      await expect(dialog).toBeVisible();
      const point = await dialog.evaluate((sheet) => {
        const rect = sheet.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        for (let share = 0.45; share <= 0.85; share += 0.05) {
          const y = rect.top + rect.height * share;
          const hit = document.elementFromPoint(x, y);
          if (hit && sheet.contains(hit) && !hit.closest('[data-sheet-grabber], input, select, textarea'))
            return { x, y };
        }
        throw new Error('No draggable body point found');
      });
      await touchDrag(harness.page, point.x, point.y, 220);
      await expectClosed(harness, dialog, overlay.returnsTo);
    });

    test('a dock tab switch closes every overlay', async ({ harness }) => {
      const { dialog } = await overlay.open(harness);
      await expect(dialog).toBeVisible();
      // The page behind a modal is inert, so the tab switch is dispatched rather than tapped.
      await harness.dock().getByRole('button', { name: 'Binder', exact: true }).dispatchEvent('click');
      await expect(dialog).toHaveCount(0);
      await expect(harness.dialogs()).toHaveCount(0);
      await harness.expectScrollUnlocked();
      await expect(harness.page).toHaveURL(/\/app\/e2e-harness/);
    });
  });
}
