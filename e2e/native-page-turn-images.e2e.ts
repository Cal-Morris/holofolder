import { test, expect, mockBackends, emulateStandalone, E2E_USER, placeholderSvg } from './fixtures';
import { inventoryBrowseFixture } from '../tests/fixtures/inventory-browse';
import type { InventoryCatalogEvidence } from '../lib/domain/inventory-browse';

const alpha = '22222222-2222-4222-8222-222222222222';

// Synthetic native binder: owned printings, unfilled Pokémon targets (ids 600+) and dimmed wants. #575
function nativeFixture() {
  const snapshot = inventoryBrowseFixture(0);
  snapshot.ownerUserId = E2E_USER.id;
  snapshot.collections = [{ ...snapshot.collections[0], ownerUserId: E2E_USER.id, id: alpha, name: 'National dex' }];
  const binder = snapshot.binders[0];
  binder.collectionId = alpha;
  binder.ownerUserId = E2E_USER.id;
  const catalog: InventoryCatalogEvidence[] = [];
  snapshot.items = [];
  snapshot.placements = [];
  binder.slots = Array.from({ length: 4 * 9 }, (_, n): (typeof binder.slots)[number] => {
    const target = { kind: 'pokemon' as const, pokemonId: 600 + n };
    const slot = {
      id: `syn-slot-${n}`,
      ownerUserId: E2E_USER.id,
      collectionId: alpha,
      target,
      inventoryItemId: null,
      wantedCards: [],
      status: null,
      version: 1,
      presetOrigin: null,
    };
    if (n % 9 === 4) return slot; // unfilled target: artwork fallback
    if (n % 9 === 7)
      return {
        ...slot,
        status: 'wishlisted',
        wantedCards: [
          {
            card_id: `synw-${n}`,
            card_name: `Synthetic want ${n}`,
            card_image: `https://assets.tcgdex.net/en/syn/synw/${n}/high.webp`,
            added_at: '2026-11-10T00:00:00Z',
          },
        ],
      };
    const itemId = `syn-item-${n}`,
      cardId = `syn-${n}`;
    snapshot.items.push({
      id: itemId,
      ownerUserId: E2E_USER.id,
      identity: { kind: 'card', cardId, language: 'en', finish: 'normal' },
      grading: null,
      acquiredAt: null,
      version: 1,
    });
    snapshot.placements.push({ inventoryItemId: itemId, collectionId: alpha, slotId: slot.id, version: 1 });
    catalog.push({
      card: {
        id: cardId,
        name: `Synthetic ${n}`,
        localId: String(n),
        language: 'en',
        set: { id: 'syns', name: 'Synthetic set' },
        image: `https://assets.tcgdex.net/en/syn/syns/${n}/high.webp`,
      },
      speciesNames: [],
      pokemonIds: [target.pokemonId],
    });
    return { ...slot, inventoryItemId: itemId, status: 'collected' };
  });
  snapshot.binders = [binder];
  return { snapshot, catalog };
}

test('native page turns paint warmed pocket images and skip legacy artwork', async ({
  page,
  context,
  standalone,
  insets,
  baseURL,
}) => {
  if (standalone) await emulateStandalone(page, insets);
  await mockBackends(page, context, { signedIn: true, baseURL });
  const { snapshot, catalog } = nativeFixture();
  const requests: string[] = [];
  const delayed = async (route: import('@playwright/test').Route) => {
    requests.push(decodeURIComponent(route.request().url()));
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({
      headers: { 'Access-Control-Allow-Origin': '*' },
      contentType: 'image/svg+xml',
      body: placeholderSvg('Synthetic', 1),
    });
  };
  await page.route(/^https:\/\/(assets\.tcgdex\.net|assets\.holofolder\.com|raw\.githubusercontent\.com)\//, delayed);
  await page.route('**/app/api/card-image-proxy**', delayed);
  await page.route('**/app/api/inventory?*', async (route) => {
    const url = new URL(route.request().url());
    const slots = snapshot.binders[0].slots.length;
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
        navigation: { catalog, layouts: [{ collectionId: alpha, layoutRevision: 1, rows: 3, cols: 3 }] },
        evidence: {
          inventoryRevision: 1,
          items: snapshot.items.length,
          placements: snapshot.placements.length,
          collections: 1,
          binders: 1,
          slots,
          storage: [{ collectionId: alpha, collectionVersion: 1, layoutRevision: 1, slotCount: slots }],
        },
      },
    });
  });
  await page.goto(`/app/e2e-harness?signedIn=1&binder=${alpha}`);
  await expect(page.getByRole('button', { name: 'Synthetic 0, Owned', exact: true })).toBeVisible();
  // Page 2's pockets (slots 9-17) are prefetched: its owned printings, its want and its target artwork.
  await expect
    .poll(() => requests.filter((url) => /syns\/(9|1[0-7])\/|synw\/16\/|official-artwork\/613\.png/.test(url)).length)
    .toBe(9);
  await page.waitForTimeout(400);
  const turn = (label: string) =>
    page.evaluate(async (label) => {
      (document.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement).click();
      const missing: number[] = [];
      const start = performance.now();
      while (performance.now() - start < 600) {
        const images = Array.from(document.querySelectorAll<HTMLImageElement>('[data-binder-page] img'));
        missing.push(images.filter((image) => !image.complete || !image.naturalWidth).length);
        await new Promise(requestAnimationFrame);
      }
      return { missing, page: document.querySelector('[data-binder-page]')?.getAttribute('data-binder-page') };
    }, label);
  const next = await turn('Next binder page');
  expect(next.page).toBe('2');
  expect(
    next.missing.every((count) => count === 0),
    `unloaded pockets per frame: ${next.missing}`,
  ).toBe(true);
  await expect(page.getByRole('button', { name: 'Synthetic 9, Owned', exact: true }).locator('img')).toHaveAttribute(
    'src',
    /cards\/en\/syns\/9\/high\.webp/,
  );
  const before = requests.length;
  const back = await turn('Previous binder page');
  expect(back.page).toBe('1');
  expect(back.missing.every((count) => count === 0)).toBe(true);
  expect(requests.slice(before), 'returning to a retained page reloads nothing').toEqual([]);
  // Native pockets never fall back to the empty legacy list's dex-order artwork.
  expect(
    requests.filter((url) => {
      const id = url.match(/official-artwork\/(\d+)\.png/)?.[1];
      return id !== undefined && Number(id) < 600;
    }),
  ).toEqual([]);
});
