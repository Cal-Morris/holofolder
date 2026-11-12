import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SHOW_SESSION_MAX_AGE_MS,
  emptyShowSession,
  parseShowSession,
  summarizeShowSession,
  type ShowPurchase,
} from '@/lib/show-session';

const purchase = (id: string, price: number, marketPrice: number | null, currency = 'GBP'): ShowPurchase => ({
  id,
  cardId: `c-${id}`,
  cardName: `Card ${id}`,
  language: 'en',
  finish: 'normal',
  price,
  marketPrice,
  currency,
  at: 1,
});

describe('show session tally', () => {
  test('totals purchases in the display currency', () => {
    const session = {
      startedAt: 1,
      purchases: [purchase('a', 6, 10), purchase('b', 4, null), purchase('c', 9, 8, 'EUR')],
    };
    assert.deepEqual(summarizeShowSession(session, 'GBP'), {
      count: 2,
      spent: 10,
      marketValue: 10,
      saved: 4,
      currency: 'GBP',
    });
  });

  test('parses defensively and starts a new session after a day', () => {
    assert.deepEqual(parseShowSession('nope', 5), emptyShowSession(5));
    const raw = JSON.stringify({ startedAt: 100, purchases: [purchase('a', 6, 10), { id: 3 }] });
    assert.equal(parseShowSession(raw, 200).purchases.length, 1);
    assert.equal(parseShowSession(raw, 100 + SHOW_SESSION_MAX_AGE_MS + 1).purchases.length, 0);
  });
});
