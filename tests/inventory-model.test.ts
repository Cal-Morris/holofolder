import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeInventoryItem,
  normalizeInventorySnapshot,
  inventoryItemCandidate,
  getInventoryCounts,
  getInventoryItemLocation,
  getStoragePresentationDefault,
  getStorageCompletion,
  normalizeGradingRecord,
  type InventoryItem,
  type InventorySnapshot,
  type GradingRecord,
  type InventoryCatalogResolver,
} from '@/lib/domain/inventory';
import {
  planAssignInventory,
  planMoveInventory,
  planUnassignInventory,
  planEditInventoryMetadata,
  planReleaseInventorySlots,
} from '@/lib/inventory-plans';
import { normalizeAuditContext, type AuditContext } from '@/lib/domain/audit-context';
import { getBinderCompletion } from '@/lib/domain/binder-slots';
import { planMoveSlots, planRemoveSlots } from '@/lib/binder-slot-plans';

// All identities, certificates and catalog data in this suite are synthetic.
const grading = (grade = '10', certificate = '000123'): GradingRecord => ({
  provider: { kind: 'known', id: 'psa' },
  grade,
  scale: '10-point',
  designation: null,
  subgrades: [{ name: 'centering', grade: '9.5' }],
  certificate,
  holder: 'synthetic-holder',
  label: { variant: 'synthetic-label', assetIds: ['private-asset'] },
});
function item(id = 'raw', changes: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id,
    ownerUserId: 'owner',
    identity: { kind: 'card', cardId: 'synthetic-card', language: 'en', finish: 'normal' },
    grading: null,
    acquiredAt: '2026-01-01T00:00:00Z',
    version: 0,
    ...changes,
  };
}
function state(items: InventoryItem[] = [item()]): InventorySnapshot {
  return {
    ownerUserId: 'owner',
    inventoryRevision: 7,
    items,
    placements: [],
    collections: ['a', 'b'].map((id) => ({
      id,
      ownerUserId: 'owner',
      name: `Synthetic ${id}`,
      kind: 'binder',
      defaultPresentation: 'binder',
      version: 2,
    })),
    binders: ['a', 'b'].map((collectionId) => ({
      ownerUserId: 'owner',
      collectionId,
      layoutRevision: 3,
      presetManifest: null,
      slots: [
        {
          id: `slot-${collectionId}`,
          ownerUserId: 'owner',
          collectionId,
          target: { kind: 'pokemon', pokemonId: 143 },
          inventoryItemId: null,
          wantedCards: [],
          status: null,
          version: 4,
          presetOrigin: null,
        },
      ],
    })),
  };
}
const resolveCatalog: InventoryCatalogResolver = (id) =>
  ['synthetic-card', 'synthetic-alias'].includes(id)
    ? { kind: 'card', id: 'synthetic-card', aliasIds: ['synthetic-alias'], pokemonIds: [143, 25] }
    : undefined;
const context: AuditContext = {
  actor: { kind: 'user', userId: 'partner' },
  source: 'app',
  clientId: 'synthetic-device',
  operationId: 'offline-operation',
  batchId: 'offline-batch',
  clientOccurredAt: '2026-01-01T00:00:00Z',
  affectedEntities: { inventoryItemIds: [], slotIds: [], collectionIds: [] },
};
const destination = (collectionId = 'a', slotVersion = 4) => ({
  collectionId,
  slotId: `slot-${collectionId}`,
  layoutRevision: 3,
  slotVersion,
});
const existing = (inventoryItemId = 'raw', itemVersion = 0) => ({
  kind: 'existing' as const,
  inventoryItemId,
  itemVersion,
});
const catalog = (newItemId = 'new-raw') => ({
  kind: 'catalog' as const,
  identity: item().identity as Extract<InventoryItem['identity'], { kind: 'card' }>,
  newItemId,
});
function success<T extends { ok: boolean }>(plan: T): Extract<T, { ok: true }> {
  assert.equal(plan.ok, true, JSON.stringify(plan));
  return plan as Extract<T, { ok: true }>;
}
function assign(snapshot = state(), selection = existing(), target = destination()) {
  return success(
    planAssignInventory(
      snapshot,
      { inventoryRevision: snapshot.inventoryRevision, destination: target, selection, context },
      resolveCatalog,
    ),
  );
}

