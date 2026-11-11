import { test, expect, mockBackends, emulateStandalone, Harness, E2E_USER } from './fixtures';
import type { Page } from '@playwright/test';
import type { SlotOfflineRecord } from '../lib/collection/slot-offline-queue';

const entry = '/app/e2e-harness?signedIn=1&browserHost=1&view=inventory';
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Edit copy grading' });
async function record(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((yes, no) => {
      const r = ((q) => (
        (q.onupgradeneeded = () => {
          if (!q.result.objectStoreNames.contains('records')) q.result.createObjectStore('records');
        }),
        q
      ))(indexedDB.open('binderdex-offline', 1));
      r.onsuccess = () => yes(r.result);
      r.onerror = () => no(r.error);
    });
    const rows = await new Promise<unknown[]>((yes, no) => {
      const r = db.transaction('records').objectStore('records').getAll();
      r.onsuccess = () => yes(r.result);
      r.onerror = () => no(r.error);
    });
    db.close();
    return rows.find((v) => !!v && typeof v === 'object' && 'pending' in v) ?? null;
  }) as Promise<SlotOfflineRecord | null>;
}
async function open(page: Page, n = 0) {
  await page.locator(`[data-item-id="synthetic-grading-${n}"]`).click();
  await page
    .getByRole('dialog', { name: 'Owned copy details' })
    .getByRole('button', { name: 'Edit grading', exact: true })
    .click();
  await expect(dialog(page)).toBeVisible();
}
const pending = (page: Page) => page.getByRole('status').filter({ hasText: 'Saved on device · Pending sync.' });
test.beforeEach(async ({ page, context, standalone, insets, baseURL }) => {
  if (standalone) await emulateStandalone(page, insets);
  await mockBackends(page, context, { signedIn: true, baseURL });
  await context.addCookies([{ name: 'hf-storage-fixture', value: `grading-${crypto.randomUUID()}`, url: baseURL! }]);
});

test('actual private copy edit closes at device acceptance, ACK needs matching receipt and fresh read', async ({
  page,
}) => {
  let release!: () => void, started!: () => void;
  const barrier = new Promise<void>((yes) => {
      release = yes;
    }),
    sending = new Promise<void>((yes) => {
      started = yes;
    });
  const bodies: unknown[] = [];
  await page.route('**/app/e2e-harness/storage/inventory', async (route) => {
    bodies.push(route.request().postDataJSON());
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    started();
    await barrier;
    await route.fulfill({ response });
  });
  await page.goto(entry);
  await open(page);
  const before = (await record(page))!.snapshot!;
  await expect(dialog(page).getByLabel('Certificate number')).toHaveValue('00001234');
  await expect(dialog(page).getByRole('link', { name: 'View on PSA' })).toHaveAttribute(
    'referrerpolicy',
    'no-referrer',
  );
  await dialog(page).getByLabel('Recorded grade', { exact: true }).fill('9.5');
  await dialog(page).getByRole('button', { name: 'Save on device', exact: true }).click();
  await sending;
  await expect(dialog(page)).not.toBeVisible();
  await expect(pending(page)).toBeVisible();
  expect((await record(page))!.receipts).toHaveLength(0);
  // Even a matching success cannot ACK until a fresh complete read succeeds.
  let readFailed!: () => void;
  const failedRead = new Promise<void>((yes) => {
    readFailed = yes;
  });
  await page.route('**/app/e2e-harness/storage/inventory?*', async (route) => {
    readFailed();
    await route.abort('failed');
  });
  release();
  await failedRead;
  await expect.poll(async () => (await record(page))?.pending[0]?.status).toBe('unavailable');
  expect((await record(page))!.receipts).toHaveLength(0);
  await page.unroute('**/app/e2e-harness/storage/inventory?*');
  await page.getByRole('button', { name: 'Retry pending sync' }).click();
  await expect.poll(async () => (await record(page))?.receipts.length).toBe(1);
  const saved = (await record(page))!;
  expect(saved.pending).toHaveLength(0);
  await expect(pending(page)).not.toBeVisible();
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toEqual(bodies[0]);
  expect(saved.receipts[0].outcome).toBe('acknowledged');
  const after = saved.snapshot!;
  expect(after.items[0]).toEqual({
    ...before.items[0],
    version: 3,
    grading: { ...before.items[0].grading!, grade: '9.5' },
  });
  expect(after.items.slice(1)).toEqual(before.items.slice(1));
  expect(after.placements).toEqual(before.placements);
  expect(after.binders).toEqual(before.binders);
  await page.reload();
  await open(page);
  await expect(dialog(page).getByLabel('Recorded grade', { exact: true })).toHaveValue('9.5');
  await expect(dialog(page).getByLabel('Certificate number')).toHaveValue('00001234');
});

