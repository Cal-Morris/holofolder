import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { IDLE_QUEUE_DISCARD, queueDiscardTransition, queueHeadNotice } from '@/lib/collection/queue-head-notice';
import type { PendingSlotIntent } from '@/lib/collection/slot-offline-queue';

type Held = Parameters<typeof queueHeadNotice>[0] & object;
// Synthetic queue entries: only the fields the notice reads.
const entry = (
  status: PendingSlotIntent['status'],
  reason: string | null = null,
  { rejected = false, kind = 'slots', id = 'op-1' }: { rejected?: boolean; kind?: string; id?: string } = {},
) =>
  ({
    status,
    conflict: reason === null ? null : { reason, current: null, rejected },
    intent: { kind, request: { operationId: id } },
  }) as unknown as Held[number];

describe('offline queue notice', () => {
  test('nothing queued, or a change on its way, needs no line', () => {
    assert.deepEqual(queueHeadNotice(undefined, true), { kind: 'none' });
    assert.deepEqual(queueHeadNotice([], false), { kind: 'none' });
    assert.deepEqual(queueHeadNotice([entry('pending')], true), { kind: 'none' });
    assert.deepEqual(queueHeadNotice([entry('sending')], true), { kind: 'none' });
    assert.deepEqual(queueHeadNotice([entry('acknowledged')], false), { kind: 'none' });
  });

  test('offline and retrying follow the first change that is not yet accepted', () => {
    assert.deepEqual(queueHeadNotice([entry('acknowledged'), entry('pending')], false), { kind: 'offline' });
    assert.deepEqual(queueHeadNotice([entry('unavailable')], true), { kind: 'retrying' });
    assert.deepEqual(queueHeadNotice([entry('unavailable')], false), { kind: 'offline' });
  });

  test('a held head says why', () => {
    assert.deepEqual(queueHeadNotice([entry('conflict', 'stale')], true), { kind: 'on-hold' });
    assert.deepEqual(queueHeadNotice([entry('billing', 'billing-paused')], false), { kind: 'billing' });
    assert.deepEqual(queueHeadNotice([entry('blocked', 'http-401')], true), { kind: 'paused' });
    assert.deepEqual(queueHeadNotice([entry('blocked', 'http-403')], true), { kind: 'paused' });
    assert.deepEqual(queueHeadNotice([entry('blocked', 'http-400'), entry('pending'), entry('pending')], true), {
      kind: 'refused',
      operationId: 'op-1',
      later: 2,
    });
    // Creations and restores keep their own discard paths.
    assert.deepEqual(queueHeadNotice([entry('blocked', 'http-422', { kind: 'creation' })], true), { kind: 'paused' });
  });

  test('a change that needs a decision has its own panel, not a line', () => {
    assert.deepEqual(queueHeadNotice([entry('conflict', 'rejected', { rejected: true })], true), { kind: 'none' });
    assert.deepEqual(queueHeadNotice([entry('pending', 'rejected', { rejected: true })], false), { kind: 'none' });
  });
});

describe('discarding a refused change', () => {
  test('one at a time: a second tap is turned away until the first settles', () => {
    const discarding = queueDiscardTransition(IDLE_QUEUE_DISCARD, { type: 'discard', operationId: 'op-1' });
    assert.deepEqual(discarding, { kind: 'discarding', operationId: 'op-1' });
    assert.equal(queueDiscardTransition(discarding, { type: 'discard', operationId: 'op-1' }), discarding);
    assert.equal(queueDiscardTransition(discarding, { type: 'discard', operationId: 'op-2' }), discarding);
    assert.equal(queueDiscardTransition(discarding, { type: 'settled' }), IDLE_QUEUE_DISCARD);
    assert.equal(queueDiscardTransition(IDLE_QUEUE_DISCARD, { type: 'settled' }), IDLE_QUEUE_DISCARD);
  });
});
