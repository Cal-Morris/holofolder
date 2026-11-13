import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHECKING_PICTURE_PREP,
  picturePrepAction,
  picturePrepTransition,
  pictureWorkerTransition,
  type PicturePrepEvent,
  type PicturePrepState,
  type PictureWorkerLifecycle,
} from '@/lib/picture-scanner-state';

type Fake = { name: string };
const worker: Fake = { name: 'synthetic worker' };
const stopped: PictureWorkerLifecycle<Fake> = { kind: 'stopped', generation: 0 };
const w = pictureWorkerTransition<Fake>;

describe('picture worker lifecycle', () => {
  test('starts, becomes ready, stops', () => {
    const starting = w(stopped, { type: 'start' });
    assert.deepEqual(starting, { kind: 'starting', generation: 1 });
    const ready = w(starting, { type: 'started', generation: 1, worker });
    assert.deepEqual(ready, { kind: 'ready', generation: 1, worker });
    assert.deepEqual(w(ready, { type: 'stop' }), { kind: 'stopped', generation: 1 });
  });

  test('not downloaded (or failed to load) stays unavailable until a stop, so scans do not retry the load', () => {
    const unavailable = w(w(stopped, { type: 'start' }), { type: 'failed', generation: 1 });
    assert.deepEqual(unavailable, { kind: 'unavailable', generation: 1 });
    assert.equal(w(unavailable, { type: 'start' }), unavailable);
    const reset = w(unavailable, { type: 'stop' });
    assert.deepEqual(w(reset, { type: 'start' }), { kind: 'starting', generation: 2 });
  });

  test('a start that finishes after a stop is stale and turned away (download replaced the files mid-start)', () => {
    const first = w(stopped, { type: 'start' });
    const restarted = w(w(first, { type: 'stop' }), { type: 'start' });
    assert.deepEqual(restarted, { kind: 'starting', generation: 2 });
    assert.equal(w(restarted, { type: 'started', generation: 1, worker }), restarted);
    assert.equal(w(restarted, { type: 'failed', generation: 1 }), restarted);
    const stoppedMidStart = w(first, { type: 'stop' });
    assert.equal(w(stoppedMidStart, { type: 'started', generation: 1, worker }), stoppedMidStart);
    assert.equal(w(stoppedMidStart, { type: 'failed', generation: 1 }), stoppedMidStart);
  });

  test('rejects events that do not apply', () => {
    assert.equal(w(stopped, { type: 'stop' }), stopped);
    assert.equal(w(stopped, { type: 'started', generation: 0, worker }), stopped);
    const ready = w(w(stopped, { type: 'start' }), { type: 'started', generation: 1, worker });
    assert.equal(w(ready, { type: 'start' }), ready);
    assert.equal(w(ready, { type: 'failed', generation: 1 }), ready, 'a crash after ready is a stop');
    assert.equal(w(ready, { type: 'started', generation: 1, worker: { name: 'other' } }), ready);
  });
});

const status = (ready: boolean, bytes = 40_000_000) => ({ ready, languages: ready ? ['en'] : [], bytes });
const p = picturePrepTransition;
const run = (events: PicturePrepEvent[], from: PicturePrepState = CHECKING_PICTURE_PREP) => events.reduce(p, from);
const off = run([{ type: 'status', status: status(false) }]);
const on = run([{ type: 'status', status: status(true, 30_000_000) }]);

describe('picture scanner switch', () => {
  test('checks the device, then shows on or off', () => {
    assert.deepEqual(off, { kind: 'off', bytes: 40_000_000, message: null });
    assert.deepEqual(on, { kind: 'on', bytes: 30_000_000, message: null });
    assert.deepEqual(p(CHECKING_PICTURE_PREP, { type: 'status-failed' }), { kind: 'unsupported' });
  });

  test('download: progress, end, fresh check', () => {
    const downloading = run([{ type: 'download' }, { type: 'progress', loaded: 10, total: 100 }], off);
    assert.deepEqual(downloading, { kind: 'downloading', bytes: 40_000_000, loaded: 10, total: 100 });
    const checking = p(downloading, { type: 'download-ended' });
    assert.equal(checking, CHECKING_PICTURE_PREP);
    assert.deepEqual(p(checking, { type: 'status', status: status(true) }).kind, 'on');
  });

  test('a failed download says so and ends off', () => {
    const failed = run(
      [
        { type: 'download' },
        { type: 'download-ended' },
        { type: 'download-failed', message: 'The scanner index isn’t available (503).' },
        { type: 'status', status: status(false) },
      ],
      off,
    );
    assert.deepEqual(failed, { kind: 'off', bytes: 40_000_000, message: 'The scanner index isn’t available (503).' });
    // Even if the fresh status lands first.
    const late = run(
      [
        { type: 'download' },
        { type: 'download-ended' },
        { type: 'status', status: status(false) },
        { type: 'download-failed', message: 'x' },
      ],
      off,
    );
    assert.deepEqual(late, { kind: 'off', bytes: 40_000_000, message: 'x' });
    assert.equal(run([{ type: 'download' }], failed).kind, 'downloading');
  });

  test('a download the scanner started by itself shows as downloading and blocks the switch', () => {
    const background = p(off, { type: 'progress', loaded: 1, total: 2 });
    assert.equal(background.kind, 'downloading');
    assert.equal(picturePrepAction(background, true), null);
    // Opened mid-download, before the device was checked.
    const opened = p(CHECKING_PICTURE_PREP, { type: 'progress', loaded: 1, total: 2 });
    assert.deepEqual(opened, { kind: 'downloading', bytes: null, loaded: 1, total: 2 });
    assert.equal(p(opened, { type: 'status', status: status(false) }), opened, 'status waits for the end');
  });

  test('remove, and a failed removal', () => {
    const removing = p(on, { type: 'remove' });
    assert.deepEqual(removing, { kind: 'removing', bytes: 30_000_000 });
    assert.equal(p(removing, { type: 'removed' }), CHECKING_PICTURE_PREP);
    const failed = run(
      [
        { type: 'remove-failed', message: 'Try again.' },
        { type: 'status', status: status(true) },
      ],
      removing,
    );
    assert.deepEqual(failed, { kind: 'on', bytes: 40_000_000, message: 'Try again.' });
  });

  test('double taps and taps mid-change are turned away', () => {
    const downloading = p(off, { type: 'download' });
    assert.equal(p(downloading, { type: 'download' }), downloading);
    assert.equal(p(downloading, { type: 'remove' }), downloading);
    const removing = p(on, { type: 'remove' });
    assert.equal(p(removing, { type: 'remove' }), removing);
    assert.equal(p(removing, { type: 'download' }), removing);
    assert.equal(p(removing, { type: 'progress', loaded: 1, total: 2 }), removing);
    assert.equal(p(on, { type: 'download' }), on);
    assert.equal(p(off, { type: 'remove' }), off);
    assert.equal(p(off, { type: 'download-ended' }), off);
    assert.equal(p(off, { type: 'removed' }), off);
    const unsupported = p(CHECKING_PICTURE_PREP, { type: 'status-failed' });
    for (const event of [{ type: 'download' }, { type: 'status', status: status(true) }] as PicturePrepEvent[])
      assert.equal(p(unsupported, event), unsupported);
  });

  test('which way the switch can flip', () => {
    assert.equal(picturePrepAction(off, true), 'download');
    assert.equal(picturePrepAction(off, false), null, 'downloading needs a connection');
    assert.equal(picturePrepAction(on, false), 'remove');
    assert.equal(picturePrepAction(CHECKING_PICTURE_PREP, true), null);
  });
});