test('IDB abort retries the same allocated draft and lost remote reply replays identical bytes', async ({ page }) => {
  const bodies: unknown[] = [];
  await page.route('**/app/e2e-harness/storage/inventory', async (route) => {
    bodies.push(route.request().postDataJSON());
    const response = await route.fetch();
    if (bodies.length === 1) await route.abort('failed');
    else await route.fulfill({ response });
  });
  await page.goto(entry);
  await open(page, 1);
  await dialog(page).getByLabel('Recorded grade', { exact: true }).fill('Authentic / vintage');
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    const drafts: unknown[] = [];
    Object.assign(window, { syntheticGradingDrafts: drafts });
    IDBObjectStore.prototype.put = function (value, key) {
      if (value?.pending?.[0]?.intent?.kind === 'inventory') {
        drafts.push(structuredClone(value.pending[0].intent));
        if (drafts.length === 1) {
          this.transaction.abort();
          throw new Error('Synthetic IDB abort');
        }
      }
      return put.call(this, value, key!);
    };
  });
  await dialog(page).getByRole('button', { name: 'Save on device', exact: true }).click();
  await expect(dialog(page).getByRole('alert')).toContainText('Synthetic IDB abort');
  expect((await record(page))!.pending).toHaveLength(0);
  expect(bodies).toHaveLength(0);
  await expect(dialog(page).getByLabel('Recorded grade', { exact: true })).toBeDisabled();
  await dialog(page).getByRole('button', { name: 'Retry saving on device', exact: true }).click();
  await expect(dialog(page)).not.toBeVisible();
  await expect.poll(async () => (await record(page))?.pending[0]?.status).toBe('unavailable');
  await expect(pending(page)).toBeVisible();
  const original = (await record(page))!.pending[0].intent;
  expect(
    await page.evaluate(() => {
      const drafts = (window as unknown as { syntheticGradingDrafts: unknown[] }).syntheticGradingDrafts;
      return JSON.stringify(drafts[0]) === JSON.stringify(drafts[1]);
    }),
  ).toBe(true);
  await page.reload();
  await expect.poll(async () => (await record(page))?.receipts.length).toBe(1);
  expect(bodies).toEqual([original.request, original.request]);
  expect((await record(page))!.snapshot!.items[1].version).toBe(3);
});

test('offline device acceptance is pending, reconnect syncs; cached startup stays read-only', async ({
  page,
  context,
}) => {
  let sends = 0;
  await page.route('**/app/e2e-harness/storage/inventory', async (route) => {
    sends++;
    await route.continue();
  });
  await page.goto(entry);
  await open(page, 2);
  await dialog(page).getByLabel('Grading status').selectOption('graded');
  await dialog(page).getByRole('combobox', { name: 'Provider', exact: true }).selectOption('custom');
  await dialog(page).getByLabel('Custom provider name').fill('Synthetic custom grader');
  await dialog(page).getByLabel('Recorded grade', { exact: true }).fill('Authentic');
  await dialog(page).getByLabel('Certificate number').fill('000-CUSTOM.07');
  await context.setOffline(true);
  await dialog(page).getByRole('button', { name: 'Save on device', exact: true }).click();
  await expect(dialog(page)).not.toBeVisible();
  await expect(pending(page)).toBeVisible();
  expect(sends).toBe(0);
  expect((await record(page))!.pending).toHaveLength(1);
  await context.setOffline(false);
  await expect.poll(async () => (await record(page))?.receipts.length).toBe(1);
  expect(sends).toBe(1);
  const saved = (await record(page))!.snapshot!.items[2];
  expect(saved.grading!.provider).toEqual({ kind: 'custom', name: 'Synthetic custom grader' });
  expect(saved.grading!.certificate).toBe('000-CUSTOM.07');
  await page.route('**/app/e2e-harness/storage/inventory?*', (route) => route.abort('failed'));
  await page.reload();
  await expect(page.getByRole('status').filter({ hasText: 'Cached only' })).toBeVisible();
  await page.locator('[data-item-id="synthetic-grading-2"]').click();
  await expect(page.getByRole('button', { name: 'Edit grading', exact: true })).not.toBeVisible();
});

