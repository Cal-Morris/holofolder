import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  describeBinderLayoutChange,
  planBinderLayoutChange,
  prepareBinderLayoutIntent,
} from '../lib/binder-layout-change';
import { projectSlotIntent } from '../lib/collection/slot-optimistic';
import type { InventorySnapshot } from '../lib/domain/inventory';
import { parseSlotCommand } from '../lib/domain/slot-commands';
import { projectPendingLayouts } from '../lib/collection-navigation';

// Synthetic binders: `true` is a pocket holding a card, `false` an empty pocket.
const filled = (n: number, ...empty: number[]) => Array.from({ length: n }, (_, i) => !empty.includes(i));

describe('binder layout change plan', () => {
  test('shrinking moves later cards onto later pages and adds pages, never removing a pocket', () => {
    const plan = planBinderLayoutChange(filled(32), { rows: 4, cols: 4 }, { rows: 3, cols: 3 });
    assert.equal(plan.pockets, 32);
    assert.equal(plan.cards, 32);
    assert.equal(plan.pagesBefore, 2);
    assert.equal(plan.pagesAfter, 4);
    // Positions 9–15 leave page 1 for page 2; 16–31 leave page 2 for pages 2–4 (16–17 stay on page 2).
    assert.equal(plan.cardsChangingPage, 7 + 14);
    assert.deepEqual(plan.fromPages, { first: 1, last: 2 });
    assert.deepEqual(plan.toPages, { first: 2, last: 4 });
    assert.deepEqual(describeBinderLayoutChange(plan), [
      '21 cards on pages 1–2 will move to pages 2–4.',
      '8 cards will stay on the same page but sit in a different spot.',
      'The binder will have 4 pages instead of 2.',
      'No card leaves its pocket and nothing is removed. Pockets, cards and wants keep their order.',
    ]);
  });

  test('growing pulls cards forward and drops empty trailing pages', () => {
    const plan = planBinderLayoutChange(filled(18), { rows: 3, cols: 3 }, { rows: 6, cols: 3 });
    assert.equal(plan.pagesBefore, 2);
    assert.equal(plan.pagesAfter, 1);
    assert.equal(plan.cardsChangingPage, 9);
    assert.deepEqual(plan.fromPages, { first: 2, last: 2 });
    assert.deepEqual(plan.toPages, { first: 1, last: 1 });
    assert.equal(describeBinderLayoutChange(plan)[0], '9 cards on page 2 will move to page 1.');
  });

  test('same capacity, new shape: cards stay on their page but change spot; empty pockets are not cards', () => {
    const plan = planBinderLayoutChange(filled(12, 0, 4), { rows: 3, cols: 4 }, { rows: 4, cols: 3 });
    assert.equal(plan.cards, 10);
    assert.equal(plan.cardsChangingPage, 0);
    assert.equal(plan.pagesBefore, plan.pagesAfter);
    // Only offsets 0–2 keep their row and column; 0 is empty, so filled offsets 3 and 5–11 change spot.
    assert.equal(plan.cardsChangingSpot, 8);
    assert.ok(describeBinderLayoutChange(plan).every((line) => !/page.*instead/.test(line)));
  });

  test('an unchanged layout says so, an empty binder says so, and invalid grids are refused', () => {
    assert.deepEqual(
      describeBinderLayoutChange(planBinderLayoutChange(filled(5), { rows: 4, cols: 4 }, { rows: 4, cols: 4 })),
      ['This is already the binder’s layout. Nothing changes.'],
    );
    const empty = planBinderLayoutChange([false, false], { rows: 4, cols: 4 }, { rows: 1, cols: 1 });
    assert.equal(describeBinderLayoutChange(empty)[0], 'This binder has no cards in pockets yet.');
    for (const bad of [
      { rows: 0, cols: 4 },
      { rows: 9, cols: 4 },
      { rows: 2.5, cols: 4 },
    ])
      assert.throws(() => planBinderLayoutChange([], { rows: 4, cols: 4 }, bad));
  });
});

