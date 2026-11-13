import type { Locator } from '@playwright/test';
import { test, expect, seedCollection, type Harness, type SeedRow } from './fixtures';
import { HUNT_COLLECTION, HUNT_PRICES } from './hunt-fixtures';
import { mockCardPrices } from './price-fixtures';

const SCREENS = process.env.E2E_SCREENSHOT_DIR;

async function screenshot(harness: Harness, name: string) {
  if (SCREENS && test.info().project.name.startsWith('standalone-390'))
    await harness.page.screenshot({ path: `${SCREENS}/quick-${name}.png` });
}

/** The want list plus a Squirtle printing that has never had a price. */
const WITH_UNPRICED_WANT = HUNT_COLLECTION.map((item) =>
  item.pokemon_id === 7
    ? {
        ...item,
        wanted_cards: [
          {
            card_id: '30th-c-003',
            card_name: 'Squirtle',
            card_set: '30th Classic Collection',
            card_language: 'en',
            card_finish: 'normal',
            rarity: 'None',
            local_id: '003',
            added_at: '2026-10-01T00:00:00.000Z',
          },
        ],
      }
    : item,
);

const banner = (harness: Harness) => harness.page.getByRole('region', { name: 'Show mode' });
const quickDialog = (harness: Harness) => harness.page.getByRole('dialog', { name: 'Quick mode' });
const cardRows = (dialog: Locator) => dialog.getByRole('region', { name: 'Cards' }).locator('button[data-standing]');
const standings = (dialog: Locator) =>
  cardRows(dialog).evaluateAll((rows) => rows.map((row) => row.getAttribute('data-standing')));

/** Owned Bulbasaur and Charmander, a want list across four Pokémon, and prices for cards nobody wants. */
async function seed(harness: Harness, collection: SeedRow[] = HUNT_COLLECTION) {
  const { page } = harness;
  await seedCollection(page, collection);
  await mockCardPrices(page, {
    ...HUNT_PRICES,
    'sv03.5-005': { finish: 'normal', market: 1.2, confidence: 'high' },
    'sv03.5-007': { finish: 'normal', market: 0.8, confidence: 'high' },
  });
  await page.reload();
  await expect(harness.slot(1)).toBeVisible();
}

async function openShowMode(harness: Harness) {
  if (!(await banner(harness).isVisible()))
    await harness.page.getByRole('button', { name: 'Show mode', exact: true }).click();
  await harness.page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(quickDialog(harness)).toBeVisible();
  return quickDialog(harness);
}

