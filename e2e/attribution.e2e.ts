import { test, expect } from './fixtures';

test('settings credits every source, the image atlas and the Pokémon rights holders', async ({ harness, page }) => {
  await harness.open();
  await page.locator('nav').first().getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Credits & attributions' }).click();
  const credits = dialog.getByTestId('credits');
  await expect(credits).toBeVisible();
  await expect(credits.getByRole('link', { name: 'TCGdex' }).first()).toHaveAttribute('href', 'https://tcgdex.dev');
  await expect(credits.getByRole('link', { name: 'Pokémon TCG data', exact: true })).toHaveAttribute(
    'href',
    'https://github.com/PokemonTCG/pokemon-tcg-data',
  );
  await expect(credits.getByRole('link', { name: 'TCGCSV' })).toHaveAttribute('href', 'https://tcgcsv.com');
  await expect(credits.getByRole('link', { name: 'malie.io' })).toHaveAttribute('href', 'https://malie.io/static/');
  await expect(credits.getByRole('link', { name: 'PTCG Image Atlas' })).toHaveAttribute(
    'href',
    'https://nstrelow.github.io/ptcg-image-atlas/',
  );
  await expect(credits.getByRole('link', { name: 'source on GitHub' })).toHaveAttribute(
    'href',
    'https://github.com/nstrelow/ptcg-image-atlas',
  );
  await expect(credits).toContainText('The Pokémon Company, Nintendo, Creatures and GAME FREAK');
  await expect(credits).toContainText('Wizards of the Coast');
  await harness.expectNoHorizontalOverflow();
});

test('the credits page stands alone for links from outside the binder', async ({ page }) => {
  await page.goto('/app/credits');
  await expect(page.getByRole('heading', { name: 'Credits & attributions', level: 1 })).toBeVisible();
  await expect(page.getByTestId('credits').getByRole('link', { name: 'PTCG Image Atlas' })).toBeVisible();
  await expect(page.getByTestId('credits')).toContainText('not produced, endorsed, supported or affiliated');
});