for (const change of ['signout', 'account', 'owner'] as const)
  test(`${change} teardown retains accepted command and blocks late private ACK`, async ({ page }) => {
    let release!: () => void, started!: () => void;
    const barrier = new Promise<void>((yes) => {
        release = yes;
      }),
      sending = new Promise<void>((yes) => {
        started = yes;
      });
    await page.route('**/app/e2e-harness/storage/inventory', async (route) => {
      const response = await route.fetch();
      started();
      await barrier;
      await route.fulfill({ response }).catch(() => {});
    });
    await page.goto(entry);
    await open(page);
    await dialog(page).getByLabel('Recorded grade', { exact: true }).fill('8.5');
    await dialog(page).getByRole('button', { name: 'Save on device', exact: true }).click();
    await sending;
    const original = (await record(page))!.pending[0].intent;
    if (change === 'owner')
      await page.route('**/rest/v1/partnerships*', (route) =>
        route.fulfill({
          json: [
            {
              id: 'synthetic-membership',
              owner_user_id: '33333333-3333-4333-8333-333333333333',
              user1_id: E2E_USER.id,
              user2_id: '33333333-3333-4333-8333-333333333333',
            },
          ],
        }),
      );
    await page.evaluate(
      ({ change, user }) => {
        const channel = new BroadcastChannel('sb-127-auth-token');
        channel.postMessage(
          change === 'signout'
            ? { event: 'SIGNED_OUT', session: null }
            : {
                event: change === 'account' ? 'SIGNED_IN' : 'TOKEN_REFRESHED',
                session: {
                  user: change === 'account' ? { ...user, id: '55555555-5555-4555-8555-555555555555' } : user,
                },
              },
        );
        channel.close();
      },
      { change, user: E2E_USER },
    );
    await expect(page.getByRole('list', { name: 'Owned copies' })).not.toBeVisible();
    await expect(dialog(page)).not.toBeVisible();
    release();
    expect((await record(page))!.pending[0].intent).toEqual(original);
    expect((await record(page))!.pending[0].status).toBe('sending');
    expect((await record(page))!.receipts).toHaveLength(0);
  });

