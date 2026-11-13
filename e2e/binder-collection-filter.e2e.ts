import {
  test,
  expect,
  mockBackends,
  emulateStandalone,
  chooseCollection,
  choosePockets,
  pocketFilter,
  E2E_USER,
  Harness,
} from './fixtures';
import { inventoryBrowseFixture } from '../tests/fixtures/inventory-browse';
import { fixture, catalogRows, snapshotCardIds } from '../tests/fixtures/inventory-read-server';
import { buildInventoryCatalog } from '../lib/server/inventory-read-catalog';

const alpha = '22222222-2222-4222-8222-222222222222';
const beta = '33333333-3333-4333-8333-333333333333';
// Synthetic wants; images are served by the e2e placeholder route.
const want = (id: string, name: string) => ({
  card_id: id,
  card_name: name,
  card_language: 'en' as const,
  card_image: `https://assets.tcgdex.net/en/base/base1/${id.split('-')[1]}`,
  added_at: '2026-11-10T00:00:00Z',
});

test('binder filter bar shows owned, wanted and missing pockets and resets per binder', async ({
  page,
  context,
  standalone,
  insets,
  baseURL,
}, info) => {
  if (standalone) await emulateStandalone(page, insets);
  await mockBackends(page, context, { signedIn: true, baseURL });
  const snapshot = inventoryBrowseFixture(2);
  snapshot.ownerUserId = E2E_USER.id;
  snapshot.items.forEach((i) => {
    i.ownerUserId = E2E_USER.id;
    i.grading = null;
  });
  snapshot.collections = [
    { ...snapshot.collections[0], ownerUserId: E2E_USER.id, id: alpha, name: 'National dex' },
    { ...snapshot.collections[1], ownerUserId: E2E_USER.id, id: beta, name: 'Trades' },
  ];
  snapshot.binders.forEach((b, n) => {
    b.collectionId = n ? beta : alpha;
    b.ownerUserId = E2E_USER.id;
    b.slots.forEach((s, i) => {
      s.ownerUserId = E2E_USER.id;
      s.collectionId = b.collectionId;
      s.id = `${b.collectionId}-${i}`;
      s.inventoryItemId = null;
      s.status = null;
    });
  });
  const binder = snapshot.binders[0];
  // 0: owned, with a wanted upgrade. 1: owned and perfect. 2: missing with a want. 4: missing target. The rest are spacers.
  binder.slots[0].target = { kind: 'pokemon', pokemonId: 6 };
  binder.slots[0].inventoryItemId = snapshot.items[0].id;
  binder.slots[0].status = 'collected';
  // An owned pocket with a wanted upgrade is not Wanted: Wanted means not owned yet (#657).
  binder.slots[0].wantedCards = [want('base1-4', 'Charizard')];
  snapshot.items[1].identity = { kind: 'pokemon', pokemonId: 9 };
  binder.slots[1].target = { kind: 'pokemon', pokemonId: 9 };
  binder.slots[1].inventoryItemId = snapshot.items[1].id;
  binder.slots[1].status = 'finalized';
  binder.slots[2].target = { kind: 'pokemon', pokemonId: 3 };
  binder.slots[2].status = 'wishlisted';
  binder.slots[2].wantedCards = [want('base1-15', 'Venusaur')];
  binder.slots[4].target = { kind: 'pokemon', pokemonId: 1 };
  snapshot.binders[1].slots[0].target = { kind: 'pokemon', pokemonId: 25 };
  snapshot.placements = [
    { inventoryItemId: snapshot.items[0].id, collectionId: alpha, slotId: binder.slots[0].id, version: 1 },
    { inventoryItemId: snapshot.items[1].id, collectionId: alpha, slotId: binder.slots[1].id, version: 1 },
  ];
  const f = fixture(0);
  f.tables.tcg_cards = [
    {
      id: 'base1-4',
      series_id: 'base',
      set_id: 'base1',
      local_id: '4',
      name_en: 'Charizard',
      name_json: { en: 'Charizard' },
      image_languages_json: ['en'],
      external_ids_json: {},
    },
    {
      id: 'base1-15',
      series_id: 'base',
      set_id: 'base1',
      local_id: '15',
      name_en: 'Venusaur',
      name_json: { en: 'Venusaur' },
      image_languages_json: ['en'],
      external_ids_json: {},
    },
  ];
  f.tables.tcg_sets = [{ id: 'base1', name_en: 'Base Set' }];
  f.tables.tcg_card_dex_ids = [
    { card_id: 'base1-4', dex_id: 6 },
    { card_id: 'base1-15', dex_id: 3 },
  ];
  const catalog = buildInventoryCatalog(catalogRows(f.tables, snapshotCardIds(snapshot)));
  await page.route('**/app/api/inventory?*', async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({
      headers: { 'Cache-Control': 'private, no-store' },
      json: {
        version: 2,
        requestId: url.searchParams.get('requestId'),
        scope: {
          actorUserId: E2E_USER.id,
          ownerUserId: E2E_USER.id,
          authSessionId: 'synthetic-e2e-auth-session',
          sessionId: url.searchParams.get('sessionId'),
        },
        snapshot,
        navigation: {
          catalog,
          layouts: [
            { collectionId: alpha, layoutRevision: 1, rows: 4, cols: 4 },
            { collectionId: beta, layoutRevision: 1, rows: 4, cols: 4 },
          ],
        },
        evidence: {
          inventoryRevision: 1,
          items: 2,
          placements: 2,
          collections: 2,
          binders: 2,
          slots: 24,
          storage: [
            { collectionId: alpha, collectionVersion: 1, layoutRevision: 1, slotCount: 12 },
            { collectionId: beta, collectionVersion: 1, layoutRevision: 1, slotCount: 12 },
          ],
        },
      },
    });
  });
  await page.goto(`/app/e2e-harness?signedIn=1&binder=${alpha}`);

  // The filter is one toolbar menu ("Show pockets"); data-value carries the current filter.
  const filter = pocketFilter(page);
  const shown = () =>
    page
      .locator('[data-slot-id]')
      .evaluateAll((nodes) =>
        nodes
          .map((n) => n.getAttribute('aria-label'))
          .filter((label) => label && !/Free slot|Empty spacer/.test(label)),
      );
  await expect(page.getByRole('button', { name: 'Charizard, Owned', exact: true })).toBeVisible();
  await expect(filter).toHaveAttribute('data-value', 'all');

  const h = new Harness(page, insets, true);
  await h.expectNoHorizontalOverflow();
  await h.expectWithinSafeViewport(filter);
  await h.expectMinTapTarget(filter);
  await h.expectHittable(filter);

  await choosePockets(page, 'owned');
  await expect(filter).toHaveAttribute('data-value', 'owned');
  await expect.poll(shown).toEqual(['Charizard, Owned', 'Blastoise, Owned']);
  await page.screenshot({ path: info.outputPath(`binder-filter-owned-${info.project.name}.png`) });
  await choosePockets(page, 'wanted');
  await expect.poll(shown).toEqual(['Venusaur, Unfilled target']);
  await choosePockets(page, 'needed');
  await expect.poll(shown).toEqual(['Venusaur, Unfilled target', 'Bulbasaur, Unfilled target']);
  await h.expectNoHorizontalOverflow();
  await choosePockets(page, 'all');
  await expect
    .poll(shown)
    .toEqual(['Charizard, Owned', 'Blastoise, Owned', 'Venusaur, Unfilled target', 'Bulbasaur, Unfilled target']);

  // A filter belongs to the binder it was set on.
  await choosePockets(page, 'owned');
  await chooseCollection(page, beta);
  await expect(page.getByRole('button', { name: 'Pikachu, Unfilled target', exact: true })).toBeVisible();
  await expect(filter).toHaveAttribute('data-value', 'all');
});
