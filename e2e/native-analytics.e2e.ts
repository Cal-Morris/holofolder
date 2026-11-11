import { test, expect, mockBackends, emulateStandalone, E2E_USER, Harness } from './fixtures';
import {
  inventoryProjectionFixture,
  inventoryProjectionCatalog,
  inventoryProjectionPrices,
  inventoryBrowseLayouts,
} from '../tests/fixtures/inventory-browse';

const alpha = '22222222-2222-4222-8222-222222222222';
const trades = '33333333-3333-4333-8333-333333333333';
const storageId = (id: string) => (id === 'alpha' ? alpha : trades);
// Synthetic transport and price evidence, actual current-session BinderApp/dashboard/Analytics consumers.
function snapshot() {
  const s = inventoryProjectionFixture();
  s.binders[0].slots[9].target = { kind: 'pokemon', pokemonId: 143 };
  const slotIds = new Map(
    s.binders.flatMap((b, i) =>
      b.slots.map((slot, n) => [slot.id, `44444444-4444-4444-8444-${String(i * 100 + n).padStart(12, '0')}`]),
    ),
  );
  s.ownerUserId = E2E_USER.id;
  s.items.forEach((i) => {
    i.ownerUserId = E2E_USER.id;
  });
  s.collections.forEach((c) => {
    c.ownerUserId = E2E_USER.id;
    c.id = storageId(c.id);
  });
  s.binders.forEach((b) => {
    b.ownerUserId = E2E_USER.id;
    b.collectionId = storageId(b.collectionId);
    b.slots.forEach((slot) => {
      slot.ownerUserId = E2E_USER.id;
      slot.collectionId = b.collectionId;
      slot.id = slotIds.get(slot.id)!;
    });
  });
  s.placements.forEach((p) => {
    p.collectionId = storageId(p.collectionId);
    p.slotId = slotIds.get(p.slotId)!;
  });
  return s;
}
test.beforeEach(async ({ page, context, standalone, insets, baseURL }) => {
  if (standalone) await emulateStandalone(page, insets);
  await mockBackends(page, context, { signedIn: true, baseURL });
  await page.route('**/app/e2e-harness/storage/inventory?*', async (route) => {
    const url = new URL(route.request().url()),
      s = snapshot();
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
        snapshot: s,
        navigation: {
          catalog: inventoryProjectionCatalog,
          layouts: inventoryBrowseLayouts.map((l) => ({ ...l, collectionId: storageId(l.collectionId) })),
        },
        evidence: {
          inventoryRevision: s.inventoryRevision,
          items: s.items.length,
          placements: s.placements.length,
          collections: s.collections.length,
          binders: s.binders.length,
          slots: 24,
          storage: s.binders.map((b) => ({
            collectionId: b.collectionId,
            collectionVersion: 1,
            layoutRevision: b.layoutRevision,
            slotCount: b.slots.length,
          })),
        },
      },
    });
  });
  await page.route('**/api/card-prices?*', async (route) => {
    expect(route.request().method()).toBe('GET');
    const prices = inventoryProjectionPrices().map((p) => ({
      ...p,
      confidence: 'high',
      updatedAt: new Date().toISOString(),
      finishPrices: p.finishPrices!.map((f) => ({ ...f, confidence: 'high', updatedAt: new Date().toISOString() })),
    }));
    await route.fulfill({ json: { prices } });
  });
});
const entry = `/app/e2e-harness?signedIn=1&browserHost=1&binder=${alpha}`;
test('actual dashboard badge and analytics distinguish copies, species, slots and current targets, including cached offline evidence', async ({
  page,
  context,
  insets,
}) => {
  await page.goto(entry);
  // Totals live in Analytics (header More), not above the binder.
  await expect(page.getByRole('region', { name: 'Storage dashboard' })).toHaveCount(0);
  const more = page
    .getByRole('navigation', { name: 'Binder navigation' })
    .getByRole('button', { name: 'More', exact: true });
  const h = new Harness(page, insets, true);
  await h.expectMinTapTarget(more);
  await h.expectHittable(more);
  await more.click();
  await page.getByRole('menuitem', { name: 'Analytics', exact: true }).click();
  const analytics = page.getByRole('region', { name: 'Collection analytics', exact: true });
  await expect(analytics).toContainText('Saved raw value: £10.00');
  await expect(analytics).toContainText('1 / 2 current targets complete · 2 explicit wants');
  await expect(analytics).toContainText('1 physical copy · 1 known species · 12 actual slots');
  await page.getByRole('combobox', { name: 'Analytics storage scope' }).selectOption('all');
  await expect(analytics).toContainText('6 physical copies · 1 known species · 24 actual slots');
  await expect(analytics).toContainText('Saved raw value: £25.00');
  await expect(analytics).toContainText('4 priced · 1 raw unpriced · 1 graded value unknown');
  await expect(analytics.getByText('Synthetic Snorlax', { exact: true })).toHaveCount(3);
  await expect(analytics).toContainText('Unassigned');
  await expect(analytics).toContainText('Partial estimate');
  await expect(analytics).toContainText('Trades: No current targets');
  await expect(analytics.getByText(/1025/)).toHaveCount(0);
  await context.setOffline(true);
  await expect(analytics).toContainText('Cached only');
  await expect(analytics).toContainText('Saved raw value: £25.00');
  await expect(analytics).toContainText('Last saved:');
  await h.expectNoHorizontalOverflow();
  await page.screenshot({ path: test.info().outputPath('analytics.png') });
  await page.getByRole('combobox', { name: 'Analytics storage scope' }).selectOption('selected');
  await expect(analytics).toContainText('Saved raw value: £10.00');
  await context.setOffline(false);
});
test('weak saved prices remain unknown and never produce a zero or graded value', async ({ page, insets }) => {
  await page.route('**/api/card-prices?*', (route) => route.fulfill({ json: { prices: inventoryProjectionPrices() } }));
  await page.goto(entry);
  await page
    .getByRole('navigation', { name: 'Binder navigation' })
    .getByRole('button', { name: 'More', exact: true })
    .click();
  await page.getByRole('menuitem', { name: 'Analytics', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Collection analytics', exact: true })).toContainText(
    'Saved raw value: Unknown',
  );
  await page.getByRole('combobox', { name: 'Analytics storage scope' }).selectOption('all');
  const analytics = page.getByRole('region', { name: 'Collection analytics', exact: true });
  await expect(analytics).toContainText('0 priced · 5 raw unpriced · 1 graded value unknown');
  await expect(analytics.getByText(/£0.00/)).toHaveCount(0);
  await expect(analytics.getByText(/low confidence/)).toHaveCount(5);
  await new Harness(page, insets, true).expectNoHorizontalOverflow();
});
test("the binder shows its total and the open page's total from saved confident prices, and Prices labels pockets", async ({
  page,
  insets,
}) => {
  await page.goto(entry);
  const value = page.getByRole('region', { name: 'Binder value', exact: true });
  // This fixture binder holds one Pokémon-only copy, which has no price: shown as unpriced, never £0. Sums are unit-tested.
  await expect(value).toContainText(/Binder (£\d|Unknown)/);
  await expect(value).toContainText(/\d+ of \d+ cards priced/);
  await expect(value.getByTestId('binder-page-total')).toContainText(/^Page 1: (£\d|no cards)/);
  const prices = value.getByRole('button', { name: 'Prices', exact: true });
  const h = new Harness(page, insets, true);
  for (const target of [prices, value.getByRole('button', { name: 'Hide binder value', exact: true })]) {
    await h.expectMinTapTarget(target, 44);
    await h.expectHittable(target);
  }
  await h.expectWithinSafeViewport(value);
  await h.expectNoHorizontalOverflow();
  await prices.click();
  await expect(prices).toHaveAttribute('aria-pressed', 'true');
});
test('weak saved prices leave the binder and page totals unknown, never £0', async ({ page }) => {
  await page.route('**/api/card-prices?*', (route) => route.fulfill({ json: { prices: inventoryProjectionPrices() } }));
  await page.goto(entry);
  const value = page.getByRole('region', { name: 'Binder value', exact: true });
  await expect(value).toContainText('Binder Unknown');
  await expect(value.getByText(/£0\.00/)).toHaveCount(0);
});