describe('layout slot command contract', () => {
  const request = (commands: unknown[]) => ({
    collectionId: '03620000-0000-4000-8000-000000000011',
    operationId: 'synthetic-layout-operation',
    inventoryRevision: 3,
    collectionVersion: 2,
    layoutRevision: 1,
    commands,
  });
  test('accepts one whole-number grid from 1 to 8', () => {
    const value = request([{ kind: 'layout', rows: 8, cols: 1 }]);
    assert.deepEqual(parseSlotCommand(value), value);
  });
  test('rejects bad sizes, extra fields, missing sides and a second layout in one request', () => {
    for (const commands of [
      [{ kind: 'layout', rows: 9, cols: 4 }],
      [{ kind: 'layout', rows: 0, cols: 4 }],
      [{ kind: 'layout', rows: 2.5, cols: 4 }],
      [{ kind: 'layout', rows: '4', cols: 4 }],
      [{ kind: 'layout', rows: 4 }],
      [{ kind: 'layout', rows: 4, cols: 4, ids: ['x'] }],
      [
        { kind: 'layout', rows: 4, cols: 4 },
        { kind: 'layout', rows: 3, cols: 3 },
      ],
    ])
      assert.throws(() => parseSlotCommand(request(commands)));
  });
});

describe('pending layout projection', () => {
  const layout = { collectionId: 'b1', layoutRevision: 4, rows: 4, cols: 4 };
  test('a queued layout command shows its grid at the projected revision', () => {
    const pending = [
      {
        status: 'pending',
        intent: { kind: 'slots', request: { collectionId: 'b1', commands: [{ kind: 'layout', rows: 3, cols: 3 }] } },
      },
    ] as never[];
    assert.deepEqual(projectPendingLayouts([layout], [{ collectionId: 'b1', layoutRevision: 5 }], pending), [
      { collectionId: 'b1', layoutRevision: 5, rows: 3, cols: 3 },
    ]);
  });
  test('a conflicted layout and everything after it is not shown', () => {
    const pending = [
      {
        status: 'conflict',
        intent: { kind: 'slots', request: { collectionId: 'b1', commands: [{ kind: 'layout', rows: 3, cols: 3 }] } },
      },
    ] as never[];
    assert.deepEqual(projectPendingLayouts([layout], [{ collectionId: 'b1', layoutRevision: 4 }], pending), [layout]);
  });
});

describe('queued layout intent', () => {
  // Synthetic one-binder snapshot: one card in the first of two pockets.
  const owner = 'synthetic-owner',
    collectionId = '03620000-0000-4000-8000-000000000011';
  const snapshot = {
    ownerUserId: owner,
    inventoryRevision: 7,
    items: [
      {
        id: 'copy',
        ownerUserId: owner,
        identity: { kind: 'card', cardId: 'synthetic-card' },
        grading: null,
        acquiredAt: null,
        version: 1,
      },
    ],
    placements: [{ inventoryItemId: 'copy', collectionId, slotId: 'slot-a', version: 1 }],
    collections: [
      {
        id: collectionId,
        ownerUserId: owner,
        name: 'Synthetic',
        kind: 'binder',
        defaultPresentation: 'binder',
        version: 3,
      },
    ],
    binders: [
      {
        ownerUserId: owner,
        collectionId,
        layoutRevision: 5,
        presetManifest: null,
        slots: ['slot-a', 'slot-b'].map((id, i) => ({
          id,
          ownerUserId: owner,
          collectionId,
          version: 2,
          inventoryItemId: i ? null : 'copy',
          status: i ? null : 'collected',
          wantedCards: [],
          target: null,
          presetOrigin: null,
        })),
      },
    ],
  } as unknown as InventorySnapshot;
  const context = {
    source: 'app' as const,
    clientId: null,
    operationId: 'synthetic-layout-operation',
    batchId: null,
    clientOccurredAt: null,
  };
  test('binds the reviewed revisions, and its projection keeps every pocket while advancing the layout', () => {
    const draft = prepareBinderLayoutIntent(
      snapshot,
      { ownerUserId: owner, collectionId, slotId: 'slot-a' },
      { rows: 3, cols: 3 },
      context,
    );
    assert.equal(draft.scope.slotId, null);
    assert.deepEqual(draft.intent.request, {
      collectionId,
      operationId: 'synthetic-layout-operation',
      inventoryRevision: 7,
      collectionVersion: 3,
      layoutRevision: 5,
      commands: [{ kind: 'layout', rows: 3, cols: 3 }],
    });
    const next = projectSlotIntent(snapshot, draft.intent, () => undefined);
    assert.equal(next.inventoryRevision, 8);
    assert.equal(next.collections[0].version, 4);
    assert.equal(next.binders[0].layoutRevision, 6);
    assert.deepEqual(next.binders[0].slots, snapshot.binders[0].slots);
    assert.deepEqual(next.placements, snapshot.placements);
    assert.deepEqual(next.items, snapshot.items);
  });
  test('refuses a binder that is not in the snapshot', () =>
    assert.throws(() =>
      prepareBinderLayoutIntent(
        snapshot,
        { ownerUserId: owner, collectionId: 'missing', slotId: null },
        { rows: 3, cols: 3 },
        context,
      ),
    ));
});
