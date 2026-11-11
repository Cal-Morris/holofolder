import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInventoryBrowseIndex,
  queryInventory,
  inventoryGradingLabel,
  inventorySelectLabels,
  type InventoryBrowseCursor,
} from '@/lib/inventory-query';
import {
  inventoryLocationLabel,
  resolveInventoryLocation,
  resolveInventoryLocationIntent,
  slotLocationLabel,
} from '@/lib/inventory-location';
import { canShowInventoryHarness } from '@/lib/inventory-harness-gate';
import type { InventoryBrowseQuery } from '@/lib/domain/inventory-browse';
import {
  completeInventoryBrowseFixture,
  inventoryBrowseCatalog,
  inventoryBrowseFixture,
  inventoryBrowseLayouts,
} from './fixtures/inventory-browse';
const scope = { accountUserId: 'synthetic-owner', ownerUserId: 'synthetic-owner' };
async function index(count = 5) {
  return buildInventoryBrowseIndex(
    scope,
    { kind: 'complete', snapshot: await completeInventoryBrowseFixture(inventoryBrowseFixture(count)) },
    inventoryBrowseCatalog,
    inventoryBrowseLayouts,
  );
}

describe('read-only inventory query', () => {
  test('physical duplicates remain separate across storage and Unassigned, targets do not own', async () => {
    const rows = (await index()).rows;
    assert.equal(rows.length, 5);
    assert.deepEqual(
      rows.slice(0, 3).map((r) => [r.cardId, r.location.kind]),
      [
        ['base1-4', 'assigned'],
        ['base1-4', 'assigned'],
        ['base1-4', 'unassigned'],
      ],
    );
    assert.equal(new Set(rows.map((r) => r.itemId)).size, 5);
    assert.equal(rows[3].name, null);
    assert.deepEqual(rows[3].speciesNames, ['Pokémon #6']);
    assert.equal(rows[3].image, null);
    assert.equal(rows[3].language, null);
    assert.equal(rows[0].image, inventoryBrowseCatalog[0].card.image);
    assert.equal(rows[0].setName, 'Base Set');
    assert.equal(rows[0].number, '4');
  });
  test('search, scope, assignment, raw/graded and exact provider/grade filters are pure', async () => {
    const data = await index(),
      before = JSON.stringify(data);
    const cases: [InventoryBrowseQuery, number][] = [
      [{ search: 'charizard base1' }, 3],
      [{ search: 'base set 4' }, 3],
      [{ collectionId: 'alpha' }, 1],
      [{ collectionId: 'trades' }, 1],
      [{ assignment: 'unassigned' }, 3],
      [{ assignment: 'assigned' }, 2],
      [{ condition: 'raw' }, 2],
      [{ condition: 'graded' }, 3],
      [{ provider: 'PSA', grade: '10' }, 1],
      [{ provider: 'CGC', grade: '10' }, 0],
      [{ search: 'SYNTHETIC-PRIVATE-CERT' }, 0],
    ];
    for (const [query, count] of cases) assert.equal(queryInventory(data, query).total, count, JSON.stringify(query));
    assert.equal(JSON.stringify(data), before);
    for (const word of ['certificate', 'SYNTHETIC-PRIVATE', 'holder', 'assetIds']) assert.ok(!before.includes(word));
    assert.equal(inventoryGradingLabel(data.rows[0]), 'Raw');
    assert.equal(inventoryGradingLabel(data.rows[2]), 'CGC · Grade unknown');
    assert.match(inventoryGradingLabel(data.rows[1]), /PSA · 10 · Scale 1–10/);
  });
  test('catalog identity and language evidence must match, never infer another printing', async () => {
    const snapshot = await completeInventoryBrowseFixture();
    const mismatch = inventoryBrowseCatalog.map((e) => ({ ...e, card: { ...e.card, language: 'ja' as const } }));
    assert.equal(buildInventoryBrowseIndex(scope, { kind: 'complete', snapshot }, mismatch, []).rows[0].name, null);
    const ambiguous = [...inventoryBrowseCatalog, inventoryBrowseCatalog[0]];
    assert.equal(buildInventoryBrowseIndex(scope, { kind: 'complete', snapshot }, ambiguous, []).rows[0].name, null);
  });
  test('all deterministic sorts walk beyond 1000 distinct IDs and reject changed query/snapshot/scope cursors', async () => {
    const data = await index(1205);
    for (const sort of ['name', 'set', 'location', 'grading', 'id'] as const) {
      let cursor: InventoryBrowseCursor | null = null;
      const ids: string[] = [];
      do {
        const page = queryInventory(data, { sort }, cursor, 100);
        assert.equal(page.invalidCursor, false);
        ids.push(...page.rows.map((r) => r.itemId));
        cursor = page.next;
      } while (cursor);
      assert.equal(ids.length, 1205);
      assert.equal(new Set(ids).size, 1205);
      assert.deepEqual(
        ids.slice(0, 100),
        queryInventory(data, { sort }, null, 100).rows.map((r) => r.itemId),
      );
    }
    const cursor = queryInventory(data).next!;
    assert.equal(queryInventory(data, { assignment: 'assigned' }, cursor).invalidCursor, true);
    assert.equal(queryInventory(await index(1205), {}, cursor).invalidCursor, false);
    const changed = inventoryBrowseFixture(1205);
    changed.inventoryRevision++;
    const revised = buildInventoryBrowseIndex(
      scope,
      { kind: 'complete', snapshot: await completeInventoryBrowseFixture(changed) },
      inventoryBrowseCatalog,
      inventoryBrowseLayouts,
    );
    assert.equal(queryInventory(revised, {}, cursor).invalidCursor, true);
    const partner = { ...data, key: 'different-account', scope: { ...scope, accountUserId: 'partner' } };
    assert.equal(queryInventory(partner, {}, cursor).invalidCursor, true);
  });
  test('complete empty, unavailable, cached-only and foreign-owner states remain distinct', async () => {
    const empty = await index(0);
    assert.equal(empty.kind, 'complete');
    assert.equal(empty.rows.length, 0);
    const snapshot = await completeInventoryBrowseFixture();
    const cached = buildInventoryBrowseIndex(scope, { kind: 'cached', snapshot }, [], []);
    assert.equal(cached.kind, 'cached');
    assert.equal(cached.rows[2].location.kind, 'unknown');
    assert.equal(queryInventory(cached, { assignment: 'unassigned' }).total, 0);
    assert.equal(queryInventory(cached, { assignment: 'unknown' }).total, 3);
    const partial = inventoryBrowseFixture();
    partial.items = [partial.items[0], partial.items[2]];
    partial.placements = [partial.placements[0]];
    partial.binders[1].slots[9].inventoryItemId = null;
    partial.binders[1].slots[9].status = null;
    const subset = buildInventoryBrowseIndex(
      scope,
      { kind: 'cached', snapshot: partial },
      inventoryBrowseCatalog,
      inventoryBrowseLayouts,
    );
    assert.equal(subset.kind, 'cached');
    assert.equal(subset.rows.length, 2);
    assert.equal(subset.rows[1].location.kind, 'unknown');
    assert.equal(subset.rows[0].location.kind === 'assigned' && subset.rows[0].location.page, null);
    assert.equal(queryInventory(subset, { assignment: 'unassigned' }).total, 0);
    const foreign = buildInventoryBrowseIndex(
      { ...scope, ownerUserId: 'other' },
      { kind: 'complete', snapshot },
      [],
      [],
    );
    assert.equal(foreign.kind, 'unavailable');
    assert.equal(foreign.rows.length, 0);
    const partner = buildInventoryBrowseIndex(
      { ...scope, accountUserId: 'linked-partner' },
      { kind: 'complete', snapshot },
      [],
      [],
    );
    assert.equal(partner.rows.length, 5);
    assert.equal(buildInventoryBrowseIndex(scope, { kind: 'unavailable' }, [], []).kind, 'unavailable');
    // Structural validity/serialization cannot confer the private complete-read brand.
    const unbranded = structuredClone(snapshot);
    assert.equal(
      buildInventoryBrowseIndex(scope, { kind: 'complete', snapshot: unbranded }, [], []).kind,
      'unavailable',
    );
  });
});

