import { test, expect, mockBackends, emulateStandalone, SUPABASE_URL } from './fixtures';
import type { Page, Route } from '@playwright/test';
import type { SlotOfflineRecord } from '../lib/collection/slot-offline-queue';

// Synthetic ledger and session only. The real browser session, IDB queue, sender and storage handlers run.
const collection = '22222222-2222-4222-8222-222222222222';
const entry = `/app/e2e-harness?signedIn=1&browserHost=1&binder=${collection}`;
const pockets = (page: Page) => page.locator('[data-binder-page] button[data-slot-id]');
const order = (page: Page) => pockets(page).evaluateAll((els) => els.map((el) => el.getAttribute('data-slot-id')));
const editing = (page: Page) =>
  page.getByRole('region', { name: 'Layout editing', exact: true }).getByRole('button', { name: 'Done', exact: true });

async function record(page: Page): Promise<SlotOfflineRecord | undefined> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((yes, no) => {
      const r = indexedDB.open('binderdex-offline', 1);
      r.onupgradeneeded = () => {
        if (!r.result.objectStoreNames.contains('records')) r.result.createObjectStore('records');
      };
      r.onsuccess = () => yes(r.result);
      r.onerror = () => no(r.error);
    });
    const rows = await new Promise<unknown[]>((yes, no) => {
      const r = db.transaction('records').objectStore('records').getAll();
      r.onsuccess = () => yes(r.result);
      r.onerror = () => no(r.error);
    });
    db.close();
    return rows.find((r) => !!r && typeof r === 'object' && 'pending' in r) as SlotOfflineRecord | undefined;
  });
}
const pending = async (page: Page) => (await record(page))?.pending.length;

async function drag(page: Page, from: number, to: number) {
  const a = (await pockets(page).nth(from).boundingBox())!;
  const b = (await pockets(page).nth(to).boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 });
  await page.mouse.up();
}
/** A quick drop onto another pocket swaps the two (lib/pocket-drop.ts). */
const moved = (ids: (string | null)[], from: number, to: number) => {
  const next = [...ids];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
};
/** Storage writes get no answer, as on Wi-Fi with no internet behind it. */
const writes = (route: Route) => (route.request().method() === 'GET' ? route.fallback() : route.abort());
const everything = (route: Route) => route.abort();

test.beforeEach(async ({ page, context, standalone, insets, baseURL }) => {
  if (standalone) await emulateStandalone(page, insets);
  await mockBackends(page, context, { signedIn: true, baseURL });
  await context.addCookies([{ name: 'hf-storage-fixture', value: `sync-${crypto.randomUUID()}`, url: baseURL! }]);
});

test('a reload on dead Wi-Fi keeps the binder and its queued edit, and sends it once the connection is back', async ({
  page,
}) => {
  await page.clock.install();
  await page.goto(entry);
  await expect.poll(() => record(page).then((r) => r?.snapshot?.binders.length ?? 0)).toBeGreaterThan(0);
  await expect(pockets(page).first()).toBeVisible();
  const start = await order(page);
  await page.route('**/app/e2e-harness/storage/*', writes);
  await drag(page, 0, 2);
  await expect.poll(() => order(page)).toEqual(moved(start, 0, 2));
  await expect.poll(() => pending(page)).toBe(1);

  // navigator.onLine stays true; the account check, reads and writes all fail.
  await page.route(`${SUPABASE_URL}/**`, everything);
  await page.route('**/app/e2e-harness/storage/**', everything);
  await page.reload();
  // Well past the 45s startup timer and several quiet retries.
  for (let i = 0; i < 4; i++) await page.clock.fastForward(30_000);
  await expect(page.getByText(/Clearing offline data|Could not open storage|Could not check your/)).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem('holofolder-startup-reset-v2'))).toBeNull();
  expect(await pending(page), 'the queued edit survives').toBe(1);

  await page.unroute(`${SUPABASE_URL}/**`, everything);
  await page.unroute('**/app/e2e-harness/storage/**', everything);
  await page.unroute('**/app/e2e-harness/storage/*', writes);
  // Nothing to tap: the quiet retries open the binder and send the edit.
  await expect
    .poll(
      async () => {
        await page.clock.fastForward(5_000);
        return pending(page);
      },
      { timeout: 30_000 },
    )
    .toBe(0);
  await expect.poll(() => order(page)).toEqual(moved(start, 0, 2));
  await expect(page.getByText(/changed somewhere else|wasn.t applied/)).toHaveCount(0);
});

