import { test, expect, openSettingsPage, type Harness } from './fixtures';
import type { Locator } from '@playwright/test';
import type { TCGSetSlotsResponse } from '../lib/tcg-set-slots';

// iOS Safari (and the installed PWA) zooms the page when a focused field's font-size is under 16px.
async function expectNoFocusZoom(field: Locator, name: string) {
  await expect(field, name).toBeVisible();
  await field.focus();
  const size = await field.evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
  expect(size, `${name} font-size`).toBeGreaterThanOrEqual(16);
}

const set = { id: 'fixture-set', name: 'Fixture Set', officialCardCount: 1 };
const card = {
  id: 'fixture-set-1',
  localId: '1',
  name: 'Fixture Bulbasaur',
  language: 'en' as const,
  set,
  inferredFinish: 'normal' as const,
};
const payload: TCGSetSlotsResponse = {
  sets: [set],
  selectedSet: set,
  cards: [card],
  slots: [{ dexId: 1, pokemonName: 'bulbasaur', cards: [card] }],
};

async function openSets(harness: Harness) {
  await harness.page.route('**/app/api/tcg-set-slots**', (route) => {
    const selected = new URL(route.request().url()).searchParams.has('setId');
    return route.fulfill({ json: selected ? payload : { sets: [set], selectedSet: null, slots: [] } });
  });
  await harness.dock().getByRole('button', { name: 'Browse', exact: true }).click();
}

