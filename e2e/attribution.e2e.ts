import { test, expect } from './fixtures';

test('settings credits all catalog sources and the Pokémon rights holders', async ({ harness, page }) => {
  await harness.open();
  await page.locator('nav').first().getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  const attribution = page.getByRole('dialog').getByTestId('card-data-attribution');
  await expect(attribution).toBeVisible();
  await expect(attribution).toContainText('TCGdex');
  await expect(attribution).toContainText('The Pokémon Company');
  await expect(attribution.getByRole('link', { name: 'TCGdex' })).toHaveAttribute('href', 'https://tcgdex.dev');
  await expect(attribution.getByRole('link', { name: 'Pokémon TCG', exact: true })).toHaveAttribute(
    'href',
    'https://github.com/PokemonTCG/pokemon-tcg-data',
  );
  await expect(attribution.getByRole('link', { name: 'TCGCSV' })).toHaveAttribute('href', 'https://tcgcsv.com');
  await expect(attribution.getByRole('link', { name: 'malie.io' })).toHaveAttribute('href', 'https://malie.io/static/');
  await harness.expectNoHorizontalOverflow();
});