test('reads that fail mid-edit keep layout editing open and every drop syncs by itself', async ({ page }) => {
  await page.goto(entry);
  await expect.poll(() => record(page).then((r) => r?.snapshot?.binders.length ?? 0)).toBeGreaterThan(0);
  await expect(pockets(page).first()).toBeVisible();
  const start = await order(page);
  // Every read fails for a while: the follow-up read after each save and the focus refreshes.
  let failing = true,
    failed = 0;
  await page.route('**/app/e2e-harness/storage/inventory?*', (route) => {
    if (!failing) return route.fallback();
    failed++;
    return route.fulfill({ status: 503, json: { error: 'synthetic_outage' } });
  });
  await drag(page, 0, 2);
  await expect(editing(page)).toBeVisible();
  await expect.poll(() => order(page)).toEqual(moved(start, 0, 2));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => failed).toBeGreaterThan(0);
  await drag(page, 3, 0);
  const expected = moved(moved(start, 0, 2), 3, 0);
  await expect.poll(() => order(page)).toEqual(expected);
  await expect(editing(page), 'a failed read does not end editing').toBeVisible();
  await expect(page.getByText(/Couldn.t (sync|update) just now/)).toHaveCount(0);
  failing = false;
  await expect.poll(() => pending(page), { timeout: 30_000 }).toBe(0);
  await expect(editing(page)).toBeVisible();
  expect(await order(page)).toEqual(expected);
  const saved = (await record(page))!.snapshot!.binders.find((b) => b.collectionId === collection)!;
  expect(saved.slots.map((s) => s.id).slice(0, 4)).toEqual(expected.slice(0, 4));
});

test('a send interrupted on its last try is picked up again without a tap', async ({ page, baseURL }) => {
  await page.clock.install();
  await page.goto(entry);
  await expect.poll(() => record(page).then((r) => r?.snapshot?.binders.length ?? 0)).toBeGreaterThan(0);
  await expect(pockets(page).first()).toBeVisible();
  const start = await order(page);
  await page.route('**/app/e2e-harness/storage/*', writes);
  await drag(page, 0, 2);
  await expect.poll(() => record(page).then((r) => r?.pending[0]?.status)).toBe('unavailable');
  // Leave the app, then leave the edit as a fifth send cut off mid-flight: still 'sending', its lease run out.
  await page.goto(`${baseURL}/app/e2e-harness/storage/seed`);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((yes) => {
      const r = indexedDB.open('binderdex-offline', 1);
      r.onsuccess = () => yes(r.result);
    });
    const store = db.transaction('records', 'readwrite').objectStore('records');
    const keys = await new Promise<IDBValidKey[]>((yes) => {
      const r = store.getAllKeys();
      r.onsuccess = () => yes(r.result);
    });
    for (const key of keys) {
      const value = await new Promise<{ pending?: Record<string, unknown>[] }>((yes) => {
        const r = store.get(key);
        r.onsuccess = () => yes(r.result);
      });
      if (value?.pending?.[0]) {
        Object.assign(value.pending[0], {
          status: 'sending',
          attempts: 5,
          lease: { id: crypto.randomUUID(), until: Date.now() - 1 },
        });
        store.put(value, key);
      }
    }
    await new Promise((done) => (store.transaction.oncomplete = done));
    db.close();
  });
  expect((await record(page))?.pending[0]).toMatchObject({ status: 'sending', attempts: 5 });
  await page.unroute('**/app/e2e-harness/storage/*', writes);
  await page.goto(entry);
  // Past the 60s lease and the retry pause.
  await expect
    .poll(
      async () => {
        await page.clock.fastForward(30_000);
        return pending(page);
      },
      { timeout: 30_000 },
    )
    .toBe(0);
  await expect.poll(() => order(page)).toEqual(moved(start, 0, 2));
});
