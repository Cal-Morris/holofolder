import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rawRestoreFixture } from './fixtures/raw-restore';
import { planRawContentRestore } from '@/lib/raw-restore-plan';
import { parseRawRestoreCommand, isRawRestoreRejection } from '@/lib/domain/raw-restore';
import { isRawRestoreReceipt } from '@/lib/collection/raw-restore-delivery';
import { RAW_RESTORE_V2_LIMITS } from '@/lib/domain/raw-restore';
import { rawRestoreV2GraphBytes } from '@/lib/raw-restore-envelope';
import { rawRestoreSchema } from '@/lib/developer-api/storage';

async function convertedFixture(reordered = false) {
  const f = await rawRestoreFixture();
  const file = JSON.parse(f.input.text);
  // A converted binder is one whose copied manifest is the legacy National Dex preset.
  const manifest = { source: { id: 'national-dex', version: 'legacy-v1' }, name: 'Synthetic converted', entries: [] };
  f.snapshot.binders[0].presetManifest = manifest;
  file.binders[0].presetManifest = manifest;
  if (reordered) file.binders[0].slots.reverse();
  f.input.current = await f.brand(f.snapshot);
  f.input.text = JSON.stringify(file);
  return f;
}
for (const reordered of [false, true])
  test(`v4 preserves stable IDs with ${reordered ? 'changed' : 'unchanged'} order`, async () => {
    const f = await convertedFixture(reordered),
      r = planRawContentRestore(f.input).request;
    assert.equal(r.version, 4);
    if (r.version !== 4) throw new Error('fixture');
    assert.deepEqual(parseRawRestoreCommand(r), r);
    assert.equal(rawRestoreSchema.safeParse(r).success, true);
    assert.deepEqual(
      r.items.map((i) => i.itemId),
      ['copy-a', 'copy-b'],
    );
    assert.equal(
      r.slots.some((p) => 'legacySource' in p.after),
      false,
    );
    const receipt = {
      version: 4 as const,
      changed: true as const,
      inventoryRevision: r.inventoryRevision + 1,
      collectionId: r.collection.collectionId,
      collectionVersion: r.collection.version + 1,
      layoutRevision: r.collection.layoutRevision + (reordered ? 1 : 0),
      slotOrder: r.slotOrder,
      slotIds: r.slotOrder.after,
      releasedItemIds: r.releaseItemIds,
    };
    assert.equal(isRawRestoreReceipt(receipt, r), true);
    assert.equal(isRawRestoreReceipt({ ...receipt, version: 3 }, r), false);
    assert.equal(isRawRestoreReceipt({ ...receipt, layoutRevision: receipt.layoutRevision + 1 }, r), false);
    assert.equal(
      isRawRestoreRejection(
        {
          version: 4,
          outcome: 'rejected',
          operationId: r.operationId,
          code: 'raw_restore_content_conflict',
          inventoryRevision: r.inventoryRevision,
        },
        r.operationId,
      ),
      true,
    );
    assert.ok(rawRestoreV2GraphBytes(f.snapshot, f.snapshot.binders[0]) < RAW_RESTORE_V2_LIMITS.graphBytes);
  });
test('converted review refuses grades and changed metadata', async () => {
  for (const mutation of ['grade', 'metadata']) {
    const f = await convertedFixture(),
      file = JSON.parse(f.input.text);
    if (mutation === 'grade')
      file.items[0].grading = {
        provider: { kind: 'known', id: 'psa' },
        grade: '10',
        scale: null,
        designation: null,
        subgrades: [],
        certificate: null,
        holder: null,
        label: { variant: null, assetIds: [] },
      };
    if (mutation === 'metadata') file.items[0].acquiredAt = '2020-01-01';
    assert.throws(() => planRawContentRestore({ ...f.input, text: JSON.stringify(file) }), Error, mutation);
  }
});
