import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshot } from './fixtures/binder-backup-v2';
import { readCompleteInventorySnapshot } from '@/lib/collection/slot-snapshot';
import { createBinderBackupV2, parseBinderBackupV2 } from '@/lib/binder-backup-v2';
import {
  inspectNativeBackup,
  prepareNativeBackup,
  readNativeBackupFile,
  type NativeBackupBinding,
} from '@/lib/native-backup';
import type { InventoryReadScope } from '@/lib/collection/inventory-read-transport';
import type { CollectionNavigationRead } from '@/lib/collection-navigation';

// Synthetic authority only; real complete-read branding and serializer/parser.
function fixture() {
  const source = snapshot();
  const scope: InventoryReadScope = {
    actorUserId: source.ownerUserId,
    ownerUserId: source.ownerUserId,
    authSessionId: 'synthetic-auth',
    sessionId: 'synthetic-session',
  };
  let live: InventoryReadScope | null = scope;
  const read = async (): Promise<CollectionNavigationRead> => {
    const stream =
      <K extends 'items' | 'placements' | 'collections' | 'binders'>(key: K) =>
      async () => ({
        inventoryRevision: source.inventoryRevision,
        total: source[key].length,
        rows: source[key],
        next: null,
      });
    const complete = await readCompleteInventorySnapshot(source.ownerUserId, source.inventoryRevision, {
      items: stream('items'),
      placements: stream('placements'),
      collections: stream('collections'),
      binders: stream('binders'),
    });
    return {
      scope: { accountUserId: scope.actorUserId, ownerUserId: scope.ownerUserId, sessionId: scope.sessionId },
      partnerUserId: null,
      evidence: { kind: 'complete', snapshot: complete },
      catalog: [],
      layouts: [{ collectionId: source.collections[0].id, layoutRevision: 3, rows: 3, cols: 3 }],
    };
  };
  const binding: NativeBackupBinding = {
    scope,
    currentScope: () => live,
    revisionKey: 'synthetic',
    available: true,
    assertReady: async () => {},
    readCurrent: read,
  };
  return {
    source,
    binding,
    read,
    change: (value: InventoryReadScope | null) => {
      live = value;
    },
  };
}

test('actual bytes preserve all native data, private certificates/source, unknown printing, distinct copies, Unassigned and grids', async () => {
  const f = fixture();
  const { backup, blob } = await prepareNativeBackup(f.binding, 'all-inventory', undefined, () => true);
  assert.deepEqual(parseBinderBackupV2(await blob.text()), backup);
  assert.equal(backup.items.length, 4);
  assert.equal(backup.placements.length, 2);
  assert.equal(backup.items[3].grading?.certificate, '0000123');
  assert.deepEqual(backup.binders[0].presetManifest, f.source.binders[0].presetManifest);
  assert.equal(backup.binders[0].slots.length, 1028);
  assert.equal(backup.binders[0].slots[3].wantedCards.length, 1);
  assert.deepEqual(backup.layouts, (await f.read()).layouts);
  assert.equal(backup.appearance.length, 0);
  assert.ok(!(await blob.text().then((t) => t.includes('synthetic-owner'))));
  const selected = await prepareNativeBackup(f.binding, 'collection', f.source.collections[0].id, () => true);
  assert.equal(selected.backup.items.length, 2);
});

test('retained, redacted reconstructed, cached, wrong-scope, membership-unknown and grid-incomplete reads cannot export', async () => {
  for (const mode of ['retained', 'reconstructed', 'cached', 'scope', 'partner', 'grid'] as const) {
    const f = fixture(),
      retained = await f.read();
    f.binding.readCurrent = async () => {
      const r = mode === 'retained' ? retained : await f.read();
      if (mode === 'reconstructed') return structuredClone(r);
      if (mode === 'cached' && r.evidence.kind === 'complete') r.evidence = { ...r.evidence, kind: 'cached' };
      if (mode === 'scope') r.scope.ownerUserId = 'another-owner';
      if (mode === 'partner') delete r.partnerUserId;
      if (mode === 'grid') r.layouts = [];
      return r;
    };
    await assert.rejects(
      prepareNativeBackup(f.binding, 'all-inventory', undefined, () => true),
      new RegExp('required|unavailable'),
      mode,
    );
  }
});