describe('owned-copy inventory contract', () => {
  test('one raw and two graded copies count as three, non-owning displays add nothing', () => {
    const snapshot = state([
      item(),
      item('slab1', { grading: grading() }),
      item('slab2', { grading: grading('9', '000456') }),
    ]);
    assert.deepEqual(getInventoryCounts(snapshot), {
      total: 3,
      assigned: 0,
      unassigned: 3,
      byCollection: { a: 0, b: 0 },
    });
    assert.equal(getInventoryCounts(snapshot).total, 3);
    assert.equal(new Set(snapshot.items.map((i) => i.id)).size, 3);
  });
  test('strict detached normalization keeps exact grade, leading zero certificate and unknown printing', () => {
    const input = item('slab', { grading: grading() });
    const normalized = normalizeInventoryItem(input)!;
    assert.deepEqual(normalized, input);
    input.grading!.label.assetIds.push('later');
    assert.deepEqual(normalized.grading!.label.assetIds, ['private-asset']);
    const legacy = item('legacy', { identity: { kind: 'pokemon', pokemonId: 143 }, acquiredAt: null });
    assert.deepEqual(inventoryItemCandidate(legacy, resolveCatalog), { kind: 'pokemon', pokemonId: 143 });
    assert.equal(normalizeInventoryItem({ ...legacy, grading: grading() }), undefined);
    for (const patch of [
      { identity: {} },
      { identity: { kind: 'card', cardId: 'x', language: 'bad' } },
      { version: -1 },
      { secret: 'forbidden' },
      { grading: { ...grading(), certificate: 123 } },
    ]) {
      assert.equal(normalizeInventoryItem({ ...item(), ...patch }), undefined);
    }
    assert.ok(
      normalizeInventoryItem(item('unknown-variants', { identity: { kind: 'card', cardId: 'synthetic-card' } })),
    );
  });
  test('candidate adaptation needs trusted catalog evidence and never invents Pokémon links', () => {
    assert.equal(
      inventoryItemCandidate(item(), () => undefined),
      undefined,
    );
    assert.equal(
      inventoryItemCandidate(item(), () => ({ kind: 'card', id: 'other', pokemonIds: [143] })),
      undefined,
    );
    const candidate = inventoryItemCandidate(
      item('alias', { identity: { kind: 'card', cardId: 'synthetic-alias', language: 'fr', finish: 'holo' } }),
      resolveCatalog,
    )!;
    assert.deepEqual(candidate, {
      kind: 'card',
      id: 'synthetic-card',
      aliasIds: ['synthetic-alias'],
      pokemonIds: [143, 25],
      language: 'fr',
      finish: 'holo',
    });
  });
  test('owner-wide normalization rejects double placement, orphan contents and foreign scope', () => {
    const valid = assign().snapshot;
    assert.ok(normalizeInventorySnapshot(valid));
    for (const change of [
      (s: InventorySnapshot) => s.placements.push({ ...s.placements[0], collectionId: 'b', slotId: 'slot-b' }),
      (s: InventorySnapshot) => {
        s.items[0].ownerUserId = 'other';
      },
      (s: InventorySnapshot) => {
        s.placements = [];
      },
      (s: InventorySnapshot) => {
        s.binders[1].slots[0].inventoryItemId = 'raw';
        s.binders[1].slots[0].status = 'collected';
      },
      (s: InventorySnapshot) => s.items.push(item()),
      (s: InventorySnapshot) => {
        s.binders[1].slots[0].id = 'slot-a';
      },
    ]) {
      const bad = structuredClone(valid);
      change(bad);
      assert.equal(normalizeInventorySnapshot(bad), undefined);
    }
  });
  test('kind and presentation defaults never imply another ownership or slot model', () => {
    assert.equal(getStoragePresentationDefault('binder'), 'binder');
    assert.equal(getStoragePresentationDefault('slab'), 'slabs');
    assert.equal(getStoragePresentationDefault('custom'), 'list');
    const snapshot = assign().snapshot;
    snapshot.collections[0].kind = 'slab';
    snapshot.collections[0].defaultPresentation = 'list';
    assert.equal(getInventoryCounts(snapshot).assigned, 1);
    assert.equal(snapshot.items[0].grading, null);
  });
});

