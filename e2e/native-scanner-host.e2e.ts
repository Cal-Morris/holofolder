import { test, expect, mockBackends, emulateStandalone, Harness, E2E_USER, collectionPicker } from './fixtures';
import type { Page } from '@playwright/test';

// The real BinderApp host with native storage over the loopback HTTP harness (tests/fixtures/storage-command-harness,
// `scan-*` fixtures: a 2×2 page, pockets 1 and 2 kept for Snorlax, pockets 3 and 4 free, one unplaced raw copy each of
// Synthetic energy, trainer and snorlax). Page photos go through tests/fixtures/native-scanner-host, which reports the
// pockets it is given without crops, so no pocket is read and every card is chosen in the review.
const collection = '22222222-2222-4222-8222-222222222222';
const entry = `/app/e2e-harness?signedIn=1&browserHost=1&binder=${collection}`;
const review = (page: Page) => page.getByRole('dialog', { name: 'Scanned cards' });
const pocket = (page: Page, n: number) =>
  review(page).getByRole('region', { name: `Page 1 · Pocket ${n}`, exact: true });
const scanned = (page: Page) => review(page).getByRole('region', { name: 'Scanned card', exact: true });
const addButton = (page: Page) => review(page).getByRole('button', { name: /^(Add \d+ cards?|Choose a card to add)$/ });
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
        receipts: unknown[];
      } => !!r && typeof r === 'object' && 'pending' in r,
    );
  });
}
/** Scanning lives in the storage (⋮) menu. */
async function scan(page: Page, name: 'Scan page' | 'Scan card') {
  await page.getByRole('button', { name: 'Storage', exact: true }).click();
  await page.getByRole('dialog', { name: 'Storage', exact: true }).getByRole('button', { name, exact: true }).click();
}
/** Card scan without the camera: the review offers the cards saved on this device to tap. */
async function cardReview(page: Page) {
  await scan(page, 'Scan card');
  await page.getByRole('button', { name: 'Type instead', exact: true }).click();
  await expect(review(page)).toBeVisible();
}
/** Taps one of the scanned card's possible matches. */
async function tapMatch(page: Page, kind: string) {
  await scanned(page)
    .getByRole('group', { name: 'Possible matches' })
    .getByRole('button', { name: `Synthetic ${kind}, Synthetic scanner set #1`, exact: true })
    .click();
}
/** Chooses a pocket's card in the picker, searching the synthetic catalog. */
async function choose(page: Page, n: number, kind: string) {
  await pocket(page, n).getByRole('button', { name: 'Choose card', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Card selector' });
  await picker.getByRole('searchbox', { name: 'Search cards' }).fill(`Synthetic ${kind}`);
  await picker
    .getByRole('button', { name: `Add card Synthetic ${kind} from Synthetic scanner set`, exact: true })
    .click();
  await expect(picker).toHaveCount(0);
}
/** A page photo the synthetic detector reports as filled pockets 3 and 4 (index 2 and 3). */
async function pageReview(page: Page, deferred = false) {
  await scan(page, 'Scan page');
  await page.getByLabel('Page photo', { exact: true }).setInputFiles({
    name: 'synthetic-page.json',
    mimeType: 'image/png',
    buffer: Buffer.from(
      JSON.stringify({
        deferred,
        cells: [
          { index: 3, row: 1, col: 1, occupied: true },
          { index: 2, row: 1, col: 0, occupied: true },
        ],
      }),
    ),
  });
}
test.beforeEach(async ({ page, context, standalone, insets, baseURL }) => {
  if (standalone) await emulateStandalone(page, insets);
  await mockBackends(page, context, { signedIn: true, baseURL });
  await context.addCookies([{ name: 'hf-storage-fixture', value: `scan-${crypto.randomUUID()}`, url: baseURL! }]);
  // Synthetic catalog search over the fixture's cards, matched on the query's words.
  await page.route('**/app/api/tcg-card-search**', (route) => {
    const q = new URL(route.request().url()).searchParams.get('q') ?? '';
    return route.fulfill({
      json: {
        cards: ['energy', 'trainer', 'snorlax']
          .filter((kind) => q.includes(kind))
          .map((kind) => ({
            id: `synthetic-${kind}`,
            name: `Synthetic ${kind}`,
            localId: '1',
            language: 'en',
            dexIds: kind === 'snorlax' ? [143] : [],
            set: { id: 'synthetic', name: 'Synthetic scanner set' },
          })),
      },
    });
  });
  await page.addInitScript(() => {
    // Synthetic camera only. No physical device or recognition accuracy claim.
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const draw = () => {
      const c = canvas.getContext('2d')!;
      c.fillStyle = '#234567';
      c.fillRect(0, 0, 640, 480);
    };
    draw();
    setInterval(draw, 100);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => canvas.captureStream(10) },
    });
    Object.assign(window, {
      TextDetector: class {
        async detect() {
          return [{ rawValue: 'Synthetic trainer 1/100' }];
        }
      },
    });
  });
});
test('card scan saves the chosen card to the chosen pocket with one HTTP send and a fresh read', async ({
  page,
  insets,
}) => {
  let sends = 0,
    after = false,
    reads = 0;
  await page.route('**/app/e2e-harness/storage/inventory', async (route) => {
    sends++;
    const response = await route.fetch();
    after = true;
    await route.fulfill({ response });
  });
  await page.route('**/app/e2e-harness/storage/inventory?*', async (route) => {
    if (after) reads++;
    await route.continue();
  });
  await page.goto(entry);
  await cardReview(page);
  await tapMatch(page, 'energy');
  const target = review(page).getByRole('combobox', { name: 'Pocket for Synthetic energy', exact: true });
  // Energy doesn't fit the Snorlax pockets; only free pockets and a new one are offered.
  const options = await target.locator('option').allTextContents();
  expect(options.join()).not.toContain('Pocket 1');
  await target.selectOption({ label: 'Page 1 · Pocket 3 · empty pocket' });
  const h = new Harness(page, insets, true);
  await h.expectWithinSafeViewport(review(page));
  await h.expectNoHorizontalOverflow();
  for (const name of ['Cancel', 'Add 1 card', 'Close scan review']) {
    const button = review(page).getByRole('button', { name, exact: true });
    await h.expectMinTapTarget(button, 36);
    await h.expectHittable(button);
  }
  expect(sends).toBe(0);
  await addButton(page).click();
  await expect(review(page)).toHaveCount(0);
  await expect.poll(async () => (await record(page))?.receipts.length).toBe(1);
  expect(sends).toBe(1);
  expect(reads).toBeGreaterThan(0);
  await page.reload();
  await expect(page.locator('[data-slot-id="synthetic-slot-2"]')).toContainText('Synthetic energy');
  expect((await record(page))?.pending.length).toBe(0);
});
test('lost inventory reply survives modal close/reload and retries exact original request', async ({ page }) => {
  const requests: string[] = [];
  await page.route('**/app/e2e-harness/storage/inventory', async (route) => {
    requests.push(route.request().postData()!);
    const response = await route.fetch();
    if (requests.length === 1) {
      // Synthetic lost reply in a hidden old tab. Reload owns the next send; in-flight leases have separate coverage.
      await page.evaluate(() =>
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }),
      );
      await route.abort('failed');
    } else await route.fulfill({ response });
  });
  await page.goto(entry);
  await cardReview(page);
  await tapMatch(page, 'trainer');
  await review(page)
    .getByRole('combobox', { name: 'Pocket for Synthetic trainer', exact: true })
    .selectOption({ label: 'A new pocket at the end' });
  await addButton(page).click();
  await expect.poll(async () => (await record(page))?.pending[0]?.status).toBe('unavailable');
  await page.reload();
  await expect.poll(async () => (await record(page))?.receipts.length).toBe(1);
  expect(requests).toHaveLength(2);
  expect(requests[0]).toBe(requests[1]);
});
test('several possible matches wait for a tap; cancel creates no intent', async ({ page }) => {
  await page.goto(entry);
  await cardReview(page);
  await expect(scanned(page).getByRole('group', { name: 'Possible matches' }).getByRole('button')).toHaveCount(3);
  await expect(addButton(page)).toBeDisabled();
  await tapMatch(page, 'snorlax');
  // A card kept for this card's Pokémon is offered first, but nothing is saved until Add.
  await expect(review(page).getByRole('combobox', { name: 'Pocket for Synthetic snorlax', exact: true })).toHaveValue(
    'slot:synthetic-slot-0',
  );
  await review(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await record(page))?.pending).toHaveLength(0);
  await cardReview(page);
  await tapMatch(page, 'snorlax');
  await review(page)
    .getByRole('combobox', { name: 'Pocket for Synthetic snorlax', exact: true })
    .selectOption({ label: 'Page 1 · Pocket 2' });
  await addButton(page).click();
  await expect.poll(async () => (await record(page))?.receipts.length).toBe(1);
  await expect(page.locator('[data-slot-id="synthetic-slot-1"]')).toContainText('Synthetic snorlax');
  await expect(page.locator('[data-slot-id="synthetic-slot-0"]')).not.toContainText('Synthetic snorlax');
});
test('cached startup stays read-only and explains reconnect before scanner acceptance', async ({ page, context }) => {
  await page.goto(entry);
  await page.getByRole('button', { name: 'Storage', exact: true }).click();
  const scanCard = page
    .getByRole('dialog', { name: 'Storage', exact: true })
    .getByRole('button', { name: 'Scan card', exact: true });
  await expect(scanCard).toBeEnabled();
  await context.setOffline(true);
  await expect(scanCard).toBeDisabled();
  expect((await record(page))?.pending).toHaveLength(0);
});
for (const change of ['signout', 'account', 'owner'] as const)
  test(`${change} teardown discards unconfirmed review without queue writes`, async ({ page }) => {
    await page.goto(entry);
    await cardReview(page);
    await tapMatch(page, 'trainer');
    if (change === 'owner') {
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
      await page.route('**/app/e2e-harness/storage/inventory?*', () => {
        /* New owner read stays pending: this test checks retention, not the startup reset. */
      });
    }
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
    await expect(review(page)).toHaveCount(0);
    expect((await record(page))?.pending).toHaveLength(0);
  });
