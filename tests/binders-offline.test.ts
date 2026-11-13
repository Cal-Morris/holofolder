import test from 'node:test';
import assert from 'node:assert/strict';
import type { Binder } from '../lib/binders/model';
import {
  DEVICE_BINDERS_KEY,
  offlineAvailableBinderIds,
  pickOfflineBinder,
  readDeviceBinders,
  rememberDeviceBinders,
  rememberSavedBinders,
} from '../lib/binders/offline';
import { readOfflineBinderBoot } from '../lib/offline-shell';
import { BINDER_START_MARKER_KEY, savedCollectionOwner } from '../lib/binder-start';

const MAIN = '11111111-1111-4111-8111-111111111111';
const TRADES = '22222222-2222-4222-8222-222222222222';
const SPARE = '33333333-3333-4333-8333-333333333333';

const binder = (id: string, name: string, isDefault: boolean, sortOrder: number): Binder => ({
  id,
  ownerUserId: 'owner',
  name,
  color: null,
  sortOrder,
  isDefault,
  rows: null,
  cols: null,
  createdAt: null,
  updatedAt: null,
});
const BINDERS = [
  binder(MAIN, 'My binder', true, 0),
  binder(TRADES, 'Trades', false, 1),
  binder(SPARE, 'Spare', false, 2),
];

function memoryStorage(entries: Record<string, unknown> = {}) {
  const data = new Map(
    Object.entries(entries).map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)]),
  );
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  };
}

test('the binder list is remembered per owner, and saved binders are tracked', () => {
  const storage = memoryStorage();
  rememberDeviceBinders(storage, 'owner', 'owner', BINDERS);
  rememberSavedBinders(storage, 'owner', 'owner', [TRADES, TRADES]);
  const device = readDeviceBinders(storage, 'owner', 'owner')!;
  assert.deepEqual(
    device.binders.map((item) => item.name),
    ['My binder', 'Trades', 'Spare'],
  );
  assert.deepEqual(device.savedBinderIds, [TRADES]);
  assert.equal(readDeviceBinders(storage, 'someone-else', 'owner'), null);

  // A deleted binder's saved flag goes with it.
  rememberDeviceBinders(
    storage,
    'owner',
    'owner',
    BINDERS.filter((item) => item.id !== TRADES),
  );
  assert.deepEqual(readDeviceBinders(storage, 'owner', 'owner')!.savedBinderIds, []);
});

test('a binder opens offline only when this device has a copy of it', () => {
  const storage = memoryStorage();
  rememberDeviceBinders(storage, 'owner', 'owner', BINDERS);
  rememberSavedBinders(storage, 'owner', 'owner', [TRADES]);
  assert.deepEqual([...offlineAvailableBinderIds(storage, 'owner', 'owner', BINDERS)], [TRADES]);
  assert.deepEqual([...offlineAvailableBinderIds(storage, 'stranger', 'owner', BINDERS)], []);
});

test('offline the requested binder opens if saved, else the last opened saved one, else the default', () => {
  const available = new Set([MAIN, TRADES]);
  assert.equal(pickOfflineBinder(BINDERS, available, TRADES, null).binder?.id, TRADES);
  const spare = pickOfflineBinder(BINDERS, available, SPARE, TRADES);
  assert.equal(spare.binder?.id, TRADES);
  assert.equal(spare.unavailable?.name, 'Spare');
  assert.equal(pickOfflineBinder(BINDERS, available, null, SPARE).binder?.id, MAIN);
});

test('the offline shell opens a saved binder with the remembered list', () => {
  const storage = memoryStorage({
    [DEVICE_BINDERS_KEY]: {
      userId: 'owner',
      ownerUserId: 'owner',
      binders: BINDERS,
      savedBinderIds: [MAIN, TRADES],
      savedAt: 'x',
    },
  });
  const trades = readOfflineBinderBoot(storage, '', 'owner', 'owner', TRADES, null);
  assert.equal(trades.binderId, TRADES);
  assert.deepEqual(trades.collection, []);
  assert.equal(trades.binders.length, 3);

  const fallback = readOfflineBinderBoot(storage, '', 'owner', 'owner', SPARE, null);
  assert.equal(fallback.binderId, MAIN);
  assert.equal(fallback.unavailableBinderName, 'Spare');

  // Another account on a shared device doesn't get this owner's list.
  const other = readOfflineBinderBoot(storage, '', 'stranger', 'stranger', TRADES, null);
  assert.equal(other.binderId, null);
  assert.deepEqual(other.binders, []);
});

test("offline boot keeps each binder's own custom layout and queued device dimensions", () => {
  const storage = memoryStorage({
    [`pokemon_binder_settings:owner:binder:${TRADES}`]: { binderRows: 8, binderCols: 7 },
  });
  rememberDeviceBinders(
    storage,
    'owner',
    'owner',
    BINDERS.map((binder) => ({ ...binder, rows: 2, cols: 2 })),
  );
  rememberSavedBinders(storage, 'owner', 'owner', [MAIN, TRADES]);
  assert.equal(readOfflineBinderBoot(storage, '', 'owner', 'owner', MAIN, null).settings.binderRows, 2);
  assert.equal(readOfflineBinderBoot(storage, '', 'owner', 'owner', TRADES, null).settings.binderRows, 8);
  assert.equal(readOfflineBinderBoot(storage, '', 'owner', 'owner', TRADES, null).settings.binderCols, 7);
});

