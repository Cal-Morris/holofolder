import test from 'node:test';
import assert from 'node:assert/strict';
import { BINDER_START_MARKER_KEY, readLocalBinderStart, writeBinderStartMarker } from '../lib/binder-start';
import type { Binder } from '../lib/binders/model';

function memoryStorage(entries: Record<string, unknown> = {}) {
  const values = new Map(
    Object.entries(entries).map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)]),
  );
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

const binder = (id: string): Binder => ({
  id,
  ownerUserId: 'u1',
  name: id,
  color: null,
  sortOrder: 0,
  isDefault: id === 'b1',
  rows: null,
  cols: null,
  createdAt: null,
  updatedAt: null,
});
const native = { version: 1, deviceId: 'device', authSessionId: 'auth' } as const;
const marker = (userId: string, ownerUserId: string, binderId: string | null = null, binders: Binder[] = []) => ({
  userId,
  ownerUserId,
  binderId,
  binders,
  native,
});

test('a native display pointer paints the binder the server last opened, never seeding rows', () => {
  const storage = memoryStorage();
  writeBinderStartMarker(storage, marker('u1', 'u1', 'b2', [binder('b1'), binder('b2')]));
  const state = readLocalBinderStart(storage, '', 'u1');
  assert.deepEqual(state?.collection, []);
  assert.equal(state?.collectionOwnerUserId, 'u1');
  assert.equal(state?.binderId, 'b2');
  assert.deepEqual(
    state?.binders.map((entry) => entry.id),
    ['b1', 'b2'],
  );
  assert.equal(readLocalBinderStart(storage, '', 'u1', 'b2')?.binderId, 'b2');
});

test('waits for the server when the URL asks for another binder, for another account, or without a native pointer', () => {
  const storage = memoryStorage();
  writeBinderStartMarker(storage, marker('u1', 'u1', 'b2'));
  assert.equal(readLocalBinderStart(storage, '', 'u1', 'b1'), null);
  assert.equal(readLocalBinderStart(storage, '', 'u2'), null);
  const notNative = memoryStorage();
  writeBinderStartMarker(notNative, { ...marker('u1', 'u1'), native: undefined });
  assert.equal(readLocalBinderStart(notNative, '', 'u1'), null);
  assert.equal(readLocalBinderStart(memoryStorage(), '', 'u1'), null);
});

test('keeps partner mode: the marker remembers the partner as owner', () => {
  const storage = memoryStorage({
    holofolder_billing_v1: {
      accountId: 'partner',
      access: { ownerUserId: 'owner', source: 'perpetual', enforced: true },
    },
  });
  writeBinderStartMarker(storage, marker('partner', 'owner'));
  assert.equal(readLocalBinderStart(storage, '', 'partner')?.collectionOwnerUserId, 'owner');
});

test('suspended or unknown partner access never paints a cached shared binder', () => {
  const storage = memoryStorage();
  writeBinderStartMarker(storage, marker('partner', 'owner'));
  assert.equal(readLocalBinderStart(storage, '', 'partner'), null);
  storage.setItem(
    'holofolder_billing_v1',
    JSON.stringify({ accountId: 'partner', access: { ownerUserId: 'owner', source: 'free', enforced: true } }),
  );
  assert.equal(readLocalBinderStart(storage, '', 'partner'), null);
});

test('ignores a malformed marker', () => {
  assert.equal(readLocalBinderStart(memoryStorage({ [BINDER_START_MARKER_KEY]: '{oops' }), '', 'u1'), null);
  assert.equal(readLocalBinderStart(memoryStorage({ [BINDER_START_MARKER_KEY]: { userId: 1 } }), '', 'u1'), null);
});

test('a storage that throws on write does not break the start', () => {
  assert.doesNotThrow(() =>
    writeBinderStartMarker(
      {
        setItem: () => {
          throw new Error('quota');
        },
      },
      marker('u1', 'u1'),
    ),
  );
});
