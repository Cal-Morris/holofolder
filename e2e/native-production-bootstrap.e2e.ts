import {
  test,
  expect,
  mockBackends,
  emulateStandalone,
  E2E_USER,
  SUPABASE_URL,
  Harness,
  openSettingsPage,
  settingsRow,
  storageAction,
  closeStorage,
  collectionPicker,
  viewPicker,
  chooseView,
  chooseCollection,
} from './fixtures';
import type { Route } from '@playwright/test';
import {
  inventoryBrowseFixture,
  inventoryBrowseCatalog,
  inventoryBrowseLayouts,
} from '../tests/fixtures/inventory-browse';

const alpha = '22222222-2222-4222-8222-222222222222';
const trades = '33333333-3333-4333-8333-333333333333';
const id = (value: string) => (value === 'alpha' ? alpha : trades);
const entry = '/app/e2e-harness?signedIn=1';
// Synthetic authenticated HTTP evidence, actual production BinderApp/endpoint selection and IDB.
async function inventory(
  route: Route,
  owner = E2E_USER.id,
  empty = false,
  created?: { collectionId: string; name: string },
) {
  const snapshot = inventoryBrowseFixture(5),
    url = new URL(route.request().url());
  snapshot.ownerUserId = owner;
  snapshot.items.forEach((i) => {
    i.ownerUserId = owner;
  });
  snapshot.collections.forEach((c) => {
    c.ownerUserId = owner;
    c.id = id(c.id);
  });
  snapshot.binders.forEach((b) => {
    b.ownerUserId = owner;
    b.collectionId = id(b.collectionId);
    b.slots.forEach((s) => {
      s.ownerUserId = owner;
      s.collectionId = b.collectionId;
    });
  });
  snapshot.placements.forEach((p) => {
    p.collectionId = id(p.collectionId);
  });
  if (empty) {
    snapshot.inventoryRevision = 0;
    snapshot.items = [];
    snapshot.collections = [];
    snapshot.binders = [];
    snapshot.placements = [];
  }
  if (created) {
    snapshot.inventoryRevision = 2;
    snapshot.collections = [
      {
        id: created.collectionId,
        ownerUserId: owner,
        name: created.name,
        kind: 'binder',
        defaultPresentation: 'binder',
        version: 0,
      },
    ];
    snapshot.binders = [
      { ownerUserId: owner, collectionId: created.collectionId, layoutRevision: 0, presetManifest: null, slots: [] },
    ];
  }
  await route.fulfill({
    headers: { 'Cache-Control': 'private, no-store' },
    json: {
      version: 2,
      requestId: url.searchParams.get('requestId'),
      scope: {
        actorUserId: E2E_USER.id,
        ownerUserId: owner,
        authSessionId: 'synthetic-e2e-auth-session',
        sessionId: url.searchParams.get('sessionId'),
      },
      snapshot,
      ...(created ? { defaultCollectionId: created.collectionId } : empty ? {} : { defaultCollectionId: trades }),
      navigation: {
        catalog: inventoryBrowseCatalog,
        layouts: created
          ? [{ collectionId: created.collectionId, layoutRevision: 0, rows: 4, cols: 4 }]
          : empty
            ? []
            : inventoryBrowseLayouts.map((l) => ({ ...l, collectionId: id(l.collectionId) })),
      },
      evidence: {
        inventoryRevision: snapshot.inventoryRevision,
        items: snapshot.items.length,
        placements: snapshot.placements.length,
        collections: snapshot.collections.length,
        binders: snapshot.binders.length,
        slots: snapshot.binders.reduce((n, b) => n + b.slots.length, 0),
        storage: snapshot.binders.map((b) => ({
          collectionId: b.collectionId,
          collectionVersion: snapshot.collections.find((c) => c.id === b.collectionId)!.version,
          layoutRevision: b.layoutRevision,
          slotCount: b.slots.length,
        })),
      },
    },
  });
}

test.beforeEach(async ({ page, context, standalone, insets, baseURL }) => {
  if (standalone) await emulateStandalone(page, insets);
  await mockBackends(page, context, { signedIn: true, baseURL });
  await page.route('**/app/api/inventory?*', (route) => inventory(route));
});

