import { expect, test } from './fixtures';
import { seedWantList } from './wanted-fixtures';

test.describe('want list on mobile', () => {
  test.use({ signedIn: true });

  test.beforeEach(async ({ harness }) => {
    const { page } = harness;
    await seedWantList(page);
    await page.reload();
    await expect(harness.dock()).toBeVisible({ timeout: 30_000 });
    await harness.dock().getByRole('button', { name: 'Wanted', exact: true }).click();
    await expect(page.getByTestId('wanted-row')).toHaveCount(6);
  });

  test('one summary line, plain rows and Insights collapsed', async ({ harness }) => {
    const { page } = harness;
    const summary = page.getByTestId('wanted-summary');
    await expect(summary).toContainText('6 wanted');
    await expect(summary).toContainText('to complete');
    await expect(summary).toContainText('1 unpriced');

    // The heavy stats are tucked away until asked for.
    const insights = page.getByTestId('wanted-insights');
    await expect(insights).not.toHaveAttribute('open', '');
    await expect(insights.getByText('Sets', { exact: true })).toBeHidden();

    const charmander = page.locator('[data-testid="wanted-row"][data-card-id="sv03.5-168"]');
    await expect(charmander).toContainText('151 · #168/165');
    await expect(charmander.getByTestId('price-rising-badge')).toBeVisible();

    const search = page.getByRole('searchbox', { name: 'Search want list' });
    await harness.expectMinTapTarget(search, 44);
    await harness.expectWithinSafeViewport(search);
    // The view fades in when switched to; wait for it to settle before checking nothing covers the box.
    await expect(() => harness.expectHittable(search)).toPass();
    await harness.expectMinTapTarget(page.getByRole('button', { name: 'Got it: Charmander' }), 44);
    await harness.expectMinTapTarget(page.getByRole('button', { name: 'Share list' }), 44);
    await harness.expectMinTapTarget(page.getByTestId('wanted-sort-filter'), 44);
    await harness.expectNoHorizontalOverflow();

    await insights.locator('summary').click();
    await expect(insights).toContainText('5 of 6 priced');
  });

  test('search by name, Pokémon, set, number and illustrator', async ({ harness }) => {
    const { page } = harness;
    const search = page.getByRole('searchbox', { name: 'Search want list' });
    const rows = page.getByTestId('wanted-row');

    await search.fill('char');
    await expect(rows).toHaveCount(3);
    await search.fill('squirtle 30th');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveAttribute('data-card-id', '30th-007');
    await search.fill('#166');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveAttribute('data-card-id', 'sv03.5-166');
    await search.fill('kouki saito');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveAttribute('data-card-id', 'sv03.5-168');

    await search.fill('mewtwo');
    await expect(rows).toHaveCount(0);
    await expect(page.getByText(/Nothing on your want list matches/)).toBeVisible();
    await page.getByRole('button', { name: 'Show all wanted cards' }).click();
    await expect(rows).toHaveCount(6);
    await harness.expectNoHorizontalOverflow();
  });

  test('sort from the sheet, and the choice is remembered', async ({ harness }) => {
    const { page } = harness;
    const ids = () =>
      page.getByTestId('wanted-row').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-card-id')));
    const openSheet = async () => {
      await page.getByTestId('wanted-sort-filter').click();
      const sheet = page.getByRole('dialog', { name: 'Sort and filter want list' });
      await expect(sheet).toBeVisible();
      return sheet;
    };
    const pickSort = async (label: string) => {
      const sheet = await openSheet();
      const option = sheet.getByRole('radio', { name: label });
      await harness.expectMinTapTarget(option, 44);
      await option.click();
      await expect(option).toHaveAttribute('aria-checked', 'true');
      await sheet.getByRole('button', { name: /^Show \d+ cards?$/ }).click();
      await expect(sheet).toBeHidden();
    };

    await expect.poll(ids).toEqual(['sv03.5-168', 'sv03.5-166', 'sv03.5-006', 'sv03.5-007', 'sv03.5-005', '30th-007']);
    await pickSort('Price: low to high');
    await expect.poll(ids).toEqual(['sv03.5-005', 'sv03.5-007', 'sv03.5-006', 'sv03.5-166', 'sv03.5-168', '30th-007']);
    await pickSort('Name');
    await expect.poll(ids).toEqual(['sv03.5-166', 'sv03.5-006', 'sv03.5-168', 'sv03.5-005', 'sv03.5-007', '30th-007']);
    await pickSort('Rising prices first');
    await expect.poll(async () => (await ids())[0]).toBe('sv03.5-168');
    // 151 is fully priced, the 30th Celebration set has an unpriced card, so 151 comes first, cheapest card first.
    await pickSort('Cheapest set to finish first');
    await expect.poll(ids).toEqual(['sv03.5-005', 'sv03.5-007', 'sv03.5-006', 'sv03.5-166', 'sv03.5-168', '30th-007']);
    // Grouped like Show mode's Hunting list: Squirtle (two wanted) first, then by each Pokémon's dearest card.
    await pickSort('Group by Pokémon');
    await expect.poll(ids).toEqual(['sv03.5-007', '30th-007', 'sv03.5-168', 'sv03.5-166', 'sv03.5-006', 'sv03.5-005']);
    const groups = page.getByTestId('wanted-group');
    await expect(groups).toHaveCount(5);
    await expect(groups.first()).toHaveAttribute('data-pokemon-id', '7');
    await expect(groups.first().getByRole('heading')).toContainText('2 wanted');
    await expect(page.getByTestId('wanted-sort-filter')).toContainText('By Pokémon');
    await harness.expectNoHorizontalOverflow();
    await pickSort('Recently added');
    await expect(page.getByTestId('wanted-group')).toHaveCount(0);
    await expect.poll(async () => (await ids())[0]).toBe('30th-007');
    await expect(page.getByTestId('wanted-sort-filter')).toContainText('Newest');

    await page.reload();
    await expect(harness.dock()).toBeVisible({ timeout: 30_000 });
    await harness.dock().getByRole('button', { name: 'Wanted', exact: true }).click();
    await expect(page.getByTestId('wanted-row')).toHaveCount(6);
    await expect(page.getByTestId('wanted-sort-filter')).toContainText('Newest');
    await expect.poll(async () => (await ids())[0]).toBe('30th-007');
  });

  test('filters from the sheet show as removable chips', async ({ harness }) => {
    const { page } = harness;
    const rows = page.getByTestId('wanted-row');
    await page.getByTestId('wanted-sort-filter').click();
    const sheet = page.getByRole('dialog', { name: 'Sort and filter want list' });
    await expect(sheet).toBeVisible();
    await harness.expectWithinSafeViewport(sheet.getByRole('button', { name: /^Show \d+ cards?$/ }));

    await sheet.getByRole('button', { name: /^Holo/ }).click();
    await expect(sheet.getByRole('button', { name: /^Show 4 cards$/ })).toBeVisible();
    await sheet.getByRole('button', { name: /^Rising only/ }).click();
    await expect(sheet.getByRole('button', { name: /^Show 1 card$/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();

    await expect(rows).toHaveCount(1);
    await expect(page.getByTestId('wanted-match-count')).toHaveText('Showing 1 of 6');
    await expect(page.getByTestId('wanted-sort-filter')).toContainText('2');
    const risingChip = page.getByRole('button', { name: 'Remove filter Rising only' });
    await harness.expectMinTapTarget(risingChip, 44);
    await risingChip.click();
    await expect(rows).toHaveCount(4);
    await page.getByRole('button', { name: /^Remove filter Holo/ }).click();
    await expect(rows).toHaveCount(6);
    await expect(page.getByTestId('wanted-active-filters')).toHaveCount(0);
    await harness.expectNoHorizontalOverflow();
  });

  test('the row menu offers removal and shows the card in the binder', async ({ harness }) => {
    const { page } = harness;
    const rows = page.getByTestId('wanted-row');
    const more = page.getByRole('button', { name: 'More actions for Squirtle' }).first();
    await harness.expectMinTapTarget(more, 44);

    await page.getByRole('button', { name: 'More actions for Charizard ex' }).click();
    const menu = page.getByRole('dialog', { name: 'Actions for Charizard ex' });
    await expect(menu).toBeVisible();
    await harness.expectWithinSafeViewport(menu.getByRole('button', { name: 'Cancel' }));
    await harness.expectMinTapTarget(menu.getByRole('button', { name: 'Remove from want list' }), 44);
    await menu.getByRole('button', { name: 'Cancel' }).click();
    await expect(menu).toBeHidden();
    await expect(rows).toHaveCount(6);

    await page.getByRole('button', { name: 'More actions for Bulbasaur' }).click();
    await page
      .getByRole('dialog', { name: 'Actions for Bulbasaur' })
      .getByRole('button', { name: 'Show in binder' })
      .click();
    await expect(page.getByTestId('wanted-list')).toHaveCount(0);
    await expect(page.locator('button[data-dex-id="1"]').first()).toBeVisible();
    await harness.expectNoHorizontalOverflow();
  });
});
