import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  captureNavigationScroll,
  defaultCollectionView,
  navigationIndex,
  navigationLocation,
  navigationStorageKey,
  normalizeNavigationState,
  projectPendingLayouts,
  resolveNavigation,
  type CollectionNavigationRead,
} from '../lib/collection-navigation';
import {
  completeInventoryBrowseFixture,
  inventoryBrowseFixture,
  inventoryBrowseCatalog,
  inventoryBrowseLayouts,
} from './fixtures/inventory-browse';
const scope = { sessionId: 'synthetic-session', accountUserId: 'synthetic-owner', ownerUserId: 'synthetic-owner' };
async function read(): Promise<CollectionNavigationRead> {
  return {
    scope,
    evidence: { kind: 'complete', snapshot: await completeInventoryBrowseFixture() },
    catalog: inventoryBrowseCatalog,
    layouts: inventoryBrowseLayouts,
  };
}
describe('device-local collection navigation', () => {
  test('retains only an exact Sets destination through normalization, scroll capture and history', async () => {
    const set = { id: 'synthetic-set', name: 'Synthetic Search Set', injected: 'PRIVATE' };
    const input = {
      main: 'dex',
      dexView: 'sets',
      collectionId: 'alpha',
      collections: { alpha: { ...defaultCollectionView(), page: 2, search: 'saved' } },
      requestedSet: set,
    };
    const state = captureNavigationScroll(normalizeNavigationState(input), 120);
    const restored = resolveNavigation(JSON.parse(JSON.stringify(state)), scope, await read()).state;
    assert.deepEqual(restored.requestedSet, { id: set.id, name: set.name });
    assert.equal(restored.collections.alpha.page, 2);
    assert.equal(restored.collections.alpha.search, 'saved');
    assert.equal(restored.dexScroll, 120);
    assert.doesNotMatch(JSON.stringify(restored), /PRIVATE/);
    for (const requestedSet of [null, [], { id: '', name: 'Set' }, { id: 'set', name: ' ' }, { id: 1, name: 'Set' }]) {
      assert.equal(normalizeNavigationState({ ...input, requestedSet }).requestedSet, null);
    }
    assert.equal(normalizeNavigationState({ ...input, main: 'collection' }).requestedSet, null);
    assert.equal(normalizeNavigationState({ ...input, dexView: 'wanted' }).requestedSet, null);
  });
  test('restores only meaningful presentation, drops all transient and untrusted fields', () => {
    const input = {
      main: 'collection',
      collectionId: 'alpha',
      collections: {
        alpha: { view: 'list', page: 2, search: 'charizard', scroll: 832, editing: true, selected: ['slot-0'] },
      },
      inventory: {
        query: { search: 'base set', collectionId: 'alpha', sort: 'id', condition: 'bad', certificate: 'PRIVATE' },
        window: 2,
        scroll: 400,
        cursor: 'FORGED',
      },
      overlay: 'detail',
      drag: true,
    };
    const state = normalizeNavigationState(JSON.parse(JSON.stringify(input)));
    assert.deepEqual(state.collections.alpha, { view: 'list', page: 2, search: 'charizard', scroll: 832 });
    assert.equal(state.inventory.window, 2);
    assert.equal(state.inventory.query.condition, undefined);
    assert.doesNotMatch(JSON.stringify(state), /PRIVATE|FORGED|editing|selected|overlay|drag/);
    assert.equal(
      normalizeNavigationState({ collections: { alpha: { page: -4, scroll: Infinity } } }).collections.alpha.page,
      1,
    );
  });
  test('keys isolate account, partner-owner and device local storage namespace', () => {
    assert.notEqual(navigationStorageKey(scope), navigationStorageKey({ ...scope, accountUserId: 'partner' }));
    assert.notEqual(navigationStorageKey(scope), navigationStorageKey({ ...scope, ownerUserId: 'other' }));
  });
  test('the binder is the starting view, Inventory only when it is named or there is no binder', async () => {
    assert.equal(normalizeNavigationState(null).main, 'collection');
    const opened = resolveNavigation(normalizeNavigationState(null), scope, await read());
    assert.equal(opened.state.main, 'collection');
    assert.equal(opened.state.collectionId, 'alpha');
    assert.equal(
      resolveNavigation(normalizeNavigationState(null), scope, await read(), new URLSearchParams('view=inventory'))
        .state.main,
      'inventory',
    );
    assert.equal(
      resolveNavigation(normalizeNavigationState(null), scope, { ...(await read()), evidence: { kind: 'unavailable' } })
        .state.main,
      'inventory',
    );
  });
  test('old binder/page and unsupported slabs links override remembered destination', async () => {
    const saved = normalizeNavigationState({
      main: 'inventory',
      collectionId: 'trades',
      collections: { alpha: { view: 'list', page: 1 } },
    });
    const resolved = resolveNavigation(saved, scope, await read(), new URLSearchParams('binder=alpha&page=2'));
    assert.equal(resolved.state.main, 'collection');
    assert.equal(resolved.state.collectionId, 'alpha');
    assert.equal(resolved.state.collections.alpha.view, 'binder');
    assert.equal(resolved.state.collections.alpha.page, 2);
    assert.match(
      resolveNavigation(saved, scope, await read(), new URLSearchParams('binder=alpha&view=slabs')).notice,
      /not available/,
    );
    assert.equal(resolveNavigation(saved, scope, await read(), new URLSearchParams('view=dex')).state.main, 'dex');
  });
  test('item and slot links derive current page and highlight, never retain callback page', async () => {
    const result = resolveNavigation(
      normalizeNavigationState(null),
      scope,
      await read(),
      new URLSearchParams('binder=alpha&slot=slot-0&page=99&view=list'),
    );
    assert.equal(result.state.collections.alpha.page, 2);
    assert.equal(result.state.collections.alpha.view, 'binder');
    assert.deepEqual(result.highlight, { collectionId: 'alpha', slotId: 'slot-0', itemId: 'copy-00001' });
  });
  test('missing/uncached collections and storage filters have usable fallback', async () => {
    const r = await read();
    const saved = normalizeNavigationState({
      main: 'collection',
      collectionId: 'deleted',
      inventory: { query: { collectionId: 'deleted' }, window: 4 },
    });
    const resolved = resolveNavigation(saved, scope, r);
    assert.equal(resolved.state.collectionId, 'alpha');
    assert.match(resolved.notice, /unavailable/);
    assert.equal(resolved.state.inventory.query.collectionId, '');
    assert.equal(resolved.state.inventory.window, 0);
    r.evidence = { kind: 'unavailable' };
    assert.equal(resolveNavigation(saved, scope, r).state.main, 'inventory');
  });
  test('same-owner stale partner/actor reads, foreign owners and serialized brands fail closed', async () => {
    const r = await read();
    for (const next of [
      { ...scope, sessionId: 'relinked-session' },
      { ...scope, accountUserId: 'partner' },
      { ...scope, ownerUserId: 'other' },
    ]) {
      assert.equal(navigationIndex(next, r).kind, 'unavailable');
      assert.equal(
        navigationLocation(next, r, { collectionId: 'alpha', slotId: 'slot-0', itemId: 'copy-00001' }).kind,
        'unknown',
      );
    }
    assert.equal(navigationIndex(scope, JSON.parse(JSON.stringify(r))).kind, 'unavailable');
    r.scope = { ...scope, accountUserId: 'partner' };
    assert.equal(navigationIndex(r.scope, r).kind, 'complete');
  });
  test('fresh moved, unassigned, removed and cached locations never use stale coordinates', async () => {
    const r = await read(),
      snapshot = inventoryBrowseFixture(),
      intent = { collectionId: 'alpha', slotId: 'slot-0', itemId: 'copy-00001' };
    const placement = snapshot.placements[0];
    Object.assign(
      snapshot.binders[0].slots.find((s) => s.id === 'slot-0')!,
      { inventoryItemId: null, status: null },
    );
    placement.collectionId = 'trades';
    placement.slotId = snapshot.binders[1].slots[0].id;
    Object.assign(snapshot.binders[1].slots[0], { inventoryItemId: intent.itemId, status: 'collected' });
    r.evidence = { kind: 'complete', snapshot: await completeInventoryBrowseFixture(snapshot) };
    const result = navigationLocation(scope, r, intent);
    assert.equal(result.kind, 'assigned');
    if (result.kind === 'assigned') {
      assert.equal(result.page, 1);
      assert.equal(result.intent.collectionId, 'trades');
    }
    r.evidence = { kind: 'cached', snapshot };
    assert.equal(navigationLocation(scope, r, intent).kind, 'unknown');
    assert.equal(navigationLocation(scope, await read(), { ...intent, itemId: 'copy-00003' }).kind, 'unassigned');
    assert.equal(navigationLocation(scope, await read(), { ...intent, itemId: 'removed' }).kind, 'missing');
  });
  test('scroll, search and page are per destination, navigation cannot change canonical data', async () => {
    const r = await read(),
      before = JSON.stringify(r);
    let state = normalizeNavigationState({
      main: 'inventory',
      collectionId: 'alpha',
      collections: { alpha: { ...defaultCollectionView(), page: 2, search: 'charizard' } },
      inventory: { query: { search: 'base' }, window: 1 },
    });
    state = captureNavigationScroll(state, 891);
    state.main = 'collection';
    state = captureNavigationScroll(state, 403);
    assert.equal(state.inventory.scroll, 891);
    assert.equal(state.collections.alpha.scroll, 403);
    resolveNavigation(state, scope, r);
    navigationLocation(scope, r, { collectionId: 'alpha', slotId: 'slot-0', itemId: 'copy-00001' });
    assert.equal(JSON.stringify(r), before);
  });
});

