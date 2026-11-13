import { expect, MOCK_CARDS, test } from './fixtures';

test.describe('card languages in the all cards sheet', () => {
  test.use({ signedIn: true });

  test('English only by default: other languages are hidden and language words filter the search', async ({
    harness,
  }) => {
    const { page } = harness;
    // Synthetic printings: two English-set cards (also printed in French) and one Japanese-only card.
    const english = MOCK_CARDS.filter((card) => card.dexIds.includes(1)).slice(0, 2);
    const cards = [
      ...english.map(({ dexIds: _dexIds, ...card }) => ({ ...card, languages: ['en', 'fr'] })),
      { ...english[0], dexIds: undefined, id: 'jp-test-001', name: 'Fushigidane', languages: ['ja'] },
    ];
    await page.route('**/app/api/tcgdex-cache**', (route) => route.fulfill({ json: { cards } }));
    const detail = await harness.openCardDetail();
    await detail
      .getByRole('button', { name: /all bulbasaur cards/i })
      .first()
      .click();
    const sheet = page.getByRole('dialog', { name: 'All Bulbasaur cards', exact: true });
    await expect(sheet).toBeVisible();
    const grid = sheet.getByRole('list', { name: 'Bulbasaur cards' }).getByRole('listitem');

    await expect(grid).toHaveCount(2);
    await expect(sheet.getByText('Fushigidane')).toHaveCount(0);
    await expect(sheet.getByText(/1 printing in other languages hidden/)).toBeVisible();
    // One language shown, so no language filter.
    await expect(sheet.getByRole('group', { name: 'Filter by language' })).toHaveCount(0);
    await sheet.getByRole('searchbox').fill('eng');
    await expect(grid).toHaveCount(2);
    await sheet.getByRole('searchbox').fill('jpn');
    await expect(grid).toHaveCount(0);
    await harness.expectNoHorizontalOverflow();
  });
});
