import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyMomentumSort } from '../lib/momentum-sort';
import type { MomentumPriceInput } from '../lib/price-momentum';

const now = Date.parse('2026-11-03T12:00:00Z');
const snapshot = (trend: Record<string, number>): MomentumPriceInput => ({
  confidence: 'high',
  updatedAt: '2026-11-03T11:00:00Z',
  trendPoints: Object.entries(trend).map(([label, gbpAmount]) => ({ label, source: 'cardmarket', gbpAmount })),
});
const rows = [
  { id: 'flat', price: snapshot({ Trend: 10, '7d': 10 }) },
  { id: 'down20', price: snapshot({ Trend: 8, '7d': 10 }) },
  { id: 'unpriced', price: undefined },
  { id: 'up30', price: snapshot({ Trend: 13, '7d': 10 }) },
  { id: 'down40', price: snapshot({ Trend: 6, '30d': 10 }) },
];
const ids = (list: typeof rows) => list.map((row) => row.id);

describe('applyMomentumSort', () => {
  it('default keeps the order (as a new array)', () => {
    const sorted = applyMomentumSort(rows, 'default', (row) => row.price, now);
    assert.notEqual(sorted, rows);
    assert.deepEqual(ids(sorted), ids(rows));
  });

  it('% down: biggest drop first, the rest in their order', () => {
    assert.deepEqual(ids(applyMomentumSort(rows, 'falling', (row) => row.price, now)), [
      'down40',
      'down20',
      'flat',
      'unpriced',
      'up30',
    ]);
  });

  it('% up: biggest rise first, the rest in their order', () => {
    assert.deepEqual(ids(applyMomentumSort(rows, 'rising', (row) => row.price, now)), [
      'up30',
      'flat',
      'down20',
      'unpriced',
      'down40',
    ]);
  });
});