test('restored Inventory windows show every row through the window and clamp after filtering/removal', async () => {
  const { inventoryWindowRows } = await import('../lib/inventory-query');
  const snapshot = await completeInventoryBrowseFixture(inventoryBrowseFixture(1205));
  const r: CollectionNavigationRead = {
    scope,
    evidence: { kind: 'complete', snapshot },
    catalog: inventoryBrowseCatalog,
    layouts: inventoryBrowseLayouts,
  };
  const index = navigationIndex(scope, r),
    query = { sort: 'id' as const };
  const restored = inventoryWindowRows(index, query, 25);
  assert.equal(restored.window, 25);
  assert.equal(restored.rows.length, 1040);
  assert.equal(restored.total, 1205);
  assert.equal(restored.rows[0].itemId, 'copy-00001');
  assert.equal(restored.rows[1000].itemId, 'copy-01001');
  assert.equal(inventoryWindowRows(index, query, 25000).rows.length, 1205);
  const filtered = inventoryWindowRows(index, { ...query, collectionId: 'alpha' }, 25000);
  assert.equal(filtered.window, 0);
  assert.equal(filtered.rows.length, filtered.total);
  const missing = inventoryWindowRows(index, { search: 'no-such-printing' }, 25000);
  assert.equal(missing.rows.length, 0);
  assert.equal(missing.window, 0);
  const changed = navigationIndex(scope, await read());
  assert.equal(inventoryWindowRows(changed, query, 25).window, 0);
});

