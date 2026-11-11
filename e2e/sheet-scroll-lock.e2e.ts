import { test, expect, type Harness } from './fixtures';
import type { Locator } from '@playwright/test';

/** Dispatches a synthetic one-finger drag on `target` and reports whether the move was cancelled. */
function touchDrag(target: Locator, dy: number) {
  return target.evaluate((element, deltaY) => {
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + Math.min(rect.height / 2, 40);
    const touch = (clientY: number) => new Touch({ identifier: 1, target: element, clientX: x, clientY });
    element.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [touch(y)] }));
    const move = new TouchEvent('touchmove', { bubbles: true, cancelable: true, touches: [touch(y + deltaY)] });
    element.dispatchEvent(move);
    element.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [] }));
    return move.defaultPrevented;
  }, dy);
}

async function openAllCards(harness: Harness) {
  // Enough printings that the grid scrolls on every phone size.
  const detail = await harness.openCardDetail();
  await detail.getByRole('button', { name: /all bulbasaur cards/i }).click();
  const sheet = harness.page.getByRole('dialog', { name: /all bulbasaur cards/i });
  await expect(sheet).toBeVisible();
  return sheet;
}

test.describe('sheets lock the page behind them', () => {
  test('sheet scrollers never rubber-band or chain to the page', async ({ harness }) => {
    const sheet = await openAllCards(harness);
    const behaviours = await sheet.evaluate((element) =>
      [element, ...element.querySelectorAll<HTMLElement>('*')]
        .filter((node) => /auto|scroll/.test(getComputedStyle(node).overflowY))
        .map((node) => getComputedStyle(node).overscrollBehaviorY),
    );
    expect(behaviours.length).toBeGreaterThan(0);
    expect(new Set(behaviours)).toEqual(new Set(['none']));
  });

  test('the page is locked while a sheet is open and released after', async ({ harness }) => {
    const dialog = await harness.openCardDetail();
    await expect
      .poll(() =>
        harness.page.evaluate(() => [
          getComputedStyle(document.body).overflow,
          document.documentElement.hasAttribute('data-scroll-locked'),
        ]),
      )
      .toEqual(['hidden', true]);
    // Dragging on the backdrop cannot pan anything behind the sheet.
    expect(await touchDrag(harness.page.locator('[data-overlay-backdrop]').first(), 120)).toBe(true);
    await harness.page.goBack();
    await expect(dialog).toBeHidden();
    await harness.expectScrollUnlocked();
    await expect(harness.page.locator('html[data-scroll-locked]')).toHaveCount(0);
  });

  test('content that can scroll inside a sheet still scrolls', async ({ harness }) => {
    const sheet = await openAllCards(harness);
    const scroller = sheet.locator('div.overflow-y-auto').last();
    const range = await scroller.evaluate((element) => element.scrollHeight - element.clientHeight);
    test.skip(range <= 1, 'nothing to scroll at this size');
    expect(await touchDrag(scroller, -60)).toBe(false);
  });

  test('opening the card detail does not shift its layout as images load', async ({ harness }) => {
    // Hold card art so it lands after the sheet has rendered.
    await harness.page.route(/\.(webp|png|jpe?g)(\?|$)/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 600));
      await route.fallback();
    });
    await harness.page.evaluate(() => {
      const w = window as unknown as { __shift: number };
      w.__shift = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as Array<PerformanceEntry & { value: number; hadRecentInput: boolean }>) {
          if (!entry.hadRecentInput) w.__shift += entry.value;
        }
      }).observe({ type: 'layout-shift', buffered: false });
    });
    const dialog = await harness.openCardDetail();
    await harness.page.waitForTimeout(1200);
    await expect(dialog).toBeVisible();
    const shift = await harness.page.evaluate(() => (window as unknown as { __shift: number }).__shift);
    expect(shift).toBeLessThan(0.02);
  });
});
