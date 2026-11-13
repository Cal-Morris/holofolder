import { test, expect, type Harness } from './fixtures';

/** Swipes right from the left screen edge: `distance` px over `steps` moves. */
async function edgeSwipe(harness: Harness, distance = 140, steps = 6, dy = 0) {
  const y = (harness.page.viewportSize()?.height ?? 700) * 0.45;
  await harness.page.mouse.move(4, y);
  await harness.page.mouse.down();
  for (let step = 1; step <= steps; step += 1) {
    await harness.page.mouse.move(4 + (distance * step) / steps, y + (dy * step) / steps);
  }
  await harness.page.mouse.up();
}

const listSearch = (harness: Harness) => harness.page.getByPlaceholder('Search name, card, set, or dex #');
const setsView = (harness: Harness) => harness.page.getByRole('group', { name: 'Browse perspective' });

test.describe('edge swipe back', { tag: '@matrix' }, () => {
  test('returns to the previous view in the installed app only', async ({ harness, standalone }) => {
    await harness.dock().getByRole('button', { name: 'List', exact: true }).click();
    await expect(listSearch(harness)).toBeVisible();
    await harness.dock().getByRole('button', { name: 'Browse', exact: true }).click();
    await expect(setsView(harness)).toBeVisible();

    await edgeSwipe(harness);
    if (standalone) {
      await expect(listSearch(harness)).toBeVisible();
      await expect(setsView(harness)).toBeHidden();
    } else {
      // A browser tab keeps the system back gesture; the app does not add its own.
      await harness.page.waitForTimeout(300);
      await expect(setsView(harness)).toBeVisible();
    }
    await expect(harness.page).toHaveURL(/\/app\/e2e-harness/);
  });

  test('closes the open sheet like the back button', async ({ harness, standalone }) => {
    test.skip(!standalone, 'installed-app gesture');
    const dialog = await harness.openCardDetail();
    await edgeSwipe(harness);
    await expect(dialog).toBeHidden();
    await expect(harness.dialogs()).toHaveCount(0);
    await expect(harness.page).toHaveURL(/\/app\/e2e-harness/);
    await harness.expectScrollUnlocked();
  });

  test('a vertical drag or a short nudge from the edge does nothing', async ({ harness, standalone }) => {
    test.skip(!standalone, 'installed-app gesture');
    await harness.dock().getByRole('button', { name: 'List', exact: true }).click();
    await harness.dock().getByRole('button', { name: 'Browse', exact: true }).click();
    await expect(setsView(harness)).toBeVisible();
    await edgeSwipe(harness, 10, 4, 160);
    await harness.page.mouse.move(4, 300);
    await harness.page.mouse.down();
    for (let step = 1; step <= 6; step += 1) {
      await harness.page.waitForTimeout(40);
      await harness.page.mouse.move(4 + step * 6, 300);
    }
    await harness.page.mouse.up();
    await harness.page.waitForTimeout(300);
    await expect(setsView(harness)).toBeVisible();
    await expect(harness.page.locator('html[data-edge-back]')).toHaveCount(0);
  });

  test('the binder itself keeps sideways swipes for page turns', async ({ harness, standalone }) => {
    test.skip(!standalone, 'installed-app gesture');
    await harness.dock().getByRole('button', { name: 'List', exact: true }).click();
    await expect(listSearch(harness)).toBeVisible();
    await harness.dock().getByRole('button', { name: 'Binder', exact: true }).click();
    await expect(listSearch(harness)).toBeHidden();
    await edgeSwipe(harness);
    await harness.page.waitForTimeout(300);
    await expect(listSearch(harness)).toBeHidden();
  });
});
