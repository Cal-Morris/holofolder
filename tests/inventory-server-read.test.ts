import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, owner, collection } from './fixtures/inventory-read-server';
import { isCompleteInventorySnapshot } from '../lib/collection/slot-snapshot';
import { readOwnerInventorySnapshot, readOwnerInventoryState } from '../lib/server/inventory-read';

test('one inventory_read_v2 call returns >1025 copies and ordered slots as a branded snapshot', async () => {
  const f = fixture();
  const snapshot = await readOwnerInventorySnapshot(f.client);
  assert.ok(isCompleteInventorySnapshot(snapshot));
  assert.equal(snapshot.items.length, 1031);
  assert.equal(snapshot.binders[0].slots.length, 1031);
  assert.equal(snapshot.collections[0].version, 3);
  assert.equal(snapshot.binders[0].layoutRevision, 4);
  assert.equal(snapshot.binders[0].slots.at(-1)?.version, 1030);
  assert.equal(snapshot.items[1].identity.kind, 'card');
  assert.deepEqual(
    f.requests.map((r) => r.table),
    ['inventory_read_v3', 'inventory_read_v2'],
  );
});

test('evidence counts come from the same snapshot', async () => {
  const { evidence, snapshot } = await readOwnerInventoryState(fixture(5).client);
  assert.deepEqual(evidence, {
    inventoryRevision: 7,
    items: 5,
    placements: 5,
    collections: 1,
    binders: 1,
    slots: 5,
    storage: [{ collectionId: collection, collectionVersion: 3, layoutRevision: 4, slotCount: 5 }],
  });
  assert.equal(snapshot.inventoryRevision, 7);
});

test('no owner state is revision 0 only for an untouched owner', async () => {
  const f = fixture(0);
  f.tables.inventory_owner_state = [];
  await assert.rejects(readOwnerInventorySnapshot(f.client), { code: 'inventory_not_initialized' });
  f.tables.binders = [];
  f.tables.storage_collection_state = [];
  const empty = await readOwnerInventorySnapshot(f.client);
  assert.equal(empty.inventoryRevision, 0);
  assert.deepEqual(empty.collections, []);
});

test('a binder without its native storage row is not initialized', async () => {
  const f = fixture(0);
  f.tables.storage_collection_state = [];
  await assert.rejects(readOwnerInventorySnapshot(f.client), { code: 'inventory_not_initialized' });
});

test('the server picks the owner from the partnership; a paused partner reads only their own', async () => {
  const f = fixture(0);
  const partner = '33333333-3333-4333-8333-333333333333';
  f.setActor(partner);
  f.tables.partnerships = [{ id: collection, owner_user_id: owner, user1_id: owner, user2_id: partner }];
  const shared = await readOwnerInventoryState(f.client);
  assert.equal(shared.snapshot.ownerUserId, owner);
  assert.equal(shared.actorUserId, partner);
  assert.equal(shared.partnerUserId, partner);
  f.tables.partnerships = [];
  const unlinked = await readOwnerInventorySnapshot(f.client);
  assert.equal(unlinked.ownerUserId, partner);
  assert.equal(unlinked.inventoryRevision, 0);
  f.tables.partnerships = [{ id: collection, owner_user_id: owner, user1_id: owner, user2_id: partner }];
  f.deny();
  const paused = await readOwnerInventoryState(f.client);
  assert.equal(paused.snapshot.ownerUserId, partner);
  assert.equal(paused.partnerUserId, null);
  assert.deepEqual(paused.snapshot.collections, []);
  f.setActor(owner);
  await assert.rejects(readOwnerInventorySnapshot(f.client), { code: 'inventory_read_forbidden' });
  f.setActor(partner);
  f.oauth();
  await assert.rejects(readOwnerInventorySnapshot(f.client), { code: 'inventory_sign_in_required' });
});

test('errors map to sign-in, forbidden or unavailable without leaking details', async () => {
  const respond = (body: object, status = 403) => {
    const f = fixture(0);
    f.intercept(() => Response.json(body, { status }));
    return readOwnerInventorySnapshot(f.client);
  };
  await assert.rejects(respond({ code: '42501', message: 'permission denied for function inventory_read_v2' }), {
    code: 'inventory_sign_in_required',
    status: 401,
  });
  await assert.rejects(respond({ code: '42501', message: 'inventory_read_forbidden' }), {
    code: 'inventory_read_forbidden',
    status: 403,
  });
  await assert.rejects(respond({ code: '55000', message: 'synthetic-private-detail' }, 400), (error) => {
    assert.equal((error as Error).message, 'inventory_read_unavailable');
    return true;
  });
});

