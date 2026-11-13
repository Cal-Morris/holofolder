import { test, expect, mockBackends, emulateStandalone, Harness, E2E_USER } from './fixtures';
import type { Page } from '@playwright/test';
const collection = '22222222-2222-4222-8222-222222222222';
const entry = `/app/e2e-harness?signedIn=1&browserHost=1&binder=${collection}`;
const dialog = (p: Page) => p.getByRole('dialog', { name: 'Fill pockets', exact: true });
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
    return rows.find(
      (
        r,
      ): r is {
        pending: { status: string; intent: { request: { operationId: string; commands: unknown[] } } }[];
        receipts: { outcome: string; intent?: unknown }[];
      } => !!r && typeof r === 'object' && 'pending' in r,
    );
  });
}
/** Layout editing: tap the first page's four pockets (two Snorlax pockets, one free, one holding a trainer), then Fill. */
async function open(page: Page) {
  await page.getByRole('button', { name: 'Edit layout', exact: true }).click();
  const snorlax = page.getByRole('button', { name: 'Snorlax, Unfilled target', exact: true });
  await snorlax.nth(0).click();
  await snorlax.nth(1).click();
  await page.getByRole('button', { name: 'Free slot, Empty spacer', exact: true }).first().click();
  await page.getByRole('button', { name: /, Owned$/ }).click();
  await page.getByRole('button', { name: 'Fill', exact: true }).click();
  await expect(dialog(page)).toBeVisible();
}
const card = (p: Page, n: number) => p.getByRole('combobox', { name: `Card for Page 1 · Pocket ${n}`, exact: true });
const add = (p: Page) => dialog(p).getByRole('button', { name: /^Add \d+ cards?$/ });
async function automatic(page: Page) {
  await dialog(page).getByRole('button', { name: 'Match my spare cards', exact: true }).click();
  await card(page, 3).selectOption('synthetic-copy-energy');
  await expect(add(page)).toHaveText('Add 3 cards');
}
test.beforeEach(async ({ page, context, standalone, insets, baseURL }) => {
  if (standalone) await emulateStandalone(page, insets);
  await mockBackends(page, context, { signedIn: true, baseURL });
  // Synthetic catalog, owner/partner authority and RPC ledger only. Real host, IDB and HTTP bridge.
  await context.addCookies([{ name: 'hf-storage-fixture', value: `fill-${crypto.randomUUID()}`, url: baseURL! }]);
});
test('mixed targets/free/occupied and distinct duplicates confirm one HTTP batch, fresh complete read ACK', async ({
  page,
  insets,
}) => {
  const bodies: {
    commands: {
      kind: string;
      occupied: string;
      selection: { inventoryItemId: string };
      destination: { slot: { id: string } };
    }[];
  }[] = [];
  let after = false,
    reads = 0;
  await page.route('**/app/e2e-harness/storage/inventory', async (route) => {
    bodies.push(route.request().postDataJSON());
    const response = await route.fetch();
    after = true;
    await route.fulfill({ response });
  });
  await page.route('**/app/e2e-harness/storage/inventory?*', async (route) => {
    if (after) reads++;
    await route.continue();
  });
  await page.goto(entry);
  await open(page);
  await automatic(page);
  await expect(dialog(page)).toContainText('1 selected pocket already has a card and stays as it is.');
  const h = new Harness(page, insets, true);
  await h.expectWithinSafeViewport(dialog(page));
  await h.expectNoHorizontalOverflow();
  for (const b of [
    add(page),
    ...['Cancel', 'Close'].map((name) => dialog(page).getByRole('button', { name, exact: true })),
  ]) {
    await h.expectMinTapTarget(b, 36);
    await h.expectHittable(b);
  }
  await add(page).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect.poll(async () => (await record(page))?.receipts.length).toBe(1);
  expect(bodies).toHaveLength(1);
  expect(reads).toBeGreaterThan(0);
  expect(bodies[0].commands.map((c) => c.kind)).toEqual(['assign', 'assign', 'assign']);
  expect(bodies[0].commands.map((c) => c.destination.slot.id)).toEqual([
    'synthetic-slot-0',
    'synthetic-slot-1',
    'synthetic-slot-2',
  ]);
  expect(new Set(bodies[0].commands.map((c) => c.selection.inventoryItemId)).size).toBe(3);
  expect(bodies[0].commands.every((c) => c.occupied === 'cancel')).toBe(true);
  expect((await record(page))?.pending).toHaveLength(0);
  await page.reload();
  await expect(page.locator('[data-slot-id="synthetic-slot-3"]')).toContainText('Synthetic trainer');
});
test('manual mismatch and duplicate refusal block confirmation, cancellation never writes', async ({ page }) => {
  let sends = 0;
  await page.route('**/app/e2e-harness/storage/inventory', (route) => {
    sends++;
    return route.continue();
  });
  await page.goto(entry);
  await open(page);
  // Copies already in a pocket are never offered, so only spare copies can be chosen.
  await expect(card(page, 1).getByRole('option', { name: /Synthetic trainer/ })).toHaveCount(0);
  await card(page, 1).selectOption('synthetic-copy-energy');
  await expect(dialog(page)).toContainText("This card doesn't match what the pocket is for.");
  await expect(dialog(page).getByRole('button', { name: /^Add|^Choose a card$/ })).toBeDisabled();
  await card(page, 1).selectOption('synthetic-copy-snorlax');
  await card(page, 2).selectOption('synthetic-copy-snorlax');
  await expect(dialog(page).getByText('This card is already chosen for another pocket.')).toHaveCount(2);
  await expect(dialog(page).getByRole('button', { name: /^Add|^Choose a card$/ })).toBeDisabled();
  await dialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  expect(sends).toBe(0);
  expect((await record(page))?.pending ?? []).toHaveLength(0);
});
test('IDB commit abort retains exact confirmed IDs and versions for retry', async ({ page }) => {
  let sent = '';
  await page.route('**/app/e2e-harness/storage/inventory', async (route) => {
    sent = route.request().postData()!;
    await route.continue();
  });
  await page.goto(entry);
  await open(page);
  await automatic(page);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    let aborted = false;
    IDBObjectStore.prototype.put = function (value, key) {
      const request = key === undefined ? put.call(this, value) : put.call(this, value, key);
      if (value?.pending?.[0]?.intent && !aborted) {
        aborted = true;
        sessionStorage.setItem('aborted-fill', JSON.stringify(value.pending[0].intent));
        this.transaction.abort();
      }
      return request;
    };
  });
  await add(page).click();
  const retry = dialog(page).getByRole('button', { name: 'Try again', exact: true });
  await expect(retry).toBeVisible();
  expect(sent).toBe('');
  expect((await record(page))?.pending).toHaveLength(0);
  const original = await page.evaluate(() => JSON.parse(sessionStorage.getItem('aborted-fill')!));
  await retry.click();
  await expect.poll(async () => (await record(page))?.receipts.length).toBe(1);
  expect(JSON.parse(sent)).toEqual(original.request);
  expect((await record(page))?.receipts[0]?.intent).toEqual(original);
});
test('lost reply survives reload, exact retry has no cancel/rebase for unknown outcome', async ({ page }) => {
  const requests: string[] = [];
  await page.route('**/app/e2e-harness/storage/inventory', async (route) => {
    requests.push(route.request().postData()!);
    const response = await route.fetch();
    if (requests.length === 1) await route.abort('failed');
    else await route.fulfill({ response });
  });
  await page.goto(entry);
  await open(page);
  await automatic(page);
  await add(page).click();
  await expect.poll(async () => (await record(page))?.pending[0]?.status).toBe('unavailable');
  await page.reload();
  await expect.poll(async () => (await record(page))?.receipts.length).toBe(1);
  expect(requests).toHaveLength(2);
  expect(requests[0]).toBe(requests[1]);
});
test('accepted receipt without fresh complete read stays pending until a later complete ACK', async ({ page }) => {
  let sent = false,
    failRead = true;
  await page.route('**/app/e2e-harness/storage/inventory', async (route) => {
    const response = await route.fetch();
    sent = true;
    await route.fulfill({ response });
  });
  await page.route('**/app/e2e-harness/storage/inventory?*', (route) =>
    sent && failRead ? route.abort('failed') : route.continue(),
  );
  await page.goto(entry);
  await open(page);
  await automatic(page);
  await add(page).click();
  await expect.poll(async () => (await record(page))?.pending[0]?.status).toBe('acknowledged');
  expect((await record(page))?.receipts).toHaveLength(0);
  failRead = false;
  await page.reload();
  await expect.poll(async () => (await record(page))?.receipts.length).toBe(1);
});
test('stale partner revision is an atomic terminal rejection that retains the whole fill', async ({ page }) => {
  await page.route('**/app/e2e-harness/storage/inventory', async (route) => {
    const body = route.request().postDataJSON(),
      operationId = 'synthetic-concurrent-layout';
    const changed = await route.fetch({
      url: route
        .request()
        .url()
        .replace(/inventory$/, 'slots'),
      headers: { ...route.request().headers(), 'x-storage-operation': operationId },
      postData: JSON.stringify({
        operationId,
        inventoryRevision: body.inventoryRevision,
        collectionId: collection,
        collectionVersion: body.collections[0].version,
        layoutRevision: body.collections[0].layoutRevision,
        commands: [{ kind: 'create', ids: ['synthetic-partner-slot'], beforeSlotId: null }],
      }),
    });
    expect(changed.status()).toBe(200);
    const response = await route.fetch();
    expect(response.status()).toBe(409);
    await route.fulfill({ response });
  });
  await page.goto(entry);
  await open(page);
  await automatic(page);
  await add(page).click();
  await expect.poll(async () => (await record(page))?.pending[0]?.status).toBe('conflict');
  expect((await record(page))?.receipts).toHaveLength(0);
  const retained = (await record(page))!.pending[0].intent;
  expect(retained.request.commands).toHaveLength(3);
  // Kept as sent across a reload: never rebased onto the partner's layout or partly applied.
  await page.reload();
  await expect.poll(async () => (await record(page))?.pending[0]?.status).toBe('conflict');
  expect((await record(page))!.pending[0].intent).toEqual(retained);
  expect((await record(page))?.receipts).toHaveLength(0);
});
for (const change of ['signout', 'account', 'owner'] as const)
  test(`${change} teardown retains an in-flight accepted fill and rejects late reply`, async ({ page }) => {
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
    await automatic(page);
    await add(page).click();
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
        const c = new BroadcastChannel('sb-127-auth-token');
        c.postMessage(
          change === 'signout'
            ? { event: 'SIGNED_OUT', session: null }
            : {
                event: change === 'account' ? 'SIGNED_IN' : 'TOKEN_REFRESHED',
                session: {
                  user: change === 'account' ? { ...user, id: '55555555-5555-4555-8555-555555555555' } : user,
                },
              },
        );
        c.close();
      },
      { change, user: E2E_USER },
    );
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit layout', exact: true })).not.toBeVisible();
    release();
    expect((await record(page))!.pending[0].intent).toEqual(original);
    expect((await record(page))?.receipts).toHaveLength(0);
  });
