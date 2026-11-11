import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBinderSharePath,
  buildBinderShareUrl,
  publicCollectionItems,
  shareManagementTarget,
  type NativeShareSelection,
} from '../lib/binder-share';

test('buildBinderSharePath builds the read-only share route', () => {
  assert.equal(buildBinderSharePath('abc123'), '/app/share/abc123');
});

test('buildBinderShareUrl joins the origin and share path', () => {
  assert.equal(buildBinderShareUrl('https://holofolder.com', 'abc123'), 'https://holofolder.com/app/share/abc123');
  assert.equal(buildBinderShareUrl('https://holofolder.com/', 'abc123'), 'https://holofolder.com/app/share/abc123');
  assert.equal(buildBinderShareUrl('http://localhost:3000/some/page', 't'), 'http://localhost:3000/app/share/t');
});

test('share URLs accept server paths and keep named production addresses canonical', () => {
  assert.equal(buildBinderShareUrl('https://holofolder.com', '/@cal/national'), 'https://holofolder.com/@cal/national');
  assert.equal(
    buildBinderShareUrl('https://app.holofolder.com', '/@cal/national'),
    'https://holofolder.com/@cal/national',
  );
  assert.equal(
    buildBinderShareUrl('http://localhost:3441', '/@cal/national'),
    'http://localhost:3441/app/u/cal/national',
  );
  assert.equal(
    buildBinderShareUrl('https://preview.vercel.app', '/@cal/national'),
    'https://preview.vercel.app/app/u/cal/national',
  );
  assert.equal(
    buildBinderShareUrl('https://holofolder.com', '/app/share/abc123'),
    'https://holofolder.com/app/share/abc123',
  );
  assert.throws(() => buildBinderShareUrl('https://holofolder.com', '//example.com/private'));
  assert.throws(() => buildBinderShareUrl('https://holofolder.com', '/@cal/../private'));
});

test('public collection data excludes database metadata and partner identities', () => {
  const rows = [
    {
      id: 'synthetic-row',
      pokemon_id: 1,
      pokemon_name: 'synthetic',
      user_id: 'private-owner',
      binder_id: 'private-binder',
      private_note: 'not public',
      wanted_cards: [
        {
          card_id: 'synthetic-card',
          card_name: 'Synthetic card',
          added_at: '2026-01-01T00:00:00Z',
          wanted_by: ['private-partner'],
        },
      ],
    },
  ];
  const result = publicCollectionItems(rows);
  assert.equal(result[0].pokemon_id, 1);
  assert.equal(result[0].wanted_cards[0].card_id, 'synthetic-card');
  assert.equal('user_id' in result[0], false);
  assert.equal('private_note' in result[0], false);
  assert.equal('wanted_by' in result[0].wanted_cards[0], false);
});

// Synthetic ids only.
const snapshot = (owner: string) => ({
  ownerUserId: owner,
  inventoryRevision: 1,
  items: [],
  placements: [],
  binders: [],
  collections: [
    {
      id: 'binder-a',
      ownerUserId: owner,
      name: 'Synthetic A',
      kind: 'binder',
      defaultPresentation: 'binder',
      version: 1,
    },
    {
      id: 'binder-b',
      ownerUserId: owner,
      name: 'Synthetic B',
      kind: 'binder',
      defaultPresentation: 'binder',
      version: 1,
    },
  ],
});
const native = (patch: Partial<NativeShareSelection> = {}): NativeShareSelection => ({
  accountUserId: 'partner',
  ownerUserId: 'owner',
  collectionId: 'binder-b',
  evidence: { kind: 'complete', snapshot: snapshot('owner') } as unknown as NativeShareSelection['evidence'],
  ...patch,
});
const target = (overrides: Partial<Parameters<typeof shareManagementTarget>[0]> = {}) =>
  shareManagementTarget({
    userId: 'partner',
    ownerUserId: 'owner',
    publicView: false,
    legacyBinderId: 'binder-a',
    legacyWritable: false,
    native: native(),
    ...overrides,
  });

test("native owners and partners manage the selected collection's link, not the legacy boot binder", () => {
  assert.deepEqual(target(), { binderId: 'binder-b', name: 'Synthetic B' });
  assert.deepEqual(target({ userId: 'owner', native: native({ accountUserId: 'owner' }) }), {
    binderId: 'binder-b',
    name: 'Synthetic B',
  });
  assert.deepEqual(target({ native: native({ collectionId: 'binder-a' }) }), {
    binderId: 'binder-a',
    name: 'Synthetic A',
  });
});

test('share management never infers a default binder or crosses actor, owner or collection scope', () => {
  assert.equal(target({ native: null }), null, 'Inventory or National Dex: no collection selected');
  assert.equal(target({ native: native({ collectionId: 'unknown' }) }), null);
  assert.equal(
    target({ native: native({ accountUserId: 'previous-account' }) }),
    null,
    'stale read for another account',
  );
  assert.equal(target({ native: native({ ownerUserId: 'other-owner' }) }), null);
  assert.equal(target({ ownerUserId: 'other-owner' }), null);
  assert.equal(
    target({
      native: native({
        evidence: {
          kind: 'complete',
          snapshot: snapshot('other-owner'),
        } as unknown as NativeShareSelection['evidence'],
      }),
    }),
    null,
  );
});

test('cached, unavailable, signed-out and public views get no owner share controls', () => {
  assert.equal(
    target({
      native: native({
        evidence: { kind: 'cached', snapshot: snapshot('owner') } as unknown as NativeShareSelection['evidence'],
      }),
    }),
    null,
  );
  assert.equal(target({ native: native({ evidence: { kind: 'unavailable' } }) }), null);
  assert.equal(target({ userId: null }), null);
  assert.equal(target({ publicView: true }), null);
  assert.equal(target({ publicView: true, native: undefined, legacyWritable: true }), null);
});

test('legacy writable binders keep their own share target', () => {
  assert.deepEqual(target({ native: undefined, legacyWritable: true }), { binderId: 'binder-a' });
  assert.equal(target({ native: undefined, legacyWritable: false }), null);
});