test('matching explicit destination retains saved scroll, targeted page clears filters', async () => {
  const saved = normalizeNavigationState({
    main: 'collection',
    collectionId: 'alpha',
    collections: { alpha: { view: 'list', page: 2, search: 'nothing-matches', scroll: 580 } },
  });
  const r = await read();
  const same = resolveNavigation(saved, scope, r, new URLSearchParams('view=list&binder=alpha'));
  assert.equal(same.state.collections.alpha.scroll, 580);
  assert.equal(same.state.collections.alpha.search, 'nothing-matches');
  const target = resolveNavigation(saved, scope, r, new URLSearchParams('binder=alpha&page=2'));
  assert.equal(target.state.collections.alpha.search, '');
  assert.equal(target.state.collections.alpha.scroll, 0);
});

test('stable empty target/spacer links locate the slot without inventing an owned copy', async () => {
  const result = resolveNavigation(
    normalizeNavigationState(null),
    scope,
    await read(),
    new URLSearchParams('binder=alpha&slot=alpha-empty-11'),
  );
  assert.equal(result.state.collections.alpha.page, 2);
  assert.deepEqual(result.highlight, { collectionId: 'alpha', slotId: 'alpha-empty-11' });
});

test('custom defaults to List only on first visit, saved Binder and explicit page links remain valid', async () => {
  const r = await read();
  if (r.evidence.kind !== 'complete') throw new Error('fixture');
  r.evidence.snapshot.collections.find((c) => c.id === 'alpha')!.kind = 'custom';
  r.evidence.snapshot.collections.find((c) => c.id === 'alpha')!.defaultPresentation = 'list';
  const initial = normalizeNavigationState({ main: 'collection', collectionId: 'alpha' });
  assert.equal(resolveNavigation(initial, scope, r).state.collections.alpha.view, 'list');
  const cached: CollectionNavigationRead = {
    ...r,
    evidence: { kind: 'cached', snapshot: structuredClone(r.evidence.snapshot) },
  };
  assert.equal(resolveNavigation(initial, scope, cached).state.collections.alpha.view, 'list');
  assert.equal(
    resolveNavigation(initial, scope, r, new URLSearchParams('binder=alpha')).state.collections.alpha.view,
    'list',
  );
  const saved = normalizeNavigationState({ ...initial, collections: { alpha: defaultCollectionView() } });
  assert.equal(resolveNavigation(saved, scope, r).state.collections.alpha.view, 'binder');
  assert.equal(
    resolveNavigation(initial, scope, r, new URLSearchParams('binder=alpha&page=2')).state.collections.alpha.view,
    'binder',
  );
  assert.equal(
    resolveNavigation(initial, scope, r, new URLSearchParams('binder=alpha&view=binder')).state.collections.alpha.view,
    'binder',
  );
});

describe('projectPendingLayouts', () => {
  const layout = (layoutRevision: number) => ({ collectionId: 'alpha', layoutRevision, rows: 4, cols: 4 });
  test('a read landing mid-sync still matches the binder with moves pending (synthetic revisions)', () => {
    // Base 5, three queued moves project to 8; the server has acknowledged one, so the read says 6.
    assert.deepEqual(projectPendingLayouts([layout(6)], [{ collectionId: 'alpha', layoutRevision: 8 }]), [layout(8)]);
    assert.deepEqual(projectPendingLayouts([layout(5)], [{ collectionId: 'alpha', layoutRevision: 8 }]), [layout(8)]);
  });
  test('a read ahead of the projection, or for another binder, is left alone', () => {
    assert.deepEqual(projectPendingLayouts([layout(9)], [{ collectionId: 'alpha', layoutRevision: 8 }]), [layout(9)]);
    assert.deepEqual(projectPendingLayouts([layout(5)], [{ collectionId: 'beta', layoutRevision: 8 }]), [layout(5)]);
    assert.deepEqual(projectPendingLayouts([layout(5)], undefined), [layout(5)]);
  });
});