describe('pure assignment, move and unassign', () => {
  test('existing copies can enter free slots without catalog access, constrained targets still fail closed', () => {
    const before = state();
    before.binders[0].slots[0].target = null;
    before.binders[1].slots[0].target = null;
    const unavailable: InventoryCatalogResolver = () => undefined;
    const assigned = success(
      planAssignInventory(
        before,
        { inventoryRevision: 7, destination: destination(), selection: existing(), context },
        unavailable,
      ),
    );
    assert.equal(assigned.selectedInventoryItemId, 'raw');
    const moved = success(
      planMoveInventory(
        assigned.snapshot,
        {
          inventoryRevision: 8,
          inventoryItemId: 'raw',
          itemVersion: 0,
          placementVersion: 0,
          source: destination('a', 5),
          destination: destination('b'),
          context,
        },
        unavailable,
      ),
    );
    assert.deepEqual(moved.snapshot.items, before.items);
    assert.equal(getInventoryItemLocation(moved.snapshot, 'raw')?.collectionId, 'b');
    assert.deepEqual(
      planAssignInventory(
        state(),
        { inventoryRevision: 7, destination: destination(), selection: existing(), context },
        unavailable,
      ),
      { ok: false, error: 'catalog-unavailable' },
    );
    const constrained = structuredClone(assigned.snapshot);
    constrained.binders[1].slots[0].target = { kind: 'pokemon', pokemonId: 143 };
    assert.deepEqual(
      planMoveInventory(
        constrained,
        {
          inventoryRevision: 8,
          inventoryItemId: 'raw',
          itemVersion: 0,
          placementVersion: 0,
          source: destination('a', 5),
          destination: destination('b'),
          context,
        },
        unavailable,
      ),
      { ok: false, error: 'catalog-unavailable' },
    );
  });
  test('automatically reuses matching Unassigned copy with acquisition and grade intact', () => {
    const snapshot = state([item('slab', { grading: grading() })]);
    const before = structuredClone(snapshot);
    const plan = success(
      planAssignInventory(
        snapshot,
        { inventoryRevision: 7, destination: destination(), selection: catalog(), context },
        resolveCatalog,
      ),
    );
    assert.equal(plan.selectedInventoryItemId, 'slab');
    assert.deepEqual(plan.snapshot.items, snapshot.items);
    assert.deepEqual(plan.snapshot.placements, [
      { inventoryItemId: 'slab', collectionId: 'a', slotId: 'slot-a', version: 0 },
    ]);
    assert.equal(plan.snapshot.binders[0].slots[0].version, 5);
    assert.equal(plan.snapshot.binders[0].layoutRevision, 3);
    assert.equal(plan.snapshot.inventoryRevision, 8);
    assert.deepEqual(snapshot, before);
    assert.equal(plan.context.operationId, context.operationId);
    assert.equal(plan.context.actor.kind, 'user');
    assert.deepEqual(plan.context.affectedEntities, {
      inventoryItemIds: ['slab'],
      slotIds: ['slot-a'],
      collectionIds: ['a'],
    });
  });
  test('catalog choice creates raw when none eligible, leaving already assigned copies alone', () => {
    const snapshot = assign(state([item('raw', { grading: grading() })])).snapshot;
    const plan = success(
      planAssignInventory(
        snapshot,
        { inventoryRevision: 8, destination: destination('b'), selection: catalog(), context },
        resolveCatalog,
      ),
    );
    assert.equal(plan.selectedInventoryItemId, 'new-raw');
    assert.equal(plan.snapshot.items.length, 2);
    assert.equal(plan.snapshot.items[1].grading, null);
    assert.equal(plan.snapshot.items[1].acquiredAt, null);
    assert.equal(getInventoryItemLocation(plan.snapshot, 'raw')?.collectionId, 'a');
  });
  test('raw/graded differences need a choice, indistinguishable copies choose by stable ID', () => {
    const command = { inventoryRevision: 7, destination: destination(), selection: catalog(), context };
    const mixed = state([item(), item('slab', { grading: grading() })]);
    assert.deepEqual(planAssignInventory(mixed, command, resolveCatalog), { ok: false, error: 'copy-choice-required' });
    assert.equal(assign(mixed, existing('slab')).selectedInventoryItemId, 'slab');
    assert.equal(
      success(planAssignInventory(state([item('z'), item('a')]), command, resolveCatalog)).selectedInventoryItemId,
      'a',
    );
  });
  test('explicit missing, edited or already placed copy conflicts, never clones certificate', () => {
    for (const selection of [existing('missing'), existing('raw', 3)]) {
      assert.deepEqual(
        planAssignInventory(
          state(),
          { inventoryRevision: 7, destination: destination(), selection, context },
          resolveCatalog,
        ),
        { ok: false, error: 'item-conflict' },
      );
    }
    const placed = assign().snapshot;
    assert.deepEqual(
      planAssignInventory(
        placed,
        { inventoryRevision: 8, destination: destination('b'), selection: existing(), context },
        resolveCatalog,
      ),
      { ok: false, error: 'placement-conflict' },
    );
    assert.equal(placed.items.length, 1);
  });
  test('replacement unassigns displaced copy instead of changing physical identity', () => {
    const before = assign(state([item(), item('slab', { grading: grading() })])).snapshot;
    const plan = assign(before, existing('slab'), destination('a', 5));
    assert.equal(plan.snapshot.items.length, 2);
    assert.deepEqual(plan.snapshot.items, before.items);
    assert.equal(getInventoryItemLocation(plan.snapshot, 'raw'), null);
    assert.equal(plan.snapshot.binders[0].slots[0].inventoryItemId, 'slab');
    assert.deepEqual(plan.preconditions.placements, { raw: 0, slab: null });
  });
  test('explicit cross-storage move empties source, preserves target and item, unassigns destination', () => {
    const a = assign(state([item(), item('second')])).snapshot;
    const b = assign(a, existing('second'), destination('b')).snapshot;
    const plan = success(
      planMoveInventory(
        b,
        {
          inventoryRevision: 9,
          inventoryItemId: 'raw',
          itemVersion: 0,
          placementVersion: 0,
          source: destination('a', 5),
          destination: destination('b', 5),
          context,
        },
        resolveCatalog,
      ),
    );
    assert.deepEqual(plan.snapshot.items, b.items);
    assert.equal(plan.snapshot.binders[0].slots[0].inventoryItemId, null);
    assert.equal(plan.snapshot.binders[1].slots[0].inventoryItemId, 'raw');
    assert.equal(plan.snapshot.placements[0].version, 1);
    assert.equal(getInventoryItemLocation(plan.snapshot, 'second'), null);
    assert.deepEqual(
      plan.snapshot.binders.map((b) => b.layoutRevision),
      [3, 3],
    );
    assert.deepEqual(plan.snapshot.binders[0].slots[0].target, b.binders[0].slots[0].target);
    assert.equal(
      getBinderCompletion(plan.snapshot.binders[0], (id) =>
        inventoryItemCandidate(
          plan.snapshot.items.find((i) => i.id === id)!,
          resolveCatalog,
        ),
      ).completedTargetCount,
      0,
    );
  });
  test('unassign preserves ownership and does not fabricate a binder for Unassigned', () => {
    const before = assign().snapshot;
    const plan = success(
      planUnassignInventory(before, {
        inventoryRevision: 8,
        inventoryItemId: 'raw',
        itemVersion: 0,
        placementVersion: 0,
        source: destination('a', 5),
        context,
      }),
    );
    assert.deepEqual(plan.snapshot.items, before.items);
    assert.equal(plan.snapshot.placements.length, 0);
    assert.equal(plan.snapshot.collections.length, 2);
    assert.deepEqual(getInventoryCounts(plan.snapshot), {
      total: 1,
      assigned: 0,
      unassigned: 1,
      byCollection: { a: 0, b: 0 },
    });
  });
  test('whole-slot layout moves preserve placement, remove/delete effects only release it', () => {
    const before = assign().snapshot;
    before.binders[0].slots.push({
      ...before.binders[0].slots[0],
      id: 'spacer',
      target: null,
      inventoryItemId: null,
      status: null,
      version: 0,
    });
    const moved = success(planMoveSlots(before.binders[0], 3, ['slot-a'], null));
    assert.deepEqual(
      moved.snapshot.slots.map((s) => s.id),
      ['spacer', 'slot-a'],
    );
    const movedInventory = { ...before, binders: [moved.snapshot, before.binders[1]] };
    assert.ok(normalizeInventorySnapshot(movedInventory));
    assert.deepEqual(movedInventory.placements, before.placements);
    assert.equal(getStorageCompletion(movedInventory, 'a', resolveCatalog)!.completedTargetCount, 1);
    const removed = success(planRemoveSlots(before.binders[0], 3, ['slot-a']));
    const plan = success(
      planReleaseInventorySlots(before, {
        inventoryRevision: 8,
        collectionId: 'a',
        layoutRevision: 3,
        slotVersions: { 'slot-a': 5 },
        context,
      }),
    );
    assert.deepEqual(plan.snapshot.items, before.items);
    assert.deepEqual(plan.snapshot.placements, []);
    assert.deepEqual(removed.unassignedInventoryItemIds, ['raw']);
    assert.deepEqual(plan.context.affectedEntities.inventoryItemIds, ['raw']);
  });
  test('metadata edits preserve item ID, printing, placement and acquisition', () => {
    const before = assign().snapshot;
    const plan = success(
      planEditInventoryMetadata(before, {
        inventoryRevision: 8,
        inventoryItemId: 'raw',
        itemVersion: 0,
        grading: grading(),
        context,
      }),
    );
    assert.equal(plan.snapshot.items[0].id, 'raw');
    assert.equal(plan.snapshot.items[0].version, 1);
    assert.deepEqual(plan.snapshot.items[0].identity, before.items[0].identity);
    assert.deepEqual(plan.snapshot.placements, before.placements);
    assert.equal(plan.snapshot.items[0].acquiredAt, before.items[0].acquiredAt);
    assert.equal(plan.snapshot.items[0].grading!.certificate, '000123');
  });
  test('independent revision, scope, compatibility and overflow errors leave input intact', () => {
    const snapshot = state();
    const command = { inventoryRevision: 7, destination: destination(), selection: existing(), context };
    for (const [patch, error] of [
      [{ inventoryRevision: 6 }, 'inventory-conflict'],
      [{ destination: { ...destination(), layoutRevision: 2 } }, 'layout-conflict'],
      [{ destination: destination('a', 3) }, 'slot-conflict'],
      [{ destination: destination('foreign') }, 'invalid-destination'],
    ] as const)
      assert.deepEqual(planAssignInventory(snapshot, { ...command, ...patch }, resolveCatalog), { ok: false, error });
    const wrongTarget = structuredClone(snapshot);
    wrongTarget.binders[0].slots[0].target = { kind: 'pokemon', pokemonId: 999 };
    assert.deepEqual(planAssignInventory(wrongTarget, command, resolveCatalog), {
      ok: false,
      error: 'target-mismatch',
    });
    const overflow = structuredClone(snapshot);
    overflow.binders[0].slots[0].version = Number.MAX_SAFE_INTEGER;
    assert.deepEqual(
      planAssignInventory(
        overflow,
        { ...command, destination: destination('a', Number.MAX_SAFE_INTEGER) },
        resolveCatalog,
      ),
      { ok: false, error: 'revision-overflow' },
    );
    assert.deepEqual(snapshot, state());
  });
});