test.describe('Show mode: look up any card', () => {
  test.use({ signedIn: true });

  test('finds any card, wanted first, labelled Wanted / Owned / Not in binder', async ({ harness }) => {
    await seed(harness);
    const dialog = await openShowMode(harness);
    // The Hunting list is still what opens.
    await expect(dialog.getByTestId('show-hunt')).toBeVisible();

    await dialog.getByRole('searchbox').fill('bulbasaur');
    await expect.poll(() => standings(dialog)).toHaveLength(6);
    const order = await standings(dialog);
    expect(order.slice(0, 2)).toEqual(['wanted', 'wanted']);
    expect(order.slice(2).sort()).toEqual(['missing', 'missing', 'missing', 'owned']);
    await expect(cardRows(dialog).first()).toHaveAccessibleName(
      /^Bulbasaur, (151 166\/165|Phantasmal Flames 001\/094), Wanted/,
    );
    await expect(dialog.getByRole('button', { name: /^Bulbasaur, Base Set 44\/102, Owned/ })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /^Bulbasaur, Crown Zenith .*, Not in binder/ })).toBeVisible();
    await harness.expectMinTapTarget(cardRows(dialog).first(), 48);
    await harness.expectNoHorizontalOverflow();

    // A card nobody wants: Charmeleon isn't on the want list or in the binder.
    await dialog.getByRole('searchbox').fill('charmeleon');
    const charmeleon = dialog.getByRole('button', { name: /^Charmeleon, 151 005\/165, Not in binder/ });
    await expect(charmeleon).toBeVisible();
    await screenshot(harness, 'any-card-results');
    await charmeleon.click();
    const check = dialog.getByTestId('quick-card-check');
    await expect(check).toBeVisible();
    await expect(check.getByTestId('quick-card-status')).toHaveText('No exact saved match');
    await expect(check.getByTestId('quick-card-market-price')).toHaveText('£1.20');
    await expect(check).toContainText('Pay up to £1.32');
    const input = check.getByRole('textbox', { name: /price/i });
    await input.fill('5');
    await input.press('Enter');
    await expect(check.getByTestId('deal-verdict')).toHaveAttribute('data-verdict', /.+/);
    await harness.expectNoHorizontalOverflow();
    await screenshot(harness, 'any-card-check');
  });

  test('searches by illustrator too', async ({ harness }) => {
    await seed(harness);
    const dialog = await openShowMode(harness);
    await dialog.getByRole('searchbox').fill('arita');
    await expect(dialog.getByRole('button', { name: /^Bulbasaur, 151 166\/165, Wanted/ })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /^Bulbasaur, Base Set 44\/102, Owned/ })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /^Charmander, Base Set 46\/102, Owned/ })).toBeVisible();
    // Wanted still ranks first.
    await expect(cardRows(dialog).first()).toHaveAttribute('data-standing', 'wanted');
    await expect(cardRows(dialog).first()).toContainText('Mitsuhiro Arita');
  });

  test("offline it searches the cards on this device and says when a price isn't saved", async ({ harness }) => {
    const { page } = harness;
    await seed(harness, WITH_UNPRICED_WANT);
    // The deal check is lazy-loaded (precached by the service worker in the app, blocked here): load it online.
    let dialog = await openShowMode(harness);
    await dialog.getByRole('searchbox').fill('charmeleon');
    await dialog.getByRole('button', { name: /^Charmeleon, 151 005/ }).click();
    await expect(dialog.getByTestId('quick-card-check')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    await page.context().setOffline(true);
    dialog = await openShowMode(harness);
    await dialog.getByRole('searchbox').fill('charmander');
    const cards = dialog.getByRole('region', { name: 'Cards' });
    await expect(cards).toContainText('on this device');
    await expect(cardRows(dialog).first()).toHaveAccessibleName(/^Charmander, 151 #004, Wanted ×1, £/);
    await expect(dialog.getByRole('button', { name: /^Charmander, Base Set .*46.*, Owned/ })).toBeVisible();

    // A printing whose price was never saved here says so, in the list and in the deal check.
    await dialog.getByRole('searchbox').fill('squirtle');
    const unpriced = dialog.getByRole('button', { name: /^Squirtle, 30th Classic Collection .*, Wanted ×1$/ });
    await expect(unpriced).toContainText('No price offline');
    await harness.expectNoHorizontalOverflow();
    await screenshot(harness, 'any-card-offline');
    await unpriced.click();
    const check = dialog.getByTestId('quick-card-check');
    await expect(check.getByTestId('quick-card-market-price')).toHaveText('Not available offline');
    await expect(check).toContainText("prices can't be fetched offline");
    await page.context().setOffline(false);
  });
});

test.describe("want list: check any card's price", () => {
  test.use({ signedIn: true });

  test('a search with no wanted match offers the same lookup', async ({ harness }) => {
    const { page } = harness;
    await seed(harness);
    await harness.dock().getByRole('button', { name: 'Wanted', exact: true }).click();
    const main = page.getByTestId('main-content');
    const search = main.getByRole('searchbox', { name: 'Search want list' });

    await search.fill('bulba');
    await expect(main.getByRole('button', { name: 'Not here? Check price of any card' })).toBeVisible();

    await search.fill('charmeleon');
    await expect(main).toContainText('Nothing on your want list matches “charmeleon”');
    const lookup = main.getByRole('button', { name: 'Check price of any card', exact: true });
    await harness.expectMinTapTarget(lookup, 44);
    await screenshot(harness, 'wanted-check-any');
    await lookup.click();

    const dialog = quickDialog(harness);
    await expect(dialog.getByRole('heading', { name: 'Price check' })).toBeVisible();
    await expect(dialog.getByRole('searchbox')).toHaveValue('charmeleon');
    await dialog.getByRole('button', { name: /^Charmeleon, 151 005\/165, Not in binder/ }).click();
    const check = dialog.getByTestId('quick-card-check');
    await expect(check.getByTestId('quick-card-market-price')).toHaveText('£1.20');
    await expect(check).toContainText('Pay up to £1.32');
    await harness.expectNoHorizontalOverflow();
    await screenshot(harness, 'wanted-price-check');
    // Show mode stays off: this is just a lookup.
    await page.keyboard.press('Escape');
    await expect(banner(harness)).toBeHidden();
  });
});
