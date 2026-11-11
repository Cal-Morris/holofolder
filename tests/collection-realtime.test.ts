import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COLLECTION_CHANGED_EVENT,
  createCollectionChangedPayload,
  getCollectionRealtimeTopic,
} from '../lib/collection-realtime';

test('getCollectionRealtimeTopic scopes collection invalidations to an owner', () => {
  assert.equal(
    getCollectionRealtimeTopic(' 550e8400-e29b-41d4-a716-446655440000 '),
    'collection:550e8400-e29b-41d4-a716-446655440000',
  );
});

test('getCollectionRealtimeTopic rejects blank owners', () => {
  assert.throws(() => getCollectionRealtimeTopic(' '), /Collection owner user id is required/);
});

test('createCollectionChangedPayload creates an invalidation-only payload', () => {
  assert.deepEqual(createCollectionChangedPayload('2026-06-28T12:00:00.000Z'), {
    changedAt: '2026-06-28T12:00:00.000Z',
  });
  assert.equal(COLLECTION_CHANGED_EVENT, 'collection_changed');
});