test('confirmed grading rejection stays reviewable, current-state cancellation retains remote private fields', async ({
  page,
}) => {
  let concurrent = false;
  await page.route('**/app/e2e-harness/storage/inventory', async (route) => {
    const body = route.request().postDataJSON();
    if (!concurrent) {
      concurrent = true;
      const operationId = 'synthetic-concurrent-grading';
      const response = await route.fetch({
        headers: { ...route.request().headers(), 'x-storage-operation': operationId },
        postData: JSON.stringify({
          ...body,
          operationId,
          commands: [{ ...body.commands[0], grading: { ...body.commands[0].grading, grade: '7.5' } }],
        }),
      });
      expect(response.status()).toBe(200);
    }
    await route.continue();
  });
  await page.goto(entry);
  await open(page);
  await dialog(page).getByLabel('Recorded grade', { exact: true }).fill('8.5');
  await dialog(page).getByRole('button', { name: 'Save on device', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Use current storage', exact: true })).toBeVisible();
  expect((await record(page))!.pending[0].conflict!.rejected).toBe(true);
  expect((await record(page))!.receipts).toHaveLength(0);
  await page.getByRole('button', { name: 'Use current storage', exact: true }).click();
  await expect.poll(async () => (await record(page))?.receipts[0]?.outcome).toBe('cancelled');
  await open(page);
  await expect(dialog(page).getByLabel('Recorded grade', { exact: true })).toHaveValue('7.5');
  expect((await record(page))!.snapshot!.items[0].grading!.label.assetIds).toEqual(['synthetic-private-label-0']);
});

test('real host overlay dismissals keep unsent drafts out of IDB and fit all phones', async ({ page, insets }) => {
  await page.goto(entry);
  const h = new Harness(page, insets, true);
  await expect(page.getByRole('list', { name: 'Owned copies' })).toBeVisible();
  const before = (await record(page))!.snapshot!;
  for (const method of ['close', 'escape', 'back', 'backdrop', 'swipe', 'dock'] as const) {
    await open(page);
    await dialog(page).getByLabel('Recorded grade', { exact: true }).fill('SyntheticLongGrade'.repeat(20));
    await h.expectWithinSafeViewport(dialog(page));
    await h.expectNoHorizontalOverflow();
    const close = dialog(page).getByRole('button', { name: 'Close grading editor' });
    await h.expectMinTapTarget(close);
    await h.expectHittable(close);
    await h.expectWithinSafeViewport(dialog(page).getByRole('button', { name: 'Save on device', exact: true }));
    await h.expectMinTapTarget(dialog(page).getByRole('button', { name: 'Save on device', exact: true }));
    const panel = (await dialog(page).boundingBox())!,
      dock = (await h.dock().boundingBox())!;
    expect(panel.y + panel.height).toBeLessThanOrEqual(dock.y);
    if (method === 'close') await close.click();
    if (method === 'escape') await page.keyboard.press('Escape');
    if (method === 'back') await page.goBack();
    if (method === 'backdrop') await h.tapBackdrop(dialog(page));
    if (method === 'swipe') await h.swipeDown(dialog(page));
    if (method === 'dock') await h.dock().getByRole('button', { name: 'Wanted', exact: true }).click();
    await expect(dialog(page)).not.toBeVisible();
    await h.expectScrollUnlocked();
    if (method !== 'dock') await expect(page.locator('[data-item-id="synthetic-grading-0"]')).toBeFocused();
    expect((await record(page))!.pending).toHaveLength(0);
    expect((await record(page))!.snapshot).toEqual(before);
    if (method === 'dock') await h.dock().getByRole('button', { name: 'Inventory', exact: true }).click();
  }
  await page.evaluate(() => document.documentElement.classList.toggle('dark'));
  await open(page);
  await h.expectNoHorizontalOverflow();
  await h.expectWithinSafeViewport(dialog(page));
  await dialog(page).getByLabel('Grading status').selectOption('raw');
  await dialog(page).getByRole('button', { name: 'Save on device', exact: true }).click();
  await expect.poll(async () => (await record(page))?.receipts.length).toBe(1);
  const after = (await record(page))!.snapshot!;
  expect(after.items[0]).toEqual({ ...before.items[0], grading: null, version: 3 });
  expect(after.items.slice(1)).toEqual(before.items.slice(1));
  expect(after.placements).toEqual(before.placements);
});

test('scope teardown before local acceptance reply retains committed work without closing a new scope', async ({
  page,
}) => {
  await page.goto(entry);
  await open(page);
  await dialog(page).getByLabel('Recorded grade', { exact: true }).fill('8');
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (value?.pending?.[0]?.intent?.kind === 'inventory') {
        const complete = this.transaction.oncomplete;
        this.transaction.oncomplete = function (event) {
          Object.assign(window, { syntheticReleaseAcceptance: () => complete?.call(this, event) });
        };
      }
      return put.call(this, value, key!);
    };
  });
  await dialog(page).getByRole('button', { name: 'Save on device', exact: true }).click();
  await expect.poll(async () => (await record(page))?.pending.length).toBe(1);
  await expect(dialog(page).getByRole('button', { name: 'Saving…', exact: true })).toBeDisabled();
  const original = (await record(page))!.pending[0].intent;
  await page.evaluate(() => {
    const channel = new BroadcastChannel('sb-127-auth-token');
    channel.postMessage({ event: 'SIGNED_OUT', session: null });
    channel.close();
  });
  await expect(dialog(page)).not.toBeVisible();
  await page.evaluate(() =>
    (window as unknown as { syntheticReleaseAcceptance: () => void }).syntheticReleaseAcceptance(),
  );
  expect((await record(page))!.pending[0].intent).toEqual(original);
  expect((await record(page))!.receipts).toHaveLength(0);
  await expect(page.getByRole('list', { name: 'Owned copies' })).not.toBeVisible();
});

