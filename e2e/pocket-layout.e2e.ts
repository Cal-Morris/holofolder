import { test, expect, Harness, mockBackends, emulateStandalone } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import { syntheticSlotPickerSnapshot } from '../tests/fixtures/slot-picker';

// Layout editing happens on the binder's own pockets. Synthetic slots, copies and catalog only
// (tests/fixtures/slot-picker.ts); the staged harness counts prepared drafts and applies them to the view.
test.describe('layout editing on the pockets', () => {
  test.use({
    signedIn: true,
    harness: async ({ page, context, standalone, insets, baseURL }, provide) => {
      if (standalone) await emulateStandalone(page, insets);
      await mockBackends(page, context, { signedIn: true, baseURL });
      await provide(new Harness(page, insets, true));
    },
  });
  test.beforeEach(async ({ harness }) => {
    const { page } = harness;
    await page.route('**/app/api/tcgdex-cache**', (route) =>
      route.fulfill({
        json: {
          cards: syntheticSlotPickerSnapshot()
            .cards.filter((c) => c.dexIds?.includes(143))
            .map(({ dexIds: _d, ...c }) => c),
          source: 'mirror',
        },
      }),
    );
    await page.route('**/app/api/card-prices**', (route) => route.fulfill({ json: { prices: [] } }));
    await page.goto('/app/e2e-harness?signedIn=1&slots=picker&rows=2&cols=4');
    await expect(pocket(page, 'slot-a')).toBeVisible();
  });
  const pocket = (page: Page, id: string) => page.locator(`button[data-slot-id="${id}"]`);
  const bar = (page: Page) => page.getByRole('region', { name: 'Layout editing', exact: true });
  const count = (page: Page) => page.getByLabel('Synthetic draft count');
  const draft = async (page: Page) =>
    JSON.parse((await page.getByLabel('Synthetic latest draft').textContent()) ?? 'null');
  const order = (page: Page) =>
    page
      .locator('[data-binder-page] button[data-slot-id]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-slot-id')));
  const menu = (page: Page) => page.getByRole('dialog', { name: /pocket options$/ });
  /** Dropped and pushed-aside pockets spring into place; wait until every one has landed. */
  const landed = (page: Page) =>
    page.evaluate(() =>
      Promise.all(
        document
          .getAnimations()
          .filter((a) => a.effect?.getTiming().iterations !== Infinity)
          .map((a) => a.finished.catch(() => undefined)),
      ),
    );
  const edit = async (page: Page) => {
    await bar(page).getByRole('button', { name: 'Edit layout', exact: true }).click();
    await expect(bar(page).getByRole('button', { name: 'Done', exact: true })).toBeVisible();
  };
  /** The keyboard's menu key (and Shift+F10) arrive as a contextmenu event with no pointer position. */
  const menuKey = (target: Locator) =>
    target.evaluate((el) => {
      (el as HTMLElement).focus();
      el.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 0, clientY: 0, detail: 0 }),
      );
    });
  const touch = async (target: Locator, type: string, dx = 0, dy = 0) => {
    const box = (await target.boundingBox())!;
    await target.dispatchEvent(type, {
      pointerType: 'touch',
      pointerId: 7,
      isPrimary: true,
      bubbles: true,
      clientX: box.x + box.width / 2 + dx,
      clientY: box.y + box.height / 2 + dy,
    });
  };

  test(
    'empty, one and many: pockets are selected on the page under one compact bar',
    { tag: '@matrix' },
    async ({ harness }) => {
      const { page } = harness;
      const before = await pocket(page, 'slot-a').boundingBox();
      await edit(page);
      await expect(bar(page).getByRole('status')).toHaveText('Tap pockets to select');
      // One compact bar, not a panel: no second list of the pockets and no staging wording.
      const box = (await bar(page).boundingBox())!;
      expect(box.height).toBeLessThanOrEqual(harness.viewport.width >= 640 ? 64 : 112);
      await expect(
        bar(page).getByRole('button', { name: /Slot \d|Select slot|Select page|Append free slot/ }),
      ).toHaveCount(0);
      await expect(bar(page)).not.toContainText(/draft|Save on this device|Saved position|anchor/i);
      await expect(bar(page).getByRole('button', { name: 'Move', exact: true })).toBeDisabled();
      // The binder page keeps its place and (nearly) its size under the bar.
      const during = await pocket(page, 'slot-a').boundingBox();
      expect(during!.width).toBeGreaterThan(before!.width * 0.7);
      await pocket(page, 'slot-a').click();
      await expect(bar(page).getByRole('status')).toHaveText('1 selected');
      await expect(pocket(page, 'slot-a')).toHaveAttribute('aria-pressed', 'true');
      await expect(pocket(page, 'slot-a').locator('[data-pocket-mark="selected"]')).toBeVisible();
      await expect(pocket(page, 'slot-b').locator('[data-pocket-mark="available"]')).toBeVisible();
      await pocket(page, 'slot-c').click();
      await pocket(page, 'slot-f').click();
      await expect(bar(page).getByRole('status')).toHaveText('3 selected');
      // A tap in layout editing never opens a card, a selector or a form, and prepares nothing.
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(count(page)).toHaveText('0');
      await pocket(page, 'slot-c').click();
      await expect(bar(page).getByRole('status')).toHaveText('2 selected');
      for (const action of await bar(page).locator('button:visible').all())
        await harness.expectMinTapTarget(action, 36);
      await harness.expectNoHorizontalOverflow();
      await bar(page).getByRole('button', { name: 'Done', exact: true }).click();
      await expect(pocket(page, 'slot-a')).toHaveAttribute('aria-pressed', 'false');
      await expect(pocket(page, 'slot-a').locator('[data-pocket-mark]')).toHaveCount(0);
      await expect(count(page)).toHaveText('0');
    },
  );

  test('a move picks its destination by tapping a pocket and saves as one change', async ({ harness }) => {
    const { page } = harness;
    await edit(page);
    await pocket(page, 'slot-a').click();
    await pocket(page, 'slot-c').click();
    await bar(page).getByRole('button', { name: 'Move', exact: true }).click();
    await expect(bar(page).getByRole('status')).toHaveText('Tap where they go');
    // A selected pocket can't be its own destination.
    await pocket(page, 'slot-c').click();
    await expect(bar(page).getByRole('alert')).toContainText("isn't selected");
    await expect(count(page)).toHaveText('0');
    await pocket(page, 'slot-f').click();
    await expect(count(page)).toHaveText('1');
    expect(await order(page)).toEqual(['slot-b', 'slot-d', 'slot-e', 'slot-a', 'slot-c', 'slot-f', 'slot-g']);
    expect((await draft(page)).intent.request.commands).toHaveLength(1);
    // The moved pockets stay selected and the bar is ready for the next action.
    await expect(bar(page).getByRole('status')).toHaveText('2 selected');
    await expect(bar(page).getByRole('alert')).toHaveCount(0);
    await bar(page).getByRole('button', { name: 'Move', exact: true }).click();
    await bar(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(bar(page).getByRole('status')).toHaveText('2 selected');
    await bar(page).getByRole('button', { name: 'Move', exact: true }).click();
    await bar(page).getByRole('button', { name: 'To the start', exact: true }).click();
    await expect(count(page)).toHaveText('2');
    expect((await order(page)).slice(0, 2)).toEqual(['slot-a', 'slot-c']);
  });

  test('pockets are added at the end, or before and after the selection', async ({ harness }) => {
    const { page } = harness;
    await edit(page);
    await bar(page).getByRole('button', { name: 'Add', exact: true }).click();
    const add = bar(page).getByRole('menu', { name: 'Add an empty pocket' });
    await expect(add.getByRole('menuitem')).toHaveCount(2);
    await add.getByRole('menuitem', { name: 'At the end of the binder' }).click();
    await expect(count(page)).toHaveText('1');
    await expect(page.locator('[data-binder-page] button[data-slot-id]')).toHaveCount(8);
    await pocket(page, 'slot-a').click();
    await bar(page).getByRole('button', { name: 'Add', exact: true }).click();
    await add.getByRole('menuitem', { name: 'Before the selection' }).click();
    await expect(count(page)).toHaveText('2');
    expect((await order(page))[1]).toBe('slot-a');
    await expect(bar(page).getByRole('alert')).toHaveCount(0);
  });

  test('right-click and the menu key open a short pocket menu; every action there is also in layout editing', async ({
    harness,
  }) => {
    const { page } = harness;
    await pocket(page, 'slot-a').click({ button: 'right' });
    const dialog = menu(page);
    await expect(dialog).toHaveAccessibleName('Snorlax A pocket options');
    await expect(dialog).toContainText('Page 1 · Pocket 1');
    const items = dialog.getByRole('menuitem');
    await expect(items).toHaveText([
      'View card',
      'Take the card out',
      'Remove from collection',
      'Move this pocket',
      'Add a pocket before',
      'Add a pocket after',
      'Select',
    ]);
    for (const item of await items.all()) await harness.expectMinTapTarget(item, 36);
    await harness.expectWithinSafeViewport(dialog);
    await harness.expectNoHorizontalOverflow();
    // Escape, backdrop and back all close it without doing anything.
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await menuKey(pocket(page, 'slot-a'));
    await expect(dialog).toBeVisible();
    await harness.tapBackdrop(dialog);
    await expect(dialog).toHaveCount(0);
    await menuKey(pocket(page, 'slot-e'));
    await expect(dialog).toHaveAccessibleName('Snorlax pocket options');
    // An empty pocket has no card to take out or remove.
    await expect(dialog.getByRole('menuitem')).toHaveText([
      'Add a card',
      'Move this pocket',
      'Add a pocket before',
      'Add a pocket after',
      'Select',
    ]);
    await page.evaluate(() => window.history.back());
    await expect(dialog).toHaveCount(0);
    expect(page.url()).toContain('e2e-harness');
    await expect(count(page)).toHaveText('0');
    // Select: layout editing opens with this pocket selected.
    await menuKey(pocket(page, 'slot-b'));
    await dialog.getByRole('menuitem', { name: 'Select', exact: true }).click();
    await expect(bar(page).getByRole('status')).toHaveText('1 selected');
    await expect(pocket(page, 'slot-b')).toHaveAttribute('aria-pressed', 'true');
    await bar(page).getByRole('button', { name: 'Done', exact: true }).click();
    // Move this pocket: straight to choosing where it goes.
    await pocket(page, 'slot-a').click({ button: 'right' });
    await dialog.getByRole('menuitem', { name: 'Move this pocket' }).click();
    await expect(bar(page).getByRole('status')).toHaveText('Tap where it goes');
    await pocket(page, 'slot-d').click();
    await expect(count(page)).toHaveText('1');
    expect((await order(page)).slice(0, 4)).toEqual(['slot-b', 'slot-c', 'slot-a', 'slot-d']);
    await bar(page).getByRole('button', { name: 'Done', exact: true }).click();
    // Add a pocket after, straight from the menu.
    await pocket(page, 'slot-g').click({ button: 'right' });
    await dialog.getByRole('menuitem', { name: 'Add a pocket after' }).click();
    await expect(count(page)).toHaveText('2');
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('[data-binder-page] button[data-slot-id]')).toHaveCount(8);
    await harness.expectScrollUnlocked();
  });

  test('a graded card can be taken out but not removed from the menu, and View card opens its details', async ({
    harness,
  }) => {
    const { page } = harness;
    await pocket(page, 'slot-b').click({ button: 'right' });
    await expect(menu(page).getByRole('menuitem', { name: 'Remove from collection' })).toHaveCount(0);
    await expect(menu(page).getByRole('menuitem', { name: 'Take the card out' })).toBeVisible();
    await menu(page).getByRole('menuitem', { name: 'View card' }).click();
    await expect(menu(page)).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: /details$/ })).toContainText('PSA');
    await expect(count(page)).toHaveText('0');
  });

  test('a long press opens the menu, is dropped by a pan, and never also counts as a tap', async ({ harness }) => {
    const { page } = harness;
    const target = pocket(page, 'slot-a');
    // Held still: the menu opens, and lifting the finger (with the click that follows) opens nothing else.
    await touch(target, 'pointerdown');
    await expect(menu(page)).toBeVisible();
    await touch(target, 'pointerup');
    await target.dispatchEvent('click', { detail: 1, bubbles: true });
    await expect(page.getByRole('dialog', { name: /details$/ })).toHaveCount(0);
    await expect(menu(page)).toBeVisible();
    // iOS sends that click to whatever is under the finger now, the menu's backdrop: it must not close the menu.
    await page.locator('[data-overlay-backdrop]').dispatchEvent('click', { detail: 1, bubbles: true });
    await expect(menu(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu(page)).toHaveCount(0);
    // A pan, a scroll or a page swipe: the finger moves, so nothing opens, then or later.
    await touch(target, 'pointerdown');
    await touch(target, 'pointermove', 24, 0);
    await page.waitForTimeout(700);
    await expect(menu(page)).toHaveCount(0);
    await touch(target, 'pointerup', 24, 0);
    // The browser taking over the gesture cancels it too.
    await touch(target, 'pointerdown');
    await touch(target, 'pointercancel');
    await page.waitForTimeout(700);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // A short tap is still an ordinary tap: the card's details.
    await target.click();
    await expect(page.getByRole('dialog', { name: /details$/ })).toBeVisible();
    await expect(count(page)).toHaveText('0');
  });

  /** Press a pocket with the mouse and carry it over another, without letting go. */
  const hold = async (page: Page, from: string, to: string) => {
    const a = (await pocket(page, from).boundingBox())!;
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    const b = (await pocket(page, to).boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
    // Aim again: the edit bar may have come in above the binder when the card was picked up.
    const c = (await pocket(page, to).boundingBox())!;
    await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2, { steps: 2 });
  };
  const drawn = (page: Page, id: string) => pocket(page, id).evaluate((el) => (el as HTMLElement).style.translate);
  const ghost = (page: Page) => page.locator('[data-pocket-ghost]');

  test('a quick drop swaps the two pockets and nothing shifts while the card is carried', async ({ harness }) => {
    const { page } = harness;
    await hold(page, 'slot-a', 'slot-d');
    await expect(bar(page).getByRole('button', { name: 'Done', exact: true })).toBeVisible();
    // The card under the pointer is a copy; its own pocket waits empty-looking, the target is outlined as a swap.
    await expect(ghost(page)).toHaveCount(1);
    await expect(pocket(page, 'slot-a')).toHaveAttribute('data-drag-source', '');
    await expect(pocket(page, 'slot-d')).toHaveAttribute('data-drop-target', 'swap');
    for (const id of ['slot-b', 'slot-c', 'slot-d']) expect(await drawn(page, id)).toBe('');
    await page.mouse.up();
    await expect(count(page)).toHaveText('1');
    expect(await order(page)).toEqual(['slot-d', 'slot-b', 'slot-c', 'slot-a', 'slot-e', 'slot-f', 'slot-g']);
    await expect(ghost(page)).toHaveCount(0);
    await expect(pocket(page, 'slot-a')).not.toHaveAttribute('data-drag-source', '');
    await expect(pocket(page, 'slot-a')).toHaveClass(/pocket-wiggle/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await landed(page);
    // Onto an empty pocket the card just goes there.
    await hold(page, 'slot-b', 'slot-e');
    await expect(pocket(page, 'slot-e')).toHaveAttribute('data-drop-target', 'place');
    await page.mouse.up();
    await expect(count(page)).toHaveText('2');
    expect(await order(page)).toEqual(['slot-d', 'slot-e', 'slot-c', 'slot-a', 'slot-b', 'slot-f', 'slot-g']);
    await bar(page).getByRole('button', { name: 'Done', exact: true }).click();
    await expect(pocket(page, 'slot-a')).not.toHaveClass(/pocket-wiggle/);
  });

  test('resting on a filled pocket makes room there, pushing cards on into the next empty pocket', async ({
    harness,
  }) => {
    const { page } = harness;
    await edit(page);
    await hold(page, 'slot-a', 'slot-c');
    await expect(pocket(page, 'slot-c')).toHaveAttribute('data-drop-target', 'push');
    // c and d slide on one place; e is the empty pocket they fill, so it and everything before c stay put.
    expect(await drawn(page, 'slot-c')).not.toBe('');
    expect(await drawn(page, 'slot-d')).not.toBe('');
    for (const id of ['slot-b', 'slot-e']) expect(await drawn(page, id)).toBe('');
    await page.mouse.up();
    await expect(count(page)).toHaveText('1');
    expect(await order(page)).toEqual(['slot-e', 'slot-b', 'slot-a', 'slot-c', 'slot-d', 'slot-f', 'slot-g']);
    expect((await draft(page)).intent.request.commands).toHaveLength(2);
    await landed(page);
    await bar(page).getByRole('button', { name: 'Undo move', exact: true }).click();
    await expect(count(page)).toHaveText('2');
    expect(await order(page)).toEqual(['slot-a', 'slot-b', 'slot-c', 'slot-d', 'slot-e', 'slot-f', 'slot-g']);
  });

  test('Escape, or letting go over nothing, puts the card back', async ({ harness }) => {
    const { page } = harness;
    await edit(page);
    await hold(page, 'slot-a', 'slot-c');
    await page.keyboard.press('Escape');
    await expect(ghost(page)).toHaveCount(0, { timeout: 2000 });
    await expect(pocket(page, 'slot-c')).not.toHaveAttribute('data-drop-target', /.*/);
    await page.mouse.up();
    await expect(bar(page).getByRole('button', { name: 'Done', exact: true })).toBeVisible();
    await hold(page, 'slot-a', 'slot-b');
    await page.mouse.move(2, 2, { steps: 4 });
    await page.mouse.up();
    await expect(ghost(page)).toHaveCount(0, { timeout: 2000 });
    await expect(count(page)).toHaveText('0');
  });

  test('a card carried to the side of the binder turns the page after a beat, or a second finger swipes it', async ({
    harness,
  }) => {
    const { page } = harness;
    await page.goto('/app/e2e-harness?signedIn=1&slots=picker&rows=2&cols=2');
    await expect(pocket(page, 'slot-a')).toBeVisible();
    await edit(page);
    const a = (await pocket(page, 'slot-a').boundingBox())!;
    const stage = (await page.locator('[data-page-turn-ms]').boundingBox())!;
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(stage.x + stage.width - 4, a.y + a.height / 2, { steps: 10 });
    // Not straight away: the bar fills first.
    await expect(page.locator('[data-pocket-edge="next"]')).toHaveCount(1);
    await expect(pocket(page, 'slot-e')).toBeVisible();
    await expect(ghost(page)).toHaveCount(1);
    // Page 2 is in and the card is still held; drop it in an empty pocket there.
    const e = (await pocket(page, 'slot-e').boundingBox())!;
    await page.mouse.move(e.x + e.width / 2, e.y + e.height / 2, { steps: 6 });
    await expect(pocket(page, 'slot-e')).toHaveAttribute('data-drop-target', 'place');
    await page.mouse.up();
    await expect(count(page)).toHaveText('1');
    await expect(pocket(page, 'slot-a')).toBeVisible();
    expect((await order(page))[0]).toBe('slot-a');
    // A finger holding a card while another swipes: the page turns back under it.
    await landed(page);
    const held = (await pocket(page, 'slot-a').boundingBox())!;
    await touch(pocket(page, 'slot-a'), 'pointerdown');
    await page.waitForTimeout(300);
    await touch(pocket(page, 'slot-a'), 'pointermove', 20, 0);
    await expect(ghost(page)).toHaveCount(1);
    const swipe = (type: string, x: number) =>
      page.evaluate(
        ([type, x, y]) =>
          document.body.dispatchEvent(
            new PointerEvent(type as string, {
              pointerType: 'touch',
              pointerId: 9,
              isPrimary: false,
              bubbles: true,
              clientX: x as number,
              clientY: y as number,
            }),
          ),
        [type, x, held.y + held.height / 2] as const,
      );
    await swipe('pointerdown', 150);
    await swipe('pointermove', 260);
    await swipe('pointerup', 260);
    await expect(pocket(page, 'slot-b')).toBeVisible();
    // Its pocket left with the old page, and the card is still held.
    await expect(pocket(page, 'slot-a')).toHaveCount(0);
    await expect(ghost(page)).toHaveCount(1);
    await page.evaluate(() =>
      window.dispatchEvent(new PointerEvent('pointercancel', { pointerType: 'touch', pointerId: 7, bubbles: true })),
    );
    await expect(ghost(page)).toHaveCount(0, { timeout: 2000 });
  });

  test('while the binder wiggles, a resting finger never opens the pocket menu', async ({ harness }) => {
    const { page } = harness;
    await edit(page);
    const target = pocket(page, 'slot-b');
    await touch(target, 'pointerdown');
    await page.waitForTimeout(700);
    // Android sends contextmenu for a long press while the finger is still down.
    await target.dispatchEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 });
    await touch(target, 'pointerup');
    await expect(menu(page)).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('dragging a selected pocket carries the whole selection', async ({ harness }) => {
    const { page } = harness;
    await edit(page);
    await pocket(page, 'slot-a').click();
    await pocket(page, 'slot-c').click();
    await hold(page, 'slot-c', 'slot-f');
    // The held card says how many it carries; the rest of the selection fades; nothing shifts one by one.
    await expect(ghost(page)).toHaveAttribute('data-carry', '2');
    await expect(pocket(page, 'slot-a')).toHaveAttribute('data-carried', '');
    await expect(pocket(page, 'slot-f')).toHaveAttribute('data-drop-target', 'group');
    expect(await drawn(page, 'slot-d')).toBe('');
    await page.mouse.up();
    await expect(count(page)).toHaveText('1');
    expect(await order(page)).toEqual(['slot-b', 'slot-d', 'slot-e', 'slot-f', 'slot-a', 'slot-c', 'slot-g']);
    expect((await draft(page)).intent.request.commands).toHaveLength(1);
    await expect(pocket(page, 'slot-a')).not.toHaveAttribute('data-carried', '');
    await expect(bar(page).getByRole('status')).toHaveText('2 selected');
  });

  test('moves can be undone and redone, with the buttons or the keyboard', async ({ harness }) => {
    const { page } = harness;
    await edit(page);
    const undo = bar(page).getByRole('button', { name: 'Undo move', exact: true });
    const redo = bar(page).getByRole('button', { name: 'Redo move', exact: true });
    await expect(undo).toBeDisabled();
    await expect(redo).toBeDisabled();
    // Arrow keys walk the pockets; Alt with an arrow moves the focused one.
    await pocket(page, 'slot-a').focus();
    await page.keyboard.press('ArrowRight');
    await expect(pocket(page, 'slot-b')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(pocket(page, 'slot-f')).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Alt+ArrowRight');
    await expect(count(page)).toHaveText('1');
    expect((await order(page)).slice(0, 4)).toEqual(['slot-a', 'slot-c', 'slot-b', 'slot-d']);
    await expect(pocket(page, 'slot-b')).toBeFocused();
    await page.keyboard.press('Alt+ArrowRight');
    await expect(count(page)).toHaveText('2');
    expect((await order(page)).slice(0, 4)).toEqual(['slot-a', 'slot-c', 'slot-d', 'slot-b']);
    // Undo steps back one move at a time, Redo replays it.
    await undo.click();
    await expect(count(page)).toHaveText('3');
    expect((await order(page)).slice(0, 4)).toEqual(['slot-a', 'slot-c', 'slot-b', 'slot-d']);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(count(page)).toHaveText('4');
    expect((await order(page)).slice(0, 4)).toEqual(['slot-a', 'slot-b', 'slot-c', 'slot-d']);
    await expect(undo).toBeDisabled();
    await redo.click();
    await expect(count(page)).toHaveText('5');
    expect((await order(page)).slice(0, 4)).toEqual(['slot-a', 'slot-c', 'slot-b', 'slot-d']);
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(count(page)).toHaveText('6');
    expect((await order(page)).slice(0, 4)).toEqual(['slot-a', 'slot-c', 'slot-d', 'slot-b']);
    await expect(redo).toBeDisabled();
    // A new move clears what could be redone.
    await undo.click();
    await expect(redo).toBeEnabled();
    await pocket(page, 'slot-a').focus();
    await page.keyboard.press('Alt+ArrowRight');
    await expect(count(page)).toHaveText('8');
    await expect(redo).toBeDisabled();
  });

  test('a finger that keeps holding after the long press drags the pocket instead', async ({ harness }) => {
    const { page } = harness;
    const target = pocket(page, 'slot-a');
    await touch(target, 'pointerdown');
    await expect(menu(page)).toBeVisible();
    const from = (await target.boundingBox())!;
    const to = (await pocket(page, 'slot-c').boundingBox())!;
    const dx = to.x - from.x;
    await touch(target, 'pointermove', dx / 2, 0);
    await expect(menu(page)).toHaveCount(0);
    await expect(bar(page).getByRole('button', { name: 'Done', exact: true })).toBeVisible();
    // The pocket itself stays put (a copy follows the finger), so aim from where it sits.
    const aim = (await pocket(page, 'slot-c').boundingBox())!;
    const now = (await target.boundingBox())!;
    const ax = aim.x + aim.width / 2 - (now.x + now.width / 2);
    const ay = aim.y + aim.height / 2 - (now.y + now.height / 2);
    await touch(target, 'pointermove', ax, ay);
    await expect(pocket(page, 'slot-c')).toHaveAttribute('data-drop-target', 'swap');
    await touch(target, 'pointerup', ax, ay);
    await target.dispatchEvent('click', { detail: 1, bubbles: true });
    await expect(count(page)).toHaveText('1');
    expect((await order(page)).slice(0, 4)).toEqual(['slot-c', 'slot-b', 'slot-a', 'slot-d']);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test("the card's details lead into layout editing for that pocket", async ({ harness }) => {
    const { page } = harness;
    await pocket(page, 'slot-a').click();
    const details = page.getByRole('dialog', { name: /details$/ });
    await details.getByRole('button', { name: 'More card options' }).click();
    await details.getByRole('menuitem', { name: 'Rearrange pockets' }).click();
    await expect(details).toHaveCount(0);
    await expect(bar(page).getByRole('status')).toHaveText('1 selected');
    await expect(pocket(page, 'slot-a')).toHaveAttribute('aria-pressed', 'true');
  });

  test('read-only binders have no pocket menu and no layout editing', async ({ harness }) => {
    const { page } = harness;
    await page.goto('/app/e2e-harness?signedIn=1&slots=picker&readOnly=1&rows=2&cols=4');
    await expect(pocket(page, 'slot-a')).toBeVisible();
    await menuKey(pocket(page, 'slot-a'));
    await expect(menu(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit layout', exact: true })).toHaveCount(0);
    await expect(pocket(page, 'slot-a')).not.toHaveAttribute('aria-haspopup', 'menu');
  });
});