test('selection names use card, printing and location, never copy IDs, and stay distinct', async () => {
  const rows = (await index()).rows;
  const labels = inventorySelectLabels(rows);
  assert.equal(labels.get('copy-00001'), 'Select Charizard, Base Set #4, Alpha · Page 2 · Pocket 1');
  for (const label of labels.values()) assert.doesNotMatch(label, /copy-\d/);
  assert.equal(new Set(labels.values()).size, rows.length);
  const twins = inventorySelectLabels([rows[2], { ...rows[2], itemId: 'twin' }]);
  assert.deepEqual(
    [...twins.values()].map((l) => l.slice(-6)),
    ['copy 1', 'copy 2'],
  );
});

describe('current storage locations', () => {
  test('page/slot follow stable slot order and explicitly verified grids', () => {
    const snapshot = inventoryBrowseFixture(),
      id = snapshot.items[0].id;
    const initial = resolveInventoryLocation(snapshot, id, inventoryBrowseLayouts);
    assert.equal(inventoryLocationLabel(initial), 'Alpha · Page 2 · Pocket 1');
    assert.equal(initial.kind === 'assigned' && initial.row, 1);
    const grid = inventoryBrowseLayouts.map((l) => ({ ...l, rows: 4, cols: 4 }));
    assert.equal(inventoryLocationLabel(resolveInventoryLocation(snapshot, id, grid)), 'Alpha · Page 1 · Pocket 10');
    snapshot.binders[0].slots.reverse();
    snapshot.binders[0].layoutRevision++;
    const current = inventoryBrowseLayouts.map((l) => ({ ...l, layoutRevision: 2 }));
    assert.equal(inventoryLocationLabel(resolveInventoryLocation(snapshot, id, current)), 'Alpha · Page 1 · Pocket 3');
    assert.match(
      inventoryLocationLabel(resolveInventoryLocation(snapshot, id, inventoryBrowseLayouts)),
      /Position \d+ in the binder/,
    );
    assert.match(inventoryLocationLabel(resolveInventoryLocation(snapshot, id, [])), /Position \d+ in the binder/);
    assert.match(
      inventoryLocationLabel(
        resolveInventoryLocation(
          snapshot,
          id,
          current.map((l) => ({ ...l, rows: 0 })),
        ),
      ),
      /Position \d+ in the binder/,
    );
    assert.deepEqual(initial.kind === 'assigned' && initial.intent, {
      collectionId: 'alpha',
      slotId: 'slot-0',
      itemId: id,
    });
  });
  test('wanted slots get readable binder, page and slot labels, never raw slot IDs', () => {
    const snapshot = inventoryBrowseFixture();
    assert.equal(
      slotLocationLabel(snapshot, 'alpha', 'alpha-empty-1', inventoryBrowseLayouts),
      'Alpha · Page 1 · Pocket 2',
    );
    assert.equal(slotLocationLabel(snapshot, 'alpha', 'alpha-empty-1', []), 'Alpha · Position 2 in the binder');
    assert.equal(slotLocationLabel(snapshot, 'alpha', 'missing-slot', inventoryBrowseLayouts), 'Location unknown');
  });
  test('host re-resolves moved, unassigned and deleted copies without trusting old page or collection', () => {
    const snapshot = inventoryBrowseFixture(),
      id = snapshot.items[0].id;
    const old = resolveInventoryLocation(snapshot, id, inventoryBrowseLayouts);
    assert.equal(old.kind, 'assigned');
    if (old.kind !== 'assigned') return;
    snapshot.placements[0] = { ...snapshot.placements[0], collectionId: 'trades', slotId: 'trades-empty-0' };
    snapshot.binders[0].slots[9].inventoryItemId = null;
    snapshot.binders[1].slots[0].inventoryItemId = id;
    assert.equal(
      inventoryLocationLabel(resolveInventoryLocationIntent(snapshot, old.intent, inventoryBrowseLayouts)),
      'Trades · Page 1 · Pocket 1',
    );
    snapshot.placements.shift();
    snapshot.binders[1].slots[0].inventoryItemId = null;
    assert.equal(resolveInventoryLocationIntent(snapshot, old.intent, inventoryBrowseLayouts).kind, 'unassigned');
    snapshot.items.shift();
    assert.equal(resolveInventoryLocationIntent(snapshot, old.intent, inventoryBrowseLayouts).kind, 'missing');
  });
});