test('production host uses the native default, device view and explicit link without legacy writes', async ({
  page,
  insets,
}) => {
  const legacyWrites: string[] = [];
  page.on('request', (r) => {
    if (r.method() !== 'GET' && /\/api\/collection|\/rest\/v1\/pokemon_collection/.test(r.url()))
      legacyWrites.push(r.url());
  });
  await page.goto(entry);
  const select = collectionPicker(page);
  await expect(select).toHaveAttribute('data-value', trades);
  await chooseCollection(page, alpha);
  await chooseView(page, 'list');
  await page.getByRole('searchbox', { name: 'Filter collection' }).fill('charizard');
  await page.reload();
  await expect(select).toHaveAttribute('data-value', alpha);
  await expect(page.getByRole('searchbox', { name: 'Filter collection' })).toHaveValue('charizard');
  await page.goto(`${entry}&binder=${trades}&view=binder`);
  await expect(select).toHaveAttribute('data-value', trades);
  await expect(viewPicker(page)).toHaveAttribute('data-value', 'binder');
  const h = new Harness(page, insets, true);
  await h.expectNoHorizontalOverflow();
  for (const name of ['Inventory', 'Binder', 'Search']) {
    const control = page
      .getByRole('navigation', { name: 'Main navigation', exact: true })
      .getByRole('button', { name, exact: true });
    await h.expectMinTapTarget(control);
    await h.expectWithinSafeViewport(control);
    await h.expectHittable(control);
  }
  expect(legacyWrites).toEqual([]);
});