test('a page review saves every chosen card in one command, only on Add', async ({ page }) => {
  const bodies: { commands: { kind: string; destination?: { slot: { id: string } } }[] }[] = [];
  await page.route('**/app/e2e-harness/storage/inventory', async (route) => {
    bodies.push(route.request().postDataJSON());
    await route.continue();
  });
  await page.goto(`${entry}&scanFixture=1`);
  await pageReview(page);
  // Unread pockets are never filled in by themselves.
  for (const n of [3, 4]) await expect(pocket(page, n)).toContainText('Which card is this?');
  await expect(addButton(page)).toBeDisabled();
  await choose(page, 3, 'energy');
  await choose(page, 4, 'trainer');
  await expect(pocket(page, 3)).toContainText('Goes in Page 1 · Pocket 3');
  await expect(pocket(page, 4)).toContainText('Goes in Page 1 · Pocket 4');
  expect(bodies).toHaveLength(0);
  await addButton(page).click();
  await expect.poll(async () => (await record(page))?.receipts.length).toBe(1);
  expect(bodies).toHaveLength(1);
  expect(bodies[0].commands.map((c) => c.kind)).toEqual(['assign', 'assign']);
  expect(bodies[0].commands.map((c) => c.destination!.slot.id)).toEqual(['synthetic-slot-2', 'synthetic-slot-3']);
  await expect(page.locator('[data-slot-id="synthetic-slot-2"]')).toContainText('Synthetic energy');
  await expect(page.locator('[data-slot-id="synthetic-slot-3"]')).toContainText('Synthetic trainer');
});
test('a page review the server refuses says it could not be saved and can be discarded', async ({ page }) => {
  let sends = 0;
  await page.route('**/app/e2e-harness/storage/inventory', (route) => {
    sends++;
    return route.fulfill({
      status: 400,
      json: { error: { code: 'invalid_input', message: 'The storage request does not satisfy current constraints.' } },
    });
  });
  await page.goto(`${entry}&scanFixture=1`);
  await pageReview(page);
  await choose(page, 3, 'energy');
  await choose(page, 4, 'trainer');
  await addButton(page).click();
  await expect.poll(async () => (await record(page))?.pending[0]?.status).toBe('blocked');
  await page.reload();
  await expect(page.getByText("This change couldn't be saved.", { exact: false })).toBeVisible();
  await expect(page.getByText(/signed in to the right account/)).toHaveCount(0);
  // Try again resends the same refused request, so it stays blocked; only Discard clears it.
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect.poll(() => sends).toBe(2);
  await expect.poll(async () => (await record(page))?.pending[0]?.status).toBe('blocked');
  const discard = page.getByRole('button', { name: 'Discard', exact: true });
  expect((await discard.boundingBox())!.height).toBeGreaterThanOrEqual(36);
  await discard.click();
  await expect(page.getByText('That change was discarded.', { exact: false })).toBeVisible();
  await expect.poll(async () => (await record(page))?.pending.length).toBe(0);
  await expect(page.locator('[data-slot-id="synthetic-slot-2"]')).not.toContainText('Synthetic energy');
});
for (const change of ['layout', 'grid'] as const)
  test(`${change} changes during actual capture require a new scan`, async ({ page }) => {
    let changed = false;
    await page.route('**/app/e2e-harness/storage/inventory?*', async (route) => {
      const response = await route.fetch(),
        body = await response.json();
      if (changed) {
        const binder = body.snapshot.binders[0];
        binder.layoutRevision++;
        if (change === 'layout') binder.slots.reverse();
        body.navigation.layouts[0].layoutRevision = binder.layoutRevision;
        if (change === 'grid') {
          body.navigation.layouts[0].rows = 1;
          body.navigation.layouts[0].cols = 4;
        }
        body.evidence.storage[0].layoutRevision = binder.layoutRevision;
      }
      await route.fulfill({ response, json: body });
    });
    await page.goto(`${entry}&scanFixture=1`);
    await pageReview(page, true);
    await expect(page.getByRole('dialog', { name: 'Scan page' }).getByRole('status')).toContainText('Reading');
    changed = true;
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect
      .poll(async () =>
        page.evaluate(async () => {
          const db = await new Promise<IDBDatabase>((yes) => {
            const r = ((q) => (
              (q.onupgradeneeded = () => {
                if (!q.result.objectStoreNames.contains('records')) q.result.createObjectStore('records');
              }),
              q
            ))(indexedDB.open('binderdex-offline', 1));
            r.onsuccess = () => yes(r.result);
          });
          const rows = await new Promise<{ snapshot?: { binders: { layoutRevision: number }[] } }[]>((yes) => {
            const r = db.transaction('records').objectStore('records').getAll();
            r.onsuccess = () => yes(r.result);
          });
          db.close();
          return rows.find((r) => r.snapshot)?.snapshot?.binders[0].layoutRevision;
        }),
      )
      .toBe(5);
    await page.evaluate(() => window.dispatchEvent(new Event('synthetic-host-scan-release')));
    if (change === 'layout') {
      await expect(review(page).getByRole('alert')).toContainText('This page changed after the scan');
      await expect(addButton(page)).toBeDisabled();
      // A new grid closes the scanner outright: its pockets no longer exist.
    } else await expect(page.getByRole('dialog', { name: /^(Scan page|Scanned cards)$/ })).toHaveCount(0);
    expect((await record(page))?.pending).toHaveLength(0);
  });
