import { test, expect, mockBackends, emulateStandalone, Harness } from './fixtures';
import type { Page } from '@playwright/test';
// Real BrowserCollectionSession, IDB queue and HTTP storage bridge over a synthetic ledger (tests/fixtures/storage-command-harness.ts).
const collection = '22222222-2222-4222-8222-222222222222';
const entry = `/app/e2e-harness?signedIn=1&browserHost=1&binder=${collection}`;
const card = {
  id: 'synthetic-pick-snorlax',
  localId: '9',
  name: 'Synthetic Pick Snorlax',
  image: 'https://assets.tcgdex.net/en/mock/synthetic-pick/9/high.webp',
  set: { id: 'synthetic-pick', name: 'Synthetic pick set', officialCardCount: 9, releaseDate: '2026-01-01' },
  rarity: 'Common',
  variants: { normal: true, holo: true },
};
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
    return (
      rows.find(
        (
          r,
        ): r is {
          pending: { status: string; intent: { request: { operationId: string } } }[];
          receipts: { operationId: string; outcome: string }[];
        } => !!r && typeof r === 'object' && 'pending' in r,
      ) ?? null
    );
  });
}
test.beforeEach(async ({ page, context, standalone, insets, baseURL }) => {
  if (standalone) await emulateStandalone(page, insets);
  await mockBackends(page, context, { signedIn: true, baseURL });
  await context.addCookies([{ name: 'hf-storage-fixture', value: `pick-${crypto.randomUUID()}`, url: baseURL! }]);
  await page.route('**/app/api/tcgdex-cache**', (route) =>
    route.fulfill({ json: { cards: [card], source: 'mirror' } }),
  );
});
test('a species pocket pick of an unowned printing saves through the durable queue and syncs', async ({
  page,
  insets,
}) => {
  const commands: string[] = [];
  await page.route('**/app/e2e-harness/storage/inventory', async (route) => {
    if (route.request().method() === 'POST') commands.push(route.request().headers()['x-storage-operation']);
    await route.continue();
  });
  await page.goto(entry);
  const pocket = page.locator('[data-slot-id="synthetic-slot-0"]');
  await pocket.click();
  const selector = page.getByRole('dialog', { name: 'Card selector' });
  await selector.getByRole('button', { name: 'Add card Synthetic Pick Snorlax from Synthetic pick set' }).click();
  await page
    .getByRole('dialog', { name: 'Which variant?' })
    .getByRole('button', { name: /^Add Normal/ })
    .click();
  await expect(page.getByRole('dialog', { name: "Couldn't add this card" })).toHaveCount(0);
  // The existing selector closes straight onto the binder; no slot/draft form in between.
  await expect(selector).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(async () => (await record(page))?.receipts.length, { timeout: 15_000 }).toBe(1);
  const saved = (await record(page))!;
  expect(saved.pending).toHaveLength(0);
  expect(saved.receipts[0].outcome).toBe('acknowledged');
  expect(commands).toEqual([saved.receipts[0].operationId]);
  await page.reload();
  await expect(page.locator('[data-slot-id="synthetic-slot-0"]')).toContainText('Synthetic Pick Snorlax');
  await new Harness(page, insets, true).expectNoHorizontalOverflow();
});

test('a free pocket pick in the visual selector saves an unowned printing through the durable queue and syncs', async ({
  page,
}) => {
  await page.route('**/app/api/tcg-card-search**', (route) =>
    route.fulfill({ json: { cards: [{ ...card, language: 'en', dexIds: [143] }] } }),
  );
  await page.goto(entry);
  await page.locator('[data-slot-id="synthetic-slot-1"]').click();
  // A free pocket uses the same visual selector, searching every card; never a slot form.
  const selector = page.getByRole('dialog', { name: 'Card selector' });
  await expect(page.getByRole('dialog', { name: /details$/ })).toHaveCount(0);
  await selector.getByRole('searchbox', { name: 'Search cards' }).fill('Synthetic Pick');
  await selector.getByRole('button', { name: 'Add card Synthetic Pick Snorlax from Synthetic pick set' }).click();
  await page
    .getByRole('dialog', { name: 'Which variant?' })
    .getByRole('button', { name: /^Add Holo/ })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(async () => (await record(page))?.receipts.length, { timeout: 15_000 }).toBe(1);
  expect((await record(page))!.receipts[0].outcome).toBe('acknowledged');
  await page.reload();
  await expect(page.locator('[data-slot-id="synthetic-slot-1"]')).toContainText('Synthetic Pick Snorlax');
});

test('dismissing the selector or the variant sheet queues nothing', async ({ page, insets }) => {
  await page.goto(entry);
  const h = new Harness(page, insets, true);
  await page.locator('[data-slot-id="synthetic-slot-0"]').click();
  const selector = page.getByRole('dialog', { name: 'Card selector' });
  await selector.getByRole('button', { name: 'Add card Synthetic Pick Snorlax from Synthetic pick set' }).click();
  await h.swipeDown(page.getByRole('dialog', { name: 'Which variant?' }));
  await expect(page.getByRole('dialog', { name: 'Which variant?' })).toHaveCount(0);
  await expect(selector).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(selector).toHaveCount(0);
  expect((await record(page))?.pending ?? []).toHaveLength(0);
  expect((await record(page))?.receipts ?? []).toHaveLength(0);
});
