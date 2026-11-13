import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createScrollFreeze, SCROLL_END_SETTLE_MS, SCROLL_SETTLE_MS } from '../lib/scroll-blur-freeze';

function setup() {
  const events: string[] = [];
  const timers = new Map<number, { callback: () => void; ms: number }>();
  let next = 0;
  const freeze = createScrollFreeze({
    freeze: () => events.push('freeze'),
    unfreeze: () => events.push('unfreeze'),
    setTimer: ((callback: () => void, ms: number) => {
      timers.set(++next, { callback, ms });
      return next;
    }) as never,
    clearTimer: ((id: number) => {
      timers.delete(id);
    }) as never,
  });
  const fire = () => {
    // oxlint-disable-next-line unicorn/no-useless-spread -- snapshot the Map: callbacks schedule new timers that must wait for the next fire().
    for (const [id, timer] of [...timers]) {
      timers.delete(id);
      timer.callback();
    }
  };
  return { freeze, events, timers, fire };
}

describe('createScrollFreeze', () => {
  test('freezes once for a burst of scroll events', () => {
    const { freeze, events, timers } = setup();
    freeze.onScroll();
    freeze.onScroll();
    freeze.onScroll();
    assert.deepEqual(events, ['freeze']);
    assert.equal(freeze.isFrozen(), true);
    // Only the latest settle deadline is pending.
    assert.equal(timers.size, 1);
    assert.equal([...timers.values()][0].ms, SCROLL_SETTLE_MS);
  });
  test('unfreezes after the settle delay', () => {
    const { freeze, events, fire } = setup();
    freeze.onScroll();
    fire();
    assert.deepEqual(events, ['freeze', 'unfreeze']);
    assert.equal(freeze.isFrozen(), false);
  });
  test('scrollend shortens the wait instead of unfreezing on the spot', () => {
    const { freeze, events, timers, fire } = setup();
    freeze.onScroll();
    freeze.onScrollEnd();
    assert.deepEqual(events, ['freeze']);
    assert.equal(timers.size, 1);
    assert.equal([...timers.values()][0].ms, SCROLL_END_SETTLE_MS);
    fire();
    assert.deepEqual(events, ['freeze', 'unfreeze']);
  });
  test('scrolling straight after scrollend stays frozen (programmatic scroll every frame)', () => {
    const { freeze, events, timers } = setup();
    for (let frame = 0; frame < 5; frame++) {
      freeze.onScroll();
      freeze.onScrollEnd();
    }
    freeze.onScroll();
    assert.deepEqual(events, ['freeze']);
    assert.equal([...timers.values()][0].ms, SCROLL_SETTLE_MS);
  });
  test('scrollend without scrolling does nothing', () => {
    const { freeze, events } = setup();
    freeze.onScrollEnd();
    freeze.dispose();
    assert.deepEqual(events, []);
  });
  test('freezes again on the next scroll', () => {
    const { freeze, events, fire } = setup();
    freeze.onScroll();
    fire();
    freeze.onScroll();
    assert.deepEqual(events, ['freeze', 'unfreeze', 'freeze']);
  });
  test('dispose clears a pending freeze', () => {
    const { freeze, events, timers } = setup();
    freeze.onScroll();
    freeze.dispose();
    assert.deepEqual(events, ['freeze', 'unfreeze']);
    assert.equal(timers.size, 0);
  });
});
