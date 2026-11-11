import { test, expect, mockBackends, emulateStandalone, Harness, E2E_USER } from './fixtures';
import {
  inventoryBrowseFixture,
  inventoryBrowseCatalog,
  inventoryBrowseLayouts,
} from '../tests/fixtures/inventory-browse';

const alpha = '22222222-2222-4222-8222-222222222222';
const trades = '33333333-3333-4333-8333-333333333333';
const id = (value: string) => (value === 'alpha' ? alpha : trades);

// Synthetic remote evidence; the native consumer host, stage and pointer events are real.
test.beforeEach(async ({ page, standalone, insets, baseURL }) => {
  if (standalone) await emulateStandalone(page, insets);
  await mockBackends(page, page.context(), { signedIn: true, baseURL });
});

async function mockInventory(page: import('@playwright/test').Page, size: number) {
  await page.route('**/app/e2e-harness/storage/inventory?*', async (route) => {
    const snapshot = inventoryBrowseFixture(5),
      url = new URL(route.request().url());
    snapshot.ownerUserId = E2E_USER.id;
    snapshot.items.forEach((i) => {
      i.ownerUserId = E2E_USER.id;
    });
    snapshot.collections.forEach((c) => {
      c.ownerUserId = E2E_USER.id;
      c.id = id(c.id);
    });
    snapshot.binders.forEach((b) => {
      b.ownerUserId = E2E_USER.id;
      b.collectionId = id(b.collectionId);
      b.slots.forEach((s) => {
        s.ownerUserId = E2E_USER.id;
        s.collectionId = b.collectionId;
      });
    });
    if (size > 3) {
      const binder = snapshot.binders[0];
      binder.slots = Array.from(
        { length: size * size },
        (_, n) => binder.slots[n] ?? { ...binder.slots[0], id: `alpha-empty-${n}` },
      );
    }
    snapshot.placements.forEach((p) => {
      p.collectionId = id(p.collectionId);
    });
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
          catalog: inventoryBrowseCatalog,
          layouts: inventoryBrowseLayouts.map((l) => ({
            ...l,
            collectionId: id(l.collectionId),
            ...(l.collectionId === 'alpha' ? { rows: size, cols: size } : {}),
          })),
        },
        evidence: {
          inventoryRevision: 1,
          items: snapshot.items.length,
          placements: snapshot.placements.length,
          collections: snapshot.collections.length,
          binders: snapshot.binders.length,
          slots: snapshot.binders.reduce((n, b) => n + b.slots.length, 0),
          storage: snapshot.binders.map((b) => ({
            collectionId: b.collectionId,
            collectionVersion: 1,
            layoutRevision: 1,
            slotCount: b.slots.length,
          })),
        },
      },
    });
  });
}

async function geometry(page: import('@playwright/test').Page) {
  return page.locator('[data-binder-page]').evaluate((binderPage) => {
    const grid = binderPage.querySelector('button[data-slot-id]')!.parentElement!;
    const rect = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    return {
      grid: rect(grid),
      stage: rect(binderPage.parentElement!.parentElement!.parentElement!),
      slots: Array.from(grid.querySelectorAll('button[data-slot-id]'), (el) => ({
        id: el.getAttribute('data-slot-id'),
        ...rect(el),
      })),
    };
  });
}

