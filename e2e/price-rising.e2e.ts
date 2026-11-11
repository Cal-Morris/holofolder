import { test, expect } from './fixtures';
import { mockCardPrices } from './price-fixtures';

test.describe('rising price indicator', () => {
  test('shows on confidently rising printings only, never on low-confidence data', async ({ harness }) => {
    await mockCardPrices(harness.page, {
      // Fixture: high confidence, +25% vs 30d average -> badge.
      'sv03.5-166': { confidence: 'high', market: 25, trend: { '30d': 20, '7d': 22, Trend: 25 } },
      // Fixture: same shape of rise but low confidence -> no badge.
      'base1-44': { confidence: 'low', market: 25, trend: { '30d': 10, '7d': 12, Trend: 25 } },
      // Fixture: high confidence but flat -> no badge.
      'sv03.5-001': { confidence: 'high', market: 5, trend: { '30d': 5, '7d': 5, Trend: 5.1 } },
    });

    const detail = await harness.openCardDetail();
    await detail.getByRole('button', { name: /all bulbasaur cards/i }).click();
    const dialog = harness.page.getByRole('dialog', { name: /all bulbasaur cards/i });
    await expect(dialog).toBeVisible();

    const rising = dialog.getByRole('listitem', { name: /166\/165 151/i }).getByTestId('price-rising-badge');
    await expect(rising).toBeVisible();
    await expect(rising).toHaveAccessibleName(/rising \+25% over 30d/i);
    await expect(dialog.getByTestId('price-rising-badge')).toHaveCount(1);
    await expect(
      dialog.getByRole('listitem', { name: /44\/102 base set/i }).getByTestId('price-rising-badge'),
    ).toHaveCount(0);
  });
});
