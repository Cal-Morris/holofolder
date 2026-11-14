import { test, expect } from './fixtures';
import {
  syntheticPromoHostCards as syntheticPresetCards,
  syntheticPromoHostSet as syntheticPresetSet,
  syntheticSuggestedPromo as syntheticPresetPromo,
} from '../tests/fixtures/set-preset';

test.describe('copied set preset draft', () => {
  test.beforeEach(async ({ harness }) => {
    const { page } = harness;
    await page.route('**/app/api/binders**', (route) => route.fulfill({ json: { binders: [] } }));
    await page.route('**/app/api/tcg-set-slots**', (route) => {
      const url = new URL(route.request().url()),
        promo = url.searchParams.get('setId') === 'svp';
      const cards = promo
        ? [syntheticPresetPromo]
        : syntheticPresetCards.map((c) => ({
            ...c,
            languageConfirmed: (url.searchParams.get('language') ?? 'en') === 'en',
          }));
      return route.fulfill({
        json: {
          sets: [syntheticPresetSet],
          selectedSet: url.searchParams.has('setId') ? (promo ? syntheticPresetPromo.set : syntheticPresetSet) : null,
          cards,
          slots: [],
        },
      });
    });
    await page.goto('/app/e2e-harness/presets');
    await page.getByRole('button', { name: 'Binders', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'Binders', exact: true });
    await sheet.getByLabel('Starting arrangement').selectOption('set');
    await sheet.getByLabel('New binder name').fill('Synthetic set checklist');
    await sheet.getByLabel('Find set preset').fill('synthetic');
    await sheet.getByRole('button', { name: 'Find set', exact: true }).click();
    await sheet.getByRole('button', { name: /Synthetic International/ }).click();
    await expect(sheet.getByLabel('Copied set scope')).toContainText('6 targets');
  });
  test('exact base preview includes all categories in collector order and hands off no ownership', async ({
    harness,
  }) => {
    const { page } = harness,
      sheet = page.getByRole('dialog', { name: 'Binders', exact: true });
    const writes: string[] = [];
    page.on('request', (r) => {
      if (r.method() !== 'GET' && r.url().includes('/api/')) writes.push(r.url());
    });
    await expect(sheet.getByLabel('Target preview').locator('li')).toHaveText([
      /Synthetic repeated Pokémon.*#1 /,
      /Synthetic supporter.*#2 /,
      /Synthetic repeated Pokémon.*#4 /,
      /Synthetic basic Energy.*#10 /,
      /Synthetic secret Trainer.*#104 /,
      /Synthetic item subset.*#TG2 /,
    ]);
    await expect(sheet.getByLabel('Copied set scope')).toContainText('not a complete master-set claim');
    await harness.expectMinTapTarget(sheet.getByRole('button', { name: 'Prepare draft' }), 36);
    await harness.expectNoHorizontalOverflow();
    await harness.expectWithinSafeViewport(sheet);
    const box = (await sheet.boundingBox())!,
      dock = (await page.getByRole('navigation', { name: 'Main navigation' }).boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(dock.y);
    await sheet.getByRole('button', { name: 'Prepare draft' }).click();
    await expect(sheet).toContainText('No binder has been saved');
    await expect(page.getByLabel('Prepared creation draft')).toContainText('"setChecklist"');
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByLabel('Current binder progress')).toContainText('0 of 6 targets');
    await expect(page.getByLabel('Current binder progress')).toContainText('Owner inventory:');
    expect(writes).toEqual([]);
  });
  test('Sets entry uses the same draft callback and actual selected set', async ({ harness }) => {
    const { page } = harness;
    await page.getByRole('dialog', { name: 'Binders', exact: true }).getByRole('button', { name: 'Close' }).click();
    await page.getByRole('button', { name: 'Browse synthetic set', exact: true }).click();
    await page.getByRole('button', { name: 'Create binder from this set', exact: true }).click();
    const form = page.getByRole('form', { name: 'Preset creation draft' });
    await form.getByLabel('New binder name').fill('Synthetic from Sets');
    await form.getByRole('button', { name: /^Use Synthetic International/ }).click();
    await expect(form.getByLabel('Copied set scope')).toContainText('6 targets');
    await form.getByRole('button', { name: 'Prepare draft' }).click();
    await expect(page.getByLabel('Prepared creation draft')).toContainText('"name":"Synthetic from Sets"');
    await expect(page.getByLabel('Current binder progress')).toContainText('0 of 6 targets');
    await harness.expectNoHorizontalOverflow();
  });
  test('explicit finish scope and a suggested promo produce an exact preview', async ({ harness }) => {
    const { page } = harness,
      sheet = page.getByRole('dialog', { name: 'Binders', exact: true });
    await expect(sheet.getByRole('button', { name: /^Holo/ })).toHaveCount(0);
    await sheet.getByRole('button', { name: /^Reverse holo/ }).click();
    await expect(sheet.getByLabel('Copied set scope')).toContainText('1 targets');
    await expect(sheet.getByLabel('Target preview')).toContainText('reverse_holo');
    await sheet.getByRole('button', { name: /^Normal/ }).click();
    await expect(sheet.getByLabel('Copied set scope')).toContainText('7 targets');
    await sheet.getByRole('button', { name: /^Promo / }).click();
    await expect(sheet.getByLabel('Copied set scope')).toContainText('8 targets');
    await expect(sheet.getByLabel('Copied set scope')).toContainText('1 selected promos.');
    await harness.expectNoHorizontalOverflow();
    await sheet.getByRole('button', { name: 'Prepare draft' }).click();
    await expect(page.getByLabel('Prepared creation draft')).toContainText('"excludedCardIds":[]');
  });
  test('rejected promo alias leaves the selected scope and prepared draft consistent', async ({ harness }) => {
    const { page } = harness,
      sheet = page.getByRole('dialog', { name: 'Binders', exact: true });
    await page.route('**/app/api/tcg-set-slots**', (route) => {
      const url = new URL(route.request().url()),
        promo = url.searchParams.get('setId') === 'svp';
      const cards = promo
        ? [{ ...syntheticPresetPromo, aliasIds: ['synthetic-shared-alias'] }]
        : syntheticPresetCards.map((card, index) => ({
            ...card,
            ...(index === 0 ? { aliasIds: ['synthetic-shared-alias'] } : {}),
          }));
      return route.fulfill({
        json: {
          sets: [syntheticPresetSet],
          selectedSet: promo ? syntheticPresetPromo.set : syntheticPresetSet,
          cards,
          slots: [],
        },
      });
    });
    await sheet.getByRole('button', { name: 'Find set', exact: true }).click();
    await sheet.getByRole('button', { name: /Synthetic International/ }).click();
    await sheet.getByRole('button', { name: /^Promo / }).click();
    await expect(sheet.getByRole('status').filter({ hasText: /That selection can.t be used/ })).toBeVisible();
    await expect(sheet.getByRole('button', { name: /^Promo /, pressed: true })).toHaveCount(0);
    await expect(sheet.getByLabel('Copied set scope')).toContainText('6 targets');
    await expect(sheet.getByLabel('Copied set scope')).toContainText('0 selected promos');
    await sheet.getByRole('button', { name: 'Prepare draft' }).click();
    await expect(page.getByLabel('Prepared creation draft')).toContainText('"promoCardIds":[]');
    await expect(page.getByLabel('Prepared creation draft')).not.toContainText('"cardId":"synthetic-promo-1"');
  });
  test('saved scope remains visible offline and edited current targets change the goal', async ({ harness }) => {
    const { page } = harness,
      sheet = page.getByRole('dialog', { name: 'Binders', exact: true });
    await sheet.getByRole('button', { name: 'Prepare draft' }).click();
    await page.context().setOffline(true);
    await expect(sheet.getByRole('button', { name: 'Prepare draft' })).toBeDisabled();
    await expect(sheet.getByLabel('Copied set scope')).toContainText('6 targets');
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByLabel('Copied set scope')).toContainText('6 targets');
    await page.getByRole('button', { name: 'Append free extra', exact: true }).click();
    await expect(page.getByLabel('Current binder progress')).toContainText('0 of 6 targets');
    await page.getByRole('button', { name: 'Append Energy target', exact: true }).click();
    await expect(page.getByLabel('Current binder progress')).toContainText('0 of 7 targets');
    await expect(page.getByLabel('Copied set scope')).toContainText('Customised preset');
    await page.getByRole('button', { name: 'Remove last target', exact: true }).click();
    await expect(page.getByLabel('Current binder progress')).toContainText('0 of 6 targets');
    await harness.expectNoHorizontalOverflow();
  });
  test('unconfirmed language and unknown finishes are unavailable, uncached offline creation disabled', async ({
    harness,
  }) => {
    const { page } = harness,
      sheet = page.getByRole('dialog', { name: 'Binders', exact: true });
    await sheet.getByLabel('Checklist language').selectOption('fr');
    await expect(sheet.getByRole('button', { name: 'Prepare draft' })).toBeDisabled();
    await sheet.getByRole('button', { name: 'Find set', exact: true }).click();
    await sheet.getByRole('button', { name: /Synthetic International/ }).click();
    await expect(sheet.getByLabel('Copied set scope')).toContainText('0 targets');
    await expect(sheet.getByLabel('Copied set scope')).toContainText('chosen language is not confirmed');
    await expect(sheet.getByRole('button', { name: /^Normal/ })).toHaveCount(0);
    await page.context().setOffline(true);
    await expect(sheet.getByRole('button', { name: 'Find set', exact: true })).toBeDisabled();
    await expect(sheet.getByRole('button', { name: 'Prepare draft' })).toBeDisabled();
    await harness.expectNoHorizontalOverflow();
  });
});
