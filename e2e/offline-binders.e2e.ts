import { test as base, expect, type Page, type Route } from '@playwright/test';
import {
  mockBackends,
  emulateStandalone,
  SAFE_AREA,
  E2E_USER,
  Harness,
  collectionPicker,
  chooseCollection,
} from './fixtures';
import {
  inventoryBrowseFixture,
  inventoryBrowseCatalog,
  inventoryBrowseLayouts,
} from '../tests/fixtures/inventory-browse';

// The harness's ?binders=3 binders. The owner's native snapshot holds My binder and Trades; Spare was created
// elsewhere and is not in it, so this device has no copy of Spare.
const MAIN = 'e2e00000-0000-4000-8000-000000000001';
const TRADES = 'e2e00000-0000-4000-8000-000000000002';
const SPARE = 'e2e00000-0000-4000-8000-000000000004';
const id = (value: string) => (value === 'alpha' ? MAIN : TRADES);
const layouts = inventoryBrowseLayouts.map((l) => ({ ...l, collectionId: id(l.collectionId) }));

// Synthetic native read: one base1-4 holo copy in each binder. Client shell, worker and IndexedDB are real.
async function inventory(route: Route) {
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
      navigation: { catalog: inventoryBrowseCatalog, layouts },
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
}

const test = base.extend({ serviceWorkers: 'allow' });
test.beforeEach(async ({ page, context, baseURL }, info) => {
  if (info.project.metadata?.standalone) await emulateStandalone(page, SAFE_AREA);
  await mockBackends(context, context, { signedIn: true, baseURL });
  await context.route('**/app/api/inventory?*', (route) => inventory(route));
});

/** Open a binder online and wait until the worker, the shell and this device's native copy are all saved. */
async function openOnline(page: Page, binderId: string) {
  await page.goto(`/app/e2e-harness?signedIn=1&binders=3&binder=${binderId}`);
  await expect(collectionPicker(page)).toBeVisible();
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const device = JSON.parse(localStorage.getItem('binderdex_device_binders_v1') ?? 'null');
          return (
            Boolean(navigator.serviceWorker.controller) &&
            Boolean(await caches.match('/app/app-shell')) &&
            Boolean(JSON.parse(localStorage.getItem('binderdex_start_v1') ?? 'null')?.native) &&
            (device?.savedBinderIds ?? []).sort().join()
          );
        }),
      { timeout: 60_000 },
    )
    .toBe([MAIN, TRADES].sort().join());
}

const offlineAbort = (route: Route) => route.abort('internetdisconnected');
/** Close the page and reopen the app with no network: a cold PWA relaunch served by the worker's app shell. */
async function relaunchOffline(page: Page, standalone: boolean, path: string) {
  const context = page.context();
  await page.close();
  await context.setOffline(true);
  await context.route('**/rest/v1/**', offlineAbort);
  await context.route('**/auth/v1/**', offlineAbort);
  const reopened = await context.newPage();
  if (standalone) await emulateStandalone(reopened, SAFE_AREA);
  const cdp = await context.newCDPSession(reopened);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', {
    offline: true,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  if (standalone) await cdp.send('Emulation.setSafeAreaInsetsOverride' as never, { insets: SAFE_AREA } as never);
  await reopened.goto(path);
  return reopened;
}
const harnessFor = (page: Page, standalone: boolean) =>
  new Harness(page, standalone ? SAFE_AREA : { top: 0, bottom: 0, left: 0, right: 0 }, true);

test(
  'binders saved online open offline after a reload; an unsaved binder says it needs a connection',
  { tag: '@matrix' },
  async ({ page }, info) => {
    test.setTimeout(120_000);
    const standalone = Boolean(info.project.metadata?.standalone);
    await openOnline(page, MAIN);
    const unsaved = (target: Page) => target.getByRole('status').filter({ hasText: 'saved on this device yet' });

    // Cold offline relaunch straight into the second binder, with no "not saved" notice.
    const reopened = await relaunchOffline(page, standalone, `/app?binder=${TRADES}`);
    const picker = collectionPicker(reopened);
    await expect(picker).toContainText('Trades', { timeout: 30_000 });
    await expect(reopened.getByTestId('connection-chip')).toContainText('Offline');
    await expect(unsaved(reopened)).toHaveCount(0);

    // Reloading offline into the other saved binder opens it too.
    await reopened.goto(`/app?binder=${MAIN}`);
    await expect(picker).toContainText('Alpha', { timeout: 30_000 });
    await expect(unsaved(reopened)).toHaveCount(0);
    // And the picker still switches between saved binders offline.
    await chooseCollection(reopened, TRADES);
    await expect(picker).toContainText('Trades');

    // A link to the binder this device has no copy of opens the last saved one and says why.
    await reopened.goto(`/app?binder=${SPARE}`);
    await expect(unsaved(reopened)).toContainText("“Spare” isn't saved on this device yet", { timeout: 30_000 });
    await expect(picker).not.toContainText('Spare');
    const h = harnessFor(reopened, standalone);
    await h.expectWithinSafeViewport(unsaved(reopened));
    await h.expectNoHorizontalOverflow();
  },
);

test("Show mode's binder prep counts the cards this device saved for that binder", async ({ page }, info) => {
  test.setTimeout(120_000);
  const standalone = Boolean(info.project.metadata?.standalone);
  await openOnline(page, TRADES);
  const openPrep = async (target: Page) => {
    const show = target.getByRole('region', { name: 'Show mode' });
    if (!(await show.isVisible())) await target.getByRole('button', { name: 'Show mode', exact: true }).click();
    await harnessFor(target, standalone).dock().getByRole('button', { name: 'Search', exact: true }).click();
    await target.getByRole('button', { name: 'Prepare offline', exact: true }).click();
    return target.getByRole('region', { name: 'Prepare this binder', exact: true });
  };
  const prep = await openPrep(page);
  // Trades holds one synthetic base1-4 holo copy.
  await expect(prep).toContainText('All 1 owned and wanted printings');
  await expect(prep.getByLabel('Binder download coverage')).toContainText('Cards 1/1');

  const reopened = await relaunchOffline(page, standalone, `/app?binder=${TRADES}`);
  await expect(collectionPicker(reopened)).toContainText('Trades', { timeout: 30_000 });
  const saved = await openPrep(reopened);
  await expect(saved.getByLabel('Binder download coverage')).toContainText('Cards 1/1');
  await expect(saved).toContainText('Offline. Saved evidence is usable');
});