test('synthetic harness is local-only and cannot be enabled on hosted production by E2E env', () => {
  assert.equal(canShowInventoryHarness('1', false, 'localhost:3524'), true);
  for (const host of [null, 'holofolder.com', 'localhost.evil.test', '127.0.0.1.evil.test', 'app.holofolder.com'])
    assert.equal(canShowInventoryHarness('1', false, host), false);
  assert.equal(canShowInventoryHarness('1', true, 'localhost:3524'), false);
  assert.equal(canShowInventoryHarness(undefined, false, 'localhost:3524'), false);
});

test('location keyset prefixes cannot hide a distinct copy between pages', async () => {
  for (const reverse of [false, true]) {
    const snapshot = inventoryBrowseFixture();
    snapshot.collections[0].name = 'unassigned';
    snapshot.items[2].id = '0000000000000010';
    if (reverse) snapshot.items.reverse();
    const data = buildInventoryBrowseIndex(
      scope,
      { kind: 'complete', snapshot: await completeInventoryBrowseFixture(snapshot) },
      inventoryBrowseCatalog,
      inventoryBrowseLayouts,
    );
    const seen: string[] = [];
    let cursor: InventoryBrowseCursor | null = null;
    do {
      const page = queryInventory(data, { sort: 'location' }, cursor, 1);
      seen.push(...page.rows.map((row) => row.itemId));
      cursor = page.next;
    } while (cursor);
    assert.equal(seen.length, snapshot.items.length);
    assert.deepEqual(new Set(seen), new Set(snapshot.items.map((item) => item.id)));
    assert.deepEqual(
      seen,
      queryInventory(data, { sort: 'location' }, null, 100).rows.map((row) => row.itemId),
    );
  }
});