// Actual BinderStart page component with a server boot (no saved device data), production endpoint, empty IDB.
test('fresh browser shows the server collection, refocus neither restarts the read nor blanks the app', async ({
  page,
  insets,
}) => {
  let requests = 0,
    release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/app/api/inventory?*', async (route) => {
    if (++requests === 1) await held;
    await inventory(route);
  });
  await page.goto('/app/e2e-harness/binder-start');
  await expect.poll(() => requests).toBe(1);
  // Tab refocus fires focus, visibility and Supabase SIGNED_IN for the same account.
  const refocus = () =>
    page.evaluate((user) => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
      const channel = new BroadcastChannel('sb-127-auth-token');
      channel.postMessage({ event: 'SIGNED_IN', session: { user } });
      channel.close();
    }, E2E_USER);
  for (let i = 0; i < 3; i++) {
    await refocus();
    await page.waitForTimeout(200);
  }
  expect(requests, 'a slow first read is not restarted by refocus').toBe(1);
  release();
  const select = collectionPicker(page);
  await expect(select).toHaveAttribute('data-value', trades);
  await expect(page.locator(`[data-slot-id="trades-empty-0"]`)).toBeVisible();
  // Collection first: the old staging rows stay out of the page.
  await expect(page.getByText('Inventory is what you own and where', { exact: false })).toHaveCount(0);
  for (const name of [
    'Backup',
    'New storage',
    'Refresh storage',
    'Delete collection',
    'Settings',
    'Sign out',
    'National Dex',
  ])
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Storage dashboard' })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Binder navigation' })).toBeVisible();
  const h = new Harness(page, insets, true);
  await h.expectNoHorizontalOverflow();
  for (const name of ['Storage', 'Collection']) {
    const control = page.getByRole('button', { name, exact: true });
    await h.expectMinTapTarget(control);
    await h.expectWithinSafeViewport(control);
    await h.expectHittable(control);
  }
  await page.evaluate(() => {
    const seen = { blanked: false };
    Object.assign(window, { syntheticSeen: seen });
    new MutationObserver(() => {
      if (
        document.querySelector('[data-testid="binder-skeleton"]') ||
        /Checking your account/.test(document.body.innerText)
      )
        seen.blanked = true;
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  await refocus();
  await expect.poll(() => requests).toBeGreaterThan(1);
  await page.waitForTimeout(500);
  expect(
    await page.evaluate(() => (window as unknown as { syntheticSeen: { blanked: boolean } }).syntheticSeen.blanked),
    'refocus after load keeps the collection on screen',
  ).toBe(false);
  await expect(page.locator(`[data-slot-id="trades-empty-0"]`)).toBeVisible();
  await page.reload();
  await expect(select).toHaveAttribute('data-value', trades);
  await expect(page.locator(`[data-slot-id="trades-empty-0"]`)).toBeVisible();
});

test('failed complete refresh retains the view, disables new edits and can recover', async ({ page }) => {
  await page.goto(entry);
  await expect(await storageAction(page, 'New storage')).toBeEnabled();
  await closeStorage(page);
  await page.route('**/app/api/inventory?*', (route) =>
    route.fulfill({ status: 503, json: { error: 'inventory_read_unavailable' } }),
  );
  await (await storageAction(page, 'Refresh storage')).click();
  await expect(page.getByRole('status').filter({ hasText: 'Could not refresh storage' })).toBeVisible();
  await expect(collectionPicker(page)).toHaveAttribute('data-value', trades);
  await expect(await storageAction(page, 'New storage')).toBeDisabled();
  await closeStorage(page);
  await page.route('**/app/api/inventory?*', (route) => inventory(route));
  await (await storageAction(page, 'Refresh storage')).click();
  await expect(await storageAction(page, 'New storage')).toBeEnabled();
  await closeStorage(page);
});

for (const code of ['inventory_not_initialized', 'legacy_inventory_incomplete'])
  test(`onboarding reports the trusted provisioning prerequisite: ${code}`, async ({ page, insets }) => {
    await page.route('**/app/api/inventory?*', (route) => route.fulfill({ status: 503, json: { error: code } }));
    await page.goto(entry);
    await expect(page.getByRole('status').filter({ hasText: /administrator/ })).toBeVisible();
    await expect(await storageAction(page, 'New storage')).toBeDisabled();
    await closeStorage(page);
    await expect(await storageAction(page, 'Refresh storage')).toBeEnabled();
    await closeStorage(page);
    await new Harness(page, insets, true).expectNoHorizontalOverflow();
  });

test('membership pause closes the old private lifetime, recheck resolves the new owner', async ({ page }) => {
  await page.goto(`${entry}&view=inventory`);
  await expect(page.locator('[data-item-id="copy-00001"]')).toBeVisible();
  await page.locator('[data-item-id="copy-00001"]').click();
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent('holofolder-membership-lifecycle-v1', { detail: 'pause' })),
  );
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('[data-item-id="copy-00001"]')).toHaveCount(0);
  const owner = '00000000-0000-4000-8000-0000000000e3';
  await page.route('**/rest/v1/partnerships?*', (route) =>
    route.fulfill({
      json: { id: 'synthetic-partnership', owner_user_id: owner, user1_id: E2E_USER.id, user2_id: owner },
    }),
  );
  await page.route('**/app/api/inventory?*', (route) => inventory(route, owner));
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent('holofolder-membership-lifecycle-v1', { detail: 'recheck' })),
  );
  await expect(page.locator('[data-item-id="copy-00001"]')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('binderdex_start_v1') ?? 'null')?.ownerUserId))
    .toBe(owner);
});

