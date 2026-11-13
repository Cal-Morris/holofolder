import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AIMING_PAGE_SCAN,
  pageScanStatus,
  pageScanTransition,
  type PageScanEvent,
  type PageScanSession,
} from '@/lib/page-scan-session';

type Review = { cells: number };
const step = pageScanTransition<Review>;
const run = (events: PageScanEvent<Review>[], from: PageScanSession<Review> = AIMING_PAGE_SCAN) =>
  events.reduce(step, from);

describe('page scan session', () => {
  test('capture, find the pockets, read each, then review', () => {
    const reading = run([{ type: 'start' }, { type: 'detected', total: 2 }]);
    assert.deepEqual(reading, { kind: 'reading', done: 0, total: 2 });
    const read = run([{ type: 'pocket-read' }, { type: 'pocket-read' }], reading);
    assert.deepEqual(read, { kind: 'reading', done: 2, total: 2 });
    assert.deepEqual(step(read, { type: 'reviewed', review: { cells: 9 } }), {
      kind: 'review',
      review: { cells: 9 },
    });
  });

  test('a page with nothing new to read goes straight to review', () => {
    const state = run([{ type: 'start' }, { type: 'detected', total: 0 }, { type: 'reviewed', review: { cells: 0 } }]);
    assert.equal(state.kind, 'review');
  });

  test('a second start while capturing or reading is turned away (double tap, photo chosen mid-read)', () => {
    const capturing = run([{ type: 'start' }]);
    assert.equal(step(capturing, { type: 'start' }), capturing);
    const reading = run([{ type: 'detected', total: 3 }], capturing);
    assert.equal(step(reading, { type: 'start' }), reading);
  });

  test('a failure goes back to aiming with the problem, which the next start clears', () => {
    for (const from of [
      AIMING_PAGE_SCAN,
      run([{ type: 'start' }]),
      run([{ type: 'start' }, { type: 'detected', total: 1 }]),
    ] as PageScanSession<Review>[]) {
      const failed = step(from, { type: 'failed', problem: 'Try again.' });
      assert.deepEqual(failed, { kind: 'aiming', problem: 'Try again.' });
      assert.deepEqual(step(failed, { type: 'start' }), { kind: 'capturing' });
    }
  });

  test('rejects events that do not apply', () => {
    assert.equal(step(AIMING_PAGE_SCAN, { type: 'detected', total: 2 }), AIMING_PAGE_SCAN);
    assert.equal(step(AIMING_PAGE_SCAN, { type: 'pocket-read' }), AIMING_PAGE_SCAN);
    assert.equal(step(AIMING_PAGE_SCAN, { type: 'reviewed', review: { cells: 1 } }), AIMING_PAGE_SCAN);
    const capturing = run([{ type: 'start' }]);
    assert.equal(step(capturing, { type: 'pocket-read' }), capturing);
    assert.equal(step(capturing, { type: 'reviewed', review: { cells: 1 } }), capturing);
    const done = run([{ type: 'detected', total: 1 }, { type: 'pocket-read' }], capturing);
    assert.equal(step(done, { type: 'pocket-read' }), done, 'never more read than found');
    assert.equal(step(done, { type: 'detected', total: 4 }), done);
    const review = step(done, { type: 'reviewed', review: { cells: 1 } });
    for (const event of [
      { type: 'start' },
      { type: 'failed', problem: 'late' },
      { type: 'pocket-read' },
      { type: 'reviewed', review: { cells: 2 } },
    ] as PageScanEvent<Review>[])
      assert.equal(step(review, event), review, `${event.type} after review`);
  });

  test('status line', () => {
    assert.equal(pageScanStatus({ kind: 'capturing' }, null), 'Reading the page…');
    assert.equal(pageScanStatus({ kind: 'reading', done: 0, total: 0 }, null), 'Reading the page…');
    assert.equal(pageScanStatus({ kind: 'reading', done: 1, total: 4 }, 'x'), 'Reading cards 1 of 4…');
    assert.equal(pageScanStatus(AIMING_PAGE_SCAN, null), '');
    assert.equal(
      pageScanStatus(AIMING_PAGE_SCAN, 'denied'),
      "The camera isn't available. Choose a photo of the page instead.",
    );
  });
});
