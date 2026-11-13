import { test, expect, MOCK_CARDS } from './fixtures';

// Synthetic response: mock catalogue cards with made-up similarities, shaped like /app/api/tcg-similar-cards.
const SCREENS = process.env.E2E_SCREENSHOT_DIR;
const similar = (id: string, similarity: number) => ({ ...MOCK_CARDS.find((card) => card.id === id)!, similarity });
const RESPONSE = {
  cardId: 'base1-44',
  language: 'en',
  sameArtwork: [similar('sv03.5-001', 0.91), similar('me02-001', 0.84)],
  similarLook: [
    similar('base1-46', 0.81),
    similar('sv03.5-004', 0.8),
    similar('sv03.5-005', 0.79),
    similar('sv03.5-006', 0.78),
    similar('sv03.5-168', 0.77),
    similar('swsh12pt5-001', 0.76),
  ],
};

test.describe('similar cards on the card detail', () => {
  test('shows Same artwork and Similar look rows that fit the phone and open a card', async ({ harness }) => {
    await harness.page.route('**/app/api/tcg-similar-cards**', (route) => route.fulfill({ json: RESPONSE }));
    const dialog = await harness.openCardDetail();
    const row = dialog.getByTestId('similar-cards');
    await row.scrollIntoViewIfNeeded();
    await expect(row.getByRole('region', { name: 'Same artwork' })).toBeVisible();
    await expect(row.getByRole('region', { name: 'Similar look' })).toBeVisible();
    const first = row.getByRole('button', { name: /^open bulbasaur, 151 001$/i });
    await harness.expectHittable(first);
    await harness.expectMinTapTarget(first);
    await harness.expectNoHorizontalOverflow();
    // The row scrolls sideways inside the sheet instead of widening it.
    const sheet = (await dialog.boundingBox())!;
    const list = (await row.getByRole('list').last().boundingBox())!;
    expect(list.x + list.width).toBeLessThanOrEqual(sheet.x + sheet.width + 0.5);
    if (SCREENS) await harness.page.screenshot({ path: `${SCREENS}/similar-${test.info().project.name}.png` });

    await row.getByRole('button', { name: /^open charmander, base set 46$/i }).click();
    await expect(harness.page.getByRole('dialog', { name: /bulbasaur details/i })).toBeHidden();
    await expect(harness.dialogs().first()).toBeVisible();
  });

  test('stays hidden when the lookup fails (offline or not filled yet)', async ({ harness }) => {
    await harness.page.route('**/app/api/tcg-similar-cards**', (route) => route.abort('internetdisconnected'));
    const dialog = await harness.openCardDetail();
    await expect(dialog.getByRole('button', { name: /^illustrator /i })).toBeVisible();
    await expect(dialog.getByTestId('similar-cards')).toHaveCount(0);
  });
});
