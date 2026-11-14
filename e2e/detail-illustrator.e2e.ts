import { test, expect, MOCK_CARDS, type Harness } from './fixtures';
import type { Locator, Route } from '@playwright/test';

// The seeded Bulbasaur is Base Set 44, credited to Mitsuhiro Arita in MOCK_ILLUSTRATORS (fixtures.ts).
const ARITA_CREDIT = /^illustrator mitsuhiro arita: show all their cards$/i;
const SCREENS = process.env.E2E_SCREENSHOT_DIR;

const isBulbasaurLookup = (url: string) => new URL(url).searchParams.get('ids') === 'base1-44';

/** Hold the seeded card's lookup (where the illustrator comes from) until `release` is called. */
async function holdBulbasaurCards(harness: Harness) {
  const held: Route[] = [];
  let released = false;
  await harness.page.route('**/app/api/tcg-card-search**', (route) => {
    if (!isBulbasaurLookup(route.request().url()) || released) return route.fallback();
    held.push(route);
  });
  // Start again so the card cached by the first load is gone.
  await harness.open();
  return async () => {
    released = true;
    for (const route of held.splice(0)) await route.fallback();
  };
}

/** Positions of the sheet's sections, so a late illustrator can be checked for shifting them. */
async function sectionTops(dialog: Locator) {
  return dialog.getByTestId('detail-illustrator').evaluate((row) => {
    const parent = row.parentElement!;
    return Array.from(parent.children).map((child) => Math.round((child as HTMLElement).getBoundingClientRect().top));
  });
}

async function screenshot(harness: Harness, name: string) {
  if (SCREENS && test.info().project.name.startsWith('standalone-390'))
    await harness.page.screenshot({ path: `${SCREENS}/illustrator-${name}.png` });
}

test.describe('illustrator on the card detail', () => {
  test('keeps its space while it loads, so nothing in the sheet moves when the name arrives', async ({ harness }) => {
    const release = await holdBulbasaurCards(harness);
    const dialog = await harness.openCardDetail();
    const row = dialog.getByTestId('detail-illustrator');
    await expect(row.getByRole('status', { name: 'Loading illustrator' })).toBeVisible();
    const rowHeight = (await row.boundingBox())!.height;
    const before = await sectionTops(dialog);
    await screenshot(harness, 'detail-loading');

    await release();
    const credit = dialog.getByRole('button', { name: ARITA_CREDIT });
    await expect(credit).toBeVisible();
    await expect(row.getByRole('status')).toHaveCount(0);
    // Let the fade finish before measuring.
    await harness.page.waitForTimeout(300);
    expect((await row.boundingBox())!.height).toBeCloseTo(rowHeight, 0);
    expect(await sectionTops(dialog)).toEqual(before);
    await harness.expectMinTapTarget(credit);
    await harness.expectNoHorizontalOverflow();
    await screenshot(harness, 'detail-loaded');
  });

  test('shows the name straight away once the card is loaded', async ({ harness }) => {
    let dialog = await harness.openCardDetail();
    await expect(dialog.getByRole('button', { name: ARITA_CREDIT })).toBeVisible();
    await harness.page.keyboard.press('Escape');
    await expect(harness.dialogs()).toHaveCount(0);

    // Reopening reads the loaded card on the first paint: no loading placeholder at all.
    await harness.page.evaluate(() => {
      const seen: string[] = [];
      (window as unknown as { __illustratorLoading: string[] }).__illustratorLoading = seen;
      new MutationObserver(() => {
        if (document.querySelector('[data-testid="detail-illustrator"] [role="status"]')) seen.push('loading');
      }).observe(document.body, { childList: true, subtree: true });
    });
    dialog = await harness.openCardDetail();
    await expect(dialog.getByRole('button', { name: ARITA_CREDIT })).toBeVisible();
    expect(
      await harness.page.evaluate(() => (window as unknown as { __illustratorLoading: string[] }).__illustratorLoading),
    ).toEqual([]);
  });

  test('a card without a credit keeps the same row, marked not listed', async ({ harness }) => {
    await harness.page.route('**/app/api/tcg-card-search**', (route) => {
      if (!isBulbasaurLookup(route.request().url())) return route.fallback();
      const cards = MOCK_CARDS.filter((card) => card.id === 'base1-44').map(
        ({ illustrator: _illustrator, ...card }) => card,
      );
      return route.fulfill({ json: { cards } });
    });
    await harness.open();
    const dialog = await harness.openCardDetail();
    const row = dialog.getByTestId('detail-illustrator');
    await expect(row.getByText('Not listed')).toBeVisible();
    await expect(dialog.getByRole('button', { name: /^illustrator/i })).toHaveCount(0);
    expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });
});
