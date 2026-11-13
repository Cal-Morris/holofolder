import test from 'node:test';
import assert from 'node:assert/strict';
import type { Binder } from '../lib/binders/model';
import {
  collectionRecordKey,
  DEVICE_BINDERS_KEY,
  markBinderSavedOnDevice,
  offlineAvailableBinderIds,
  pickOfflineBinder,
  readDeviceBinders,
  rememberDeviceBinders,
} from '../lib/binders/offline';
import { readOfflineBinderBoot } from '../lib/offline-shell';

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

test('the default binder keeps the original IndexedDB key; other binders get their own', () => {
  assert.equal(collectionRecordKey(MAIN, true), 'collection');
  assert.equal(collectionRecordKey(TRADES, false), `collection:${TRADES}`);
});

test('the binder list is remembered per owner, and saved binders are tracked', () => {
  const storage = memoryStorage();
  rememberDeviceBinders(storage, 'owner', BINDERS);
  markBinderSavedOnDevice(storage, 'owner', TRADES);
  markBinderSavedOnDevice(storage, 'owner', TRADES);
  const device = readDeviceBinders(storage, 'owner')!;
  assert.deepEqual(
    device.binders.map((item) => item.name),
    ['My binder', 'Trades', 'Spare'],
  );
  assert.deepEqual(device.savedBinderIds, [TRADES]);
  assert.equal(readDeviceBinders(storage, 'someone-else'), null);

  // A deleted binder's saved flag goes with it.
  rememberDeviceBinders(
    storage,
    'owner',
    BINDERS.filter((item) => item.id !== TRADES),
  );
  assert.deepEqual(readDeviceBinders(storage, 'owner')!.savedBinderIds, []);
});

test('a binder opens offline only when this device has a copy of it', () => {
  const storage = memoryStorage();
  rememberDeviceBinders(storage, 'owner', BINDERS);
  markBinderSavedOnDevice(storage, 'owner', TRADES);
  assert.deepEqual([...offlineAvailableBinderIds(storage, 'owner', BINDERS)], [TRADES]);
  assert.deepEqual([...offlineAvailableBinderIds(storage, 'stranger', BINDERS)], []);
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
    [DEVICE_BINDERS_KEY]: { ownerUserId: 'owner', binders: BINDERS, savedBinderIds: [MAIN, TRADES], savedAt: 'x' },
  });
  const trades = readOfflineBinderBoot(storage, '', 'owner', TRADES, null);
  assert.equal(trades.binderId, TRADES);
  assert.deepEqual(trades.collection, []);
  assert.equal(trades.binders.length, 3);

  const fallback = readOfflineBinderBoot(storage, '', 'owner', SPARE, null);
  assert.equal(fallback.binderId, MAIN);
  assert.equal(fallback.unavailableBinderName, 'Spare');

  // Another account on a shared device doesn't get this owner's list.
  const other = readOfflineBinderBoot(storage, '', 'stranger', TRADES, null);
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
    BINDERS.map((binder) => ({ ...binder, rows: 2, cols: 2 })),
  );
  markBinderSavedOnDevice(storage, 'owner', MAIN);
  markBinderSavedOnDevice(storage, 'owner', TRADES);
  assert.equal(readOfflineBinderBoot(storage, '', 'owner', MAIN, null).settings.binderRows, 2);
  assert.equal(readOfflineBinderBoot(storage, '', 'owner', TRADES, null).settings.binderRows, 8);
  assert.equal(readOfflineBinderBoot(storage, '', 'owner', TRADES, null).settings.binderCols, 7);
});
