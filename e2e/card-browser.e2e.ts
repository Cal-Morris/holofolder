import { test, expect, type Harness } from './fixtures';

const browserDialog = (harness: Harness, name: RegExp) => harness.page.getByRole('dialog', { name });
const printings = (harness: Harness) => harness.page.getByRole('list', { name: /cards/i }).getByRole('listitem');

async function expectUsableBrowser(harness: Harness, name: RegExp) {
  const dialog = browserDialog(harness, name);
  await expect(dialog).toBeVisible();
  await expect(harness.dialogs()).toHaveCount(1);
  const close = harness.closeControl(dialog);
  await harness.expectWithinSafeViewport(close);
  await harness.expectHittable(close);
  await harness.expectMinTapTarget(close);
  const box = (await dialog.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(harness.insets.top - 0.5);
  await harness.expectNoHorizontalOverflow();
  return dialog;
}

test.describe('all cards for a Pokémon', () => {
  test(
    'opens read-only from the card detail, lists every printing newest first and returns to the detail',
    { tag: '@smoke' },
    async ({ harness }) => {
      const detail = await harness.openCardDetail();
      await detail.getByRole('button', { name: /all bulbasaur cards/i }).click();
      const dialog = await expectUsableBrowser(harness, /all bulbasaur cards/i);

      await expect(printings(harness)).toHaveCount(6);
      await expect(printings(harness).first()).toHaveAccessibleName(/pitch black/i);
      await expect(dialog.getByRole('listitem', { name: /44\/102 base set, owned/i })).toBeVisible();
      await expect(dialog.getByText(/6 cards · 1 owned · 0 wanted/i)).toBeVisible();
      // Read-only: browsing never opens the card selector / edit flow.
      await expect(harness.page.getByRole('dialog', { name: /card selector/i })).toHaveCount(0);

      await harness.closeControl(dialog).click();
      await expect(dialog).toBeHidden();
      await expect(harness.page.getByRole('dialog', { name: /bulbasaur details/i })).toBeVisible();
      await expect(harness.dialogs()).toHaveCount(1);
    },
  );

  test('browser back from the all-cards view returns to the card detail', async ({ harness }) => {
    const detail = await harness.openCardDetail();
    await detail.getByRole('button', { name: /all bulbasaur cards/i }).click();
    await expect(browserDialog(harness, /all bulbasaur cards/i)).toBeVisible();
    await harness.page.goBack();
    await expect(browserDialog(harness, /all bulbasaur cards/i)).toBeHidden();
    await expect(harness.page.getByRole('dialog', { name: /bulbasaur details/i })).toBeVisible();
    await harness.page.goBack();
    await expect(harness.dialogs()).toHaveCount(0);
    await expect(harness.page).toHaveURL(/\/app\/e2e-harness/);
  });

  test('filters owned printings and searches', async ({ harness }) => {
    const detail = await harness.openCardDetail();
    await detail.getByRole('button', { name: /all bulbasaur cards/i }).click();
    const dialog = browserDialog(harness, /all bulbasaur cards/i);

    await dialog.getByRole('button', { name: /^owned/i }).click();
    await expect(printings(harness)).toHaveCount(1);
    await dialog.getByRole('button', { name: /^all/i }).click();

    await dialog.getByRole('searchbox').fill('base');
    await dialog.getByRole('button', { name: /^all/i }).click();
    await expect(printings(harness)).toHaveCount(1);
  });

  test('opens from a list row and closes with Escape', async ({ harness }) => {
    await harness.dock().getByRole('button', { name: 'List', exact: true }).click();
    await harness.page.getByRole('button', { name: /^all charmander cards$/i }).click();
    await expectUsableBrowser(harness, /all charmander cards/i);
    await expect(printings(harness)).toHaveCount(3);
    await harness.page.keyboard.press('Escape');
    await expect(harness.dialogs()).toHaveCount(0);
    await harness.expectScrollUnlocked();
  });

  test("opens from a binder slot's quick actions and closes with a swipe", async ({ harness }) => {
    await harness.page.locator('button[data-dex-id="4"]').first().click({ button: 'right' });
    await harness.page.getByRole('button', { name: /^all charmander cards$/i }).click();
    const dialog = await expectUsableBrowser(harness, /all charmander cards/i);
    await harness.swipeDown(dialog);
    await expect(harness.dialogs()).toHaveCount(0);
  });

  test('switching tabs closes the all-cards view and the card detail under it', async ({ harness }) => {
    const detail = await harness.openCardDetail();
    await detail.getByRole('button', { name: /all bulbasaur cards/i }).click();
    await expect(browserDialog(harness, /all bulbasaur cards/i)).toBeVisible();
    await harness.dock().getByRole('button', { name: 'Browse', exact: true }).click();
    await expect(harness.dialogs()).toHaveCount(0);
    await harness.expectScrollUnlocked();
  });
});

test.describe('global search', () => {
  async function openSearch(harness: Harness) {
    await harness.dock().getByRole('button', { name: 'Search', exact: true }).click();
    const dialog = harness.page.getByRole('dialog', { name: /search pokemon/i });
    await expect(dialog).toBeVisible();
    return dialog;
  }

  test('finds Pokémon by dex number and with typos', async ({ harness }) => {
    const dialog = await openSearch(harness);
    const input = dialog.getByRole('textbox');
    await input.fill('#6');
    await expect(dialog.getByRole('button', { name: /charizard/i }).first()).toBeVisible();
    await input.fill('bulbasuar');
    await expect(dialog.getByRole('button', { name: /^bulbasaur/i }).first()).toBeVisible();
  });

  test('shows card hits first, narrows them with a Pokémon chip and opens the all-cards view at the picked printing', async ({
    harness,
  }) => {
    const dialog = await openSearch(harness);
    const input = dialog.getByRole('textbox');
    await input.fill('charm');
    const cards = dialog.getByRole('region', { name: /card results/i });
    const chips = dialog.getByRole('group', { name: 'Narrow card results' });
    await expect(cards.getByRole('button', { name: /^charmeleon /i }).first()).toBeVisible();
    await expect(chips.getByRole('button', { name: 'Pokémon Charmeleon', exact: true })).toBeVisible();
    // Cards come before the Pokémon rows.
    const cardsTop = (await cards.boundingBox())!.y;
    const rowTop = (await dialog.locator('[data-result-index]').first().boundingBox())!.y;
    expect(cardsTop).toBeLessThan(rowTop);

    // A chip reruns the search for that Pokémon and keeps only its cards; tapping it again shows them all.
    const charmander = chips.getByRole('button', { name: 'Pokémon Charmander', exact: true });
    await harness.expectMinTapTarget(charmander, 36);
    await charmander.click();
    await expect(input).toHaveValue('Charmander');
    await expect(charmander).toHaveAttribute('aria-pressed', 'true');
    await expect(cards.getByRole('button', { name: /^charmeleon /i })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'All Charmander cards', exact: true }).first()).toBeVisible();
    await harness.expectNoHorizontalOverflow();

    await cards.getByRole('button', { name: /charmander 168\/165 151/i }).click();
    const browser = await expectUsableBrowser(harness, /all charmander cards/i);
    await expect(dialog).toBeHidden();
    await expect(browser.locator('[data-card-id="sv03.5-168"]')).toBeInViewport();
  });

  test("narrows and sorts card hits with the card picker's Filters · Sort sheet", async ({ harness }) => {
    const dialog = await openSearch(harness);
    await dialog.getByRole('textbox').fill('charm');
    const cards = dialog.getByRole('region', { name: /card results/i });
    const tiles = cards.getByRole('button', { name: /^charm/i });
    await expect(tiles.first()).toBeVisible();
    const button = cards.getByRole('button', { name: 'Filters · Sort' });
    await harness.expectMinTapTarget(button, 36);
    await button.click();
    const sheet = harness.page.getByRole('dialog', { name: 'Filters and sort' });
    await expect(sheet.getByRole('group', { name: 'Card language' })).toHaveCount(0);
    await sheet.getByRole('combobox', { name: 'Set' }).selectOption({ label: '151' });
    await sheet.getByRole('button', { name: /^Show \d+ cards?$/ }).click();
    await expect(dialog.getByRole('list', { name: 'Active filters' })).toContainText('151');
    const count = await tiles.count();
    expect(count).toBeGreaterThan(0);
    await expect(cards.getByRole('button', { name: /^charm.* 151$/i })).toHaveCount(count);
    await harness.expectNoHorizontalOverflow();
    await dialog.getByRole('button', { name: 'Remove filter 151' }).click();
    await expect(dialog.getByRole('list', { name: 'Active filters' })).toHaveCount(0);
  });

  test('searches by set and card number', async ({ harness }) => {
    const dialog = await openSearch(harness);
    await dialog.getByRole('textbox').fill('base 46');
    const cards = dialog.getByRole('region', { name: /card results/i });
    await expect(cards.getByRole('button')).toHaveCount(1);
    await cards.getByRole('button', { name: /^charmander 46/i }).click();
    await expectUsableBrowser(harness, /all charmander cards/i);
  });

  test('the all-cards button on a Pokémon result opens the browser', async ({ harness }) => {
    const dialog = await openSearch(harness);
    await dialog.getByRole('textbox').fill('bulba');
    await dialog.getByRole('button', { name: /all bulbasaur cards/i }).click();
    await expectUsableBrowser(harness, /all bulbasaur cards/i);
    await expect(dialog).toBeHidden();
  });
});

test.describe('card hit prices in search (UK)', () => {
  test.use({ locale: 'en-GB' });

  test("each card hit shows its price in the user's currency without overflowing", async ({ harness }) => {
    // Default harness fixture (TEST FIXTURE ONLY): the UK price is the Cardmarket quote, £0.05.
    const prices: string[] = [];
    harness.page.on('request', (request) => {
      if (request.url().includes('/app/api/card-prices')) prices.push(request.url());
    });
    await harness.dock().getByRole('button', { name: 'Search', exact: true }).click();
    const dialog = harness.page.getByRole('dialog', { name: /search pokemon/i });
    await dialog.getByRole('textbox').fill('charm');
    const cards = dialog.getByRole('region', { name: /card results/i });
    const hit = cards.getByRole('button', { name: /charmander 168\/165 151/i });
    // The card picker's price lines: market (M) and the "good" price (L).
    await expect(hit.locator('[data-price-line]')).toContainText('M £0.05');
    await expect(cards.locator('[data-price-line]')).toHaveCount(4);
    await harness.expectNoHorizontalOverflow();
    // Prices for every hit come from batched requests, never one request per card.
    expect(prices.length).toBeLessThanOrEqual(2);
  });
});
