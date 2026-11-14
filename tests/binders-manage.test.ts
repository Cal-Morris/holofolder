import test from 'node:test';
import assert from 'node:assert/strict';
import type { Binder } from '../lib/binders/model';
import { canCreateBinder, moveBinder, planBinderDelete, validateBinderOrder } from '../lib/binders/manage';
import { binderHref } from '../lib/binders/client';

const binder = (id: string, sortOrder: number, isDefault = false): Binder => ({
  id,
  ownerUserId: 'owner',
  name: id,
  color: null,
  sortOrder,
  isDefault,
  rows: null,
  cols: null,
  createdAt: null,
  updatedAt: null,
});

test('the last binder can never be deleted; one with cards needs confirmation', () => {
  const one = [binder('a', 0, true)];
  assert.deepEqual(planBinderDelete(one, 'a', 0, true), { ok: false, reason: 'last-binder' });
  const two = [binder('a', 0, true), binder('b', 1)];
  assert.deepEqual(planBinderDelete(two, 'x', 0, true), { ok: false, reason: 'not-found' });
  assert.deepEqual(planBinderDelete(two, 'b', 3, false), { ok: false, reason: 'needs-confirmation' });
  assert.deepEqual(planBinderDelete(two, 'b', 3, true), { ok: true, promoteBinderId: null });
  assert.deepEqual(planBinderDelete(two, 'b', 0, false), { ok: true, promoteBinderId: null });
});

test('deleting the default promotes the first remaining binder', () => {
  const binders = [binder('c', 2), binder('a', 0, true), binder('b', 1)];
  assert.deepEqual(planBinderDelete(binders, 'a', 0, false), { ok: true, promoteBinderId: 'b' });
});

test('order, limits and moves', () => {
  const binders = [binder('a', 0, true), binder('b', 1), binder('c', 5)];
  assert.deepEqual(validateBinderOrder(binders, ['c', 'a', 'b']), ['c', 'a', 'b']);
  assert.equal(validateBinderOrder(binders, ['a', 'a', 'b']), null);
  assert.equal(validateBinderOrder(binders, ['a', 'b']), null);
  assert.equal(validateBinderOrder(binders, 'a,b,c'), null);
  assert.ok(canCreateBinder(binders));
  assert.ok(!canCreateBinder(Array.from({ length: 99 }, (_, index) => binder(String(index), index))));
  assert.deepEqual(
    moveBinder(binders, 'b', -1).map((item) => [item.id, item.sortOrder]),
    [
      ['b', 0],
      ['a', 1],
      ['c', 2],
    ],
  );
  assert.deepEqual(
    moveBinder(binders, 'a', -1).map((item) => item.id),
    ['a', 'b', 'c'],
  );
});

test('binder links keep the current page and its other parameters', () => {
  assert.equal(binderHref('b1'), '/?binder=b1');
  assert.equal(binderHref('b2', 'https://holofolder.com/?binder=b1&x=1'), '/?binder=b2&x=1');
  assert.equal(binderHref('b2', 'http://localhost/e2e-harness?signedIn=1'), '/e2e-harness?signedIn=1&binder=b2');
});

test('binder links give Next router an unprefixed path', () => {
  assert.equal(binderHref('b2', 'https://holofolder.com/app?binder=b1&x=1'), '/?binder=b2&x=1');
});
