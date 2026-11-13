import { test, expect, mockBackends, emulateStandalone } from './fixtures';
import type { Page } from '@playwright/test';
// Real BrowserCollectionSession, IDB queue and HTTP storage bridge over a synthetic ledger (tests/fixtures/storage-command-harness.ts).
const collection = '22222222-2222-4222-8222-222222222222';
const entry = `/app/e2e-harness?signedIn=1&browserHost=1&binder=${collection}`;
async function record(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((yes, no) => {
      const r = indexedDB.open('binderdex-offline');
      r.onsuccess = () => yes(r.result);
      r.onerror = () => no(r.error);
    });
    const rows = await new Promise<unknown[]>((yes, no) => {
      const r = db.transaction('records').objectStore('records').getAll();
      r.onsuccess = () => yes(r.result);
      r.onerror = () => no(r.error);
    });
    db.close();
    return (
      rows.find(
        (r): r is { pending: { status: string; conflict: unknown }[]; receipts: { outcome: string }[] } =>
          !!r && typeof r === 'object' && 'pending' in r,
      ) ?? null
    );
  });
}
test.beforeEach(async ({ page, context, standalone, insets, baseURL }) => {
  if (standalone) await emulateStandalone(page, insets);
  await mockBackends(page, context, { signedIn: true, baseURL });
  await context.addCookies([{ name: 'hf-storage-fixture', value: `owned-${crypto.randomUUID()}`, url: baseURL! }]);
});
test("an owned pocket opens the card's details, with no slot or draft form", async ({ page }) => {
  await page.goto(entry);
  await page.locator('[data-slot-id="synthetic-slot-0"]').click();
  const dialog = page.getByRole('dialog', { name: /details$/ });
  await expect(dialog.getByRole('heading', { name: 'Synthetic Owned Bulbasaur' })).toBeVisible();
  await expect(
    dialog.getByText(/Edit slot|Change target|Remove target|Unassigned|Pending sync|Saved on device/),
  ).toHaveCount(0);
  await expect(dialog.locator('[data-slot-picker]')).toHaveCount(0);
});

test('Take out of this pocket saves through the durable queue, syncs and keeps the card', async ({ page }) => {
  await page.goto(entry);
  await page.locator('[data-slot-id="synthetic-slot-0"]').click();
  const dialog = page.getByRole('dialog', { name: /details$/ });
  await expect(dialog).toContainText('Synthetic Owned Bulbasaur');
  await dialog.getByRole('button', { name: 'More card options' }).click();
  await dialog.getByRole('menuitem', { name: /Take out of this pocket/ }).click();
  await expect.poll(async () => (await record(page))?.receipts.length, { timeout: 15_000 }).toBe(1);
  expect((await record(page))!.receipts[0].outcome).toBe('acknowledged');
  // It finishes on the binder: no leftover sheet and no status line once the server has confirmed.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('[data-sync-state]')).toHaveCount(0);
  await expect(page.getByText(/Pending sync|Saved on device/)).toHaveCount(0);
});

