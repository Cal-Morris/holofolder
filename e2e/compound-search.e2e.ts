import { test, expect } from './fixtures';
import { searchOfflineCards, searchOfflineCardsWithCorrection } from '../lib/offline-card-index';

// Synthetic search fixture, no prices or collection writes.
const cards = [
  { id: 'sv03.5-064', localId: '064', name: 'Kadabra', set: { id: 'sv03.5', name: '151' }, dexIds: [64] },
  { id: 'sv03.5-063', localId: '063', name: 'Abra', set: { id: 'sv03.5', name: '151' }, dexIds: [63] },
  { id: 'base1-43', localId: '43', name: 'Abra', set: { id: 'base1', name: 'Base Set' }, dexIds: [63] },
];

test('ordinary Search renders compound card hits and a useful empty state', async ({ harness, page }, info) => {
  await page.route('**/app/api/tcg-card-search**', (route) => {
    const query = new URL(route.request().url()).searchParams.get('q') ?? '';
    return route.fulfill({ json: { cards: searchOfflineCards(cards, query) } });
  });
  await harness.dock().getByRole('button', { name: 'Search', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Search Pokemon' });
  const input = dialog.getByRole('textbox');
  await input.fill('abra 151');
  const results = dialog.getByRole('region', { name: 'Card results' });
  await expect(results.getByText('151', { exact: true })).toHaveCount(2);
  await expect(results.getByText('Base Set', { exact: true })).toHaveCount(0);
  await harness.expectNoHorizontalOverflow();
  await page.screenshot({ path: `/tmp/compound-${info.project.name}-results.png` });
  await input.fill('zzzz nonexistent');
  await expect(dialog.getByText('No matches. Try a Pokémon name, a set, or both, like Abra 151.')).toBeVisible();
  await page.screenshot({ path: `/tmp/compound-${info.project.name}-empty.png` });
  await dialog.getByRole('button', { name: 'Close search' }).click();
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Show mode', exact: true }).click();
  await harness.dock().getByRole('button', { name: 'Search', exact: true }).click();
  const show = page.getByRole('dialog', { name: 'Quick mode' });
  await show.getByRole('searchbox').fill('abra 151');
  await expect(
    show.getByRole('region', { name: 'Cards', exact: true }).getByRole('button', { name: /Abra, 151/ }),
  ).toBeVisible();
  await expect(
    show.getByRole('region', { name: 'Cards', exact: true }).getByRole('button', { name: /Kadabra, 151/ }),
  ).toBeVisible();
  await expect(
    show.getByRole('region', { name: 'Cards', exact: true }).getByText('Base Set', { exact: true }),
  ).toHaveCount(0);
  await page.evaluate(async (cards) => {
    const cache = await caches.open('compound-fixture-data');
    await cache.put(
      '/app/api/tcg-card-search?q=fixture',
      new Response(JSON.stringify({ cards }), { headers: { 'content-type': 'application/json' } }),
    );
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
  }, cards);
  await show.getByRole('searchbox').fill('151 abra');
  await expect(show.getByRole('region', { name: 'Cards', exact: true })).toContainText('on this device');
  await expect(
    show.getByRole('region', { name: 'Cards', exact: true }).getByRole('button', { name: /Abra, 151/ }),
  ).toBeVisible();
  await expect(
    show.getByRole('region', { name: 'Cards', exact: true }).getByRole('button', { name: /Kadabra, 151/ }),
  ).toBeVisible();
  await expect(
    show.getByRole('region', { name: 'Cards', exact: true }).getByText('Base Set', { exact: true }),
  ).toHaveCount(0);
});

test('compound spelling correction is labelled without replacing the query in Search and Quick', async ({
  harness,
  page,
}, info) => {
  // Synthetic cards with real catalog set names, no price evidence.
  const neoCards = [
    { id: 'neo1-9', localId: '9', name: 'Lugia', set: { id: 'neo1', name: 'Neo Genesis' }, dexIds: [249] },
    { id: 'neo3-20', localId: '20', name: 'Lugia', set: { id: 'neo3', name: 'Neo Revelation' }, dexIds: [249] },
  ];
  await page.route('**/app/api/tcg-card-search**', (route) => {
    const query = new URL(route.request().url()).searchParams.get('q') ?? '';
    return route.fulfill({ json: searchOfflineCardsWithCorrection(neoCards, query) });
  });
  await harness.dock().getByRole('button', { name: 'Search', exact: true }).click();
  const search = page.getByRole('dialog', { name: 'Search Pokemon' });
  await search.getByRole('textbox').fill('Lucia neo');
  const correction = search.getByRole('status').filter({ hasText: 'Showing cards for lugia neo' });
  await expect(correction).toBeVisible();
  await expect(search.getByRole('textbox')).toHaveValue('Lucia neo');
  await expect(search.getByRole('button', { name: 'Lugia #9 Neo Genesis', exact: true })).toBeVisible();
  await expect(search.getByRole('button', { name: 'Lugia #20 Neo Revelation', exact: true })).toBeVisible();
  await harness.expectWithinSafeViewport(correction);
  await harness.expectNoHorizontalOverflow();
  await page.screenshot({ path: `/tmp/search-correction-${info.project.name}.png` });
  await search.getByRole('textbox').fill('Lugia neo');
  await expect(search.getByRole('status').filter({ hasText: 'Showing cards for' })).toHaveCount(0);
  await search.getByRole('button', { name: 'Quick mode', exact: true }).click();
  const quick = page.getByRole('dialog', { name: 'Quick mode' });
  await quick.getByRole('searchbox').fill('Lucia neo');
  await expect(quick.getByRole('status').filter({ hasText: 'Showing cards for lugia neo' })).toBeVisible();
  await expect(quick.getByRole('searchbox')).toHaveValue('Lucia neo');
  await quick.getByRole('button', { name: 'Close quick mode' }).click();
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Show mode', exact: true }).click();
  await page.evaluate(async (cards) => {
    const cache = await caches.open('correction-fixture-data');
    await cache.put(
      '/app/api/tcg-card-search?q=fixture',
      new Response(JSON.stringify({ cards }), { headers: { 'content-type': 'application/json' } }),
    );
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
  }, neoCards);
  await harness.dock().getByRole('button', { name: 'Search', exact: true }).click();
  await quick.getByRole('searchbox').fill('Lucia neo');
  await expect(quick.getByRole('region', { name: 'Cards', exact: true })).toContainText('on this device');
  await expect(quick.getByRole('status').filter({ hasText: 'Showing cards for lugia neo' })).toBeVisible();
  await expect(quick.getByRole('searchbox')).toHaveValue('Lucia neo');
  await harness.expectNoHorizontalOverflow();
});
