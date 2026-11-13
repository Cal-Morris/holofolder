import { test, expect, mockBackends, emulateStandalone, Harness, E2E_USER, storageAction } from './fixtures';
import type { Page } from '@playwright/test';
test.use({ actionTimeout: 10000 });
const collection = '22222222-2222-4222-8222-222222222222';
const entry = `/app/e2e-harness?signedIn=1&browserHost=1&binder=${collection}`;
const scope = {
  accountId: E2E_USER.id,
  ownerId: E2E_USER.id,
  membershipKey: JSON.stringify([null, E2E_USER.id]),
  memberIds: [E2E_USER.id],
};
// All event/card/account data is synthetic. Engine is a fixture, not hosted SQL proof.
const event = (id = '101') => ({
  id,
  recorded_at: '2026-11-10T12:00:00Z',
  format_version: 1,
  actor_kind: 'user',
  actor_user_id: E2E_USER.id,
  source: 'app',
  action: 'slots.update',
  affected_entities: { collectionIds: [collection], slotIds: ['synthetic-slot-0'] },
  changes: [
    { table: 'binder_slots', id: 'synthetic-slot-0', before: { status: 'wishlisted' }, after: { status: 'collected' } },
  ],
});
async function stored(page: Page) {
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
        (
          r,
        ): r is {
          recovery: { intent: { request: Record<string, unknown> }; receipt: unknown; synchronized: boolean }[];
        } => !!r && typeof r === 'object' && 'recovery' in r,
      )?.recovery ?? []
    );
  });
}
async function history(page: Page, id = '101') {
  await page.route('**/app/api/collection-activity**', async (route) => {
    const query = new URL(route.request().url()).searchParams;
    if (query.has('scope')) return route.fulfill({ json: { scope } });
    const rows = [event(id)];
    if ((await stored(page)).some((r) => r.receipt))
      rows.unshift({ ...event('201'), action: 'recovery.apply', recovery_of_event_id: id } as ReturnType<typeof event>);
    return route.fulfill({
      json: {
        scope,
        data: query.has('id') ? rows.filter((r) => r.id === query.get('id')) : rows,
        nextCursor: null,
        syncedAt: '2026-11-10T12:01:00Z',
      },
    });
  });
}
async function open(page: Page) {
  await (await storageAction(page, 'Activity')).click();
  const dialog = page.getByRole('dialog', { name: 'Collection Activity', exact: true });
  await expect(dialog.getByRole('button', { name: 'See what undoing does', exact: true }).first()).toBeVisible();
  return dialog;
}
test.beforeEach(async ({ page, context, standalone, insets, baseURL }) => {
  if (standalone) await emulateStandalone(page, insets);
  await mockBackends(page, context, { signedIn: true, baseURL });
  await context.addCookies([{ name: 'hf-storage-fixture', value: crypto.randomUUID(), url: baseURL! }]);
});
test('native event review, exact durable lost-reply retry, post-reply read ACK and linked original', async ({
  page,
  insets,
}) => {
  await history(page);
  const requests: string[] = [];
  let lose = true,
    accepted = false,
    reads = 0;
  await page.route('**/app/e2e-harness/storage/recovery?*', async (route) => {
    const applying = new URL(route.request().url()).searchParams.get('operation') === 'recovery.apply';
    if (applying) requests.push(route.request().postData()!);
    const response = await route.fetch();
    if (applying) {
      accepted = true;
      if (lose) {
        lose = false;
        return route.abort('failed');
      }
    }
    await route.fulfill({ response });
  });
  await page.route('**/app/e2e-harness/storage/inventory?*', async (route) => {
    if (accepted) reads++;
    await route.continue();
  });
  await page.goto(entry);
  let dialog = await open(page);
  const h = new Harness(page, insets, true);
  const close = dialog.getByRole('button', { name: 'Close Activity' });
  await h.expectMinTapTarget(close);
  await h.expectWithinSafeViewport(close);
  await h.expectHittable(close);
  const box = (await dialog.boundingBox())!,
    dock = (await h.dock().boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(dock.y);
  await dialog.getByRole('button', { name: 'See what undoing does', exact: true }).click();
  await expect(dialog.getByRole('region', { name: 'Review recovery' })).toBeVisible();
  const confirm = dialog.getByRole('button', { name: 'Undo this change', exact: true });
  await h.expectMinTapTarget(confirm);
  await h.expectWithinSafeViewport(confirm);
  await h.expectHittable(confirm);
  await confirm.click();
  await expect(dialog.getByText('Undo saved on this device. It has not been confirmed yet.')).toBeVisible();
  await expect(dialog.getByRole('alert')).toBeVisible();
  const original = (await stored(page))[0].intent.request;
  await page.reload();
  dialog = await openSaved(page);
  await dialog.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect.poll(async () => (await stored(page))[0]?.synchronized).toBe(true);
  expect(requests).toEqual([JSON.stringify(original), JSON.stringify(original)]);
  expect(reads).toBeGreaterThan(0);
  await expect(dialog.getByText('Undone. Your collection is up to date.').last()).toBeVisible();
  const selected = page.waitForRequest((r) => r.url().includes('/api/collection-activity?id=101'));
  await dialog.getByRole('button', { name: 'View original' }).click();
  expect([...new URL((await selected).url()).searchParams.keys()]).toEqual(['id']);
  await expect(dialog.getByRole('article')).toHaveCount(1);
  await h.expectNoHorizontalOverflow();
});
async function openSaved(page: Page) {
  await (await storageAction(page, 'Activity')).click();
  const dialog = page.getByRole('dialog', { name: 'Collection Activity', exact: true });
  await expect(dialog.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
  return dialog;
}
for (const id of ['102', '103'])
  test(`unsupported or stale native event ${id} cannot confirm or invoke legacy Undo`, async ({ page }) => {
    await history(page, id);
    await page.goto(entry);
    const dialog = await open(page);
    await dialog.getByRole('button', { name: 'See what undoing does', exact: true }).click();
    await expect(
      dialog.getByTitle(id === '102' ? /private_assets_unverifiable/ : /slot_version_changed/),
    ).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Undo this change', exact: true })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0);
    expect(await stored(page)).toEqual([]);
  });
test('Activity dismisses with close, Escape, backdrop, swipe, browser back and dock switch', async ({
  page,
  insets,
}) => {
  await history(page);
  await page.goto(entry);
  const h = new Harness(page, insets, true);
  let dialog = await open(page);
  await dialog.getByRole('button', { name: 'Close Activity' }).click();
  await expect(dialog).toBeHidden();
  dialog = await open(page);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  dialog = await open(page);
  await h.tapBackdrop(dialog);
  await expect(dialog).toBeHidden();
  dialog = await open(page);
  await h.swipeDown(dialog);
  await expect(dialog).toBeHidden();
  dialog = await open(page);
  await page.goBack();
  await expect(dialog).toBeHidden();
  expect(page.url()).toContain('/e2e-harness');
  dialog = await open(page);
  await h.dock().getByRole('button', { name: 'Search', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.keyboard.press('Escape');
  await h.expectNoHorizontalOverflow();
});
test('accepted receipt survives failed read and reload, verification never reapplies', async ({ page }) => {
  await history(page);
  let applied = 0,
    failRead = false;
  await page.route('**/app/e2e-harness/storage/recovery?*', async (route) => {
    const response = await route.fetch();
    if (new URL(route.request().url()).searchParams.get('operation') === 'recovery.apply') {
      applied++;
      failRead = true;
    }
    await route.fulfill({ response });
  });
  await page.route('**/app/e2e-harness/storage/inventory?*', async (route) => {
    if (failRead) return route.abort('failed');
    await route.continue();
  });
  await page.goto(entry);
  let dialog = await open(page);
  await dialog.getByRole('button', { name: 'See what undoing does', exact: true }).click();
  await dialog.getByRole('button', { name: 'Undo this change', exact: true }).click();
  await expect.poll(async () => !!(await stored(page))[0]?.receipt).toBe(true);
  expect((await stored(page))[0].synchronized).toBe(false);
  failRead = false;
  await page.reload();
  await (await storageAction(page, 'Activity')).click();
  dialog = page.getByRole('dialog', { name: 'Collection Activity', exact: true });
  await dialog.getByRole('button', { name: 'Check my collection', exact: true }).click();
  await expect.poll(async () => (await stored(page))[0]?.synchronized).toBe(true);
  expect(applied).toBe(1);
});
test('unclassified apply 409 retains exact identity through offline display and explicit retry', async ({
  page,
  context,
}) => {
  await history(page);
  const requests: string[] = [];
  let deny = true;
  await page.route('**/app/e2e-harness/storage/recovery?*', async (route) => {
    if (new URL(route.request().url()).searchParams.get('operation') === 'recovery.apply') {
      requests.push(route.request().postData()!);
      if (deny) return route.fulfill({ status: 409, json: { error: { code: 'storage_conflict' } } });
    }
    await route.continue();
  });
  await page.goto(entry);
  const dialog = await open(page);
  await dialog.getByRole('button', { name: 'See what undoing does', exact: true }).click();
  await dialog.getByRole('button', { name: 'Undo this change', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
  expect((await stored(page))[0].synchronized).toBe(false);
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(dialog.getByRole('button', { name: 'Try again', exact: true })).toBeDisabled();
  await expect(dialog.getByText('You need to be online, with your latest changes saved, to undo this.')).toBeVisible();
  await context.setOffline(false);
  deny = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(dialog.getByRole('button', { name: 'Try again', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect.poll(async () => (await stored(page))[0]?.synchronized).toBe(true);
  expect(requests).toHaveLength(2);
  expect(requests[0]).toBe(requests[1]);
});
test('account teardown during apply retains original durable intent and ignores late accepted reply', async ({
  page,
}) => {
  await history(page);
  let release!: () => void, started!: () => void;
  const barrier = new Promise<void>((yes) => {
      release = yes;
    }),
    sending = new Promise<void>((yes) => {
      started = yes;
    });
  await page.route('**/app/e2e-harness/storage/recovery?*', async (route) => {
    const response = await route.fetch();
    if (new URL(route.request().url()).searchParams.get('operation') === 'recovery.apply') {
      started();
      await barrier;
    }
    await route.fulfill({ response }).catch(() => {});
  });
  await page.goto(entry);
  const dialog = await open(page);
  await dialog.getByRole('button', { name: 'See what undoing does', exact: true }).click();
  await dialog.getByRole('button', { name: 'Undo this change', exact: true }).click();
  await sending;
  const original = (await stored(page))[0].intent;
  await page.evaluate(() => {
    const c = new BroadcastChannel('sb-127-auth-token');
    c.postMessage({ event: 'SIGNED_OUT', session: null });
    c.close();
  });
  await expect(dialog).toBeHidden();
  release();
  await expect.poll(async () => (await stored(page))[0]?.synchronized).toBe(false);
  expect((await stored(page))[0].intent).toEqual(original);
});
test('removed copy requires an explicit Unassigned choice included in preview and immutable apply', async ({
  page,
}) => {
  await page.route('**/app/api/collection-activity**', (route) => {
    const q = new URL(route.request().url()).searchParams;
    const removed = {
      ...event('104'),
      action: 'inventory.removeOwned',
      changes: [
        {
          table: 'inventory_items',
          id: 'synthetic-removed-copy',
          before: { identity: { kind: 'card', cardId: 'synthetic-card' } },
          after: null,
        },
      ],
    };
    return route.fulfill({
      json: q.has('scope') ? { scope } : { scope, data: [removed], nextCursor: null, syncedAt: '2026-11-10T12:01:00Z' },
    });
  });
  const inputs: Record<string, unknown>[] = [];
  await page.route('**/app/e2e-harness/storage/recovery?*', async (route) => {
    inputs.push(route.request().postDataJSON());
    await route.continue();
  });
  await page.goto(entry);
  const dialog = await open(page);
  const choice = dialog.getByRole('checkbox', { name: 'Bring back this card' });
  await expect(choice).not.toBeChecked();
  await choice.check();
  await dialog.getByRole('button', { name: 'See what undoing does', exact: true }).click();
  await expect(dialog.getByRole('region', { name: 'Review recovery' })).toBeVisible();
  expect(inputs[0].restoreUnassignedItemIds).toEqual(['synthetic-removed-copy']);
  await dialog.getByRole('button', { name: 'Undo this change', exact: true }).click();
  await expect.poll(async () => (await stored(page))[0]?.synchronized).toBe(true);
  expect(inputs[1].restoreUnassignedItemIds).toEqual(['synthetic-removed-copy']);
});
test('default creation needs explicit nominated replacement and exact fresh preconditions', async ({
  page,
  insets,
}) => {
  await page.route('**/app/api/collection-activity**', (route) => {
    const q = new URL(route.request().url()).searchParams;
    const creation = {
      ...event('105'),
      action: 'collection.create',
      affected_entities: { collectionIds: ['synthetic-original-default'] },
      changes: [
        {
          table: 'binders',
          id: 'synthetic-original-default',
          before: null,
          after: { is_default: true, name: 'Synthetic original default' },
        },
      ],
    };
    return route.fulfill({
      json: q.has('scope')
        ? { scope }
        : { scope, data: [creation], nextCursor: null, syncedAt: '2026-11-10T12:01:00Z' },
    });
  });
  const inputs: Record<string, unknown>[] = [];
  await page.route('**/app/e2e-harness/storage/recovery?*', async (route) => {
    inputs.push(route.request().postDataJSON());
    await route.continue();
  });
  await page.goto(entry);
  const dialog = await open(page);
  const review = dialog.getByRole('button', { name: 'See what undoing does', exact: true });
  await expect(review).toBeDisabled();
  await dialog.getByRole('combobox', { name: /Which binder should open first instead/ }).selectOption(collection);
  await review.click();
  await expect(dialog.getByRole('region', { name: 'Review recovery' })).toBeVisible();
  await expect(dialog.getByText('Default collection: false → true')).toBeVisible();
  const h = new Harness(page, insets, true);
  await h.expectMinTapTarget(dialog.getByRole('button', { name: 'Undo this change', exact: true }));
  await h.expectWithinSafeViewport(dialog.getByRole('button', { name: 'Undo this change', exact: true }));
  await h.expectHittable(dialog.getByRole('button', { name: 'Undo this change', exact: true }));
  expect(inputs[0].planVersion).toBe(2);
  expect(inputs[0].replacementDefaultCollectionId).toBe(collection);
  expect(inputs[0].collections).toEqual([{ collectionId: collection, version: 3, layoutRevision: 4 }]);
  await dialog.getByRole('button', { name: 'Undo this change', exact: true }).click();
  await expect.poll(async () => (await stored(page))[0]?.synchronized).toBe(true);
  expect(inputs[1].collections).toEqual(inputs[0].collections);
});

test('aborted recovery persistence retries the same confirmed intent before any apply', async ({ page }) => {
  await history(page);
  let sent = '';
  await page.route('**/app/e2e-harness/storage/recovery?*', async (route) => {
    if (new URL(route.request().url()).searchParams.get('operation') === 'recovery.apply')
      sent = route.request().postData()!;
    await route.continue();
  });
  await page.goto(entry);
  const dialog = await open(page);
  await dialog.getByRole('button', { name: 'See what undoing does', exact: true }).click();
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    let aborted = false;
    IDBObjectStore.prototype.put = function (value, key) {
      const request = key === undefined ? original.call(this, value) : original.call(this, value, key);
      if (value?.recovery?.[0]?.intent && !aborted) {
        aborted = true;
        sessionStorage.setItem('synthetic-aborted-recovery', JSON.stringify(value.recovery[0].intent));
        this.transaction.abort();
      }
      return request;
    };
  });
  await dialog.getByRole('button', { name: 'Undo this change', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  expect(await stored(page)).toEqual([]);
  expect(sent).toBe('');
  const original = JSON.parse((await page.evaluate(() => sessionStorage.getItem('synthetic-aborted-recovery')))!);
  await dialog.getByRole('button', { name: 'Undo this change', exact: true }).click();
  await expect.poll(async () => (await stored(page))[0]?.synchronized).toBe(true);
  expect((await stored(page))[0].intent).toEqual(original);
  expect(JSON.parse(sent)).toEqual(original.request);
});

test('terminal noncommit survives failed read/reload, explicit discard retains proof and new recovery needs preview', async ({
  page,
  insets,
}) => {
  await history(page);
  let terminal = true,
    failedRead = false,
    applies = 0;
  const requests: Record<string, unknown>[] = [];
  await page.route('**/app/e2e-harness/storage/recovery?*', async (route) => {
    const operation = new URL(route.request().url()).searchParams.get('operation')!;
    if (operation === 'recovery.apply') {
      applies++;
      const request = route.request().postDataJSON();
      requests.push(request);
      if (terminal) {
        failedRead = true;
        return route.fulfill({
          status: 409,
          headers: { 'Cache-Control': 'private, no-store' },
          json: {
            version: 1,
            operation,
            operationId: request.operationId,
            rejection: {
              outcome: 'rejected',
              operationId: request.operationId,
              code: 'recovery_plan_conflict',
              inventoryRevision: 7,
            },
          },
        });
      }
    }
    await route.continue();
  });
  await page.route('**/app/e2e-harness/storage/inventory?*', async (route) => {
    if (failedRead) return route.abort('failed');
    await route.continue();
  });
  await page.goto(entry);
  let dialog = await open(page);
  await dialog.getByRole('button', { name: 'See what undoing does', exact: true }).click();
  await dialog.getByRole('button', { name: 'Undo this change', exact: true }).click();
  await expect(dialog.getByText(/This undo was not applied because your collection has changed/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Discard this undo', exact: true })).toHaveCount(0);
  const original = (await stored(page))[0].intent.request;
  failedRead = false;
  await page.reload();
  await (await storageAction(page, 'Activity')).click();
  dialog = page.getByRole('dialog', { name: 'Collection Activity', exact: true });
  await expect(dialog.getByRole('button', { name: 'Discard this undo', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Check my collection', exact: true }).click();
  const discard = dialog.getByRole('button', { name: 'Discard this undo', exact: true });
  await expect(discard).toBeVisible();
  const h = new Harness(page, insets, true);
  await h.expectMinTapTarget(discard);
  await h.expectWithinSafeViewport(discard);
  await h.expectHittable(discard);
  await h.expectNoHorizontalOverflow();
  // Abort the actual atomic resolution commit. The original request and proof survive.
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    let failed = false;
    IDBObjectStore.prototype.put = function (value, key) {
      const r = key === undefined ? put.call(this, value) : put.call(this, value, key);
      if (!failed && value?.recovery?.some((r: { resolution?: string }) => r.resolution === 'discarded')) {
        failed = true;
        this.transaction.abort();
      }
      return r;
    };
  });
  await discard.click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByText('This undo was not applied and has been discarded.')).toHaveCount(0);
  await discard.click();
  await expect(dialog.getByText('This undo was not applied and has been discarded.')).toBeVisible();
  const retained = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((yes) => {
      const r = indexedDB.open('binderdex-offline');
      r.onsuccess = () => yes(r.result);
    });
    const rows = await new Promise<{ recovery?: unknown[] }[]>((yes) => {
      const r = db.transaction('records').objectStore('records').getAll();
      r.onsuccess = () => yes(r.result);
    });
    db.close();
    return rows.find((r) => r.recovery)?.recovery?.[0] as {
      resolution: string;
      synchronized: boolean;
      receipt: unknown;
      rejection: unknown;
    };
  });
  expect(retained.resolution).toBe('discarded');
  expect(retained.synchronized).toBe(false);
  expect(retained.receipt).toBeNull();
  expect(retained.rejection).toBeTruthy();
  expect(applies).toBe(1);
  await dialog.getByRole('button', { name: 'Start a new undo', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Undo this change', exact: true })).toHaveCount(0);
  terminal = false;
  await dialog.getByRole('button', { name: 'See what undoing does', exact: true }).click();
  await dialog.getByRole('button', { name: 'Undo this change', exact: true }).click();
  await expect.poll(async () => (await stored(page))[1]?.synchronized).toBe(true);
  expect(requests[1].operationId).not.toBe(original.operationId);
  expect((await stored(page))[0].intent.request).toEqual(original);
});

test('Activity keeps one overlay while access verification finishes, Back stays in the app', async ({ page }) => {
  await history(page);
  let release!: () => void;
  const verifying = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/app\/api\/collection-activity\?scope=1$/, async (route) => {
    await verifying;
    await route.fulfill({ json: { scope } });
  });
  await page.goto(entry);
  await (await storageAction(page, 'Activity')).click();
  const dialog = page.getByRole('dialog', { name: 'Collection Activity', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.evaluate((element) => {
    Object.assign(window, { syntheticActivityPanel: element });
  });
  release();
  await expect(dialog.getByRole('button', { name: 'See what undoing does', exact: true }).first()).toBeVisible();
  expect(
    await dialog.evaluate(
      (element) => element === (window as unknown as { syntheticActivityPanel: Element }).syntheticActivityPanel,
    ),
  ).toBe(true);
  await page.goBack();
  await expect(dialog).toBeHidden();
  expect(page.url()).toContain('/e2e-harness');
});
