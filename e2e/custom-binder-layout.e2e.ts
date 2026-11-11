import { test, expect, E2E_USER, openSettingsPage, type Harness } from './fixtures';
import { getDefaultBinderSettings } from '../lib/settings';

const BINDER = 'e2e00000-0000-4000-8000-000000000001';
async function openSettings(harness: Harness) {
  await harness.page.locator('nav').first().getByRole('button', { name: 'More', exact: true }).click();
  await harness.page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  const dialog = harness.page.getByRole('dialog', { name: /settings/i });
  await expect(dialog).toBeVisible();
  return openSettingsPage(dialog, 'Layout');
}

test.describe('custom binder layouts', () => {
  test.use({ signedIn: true });
  test('premium layouts save per binder, stay tappable and scroll without overflowing the phone', async ({
    harness,
  }) => {
    const { page } = harness;
    let settings = getDefaultBinderSettings();
    const writes: Array<Record<string, unknown>> = [];
    await page.route('**/app/api/settings**', async (route) => {
      if (route.request().method() === 'PUT') {
        const body = route.request().postDataJSON();
        writes.push(body);
        settings = body;
      }
      return route.fulfill({ json: { settings, hasStoredSettings: true } });
    });
    await page.goto('/app/e2e-harness?signedIn=1&binders=1');
    await expect(harness.dock()).toBeVisible();
    const originalSlot = await page.locator('button[data-dex-id]').first().boundingBox();
    const dialog = await openSettings(harness);
    const rows = dialog.getByRole('spinbutton', { name: 'Rows', exact: true });
    const cols = dialog.getByRole('spinbutton', { name: 'Columns', exact: true });
    await expect(rows).toBeVisible();
    await rows.fill('8');
    await cols.fill('8');
    const apply = dialog.getByRole('button', { name: 'Apply layout', exact: true });
    await harness.expectMinTapTarget(apply);
    await apply.click();
    await expect(dialog.getByRole('status')).toHaveText('Layout saved.');
    expect(writes.at(-1)).toMatchObject({ binderId: BINDER, binderRows: 8, binderCols: 8 });
    await harness.expectNoHorizontalOverflow();
    await harness.closeControl(dialog).click();
    const frame = page.getByRole('region', { name: 'Scrollable binder page 1', exact: true });
    await expect(frame).toBeVisible();
    await harness.expectWithinSafeViewport(frame);
    expect((await frame.boundingBox())!.width).toBeGreaterThan(harness.viewport.width - 40);
    const first = frame.locator('button[data-dex-id]').first();
    await harness.expectMinTapTarget(first);
    expect(await frame.locator('button[data-dex-id]').count()).toBe(64);
    const denseSlot = await first.boundingBox();
    console.log(
      JSON.stringify({ viewport: harness.viewport, insets: harness.insets, before: originalSlot, after: denseSlot }),
    );
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
    const last = frame.locator('button[data-dex-id]').last();
    await last.scrollIntoViewIfNeeded();
    await harness.expectMinTapTarget(last);
    await harness.expectHittable(last);
    await harness.expectHittable(harness.dock().getByRole('button').first());
    await harness.expectNoHorizontalOverflow();
    await page.reload();
    await expect(page.getByRole('region', { name: 'Scrollable binder page 1', exact: true })).toBeVisible();
  });

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
    await page.reload();
    await expect(harness.dock()).toBeVisible();
    const dialog = await openSettings(harness);
    const upgrade = dialog.getByRole('button', { name: 'Upgrade for custom layouts' });
    await expect(upgrade).toBeVisible();
    await harness.expectMinTapTarget(upgrade);
    await expect(dialog.getByRole('spinbutton', { name: 'Rows', exact: true })).toHaveCount(0);
    for (const name of ['1x1', '2x2', '3x3', '3x4', '4x3', '4x4'])
      await expect(dialog.getByRole('button', { name: new RegExp(`^${name}`) })).toBeEnabled();
    await harness.expectNoHorizontalOverflow();
  });
});

