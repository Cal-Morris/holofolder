import { test, expect, Harness, mockBackends, emulateStandalone } from './fixtures';
import type { Page } from '@playwright/test';

// Michi method page art on the binder's own pockets. Synthetic slots and binder list only: the harness seeds
// Pikachu's artwork (?pageArt=1) and /api/binders is answered here, never by a real database.
test.describe('page art', () => {
  test.use({
    signedIn: true,
    harness: async ({ page, context, standalone, insets, baseURL }, provide) => {
      if (standalone) await emulateStandalone(page, insets);
      await mockBackends(page, context, { signedIn: true, baseURL });
      await provide(new Harness(page, insets, true));
    },
  });
  const pocket = (page: Page, id: string) => page.locator(`[data-binder-page] button[data-slot-id="${id}"]`);
  const bar = (page: Page) => page.getByRole('region', { name: 'Layout editing', exact: true });
  const open = async (page: Page, pageArt: boolean) => {
    await page.route('**/app/api/card-prices**', (route) => route.fulfill({ json: { prices: [] } }));
    await page.goto(`/app/e2e-harness?signedIn=1&slots=picker&binders=1&rows=2&cols=4${pageArt ? '&pageArt=1' : ''}`);
    await expect(pocket(page, 'slot-a')).toBeVisible();
  };

  test('one picture spans its pockets and the gaps between them', { tag: '@matrix' }, async ({ harness }) => {
    const { page } = harness;
    await open(page, true);
    const art = page.locator('[data-binder-page] [data-page-art="e2e-art"]').first();
    await expect(art).toBeVisible();
    await expect(art.locator('img')).toHaveAttribute('src', /official-artwork%2F25\.png/);
    const [box, first, third] = await Promise.all([
      art.boundingBox(),
      pocket(page, 'slot-a').boundingBox(),
      pocket(page, 'slot-c').boundingBox(),
    ]);
    // Seamless: one element from the first pocket's left edge to the third pocket's right edge.
    expect(Math.abs(box!.x - first!.x)).toBeLessThan(1.5);
    expect(Math.abs(box!.y - first!.y)).toBeLessThan(1.5);
    expect(Math.abs(box!.x + box!.width - (third!.x + third!.width))).toBeLessThan(1.5);
    expect(box!.height).toBeGreaterThan(first!.height * 2);
    // Empty pockets under the picture drop their own fill, so neighbours join.
    const empty = page.locator('[data-binder-page] button[data-slot-id]:not([data-filled])').first();
    if (await empty.count()) {
      const id = await empty.getAttribute('data-slot-id');
      const index = await page
        .locator('[data-binder-page] button[data-slot-id]')
        .evaluateAll((els, id) => els.findIndex((el) => el.getAttribute('data-slot-id') === id), id);
      if (index % 4 < 3 && index < 8) await expect(empty).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    }
    await harness.expectNoHorizontalOverflow();
  });

  test('pick pockets, choose a Pokémon and save', async ({ harness }) => {
    const { page } = harness;
    await open(page, false);
    let saved: unknown = null;
    await page.route('**/app/api/binders', async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      const body = route.request().postDataJSON() as { id: string; pageArt: unknown[] };
      saved = body;
      await route.fulfill({
        json: {
          binders: [
            {
              id: body.id,
              ownerUserId: 'e2e',
              name: 'My binder',
              color: null,
              sortOrder: 0,
              isDefault: true,
              rows: null,
              cols: null,
              pageArt: body.pageArt,
              createdAt: null,
              updatedAt: null,
              slotCount: 8,
            },
          ],
        },
      });
    });
    await bar(page).getByRole('button', { name: 'Edit layout', exact: true }).click();
    await pocket(page, 'slot-a').click();
    await pocket(page, 'slot-b').click();
    await bar(page).getByRole('button', { name: 'More options' }).click();
    await page.getByRole('menuitem', { name: /Page art on page 1/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Page art for page 1' });
    await expect(sheet).toBeVisible();
    await harness.expectMinTapTarget(sheet.getByRole('button', { name: 'Close page art' }), 36);
    await expect(sheet.getByText('2 × 1 pockets')).toBeVisible();
    await sheet.getByRole('button', { name: 'Pokémon', exact: true }).click();
    await sheet.getByRole('textbox', { name: 'Find a Pokémon' }).fill('pikachu');
    await sheet.getByRole('button', { name: 'Use Pikachu artwork' }).click();
    await sheet.getByRole('button', { name: 'Save page art' }).click();
    await expect.poll(() => saved).not.toBeNull();
    expect(saved).toMatchObject({
      pageArt: [{ anchorSlotId: 'slot-a', rows: 1, cols: 2, source: { kind: 'pokemon', pokemonId: 25 } }],
    });
    await sheet.getByRole('button', { name: 'Close page art' }).click();
    await expect(sheet).toBeHidden();
    await expect(page.locator('[data-binder-page] [data-page-art]').first()).toBeVisible();
  });
});