test('unknown catalog capture stays unresolved without guesses', async ({ page }) => {
  await page.route('**/app/e2e-harness/storage/inventory?*', async (route) => {
    const response = await route.fetch(),
      body = await response.json();
    body.navigation.catalog = [];
    await route.fulfill({ response, json: body });
  });
  await page.goto(entry);
  await cardReview(page);
  await expect(scanned(page)).toContainText('Which card is this?');
  await expect(scanned(page).getByRole('group', { name: 'Possible matches' })).toHaveCount(0);
  await expect(addButton(page)).toBeDisabled();
  await review(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await record(page))?.pending).toHaveLength(0);
});
test('read card with several online matches asks for a tap and saves nothing on cancel', async ({ page }) => {
  const queries: URL[] = [];
  await page.route('**/app/api/tcg-card-search**', (route) => {
    queries.push(new URL(route.request().url()));
    return route.fulfill({
      json: {
        cards: ['trainer', 'energy'].map((kind) => ({
          id: `synthetic-${kind}`,
          name: `Synthetic ${kind}`,
          localId: '1',
          language: 'en',
          dexIds: [],
          set: { id: 'synthetic', name: 'Synthetic scanner set' },
        })),
      },
    });
  });
  await page.goto(entry);
  await scan(page, 'Scan card');
  await expect(page.getByRole('button', { name: 'Read card', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Read card', exact: true }).click();
  await expect(review(page)).toBeVisible();
  expect(queries.at(-1)?.searchParams.get('includeNonPokemon')).toBe('1');
  await expect(scanned(page).getByRole('group', { name: 'Possible matches' }).getByRole('button')).toHaveCount(2);
  await expect(addButton(page)).toBeDisabled();
  await review(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await record(page))?.pending).toHaveLength(0);
});
for (const stage of ['page', 'card', 'review'] as const)
  test(`actual host ${stage} uses safe bounds and every shared dismissal`, async ({ page, insets }) => {
    await page.goto(`${entry}&scanFixture=1`);
    const h = new Harness(page, insets, true);
    const open = async () => {
      if (stage === 'review') await cardReview(page);
      else await scan(page, stage === 'page' ? 'Scan page' : 'Scan card');
      return page.getByRole('dialog', {
        name: stage === 'page' ? 'Scan page' : stage === 'card' ? 'Scan a card' : 'Scanned cards',
        exact: true,
      });
    };
    for (const dismissal of ['close', 'escape', 'back', 'backdrop', 'swipe', 'dock']) {
      const dialog = await open();
      await h.expectWithinSafeViewport(dialog);
      await h.expectNoHorizontalOverflow();
      const close = dialog.getByRole('button', {
        name: stage === 'page' ? 'Close page scanner' : stage === 'card' ? 'Close scanner' : 'Close scan review',
        exact: true,
      });
      await h.expectMinTapTarget(close, 36);
      await h.expectHittable(close);
      if (dismissal === 'close') await close.click();
      if (dismissal === 'escape') await page.keyboard.press('Escape');
      if (dismissal === 'back') await page.goBack();
      if (dismissal === 'backdrop') await h.tapBackdrop(dialog);
      if (dismissal === 'swipe') await h.swipeDown(dialog);
      if (dismissal === 'dock')
        await page
          .getByRole('navigation', { name: 'Main navigation' })
          .getByRole('button', { name: 'Inventory', exact: true })
          .click();
      await expect(dialog).toHaveCount(0);
      await h.expectScrollUnlocked();
    }
    expect((await record(page))?.pending).toHaveLength(0);
  });
test('real IDB abort shows no acceptance and Try again persists the same confirmed request', async ({ page }) => {
  let sent = '';
  await page.route('**/app/e2e-harness/storage/inventory', async (route) => {
    sent = route.request().postData()!;
    await route.continue();
  });
  await page.goto(`${entry}&scanFixture=1`);
  await pageReview(page);
  await choose(page, 3, 'energy');
  await choose(page, 4, 'trainer');
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    let aborted = false;
    IDBObjectStore.prototype.put = function (value, key) {
      const request = key === undefined ? original.call(this, value) : original.call(this, value, key);
      if (value?.pending?.[0]?.intent && !aborted) {
        aborted = true;
        sessionStorage.setItem('synthetic-aborted-scan-request', JSON.stringify(value.pending[0].intent.request));
        sessionStorage.setItem('synthetic-aborted-scan-intent', JSON.stringify(value.pending[0].intent));
        this.transaction.abort();
      }
      return request;
    };
  });
  await addButton(page).click();
  const retry = review(page).getByRole('button', { name: 'Try again', exact: true });
  await expect(retry).toBeVisible();
  expect((await record(page))?.pending).toHaveLength(0);
  expect(sent).toBe('');
  const original = await page.evaluate(() => sessionStorage.getItem('synthetic-aborted-scan-request'));
  await retry.click();
  await expect(review(page)).toHaveCount(0);
  await expect.poll(async () => (await record(page))?.receipts.length).toBe(1);
  expect(JSON.parse(sent)).toEqual(JSON.parse(original!));
  const originalIntent = await page.evaluate(() => sessionStorage.getItem('synthetic-aborted-scan-intent'));
  expect(((await record(page))?.receipts[0] as { intent: unknown } | undefined)?.intent).toEqual(
    JSON.parse(originalIntent!),
  );
});
test('duplicate page copies keep distinct IDs through lost reply and exact durable retry', async ({ page }) => {
  const requests: {
    operationId: string;
    commands: { kind: string; selection?: { inventoryItemId?: string; itemId?: string } }[];
  }[] = [];
  await page.route('**/app/e2e-harness/storage/inventory', async (route) => {
    requests.push(route.request().postDataJSON());
    const response = await route.fetch();
    if (requests.length === 1) await route.abort('failed');
    else await route.fulfill({ response });
  });
  await page.goto(`${entry}&scanFixture=1`);
  await pageReview(page);
  await choose(page, 3, 'snorlax');
  await choose(page, 4, 'snorlax');
  await addButton(page).click();
  await expect.poll(async () => (await record(page))?.pending[0]?.status).toBe('unavailable');
  const original = (await record(page))?.pending[0].intent.request;
  await page.reload();
  await expect.poll(async () => (await record(page))?.receipts.length).toBe(1);
  expect(requests).toHaveLength(2);
  expect(requests[0]).toEqual(requests[1]);
  expect(requests[0]).toEqual(original);
  // The first reuses the unplaced raw copy, the second is a new copy added in the same command.
  expect(requests[0].commands.map((c) => c.kind)).toEqual(['assign', 'add', 'assign']);
  const copies = requests[0].commands
    .filter((c) => c.kind === 'assign')
    .map((c) => c.selection!.inventoryItemId ?? c.selection!.itemId);
  expect(new Set(copies).size).toBe(2);
  expect(copies[0]).toBe('synthetic-copy-snorlax');
  await expect(page.locator('[data-slot-id="synthetic-slot-2"]')).toContainText('Synthetic snorlax');
  await expect(page.locator('[data-slot-id="synthetic-slot-3"]')).toContainText('Synthetic snorlax');
});
for (const size of [0, 3] as const)
  test(`a pocket not yet created on ${size ? 'a partial' : 'an empty'} page goes in a new pocket in the same batch`, async ({
    page,
    context,
    baseURL,
    insets,
  }) => {
    const bodies: { commands: { kind: string; slotId?: string }[] }[] = [];
    await page.route('**/app/e2e-harness/storage/inventory', async (route) => {
      bodies.push(route.request().postDataJSON());
      await route.continue();
    });
    await context.addCookies([
      { name: 'hf-storage-fixture', value: `scan-${size ? 'partial' : 'empty'}-${crypto.randomUUID()}`, url: baseURL! },
    ]);
    await page.goto(`${entry}&scanFixture=1`);
    await pageReview(page);
    // The uncreated pockets have no place yet, so each is a "Scanned card" that asks where it goes.
    const created = size ? [pocket(page, 3)] : [];
    const uncreated = review(page).getByRole('region', { name: 'Scanned card', exact: true });
    await expect(uncreated).toHaveCount(size ? 1 : 2);
    for (const row of [...created, ...(await uncreated.all())]) {
      await row.getByRole('button', { name: 'Choose card', exact: true }).click();
      const picker = page.getByRole('dialog', { name: 'Card selector' });
      await picker.getByRole('searchbox', { name: 'Search cards' }).fill('Synthetic energy');
      await picker
        .getByRole('button', { name: 'Add card Synthetic energy from Synthetic scanner set', exact: true })
        .click();
      await expect(picker).toHaveCount(0);
    }
    for (const row of await uncreated.all())
      await row
        .getByRole('combobox', { name: 'Pocket for Synthetic energy', exact: true })
        .selectOption({ label: 'A new pocket at the end' });
    const h = new Harness(page, insets, true);
    await h.expectWithinSafeViewport(review(page));
    await h.expectNoHorizontalOverflow();
    expect(bodies).toHaveLength(0);
    await addButton(page).click();
    await expect.poll(async () => (await record(page))?.receipts.length).toBe(1);
    expect(bodies).toHaveLength(1);
    expect(bodies[0].commands.map((c) => c.kind)).toEqual(
      size ? ['assign', 'insertAssign'] : ['insertAssign', 'insertAssign'],
    );
    await expect(page.locator('[data-slot-id]')).toHaveCount(size ? 4 : 2);
    for (const command of bodies[0].commands.filter((c) => c.kind === 'insertAssign'))
      expect(command.slotId).toBeTruthy();
  });