test('review shared dismissals and offline downgrade never hand off', async ({ page, context, insets }) => {
  await page.goto(entry);
  const h = new Harness(page, insets, true);
  await open(page);
  for (const dismissal of ['close', 'escape', 'back', 'backdrop', 'swipe', 'dock']) {
    if (dismissal !== 'close') await page.getByRole('button', { name: 'Fill', exact: true }).click();
    await expect(dialog(page)).toBeVisible();
    if (dismissal === 'close') await dialog(page).getByRole('button', { name: 'Close', exact: true }).click();
    if (dismissal === 'escape') await page.keyboard.press('Escape');
    if (dismissal === 'back') await page.goBack();
    if (dismissal === 'backdrop') await h.tapBackdrop(dialog(page));
    if (dismissal === 'swipe') await h.swipeDown(dialog(page));
    if (dismissal === 'dock')
      await page
        .getByRole('navigation', { name: 'Main navigation' })
        .getByRole('button', { name: 'Inventory', exact: true })
        .click();
    await expect(dialog(page), dismissal).toHaveCount(0);
    await h.expectScrollUnlocked();
  }
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: 'Binder', exact: true })
    .click();
  await open(page);
  await context.setOffline(true);
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Fill', exact: true })).toHaveCount(0);
  expect((await record(page))?.pending ?? []).toHaveLength(0);
});
test('fresh changed evidence during review blocks confirmation without a request', async ({ page }) => {
  let changed = false,
    sends = 0;
  await page.route('**/app/e2e-harness/storage/inventory?*', async (route) => {
    const response = await route.fetch(),
      body = await response.json();
    if (changed) {
      body.snapshot.inventoryRevision++;
      body.evidence.inventoryRevision++;
      body.snapshot.binders[0].layoutRevision++;
      body.navigation.layouts[0].layoutRevision++;
      body.evidence.storage[0].layoutRevision++;
    }
    await route.fulfill({ response, json: body });
  });
  await page.route('**/app/e2e-harness/storage/inventory', (route) => {
    sends++;
    return route.continue();
  });
  await page.goto(entry);
  await open(page);
  await automatic(page);
  changed = true;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(dialog(page)).toContainText(
    'Your binder changed while this was open. Close this and select the pockets again.',
  );
  await expect(add(page)).toBeDisabled();
  await dialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(sends).toBe(0);
  expect((await record(page))?.pending ?? []).toHaveLength(0);
});
test('unresolved target identity stays blocked and the review fits the phone', async ({ page, insets }) => {
  let sends = 0;
  await page.route('**/app/e2e-harness/storage/inventory?*', async (route) => {
    const response = await route.fetch(),
      body = await response.json();
    body.navigation.catalog = [];
    await route.fulfill({ response, json: body });
  });
  await page.route('**/app/e2e-harness/storage/inventory', (route) => {
    sends++;
    return route.continue();
  });
  await page.goto(entry);
  await open(page);
  await card(page, 1).selectOption('synthetic-copy-snorlax');
  await expect(dialog(page)).toContainText("This card can't be checked against the pocket right now.");
  await expect(dialog(page).getByRole('button', { name: /^Add|^Choose a card$/ })).toBeDisabled();
  const h = new Harness(page, insets, true);
  await h.expectWithinSafeViewport(dialog(page));
  await h.expectNoHorizontalOverflow();
  await dialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(sends).toBe(0);
  expect((await record(page))?.pending ?? []).toHaveLength(0);
});