test('Remove from collection confirms first, then removes that exact card through the durable queue', async ({
  page,
}) => {
  const bodies: string[] = [];
  await page.route('**/app/e2e-harness/storage/inventory', async (route) => {
    if (route.request().method() === 'POST') bodies.push(route.request().postData() ?? '');
    await route.continue();
  });
  await page.goto(entry);
  await page.locator('[data-slot-id="synthetic-slot-0"]').click();
  const dialog = page.getByRole('dialog', { name: /details$/ });
  await dialog.getByRole('button', { name: 'More card options' }).click();
  await dialog.getByRole('menuitem', { name: /Remove from collection/ }).click();
  const confirm = dialog.getByRole('region', { name: 'Remove card' });
  await expect(confirm).toContainText('Remove Synthetic Owned Bulbasaur from your collection?');
  expect((await record(page))?.pending ?? []).toHaveLength(0);
  // Keep it changes nothing.
  await confirm.getByRole('button', { name: 'Keep it' }).click();
  await expect(confirm).toHaveCount(0);
  expect(bodies).toHaveLength(0);
  await dialog.getByRole('button', { name: 'More card options' }).click();
  await dialog.getByRole('menuitem', { name: /Remove from collection/ }).click();
  await dialog.getByRole('region', { name: 'Remove card' }).getByRole('button', { name: 'Remove card' }).click();
  await expect.poll(async () => (await record(page))?.receipts.length, { timeout: 15_000 }).toBe(1);
  expect((await record(page))!.receipts[0].outcome).toBe('acknowledged');
  // One request, and it is the owned-copy removal rather than taking the card out of its pocket.
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toContain('removeOwned');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('an owned-pocket action during a routine focus refresh waits for it and saves', async ({ page }) => {
  let hold = false,
    release!: () => void;
  const gate = new Promise<void>((yes) => {
    release = yes;
  });
  await page.route('**/app/e2e-harness/storage/inventory?*', async (route) => {
    if (hold) await gate;
    await route.continue();
  });
  await page.goto(entry);
  await page.locator('[data-slot-id="synthetic-slot-0"]').click();
  const dialog = page.getByRole('dialog', { name: /details$/ });
  await expect(dialog).toContainText('Synthetic Owned Bulbasaur');
  hold = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await dialog.getByRole('button', { name: 'More card options' }).click();
  await dialog.getByRole('menuitem', { name: /Take out of this pocket/ }).click();
  // Before the fix this failed at once (inactive-or-unavailable-session) and blamed device storage.
  await page.waitForTimeout(500);
  expect((await record(page))?.receipts ?? []).toHaveLength(0);
  release();
  await expect.poll(async () => (await record(page))?.receipts.length, { timeout: 15_000 }).toBe(1);
  expect((await record(page))!.receipts[0].outcome).toBe('acknowledged');
  // (Next keeps one empty route announcer alert at the top of the page; only the app's own alerts count.)
  await expect(page.locator('main [role="alert"], [role="dialog"] [role="alert"]')).toHaveCount(0);
});

test('the finish switch corrects the owned copy in place and keeps its details open', async ({ page }) => {
  // Synthetic catalog row for the harness copy: printed in Holo and Reverse.
  await page.route('**/app/api/tcgdex-cache**', (route) =>
    route.fulfill({
      json: {
        source: 'mirror',
        cards: [
          {
            id: 'synthetic-owned-bulbasaur',
            localId: '1',
            name: 'Synthetic Owned Bulbasaur',
            set: { id: 'synthetic', name: 'Synthetic set' },
            rarity: 'Rare Holo',
            variants: { holo: true, reverse: true },
          },
        ],
      },
    }),
  );
  await page.goto(entry);
  await page.locator('[data-slot-id="synthetic-slot-0"]').click();
  const dialog = page.getByRole('dialog', { name: /details$/ });
  const finish = dialog.getByRole('group', { name: 'Finish' });
  await expect(finish.getByRole('button', { name: 'Holo' })).toHaveAttribute('aria-pressed', 'true');
  await finish.getByRole('button', { name: 'Reverse' }).click();
  await expect.poll(async () => (await record(page))?.receipts.length, { timeout: 15_000 }).toBe(1);
  expect((await record(page))!.receipts[0].outcome).toBe('acknowledged');
  await expect(dialog).toBeVisible();
  await expect(finish.getByRole('button', { name: 'Reverse' })).toHaveAttribute('aria-pressed', 'true');
  const box = await finish.getByRole('button', { name: 'Reverse' }).boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(36);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('a second finish switch queues behind one still syncing instead of failing', async ({ page }) => {
  await page.route('**/app/api/tcgdex-cache**', (route) =>
    route.fulfill({
      json: {
        source: 'mirror',
        cards: [
          {
            id: 'synthetic-owned-bulbasaur',
            localId: '1',
            name: 'Synthetic Owned Bulbasaur',
            set: { id: 'synthetic', name: 'Synthetic set' },
            rarity: 'Rare Holo',
            variants: { holo: true, reverse: true },
          },
        ],
      },
    }),
  );
  // Hold the first save on the server so the second tap lands while it is still syncing.
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  let first = true;
  await page.route('**/app/e2e-harness/storage/inventory', async (route) => {
    if (route.request().method() === 'POST' && first) {
      first = false;
      await held;
    }
    await route.fallback();
  });
  await page.goto(entry);
  await page.locator('[data-slot-id="synthetic-slot-0"]').click();
  const dialog = page.getByRole('dialog', { name: /details$/ });
  const finish = dialog.getByRole('group', { name: 'Finish' });
  await finish.getByRole('button', { name: 'Reverse' }).click();
  await expect(finish.getByRole('button', { name: 'Reverse' })).toHaveAttribute('aria-pressed', 'true');
  await finish.getByRole('button', { name: 'Holo' }).click();
  await expect(finish.getByRole('button', { name: 'Holo' })).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  release();
  await expect.poll(async () => (await record(page))?.receipts.length, { timeout: 15_000 }).toBe(2);
  expect((await record(page))!.receipts.map((r) => r.outcome)).toEqual(['acknowledged', 'acknowledged']);
  await expect(finish.getByRole('button', { name: 'Holo' })).toHaveAttribute('aria-pressed', 'true');
});

test('an edit made while the background read is failing still saves instead of saying the collection is syncing', async ({
  page,
}) => {
  await page.route('**/app/api/tcgdex-cache**', (route) =>
    route.fulfill({
      json: {
        source: 'mirror',
        cards: [
          {
            id: 'synthetic-owned-bulbasaur',
            localId: '1',
            name: 'Synthetic Owned Bulbasaur',
            set: { id: 'synthetic', name: 'Synthetic set' },
            rarity: 'Rare Holo',
            variants: { holo: true, reverse: true },
          },
        ],
      },
    }),
  );
  await page.goto(entry);
  await page.locator('[data-slot-id="synthetic-slot-0"]').click();
  const dialog = page.getByRole('dialog', { name: /details$/ });
  const finish = dialog.getByRole('group', { name: 'Finish' });
  await expect(finish.getByRole('button', { name: 'Holo' })).toBeVisible();
  // Every read now fails slowly, and coming back to the app starts one, like returning from a notification.
  let failReads = true;
  await page.route('**/app/e2e-harness/storage/inventory**', async (route) => {
    if (failReads && route.request().method() === 'GET') {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return route.abort();
    }
    await route.fallback();
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await finish.getByRole('button', { name: 'Reverse' }).click();
  await expect(finish.getByRole('button', { name: 'Reverse' })).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  failReads = false;
  await expect.poll(async () => (await record(page))?.receipts.length, { timeout: 15_000 }).toBe(1);
  expect((await record(page))!.receipts[0].outcome).toBe('acknowledged');
});

test('All cards from an owned pocket opens another printing with its want controls, and closing returns to the grid', async ({
  page,
}) => {
  await page.goto(entry);
  await page.locator('[data-slot-id="synthetic-slot-0"]').click();
  const detail = page.getByRole('dialog', { name: /details$/ });
  await detail.getByRole('button', { name: /^All .* cards$/ }).click();
  const all = page.getByRole('dialog', { name: /^All Bulbasaur cards$/ });
  const printing = all.getByRole('button', { name: /^Open Bulbasaur, 151 166\/165$/ });
  await printing.click();
  const card = page
    .getByRole('dialog', { name: /^All Bulbasaur cards$/ })
    .filter({ has: page.getByRole('region', { name: 'On your want list' }) });
  await expect(card).toHaveCount(1);
  await expect(detail).toHaveCount(0);
  // The printing can be wanted from here: it goes on the Bulbasaur pocket and can be taken off again.
  await card.getByRole('button', { name: 'Add to want list' }).click();
  await expect(card.getByRole('button', { name: 'Remove from want list' })).toBeVisible();
  await expect(card.getByRole('region', { name: 'On your want list' })).toContainText('1 card');
  await card.getByRole('button', { name: 'Remove from want list' }).click();
  await expect(card.getByRole('button', { name: 'Add to want list' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: 'On your want list' })).toHaveCount(0);
  await expect(printing).toBeVisible();
});