test.describe('custom layout persistence', () => {
  test.use({ signedIn: true });
  test('offline layout edits stay on the device and sync after reconnect', async ({ harness }) => {
    const { page } = harness;
    let saved = getDefaultBinderSettings();
    const writes: Array<Record<string, unknown>> = [];
    await page.route('**/app/api/settings**', (route) => {
      if (route.request().method() === 'PUT') {
        const body = route.request().postDataJSON();
        writes.push(body);
        saved = body;
      }
      return route.fulfill({ json: { settings: saved, hasStoredSettings: true } });
    });
    await page.goto('/app/e2e-harness?signedIn=1&binders=1');
    await expect(harness.dock()).toBeVisible();
    const dialog = await openSettings(harness);
    await expect(dialog.getByRole('spinbutton', { name: 'Rows', exact: true })).toBeVisible();
    await page.context().setOffline(true);
    await dialog.getByRole('spinbutton', { name: 'Rows', exact: true }).fill('8');
    await dialog.getByRole('spinbutton', { name: 'Columns', exact: true }).fill('8');
    await dialog.getByRole('button', { name: 'Apply layout', exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText('Saved on this device');
    expect(writes).toHaveLength(0);
    const pendingKey = `pokemon_binder_settings:${E2E_USER.id}:binder:${BINDER}:pending`;
    expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).binderRows, pendingKey)).toBe(8);
    await harness.closeControl(dialog).click();
    await expect(page.getByRole('region', { name: 'Scrollable binder page 1', exact: true })).toBeVisible();
    await page.context().setOffline(false);
    await expect.poll(() => writes.length).toBeGreaterThan(0);
    expect(writes.at(-1)).toMatchObject({ binderId: BINDER, binderRows: 8, binderCols: 8 });
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), pendingKey)).toBeNull();
    await page.reload();
    await expect(page.getByRole('region', { name: 'Scrollable binder page 1', exact: true })).toBeVisible();
  });

  test('a rejected custom layout rolls back and invalid dimensions cannot be applied', async ({ harness }) => {
    const { page } = harness;
    await page.route('**/app/api/settings**', (route) =>
      route.request().method() === 'PUT'
        ? route.fulfill({ status: 402, json: { error: 'Upgrade to use custom layouts' } })
        : route.fulfill({ json: { settings: getDefaultBinderSettings() } }),
    );
    const dialog = await openSettings(harness);
    const rows = dialog.getByRole('spinbutton', { name: 'Rows', exact: true });
    const cols = dialog.getByRole('spinbutton', { name: 'Columns', exact: true });
    const apply = dialog.getByRole('button', { name: 'Apply layout', exact: true });
    for (const value of ['9', '0', '2.5', '']) {
      await rows.fill(value);
      await expect(apply).toBeDisabled();
    }
    await rows.fill('8');
    await cols.fill('8');
    await apply.click();
    await expect(dialog.getByRole('status')).toHaveText('Upgrade to use custom layouts');
    await expect(dialog.getByRole('button', { name: /^4x4/ })).toHaveAttribute('aria-pressed', 'true');
    await harness.closeControl(dialog).click();
    await expect(page.getByRole('region', { name: /Scrollable binder/ })).toHaveCount(0);
  });
});

test.describe('queued layout ordering', () => {
  test.use({ signedIn: true });
  test('an older rejected write cannot remove a newer offline layout', async ({ harness }) => {
    const { page } = harness;
    let rejectOlder: (() => void) | undefined;
    const writes: Array<Record<string, unknown>> = [];
    await page.route('**/app/api/settings**', async (route) => {
      if (route.request().method() !== 'PUT') return route.fulfill({ json: { settings: getDefaultBinderSettings() } });
      writes.push(route.request().postDataJSON());
      if (writes.length === 1) {
        await new Promise<void>((resolve) => {
          rejectOlder = resolve;
        });
        return route.fulfill({ status: 400, json: { error: 'Synthetic older write rejection' } });
      }
      return route.fulfill({ json: { settings: writes.at(-1) } });
    });
    await page.goto('/app/e2e-harness?signedIn=1&binders=1');
    await expect(harness.dock()).toBeVisible();
    await page.getByRole('button', { name: 'Hide binder value', exact: true }).click();
    await expect.poll(() => Boolean(rejectOlder)).toBe(true);
    const dialog = await openSettings(harness);
    await expect(dialog.getByRole('spinbutton', { name: 'Rows', exact: true })).toBeVisible();
    await page.context().setOffline(true);
    await dialog.getByRole('spinbutton', { name: 'Rows', exact: true }).fill('8');
    await dialog.getByRole('spinbutton', { name: 'Columns', exact: true }).fill('8');
    await dialog.getByRole('button', { name: 'Apply layout', exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText('Saved on this device');
    rejectOlder!();
    const key = `pokemon_binder_settings:${E2E_USER.id}:binder:${BINDER}:pending`;
    await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).binderRows, key)).toBe(8);
    await page.context().setOffline(false);
    await expect.poll(() => writes.length).toBe(2);
    expect(writes[1]).toMatchObject({ binderRows: 8, binderCols: 8 });
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), key)).toBeNull();
  });
});

test.describe('unavailable settings storage', () => {
  test.use({ signedIn: true });
  test('blocked settings storage does not crash startup and reports an unsaved offline edit', async ({ harness }) => {
    const { page } = harness;
    await page.addInitScript(() => {
      const get = Storage.prototype.getItem,
        set = Storage.prototype.setItem,
        remove = Storage.prototype.removeItem;
      Storage.prototype.getItem = function (key) {
        if (key.startsWith('pokemon_binder_settings'))
          throw new DOMException('Synthetic blocked storage', 'SecurityError');
        return get.call(this, key);
      };
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith('pokemon_binder_settings'))
          throw new DOMException('Synthetic blocked storage', 'SecurityError');
        set.call(this, key, value);
      };
      Storage.prototype.removeItem = function (key) {
        if (key.startsWith('pokemon_binder_settings'))
          throw new DOMException('Synthetic blocked storage', 'SecurityError');
        remove.call(this, key);
      };
    });
    await page.route('**/app/api/settings**', (route) =>
      route.fulfill({ json: { settings: getDefaultBinderSettings() } }),
    );
    await page.reload();
    await expect(harness.dock()).toBeVisible();
    const dialog = await openSettings(harness);
    await expect(dialog.getByRole('spinbutton', { name: 'Rows', exact: true })).toBeVisible();
    await page.context().setOffline(true);
    await dialog.getByRole('spinbutton', { name: 'Rows', exact: true }).fill('8');
    await dialog.getByRole('spinbutton', { name: 'Columns', exact: true }).fill('8');
    await dialog.getByRole('button', { name: 'Apply layout', exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText('Device storage is unavailable');
    await expect(dialog.getByRole('button', { name: /^4x4/ })).toHaveAttribute('aria-pressed', 'true');
  });
});
