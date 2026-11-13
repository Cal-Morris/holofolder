import type { Page, Response } from '@playwright/test';
import { test, expect, E2E_USER, openSettingsPage, type Harness, type SeedRow } from './fixtures';

async function openSettings(harness: Harness) {
  await harness.page.locator('nav').first().getByRole('button', { name: 'More', exact: true }).click();
  await harness.page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  const dialog = harness.page.getByRole('dialog', { name: /settings/i });
  await expect(dialog).toBeVisible();
  return openSettingsPage(dialog, 'Layout');
}
const warning = (page: Page) => page.getByRole('dialog', { name: /^Change layout to/ });
/** The layout commands the native storage endpoint (the harness ledger here) accepted from this page. */
function layoutWrites(page: Page) {
  const writes: Array<{ rows: number; cols: number }> = [];
  page.on('response', (response: Response) => {
    const request = response.request();
    if (
      !response.ok() ||
      request.method() !== 'POST' ||
      !/\/app\/(api\/binder-slots|e2e-harness\/storage\/slots)(\?|$)/.test(request.url())
    )
      return;
    for (const command of request.postDataJSON()?.commands ?? [])
      if (command.kind === 'layout') writes.push({ rows: command.rows, cols: command.cols });
  });
  return writes;
}
const slot = (page: Page, dex: number) => page.locator(`button[data-slot-id="synthetic-dex-${dex}"]`);
// Synthetic owned copies in pockets 1, 4, 5 and 7 of the seeded National Dex binder.
const FOUR_CARDS: SeedRow[] = [
  { pokemon_id: 1, card_id: 'base1-44', card_language: 'en', card_finish: 'normal', status: 'collected' },
  { pokemon_id: 4, card_id: 'base1-46', card_language: 'en', card_finish: 'normal', status: 'collected' },
  { pokemon_id: 5, card_id: 'sv03.5-005', card_language: 'en', card_finish: 'normal', status: 'collected' },
  { pokemon_id: 7, card_id: 'sv03.5-007', card_language: 'en', card_finish: 'normal', status: 'collected' },
];

test.describe('custom binder layouts', () => {
  test.use({ signedIn: true });
  test(
    'a premium layout warns first, saves to the binder, stays tappable and scrolls without overflowing the phone',
    { tag: '@matrix' },
    async ({ harness }) => {
      const { page } = harness;
      const writes = layoutWrites(page);
      const dialog = await openSettings(harness);
      const rows = dialog.getByRole('spinbutton', { name: 'Rows', exact: true });
      const cols = dialog.getByRole('spinbutton', { name: 'Columns', exact: true });
      await rows.fill('8');
      await cols.fill('8');
      const apply = dialog.getByRole('button', { name: 'Apply layout', exact: true });
      await harness.expectMinTapTarget(apply);
      await apply.click();
      const sheet = warning(page);
      await expect(sheet).toBeVisible();
      await expect(sheet).toContainText('The binder will have 17 pages instead of 65.');
      await expect(sheet).toContainText('No card leaves its pocket and nothing is removed.');
      await harness.expectWithinSafeViewport(sheet);
      for (const button of await sheet.getByRole('button').all()) await harness.expectMinTapTarget(button, 36);
      expect(writes).toHaveLength(0);
      await sheet.getByRole('button', { name: 'Change layout', exact: true }).click();
      await expect(sheet).toHaveCount(0);
      await expect(dialog.getByRole('status')).toHaveText('Layout saved.');
      await expect.poll(() => writes).toEqual([{ rows: 8, cols: 8 }]);
      await harness.expectNoHorizontalOverflow();
      await harness.closeControl(dialog).click();
      const frame = page.getByRole('region', { name: 'Scrollable binder page 1', exact: true });
      await expect(frame).toBeVisible();
      await harness.expectWithinSafeViewport(frame);
      expect((await frame.boundingBox())!.width).toBeGreaterThan(harness.viewport.width - 40);
      await expect(frame.locator('button[data-slot-id]')).toHaveCount(64);
      await harness.expectMinTapTarget(frame.locator('button[data-slot-id]').first());
      const screenshot = test.info().outputPath('custom-layout.png');
      await page.screenshot({ path: screenshot });
      await test.info().attach('custom-layout.png', { path: screenshot, contentType: 'image/png' });
      // A native horizontal drag must scroll this page, not turn to another one.
      const bounds = (await frame.boundingBox())!;
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: bounds.x + bounds.width - 30, y: bounds.y + 50 }],
      });
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: bounds.x + 30, y: bounds.y + 50 }],
      });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect.poll(() => frame.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
      const last = frame.locator('button[data-slot-id]').last();
      await last.scrollIntoViewIfNeeded();
      await harness.expectMinTapTarget(last);
      await harness.expectHittable(last);
      await harness.expectHittable(harness.dock().getByRole('button').first());
      await harness.expectNoHorizontalOverflow();
      await harness.reload();
      await expect(page.getByRole('region', { name: 'Scrollable binder page 1', exact: true })).toBeVisible();
    },
  );

  test('free accounts keep presets and get the custom layout upgrade action', async ({ harness }) => {
    const { page } = harness;
    // Synthetic free account, no live billing requests.
    await page.route('**/app/api/billing', (route) =>
      route.fulfill({
        json: {
          access: {
            ownerUserId: E2E_USER.id,
            enforced: true,
            tier: 'free',
            source: 'free',
            freeCardLimit: 100,
            freeBinderLimit: 1,
          },
          canManage: true,
        },
      }),
    );
    await harness.reload();
    const dialog = await openSettings(harness);
    const upgrade = dialog.getByRole('button', { name: 'Upgrade for custom layouts' });
    await expect(upgrade).toBeVisible();
    await harness.expectMinTapTarget(upgrade);
    await expect(dialog.getByRole('spinbutton', { name: 'Rows', exact: true })).toHaveCount(0);
    for (const name of ['1x1', '2x2', '3x3', '3x4', '4x3', '4x4'])
      await expect(dialog.getByRole('button', { name: new RegExp(`^${name}`) })).toBeEnabled();
    await harness.expectNoHorizontalOverflow();
  });

  test('invalid custom dimensions cannot be applied', async ({ harness }) => {
    const dialog = await openSettings(harness);
    const rows = dialog.getByRole('spinbutton', { name: 'Rows', exact: true });
    const apply = dialog.getByRole('button', { name: 'Apply layout', exact: true });
    for (const value of ['9', '0', '2.5', '']) {
      await rows.fill(value);
      await expect(apply).toBeDisabled();
    }
    await rows.fill('4');
    await apply.click();
    // The current layout: nothing to warn about or send.
    await expect(warning(harness.page)).toHaveCount(0);
  });
});

