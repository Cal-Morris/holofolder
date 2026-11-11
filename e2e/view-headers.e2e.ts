import { test, expect, type Harness } from './fixtures';

async function openTab(harness: Harness, tab: 'List' | 'Sets') {
  await harness
    .dock()
    .getByRole('button', { name: tab === 'Sets' ? 'Browse' : tab, exact: true })
    .click();
  await expect(harness.page.getByTestId('view-scroller')).toBeVisible();
}

const scrollTo = (harness: Harness, top: number) =>
  harness.page.getByTestId('view-scroller').evaluate((element, y) => {
    element.scrollTop = y;
    element.dispatchEvent(new Event('scroll'));
  }, top);

test.describe('view headings collapse on scroll', () => {
  test('List view hides its heading while scrolled and keeps search + filters', async ({ harness }) => {
    await openTab(harness, 'List');
    const heading = harness.page.getByTestId('view-heading');
    const scroller = harness.page.getByTestId('view-scroller');
    await expect(heading).toBeVisible();
    const topBefore = (await scroller.boundingBox())!.y;

    await scrollTo(harness, 600);
    await expect(heading).toBeHidden();
    await expect(harness.page.getByPlaceholder('Search name, card, set, or dex #')).toBeVisible();
    await expect(harness.page.getByRole('button', { name: /^missing/i })).toBeVisible();
    const topAfter = (await scroller.boundingBox())!.y;
    expect(topBefore - topAfter, "the list gains the heading's height").toBeGreaterThanOrEqual(30);
    await harness.expectNoHorizontalOverflow();

    // Small scroll back up does not flicker the heading back in.
    await scrollTo(harness, 20);
    await expect(heading).toBeHidden();
    await scrollTo(harness, 0);
    await expect(heading).toBeVisible();
  });

  test('Sets view keeps its heading when there is little to scroll', async ({ harness }) => {
    await openTab(harness, 'Sets');
    const heading = harness.page.getByTestId('view-heading');
    await expect(heading).toBeVisible();
    const range = await harness.page
      .getByTestId('view-scroller')
      .evaluate((element) => element.scrollHeight - element.clientHeight);
    await scrollTo(harness, 200);
    if (range < 120) {
      await expect(heading).toBeVisible();
    } else {
      await expect(heading).toBeHidden();
    }
  });
});
