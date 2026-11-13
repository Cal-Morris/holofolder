import test from 'node:test';
import assert from 'node:assert/strict';
import { formatOwnedIn } from '../lib/binders/all-binders';

test('owned-in hints read naturally for one, two and many binders', () => {
  const binders = [
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
    { id: 'c', name: 'C' },
  ];
  assert.equal(formatOwnedIn([]), null);
  assert.equal(formatOwnedIn(binders.slice(0, 1)), 'Owned in A');
  assert.equal(formatOwnedIn(binders.slice(0, 2)), 'Owned in A and B');
  assert.equal(formatOwnedIn(binders, 'In'), 'In A +2');
});