test('the saved set follows the latest saved snapshot, before or after the binder list arrives', () => {
  const storage = memoryStorage();
  // The snapshot can be saved before BinderApp remembers the list.
  rememberSavedBinders(storage, 'owner', 'owner', [MAIN, TRADES]);
  rememberDeviceBinders(storage, 'owner', 'owner', BINDERS);
  assert.deepEqual([...offlineAvailableBinderIds(storage, 'owner', 'owner', BINDERS)], [MAIN, TRADES]);
  // A later snapshot without Trades replaces the set.
  rememberSavedBinders(storage, 'owner', 'owner', [MAIN]);
  assert.deepEqual([...offlineAvailableBinderIds(storage, 'owner', 'owner', BINDERS)], [MAIN]);
  assert.equal(readDeviceBinders(storage, 'owner', 'owner')!.binders.length, 3);
});

test('a binder link by slug opens offline', () => {
  const storage = memoryStorage();
  rememberDeviceBinders(
    storage,
    'owner',
    'owner',
    BINDERS.map((item) => ({ ...item, slug: item.name.toLowerCase().replace(/\s+/g, '-') })),
  );
  rememberSavedBinders(storage, 'owner', 'owner', [MAIN, TRADES]);
  assert.equal(readOfflineBinderBoot(storage, '', 'owner', 'owner', 'trades', null).binderId, TRADES);
});

const PARTNER_ACCESS = {
  holofolder_billing_v1: {
    accountId: 'partner',
    access: { ownerUserId: 'owner', source: 'perpetual', enforced: true },
  },
};
const partnerMarker = { userId: 'partner', ownerUserId: 'owner', binderId: null, binders: [], native: undefined };

test("a partner's saved binders open offline under the owner's collection", () => {
  const storage = memoryStorage({ ...PARTNER_ACCESS, [BINDER_START_MARKER_KEY]: partnerMarker });
  rememberDeviceBinders(storage, 'partner', 'owner', BINDERS);
  rememberSavedBinders(storage, 'partner', 'owner', [MAIN, TRADES]);
  const owner = savedCollectionOwner(storage, 'partner');
  assert.equal(owner, 'owner');
  const trades = readOfflineBinderBoot(storage, '', 'partner', owner, TRADES, null);
  assert.equal(trades.binderId, TRADES);
  assert.equal(trades.collectionOwnerUserId, 'owner');
  assert.equal(trades.binders.length, 3);
  const spare = readOfflineBinderBoot(storage, '', 'partner', owner, SPARE, TRADES);
  assert.equal(spare.binderId, TRADES);
  assert.equal(spare.unavailableBinderName, 'Spare');
  assert.deepEqual([...offlineAvailableBinderIds(storage, 'partner', 'owner', BINDERS)], [MAIN, TRADES]);
});

test("after sign-out or an account switch, nothing of the old account's binders opens", () => {
  const storage = memoryStorage({ ...PARTNER_ACCESS, [BINDER_START_MARKER_KEY]: partnerMarker });
  rememberDeviceBinders(storage, 'partner', 'owner', BINDERS);
  rememberSavedBinders(storage, 'partner', 'owner', [MAIN, TRADES]);
  // Signed out: no account, no owner, no binders.
  const signedOut = readOfflineBinderBoot(storage, '', null, null, TRADES, null);
  assert.deepEqual([signedOut.binders, signedOut.binderId, signedOut.collectionOwnerUserId], [[], null, null]);
  // The owner signing in on this device doesn't get the partner's list, and a stranger gets nothing either.
  for (const account of ['owner', 'stranger']) {
    const owner = savedCollectionOwner(storage, account);
    assert.equal(owner, account);
    const boot = readOfflineBinderBoot(storage, '', account, owner, TRADES, null);
    assert.deepEqual([boot.binders, boot.binderId, boot.collectionOwnerUserId], [[], null, account]);
    // Even naming the owner directly: the list belongs to the account that saved it.
    assert.equal(readDeviceBinders(storage, account, 'owner'), null);
  }
});

test("a partner without cached partner access opens their own collection offline, not the owner's", () => {
  const storage = memoryStorage({ [BINDER_START_MARKER_KEY]: partnerMarker });
  rememberDeviceBinders(storage, 'partner', 'owner', BINDERS);
  assert.equal(savedCollectionOwner(storage, 'partner'), 'partner');
  storage.setItem(
    'holofolder_billing_v1',
    JSON.stringify({ accountId: 'partner', access: { ownerUserId: 'owner', source: 'free', enforced: true } }),
  );
  assert.equal(savedCollectionOwner(storage, 'partner'), 'partner');
  assert.deepEqual(readOfflineBinderBoot(storage, '', 'partner', 'partner', TRADES, null).binders, []);
});

test('a list saved before it named the account is dropped', () => {
  const storage = memoryStorage({
    [DEVICE_BINDERS_KEY]: { ownerUserId: 'owner', binders: BINDERS, savedBinderIds: [MAIN], savedAt: 'x' },
  });
  assert.equal(readDeviceBinders(storage, 'owner', 'owner'), null);
});
