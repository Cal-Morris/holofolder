import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  availableCoachMarks,
  COACH_MARKS,
  parseTourFlag,
  startingTourFlag,
  TOUR_SLIDES,
  tourFlagAfterWizard,
} from '@/lib/first-account-tour';

describe('first-account tour', () => {
  test('reads only the two known flag values', () => {
    assert.equal(parseTourFlag('due'), 'due');
    assert.equal(parseTourFlag('done'), 'done');
    for (const value of [undefined, null, '', 'yes', true, 1]) assert.equal(parseTourFlag(value), null);
  });

  test('accounts without the flag (everyone before the tour shipped) never get it', () => {
    assert.equal(startingTourFlag({ harness: false, asked: false, local: null, account: null }), null);
    assert.equal(startingTourFlag({ harness: false, asked: false, local: null, account: 'due' }), 'due');
    assert.equal(startingTourFlag({ harness: false, asked: false, local: null, account: 'done' }), 'done');
  });

  test("this device's copy wins over the account's", () => {
    assert.equal(startingTourFlag({ harness: false, asked: false, local: 'done', account: 'due' }), 'done');
    assert.equal(startingTourFlag({ harness: false, asked: false, local: 'due', account: null }), 'due');
  });

  test('synthetic e2e pages skip it unless asked, and a finished tour stays finished there', () => {
    assert.equal(startingTourFlag({ harness: true, asked: false, local: 'due', account: 'due' }), 'done');
    assert.equal(startingTourFlag({ harness: true, asked: true, local: null, account: null }), 'due');
    assert.equal(startingTourFlag({ harness: true, asked: true, local: 'done', account: null }), 'done');
  });

  test('the wizard makes it due once, never again after it is done', () => {
    assert.equal(tourFlagAfterWizard(null), 'due');
    assert.equal(tourFlagAfterWizard('due'), 'due');
    assert.equal(tourFlagAfterWizard('done'), 'done');
  });

  test('has a short intro and a coach mark per header control and dock tab it explains', () => {
    assert.ok(TOUR_SLIDES.length >= 4 && TOUR_SLIDES.length <= 5);
    assert.deepEqual(
      COACH_MARKS.map((m) => m.id),
      ['binders', 'show', 'search', 'inventory', 'wanted', 'browse'],
    );
  });

  test('leaves out marks whose control is not on screen, keeping the order', () => {
    const shown = new Set([COACH_MARKS[0].target, COACH_MARKS[3].target, COACH_MARKS[2].target]);
    assert.deepEqual(
      availableCoachMarks(COACH_MARKS, (t) => shown.has(t)).map((m) => m.id),
      ['binders', 'search', 'inventory'],
    );
    assert.deepEqual(
      availableCoachMarks(COACH_MARKS, () => false),
      [],
    );
  });
});