test('pending/offline/recovery, actor/session teardown, and queued work after asynchronous serialization refuse artifact', async () => {
  for (const stage of [1, 2, 3]) {
    const f = fixture();
    let calls = 0;
    f.binding.assertReady = async () => {
      if (++calls === stage) throw new Error('pending-or-offline');
    };
    await assert.rejects(
      prepareNativeBackup(f.binding, 'all-inventory', undefined, () => true),
      /pending-or-offline/,
    );
  }
  for (const change of [
    null,
    { ...fixture().binding.scope, authSessionId: 'new-session' },
    { ...fixture().binding.scope, actorUserId: 'another-actor' },
  ]) {
    const f = fixture(),
      original = f.binding.readCurrent;
    f.binding.readCurrent = async () => {
      const r = await original();
      f.change(change);
      return r;
    };
    await assert.rejects(
      prepareNativeBackup(f.binding, 'all-inventory', undefined, () => true),
      /session changed/,
    );
  }
  const f = fixture();
  let active = true;
  f.binding.assertReady = async () => {
    active = false;
  };
  await assert.rejects(
    prepareNativeBackup(f.binding, 'all-inventory', undefined, () => active),
    /session changed/,
  );
});

test('local preview is frozen, reports conflicts and Unknown without leaking private labels or creating a restore plan', async () => {
  const f = fixture(),
    read = await f.read();
  const backup = createBinderBackupV2({ snapshot: f.source, completeness: 'complete-owner', scope: 'all-inventory' });
  const value = inspectNativeBackup(JSON.stringify(backup), read);
  assert.ok(Object.isFrozen(value));
  assert.equal(value.overlappingCopies, 4);
  assert.equal(value.unassigned, 2);
  assert.equal(value.unknownPrintings, 2);
  assert.equal(value.knownPrintings, 0);
  assert.equal(value.graded, 1);
  assert.ok(!JSON.stringify(value).includes('0000123'));
  assert.ok(!('execution' in value));
});

test('oversized files fail before read, malformed/future/duplicate/private-asset/foreign-owner/dangling references fail closed', async () => {
  let read = false;
  await assert.rejects(
    readNativeBackupFile({
      size: 10 * 1024 * 1024 + 1,
      text: async () => {
        read = true;
        return '';
      },
    }),
    /10 MiB/,
  );
  assert.equal(read, false);
  const f = fixture(),
    backup = createBinderBackupV2({ snapshot: f.source, completeness: 'complete-owner', scope: 'all-inventory' });
  for (const text of [
    '{',
    JSON.stringify({ ...backup, version: 3 }),
    JSON.stringify({ ...backup, ownerUserId: 'forged' }),
    JSON.stringify({ ...backup, items: [...backup.items, backup.items[0]] }),
    JSON.stringify({ ...backup, placements: [{ ...backup.placements[0], inventoryItemId: 'missing' }] }),
  ]) {
    await assert.rejects(readNativeBackupFile({ size: text.length, text: async () => text }));
  }
  f.source.items[3].grading!.label.assetIds = ['synthetic-private-label'];
  await assert.rejects(
    prepareNativeBackup(f.binding, 'all-inventory', undefined, () => true),
    /#390/,
  );
});

test('live session is checked after asynchronous serialization and preview never trusts ambiguous catalog labels', async () => {
  const f = fixture(),
    original = Blob.prototype.text;
  try {
    Blob.prototype.text = async function () {
      const text = await original.call(this);
      f.change(null);
      return text;
    };
    await assert.rejects(
      prepareNativeBackup(f.binding, 'all-inventory', undefined, () => true),
      /session changed/,
    );
  } finally {
    Blob.prototype.text = original;
  }
  const read = await f.read();
  const card = {
    id: 'synthetic-pokemon',
    localId: '1',
    name: 'Synthetic catalog name',
    set: { id: 'synthetic', name: 'Synthetic' },
  };
  read.catalog = [
    { card, speciesNames: [], pokemonIds: [1] },
    { card: { ...card, id: 'conflicting', aliasIds: [card.id] }, speciesNames: [], pokemonIds: [2] },
  ];
  const backup = createBinderBackupV2({ snapshot: f.source, completeness: 'complete-owner', scope: 'all-inventory' });
  assert.equal(inspectNativeBackup(JSON.stringify(backup), read).knownPrintings, 0);
});
