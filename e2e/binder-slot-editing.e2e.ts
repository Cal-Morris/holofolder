import { test, expect, Harness, mockBackends, emulateStandalone } from './fixtures';

test.describe('staged explicit layout editing', () => {
  test.use({
    signedIn: true,
    harness: async ({ page, context, standalone, insets, baseURL }, provide) => {
      if (standalone) await emulateStandalone(page, insets);
      await mockBackends(page, context, { signedIn: true, baseURL });
      // These staged specs open their explicit synthetic slot surface, not authenticated startup.
      await provide(new Harness(page, insets, true));
    },
  });
  const sheet = (page: import('@playwright/test').Page) => page.getByRole('dialog', { name: /details$/ });
  const slot = (page: import('@playwright/test').Page, id: string) => page.locator(`button[data-slot-id="${id}"]`);
  const toolbar = (page: import('@playwright/test').Page) =>
    page.getByRole('region', { name: 'Layout editing', exact: true });
  /** While editing, the bar's status reads the selection ("Tap pockets to select", "1 selected"). */
  const count = (page: import('@playwright/test').Page) => toolbar(page).getByRole('status');
  const edit = (page: import('@playwright/test').Page) =>
    toolbar(page).getByRole('button', { name: 'Edit layout', exact: true }).click();
  const bar = (page: import('@playwright/test').Page, name: string) =>
    toolbar(page).getByRole('button', { name, exact: true });
  const add = async (page: import('@playwright/test').Page, item: string) => {
    await bar(page, 'Add').click();
    await page.getByRole('menu', { name: 'Add an empty pocket' }).getByRole('menuitem', { name: item }).click();
  };
  const moveTo = async (page: import('@playwright/test').Page, where: 'To the start' | 'To the end') => {
    await bar(page, 'Move').click();
    await bar(page, where).click();
  };
  const drafts = (page: import('@playwright/test').Page) => page.getByLabel('Synthetic draft count');
  test.beforeEach(async ({ harness }) => {
    await harness.page.goto('/app/e2e-harness?signedIn=1&slots=picker&rows=2&cols=2');
    // Complete a real interaction before effect-installed listeners or synthetic events.
    await slot(harness.page, 'slot-a').click();
    await expect(sheet(harness.page)).toBeVisible();
    await harness.closeControl(sheet(harness.page)).click();
    await expect(sheet(harness.page)).toHaveCount(0);
  });

  test('browse taps, holds, drags, swipes and cancelled pointers never emit layout drafts', async ({ harness }) => {
    const { page } = harness;
    await expect(bar(page, 'Edit layout')).toBeVisible();
    const target = slot(page, 'slot-a');
    await target.dispatchEvent('pointerdown', { pointerId: 1, clientX: 30, clientY: 30 });
    await target.dispatchEvent('pointermove', { pointerId: 1, clientX: 100, clientY: 60 });
    await target.dispatchEvent('pointercancel', { pointerId: 1 });
    await target.dispatchEvent('dragstart');
    await target.dispatchEvent('dragend');
    await target.dispatchEvent('contextmenu');
    // A hold opens the pocket's shortcut menu or its details; neither is a layout change.
    await target.click({ delay: 650 });
    await page.keyboard.press('Escape');
    await expect(sheet(page)).toHaveCount(0);
    const box = (await target.boundingBox())!;
    await page.mouse.move(box.x + 10, box.y + 30);
    await page.mouse.down();
    await page.mouse.move(box.x + 10, box.y + 100, { steps: 8 });
    await page.mouse.up();
    await expect(drafts(page)).toHaveText('0');
  });

  test('first insertion shifts whole slots across pages, moves preserve the target and copy', async ({ harness }) => {
    const { page } = harness;
    const writes: string[] = [];
    page.on('request', (r) => {
      if (/\/api\/(inventory|binder-slots|collection)(\?|$)/.test(r.url()) && r.method() !== 'GET')
        writes.push(r.url());
    });
    await expect(slot(page, 'slot-a')).toHaveAccessibleDescription('A1');
    await edit(page);
    await expect(count(page)).toHaveText('Tap pockets to select');
    await harness.expectMinTapTarget(slot(page, 'slot-a'), 36);
    for (const control of await toolbar(page).getByRole('button').all()) await harness.expectMinTapTarget(control, 36);
    await harness.expectWithinSafeViewport(toolbar(page));
    await slot(page, 'slot-a').click();
    await expect(count(page)).toHaveText('1 selected');
    await expect(sheet(page)).toHaveCount(0);
    await add(page, 'Before the selection');
    await expect(drafts(page)).toHaveText('1');
    await moveTo(page, 'To the end');
    await expect(drafts(page)).toHaveText('2');
    await harness.expectNoHorizontalOverflow();
    await bar(page, 'Done').click();
    await expect(bar(page, 'Edit layout')).toBeVisible();
    const pager = page.getByRole('spinbutton', { name: 'Binder page number' });
    await pager.fill('2');
    await pager.press('Enter');
    await expect(slot(page, 'slot-a')).toBeVisible();
    await expect(slot(page, 'slot-a')).toHaveAccessibleName('Snorlax A, Owned');
    // Coordinates follow the pocket's position on this page, not the stable slot id.
    await expect(slot(page, 'slot-a')).toHaveAccessibleDescription('B2');
    await edit(page);
    await slot(page, 'slot-a').click();
    await add(page, 'After the selection');
    await expect(drafts(page)).toHaveText('3');
    await bar(page, 'Done').click();
    await expect(pager).toHaveAttribute('max', '3');
    await pager.fill('3');
    await pager.press('Enter');
    await expect(page.locator('button[data-slot-id]')).toHaveCount(1);
    await expect(page.locator('button[data-slot-id]')).toHaveAccessibleName('Free slot, Empty spacer');
    await expect(page.locator('button[data-slot-id]')).toHaveAccessibleDescription('A1');
    expect(writes).toEqual([]);
  });

  test('append creates a trailing page and works on an empty collection', async ({ harness }) => {
    const { page } = harness;
    await edit(page);
    await add(page, 'At the end of the binder');
    await add(page, 'At the end of the binder');
    await expect(drafts(page)).toHaveText('2');
    await page.evaluate(() => window.dispatchEvent(new Event('synthetic-layout-empty')));
    await expect(page.getByText('No slots in this binder', { exact: true })).toBeVisible();
    await add(page, 'At the end of the binder');
    await expect(page.locator('button[data-slot-id]')).toHaveCount(1);
    await expect(page.locator('button[data-slot-id]')).toHaveAccessibleName('Free slot, Empty spacer');
    await expect(drafts(page)).toHaveText('3');
  });

  test('moves and deselecting keep handed-off drafts', async ({ harness }) => {
    const { page } = harness;
    await edit(page);
    await slot(page, 'slot-a').click();
    await moveTo(page, 'To the end');
    await expect(drafts(page)).toHaveText('1');
    await moveTo(page, 'To the start');
    await expect(drafts(page)).toHaveText('2');
    await add(page, 'After the selection');
    await expect(drafts(page)).toHaveText('3');
    await slot(page, 'slot-a').click();
    await expect(count(page)).toHaveText('Tap pockets to select');
    await expect(slot(page, 'slot-a')).toHaveAttribute('aria-pressed', 'false');
    await expect(drafts(page)).toHaveText('3');
  });

  test('pointer begun in Browse cannot become edit selection, Done clears selection and reload starts Browse', async ({
    harness,
  }) => {
    const { page } = harness;
    const target = slot(page, 'slot-a');
    await target.dispatchEvent('pointerdown', { pointerId: 1, clientX: 30, clientY: 30 });
    await bar(page, 'Edit layout').focus();
    await page.keyboard.press('Enter');
    await expect(count(page)).toHaveText('Tap pockets to select');
    // A cancelled pointer on a bar control never runs it.
    const addButton = bar(page, 'Add');
    await addButton.dispatchEvent('pointerdown', { pointerId: 2, clientX: 30, clientY: 30 });
    await addButton.dispatchEvent('pointercancel', { pointerId: 2 });
    await addButton.dispatchEvent('click', { detail: 1 });
    await expect(page.getByRole('menu', { name: 'Add an empty pocket' })).toHaveCount(0);
    await expect(drafts(page)).toHaveText('0');
    await target.dispatchEvent('pointerup', { pointerId: 1, clientX: 30, clientY: 30 });
    await target.dispatchEvent('click', { detail: 1 });
    await expect(sheet(page)).toHaveCount(0);
    await target.click();
    await expect(target).toHaveAttribute('aria-pressed', 'true');
    await bar(page, 'Done').click();
    await expect(target).toHaveAttribute('aria-pressed', 'false');
    await edit(page);
    await page.reload();
    await expect(bar(page, 'Edit layout')).toBeVisible();
    await expect(drafts(page)).toHaveText('0');
  });

  test('owner/binder and view changes exit editing and discard the unfinished selection', async ({ harness }) => {
    const { page } = harness;
    for (const kind of ['owner', 'binder']) {
      await edit(page);
      await slot(page, 'slot-a').click();
      await expect(count(page)).toHaveText('1 selected');
      await page.evaluate(
        (kind) => window.dispatchEvent(new CustomEvent('synthetic-slot-scope-change', { detail: kind })),
        kind,
      );
      await expect(bar(page, 'Edit layout')).toBeVisible();
    }
    await edit(page);
    await harness.dock().getByRole('button', { name: 'List', exact: true }).click();
    await expect(toolbar(page)).toHaveCount(0);
    await harness.dock().getByRole('button', { name: 'Binder', exact: true }).click();
    await expect(bar(page, 'Edit layout')).toBeVisible();
    await expect(drafts(page)).toHaveText('0');
  });

  test('presentation filters disable layout editing and returning to All starts Browse', async ({ harness }) => {
    const { page } = harness;
    await edit(page);
    const options = page.getByRole('dialog', { name: 'View options', exact: true });
    await page.getByRole('button', { name: 'View', exact: true }).click();
    await options.getByRole('combobox', { name: 'Generation', exact: true }).selectOption('1');
    await harness.closeControl(options).click();
    await expect(toolbar(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'View', exact: true }).click();
    await options.getByRole('combobox', { name: 'Generation', exact: true }).selectOption('0');
    await harness.closeControl(options).click();
    await expect(bar(page, 'Edit layout')).toBeVisible();
    await expect(drafts(page)).toHaveText('0');
  });

  test('rejected draft retries original operation and slot IDs without claiming success', async ({ harness }) => {
    const { page } = harness;
    await edit(page);
    await page.evaluate(() => window.dispatchEvent(new Event('synthetic-layout-reject-once')));
    await add(page, 'At the end of the binder');
    await expect(toolbar(page).getByRole('alert')).toContainText('Save not confirmed.');
    await expect(drafts(page)).toHaveText('0');
    const rejected = JSON.parse((await page.getByLabel('Synthetic rejected draft').textContent())!);
    await bar(page, 'Try again').click();
    await expect(drafts(page)).toHaveText('1');
    expect(JSON.parse((await page.getByLabel('Synthetic latest draft').textContent())!)).toEqual(rejected);
    const id = rejected.intent.request.commands[0].ids[0];
    await page.getByRole('spinbutton', { name: 'Binder page number' }).fill('2');
    await page.getByRole('spinbutton', { name: 'Binder page number' }).press('Enter');
    await expect(slot(page, id)).toBeVisible();
    await expect(toolbar(page).getByRole('alert')).toHaveCount(0);
  });

  test('read-only callers have no layout controls', async ({ harness }) => {
    const { page } = harness;
    await page.goto('/app/e2e-harness?signedIn=1&slots=picker&readOnly=1&rows=2&cols=2');
    await expect(slot(page, 'slot-a')).toBeVisible();
    await expect(toolbar(page)).toHaveCount(0);
  });
});