test.describe('search fields do not trigger iOS focus zoom', () => {
  test.use({ signedIn: true });

  test('List search', async ({ harness }) => {
    await harness.dock().getByRole('button', { name: 'List', exact: true }).click();
    await expectNoFocusZoom(harness.page.getByPlaceholder('Search name, card, set, or dex #'), 'List search');
  });

  test('Sets search, Pokémon match and checklist filter', async ({ harness }) => {
    const page = harness.page;
    await openSets(harness);
    const setSearch = page.getByRole('textbox', { name: 'Search sets by name or code' });
    await expectNoFocusZoom(setSearch, 'Set search');
    await setSearch.fill('fixture');
    await page
      .getByRole('button', { name: /Fixture Set/ })
      .first()
      .click();
    await expectNoFocusZoom(page.getByRole('textbox', { name: 'Add Pokémon to match' }), 'Add Pokémon to match');
    await page
      .getByRole('group', { name: 'Set checklist' })
      .getByRole('button', { name: 'Cards', exact: true })
      .click();
    await expectNoFocusZoom(page.getByRole('textbox', { name: 'Filter set checklist' }), 'Checklist filter');
  });

  test("Pokémon catalogue search and a species' card filter", async ({ harness }) => {
    const page = harness.page;
    await openSets(harness);
    await page
      .getByRole('group', { name: 'Browse perspective' })
      .getByRole('button', { name: 'Pokémon', exact: true })
      .click();
    const search = page.getByRole('searchbox', { name: 'Search Pokémon by name or dex number' });
    await expectNoFocusZoom(search, 'Pokémon search');
    await search.fill('#0001');
    await page.getByRole('button', { name: 'Browse Bulbasaur cards', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'All Bulbasaur cards', exact: true });
    await expectNoFocusZoom(
      dialog.getByRole('searchbox', { name: 'Filter by set, number or variant' }),
      'Species card filter',
    );
  });

  test('card picker search', async ({ harness }) => {
    const page = harness.page;
    await page.locator('button[data-dex-id="7"]').first().click();
    await page
      .getByRole('dialog', { name: /squirtle details/i })
      .getByRole('button', { name: /^(Add owned card|Change owned card)$/, exact: true })
      .click();
    await expectNoFocusZoom(
      page.getByRole('dialog', { name: /card selector/i }).getByRole('searchbox', { name: 'Search cards' }),
      'Card picker search',
    );
  });

  test('illustrator card filter', async ({ harness }) => {
    const page = harness.page;
    await harness.dock().getByRole('button', { name: 'Search', exact: true }).click();
    const search = page.getByRole('dialog', { name: /search pokemon/i });
    await search.getByRole('textbox').fill('arita');
    await search
      .getByRole('region', { name: /illustrator results/i })
      .getByRole('button', { name: /^illustrator mitsuhiro arita/i })
      .click();
    const dialog = page.getByRole('dialog', { name: /cards illustrated by mitsuhiro arita/i });
    await expectNoFocusZoom(
      dialog.getByRole('searchbox', { name: 'Filter by card, set or number' }),
      'Illustrator card filter',
    );
  });

  test('illustrator sort', async ({ harness }) => {
    const page = harness.page;
    await harness.dock().getByRole('button', { name: 'Search', exact: true }).click();
    const search = page.getByRole('dialog', { name: /search pokemon/i });
    await search.getByRole('textbox').fill('arita');
    await search
      .getByRole('region', { name: /illustrator results/i })
      .getByRole('button', { name: /^illustrator mitsuhiro arita/i })
      .click();
    const dialog = page.getByRole('dialog', { name: /cards illustrated by mitsuhiro arita/i });
    await expectNoFocusZoom(dialog.getByRole('combobox', { name: 'Sort cards' }), 'Illustrator sort');
  });

  test('generation picker in the controls sheet', async ({ harness }) => {
    await harness.dock().getByRole('button', { name: 'Binder', exact: true }).click();
    await harness.page.getByTestId('app-header').getByRole('button', { name: 'View' }).click();
    await expectNoFocusZoom(harness.page.getByLabel('Generation', { exact: true }), 'Generation picker');
  });

  test('settings page-range end', async ({ harness }) => {
    const page = harness.page;
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Settings' }).click();
    const settings = page.getByRole('dialog', { name: /settings/i });
    await openSettingsPage(settings, 'Appearance');
    await expectNoFocusZoom(settings.getByRole('spinbutton'), 'Page-range end');
  });

  test('binder switcher new-name and rename fields', async ({ harness }) => {
    const page = harness.page;
    const owner = '00000000-0000-4000-8000-0000000000e2';
    const binder = (id: string, name: string, sortOrder: number) => ({
      id,
      name,
      sortOrder,
      isDefault: sortOrder === 0,
      slotCount: 0,
      ownerUserId: owner,
      color: null,
      rows: null,
      cols: null,
      createdAt: null,
      updatedAt: null,
    });
    const binders = [
      binder('e2e00000-0000-4000-8000-000000000001', 'My binder', 0),
      binder('e2e00000-0000-4000-8000-000000000002', 'Trades', 1),
    ];
    await page.route('**/app/api/binders**', (route) => route.fulfill({ json: { binders } }));
    await page.goto('/app/e2e-harness?signedIn=1&binders=1');
    await expect(harness.dock()).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('binder-switcher-trigger').click();
    const sheet = page.getByRole('dialog', { name: 'Binders' });
    await expectNoFocusZoom(sheet.getByRole('textbox', { name: 'New binder name' }), 'New binder name');
    await sheet.getByRole('button', { name: 'Edit' }).click();
    await sheet.getByRole('button', { name: 'Rename Trades' }).click();
    await expectNoFocusZoom(sheet.getByRole('textbox', { name: 'New name for Trades' }), 'Rename binder');
  });
});

test.describe('tablet header page field does not trigger iOS focus zoom', () => {
  test.use({ signedIn: true });

  test('desktop-layout header page number on a touch screen', async ({ harness }) => {
    // The harness opens on the phone layout; widen to an iPad-sized touch screen to get the desktop header.
    await harness.page.setViewportSize({ width: 820, height: 1180 });
    const field = harness.page.getByRole('spinbutton', { name: 'Binder page number' }).filter({ visible: true });
    await expectNoFocusZoom(field, 'Header page number');
  });
});
