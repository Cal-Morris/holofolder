import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CARD_MM,
  PAPER,
  binderPages,
  binderSheets,
  defaultPaper,
  gridOrigin,
  listSheets,
  placeholderCount,
  toPrintWants,
  wantPosition,
  type PrintWant,
} from '@/lib/print-placeholders';
import { nativeCardConsumers } from '@/lib/collection/native-card-consumers';
import { nativeConsumerFixture } from './fixtures/native-card-consumers';

// Synthetic wants only.
const want = (slotIndex: number | null, extra: Partial<PrintWant> = {}): PrintWant => ({
  key: `w-${slotIndex}-${extra.wantedIndex ?? 0}-${extra.binderId ?? 'b1'}`,
  binderId: 'b1',
  binderName: 'Synthetic binder',
  slotIndex,
  capacity: 9,
  nineGrid: true,
  wantedIndex: 0,
  occupied: false,
  name: `Synthetic ${slotIndex}`,
  set: 'Synthetic Base',
  number: '1/100',
  rarity: null,
  illustrator: null,
  finish: null,
  images: [],
  ...extra,
});
const names = (sheet: (PrintWant | null)[]) => sheet.map((w) => w?.slotIndex ?? null);

describe('print placeholders', () => {
  test('the 3 × 3 grid of 63 × 88 mm cards fits inside A4 and US Letter with room for cut marks', () => {
    for (const paper of ['a4', 'letter'] as const) {
      const { left, top } = gridOrigin(paper);
      assert.ok(left >= 7.5, `${paper} side margin`);
      assert.ok(top >= 7.5, `${paper} top margin`);
      assert.equal(left * 2 + 3 * CARD_MM.width, PAPER[paper].width);
      assert.equal(top * 2 + 3 * CARD_MM.height, PAPER[paper].height);
    }
  });

  test('Letter for US and Canadian locales, A4 otherwise', () => {
    assert.equal(defaultPaper('en-US'), 'letter');
    assert.equal(defaultPaper('fr-CA'), 'letter');
    assert.equal(defaultPaper('en-GB'), 'a4');
    assert.equal(defaultPaper(undefined), 'a4');
  });

  test('positions are 1-based page and pocket', () => {
    assert.deepEqual(wantPosition({ slotIndex: 0, capacity: 9 }), { page: 1, pocket: 1 });
    assert.deepEqual(wantPosition({ slotIndex: 13, capacity: 9 }), { page: 2, pocket: 5 });
    assert.deepEqual(wantPosition({ slotIndex: 13, capacity: 12 }), { page: 2, pocket: 2 });
    assert.equal(wantPosition({ slotIndex: 3, capacity: null }), null);
  });

  test('the want list packs nine to a page in its own order', () => {
    const list = [5, 1, 9, 2, 3, 4, 6, 7, 8, 0, 11].map((n) => want(n));
    const sheets = listSheets(list);
    assert.equal(sheets.length, 2);
    assert.deepEqual(names(sheets[0]), [5, 1, 9, 2, 3, 4, 6, 7, 8]);
    assert.deepEqual(names(sheets[1]), [0, 11]);
    assert.equal(placeholderCount(sheets), 11);
  });

  test('a 3 × 3 binder prints each binder page on its own sheet, every placeholder in its pocket', () => {
    const wants = [want(10), want(0), want(4), want(8), want(26)];
    const sheets = binderSheets(wants, 'b1');
    assert.equal(sheets.length, 3);
    assert.deepEqual(names(sheets[0]), [0, null, null, null, 4, null, null, null, 8]);
    assert.deepEqual(names(sheets[1]), [null, 10, null, null, null, null, null, null, null]);
    assert.deepEqual(names(sheets[2]), [null, null, null, null, null, null, null, null, 26]);
  });

  test('binder mode skips filled pockets, other binders, and prints one placeholder per pocket (its first want)', () => {
    const wants = [
      want(0, { wantedIndex: 1, name: 'second' }),
      want(0, { wantedIndex: 0, name: 'first' }),
      want(1, { occupied: true }),
      want(2, { binderId: 'b2' }),
    ];
    const sheets = binderSheets(wants, 'b1');
    assert.equal(placeholderCount(sheets), 1);
    assert.equal(sheets[0][0]?.name, 'first');
  });

  test('page range keeps only those binder pages', () => {
    const wants = [want(0), want(9), want(18), want(27)];
    assert.deepEqual(binderPages(wants, 'b1'), [1, 2, 3, 4]);
    const sheets = binderSheets(wants, 'b1', 2, 3);
    assert.deepEqual(
      sheets.map((s) => names(s).filter((n) => n != null)),
      [[9], [18]],
    );
  });

  test('other binder layouts pack per binder page and never mix two binder pages on one sheet', () => {
    // A 4 × 3 binder: 12 pockets a page, so page 1 needs two sheets.
    const grid = { capacity: 12, nineGrid: false };
    const wants = Array.from({ length: 11 }, (_, i) => want(i, grid)).concat(want(12, grid));
    const sheets = binderSheets(wants, 'b1');
    assert.deepEqual(names(sheets[0]), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual(names(sheets[1]), [9, 10]);
    assert.deepEqual(names(sheets[2]), [12]);
  });

  test('wants with an unknown layout print last, in pocket order', () => {
    const wants = [want(3, { capacity: null }), want(1, { capacity: null }), want(0)];
    const sheets = binderSheets(wants, 'b1');
    assert.equal(sheets.length, 2);
    assert.deepEqual(names(sheets[1]), [1, 3]);
  });

  test('builds printable wants from the native model the Wanted tab lists', async () => {
    const { binding } = await nativeConsumerFixture();
    const model = nativeCardConsumers(binding)!;
    const wants = toPrintWants(model, binding.read);
    assert.equal(wants.length, model.wants.length);
    const first = wants[0];
    assert.equal(first.key, model.wants[0].key);
    assert.equal(first.name, 'Synthetic Trainer');
    assert.equal(first.slotIndex, 0);
    // The fixture has no layouts, so the position is unknown rather than guessed.
    assert.equal(first.capacity, null);
    for (const src of wants.flatMap((w) => w.images)) assert.match(src, /^https:\/\/assets\.holofolder\.com\//);
  });
});
