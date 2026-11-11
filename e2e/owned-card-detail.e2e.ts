import { test, expect, Harness, mockBackends, emulateStandalone } from './fixtures';
import { mockCardPrices } from './price-fixtures';
import { syntheticSlotPickerSnapshot } from '../tests/fixtures/slot-picker';

// Synthetic slots, copies and prices only (tests/fixtures/slot-picker.ts, e2e/price-fixtures.ts).
test.describe('owned native card detail', () => {
  test.use({
    signedIn: true,
    harness: async ({ page, context, standalone, insets, baseURL }, provide) => {
      if (standalone) await emulateStandalone(page, insets);
      await mockBackends(page, context, { signedIn: true, baseURL });
      await provide(new Harness(page, insets, true));
    },
  });
  const details = (page: import('@playwright/test').Page) => page.getByRole('dialog', { name: /details$/ });
  const open = async (page: import('@playwright/test').Page) => {
    await page.route('**/app/api/tcgdex-cache**', (route) =>
      route.fulfill({
        json: {
          cards: syntheticSlotPickerSnapshot()
            .cards.filter((c) => c.dexIds?.includes(143))
            .map(({ dexIds: _d, ...c }) => c),
          source: 'mirror',
        },
      }),
    );
    await page.goto('/app/e2e-harness?signedIn=1&slots=picker&rows=2&cols=4');
    if (page.viewportSize()!.width >= 1024)
      await expect(page.getByRole('region', { name: 'Inside cover', exact: true })).toBeVisible();
  };

  test('an owned card opens card-first with its exact finish price and an All cards route', async ({ harness }) => {
    const { page } = harness;
    // The copy is normal; only that finish's quote may show, never the holo one.
    await mockCardPrices(page, {
      'synthetic-snorlax-a': {
        confidence: 'high',
        market: 4,
        finishes: [
          { finish: 'normal', market: 4 },
          { finish: 'holo', market: 90 },
        ],
      },
    });
    await open(page);
    await page.locator('button[data-slot-id="slot-a"]').click();
    const dialog = details(page);
    await expect(dialog.getByRole('heading', { name: 'Snorlax A', exact: true })).toBeVisible();
    await expect(dialog).toContainText('English');
    await expect(dialog).toContainText('Normal');
    const prices = dialog.getByRole('region', { name: 'Prices' });
    await expect(prices).toContainText(/Market\s*£4/);
    await expect(prices).not.toContainText('£90');
    if (process.env.SLOT_SHOTS_DIR)
      await page.screenshot({ path: `${process.env.SLOT_SHOTS_DIR}/${test.info().project.name}-owned-detail.png` });
    await expect(dialog.getByRole('button', { name: /Change target|Remove target|Edit slot/ })).toHaveCount(0);
    await expect(dialog.locator('[data-slot-picker]')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'More card options' })).toBeVisible();
    await harness.expectNoHorizontalOverflow();
    for (const action of await dialog.locator('button:visible').all()) await harness.expectMinTapTarget(action, 36);
    await dialog.getByRole('button', { name: 'All Snorlax cards' }).click();
    const all = page.getByRole('dialog', { name: /all snorlax cards/i });
    await expect(all).toBeVisible();
    await expect(page.getByLabel('Synthetic draft count')).toHaveText('0');
    await all.getByRole('button', { name: /close/i }).first().click();
    await expect(all).toHaveCount(0);
  });

  test('a graded copy keeps its grade, and a missing price says so', async ({ harness }) => {
    const { page } = harness;
    await mockCardPrices(page, {});
    await open(page);
    await page.locator('button[data-slot-id="slot-b"]').click();
    const dialog = details(page);
    await expect(dialog).toContainText('PSA');
    await expect(dialog.getByRole('region', { name: 'Prices' })).toContainText(/Market\s*No price/);
  });

  test('wants on an owned pocket stay visible as upgrade context', async ({ harness }) => {
    const { page } = harness;
    await mockCardPrices(page, {});
    await open(page);
    await page.locator('button[data-slot-id="slot-a"]').click();
    await harness.closeControl(details(page)).click();
    await page.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent('synthetic-slot-wants', {
          detail: {
            slotId: 'slot-a',
            wants: [{ card_id: 'synthetic-snorlax-b', card_language: 'en', card_finish: 'holo' }],
          },
        }),
      ),
    );
    await page.locator('button[data-slot-id="slot-a"]').click();
    await expect(details(page).getByRole('region', { name: 'Wanted here' })).toContainText('Holo');
  });

  test('an owner or binder change closes an open owned detail', async ({ harness }) => {
    const { page } = harness;
    await mockCardPrices(page, {});
    await open(page);
    for (const kind of ['owner', 'binder']) {
      await page.locator('button[data-slot-id="slot-a"]').click();
      await expect(details(page)).toBeVisible();
      await page.evaluate(
        (kind) => window.dispatchEvent(new CustomEvent('synthetic-slot-scope-change', { detail: kind })),
        kind,
      );
      await expect(details(page)).toHaveCount(0);
    }
  });
});