test('broken rows fail the whole read', async () => {
  const broken: ((f: ReturnType<typeof fixture>) => void)[] = [
    (f) => {
      f.tables.inventory_items.pop();
    },
    (f) => {
      f.tables.inventory_placements.pop();
    },
    (f) => {
      f.tables.inventory_items[1].id = f.tables.inventory_items[0].id;
    },
    (f) => {
      f.tables.binder_slots[0].status = null;
    },
    (f) => {
      f.tables.inventory_items[0].identity = { kind: 'pokemon', pokemonId: 0 };
    },
  ];
  for (const corrupt of broken) {
    const f = fixture(3);
    corrupt(f);
    await assert.rejects(readOwnerInventorySnapshot(f.client), { code: 'inventory_read_unavailable' });
  }
  const shape = fixture(0);
  shape.intercept(() => Response.json({ scope: null, snapshot: {} }));
  await assert.rejects(readOwnerInventorySnapshot(shape.client), { code: 'inventory_read_unavailable' });
});

test('recorded grades and unknown printings pass through; legacy provenance is never returned', async () => {
  const f = fixture(6);
  const providers = ['psa', 'ace', 'cgc', 'beckett'];
  for (let i = 0; i < 5; i++) {
    f.tables.inventory_items[i].identity = { kind: 'card', cardId: 'synthetic-unknown-trainer' };
    f.tables.inventory_items[i].grading = {
      provider: i < 4 ? { kind: 'known', id: providers[i] } : { kind: 'custom', name: 'Synthetic provider' },
      grade: 'recorded not numeric',
      scale: 'recorded',
      designation: null,
      subgrades: [{ name: 'Surface', grade: 'A' }],
      certificate: 'synthetic-private-certificate',
      holder: 'recorded',
      label: { variant: null, assetIds: ['synthetic-private-label-id'] },
    };
    f.tables.inventory_items[i].legacy_source = { original: 'synthetic private source' };
  }
  const result = await readOwnerInventorySnapshot(f.client);
  assert.deepEqual(
    result.items.map((i) => i.grading),
    f.tables.inventory_items.map((i) => i.grading),
  );
  assert.doesNotMatch(JSON.stringify(result), /legacySource|synthetic private source/);
});

test('spacers keep an empty pocket and a fresh call reads current state', async () => {
  const f = fixture(2);
  f.tables.binder_slots.push({
    id: 'synthetic-spacer',
    owner_user_id: owner,
    collection_id: collection,
    position: 20,
    target: null,
    status: null,
    wanted_cards: [],
    preset_origin: null,
    version: 0,
  });
  const first = await readOwnerInventorySnapshot(f.client);
  assert.equal(first.binders[0].slots.at(-1)?.inventoryItemId, null);
  f.tables.inventory_owner_state[0].inventory_revision = 8;
  f.tables.inventory_items[0].version = 30;
  const second = await readOwnerInventorySnapshot(f.client);
  assert.equal(first.inventoryRevision, 7);
  assert.equal(second.inventoryRevision, 8);
  assert.equal(second.items[0].version, 30);
});

test('all storage kinds and >1000 collections map without invented slots', async () => {
  const f = fixture(0);
  f.tables.binders = [];
  f.tables.storage_collection_state = [];
  for (let n = 0; n < 1031; n++) {
    const id = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    f.tables.binders.push({ id, owner_user_id: owner, name: `Synthetic ${n}` });
    f.tables.storage_collection_state.push({
      collection_id: id,
      owner_user_id: owner,
      kind: ['binder', 'slab', 'custom'][n % 3],
      default_presentation: ['binder', 'slabs', 'list'][n % 3],
      version: n,
      layout_revision: n + 1,
      preset_manifest: null,
      location: null,
    });
  }
  const result = await readOwnerInventorySnapshot(f.client);
  assert.equal(result.collections.length, 1031);
  assert.equal(result.binders.length, 1031);
  assert.equal(result.collections[1].kind, 'slab');
  assert.equal(result.collections[2].defaultPresentation, 'list');
  assert.equal(result.binders.at(-1)?.layoutRevision, 1031);
});
