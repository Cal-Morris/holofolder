import { test, expect, mockBackends, seedNativeStorage, SEEDED_COLLECTION } from './fixtures';
import { test as plainTest } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { TCGSetSlotsResponse } from '../lib/tcg-set-slots';

// Synthetic set (not real catalogue data): its name matches "fixture", its id matches "fxs".
const set = {
  id: 'fxs1',
  name: 'Fixture Search Set',
  seriesName: 'Fixture Series',
  officialCardCount: 2,
  releaseDate: '2026-01-01',
};
const card = {
  id: 'fxs1-1',
  localId: '1',
  name: 'Fixture Bulbasaur',
  language: 'en' as const,
  set,
  inferredFinish: 'normal' as const,
};
const payload: TCGSetSlotsResponse = {
  sets: [set],
  selectedSet: set,
  cards: [card],
  slots: [{ dexId: 1, pokemonName: 'bulbasaur', cards: [card] }],
};

async function mockSets(page: Page) {
  await page.route('**/app/api/tcg-set-slots**', (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get('setId'))
      return route.fulfill({
        json: params.get('setId') === set.id ? payload : { error: 'not found' },
        status: params.get('setId') === set.id ? 200 : 404,
      });
    const query = (params.get('query') ?? '').toLowerCase();
    const hit = query.length >= 2 && (set.name.toLowerCase().includes(query) || set.id.includes(query));
    return route.fulfill({ json: { sets: hit ? [set] : [], selectedSet: null, slots: [] } });
  });
}

async function expectSetOpened(page: Page) {
  await expect(page.getByRole('group', { name: 'Set checklist' })).toBeVisible();
  await expect(page.getByRole('button', { name: `Remove ${set.name}` })).toBeVisible();
}

