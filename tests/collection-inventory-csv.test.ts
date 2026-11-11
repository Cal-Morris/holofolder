import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshot } from './fixtures/binder-backup-v2';
import { createBinderBackupV2 } from '@/lib/binder-backup-v2';
import { buildInventoryCsv, previewInventoryCsv } from '@/lib/collection-inventory-csv';

const identity = {
  kind: 'card' as const,
  cardId: 'synthetic-energy',
  language: 'en' as const,
  finish: 'normal' as const,
};
const resolveCatalog = (id: string) => ({ kind: 'card' as const, id, pokemonIds: [] });
function preview(text: string) {
  let id = 0;
  return previewInventoryCsv({
    text,
    newId: () => `copy-${id++}`,
    resolve: () => [identity],
    resolveCatalog,
    savedEntryRemaining: 4,
  });
}
test('quantity and repeated Pokemon/Trainer/Energy rows preserve separate physical copies', () => {
  for (const name of ['Synthetic Trainer', 'Synthetic Energy', 'Synthetic Pokemon']) {
    const p = preview(
      `catalog id,language,finish,quantity,name\nsynthetic-energy,en,normal,3,${name}\nsynthetic-energy,en,normal,2,${name}\n`,
    );
    assert.equal(p.copies.length, 5);
    assert.equal(new Set(p.copies.map((c) => c.copyId)).size, 5);
    assert.ok(p.exceedsAllowance);
    assert.equal(p.execution, 'blocked');
    assert.match(p.arrangementLoss, /slot order/);
    assert.ok(Object.isFrozen(p.copies[0]));
  }
});
test('quantity limits, missing variants, grades and ambiguous catalog matches never choose a printing', () => {
  assert.throws(() => preview('catalog id,quantity\nx,5001'), /5,000/);
  assert.throws(() => preview('catalog id,quantity\nx,1.5'), /integer/);
  assert.match(preview('catalog id,quantity\nx,2').copies[0].problem!, /language/);
  assert.match(preview('catalog id,language,finish,quantity,grade\nx,en,normal,2,9').copies[0].problem!, /per-copy/);
  const p = previewInventoryCsv({
    text: 'catalog id,language,finish\nx,en,normal',
    newId: () => 'copy',
    resolve: () => [identity, identity],
    resolveCatalog,
    savedEntryRemaining: 10,
  });
  assert.equal(p.copies[0].identity, null);
  assert.match(p.copies[0].problem!, /exact/);
});
test('CSV exports repeated non-dex items independently and labels grading loss', () => {
  const csv = buildInventoryCsv(
    createBinderBackupV2({ snapshot: snapshot(), completeness: 'complete-owner', scope: 'all-inventory' }),
  );
  assert.equal(csv.split('\r\n').filter((r) => r.startsWith('synthetic-trainer,')).length, 3);
  assert.match(csv, /requires JSON v2/);
  assert.ok(!csv.includes('0000123'));
});