// Synthetic creation response only; parent 098 remains a hosted first-creation prerequisite.
test('untouched revision-zero owner can review and persist the existing first storage command', async ({ page }) => {
  let created: { collectionId: string; name: string } | undefined;
  let finish!: () => void;
  const held = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await page.route('**/app/api/inventory?*', (route) => inventory(route, E2E_USER.id, true, created));
  const sent: unknown[] = [];
  await page.route('**/app/api/storage-collections', async (route) => {
    const request = route.request().postDataJSON();
    sent.push(request);
    await held;
    created = { collectionId: request.collectionId, name: request.name };
    await route.fulfill({
      headers: { 'Cache-Control': 'private, no-store' },
      json: {
        version: 1,
        operationId: request.operationId,
        receipt: {
          inventoryRevision: 2,
          collectionId: request.collectionId,
          collectionVersion: 0,
          layoutRevision: 0,
          changed: true,
          slotIds: [],
          recoverySupported: false,
        },
      },
    });
  });
  await page.goto(entry);
  await expect(page.getByRole('status').filter({ hasText: 'Create your first storage' })).toBeVisible();
  await (await storageAction(page, 'New storage')).click();
  const dialog = page.getByRole('dialog', { name: 'New storage', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Storage name', exact: true }).fill('My first binder');
  await dialog.getByRole('combobox', { name: 'Starting arrangement' }).selectOption('blank');
  await dialog.getByRole('button', { name: 'Review storage', exact: true }).click();
  await dialog.getByRole('button', { name: 'Confirm create storage', exact: true }).click();
  await expect(dialog).toContainText('Creation pending sync');
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toMatchObject({
    version: 1,
    inventoryRevision: 0,
    name: 'My first binder',
    manifest: { entries: [] },
  });
  await expect(collectionPicker(page)).toHaveAttribute('data-value', '');
  finish();
  await expect(collectionPicker(page)).toHaveAttribute(
    'data-value',
    (sent[0] as { collectionId: string }).collectionId,
  );
  await expect(dialog).not.toBeVisible();
});

async function savedQueue(page: import('@playwright/test').Page) {
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
    return new Promise<unknown[]>((yes, no) => {
      const r = db.transaction('records').objectStore('records').getAll();
      r.onsuccess = () => {
        db.close();
        yes(r.result.filter((v) => v?.version === 1 && Array.isArray(v.pending)));
      };
      r.onerror = () => no(r.error);
    });
  });
}

for (const outcome of ['recovered', 'account', 'membership', 'denied', 'unavailable', 'expired'] as const)
  test(`online stalled membership shows saved read-only storage then ${outcome}`, async ({ page, insets }) => {
    const sends: string[] = [];
    page.on('request', (r) => {
      if (r.method() !== 'GET' && /\/api\/(collection|binder-slots|inventory|storage-collections)/.test(r.url()))
        sends.push(r.url());
    });
    await page.route('**/app/api/binder-slots', (route) =>
      route.fulfill({
        status: 503,
        json: {
          error: {
            code: 'storage_unavailable',
            message: 'Synthetic sender outage',
            requestId: 'synthetic-online-startup',
          },
        },
      }),
    );
    await page.goto(`${entry}&binder=${alpha}`);
    await page.getByRole('button', { name: 'Edit layout', exact: true }).click();
    await page
      .getByRole('region', { name: 'Layout editing', exact: true })
      .getByRole('button', { name: 'Append free slot', exact: true })
      .click();
    await expect
      .poll(async () =>
        (await savedQueue(page)).some((row) =>
          (row as { pending: { status: string }[] }).pending.some((p) => p.status === 'unavailable'),
        ),
      )
      .toBe(true);
    await expect
      .poll(() =>
        page.evaluate(() => Boolean(JSON.parse(localStorage.getItem('binderdex_start_v1') ?? 'null')?.native)),
      )
      .toBe(true);
    const before = await savedQueue(page);
    let release!: () => void,
      membershipRequests = 0;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/rest/v1/partnerships?*', async (route) => {
      membershipRequests++;
      await held;
      if (outcome === 'unavailable')
        await route.fulfill({
          status: 400,
          json: { code: 'PGRST000', message: 'Synthetic database connection failure' },
        });
      else if (outcome === 'denied')
        await route.fulfill({ status: 403, json: { code: '42501', message: 'Synthetic membership denial' } });
      else await route.fulfill({ json: null });
    });
    const sentBefore = sends.length;
    if (outcome === 'expired') await page.clock.install();
    await page.reload();
    expect(await page.evaluate(() => navigator.onLine)).toBe(true);
    await expect.poll(() => membershipRequests).toBeGreaterThan(0);
    await expect(page.getByRole('status').filter({ hasText: /^1 pending edit to sync$/ })).toBeVisible();
    await expect(page.getByText(/Cached only|Access is being checked/)).toHaveCount(0);
    await expect(collectionPicker(page)).toHaveAttribute('data-value', alpha);
    await expect(page.getByRole('button', { name: 'Edit layout', exact: true })).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Storage', exact: true })).toHaveCount(0);
    expect(await savedQueue(page)).toEqual(before);
    expect(sends.length).toBe(sentBefore);
    const h = new Harness(page, insets, true);
    await h.expectNoHorizontalOverflow();
    const dock = page.getByRole('navigation', { name: 'Main navigation', exact: true });
    for (const name of ['Binder', 'Inventory']) {
      const control = dock.getByRole('button', { name, exact: true });
      await h.expectMinTapTarget(control);
      await h.expectWithinSafeViewport(control);
      await h.expectHittable(control);
    }
    if (outcome === 'unavailable') {
      const failed = page.waitForResponse((r) => r.url().includes('/rest/v1/partnerships?') && r.status() === 400);
      release();
      await failed;
      await expect(page.getByRole('status').filter({ hasText: /^1 pending edit to sync$/ })).toBeVisible();
      expect(await savedQueue(page)).toEqual(before);
      expect(sends.length).toBe(sentBefore);
      return;
    }
    if (outcome === 'account')
      await page.evaluate((user) => {
        const channel = new BroadcastChannel('sb-127-auth-token');
        channel.postMessage({
          event: 'SIGNED_IN',
          session: { user: { ...user, id: '55555555-5555-4555-8555-555555555555' } },
        });
        channel.close();
      }, E2E_USER);
    if (outcome === 'membership')
      await page.evaluate(() =>
        window.dispatchEvent(new CustomEvent('holofolder-membership-lifecycle-v1', { detail: 'pause' })),
      );
    if (outcome === 'expired') {
      // Advance the existing expiry timer, without changing cached evidence or queue bytes.
      await page.clock.fastForward(3601_000);
    }
    if (outcome === 'recovered' || outcome === 'denied') release();
    await expect(page.getByRole('status').filter({ hasText: /^1 pending edit to sync$/ })).not.toBeVisible();
    if (outcome === 'recovered') {
      await expect(page.getByRole('button', { name: 'Edit layout', exact: true })).toBeEnabled();
      // First reconcile the saved command before opening an unrelated creation plan.
      await expect(await storageAction(page, 'New storage')).toBeDisabled();
      await closeStorage(page);
      // Unavailable commands do not auto-retry, and a checked read cannot ACK them.
      expect(await savedQueue(page)).toEqual(before);
    } else {
      await expect(collectionPicker(page)).not.toBeVisible();
      expect(await savedQueue(page)).toEqual(before);
      release();
    }
  });

