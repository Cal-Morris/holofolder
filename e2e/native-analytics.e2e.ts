import type { Page } from '@playwright/test';
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
const openAnalytics = async (page: Page) => {
  await page
    .getByRole('navigation', { name: 'Binder navigation' })
    .getByRole('button', { name: 'More', exact: true })
    .click();
  await page.getByRole('menuitem', { name: 'Analytics', exact: true }).click();
  return page.getByRole('region', { name: 'Collection analytics', exact: true });
};
test(
  'analytics dashboard shows value, insights and every copy, including cached offline evidence',
  { tag: '@matrix' },
  async ({ page, context, insets }) => {
    await page.goto(entry);
    // Totals live in Analytics (header More), not above the binder.
    await expect(page.getByRole('region', { name: 'Storage dashboard' })).toHaveCount(0);
    const more = page
      .getByRole('navigation', { name: 'Binder navigation' })
      .getByRole('button', { name: 'More', exact: true });
    const h = new Harness(page, insets, true);
    await h.expectMinTapTarget(more);
    await h.expectHittable(more);
    const analytics = await openAnalytics(page);
    const value = analytics.getByRole('region', { name: 'Collection value' });
    await expect(value).toContainText('£10.00');
    await page.getByRole('combobox', { name: 'Analytics storage scope' }).selectOption('all');
    await expect(value).toContainText('£25.00');
    await expect(value).toContainText('4 of 6 cards priced');
    await expect(value).toContainText('1 graded not valued');
    for (const name of [
      'Most valuable',
      'Where the value is',
      'Rising in your collection',
      'Falling in your collection',
      'Progress',
      'Price confidence',
      'Your cards',
    ])
      await expect(analytics.getByRole('region', { name, exact: true })).toBeVisible();
    const cards = analytics.getByRole('region', { name: 'Your cards', exact: true });
    await expect(cards.getByText('Synthetic Snorlax', { exact: true })).toHaveCount(3);
    await expect(cards).toContainText('Not in a binder');
    await expect(analytics.getByText(/1025/)).toHaveCount(0);
    await h.expectNoHorizontalOverflow();
    await page.screenshot({ path: test.info().outputPath('analytics.png'), fullPage: true });
    await context.setOffline(true);
    await expect(value).toContainText('£25.00');
    await h.expectNoHorizontalOverflow();
    await page.getByRole('combobox', { name: 'Analytics storage scope' }).selectOption('selected');
    await expect(value).toContainText('£10.00');
    await context.setOffline(false);
  },
);
test('weak saved prices remain unknown and never produce a zero or graded value', async ({ page, insets }) => {
  await page.route('**/api/card-prices?*', (route) => route.fulfill({ json: { prices: inventoryProjectionPrices() } }));
  await page.goto(entry);
  const analytics = await openAnalytics(page);
  const value = analytics.getByRole('region', { name: 'Collection value' });
  await page.getByRole('combobox', { name: 'Analytics storage scope' }).selectOption('all');
  await expect(value).toContainText('of 6 cards priced');
  await expect(analytics.getByText(/£0\.00/)).toHaveCount(0);
  // Weak prices never become rising or falling signals.
  await expect(analytics.getByRole('region', { name: 'Rising in your collection' })).toContainText('Nothing rising');
  await new Harness(page, insets, true).expectNoHorizontalOverflow();
  await page.screenshot({ path: test.info().outputPath('analytics-weak.png'), fullPage: true });
});
test('the toolbar Show prices toggle labels pockets without a value banner, and an unpriced page never shows £0', async ({
  page,
  insets,
}) => {
  await page.goto(entry);
  const toggle = page.getByRole('button', { name: 'Show prices', exact: true });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('region', { name: 'Binder value', exact: true })).toHaveCount(0);
  const h = new Harness(page, insets, true);
  await h.expectMinTapTarget(toggle, 36);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  // This fixture binder holds one Pokémon-only copy, which has no price: the page label stays "Page 1", never £0.
  await expect(page.getByText(/£0\.00/)).toHaveCount(0);
  await h.expectNoHorizontalOverflow();
});