test('append cap refuses the entire confirmed page and cancel leaves no durable intent', async ({
  page,
  context,
  baseURL,
}) => {
  await context.addCookies([{ name: 'hf-storage-fixture', value: `scan-cap-${crypto.randomUUID()}`, url: baseURL! }]);
  let sends = 0;
  await page.route('**/app/e2e-harness/storage/inventory', async (route) => {
    sends++;
    await route.continue();
  });
  await page.goto(`${entry}&scanFixture=1`);
  await cardReview(page);
  await tapMatch(page, 'energy');
  await review(page)
    .getByRole('combobox', { name: 'Pocket for Synthetic energy', exact: true })
    .selectOption({ label: 'A new pocket at the end' });
  await addButton(page).click();
  await expect(review(page).getByRole('alert')).toContainText('Review a smaller page');
  await expect(review(page).getByRole('button', { name: 'Try again', exact: true })).toHaveCount(0);
  expect(sends).toBe(0);
  expect((await record(page))?.pending).toHaveLength(0);
  await review(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await record(page))?.pending).toHaveLength(0);
});

test('an acknowledged append only counts as saved once a fresh read includes it', async ({ page }) => {
  let original: unknown,
    sends = 0,
    stale = true;
  const requests: string[] = [];
  await page.route('**/app/e2e-harness/storage/inventory?*', async (route) => {
    const response = await route.fetch(),
      body = await response.json();
    if (!original) original = body;
    await route.fulfill({ response, json: sends && stale ? original : body });
  });
  await page.route('**/app/e2e-harness/storage/inventory', async (route) => {
    sends++;
    requests.push(route.request().postData()!);
    await route.continue();
  });
  await page.goto(entry);
  await cardReview(page);
  await tapMatch(page, 'energy');
  await review(page)
    .getByRole('combobox', { name: 'Pocket for Synthetic energy', exact: true })
    .selectOption({ label: 'A new pocket at the end' });
  await addButton(page).click();
  await expect.poll(async () => (await record(page))?.pending[0]?.status).toBe('acknowledged');
  expect((await record(page))?.receipts).toHaveLength(0);
  stale = false;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(async () => (await record(page))?.receipts.length).toBe(1);
  // Never sent twice.
  expect(requests).toHaveLength(1);
});

