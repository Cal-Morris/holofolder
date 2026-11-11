import { test, expect } from './fixtures';
import { syntheticSlotPickerSnapshot } from '../tests/fixtures/slot-picker';

test.describe('staged preset creation', () => {
  test.beforeEach(async ({ harness }) => {
    const { page } = harness;
    const cards = syntheticSlotPickerSnapshot().cards;
    await page.route('**/app/api/binders**', (route) => route.fulfill({ json: { binders: [] } }));
    await page.route('**/app/api/tcg-card-search**', (route) => {
      const url = new URL(route.request().url()),
        q = url.searchParams.get('q') ?? '';
      return route.fulfill({ json: { cards: cards.filter((c) => c.name.toLowerCase().includes(q.toLowerCase())) } });
    });
    await page.goto('/app/e2e-harness/presets');
    await page.getByRole('button', { name: 'Binders', exact: true }).click();
  });
  const dialog = (page: import('@playwright/test').Page) => page.getByRole('dialog', { name: 'Binders', exact: true });
  test('Blank and Kanto previews copy targets without a write or padding slots', async ({ harness }) => {
    const { page } = harness,
      sheet = dialog(page);
    const writes: string[] = [];
    page.on('request', (r) => {
      if (r.method() !== 'GET' && r.url().includes('/api/')) writes.push(r.url());
    });
    await sheet.getByLabel('New binder name').fill('Mice, Snorlax and favourite promo cards');
    await expect(sheet.getByLabel('Target preview')).toContainText('0 targets');
    await harness.expectMinTapTarget(sheet.getByRole('button', { name: 'Prepare draft' }), 36);
    await harness.expectHittable(sheet.getByRole('button', { name: 'Prepare draft' }));
    await sheet.getByLabel('New binder name').press('Enter');
    await expect(page.getByLabel('Prepared creation draft')).toContainText('"entries":[]');
    await expect(page.getByLabel('Current binder progress')).toContainText('No targets yet');
    await sheet.getByLabel('Starting arrangement').selectOption('generation');
    await expect(sheet.getByLabel('Target preview')).toContainText('151 targets');
    await expect(sheet.getByLabel('Target preview').locator('li').first()).toHaveText('Bulbasaur');
    await sheet.getByRole('button', { name: 'Next targets' }).click();
    await expect(sheet.getByLabel('Target preview')).toContainText('Page 2 of 10');
    await expect(sheet.getByLabel('Target preview').locator('li').first()).toHaveText('Pidgeotto');
    await sheet.getByRole('button', { name: 'Prepare draft' }).click();
    await expect(page.getByLabel('Current binder progress')).toContainText('0 of 151 targets');
    const close = sheet.getByRole('button', { name: 'Close binders', exact: false });
    await harness.expectMinTapTarget(close, 36);
    await harness.expectWithinSafeViewport(sheet);
    await harness.expectNoHorizontalOverflow();
    const box = (await sheet.boundingBox())!,
      dock = (await page.getByRole('navigation', { name: 'Main navigation' }).boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(dock.y);
    console.log('preset geometry', test.info().project.name, { sheet: box, dockTop: dock.y });
    await close.click();
    await page.getByRole('button', { name: 'Remove last target' }).click();
    await expect(page.getByLabel('Current binder progress')).toContainText('0 of 150 targets');
    await page.getByRole('button', { name: 'Make last target free' }).click();
    await expect(page.getByLabel('Current binder progress')).toContainText('0 of 149 targets');
    await expect(page.getByLabel('Current binder progress')).toContainText('0 of 1 free slots');
    await page.getByRole('button', { name: 'Retarget last to Pikachu' }).click();
    await expect(page.getByLabel('Current binder progress')).toContainText('0 of 150 targets');
    expect(writes).toEqual([]);
  });
  test('selected species and catalog printings retain selection order and language', async ({ harness }) => {
    const { page } = harness,
      sheet = dialog(page);
    await sheet.getByLabel('New binder name').fill('Mice and Snorlax');
    await sheet.getByLabel('Starting arrangement').selectOption('species');
    for (const species of ['Maushold', 'Tandemaus', 'Snorlax']) {
      await sheet.getByLabel('Find species').fill(species);
      await sheet.getByRole('button', { name: species, exact: true }).click();
    }
    await expect(sheet.getByLabel('Target preview').locator('li')).toHaveText(['Maushold', 'Tandemaus', 'Snorlax']);
    await sheet.getByRole('button', { name: 'Prepare draft' }).click();
    await expect(page.getByLabel('Prepared creation draft')).toContainText('"pokemonId":925');
    await sheet.getByLabel('Starting arrangement').selectOption('printings');
    await sheet.getByLabel('Find catalog printings').fill('Snorlax');
    await sheet.getByRole('button', { name: /^Snorlax B/ }).click();
    await sheet.getByRole('button', { name: /^Snorlax A/ }).click();
    await sheet.getByLabel('Filter printing set').fill('missing-set');
    await expect(sheet.getByLabel('Printing results').getByRole('button')).toHaveCount(0);
    await expect(sheet.getByLabel('Target preview').locator('li')).toHaveText([
      'Snorlax B · Synthetic set · en',
      'Snorlax A · Synthetic set · en',
    ]);
    await sheet.getByRole('button', { name: 'Prepare draft' }).click();
    await expect(page.getByLabel('Prepared creation draft')).toContainText(
      '"cardId":"synthetic-snorlax-b","language":"en"',
    );
    await expect(page.getByLabel('Current binder progress')).toContainText('0 of 2 targets');
    await harness.expectNoHorizontalOverflow();
  });
  test('offline uncached catalog explains the limit and cannot claim creation', async ({ harness, context }) => {
    const { page } = harness,
      sheet = dialog(page);
    await sheet.getByLabel('New binder name').fill('Offline preview');
    await context.setOffline(true);
    await sheet.getByLabel('Starting arrangement').selectOption('printings');
    await sheet.getByLabel('Find catalog printings').fill('Uncached anniversary');
    await expect(sheet).toContainText('Connect to find uncached printings');
    await expect(sheet.getByRole('button', { name: 'Prepare draft' })).toBeDisabled();
    await expect(page.getByLabel('Prepared creation draft')).toHaveText('No draft');
    await harness.expectNoHorizontalOverflow();
  });
  test('unknown catalog evidence stays disabled, long labels wrap and binder cap blocks drafts', async ({
    harness,
  }) => {
    const { page } = harness;
    const base = syntheticSlotPickerSnapshot().cards[0];
    await page.route('**/app/api/tcg-card-search**', (route) =>
      route.fulfill({
        json: {
          cards: [
            {
              ...base,
              id: 'synthetic-long',
              name: 'Pikachu and Snorlax Special Collection Anniversary Illustration',
              set: { id: 'synthetic-long-set', name: 'Synthetic International Anniversary Special Collection' },
            },
            { ...base, id: 'synthetic-unknown', name: 'Synthetic unknown printing', language: undefined },
          ],
        },
      }),
    );
    const sheet = dialog(page);
    await sheet.getByLabel('Starting arrangement').selectOption('printings');
    await sheet.getByLabel('Find catalog printings').fill('Synthetic');
    await expect(sheet.getByRole('button', { name: /^Synthetic unknown printing/ })).toBeDisabled();
    const result = sheet.getByRole('button', { name: /^Pikachu and Snorlax Special/ });
    await harness.expectMinTapTarget(result, 36);
    await result.click();
    await expect(sheet.getByLabel('Target preview')).toContainText('1 targets');
    await harness.expectNoHorizontalOverflow();
    await page.route('**/app/api/binders**', (route) =>
      route.fulfill({
        json: {
          binders: Array.from({ length: 20 }, (_, i) => ({
            id: `synthetic-binder-${i}`,
            ownerUserId: 'synthetic-owner',
            name: `Binder ${i}`,
            sortOrder: i,
            isDefault: i === 0,
            color: null,
            rows: null,
            cols: null,
            createdAt: null,
            updatedAt: null,
          })),
        },
      }),
    );
    await page.reload();
    await page.getByRole('button', { name: 'Binders', exact: true }).click();
    await expect(dialog(page).getByText('Binder 19', { exact: true })).toBeVisible();
    await dialog(page).getByLabel('New binder name').fill('At capacity');
    await expect(dialog(page).getByRole('button', { name: 'Prepare draft' })).toBeDisabled();
  });
  test('shared sheet closes with Escape, back, backdrop and dock switch', async ({ harness }) => {
    const { page } = harness;
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Binders', exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'Binders', exact: true }).click();
    await page.goBack();
    await expect(dialog(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'Binders', exact: true }).click();
    await harness.tapBackdrop(dialog(page));
    await expect(dialog(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'Binders', exact: true }).click();
    await page.getByRole('button', { name: 'List', exact: true }).click();
    await expect(dialog(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'Binders', exact: true }).click();
    await harness.swipeDown(dialog(page));
    await expect(dialog(page)).toHaveCount(0);
    await harness.expectScrollUnlocked();
  });
});
