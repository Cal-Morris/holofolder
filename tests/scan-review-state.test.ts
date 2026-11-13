import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initialScanReview,
  pocketChoice,
  pocketReviewStatus,
  scanReviewTransition,
  type ReviewCellInput,
  type ScanReviewEvent,
  type ScanReviewState,
} from '@/lib/scan-review-state';
import type { SearchCardResult } from '@/lib/pokemon-card-browse';

// Synthetic cards and pockets for the tests.
const card = (id: string) => ({ id, name: `Synthetic ${id}`, set: { id: 's', name: 'S' } }) as SearchCardResult;
const [a, b, c] = [card('a'), card('b'), card('c')];
const cells: ReviewCellInput[] = [
  { index: 0, occupied: true, candidates: [] }, // unread
  { index: 1, occupied: true, candidates: [a, b] }, // choices
  { index: 2, occupied: true, candidates: [a, b, c], suggested: true }, // pre-selected from photo
  { index: 3, occupied: true, candidates: [a] }, // matched by read
  { index: 4, occupied: false, candidates: [] }, // empty pocket
  { index: 5, occupied: true, candidates: [a], suggested: true }, // a lone photo suggestion
];
const start = initialScanReview(cells);
const step = scanReviewTransition;
const run = (events: ScanReviewEvent[], from: ScanReviewState = start) => events.reduce(step, from);
const status = (state: ScanReviewState, index: number) => pocketReviewStatus(cells[index], state.pockets[index]);

describe('scan review pockets', () => {
  test('start: one clear match or a photo suggestion is chosen, anything less is open', () => {
    assert.deepEqual(
      [0, 1, 2, 3, 5].map((index) => status(start, index)),
      ['unread', 'choices', 'photo', 'read', 'photo'],
    );
    assert.equal(start.pockets[4], undefined, 'empty pockets are not reviewed');
    assert.equal(pocketChoice(start.pockets[2]).card, a);
    assert.deepEqual(start.backToChoices, [2]);
  });

  test('a tapped choice is chosen, with nothing else carried over', () => {
    const state = step(start, { type: 'pick-choice', index: 1, card: b });
    assert.deepEqual(state.pockets[1], { kind: 'chosen', replace: false, card: b });
    assert.equal(status(state, 1), 'changed');
  });

  test('Change card on a photo suggestion goes back to its choices; elsewhere it opens the picker', () => {
    const back = step(start, { type: 'change', index: 2 });
    assert.deepEqual(back.pockets[2], { kind: 'open', replace: false });
    assert.equal(status(back, 2), 'choices');
    assert.equal(back.picking, null);
    for (const index of [3, 5]) {
      const picker = step(start, { type: 'change', index });
      assert.equal(picker.picking, index);
      const picked = step(picker, { type: 'picked', index, card: b, finish: 'holo' });
      assert.deepEqual(picked.pockets[index], { kind: 'chosen', replace: false, card: b, finish: 'holo' });
      assert.equal(picked.picking, null);
      assert.equal(status(picked, index), 'changed');
    }
  });

  test('a new card, or a new version, clears the copy and pocket chosen for the old one', () => {
    const set = run([
      { type: 'finish', index: 3, finish: 'holo' },
      { type: 'copy', index: 3, copy: 'raw' },
      { type: 'destination', index: 3, destination: 'slot:x' },
    ]);
    assert.deepEqual(pocketChoice(set.pockets[3]), {
      card: a,
      finish: 'holo',
      copy: 'raw',
      destination: 'slot:x',
      skip: false,
      replace: false,
    });
    const refinished = step(set, { type: 'finish', index: 3, finish: 'reverse_holo' });
    assert.deepEqual(refinished.pockets[3], { kind: 'chosen', replace: false, card: a, finish: 'reverse_holo' });
    const repicked = run(
      [
        { type: 'change', index: 3 },
        { type: 'picked', index: 3, card: c },
      ],
      set,
    );
    assert.deepEqual(repicked.pockets[3], { kind: 'chosen', replace: false, card: c });
  });

  test('skip remembers the choice; include brings it back', () => {
    const chosen = step(start, { type: 'copy', index: 3, copy: 'raw' });
    const skipped = step(chosen, { type: 'skip', index: 3 });
    assert.equal(status(skipped, 3), 'skipped');
    assert.equal(pocketChoice(skipped.pockets[3]).skip, true);
    assert.deepEqual(step(skipped, { type: 'include', index: 3 }).pockets[3], chosen.pockets[3]);
    const open = step(step(start, { type: 'skip', index: 0 }), { type: 'include', index: 0 });
    assert.deepEqual(open.pockets[0], start.pockets[0]);
  });

  test('replacing the card already in a pocket, and keeping it', () => {
    const differs = step(start, { type: 'replace', index: 3, keepCard: true });
    assert.deepEqual(differs.pockets[3], { kind: 'chosen', replace: true, card: a });
    const same = step(start, { type: 'replace', index: 3, keepCard: false });
    assert.deepEqual(same.pockets[3], { kind: 'open', replace: true });
    assert.equal(pocketChoice(same.pockets[3]).replace, true);
    assert.deepEqual(step(same, { type: 'keep-current', index: 3 }).pockets[3], { kind: 'open', replace: false });
    // A choice made while replacing still replaces.
    const picked = run([{ type: 'pick-choice', index: 3, card: b }], same);
    assert.deepEqual(picked.pockets[3], { kind: 'chosen', replace: true, card: b });
    // Skipping drops the replacement: a skipped pocket never replaces.
    const skipped = step(picked, { type: 'skip', index: 3 });
    assert.equal(pocketChoice(skipped.pockets[3]).replace, false);
  });

  test('rejects events that do not apply to the pocket as it is', () => {
    const skipped = step(start, { type: 'skip', index: 3 });
    const rejected: Array<[ScanReviewState, ScanReviewEvent]> = [
      [start, { type: 'pick-choice', index: 3, card: b }], // already chosen: Change card first
      [start, { type: 'finish', index: 0, finish: 'holo' }], // no card yet
      [start, { type: 'copy', index: 0, copy: 'raw' }],
      [start, { type: 'destination', index: 0, destination: 'append' }],
      [start, { type: 'change', index: 0 }],
      [start, { type: 'choose', index: 3 }],
      [start, { type: 'include', index: 3 }],
      [start, { type: 'keep-current', index: 3 }],
      [start, { type: 'picked', index: 3, card: b }], // no picker open
      [start, { type: 'close-picker' }],
      [start, { type: 'skip', index: 4 }], // not a reviewed pocket
      [start, { type: 'skip', index: 99 }],
      [skipped, { type: 'skip', index: 3 }],
      [skipped, { type: 'replace', index: 3, keepCard: true }],
      [skipped, { type: 'finish', index: 3, finish: 'holo' }],
      [step(start, { type: 'replace', index: 3, keepCard: true }), { type: 'replace', index: 3, keepCard: false }],
    ];
    for (const [state, event] of rejected) assert.equal(step(state, event), state, JSON.stringify(event));
  });

  test('one picker at a time, and a pick only lands on the pocket it was opened for', () => {
    const picking = step(start, { type: 'choose', index: 0 });
    assert.equal(step(picking, { type: 'choose', index: 1 }), picking);
    assert.equal(step(picking, { type: 'change', index: 3 }), picking);
    assert.equal(step(picking, { type: 'picked', index: 1, card: b }), picking);
    assert.equal(step(picking, { type: 'close-picker' }).picking, null);
  });
});