test('empty binder without a verified saved grid never gains scan authority', async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: 'hf-storage-fixture', value: `scan-empty-${crypto.randomUUID()}`, url: baseURL! }]);
  await page.route('**/app/e2e-harness/storage/inventory?*', async (route) => {
    const response = await route.fetch(),
      body = await response.json();
    body.navigation.layouts = [];
    await route.fulfill({ response, json: body });
  });
  await page.goto(entry);
  await expect(collectionPicker(page)).toBeVisible();
  await page.getByRole('button', { name: 'Storage', exact: true }).click();
  const menu = page.getByRole('dialog', { name: 'Storage', exact: true });
  await expect(menu.getByRole('button', { name: 'Refresh', exact: true })).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Scan page', exact: true })).toHaveCount(0);
  await expect(menu.getByRole('button', { name: 'Scan card', exact: true })).toHaveCount(0);
  expect((await record(page))?.pending).toHaveLength(0);
});

test('a graded copy whose ID is raw is still chosen explicitly under Which copy?', async ({
  page,
  context,
  baseURL,
}) => {
  await context.addCookies([
    { name: 'hf-storage-fixture', value: `scan-copy-collision-${crypto.randomUUID()}`, url: baseURL! },
  ]);
  const commands: { kind: string; selection?: { kind: string; inventoryItemId?: string } }[] = [];
  await page.route('**/app/e2e-harness/storage/inventory', async (route) => {
    commands.push(...JSON.parse(route.request().postData()!).commands);
    await route.continue();
  });
  await page.goto(entry);
  await cardReview(page);
  await tapMatch(page, 'energy');
  const copies = scanned(page).getByRole('group', { name: 'Which copy?' });
  // The only copy is graded, so it is offered, never assumed.
  await expect(copies.getByRole('button')).toHaveCount(1);
  await expect(addButton(page)).toBeDisabled();
  await copies.getByRole('button', { name: 'My PSA 9', exact: true }).click();
  await review(page)
    .getByRole('combobox', { name: 'Pocket for Synthetic energy', exact: true })
    .selectOption({ label: 'Page 1 · Pocket 3 · empty pocket' });
  await addButton(page).click();
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0].kind).toBe('assign');
  expect(commands[0].selection).toMatchObject({ kind: 'existing', inventoryItemId: 'raw' });
});

