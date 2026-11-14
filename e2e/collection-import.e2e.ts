import { test, expect, mockBackends, emulateStandalone, storageAction } from './fixtures';
import type { Page } from '@playwright/test';
import type { SlotOfflineRecord } from '../lib/collection/slot-offline-queue';

// Synthetic CSV and catalogue answers; the harness binder is the synthetic 1,025-pocket National Dex.
const entry = '/app/e2e-harness?signedIn=1&browserHost=1&binder=22222222-2222-4222-8222-222222222222';
const csv = [
  'Name,Set,Number,Finish,Quantity',
  'Blastoise,Base Set,2/102,holo,1',
  'Bulbasaur,Base Set,44/102,normal,1',
  'Synthetic Trainer,Base Set,90/102,normal,1',
  'Charizard,Base Set,4/102,1st Edition,1',
  'Mew,Unknown Set,8,normal,1',
].join('\n');
const cards: Record<string, object> = {
  Blastoise: { id: 'base1-2', localId: '2', name: 'Blastoise', dexIds: [9], variants: { holo: true } },
  Bulbasaur: { id: 'base1-44', localId: '44', name: 'Bulbasaur', dexIds: [1], variants: { normal: true } },
  'Synthetic Trainer': { id: 'synthetic-import-trainer', localId: '90', name: 'Synthetic Trainer', dexIds: [] },
};
async function record(page: Page) {
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
    return rows.find((r) => !!r && typeof r === 'object' && 'pending' in r && 'scope' in r) as
      SlotOfflineRecord | undefined;
  });
}

test.beforeEach(async ({ page, context, standalone, insets, baseURL }) => {
  if (standalone) await emulateStandalone(page, insets);
  await mockBackends(page, context, { signedIn: true, baseURL });
  await context.addCookies([{ name: 'hf-storage-fixture', value: `import-${crypto.randomUUID()}`, url: baseURL! }]);
  await page.route('**/app/api/collection-import/resolve', async (route) => {
    const { lookups } = route.request().postDataJSON() as { lookups: { cardName: string; finish: string }[] };
    const results = lookups.map((l) =>
      cards[l.cardName]
        ? {
            card: { ...cards[l.cardName], language: 'en', set: { id: 'base1', name: 'Base Set' } },
            finish: l.finish,
          }
        : { problem: 'No card in our catalogue matches this name, set, number and print.' },
    );
    await route.fulfill({ json: { results } });
  });
});

test('a CSV import fills the pocket made for a card, appends new ones and lists rows it cannot match', async ({
  page,
}) => {
  await page.goto(entry);
  await (await storageAction(page, 'Import cards')).click();
  const dialog = page.getByRole('dialog', { name: 'Import cards', exact: true });
  await dialog.getByLabel('Select CSV file').setInputFiles({
    name: 'synthetic-import.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });
  const preview = dialog.getByRole('region', { name: 'Import preview' });
  await expect(preview).toContainText('From a spreadsheet: 3 cards ready to add to My binder.');
  await expect(preview).toContainText('1 card goes into the pocket made for it');
  await expect(preview).toContainText('1 card gets a new pocket at the end of the binder');
  await expect(preview).toContainText('1 card is kept in your collection without a pocket');
  const skipped = dialog.getByRole('list', { name: 'Rows not imported' });
  await expect(skipped).toContainText('Line 5: Charizard');
  await expect(skipped).toContainText('1st Edition');
  await expect(skipped).toContainText('Line 6: Mew');
  await dialog.getByRole('button', { name: 'Add 3 cards', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Added 3 cards to My binder')).toBeVisible();
  await expect.poll(async () => (await record(page))?.pending.length, { timeout: 15_000 }).toBe(0);
  const snapshot = (await record(page))!.snapshot!;
  expect(snapshot.items).toHaveLength(5);
  const placed = new Map(snapshot.placements.map((p) => [p.slotId, p.inventoryItemId]));
  const blastoise = snapshot.items.find((i) => i.identity.kind === 'card' && i.identity.cardId === 'base1-2')!;
  expect(placed.get('synthetic-dex-9')).toBe(blastoise.id);
  const slots = snapshot.binders[0].slots;
  expect(slots).toHaveLength(1026);
  expect(slots.at(-1)?.target).toMatchObject({ kind: 'card', cardId: 'synthetic-import-trainer' });
});
