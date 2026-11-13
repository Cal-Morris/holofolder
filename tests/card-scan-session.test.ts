import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  IDLE_CARD_SCAN,
  cardScanStatus,
  cardScanTransition,
  pictureScanResult,
  type CardScanEvent,
  type CardScanSession,
} from '@/lib/card-scan-session';
import type { ScannedCardRead } from '@/lib/card-scan-identify';
import type { SearchCardResult } from '@/lib/pokemon-card-browse';

const run = (events: CardScanEvent[], from: CardScanSession = IDLE_CARD_SCAN) =>
  events.reduce(cardScanTransition, from);

// Synthetic cards for the tests.
const card = (id: string): SearchCardResult =>
  ({
    id,
    name: `Synthetic ${id}`,
    localId: '1',
    set: { id: 'syn', name: 'Synthetic' },
    dexIds: [25],
  }) as SearchCardResult;
const read: ScannedCardRead = { pokemon: { id: 25, name: 'Pikachu' }, number: null, query: 'pikachu', signals: null };
const status = { cameraReady: true, cameraError: null, isOnline: true, pictureReady: true };

describe('card scan session', () => {
  test('reads frames in order, then matches, then goes idle', () => {
    let state = cardScanTransition(IDLE_CARD_SCAN, { type: 'start', frames: 3 });
    assert.deepEqual(state, { kind: 'reading', frame: 1, frames: 3 });
    state = cardScanTransition(state, { type: 'frame', frame: 2 });
    state = cardScanTransition(state, { type: 'frame', frame: 3 });
    assert.deepEqual(state, { kind: 'reading', frame: 3, frames: 3 });
    state = cardScanTransition(state, { type: 'match' });
    assert.deepEqual(state, { kind: 'matching' });
    assert.equal(cardScanTransition(state, { type: 'done' }), IDLE_CARD_SCAN);
  });

  test('a read that fails mid-frame still goes idle', () => {
    assert.equal(run([{ type: 'start', frames: 3 }, { type: 'done' }]), IDLE_CARD_SCAN);
  });

  test('a second start while reading or matching is turned away (double tap, photo mid-read)', () => {
    const reading = run([{ type: 'start', frames: 3 }]);
    assert.equal(cardScanTransition(reading, { type: 'start', frames: 1 }), reading);
    const matching = run([{ type: 'match' }], reading);
    assert.equal(cardScanTransition(matching, { type: 'start', frames: 3 }), matching);
  });

  test('rejects events that do not apply', () => {
    assert.equal(cardScanTransition(IDLE_CARD_SCAN, { type: 'frame', frame: 2 }), IDLE_CARD_SCAN);
    assert.equal(cardScanTransition(IDLE_CARD_SCAN, { type: 'match' }), IDLE_CARD_SCAN);
    assert.equal(cardScanTransition(IDLE_CARD_SCAN, { type: 'done' }), IDLE_CARD_SCAN);
    assert.equal(cardScanTransition(IDLE_CARD_SCAN, { type: 'start', frames: 0 }), IDLE_CARD_SCAN);
    const reading = run([
      { type: 'start', frames: 3 },
      { type: 'frame', frame: 2 },
    ]);
    assert.equal(cardScanTransition(reading, { type: 'frame', frame: 2 }), reading, 'no going back');
    assert.equal(cardScanTransition(reading, { type: 'frame', frame: 4 }), reading, 'no frame past the count');
    assert.equal(
      cardScanTransition(reading, { type: 'refused', problem: 'x' }),
      reading,
      'refused only as a read begins',
    );
    const matching = run([{ type: 'match' }], reading);
    assert.equal(cardScanTransition(matching, { type: 'frame', frame: 3 }), matching);
    assert.equal(cardScanTransition(matching, { type: 'match' }), matching);
  });

  test('a refused destination shows its problem until the next read starts', () => {
    const refused = run([
      { type: 'start', frames: 3 },
      { type: 'refused', problem: 'Destination changed.' },
    ]);
    assert.deepEqual(refused, { kind: 'idle', problem: 'Destination changed.' });
    assert.equal(cardScanStatus(refused, { ...status, cameraError: 'No camera.' }), 'Destination changed.');
    assert.deepEqual(cardScanTransition(refused, { type: 'start', frames: 1 }), {
      kind: 'reading',
      frame: 1,
      frames: 1,
    });
    assert.deepEqual(cardScanTransition(IDLE_CARD_SCAN, { type: 'refused', problem: 'p' }), {
      kind: 'idle',
      problem: 'p',
    });
  });

  test('status line', () => {
    assert.equal(cardScanStatus(run([{ type: 'start', frames: 1 }]), status), 'Reading the card… 1/1');
    // A chosen photo with the camera blocked still shows its progress, not the camera problem.
    assert.equal(
      cardScanStatus(run([{ type: 'start', frames: 1 }]), { ...status, cameraError: 'No camera.' }),
      'Reading the card… 1/1',
    );
    assert.equal(cardScanStatus({ kind: 'matching' }, { ...status, isOnline: false }), 'Looking it up on this device…');
    assert.equal(
      cardScanStatus(IDLE_CARD_SCAN, { ...status, cameraError: 'No camera.' }),
      'No camera. Choose a photo of the card instead.',
    );
    assert.equal(cardScanStatus(IDLE_CARD_SCAN, { ...status, cameraReady: false }), '');
    assert.equal(cardScanStatus(IDLE_CARD_SCAN, status), 'Hold steady, then tap Read card.');
    assert.equal(
      cardScanStatus(IDLE_CARD_SCAN, { ...status, isOnline: false, pictureReady: false }),
      'Offline: reads the card and looks it up on this device. Picture scanner not downloaded, so only the name and number are read.',
    );
  });
});

describe('picture or text path', () => {
  const flags = { native: true, readerUnavailable: false, offline: false };
  test('a picture match opens as a match, with the card as the only candidate', () => {
    const result = pictureScanResult({ kind: 'match', card: card('a') }, read, flags)!;
    assert.equal(result.outcome.kind, 'match');
    assert.deepEqual(
      result.candidates?.map((c) => c.id),
      ['a'],
    );
    assert.equal(result.suggested, undefined);
  });
  test('a suggestion is pre-selected ahead of its alternatives in the native review only', () => {
    const decision = { kind: 'suggest' as const, card: card('a'), candidates: [card('a'), card('b')] };
    const native = pictureScanResult(decision, read, flags)!;
    assert.equal(native.suggested, true);
    assert.deepEqual(
      native.candidates?.map((c) => c.id),
      ['a', 'b'],
    );
    const legacy = pictureScanResult(decision, read, { ...flags, native: false })!;
    assert.equal(legacy.candidates, undefined);
    assert.equal(legacy.suggested, undefined);
  });
  test('picture choices are offered under the read name; nothing to offer falls back to the text search', () => {
    const choices = pictureScanResult({ kind: 'choose', candidates: [card('a'), card('b')] }, read, flags)!;
    assert.deepEqual(choices.outcome, { kind: 'choose', query: 'Pikachu' });
    assert.deepEqual(
      choices.pictureChoices?.map((c) => c.id),
      ['a', 'b'],
    );
    const unread = pictureScanResult(
      { kind: 'choose', candidates: [card('a'), card('b')] },
      { ...read, pokemon: null, query: '' },
      flags,
    )!;
    assert.deepEqual(unread.outcome, { kind: 'unread', query: '' });
    assert.equal(pictureScanResult({ kind: 'choose', candidates: [] }, read, flags), null);
  });
});
