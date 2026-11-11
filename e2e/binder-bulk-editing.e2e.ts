import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import type { SlotOfflineRecord } from '../lib/collection/slot-offline-queue';

const record = async (page: Page): Promise<SlotOfflineRecord> =>
  JSON.parse((await page.getByLabel('Bulk record', { exact: true }).textContent()) ?? 'null');
const bulk = (page: Page) => page.getByRole('region', { name: 'Bulk layout actions', exact: true });
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const select = async (page: Page, n: number) => button(page, `Select slot ${n}`).click();
const control = async (page: Page, mode: string) => {
  const before = Number(await page.getByLabel('Bulk controls').textContent());
  await page.evaluate(
    (mode) => window.dispatchEvent(new CustomEvent('synthetic-bulk-control', { detail: mode })),
    mode,
  );
  await expect.poll(async () => Number(await page.getByLabel('Bulk controls').textContent())).toBeGreaterThan(before);
};
const open = async (page: Page) => {
  await page.goto('/app/e2e-harness/bulk-layout');
  await expect(button(page, 'Edit layout')).toBeVisible();
};
const edit = async (page: Page) => button(page, 'Edit layout').click();
const order = async (page: Page) => (await record(page)).optimistic!.binders[0].slots.map((s) => s.id);

// Synthetic identity and transport only. Queue parsing, projection and IndexedDB commit are real.
test.describe('bulk layout private durable boundary', () => {
  test('Browse never selects, cancelled pointer never executes, explicit keyboard edit works', async ({ harness }) => {
    const { page } = harness;
    await open(page);
    await expect(bulk(page)).toHaveCount(0);
    const visible = page.getByLabel('Visible synthetic slots');
    await visible.dispatchEvent('pointerdown', { pointerId: 1, clientX: 20, clientY: 20 });
    await visible.dispatchEvent('pointermove', { pointerId: 1, clientX: 100, clientY: 20 });
    await visible.dispatchEvent('pointercancel', { pointerId: 1 });
    await visible.dispatchEvent('contextmenu');
    await button(page, 'Edit layout').focus();
    await page.keyboard.press('Enter');
    await visible.dispatchEvent('click', { detail: 1 });
    await expect(bulk(page)).toContainText('0 selected');
    const target = button(page, 'Select slot 1');
    for (const cancel of ['pointercancel', 'pointermove']) {
      await target.dispatchEvent('pointerdown', { clientX: 20, clientY: 20 });
      await target.dispatchEvent(cancel, { clientX: 100, clientY: 20 });
      await target.dispatchEvent('click', { detail: 1 });
      await expect(target).toHaveAttribute('aria-pressed', 'false');
    }
    await target.focus();
    await page.keyboard.press('Space');
    await expect(target).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await record(page)).pending.length).toBe(0);
  });

  test('noncontiguous keyboard move is one durable group and retains whole slots', async ({ harness }) => {
    const { page } = harness;
    await open(page);
    const before = (await record(page)).optimistic!;
    const browseBounds = await page.getByRole('region', { name: 'Layout editing', exact: true }).boundingBox();
    await edit(page);
    await select(page, 3);
    await select(page, 1);
    await expect(bulk(page)).toContainText('2 selected');
    await page.getByLabel('Bulk destination slot').selectOption('slot-a');
    await expect(button(page, 'Move group after')).toBeDisabled();
    await page.getByLabel('Bulk destination slot').selectOption('slot-d');
    await button(page, 'Move group after').focus();
    await page.keyboard.press('Enter');
    await expect
      .poll(() => order(page))
      .toEqual(['slot-b', 'slot-d', 'slot-a', 'slot-c', 'slot-e', 'slot-f', 'slot-g']);
    await expect(bulk(page)).toContainText('Saved on device');
    const saved = (await record(page))!;
    expect(saved.pending).toHaveLength(1);
    expect(
      'commands' in saved.pending[0].intent.request ? saved.pending[0].intent.request.commands : undefined,
    ).toHaveLength(1);
    expect(saved.optimistic!.items).toEqual(before.items);
    expect(saved.optimistic!.placements).toEqual(before.placements);
    for (const slot of saved.optimistic!.binders[0].slots)
      expect(slot).toEqual(before.binders[0].slots.find((s) => s.id === slot.id));
    expect(
      JSON.parse((await page.getByLabel('Bulk acceptance', { exact: true }).textContent()) ?? 'null'),
    ).toMatchObject({ status: 'saved-on-device', operationId: saved.pending[0].intent.request.operationId });
    for (const el of await bulk(page).getByRole('button').all()) await harness.expectMinTapTarget(el, 36);
    await harness.expectNoHorizontalOverflow();
    await harness.expectWithinSafeViewport(bulk(page));
    console.log(
      'bulk geometry',
      test.info().project.name,
      JSON.stringify({ browseBounds, editingBounds: await bulk(page).boundingBox() }),
    );
  });

  test('selection survives paging, select page excludes padding, clear and Done preserve queue', async ({
    harness,
  }) => {
    const { page } = harness;
    await open(page);
    await edit(page);
    await select(page, 1);
    await button(page, 'Next page').click();
    await button(page, 'Select page').click();
    await expect(bulk(page)).toContainText('4 selected');
    await expect(bulk(page).getByRole('button', { name: /^Select slot/ })).toHaveCount(3);
    await button(page, 'Move group to beginning').click();
    await expect
      .poll(() => order(page))
      .toEqual(['slot-a', 'slot-e', 'slot-f', 'slot-g', 'slot-b', 'slot-c', 'slot-d']);
    await button(page, 'Previous page').click();
    await expect(button(page, 'Select slot 1')).toHaveAttribute('aria-pressed', 'true');
    await button(page, 'Clear selection').click();
    await expect(bulk(page)).toContainText('0 selected');
    await button(page, 'Done').click();
    await edit(page);
    await expect(bulk(page)).toContainText('0 selected');
    expect((await record(page)).pending).toHaveLength(1);
  });

  test('page and N insertion shift at exact anchors across pages, grid changes only repaginate', async ({
    harness,
  }) => {
    const { page } = harness;
    await open(page);
    await edit(page);
    await page.getByLabel('Bulk destination slot').selectOption('slot-d');
    await button(page, 'Insert page after').click();
    await expect.poll(async () => (await record(page)).pending.length).toBe(1);
    const saved = (await record(page)).pending[0].intent;
    expect('commands' in saved.request ? saved.request.commands[0] : undefined).toMatchObject({
      kind: 'create',
      beforeSlotId: 'slot-e',
    });
    const slots = await order(page);
    expect(slots.slice(0, 4)).toEqual(['slot-a', 'slot-b', 'slot-c', 'slot-d']);
    expect(slots.slice(8)).toEqual(['slot-e', 'slot-f', 'slot-g']);
    expect(new Set(slots).size).toBe(11);
    await page.getByLabel('Synthetic grid').selectOption('1x1');
    await edit(page);
    await button(page, 'Select page').click();
    await expect(bulk(page)).toContainText('1 selected');
    await page.getByLabel('Bulk destination slot').selectOption('slot-a');
    await button(page, 'Insert page before').click();
    await expect.poll(async () => (await record(page)).pending.length).toBe(2);
    await page.getByLabel('Synthetic grid').selectOption('2x3');
    await edit(page);
    await expect(bulk(page)).toContainText('0 selected');
    await page.getByLabel('Free slots to insert').fill('3');
    await button(page, 'Append N free slots').click();
    await expect.poll(async () => (await record(page)).pending.length).toBe(3);
    expect(await order(page)).toHaveLength(15);
    expect((await record(page)).pending[0].intent).toEqual(saved);
    await page.getByLabel('Free slots to insert').fill('257');
    await button(page, 'Append N free slots').click();
    await expect(bulk(page).getByRole('alert')).toContainText('1 to 256');
    expect((await record(page)).pending).toHaveLength(3);
  });

  test('layout review retains selected IDs, a partner copy change blocks the whole selection', async ({ harness }) => {
    const { page } = harness;
    await open(page);
    await edit(page);
    await select(page, 1);
    await select(page, 3);
    await control(page, 'layout');
    await expect(bulk(page)).toContainText('2 selected');
    await expect(button(page, 'Move group to end')).toBeDisabled();
    await expect(bulk(page)).toContainText('selected copies are unchanged');
    await button(page, 'Use latest layout').click();
    await expect(button(page, 'Move group to end')).toBeEnabled();
    await control(page, 'copy');
    await expect(bulk(page)).toContainText('Selected slots or copies changed');
    await expect(bulk(page)).toContainText('2 selected');
    await expect(button(page, 'Move group to end')).toBeDisabled();
    await expect(button(page, 'Use latest layout')).toHaveCount(0);
    expect((await record(page)).pending).toHaveLength(0);
    await button(page, 'Clear selection').click();
    await expect(bulk(page)).toContainText('0 selected');
  });

  test('aborted transaction never claims saved, retry retains the complete original group', async ({ harness }) => {
    const { page } = harness;
    await open(page);
    await edit(page);
    await select(page, 1);
    await select(page, 3);
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value, key) {
        const request = put.call(this, value, key);
        if (typeof key === 'string' && key.startsWith('slot-intent:')) {
          IDBObjectStore.prototype.put = put;
          this.transaction.abort();
        }
        return request;
      };
    });
    await button(page, 'Move group to end').click();
    await expect(bulk(page)).toContainText('Nothing is confirmed');
    const original = JSON.parse((await page.getByLabel('Bulk attempted draft').textContent()) ?? 'null');
    expect((await record(page)).pending).toHaveLength(0);
    await expect(page.getByLabel('Bulk acceptance', { exact: true })).toHaveText('null');
    await button(page, 'Retry same group').click();
    await expect.poll(async () => (await record(page)).pending[0]?.intent).toEqual(original.intent);
    await expect(bulk(page)).toContainText('2 selected');
  });

  test('whole-group acceptance waits for transaction completion, Done during commit retains accepted work', async ({
    harness,
  }) => {
    const { page } = harness;
    await open(page);
    await edit(page);
    await select(page, 1);
    await select(page, 3);
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value, key) {
        const request = put.call(this, value, key);
        if (typeof key === 'string' && key.startsWith('slot-intent:')) {
          IDBObjectStore.prototype.put = put;
          let hold = true;
          window.addEventListener(
            'synthetic-bulk-release-commit',
            () => {
              hold = false;
            },
            { once: true },
          );
          const keepAlive = () => {
            if (hold) this.get('synthetic-keepalive').onsuccess = keepAlive;
          };
          keepAlive();
        }
        return request;
      };
    });
    await button(page, 'Move group to end').click();
    await expect(bulk(page)).toContainText('Saving group on device');
    await expect(page.getByLabel('Bulk acceptance', { exact: true })).toHaveText('null');
    await expect(button(page, 'Clear selection')).toBeDisabled();
    await button(page, 'Done').click();
    await page.evaluate(() => window.dispatchEvent(new Event('synthetic-bulk-release-commit')));
    await expect.poll(async () => (await record(page)).pending.length).toBe(1);
    await edit(page);
    await expect(bulk(page)).toContainText('0 selected');
    expect(await order(page)).toEqual(['slot-b', 'slot-d', 'slot-e', 'slot-f', 'slot-g', 'slot-a', 'slot-c']);
  });

  test('offline accepted group survives Done, view/scope changes and reload, conflict retains it atomically', async ({
    harness,
    context,
  }) => {
    const { page } = harness;
    const writes: string[] = [];
    page.on('request', (r) => {
      if (r.method() !== 'GET') writes.push(r.url());
    });
    await open(page);
    await edit(page);
    await select(page, 1);
    await select(page, 3);
    await context.setOffline(true);
    await button(page, 'Move group to end').click();
    await expect.poll(async () => (await record(page)).pending.length).toBe(1);
    const original = (await record(page)).pending[0].intent;
    await button(page, 'Change view').click();
    await expect(bulk(page)).toHaveCount(0);
    await button(page, 'Change view').click();
    await edit(page);
    await expect(bulk(page)).toContainText('0 selected');
    await select(page, 1);
    await control(page, 'scope');
    await edit(page);
    await expect(bulk(page)).toContainText('0 selected');
    await context.setOffline(false);
    await page.reload();
    await expect(button(page, 'Edit layout')).toBeVisible();
    await expect.poll(async () => (await record(page)).pending[0]?.intent).toEqual(original);
    await control(page, 'conflict');
    await expect.poll(async () => (await record(page)).pending[0]?.status).toBe('conflict');
    expect((await record(page)).pending[0].intent).toEqual(original);
    expect(writes).toEqual([]);
  });

  test('fresh complete synthetic ACK settles one group, duplicate replay cannot apply it twice', async ({
    harness,
  }) => {
    const { page } = harness;
    await open(page);
    await edit(page);
    await select(page, 1);
    await select(page, 3);
    await button(page, 'Move group to end').click();
    await expect.poll(async () => (await record(page)).pending.length).toBe(1);
    const original = (await record(page)).pending[0].intent;
    const moved = await order(page);
    await control(page, 'success');
    await expect.poll(async () => (await record(page)).pending.length).toBe(0);
    expect((await record(page)).receipts[0].intent).toEqual(original);
    await control(page, 'success');
    expect(await order(page)).toEqual(moved);
    expect((await record(page)).receipts).toHaveLength(1);
  });
});