test('a chosen photo opens the scan review when the camera is blocked, and saves nothing', async ({ page }) => {
  await page.addInitScript(() => {
    // Synthetic: the camera is refused, so the chosen photo is the only way in.
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => {
          throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
        },
      },
    });
  });
  await page.goto(entry);
  await scan(page, 'Scan card');
  await expect(page.getByTestId('card-scan-status')).toContainText('Choose a photo of the card instead.');
  await expect(page.getByRole('button', { name: 'Read card', exact: true })).toBeDisabled();
  // A synthetic card-sized PNG drawn in the page; the stubbed TextDetector supplies the text.
  const png = Buffer.from(
    await page.evaluate(() => {
      const canvas = Object.assign(document.createElement('canvas'), { width: 400, height: 560 });
      const c = canvas.getContext('2d')!;
      c.fillStyle = '#e8c547';
      c.fillRect(0, 0, 400, 560);
      return canvas.toDataURL('image/png').split(',')[1];
    }),
    'base64',
  );
  await page
    .getByLabel('Card photo', { exact: true })
    .setInputFiles({ name: 'card.png', mimeType: 'image/png', buffer: png });
  await expect(review(page)).toBeVisible();
  await expect(scanned(page)).toBeVisible();
  expect((await record(page))?.pending ?? []).toHaveLength(0);
});