for (const size of [3, 4, 8])
  test(`native ${size}x${size} grid keeps real Browse and Edit pointer targets separate`, async ({
    page,
    insets,
  }, info) => {
    await mockInventory(page, size);
    await page.goto(`/app/e2e-harness?signedIn=1&browserHost=1&binder=${alpha}`);
    const h = new Harness(page, insets, true);
    const slot = (id: string) => page.locator(`button[data-slot-id="${id}"]`);
    const first = slot('alpha-empty-0');
    const toolbar = page.getByRole('region', { name: 'Layout editing', exact: true });
    const dialog = page.getByRole('dialog', { name: /details$/ });
    await expect(toolbar.getByRole('button', { name: 'Edit layout', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Storage dashboard', exact: true })).toHaveCount(0);
    await first.click();
    await expect(dialog).toHaveAttribute('data-slot-id', 'alpha-empty-0');
    await expect(first).toHaveAttribute('aria-pressed', 'true');
    await expect(dialog.getByRole('button', { name: 'Move earlier', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Close slot details', exact: true }).click();
    if (size > 3) {
      await slot('slot-0').click();
      await expect(dialog).toHaveAttribute('data-slot-id', 'slot-0');
      await expect(dialog).toContainText('Copy: copy-00001');
      await page.getByRole('button', { name: 'Close slot details', exact: true }).click();
    }
    const browse = await geometry(page);
    await toolbar.getByRole('button', { name: 'Edit layout', exact: true }).click();
    // Ordinary pointer clicks must reach the saved slot in both modes.
    await first.click();
    await expect(dialog).toHaveAttribute('data-slot-id', 'alpha-empty-0');
    await expect(dialog).toContainText(`Slot 1 of ${size === 3 ? 12 : size * size}`);
    await expect(first).toHaveAttribute('aria-pressed', 'true');
    await expect(slot('alpha-empty-1')).toHaveAttribute('aria-pressed', 'false');
    await h.expectWithinSafeViewport(dialog);
    const dock = page.getByRole('navigation', { name: 'Main navigation', exact: true });
    expect((await dialog.boundingBox())!.y + (await dialog.boundingBox())!.height).toBeLessThanOrEqual(
      (await dock.boundingBox())!.y,
    );
    await page.getByRole('button', { name: 'Close slot details', exact: true }).click();
    const edit = await geometry(page);
    const expectedIds = Array.from({ length: size * size }, (_, n) => (n === 9 ? 'slot-0' : `alpha-empty-${n}`));
    expect(browse.slots.map((s) => s.id)).toEqual(expectedIds);
    expect(edit.slots.map((s) => s.id)).toEqual(expectedIds);
    // Every pocket (owned, target or free) carries its row-major A1 coordinate.
    const coordinates = await page
      .locator('[data-binder-page] button[data-slot-id]')
      .evaluateAll((nodes) =>
        nodes.map((n) => n.ownerDocument.getElementById(n.getAttribute('aria-describedby') ?? '')?.textContent),
      );
    expect(coordinates).toEqual(
      expectedIds.map((_, n) => `${String.fromCharCode(65 + Math.floor(n / size))}${(n % size) + 1}`),
    );
    if (size > 3) await expect(slot('slot-0')).toHaveAccessibleDescription(size === 4 ? 'C2' : 'B2');
    for (const state of [browse, edit]) {
      for (const [i, box] of state.slots.entries()) {
        expect(box.width).toBeGreaterThanOrEqual(36);
        expect(box.height).toBeGreaterThanOrEqual(36);
        expect(box.x).toBeGreaterThanOrEqual(state.grid.x);
        expect(box.y).toBeGreaterThanOrEqual(state.grid.y);
        expect(box.x + box.width).toBeLessThanOrEqual(state.grid.x + state.grid.width + 1);
        expect(box.y + box.height).toBeLessThanOrEqual(state.grid.y + state.grid.height + 1);
        for (const other of state.slots.slice(i + 1)) {
          expect(
            box.x + box.width <= other.x + 0.1 ||
              other.x + other.width <= box.x + 0.1 ||
              box.y + box.height <= other.y + 0.1 ||
              other.y + other.height <= box.y + 0.1,
          ).toBe(true);
        }
      }
    }
    const lastId = `alpha-empty-${size * size - 1}`;
    const last = slot(lastId);
    await last.scrollIntoViewIfNeeded();
    await h.expectWithinSafeViewport(last);
    await h.expectHittable(last);
    expect((await last.boundingBox())!.y + (await last.boundingBox())!.height).toBeLessThanOrEqual(
      (await dock.boundingBox())!.y,
    );
    await last.click();
    await expect(dialog).toHaveAttribute('data-slot-id', lastId);
    await expect(dialog).toContainText(`Slot ${size * size} of`);
    await expect(last).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Close slot details', exact: true }).click();
    await toolbar.getByRole('button', { name: 'Select several pockets', exact: true }).click();
    await toolbar.getByRole('button', { name: 'Select slot 1', exact: true }).click();
    await toolbar.getByRole('button', { name: 'Select slot 2', exact: true }).click();
    await expect(toolbar.getByRole('button', { name: 'Select slot 1', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(toolbar.getByRole('button', { name: 'Select slot 2', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await toolbar.getByRole('button', { name: 'Back to single slot', exact: true }).click();
    await toolbar.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(toolbar.getByRole('button', { name: 'Edit layout', exact: true })).toBeVisible();
    await h.expectNoHorizontalOverflow();
    for (const name of ['Binder', 'Inventory']) {
      const button = dock.getByRole('button', { name, exact: true });
      await h.expectMinTapTarget(button);
      await h.expectWithinSafeViewport(button);
      await h.expectHittable(button);
    }
    const summary = (state: Awaited<ReturnType<typeof geometry>>) => ({
      grid: state.grid,
      stage: state.stage,
      minimumSlot: {
        width: Math.min(...state.slots.map((s) => s.width)),
        height: Math.min(...state.slots.map((s) => s.height)),
      },
    });
    console.log(
      'native grid geometry',
      info.project.name,
      size,
      JSON.stringify({ browse: summary(browse), edit: summary(edit) }),
    );
  });
