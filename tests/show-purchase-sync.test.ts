import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fromShowPurchaseRow,
  pullShowPurchases,
  showSyncWindowStart,
  type ShowPurchaseRemote,
  type ShowPurchaseRow,
  type ShowPurchaseStore,
} from '../lib/show-purchase-sync';
import {
  SHOW_SESSION_MAX_AGE_MS,
  clearedShowSession,
  emptyShowSession,
  parseShowSession,
  type ShowPurchase,
  type ShowSession,
} from '../lib/show-session';

const OWNER = '00000000-0000-4000-8000-00000000000a';
const NOW = Date.parse('2026-10-24T12:00:00Z');
const row = (id: string, minutesAgo: number, price = 5): ShowPurchaseRow => ({
  owner_user_id: OWNER,
  client_id: id,
  card_id: 'sv03.5-006',
  card_name: 'Charizard ex',
  language: 'en',
  finish: 'holo',
  price,
  market_price: 10,
  currency: 'GBP',
  bought_at: new Date(NOW - minutesAgo * 60_000).toISOString(),
  bundle_id: null,
});

/** Synthetic account rows, as the developer API wrote them. */
class FakeAccount implements ShowPurchaseRemote {
  constructor(public rows: ShowPurchaseRow[] = []) {}
  async listSince(sinceIso: string) {
    return this.rows.filter((entry) => entry.bought_at >= sinceIso);
  }
}

class MemoryStore implements ShowPurchaseStore {
  constructor(public session: ShowSession = emptyShowSession(NOW)) {}
  readSession(now: number) {
    return parseShowSession(JSON.stringify(this.session), now);
  }
  writeSession(session: ShowSession) {
    this.session = session;
  }
}

const ids = (store: MemoryStore) => store.session.purchases.map((entry) => entry.id);

test('account rows parse defensively', () => {
  const entry = { ...row('a', 3), bundle_id: 'bundle-1' };
  const parsed: ShowPurchase | null = fromShowPurchaseRow({ ...entry, price: '5.00', market_price: '10' });
  assert.equal(parsed?.id, 'a');
  assert.equal(parsed?.price, 5);
  assert.equal(parsed?.bundleId, 'bundle-1');
  assert.equal(fromShowPurchaseRow({ ...entry, price: -1 }), null);
  assert.equal(fromShowPurchaseRow({ ...entry, bought_at: 'not a date' }), null);
});

test("the tally mirrors the account's purchases for this show, removals included", async () => {
  const account = new FakeAccount([row('b', 10), row('a', 30)]);
  const phone = new MemoryStore();
  assert.deepEqual(await pullShowPurchases({ remote: account, store: phone, now: NOW }), { pulled: 2, changed: true });
  assert.deepEqual(ids(phone), ['a', 'b']);
  assert.equal(phone.session.startedAt, NOW - 30 * 60_000, 'the show started with the first purchase');

  assert.equal((await pullShowPurchases({ remote: account, store: phone, now: NOW })).changed, false);

  account.rows = account.rows.filter((entry) => entry.client_id !== 'b');
  await pullShowPurchases({ remote: account, store: phone, now: NOW });
  assert.deepEqual(ids(phone), ['a']);
});

test('a failed pull leaves the tally as it is', async () => {
  const phone = new MemoryStore();
  await pullShowPurchases({ remote: new FakeAccount([row('a', 5)]), store: phone, now: NOW });
  const failing: ShowPurchaseRemote = {
    listSince: async () => {
      throw new Error('offline');
    },
  };
  await assert.rejects(pullShowPurchases({ remote: failing, store: phone, now: NOW }));
  assert.deepEqual(ids(phone), ['a']);
});

test('old shows and cleared tallies stay out', async () => {
  const account = new FakeAccount([row('last-show', 60 * 24), row('today', 60)]);
  const fresh = new MemoryStore();
  await pullShowPurchases({ remote: account, store: fresh, now: NOW });
  assert.deepEqual(ids(fresh), ['today']);

  const cleared = new MemoryStore(clearedShowSession(NOW - 30 * 60_000));
  await pullShowPurchases({ remote: account, store: cleared, now: NOW });
  assert.deepEqual(cleared.session.purchases, []);
  assert.equal(showSyncWindowStart(cleared.session, NOW), NOW - 30 * 60_000);

  // A session that ran out is treated as cleared when it expired.
  const expired = parseShowSession(
    JSON.stringify({ startedAt: NOW - SHOW_SESSION_MAX_AGE_MS - 1000, purchases: [] }),
    NOW,
  );
  assert.equal(expired.clearedAt, NOW - 1000);
});
