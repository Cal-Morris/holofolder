import { test, expect, type Harness } from './fixtures';

// Outside Show mode, Search (and so Quick mode, which runs it) stamps each printing Owned / Wanted like Show mode does. (Owned: Base Set Bulbasaur; wanted: 151 #166 and Phantasmal Flames #001.)

const SCREENS = process.env.E2E_SCREENSHOT_DIR;

async function screenshot(harness: Harness, name: string) {
  if (SCREENS && test.info().project.name.startsWith('standalone-390'))
    await harness.page.screenshot({ path: `${SCREENS}/badges-${name}.png` });
}

async function seedCollection(harness: Harness) {
  const { page } = harness;
  await page.reload();
  await expect(page.locator('button[data-dex-id="1"]').first()).toBeVisible();
}

test.describe('Owned / Wanted badges outside Show mode', () => {
  test.use({ signedIn: true });

  test('Search card hits carry Owned / Wanted badges on their thumbnails', async ({ harness }) => {
    await seedCollection(harness);
    await harness.dock().getByRole('button', { name: 'Search', exact: true }).click();
    const sheet = harness.page.getByRole('dialog', { name: /search pokemon/i });
    await expect(sheet).toBeVisible();
    await sheet.getByRole('textbox', { name: 'Search Pokémon, cards, sets, artists or dex number' }).fill('bulbasaur');
    const hits = sheet.getByRole('region', { name: 'Card results' });
    await expect(hits.locator('button[data-standing="owned"]').filter({ hasText: 'Base Set' })).toContainText('Owned');
    await expect(hits.getByRole('button', { name: /^Bulbasaur 166\/165 151, Wanted$/ })).toContainText('Wanted');
    await expect(hits.locator('button[data-standing="missing"]').first()).not.toContainText(/Owned|Wanted/);
    await hits.scrollIntoViewIfNeeded();
    await screenshot(harness, 'search');
    await harness.expectNoHorizontalOverflow();
  });
});
