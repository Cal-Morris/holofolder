import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { fitBinderPages, insideCoverFits, spreadKeepsPocketSize } from '@/lib/binder-fit';

// A wide desktop stage (1440×900 window, minus header and dock).
const stage = { width: 1400, height: 760 };
const desktop = { stage, padding: 16, spreadGap: 16 };

describe('binder fit', () => {
  test('a 3×3 binder keeps its pocket size as a spread', () => {
    assert.equal(spreadKeepsPocketSize({ ...desktop, rows: 3, cols: 3 }), true);
  });

  test('a 2×6 binder stays one page instead of two short strips', () => {
    assert.equal(spreadKeepsPocketSize({ ...desktop, rows: 2, cols: 6 }), false);
  });

  test('nothing fits a stage that is not measured yet', () => {
    assert.equal(fitBinderPages({ ...desktop, stage: { width: 0, height: 0 }, rows: 3, cols: 3, pages: 1 }), null);
  });

  test('the inside cover shows on a tall spread page and hides on a short or wide one', () => {
    const spread = fitBinderPages({ ...desktop, rows: 3, cols: 3, pages: 2 });
    assert.ok(spread);
    assert.equal(insideCoverFits(spread, 16), true);

    const wide = fitBinderPages({ ...desktop, rows: 2, cols: 6, pages: 2 });
    assert.ok(wide);
    assert.equal(insideCoverFits(wide, 16), false);

    const phone = fitBinderPages({
      stage: { width: 370, height: 560 },
      padding: 8,
      spreadGap: 12,
      rows: 3,
      cols: 3,
      pages: 2,
    });
    assert.ok(phone);
    assert.equal(insideCoverFits(phone, 12), false);
  });
});
