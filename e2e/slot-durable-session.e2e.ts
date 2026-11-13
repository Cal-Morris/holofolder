import { test, expect, Harness, mockBackends, emulateStandalone } from './fixtures';
import type { Page } from '@playwright/test';
import { syntheticSlotPickerSnapshot } from '../tests/fixtures/slot-picker';
import type { SlotOfflineRecord } from '../lib/collection/slot-offline-queue';

const record = async (page: Page): Promise<SlotOfflineRecord | null> =>
  JSON.parse((await page.getByLabel('Durable record', { exact: true }).textContent()) ?? 'null');
const control = async (page: Page, mode: string) => {
  const before = Number(await page.getByLabel('Durable controls').textContent());
  await page.evaluate(
    (mode) => window.dispatchEvent(new CustomEvent('synthetic-durable-control', { detail: mode })),
    mode,
  );
  if (mode !== 'deferred')
    await expect
      .poll(async () => Number(await page.getByLabel('Durable controls').textContent()))
      .toBeGreaterThan(before);
};
const toolbar = (page: Page) => page.getByRole('region', { name: 'Layout editing', exact: true });
const append = async (page: Page) => {
  const edit = toolbar(page).getByRole('button', { name: 'Edit layout', exact: true });
  if (await edit.count()) await edit.click();
  await toolbar(page).getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'At the end of the binder', exact: true }).click();
};
const open = async (page: Page) => {
  await page.goto('/app/e2e-harness?signedIn=1&slots=durable&rows=2&cols=2');
  await expect(toolbar(page)).toBeVisible();
  await expect.poll(async () => (await record(page))?.snapshot !== null).toBe(true);
};

