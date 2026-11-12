import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { applyPocketMoves, invertPocketMoves, planPocketDrop } from '../lib/pocket-drop';

// Synthetic pockets: upper case holds a card, lower case is empty.
const binder = (layout: string) => [...layout].map((id) => ({ id, filled: id === id.toUpperCase() }));
const drop = (layout: string, from: string, to: string, mode: 'place' | 'push') => {
  const plan = planPocketDrop(binder(layout), from, to, mode);
  assert.ok(plan);
  const ids = plan.moves.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length, 'a pocket is touched once per request');
  let order = [...layout];
  if (plan.create) order.splice(order.indexOf(plan.create.before), 0, '+');
  order = applyPocketMoves(order, plan.moves);
  return { order: order.join(''), plan };
};

describe('planPocketDrop', () => {
  test('a quick drop swaps the two pockets, and never pulls the target back into the old one otherwise', () => {
    assert.equal(drop('ABCDE', 'D', 'E', 'place').order, 'ABCED');
    assert.equal(drop('ABCDE', 'A', 'D', 'place').order, 'DBCAE');
    assert.equal(drop('ABCDE', 'D', 'A', 'place').order, 'DBCAE');
    assert.equal(drop('ABCDE', 'B', 'E', 'place').order, 'AECDB');
    assert.equal(drop('ABCDE', 'A', 'E', 'place').plan.moves.length, 2);
    assert.equal(drop('ABCDE', 'A', 'B', 'place').plan.moves.length, 1);
  });

  test('onto an empty pocket the card just goes there, held or not', () => {
    assert.equal(drop('ABcDE', 'A', 'c', 'place').order, 'cBADE');
    assert.equal(drop('ABcDE', 'A', 'c', 'push').order, 'cBADE');
  });

  test('held, it pushes the target and the cards after it on into the next empty pocket', () => {
    assert.equal(drop('ABCDeF', 'A', 'C', 'push').order, 'eBACDF');
    assert.equal(drop('ABCDeF', 'B', 'C', 'push').order, 'AeBCDF');
    // Backwards, the pocket it leaves is the nearest empty one.
    assert.equal(drop('ABCDE', 'D', 'B', 'push').order, 'ADBCE');
    // Backwards with an empty pocket in between: only the cards up to it move.
    assert.equal(drop('AbCDE', 'E', 'A', 'push').order, 'EACDb');
  });

  test('with no empty pocket ahead, a new one is left where the card came from', () => {
    const { order, plan } = drop('ABCD', 'A', 'C', 'push');
    assert.deepEqual(plan.create, { before: 'A' });
    assert.equal(order, '+BACD');
  });

  test('nothing to do for the same pocket or an unknown one', () => {
    assert.equal(planPocketDrop(binder('AB'), 'A', 'A', 'place'), null);
    assert.equal(planPocketDrop(binder('AB'), 'A', 'Z', 'place'), null);
  });
});

describe('invertPocketMoves', () => {
  test('undo puts every pocket back, touching each once', () => {
    for (const [layout, from, to, mode] of [
      ['ABCDE', 'A', 'D', 'place'],
      ['ABCDE', 'E', 'B', 'place'],
      ['ABCDeF', 'A', 'C', 'push'],
      ['AbCDE', 'E', 'A', 'push'],
      ['ABCDE', 'D', 'B', 'push'],
    ] as const) {
      const order = [...layout];
      const { moves } = planPocketDrop(binder(layout), from, to, mode)!;
      const back = invertPocketMoves(order, moves);
      assert.equal(applyPocketMoves(applyPocketMoves(order, moves), back).join(''), layout);
      assert.equal(new Set(back.map((m) => m.id)).size, back.length);
    }
  });
});