// Focus during a slow startup keeps the one read in flight; restarting it on every focus meant it never finished.
test('focus during startup keeps the single inventory read and it finishes opening', async ({ page, context }) => {
  await page.clock.install();
  let requests = 0,
    release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const failed: string[] = [];
  page.on('requestfailed', (request) => {
    if (request.url().includes('/api/inventory?')) failed.push(request.url());
  });
  await context.route('**/app/api/inventory?*', async (route) => {
    if (++requests === 1) await held;
    await inventory(route);
  });
  await page.unroute('**/app/api/inventory?*');
  await page.goto(entry);
  await expect.poll(() => requests).toBeGreaterThan(0);
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('focus'));
  });
  release();
  await expect(collectionPicker(page)).toHaveAttribute('data-value', trades);
  expect(requests).toBe(1);
  expect(failed).toEqual([]);
  await expect(await storageAction(page, 'New storage')).toBeEnabled();
  await closeStorage(page);
  await page.clock.fastForward(46_000);
  await expect(collectionPicker(page)).toHaveAttribute('data-value', trades);
  expect(await page.evaluate(() => sessionStorage.getItem('holofolder-startup-reset-v2'))).toBeNull();
});

// Regression: native collection write suppression must not suppress account settings.
test('native owner can open Account and save pricing preferences without legacy layout writes', async ({
  page,
  insets,
}) => {
  const saves: Record<string, unknown>[] = [],
    legacyWrites: string[] = [];
  await page.route(`${SUPABASE_URL}/auth/v1/passkeys**`, (route) => route.fulfill({ json: [] }));
  await page.route('**/app/api/developer/keys', (route) => route.fulfill({ json: { keys: [], canCreate: false } }));
  await page.route('**/app/api/developer/clients', (route) => route.fulfill({ json: { clients: [] } }));
  await page.route('**/app/api/settings**', async (route) => {
    if (route.request().method() === 'PUT') saves.push(route.request().postDataJSON());
    await route.fulfill({ json: { settings: { binderRows: 8, binderCols: 8 }, hasStoredSettings: true } });
  });
  page.on('request', (request) => {
    if (request.method() !== 'GET' && /\/api\/collection(?:\?|$)|\/rest\/v1\/pokemon_collection/.test(request.url()))
      legacyWrites.push(request.url());
  });
  await page.goto(`${entry}&binder=${alpha}`);
  await expect(page.getByRole('button', { name: 'Edit layout', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  const profile = settingsRow(dialog, 'Profile');
  await expect(profile).toBeVisible();
  const h = new Harness(page, insets, true);
  await h.expectMinTapTarget(profile);
  await h.expectWithinSafeViewport(profile);
  await h.expectHittable(profile);
  await expect(dialog.getByText('Collection sync', { exact: true })).toHaveCount(0);
  await expect(settingsRow(dialog, 'Backup')).toHaveCount(0);
  for (const [row, name] of [
    ['Profile', 'Your profile'],
    ['Plan & billing', 'Holo Folder plan'],
    ['Sign-in & security', 'Passkeys'],
    ['Developer', 'Developer access'],
  ]) {
    await openSettingsPage(dialog, row);
    await expect(dialog.getByRole('region', { name, exact: true })).toBeAttached();
  }
  await openSettingsPage(dialog, 'Plan & billing');
  await expect(
    dialog
      .getByRole('region', { name: 'Holo Folder plan', exact: true })
      .getByRole('heading', { name: 'Lifetime access', exact: true }),
  ).toBeVisible();
  await openSettingsPage(dialog, 'Prices');
  await dialog.getByRole('combobox', { name: 'Currency', exact: true }).selectOption('USD');
  await expect.poll(() => saves.length).toBe(1);
  expect(saves[0]).toMatchObject({ preferredCurrency: 'USD', binderId: alpha, binderRows: 3, binderCols: 3 });
  await expect(dialog.getByRole('combobox', { name: 'Currency', exact: true })).toHaveValue('USD');
  await h.expectNoHorizontalOverflow();
  await dialog.getByRole('button', { name: 'Binder', exact: true }).click();
  await expect(dialog.getByRole('button', { name: /2x2/ })).toBeDisabled();
  await page
    .getByRole('navigation', { name: 'Main navigation', exact: true })
    .getByRole('button', { name: 'Binder', exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await page.route('**/app/api/binder-slots', (route) =>
    route.fulfill({
      status: 503,
      json: {
        error: {
          code: 'storage_unavailable',
          message: 'Synthetic sender outage',
          requestId: 'synthetic-settings-layout',
        },
      },
    }),
  );
  await page.getByRole('button', { name: 'Edit layout', exact: true }).click();
  await page
    .getByRole('region', { name: 'Layout editing', exact: true })
    .getByRole('button', { name: 'Append free slot', exact: true })
    .click();
  await expect
    .poll(async () =>
      (await savedQueue(page)).some((row) =>
        (row as { pending: { intent: { request: { commands: { kind: string }[] } } }[] }).pending.some((p) =>
          p.intent.request.commands.some((c) => c.kind === 'create'),
        ),
      ),
    )
    .toBe(true);
  expect(saves).toHaveLength(1);
  expect(legacyWrites).toEqual([]);
});

test('shared read-only Settings keeps account and layout restricted', async ({ page }) => {
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'PUT' && request.url().includes('/api/settings')) writes.push(request.url());
  });
  await page.goto(`${entry}&readOnly=1`);
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  await expect(dialog).toBeVisible();
  await expect(settingsRow(dialog, 'Layout')).toBeVisible();
  for (const row of [
    'Profile',
    'Plan & billing',
    'Sign-in & security',
    'Sharing',
    'Notifications',
    'Backup',
    'Developer',
  ])
    await expect(settingsRow(dialog, row)).toHaveCount(0);
  await openSettingsPage(dialog, 'Layout');
  await expect(dialog.getByRole('button', { name: /2x2/ })).toBeDisabled();
  expect(writes).toEqual([]);
});