// All identities/transport results are synthetic. Storage and transactions are real IndexedDB.
test.describe('isolated durable slot session', () => {
  test.use({
    signedIn: true,
    harness: async ({ page, context, standalone, insets, baseURL }, provide) => {
      if (standalone) await emulateStandalone(page, insets);
      await mockBackends(page, context, { signedIn: true, baseURL });
      // These staged specs open their explicit synthetic slot surface, not authenticated startup.
      await provide(new Harness(page, insets, true));
    },
  });

  test('offline acceptance, reload, 503, interrupted retry and fresh complete ACK preserve exact IDs', async ({
    harness,
    context,
  }) => {
    const { page } = harness;
    await open(page);
    await context.setOffline(true);
    await append(page);
    await expect.poll(async () => (await record(page))?.pending.length).toBe(1);
    const original = (await record(page))!.pending[0].intent;
    await toolbar(page).getByRole('button', { name: 'Done', exact: true }).click();
    await context.setOffline(false);
    await page.reload();
    await expect.poll(async () => (await record(page))?.pending[0]?.intent).toEqual(original);
    await control(page, '503');
    await expect.poll(async () => (await record(page))?.pending[0]?.status).toBe('unavailable');
    await control(page, 'lost');
    await expect.poll(async () => (await record(page))?.pending[0]?.attempts).toBe(1);
    await expect
      .poll(async () => JSON.parse((await page.getByLabel('Durable sent IDs').textContent()) ?? '[]').length)
      .toBe(2);
    await page.reload();
    await expect.poll(async () => (await record(page))?.pending[0]?.intent).toEqual(original);
    for (const mode of ['invalid', 'partial', 'stale']) {
      await control(page, mode);
      await expect.poll(async () => (await record(page))?.pending[0]?.status).toBe('unavailable');
      expect((await record(page))!.pending[0].intent).toEqual(original);
    }
    await control(page, 'success');
    await expect.poll(async () => (await record(page))?.pending.length).toBe(0);
    expect((await record(page))!.receipts[0].intent).toEqual(original);
    await harness.expectNoHorizontalOverflow();
  });

  test('acceptance stays pending until the native IndexedDB transaction completes', async ({ harness }) => {
    const { page } = harness;
    await open(page);
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value, key) {
        const request = put.call(this, value, key);
        if (typeof key === 'string' && key.startsWith('slot-intent:')) {
          IDBObjectStore.prototype.put = put;
          let hold = true;
          document.documentElement.dataset.syntheticTransactionHeld = '1';
          window.addEventListener(
            'synthetic-release-commit',
            () => {
              hold = false;
            },
            { once: true },
          );
          const keepAlive = () => {
            if (hold) this.get('synthetic-transaction-keepalive').onsuccess = keepAlive;
          };
          keepAlive();
        }
        return request;
      };
    });
    await append(page);
    await expect(page.locator('html')).toHaveAttribute('data-synthetic-transaction-held', '1');
    await expect(page.getByLabel('Durable acceptance', { exact: true })).toHaveText('null');
    await expect(toolbar(page).getByRole('button', { name: 'Add', exact: true })).toBeDisabled();
    expect((await record(page))?.pending ?? []).toHaveLength(0);
    await page.evaluate(() => window.dispatchEvent(new Event('synthetic-release-commit')));
    await expect.poll(async () => (await record(page))?.pending.length).toBe(1);
    await expect(toolbar(page).getByRole('button', { name: 'Add', exact: true })).toBeEnabled();
  });

  for (const failure of ['abort', 'quota', 'clone'] as const) {
    test(`${failure} rejects before acceptance and retry uses the exact draft`, async ({ harness }) => {
      const { page } = harness;
      await open(page);
      await page.evaluate((failure) => {
        const original = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (value, key) {
          if (typeof key === 'string' && key.startsWith('slot-intent:')) {
            IDBObjectStore.prototype.put = original;
            if (failure === 'abort') {
              const request = original.call(this, value, key);
              this.transaction.abort();
              return request;
            }
            throw new DOMException(
              'Synthetic storage failure',
              failure === 'quota' ? 'QuotaExceededError' : 'DataCloneError',
            );
          }
          return original.call(this, value, key);
        };
      }, failure);
      await append(page);
      await expect(toolbar(page).getByRole('alert')).toContainText('Save not confirmed.');
      if (failure === 'quota') await expect(toolbar(page).getByRole('alert')).toContainText('Free some storage');
      else await expect(toolbar(page).getByRole('alert')).not.toContainText('Free some storage');
      const draft = JSON.parse((await page.getByLabel('Durable draft', { exact: true }).textContent()) ?? 'null');
      expect((await record(page))!.pending.length).toBe(0);
      await expect(page.getByLabel('Durable acceptance', { exact: true })).toHaveText('null');
      const retry = toolbar(page).getByRole('button', { name: 'Try again', exact: true });
      await harness.expectMinTapTarget(retry, 36);
      await retry.click();
      await expect.poll(async () => (await record(page))?.pending[0]?.intent).toEqual(draft.intent);
      await harness.expectNoHorizontalOverflow();
    });
  }

  for (const failure of ['notification', 'read'] as const)
    test(`commit followed by ${failure} failure stays accepted and offers refresh, never an unsaved retry`, async ({
      harness,
    }) => {
      const { page } = harness;
      await open(page);
      await page.evaluate((failure) => {
        if (failure === 'read') {
          const original = IDBObjectStore.prototype.put;
          IDBObjectStore.prototype.put = function (value, key) {
            const request = original.call(this, value, key);
            if (typeof key === 'string' && key.startsWith('slot-intent:')) {
              IDBObjectStore.prototype.put = original;
              const get = IDBObjectStore.prototype.get;
              IDBObjectStore.prototype.get = function (_key) {
                IDBObjectStore.prototype.get = get;
                throw new DOMException('Synthetic refresh read failed', 'UnknownError');
              };
            }
            return request;
          };
          return;
        }
        const original = BroadcastChannel.prototype.postMessage;
        BroadcastChannel.prototype.postMessage = function () {
          BroadcastChannel.prototype.postMessage = original;
          throw new Error('Synthetic notification failure after commit');
        };
      }, failure);
      await append(page);
      await expect(page.getByRole('alert').filter({ hasText: 'Saved on device' })).toBeVisible();
      await expect
        .poll(async () => JSON.parse((await page.getByLabel('Durable acceptance').textContent()) ?? 'null')?.status)
        .toBe('saved-on-device');
      await expect(toolbar(page).getByRole('button', { name: 'Try again', exact: true })).toHaveCount(0);
      await page.getByRole('button', { name: 'Retry refresh', exact: true }).click();
      await expect.poll(async () => (await record(page))?.pending.length).toBe(1);
    });

  test('picker clear commits through the same queue and cancellation cannot revoke it', async ({ harness }) => {
    const { page } = harness;
    await open(page);
    await page.locator('button[data-slot-id="slot-a"]').click();
    const dialog = page.getByRole('dialog', { name: /details$/ });
    await dialog.getByRole('button', { name: 'More card options', exact: true }).click();
    await dialog.getByRole('menuitem', { name: /^Take out of this pocket/ }).click();
    await expect.poll(async () => (await record(page))?.pending.length).toBe(1);
    const r = (await record(page))!;
    expect(r.optimistic!.binders[0].slots[0].inventoryItemId).toBeNull();
    expect(r.optimistic!.items.some((i) => i.id === 'item-a')).toBe(true);
    // The pocket is empty now, so its card details close by themselves.
    await expect(dialog).toBeHidden();
    await page.reload();
    await expect.poll(async () => (await record(page))?.pending[0]?.intent).toEqual(r.pending[0].intent);
  });

  test('picker storage failure retries the original new-item ID and predicates', async ({ harness }) => {
    const { page } = harness;
    const energy = {
      ...syntheticSlotPickerSnapshot().cards.find((c) => c.name === 'Energy')!,
      variants: { normal: true },
    };
    await page.route('**/app/api/tcg-card-search**', (route) => route.fulfill({ json: { cards: [energy] } }));
    await page.route('**/app/api/card-prices', (route) => route.fulfill({ json: { prices: [] } }));
    await open(page);
    const pager = page.getByRole('spinbutton', { name: 'Binder page number' });
    await pager.fill('2');
    await pager.press('Enter');
    await page.locator('button[data-slot-id="slot-g"]').click();
    const dialog = page.getByRole('dialog', { name: 'Card selector', exact: true });
    await dialog.getByRole('searchbox', { name: 'Search cards', exact: true }).fill('Energy');
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value, key) {
        if (typeof key === 'string' && key.startsWith('slot-intent:')) {
          IDBObjectStore.prototype.put = put;
          throw new DOMException('Synthetic quota', 'QuotaExceededError');
        }
        return put.call(this, value, key);
      };
    });
    await dialog.getByRole('button', { name: 'Add card Energy from Synthetic set', exact: true }).click();
    const failed = page.getByRole('dialog', { name: "Couldn't add this card" });
    await expect(failed.getByRole('alert')).toContainText('Free some storage');
    await expect(failed.getByRole('alert')).toContainText('Save not confirmed.');
    const draft = JSON.parse((await page.getByLabel('Durable draft', { exact: true }).textContent()) ?? 'null');
    expect(draft.intent.request.commands[0].selection.newItemId).toBeTruthy();
    await control(page, 'refresh');
    await failed.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect.poll(async () => (await record(page))?.pending[0]?.intent).toEqual(draft.intent);
    expect((await record(page))!.optimistic!.binders[0].slots.find((s) => s.id === 'slot-g')!.inventoryItemId).toBe(
      draft.intent.request.commands[0].selection.newItemId,
    );
  });

  test('same-owner relink fences an in-flight replay, account and owner changes retain old scoped records', async ({
    harness,
  }) => {
    const { page } = harness;
    await open(page);
    await append(page);
    await expect.poll(async () => (await record(page))?.pending.length).toBe(1);
    const old = (await record(page))!,
      id = old.pending[0].intent.request.operationId;
    await control(page, 'deferred');
    await expect.poll(async () => (await record(page))?.pending[0]?.status).toBe('sending');
    const epoch = await page.getByLabel('Durable session').textContent();
    await control(page, 'relink');
    await expect(page.getByLabel('Durable session')).not.toHaveText(epoch!);
    await page.evaluate(() => window.dispatchEvent(new Event('synthetic-durable-release')));
    await expect.poll(async () => (await record(page))?.pending[0]?.intent.request.operationId).toBe(id);
    expect((await record(page))!.receipts).toHaveLength(0);
    for (const mode of ['account', 'owner']) {
      await control(page, mode);
      await expect.poll(async () => (await record(page))?.pending.length).toBe(0);
      await expect(toolbar(page).getByRole('button', { name: 'Edit layout', exact: true })).toBeVisible();
    }
  });

  test('two real tabs serialize queue commits and the send lease', async ({ harness, context }) => {
    const { page } = harness;
    await open(page);
    await append(page);
    await expect.poll(async () => (await record(page))?.pending.length).toBe(1);
    const other = await context.newPage();
    await open(other);
    const originalId = (await record(page))!.pending[0].intent.request.operationId;
    await control(page, 'deferred');
    await expect.poll(async () => (await record(page))?.pending[0]?.status).toBe('sending');
    await control(other, 'success'); // a live lease cannot be resumed/replaced
    await expect(other.getByLabel('Durable sent IDs')).toHaveText('[]');
    await append(other);
    await expect.poll(async () => (await record(other))?.pending.length).toBe(2);
    await page.evaluate(() => window.dispatchEvent(new Event('synthetic-durable-release')));
    await expect.poll(async () => (await record(page))?.receipts[0]?.operationId).toBe(originalId);
    await control(other, 'refresh');
    await expect.poll(async () => (await record(other))?.pending.length).toBe(1);
    await control(other, 'success');
    await expect.poll(async () => (await record(other))?.pending.length).toBe(0);
    await other.close();
  });

  test('hard conflicts stay visible with their original intent', async ({ harness }) => {
    const { page } = harness;
    await open(page);
    await append(page);
    await expect.poll(async () => (await record(page))?.pending.length).toBe(1);
    const original = (await record(page))!.pending[0].intent;
    await control(page, '409');
    await expect.poll(async () => (await record(page))?.pending[0]?.status).toBe('conflict');
    expect((await record(page))!.pending[0].intent).toEqual(original);
  });
  test('signout hides writable state, guest replay never uploads, signin restores the original queue', async ({
    harness,
  }) => {
    const { page } = harness;
    await open(page);
    await append(page);
    await expect.poll(async () => (await record(page))?.pending.length).toBe(1);
    const original = (await record(page))!.pending[0].intent;
    await control(page, 'signout');
    await expect.poll(async () => (await record(page))?.scope.accountId).toBeNull();
    expect((await record(page))!.pending).toHaveLength(0);
    await expect(toolbar(page)).toHaveCount(0);
    await control(page, 'success');
    await expect(page.getByLabel('Durable sent IDs')).toHaveText('[]');
    await control(page, 'signin');
    await expect.poll(async () => (await record(page))?.pending[0]?.intent).toEqual(original);
    await expect(toolbar(page)).toBeVisible();
  });

  test('read-only callers receive no writable picker or layout boundary', async ({ harness }) => {
    const { page } = harness;
    await page.goto('/app/e2e-harness?signedIn=1&readOnly=1&slots=durable&rows=2&cols=2');
    const slot = page.locator('button[data-slot-id="slot-a"]');
    await expect(slot).toBeVisible();
    await slot.click();
    const dialog = page.getByRole('dialog', { name: /details$/ });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Move card to Unassigned' })).toHaveCount(0);
    await expect(toolbar(page)).toHaveCount(0);
    expect((await record(page))!.pending).toHaveLength(0);
  });
});
