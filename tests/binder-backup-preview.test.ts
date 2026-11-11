import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshot } from './fixtures/binder-backup-v2';
import { createBinderBackupV2 } from '@/lib/binder-backup-v2';
import { assertBackupPreviewCurrent, previewBinderBackupImport } from '@/lib/binder-backup-preview';

const resolveCatalog = (id: string) => ({ kind: 'card' as const, id, pokemonIds: [1, 2] });
function options() {
  const current = snapshot();
  let sequence = 0;
  const backup = createBinderBackupV2({ snapshot: current, completeness: 'complete-owner', scope: 'all-inventory' });
  return {
    text: JSON.stringify(backup),
    current,
    completeness: 'complete-owner' as const,
    mode: 'additional-copies' as const,
    operationId: 'synthetic-import-operation',
    newId: () => `generated-${sequence++}`,
    resolveCatalog,
    savedEntryRemaining: 5000,
    decisions: backup.items.map((i) => ({ sourceItemId: i.id, kind: 'add-copy' as const })),
  };
}
test('same-owner retry is a no-op only with trusted provenance, partner changes block restore', () => {
  const o = options();
  const restore = {
    ...o,
    mode: 'restore-current-owner' as const,
    decisions: [],
    trustedSource: structuredClone(o.current),
  };
  assert.equal(previewBinderBackupImport(restore).execution.kind, 'noop');
  assert.equal(previewBinderBackupImport(restore).execution.kind, 'noop');
  assert.throws(() => previewBinderBackupImport({ ...restore, trustedSource: undefined }), /provenance/);
  const p = previewBinderBackupImport(restore);
  o.current.items[0].version++;
  assert.throws(() => assertBackupPreviewCurrent(p, o.current), /stale/);
  assert.equal(previewBinderBackupImport(restore).execution.kind, 'blocked');
  o.current.placements[0].version++;
  assert.throws(() => assertBackupPreviewCurrent(p, o.current), /stale/);
});
test('explicit additional copies remain distinct with frozen IDs and one parsed atomic request', () => {
  const o = options(),
    before = structuredClone(o.current);
  const p = previewBinderBackupImport(o);
  assert.equal(p.addedCopies, 4);
  assert.equal(new Set(p.proposed.items.map((i) => i.id)).size, 4);
  assert.equal(p.proposed.placements.length, 0);
  assert.equal(p.execution.kind, 'inventory-command');
  if (p.execution.kind !== 'inventory-command') assert.fail();
  assert.equal(p.execution.request.commands.length, 4);
  assert.ok(Object.isFrozen(p.execution.request.commands[0]));
  const replay = structuredClone(p.execution.request);
  assert.deepEqual(replay, p.execution.request);
  assert.deepEqual(o.current, before);
  assert.equal(previewBinderBackupImport({ ...options(), decisions: [] }).execution.kind, 'blocked');
  assert.equal(previewBinderBackupImport({ ...options(), savedEntryRemaining: 3 }).execution.kind, 'blocked');
  assert.equal(previewBinderBackupImport({ ...options(), resolveCatalog: () => undefined }).execution.kind, 'blocked');
});
test('foreign arrangement remaps slots, preserves targets, adds no implicit ownership and cannot partially execute', () => {
  const o = options();
  const p = previewBinderBackupImport({
    ...o,
    mode: 'arrangement',
    destinationCollectionId: o.current.collections[0].id,
    decisions: [],
  });
  assert.equal(p.addedCopies, 0);
  assert.equal(p.proposed.items.length, 0);
  assert.ok(p.proposed.binders[0].slots.every((s) => s.id.startsWith('generated-') && s.inventoryItemId === null));
  assert.equal(p.execution.kind, 'blocked');
  assert.equal(p.addedWants, 1);
  assert.deepEqual(p.proposed.binders[0].slots[0].target, o.current.binders[0].slots[0].target);
  const moved = previewBinderBackupImport({
    ...options(),
    mode: 'arrangement',
    destinationCollectionId: o.current.collections[0].id,
    decisions: [{ sourceItemId: 'item-0', kind: 'use-existing', itemId: 'item-0' }],
  });
  assert.equal(moved.moves.length, 1);
  assert.equal(moved.addedCopies, 0);
  assert.equal(moved.execution.kind, 'blocked');
  assert.throws(() => previewBinderBackupImport({ ...options(), newId: () => 'item-0' }), /duplicate/);
  assert.throws(
    () =>
      previewBinderBackupImport({
        ...options(),
        mode: 'arrangement',
        destinationCollectionId: o.current.collections[0].id,
        decisions: [0, 1].map((i) => ({ sourceItemId: `item-${i}`, kind: 'use-existing' as const, itemId: 'item-0' })),
      }),
    /at most once/,
  );
});

test('full restore and over-bound additions have no executable partial command', () => {
  const o = options();
  o.current.items = Array.from({ length: 101 }, (_, n) => ({ ...o.current.items[0], id: `bulk-${n}` }));
  o.current.binders[0].slots.forEach((s) => {
    s.inventoryItemId = null;
    if (s.status === 'collected') s.status = null;
  });
  o.current.placements = [];
  const backup = createBinderBackupV2({ snapshot: o.current, completeness: 'complete-owner', scope: 'all-inventory' });
  const p = previewBinderBackupImport({
    ...o,
    text: JSON.stringify(backup),
    decisions: backup.items.map((i) => ({ sourceItemId: i.id, kind: 'add-copy' })),
  });
  assert.equal(p.addedCopies, 101);
  assert.equal(p.execution.kind, 'blocked');
  assert.ok(!('request' in p.execution));
});

test('additional copies ignore discarded partner wants while arrangement still requires resolution', () => {
  const o = options();
  const backup = JSON.parse(o.text);
  backup.binders[0].slots[3].wantedCards[0].wantedRoles = ['partner'];
  const text = JSON.stringify(backup);
  const added = previewBinderBackupImport({ ...o, text });
  assert.equal(added.execution.kind, 'inventory-command');
  assert.equal(added.addedCopies, backup.items.length);
  assert.equal(added.addedWants, 0);
  assert.deepEqual(added.proposed.binders, []);
  assert.deepEqual(added.proposed.placements, []);
  assert.deepEqual(added.proposed.collections, []);
  assert.deepEqual(added.backup.binders[0].slots[3].wantedCards[0].wantedRoles, ['partner']);
  assert.throws(
    () =>
      previewBinderBackupImport({
        ...o,
        text,
        mode: 'arrangement',
        destinationCollectionId: o.current.collections[0].id,
      }),
    /partner wanted assignment/,
  );
  assert.throws(
    () =>
      previewBinderBackupImport({ ...o, text, mode: 'restore-current-owner', decisions: [], trustedSource: o.current }),
    /partner wanted assignment/,
  );
});