describe('integration boundaries and additional invariants', () => {
  test('empty targets, wants and non-owning references never manufacture ownership or completion', () => {
    const empty = state([]);
    empty.binders[0].slots[0].wantedCards = [
      { card_id: 'synthetic-card', card_name: 'Synthetic', added_at: '2026-01-01', wanted_by: [] },
    ];
    empty.binders[0].slots[0].status = 'wishlisted';
    assert.equal(getInventoryCounts(empty).total, 0);
    assert.deepEqual(getStorageCompletion(empty, 'a', resolveCatalog), { targetCount: 1, completedTargetCount: 0 });
    const assigned = assign().snapshot;
    assert.deepEqual(getStorageCompletion(assigned, 'a', resolveCatalog), { targetCount: 1, completedTargetCount: 1 });
    assert.deepEqual(getStorageCompletion(assigned, 'b', resolveCatalog), { targetCount: 1, completedTargetCount: 0 });
    const displayOnly = structuredClone(assigned);
    displayOnly.binders[1].slots[0].inventoryItemId = 'raw';
    displayOnly.binders[1].slots[0].status = 'collected';
    assert.equal(getStorageCompletion(displayOnly, 'b', resolveCatalog)!.completedTargetCount, 0);
    assert.equal(getStorageCompletion(assigned, 'showcase', resolveCatalog), undefined);
    assert.equal(getInventoryItemLocation(assigned, 'missing'), undefined);
  });
  test('legacy ownership matches its species and free slots, never a known printing or invented grade', () => {
    const legacy = state([item('legacy', { identity: { kind: 'pokemon', pokemonId: 143 }, acquiredAt: null })]);
    const assigned = assign(legacy, existing('legacy')).snapshot;
    assert.equal(getStorageCompletion(assigned, 'a', () => undefined)!.completedTargetCount, 1);
    const printing = structuredClone(legacy);
    printing.binders[0].slots[0].target = { kind: 'card', cardId: 'synthetic-card' };
    assert.deepEqual(
      planAssignInventory(
        printing,
        { inventoryRevision: 7, destination: destination(), selection: existing('legacy'), context },
        resolveCatalog,
      ),
      { ok: false, error: 'target-mismatch' },
    );
    const free = structuredClone(legacy);
    free.binders[0].slots[0].target = null;
    assert.equal(assign(free, existing('legacy')).snapshot.items[0].grading, null);
  });
  test('catalog aliases and explicit language/finish are used without legacy defaults', () => {
    const variants = state([
      item('french', { identity: { kind: 'card', cardId: 'synthetic-alias', language: 'fr', finish: 'holo' } }),
    ]);
    variants.binders[0].slots[0].target = { kind: 'card', cardId: 'synthetic-card', language: 'fr', finish: 'holo' };
    const input = {
      inventoryRevision: 7,
      destination: destination(),
      context,
      selection: {
        ...catalog(),
        identity: {
          kind: 'card' as const,
          cardId: 'synthetic-alias',
          language: 'fr' as const,
          finish: 'holo' as const,
        },
      },
    };
    assert.equal(success(planAssignInventory(variants, input, resolveCatalog)).selectedInventoryItemId, 'french');
    const wrong = { ...input, selection: catalog() };
    assert.deepEqual(planAssignInventory(variants, wrong, resolveCatalog), { ok: false, error: 'target-mismatch' });
    const unknown = state([item('unknown', { identity: { kind: 'card', cardId: 'synthetic-card' } })]);
    const plan = success(planAssignInventory(unknown, { ...input, selection: catalog() }, resolveCatalog));
    assert.equal(plan.selectedInventoryItemId, 'new-raw');
    assert.equal(plan.snapshot.items[0].id, 'unknown');
  });
  test('Trainers and Energy with no Pokémon links fit free/exact slots', () => {
    const resolve: InventoryCatalogResolver = (id) => ({ kind: 'card', id, pokemonIds: [] });
    const free = state();
    free.binders[0].slots[0].target = null;
    const plan = success(
      planAssignInventory(
        free,
        { inventoryRevision: 7, destination: destination(), selection: existing(), context },
        resolve,
      ),
    );
    assert.equal(plan.snapshot.items.length, 1);
    free.binders[0].slots[0].target = { kind: 'card', cardId: 'synthetic-card' };
    assert.equal(
      planAssignInventory(
        free,
        { inventoryRevision: 7, destination: destination(), selection: existing(), context },
        resolve,
      ).ok,
      true,
    );
  });
  test('independent item, placement and source revisions reject stale moves and unassigns', () => {
    const placed = assign().snapshot;
    const input = {
      inventoryRevision: 8,
      inventoryItemId: 'raw',
      itemVersion: 0,
      placementVersion: 0,
      source: destination('a', 5),
      context,
    };
    for (const [patch, error] of [
      [{ itemVersion: 1 }, 'item-conflict'],
      [{ placementVersion: 1 }, 'placement-conflict'],
      [{ source: destination('b') }, 'placement-conflict'],
      [{ source: { ...destination('a', 5), layoutRevision: 4 } }, 'layout-conflict'],
      [{ source: destination('a', 4) }, 'slot-conflict'],
    ] as const) {
      assert.deepEqual(planUnassignInventory(placed, { ...input, ...patch }), { ok: false, error });
      assert.deepEqual(
        planMoveInventory(placed, { ...input, ...patch, destination: destination('b') }, resolveCatalog),
        { ok: false, error },
      );
    }
    const noop = success(planMoveInventory(placed, { ...input, destination: destination('a', 5) }, resolveCatalog));
    assert.equal(noop.changed, false);
    assert.equal(noop.snapshot.inventoryRevision, 8);
    assert.deepEqual(noop.context.affectedEntities, { inventoryItemIds: [], slotIds: [], collectionIds: [] });
    assert.deepEqual(placed, assign().snapshot);
  });
  test('item edits and no-ops have separate revision semantics', () => {
    const before = state([item('slab', { grading: grading() })]);
    const input = { inventoryRevision: 7, inventoryItemId: 'slab', itemVersion: 0, grading: grading(), context };
    const noop = success(planEditInventoryMetadata(before, input));
    assert.equal(noop.changed, false);
    assert.equal(noop.snapshot.items[0].version, 0);
    assert.equal(noop.snapshot.inventoryRevision, 7);
    const changed = success(planEditInventoryMetadata(before, { ...input, grading: null }));
    assert.equal(changed.snapshot.items[0].id, 'slab');
    assert.equal(changed.snapshot.items[0].version, 1);
    assert.equal(changed.snapshot.items[0].grading, null);
    assert.equal(before.items[0].grading!.certificate, '000123');
  });
  test('custom providers and textual grades/scales remain exact and bounded', () => {
    const custom = {
      ...grading(),
      provider: { kind: 'custom' as const, name: 'Synthetic grader' },
      grade: 'Authentic',
      scale: null,
      subgrades: [],
      certificate: null,
      holder: null,
    };
    assert.deepEqual(normalizeGradingRecord(custom), custom);
    assert.deepEqual(normalizeGradingRecord({ ...grading(), grade: null }), { ...grading(), grade: null });
    for (const bad of [
      { ...grading(), provider: { kind: 'known', id: 'invented' } },
      { ...grading(), subgrades: [{ name: 'corners', grade: 10 }] },
      { ...grading(), label: { variant: null, assetIds: [null] } },
      { ...grading(), token: 'forbidden' },
      { ...grading(), grade: '' },
    ])
      assert.equal(normalizeGradingRecord(bad), undefined);
  });
  test('audit shape preserves queued source/idempotency, derives affected IDs and rejects extra payloads', () => {
    assert.deepEqual(normalizeAuditContext(context), context);
    assert.equal(normalizeAuditContext({ ...context, authorization: 'forbidden' }), undefined);
    assert.equal(
      normalizeAuditContext({ ...context, actor: { kind: 'user', userId: 'partner', token: 'forbidden' } }),
      undefined,
    );
    assert.equal(normalizeAuditContext({ ...context, operationId: '' }), undefined);
    const spoofedAffected = {
      ...context,
      affectedEntities: { inventoryItemIds: ['unrelated'], slotIds: [], collectionIds: [] },
    };
    const plan = success(
      planAssignInventory(
        state(),
        { inventoryRevision: 7, destination: destination(), selection: existing(), context: spoofedAffected },
        resolveCatalog,
      ),
    );
    assert.deepEqual(plan.context.affectedEntities.inventoryItemIds, ['raw']);
    assert.equal(plan.context.batchId, 'offline-batch');
    assert.equal(plan.context.clientOccurredAt, context.clientOccurredAt);
    assert.equal(plan.context.clientId, context.clientId);
    assert.deepEqual(spoofedAffected.affectedEntities.inventoryItemIds, ['unrelated']);
  });
  test('complete owner deletion releases copies without a cascade through inventory', () => {
    const before = assign().snapshot;
    const released = success(
      planReleaseInventorySlots(before, {
        inventoryRevision: 8,
        collectionId: 'a',
        layoutRevision: 3,
        slotVersions: { 'slot-a': 5 },
        context,
      }),
    ).snapshot;
    released.binders = released.binders.filter((b) => b.collectionId !== 'a');
    released.collections = released.collections.filter((c) => c.id !== 'a');
    assert.ok(normalizeInventorySnapshot(released));
    assert.deepEqual(released.items, before.items);
    assert.equal(getInventoryCounts(released).unassigned, 1);
  });
  test('overflow at owner, item or placement level never returns partial mutations', () => {
    const ownerOverflow = state();
    ownerOverflow.inventoryRevision = Number.MAX_SAFE_INTEGER;
    assert.deepEqual(
      planAssignInventory(
        ownerOverflow,
        { inventoryRevision: Number.MAX_SAFE_INTEGER, destination: destination(), selection: existing(), context },
        resolveCatalog,
      ),
      { ok: false, error: 'revision-overflow' },
    );
    const itemOverflow = state([item('raw', { version: Number.MAX_SAFE_INTEGER })]);
    assert.deepEqual(
      planEditInventoryMetadata(itemOverflow, {
        inventoryRevision: 7,
        inventoryItemId: 'raw',
        itemVersion: Number.MAX_SAFE_INTEGER,
        grading: grading(),
        context,
      }),
      { ok: false, error: 'revision-overflow' },
    );
    const placementOverflow = assign().snapshot;
    placementOverflow.placements[0].version = Number.MAX_SAFE_INTEGER;
    assert.deepEqual(
      planMoveInventory(
        placementOverflow,
        {
          inventoryRevision: 8,
          inventoryItemId: 'raw',
          itemVersion: 0,
          placementVersion: Number.MAX_SAFE_INTEGER,
          source: destination('a', 5),
          destination: destination('b'),
          context,
        },
        resolveCatalog,
      ),
      { ok: false, error: 'revision-overflow' },
    );
    assert.equal(ownerOverflow.placements.length, 0);
    assert.equal(itemOverflow.items[0].grading, null);
    assert.equal(placementOverflow.binders[0].slots[0].inventoryItemId, 'raw');
  });
  test('opaque IDs cannot hide item preconditions through Object.prototype', () => {
    const snapshot = state([item('constructor')]);
    const plan = assign(snapshot, existing('constructor'));
    assert.equal(Object.hasOwn(plan.preconditions.items, 'constructor'), true);
    assert.equal(plan.preconditions.items.constructor, 0);
    assert.ok(normalizeInventorySnapshot(plan.snapshot));
  });
});