test.describe('search by set', () => {
  test.use({ signedIn: true });

  test('Quick mode lists a set hit; tapping it opens Sets on that set', async ({ harness }) => {
    await mockSets(harness.page);
    const search = harness.dock().getByRole('button', { name: 'Search', exact: true });
    const box = (await search.boundingBox())!;
    await harness.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await harness.page.mouse.down();
    const dialog = harness.page.getByRole('dialog', { name: 'Quick mode' });
    await expect(dialog).toBeVisible();
    await harness.page.mouse.up();

    await dialog.getByRole('searchbox').fill('fxs');
    const hit = dialog
      .getByRole('region', { name: 'Sets' })
      .getByRole('button', { name: /^Open set Fixture Search Set, Fixture Series · 2 cards/ });
    await expect(hit).toBeVisible();
    await harness.expectMinTapTarget(hit, 48);
    await harness.expectNoHorizontalOverflow();
    // Card results stay grouped as before: the set row sits beside them, it doesn't regroup them.
    await dialog.getByRole('searchbox').fill('charm');
    await expect(dialog.getByRole('region', { name: 'Cards' })).toBeVisible();
    await expect(dialog.getByRole('region', { name: 'Sets' })).toHaveCount(0);

    await dialog.getByRole('searchbox').fill('fixture search');
    await dialog
      .getByRole('region', { name: 'Sets' })
      .getByRole('button', { name: /^Open set Fixture Search Set/ })
      .click();
    await expect(dialog).toBeHidden();
    await expectSetOpened(harness.page);
    await harness.expectScrollUnlocked();
  });

  test('the Search sheet lists a set hit; tapping it opens Sets on that set', async ({ harness }) => {
    await mockSets(harness.page);
    await harness.dock().getByRole('button', { name: 'Search', exact: true }).click();
    const sheet = harness.page.getByRole('dialog', { name: /search pokemon/i });
    await expect(sheet).toBeVisible();
    await sheet.getByRole('textbox').fill('Fixture Search');
    const hit = sheet
      .getByRole('region', { name: 'Set results' })
      .getByRole('button', { name: /^Open set Fixture Search Set/ });
    await expect(hit).toBeVisible();
    await harness.expectMinTapTarget(hit, 44);
    await harness.expectNoHorizontalOverflow();
    await hit.click();
    await expect(sheet).toBeHidden();
    await expectSetOpened(harness.page);
  });

  for (const mode of ['Search', 'Quick mode'] as const) {
    test(`${mode} finds every set by year with CDN symbols, including saved sets offline`, async ({ harness }) => {
      const page = harness.page;
      // Synthetic catalogue, deliberately larger than the usual three-result cap.
      const releases = [4, 3, 2, 1].map((month) => ({
        ...set,
        id: `fixture-year-${month}`,
        name: `Fixture Year Set ${month}`,
        releaseDate: `2017-0${month}-01`,
        symbol: `https://assets.holofolder.com/pokemon/tcg/sets/fixture-${month}/symbol.webp`,
      }));
      await page.route('https://assets.holofolder.com/pokemon/tcg/sets/**', (route) =>
        route.fulfill({
          contentType: 'image/png',
          body: Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0ioAAAAASUVORK5CYII=',
            'base64',
          ),
        }),
      );
      await page.route('**/app/api/tcg-set-slots**', (route) =>
        route.fulfill({ json: { sets: releases, selectedSet: null, slots: [] } }),
      );
      const search = harness.dock().getByRole('button', { name: 'Search', exact: true });
      if (mode === 'Quick mode') {
        const box = (await search.boundingBox())!;
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await expect(page.getByRole('dialog', { name: mode })).toBeVisible();
        await page.mouse.up();
      } else await search.click();
      const dialog = page.getByRole('dialog', { name: mode === 'Search' ? /search pokemon/i : mode });
      const input = dialog.getByRole(mode === 'Search' ? 'textbox' : 'searchbox');
      await input.fill('2017');
      const region = dialog.getByRole('region', { name: mode === 'Search' ? 'Set results' : 'Sets', exact: true });
      await expect(region.getByRole('button')).toHaveCount(4);
      for (const row of await region.getByRole('button').all()) {
        await harness.expectMinTapTarget(row, 36);
        await expect(row.locator('img')).toHaveAttribute(
          'src',
          /^https:\/\/assets\.holofolder\.com\/pokemon\/tcg\/sets\//,
        );
      }
      await region.getByRole('button').last().scrollIntoViewIfNeeded();
      await harness.expectWithinSafeViewport(region.getByRole('button').last());
      await harness.expectNoHorizontalOverflow();
      // Exercise the hook's saved-data fallback without requiring a worker in this harness.
      await page.evaluate(async (sets) => {
        const cache = await caches.open('synthetic-set-search-data');
        await cache.put('/app/api/tcg-set-slots?all=1', Response.json({ sets }));
      }, releases);
      await page.context().setOffline(true);
      await input.fill('2016');
      await expect(region).toHaveCount(0);
      await input.fill('2017');
      await expect(region.getByRole('button')).toHaveCount(4);
      await page.context().setOffline(false);
    });
  }

  test('Show mode keeps the lookup: no set rows', async ({ harness }) => {
    await mockSets(harness.page);
    await harness.page.getByRole('button', { name: 'Show mode', exact: true }).first().click();
    await harness.dock().getByRole('button', { name: 'Search', exact: true }).click();
    const dialog = harness.page.getByRole('dialog', { name: 'Quick mode' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('searchbox').fill('fixture search');
    await expect(dialog.getByRole('region', { name: 'Sets' })).toHaveCount(0);
  });
});

const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

plainTest.describe('search by set on desktop 1280×800', () => {
  plainTest.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false, userAgent: DESKTOP_UA });

  plainTest('Ctrl+K and the header Search both open Sets on a set hit', async ({ page, baseURL }) => {
    plainTest.skip(plainTest.info().project.name !== 'browser-390x844', 'desktop context: run once');
    await mockBackends(page, page.context(), { signedIn: true, baseURL });
    await seedNativeStorage(page.context(), baseURL, SEEDED_COLLECTION);
    await mockSets(page);
    await page.goto('/app/e2e-harness?signedIn=1&browserHost=1');
    await expect(page.locator('[data-slot-id="synthetic-dex-1"]').first()).toBeVisible({ timeout: 30_000 });

    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog', { name: 'Quick mode' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('searchbox').fill('fxs1');
    await dialog
      .getByRole('region', { name: 'Sets' })
      .getByRole('button', { name: /^Open set Fixture Search Set/ })
      .click();
    await expect(dialog).toBeHidden();
    await expectSetOpened(page);

    // From Sets itself, a second pick opens a fresh Sets view on the picked set.
    await page.getByTestId('app-header').getByRole('button', { name: 'Search', exact: true }).last().click();
    const sheet = page.getByRole('dialog', { name: /search pokemon/i });
    await expect(sheet).toBeVisible();
    await sheet.getByRole('textbox').fill('fixture search');
    await sheet
      .getByRole('region', { name: 'Set results' })
      .getByRole('button', { name: /^Open set Fixture Search Set/ })
      .click();
    await expect(sheet).toBeHidden();
    await expectSetOpened(page);
  });
});