test.describe('layout change warning', () => {
  test.use({ signedIn: true, collection: async ({ signedIn: _signedIn }, provide) => provide(FOUR_CARDS) });

  test('shrinking says which cards change page; keeping or dismissing changes nothing', async ({ harness }) => {
    const { page } = harness;
    const writes = layoutWrites(page);
    await expect(slot(page, 4)).toHaveAccessibleDescription('A4');
    const dialog = await openSettings(harness);
    const twoByTwo = dialog.getByRole('button', { name: /^2x2/ });
    await twoByTwo.click();
    const sheet = warning(page);
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('listitem')).toHaveText([
      '2 cards on page 1 will move to page 2.',
      '1 card will stay on the same page but sit in a different spot.',
      'The binder will have 257 pages instead of 65.',
      'No card leaves its pocket and nothing is removed. Pockets, cards and wants keep their order.',
    ]);
    await sheet.getByRole('button', { name: 'Keep 4×4', exact: true }).click();
    await expect(sheet).toHaveCount(0);
    await twoByTwo.click();
    await expect(sheet).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: /^4x4/ })).toHaveAttribute('aria-pressed', 'true');
    expect(writes).toHaveLength(0);

    await twoByTwo.click();
    await sheet.getByRole('button', { name: 'Change layout', exact: true }).click();
    await expect(twoByTwo).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => writes).toEqual([{ rows: 2, cols: 2 }]);
    await harness.closeControl(dialog).click();
    // Charmander keeps its pocket, now the last spot of page 1; every card is still in the binder.
    await expect(slot(page, 4)).toHaveAccessibleDescription('B2');
    await harness.reload();
    await expect(slot(page, 4)).toHaveAccessibleDescription('B2');
  });

  test('growing pulls cards back onto earlier pages', async ({ harness }) => {
    const { page } = harness;
    const dialog = await openSettings(harness);
    await dialog.getByRole('button', { name: /^2x2/ }).click();
    await warning(page).getByRole('button', { name: 'Change layout', exact: true }).click();
    await expect(dialog.getByRole('button', { name: /^2x2/ })).toHaveAttribute('aria-pressed', 'true');
    await dialog.getByRole('button', { name: /^4x4/ }).click();
    await expect(warning(page).getByRole('listitem').first()).toHaveText('2 cards on page 2 will move to page 1.');
    await expect(warning(page)).toContainText('The binder will have 65 pages instead of 257.');
  });

  test('offline, the new layout shows at once and syncs after reconnecting', async ({ harness }) => {
    const { page } = harness;
    const writes = layoutWrites(page);
    const dialog = await openSettings(harness);
    await page.context().setOffline(true);
    await dialog.getByRole('button', { name: /^3x3/ }).click();
    await warning(page).getByRole('button', { name: 'Change layout', exact: true }).click();
    await expect(dialog.getByRole('status')).toHaveText('Saved on this device. Will sync when you’re online.');
    await expect(dialog.getByRole('button', { name: /^3x3/ })).toHaveAttribute('aria-pressed', 'true');
    await harness.closeControl(dialog).click();
    await expect(slot(page, 4)).toHaveAccessibleDescription('B1');
    await page.context().setOffline(false);
    await expect.poll(() => writes, { timeout: 15_000 }).toEqual([{ rows: 3, cols: 3 }]);
    await harness.reload();
    await expect(slot(page, 4)).toHaveAccessibleDescription('B1');
  });
});
