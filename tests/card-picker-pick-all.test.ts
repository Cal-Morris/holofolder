import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { pickAllCards } from '../lib/card-picker-pick-all';

// Synthetic picks: only ids matter.
const pick = (id: string) => ({ card: { id } });
const ids = (picks: { card: { id: string } }[]) => picks.map((p) => p.card.id);

describe('card picker Pick all', () => {
  test('keeps existing picks and adds the shown cards in order, without repeats', () => {
    const result = pickAllCards([pick('b')], ['a', 'b', 'c'].map(pick), 100, () => ({}));
    assert.deepEqual(ids(result.picks), ['b', 'a', 'c']);
    assert.equal(result.left, 0);
  });

  test('stops at the per-save limit and says how many were left', () => {
    const result = pickAllCards([], ['a', 'b', 'c', 'd'].map(pick), 3, () => ({}));
    assert.deepEqual(ids(result.picks), ['a', 'b', 'c']);
    assert.equal(result.left, 1);
  });

  test('skips cards with nowhere to go when they do not all fit', () => {
    // Synthetic binder: card "x" has no pocket.
    const place = (picks: { card: { id: string } }[]) => (picks.some((p) => p.card.id === 'x') ? null : {});
    const result = pickAllCards([], ['a', 'x', 'b'].map(pick), 100, place);
    assert.deepEqual(ids(result.picks), ['a', 'b']);
    assert.equal(result.left, 1);
  });
});