test("current partner edits the selected owner's private copy through trusted HTTP scope", async ({
  page,
  context,
  baseURL,
}) => {
  const owner = '11111111-1111-4111-8111-111111111111';
  await context.addCookies([
    { name: 'hf-storage-fixture', value: `grading-partner-${crypto.randomUUID()}`, url: baseURL! },
  ]);
  await page.route('**/rest/v1/partnerships*', (route) =>
    route.fulfill({
      json: [{ id: 'synthetic-grading-partnership', owner_user_id: owner, user1_id: owner, user2_id: E2E_USER.id }],
    }),
  );
  let sentOwner: string | undefined;
  await page.route('**/app/e2e-harness/storage/inventory', async (route) => {
    sentOwner = route.request().headers()['x-binder-owner'];
    await route.continue();
  });
  await page.goto(entry);
  await open(page, 1);
  await expect(dialog(page).getByLabel('Certificate number')).toHaveValue('000-ACE.12');
  await dialog(page).getByLabel('Recorded grade', { exact: true }).fill('9');
  await dialog(page).getByRole('button', { name: 'Save on device', exact: true }).click();
  await expect.poll(async () => (await record(page))?.receipts.length).toBe(1);
  const saved = (await record(page))!;
  expect(saved.scope.accountId).toBe(E2E_USER.id);
  expect(saved.scope.ownerUserId).toBe(owner);
  expect(sentOwner).toBe(owner);
  expect(saved.snapshot!.items[1].ownerUserId).toBe(owner);
  expect(saved.snapshot!.items[1].grading!.label.assetIds).toEqual(['synthetic-private-label-1']);
});

test('retained Activity recovery blocks a new grading editor in the shared host', async ({ page }) => {
  await page.goto(entry);
  await expect(page.getByRole('list', { name: 'Owned copies' })).toBeVisible();
  // Synthetic retained recovery in the canonical record, not a second queue or a remote receipt.
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((yes, no) => {
      const r = ((q) => (
        (q.onupgradeneeded = () => {
          if (!q.result.objectStoreNames.contains('records')) q.result.createObjectStore('records');
        }),
        q
      ))(indexedDB.open('binderdex-offline', 1));
      r.onsuccess = () => yes(r.result);
      r.onerror = () => no(r.error);
    });
    await new Promise<void>((yes, no) => {
      const tx = db.transaction('records', 'readwrite'),
        store = tx.objectStore('records'),
        keys = store.getAllKeys();
      tx.oncomplete = () => yes();
      tx.onabort = tx.onerror = () => no(tx.error);
      keys.onsuccess = () => {
        const key = keys.result.find((k) => String(k).startsWith('slot-intent:v1:'))!;
        const get = store.get(key);
        get.onsuccess = () => {
          const record = get.result;
          record.recovery = [
            {
              intent: {
                operation: 'recovery.apply',
                request: {
                  eventId: '101',
                  restoreUnassignedItemIds: [],
                  planVersion: 1,
                  planToken: 'a'.repeat(64),
                  operationId: 'synthetic-grading-recovery',
                  confirmed: true,
                },
                context: { source: 'app', clientId: record.scope.deviceId, clientOccurredAt: '2026-01-01T00:00:00Z' },
              },
              receipt: null,
              synchronized: false,
              lease: null,
            },
          ];
          store.put(record, key);
        };
      };
    });
    db.close();
    const channel = new BroadcastChannel('binderdex-slot-intent-v1');
    channel.postMessage('changed');
    channel.close();
  });
  await expect(page.getByRole('status').filter({ hasText: 'Recovery saved on this device' })).toBeVisible();
  await page.locator('[data-item-id="synthetic-grading-0"]').click();
  await expect(page.getByRole('dialog', { name: 'Owned copy details' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit grading', exact: true })).not.toBeVisible();
  expect((await record(page))!.pending).toHaveLength(0);
});
