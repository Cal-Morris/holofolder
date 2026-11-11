import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readCompleteSnapshotRows } from '@/lib/collection/slot-snapshot';

// Synthetic rows exceed PostgREST's default 1000-row cap.
test('collects 1025 rows and requires explicit final count/revision', async () => {
  const rows = Array.from({ length: 1025 }, (_, id) => ({ id: String(id) }));
  const read = async (after: string | null) => {
    const from = after === null ? 0 : Number(after),
      next = from + 500;
    return {
      inventoryRevision: 7,
      total: rows.length,
      rows: rows.slice(from, next),
      next: next < rows.length ? String(next) : null,
    };
  };
  assert.deepEqual(await readCompleteSnapshotRows(read, 7, (row) => row.id), rows);
});
test('partial pages, mid-read revision changes, repeated cursors and duplicate identities fail closed', async () => {
  await assert.rejects(
    readCompleteSnapshotRows(
      async () => ({ inventoryRevision: 1, total: 1025, rows: [{ id: 'one' }], next: null }),
      1,
      (r) => r.id,
    ),
    /partial/,
  );
  await assert.rejects(
    readCompleteSnapshotRows(
      async (after) => ({
        inventoryRevision: after === null ? 1 : 2,
        total: 2,
        rows: [{ id: after ?? 'first' }],
        next: after === null ? 'second' : null,
      }),
      1,
      (r) => r.id,
    ),
    /changing/,
  );
  await assert.rejects(
    readCompleteSnapshotRows(
      async () => ({ inventoryRevision: 1, total: 2, rows: [{ id: 'one' }], next: 'same' }),
      1,
      (r) => r.id,
    ),
    /duplicate|page/,
  );
  await assert.rejects(
    readCompleteSnapshotRows(
      async () => ({ inventoryRevision: 1, total: 2, rows: [{ id: 'one' }, { id: 'one' }], next: null }),
      1,
      (r) => r.id,
    ),
    /duplicate/,
  );
});

test('actual slot page continuation carries all independent revisions beyond 1000 slots', async () => {
  const { readAllSlotPages } = await import('@/lib/collection/slot-snapshot');
  const result = await readAllSlotPages(async (continuation) => {
    if (continuation)
      assert.deepEqual(
        [continuation.inventoryRevision, continuation.collectionVersion, continuation.layoutRevision],
        [7, 2, 3],
      );
    const from = continuation === null ? 0 : continuation.afterPosition + 1;
    const slots = Array.from({ length: Math.min(500, 1025 - from) }, (_, i) => ({
      id: `synthetic-${from + i}`,
      position: from + i,
    }));
    return {
      inventoryRevision: 7,
      collectionVersion: 2,
      layoutRevision: 3,
      slots,
      nextPosition: from + slots.length < 1025 ? slots.at(-1)!.position : null,
    };
  });
  assert.equal(result.slots.length, 1025);
  await assert.rejects(
    readAllSlotPages(async (continuation) => ({
      inventoryRevision: continuation ? 8 : 7,
      collectionVersion: 2,
      layoutRevision: 3,
      slots: [{ id: 'one', position: 0 }],
      nextPosition: 0,
    })),
    /revision/,
  );
});
