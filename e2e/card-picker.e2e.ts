import { test, expect, type Harness } from './fixtures';
import { mockCardPrices } from './price-fixtures';

async function openPicker(harness: Harness) {
  const { page } = harness;
  await page.locator('button[data-dex-id="7"]').first().click();
  const detail = page.getByRole('dialog', { name: /squirtle details/i });
  await detail.getByRole('button', { name: /^(Add owned card|Change owned card)$/, exact: true }).click();
  const selector = page.getByRole('dialog', { name: /card selector/i });
  await expect(selector).toBeVisible();
  return selector;
}

test.describe('card picker layout', () => {
  test.use({ signedIn: true });

  test(
    'opens on search with cards above the fold and one compact filters control',
    { tag: '@matrix' },
    async ({ harness }) => {
      const selector = await openPicker(harness);
      const search = selector.getByRole('searchbox', { name: 'Search cards' });
      await expect(search).toBeVisible();
      await expect(selector.getByRole('button', { name: 'Scan card', exact: true })).toBeVisible();

      // The first card is on screen without scrolling.
      const firstCard = selector.getByRole('button', { name: /^Add card Squirtle from / }).first();
      await expect(firstCard).toBeInViewport({ ratio: 1 });

      // Language, variant, set, rarity and sort live behind one button, not stacked rows.
      await expect(selector.getByRole('button', { name: 'Japanese' })).toHaveCount(0);
      await expect(selector.getByRole('combobox')).toHaveCount(0);
      const filtersButton = selector.getByRole('button', { name: /filters · sort/i });
      await harness.expectMinTapTarget(filtersButton, 36);
      await harness.expectNoHorizontalOverflow();

      // Search narrows the cards.
      await search.fill('celebration');
      await expect(selector.getByText(/^[12] of 3 cards$/)).toBeVisible();
      await search.fill('');
      await expect(selector.getByText('3 of 3 cards')).toBeVisible();
    },
  );

  test('filters apply from the sheet and show as removable chips', async ({ harness }) => {
    const { page } = harness;
    const selector = await openPicker(harness);
    await selector.getByRole('button', { name: /filters · sort/i }).click();
    const sheet = page.getByRole('dialog', { name: 'Filters and sort' });
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: 'Japanese', exact: true }).click();
    await sheet.getByRole('button', { name: 'Reverse', exact: true }).click();
    await sheet.getByRole('combobox', { name: 'Set' }).selectOption({ label: '151' });
    await sheet.getByRole('button', { name: 'Show 1 card', exact: true }).click();
    await expect(sheet).toHaveCount(0);

    const chips = selector.getByRole('list', { name: 'Active filters' });
    await expect(chips.getByRole('listitem')).toHaveCount(3);
    await expect(selector.getByText('1 of 3 cards')).toBeVisible();
    await harness.expectNoHorizontalOverflow();

    await chips.getByRole('button', { name: 'Remove filter 151' }).click();
    await expect(chips.getByRole('listitem')).toHaveCount(2);
    await selector.getByRole('button', { name: 'Clear all', exact: true }).click();
    await expect(chips).toHaveCount(0);
    await expect(selector.getByText('3 of 3 cards')).toBeVisible();

    // Escape closes only the sheet, then the picker.
    await selector.getByRole('button', { name: /filters · sort/i }).click();
    await expect(sheet).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    await expect(selector).toBeVisible();
  });

  test('marking owned without a card is in the overflow menu', async ({ harness }) => {
    const { page } = harness;
    const selector = await openPicker(harness);
    await expect(selector.getByRole('button', { name: 'Mark owned without card' })).toHaveCount(0);
    await selector.getByRole('button', { name: 'More options' }).click();
    await selector.getByRole('menuitem', { name: 'Mark owned without card' }).click();
    await expect(selector).toHaveCount(0);
    await expect(page.locator('button[data-dex-id="7"]').first()).toBeVisible();
  });

  test('a search with no matches says so and clears in one tap', async ({ harness }) => {
    const selector = await openPicker(harness);
    await selector.getByRole('searchbox', { name: 'Search cards' }).fill('zzzz no such card');
    await expect(selector.getByText('No cards match', { exact: true })).toBeVisible();
    await selector.getByRole('button', { name: 'Clear search and filters' }).click();
    await expect(selector.getByText('3 of 3 cards')).toBeVisible();
    await expect(selector.getByRole('searchbox', { name: 'Search cards' })).toHaveValue('');
  });

  test('provider-confirmed reverse is offered when catalogue flags omit it', async ({ harness }) => {
    const { page } = harness;
    // Synthetic holo-only catalogue flags with explicit holo and reverse price evidence.
    await mockCardPrices(page, {
      '30th-007': {
        confidence: 'high',
        market: 1,
        finishes: [
          { finish: 'holo', market: 1 },
          { finish: 'reverse_holo', market: 2 },
        ],
      },
    });
    const selector = await openPicker(harness);
    const card = selector.getByRole('button', { name: 'Add card Squirtle from 30th Celebration', exact: true });
    await expect(card).toContainText('£1.00');
    await card.click();
    const variants = page.getByRole('dialog', { name: 'Which variant?' });
    const reverse = variants.getByRole('button', { name: 'Add Reverse, £2.00', exact: true });
    await expect(variants.getByRole('button', { name: 'Add Holo, £1.00', exact: true })).toBeVisible();
    await expect(reverse).toBeVisible();
    await expect(reverse).toHaveAttribute('data-suggested', 'true');
    await expect(variants.getByRole('button', { name: 'Add Holo, £1.00', exact: true })).not.toHaveAttribute(
      'data-suggested',
      'true',
    );
    await harness.expectMinTapTarget(reverse, 36);
    await harness.expectWithinSafeViewport(reverse);
    await harness.expectNoHorizontalOverflow();
  });

  test('keeps unpriced Normal and suggests the most expensive quoted variant', async ({ harness }) => {
    const { page } = harness;
    // Synthetic catalog Normal/Reverse with a provider-confirmed Holo; Normal has no quote.
    await mockCardPrices(page, {
      'sv03.5-007': {
        confidence: 'high',
        market: 12,
        finishes: [
          { finish: 'holo', market: 12 },
          { finish: 'reverse_holo', market: 54.72 },
        ],
      },
    });
    const selector = await openPicker(harness);
    const card = selector.getByRole('button', { name: 'Add card Squirtle from 151', exact: true });
    await expect(card).toContainText('£12.00');
    await card.click();
    const variants = page.getByRole('dialog', { name: 'Which variant?' });
    const normal = variants.getByRole('button', { name: 'Add Normal', exact: true });
    const reverse = variants.getByRole('button', { name: 'Add Reverse, £54.72', exact: true });
    await expect(normal).toBeVisible();
    await expect(normal).toContainText('No price yet');
    await expect(reverse).toHaveAttribute('data-suggested', 'true');
    await harness.expectMinTapTarget(normal, 36);
    await harness.expectWithinSafeViewport(reverse);
    await harness.expectNoHorizontalOverflow();
  });

  test('unpriced variants stay selectable without a likely badge', async ({ harness }) => {
    const { page } = harness;
    const selector = await openPicker(harness);
    await selector.getByRole('button', { name: 'Add card Squirtle from 151', exact: true }).click();
    const variants = page.getByRole('dialog', { name: 'Which variant?' });
    await expect(variants.getByRole('button', { name: 'Add Normal', exact: true })).toBeVisible();
    await expect(variants.getByRole('button', { name: 'Add Reverse', exact: true })).toBeVisible();
    await expect(variants.locator('[data-suggested="true"]')).toHaveCount(0);
  });

  test('a single-finish card is picked in one tap', async ({ harness }) => {
    const { page } = harness;
    const selector = await openPicker(harness);
    await selector.getByRole('button', { name: 'Add card Squirtle from 30th Celebration', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Which variant?' })).toHaveCount(0);
    await expect(selector).toHaveCount(0);
  });
});
