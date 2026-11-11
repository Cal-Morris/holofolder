import test from 'node:test';
import assert from 'node:assert/strict';
import { selectRecentSetSummaries, type TCGSetSummary } from '../lib/tcg-set-slots';

const sets: TCGSetSummary[] = [
  { id: 'me04', name: 'Chaos Rising', officialCardCount: 86, releaseDate: '2026-05-22' },
  { id: 'me05', name: 'Pitch Black', officialCardCount: 84, releaseDate: '2026-07-17' },
  { id: 'mep', name: 'MEP Black Star Promos', officialCardCount: 0, releaseDate: '2025-09-26' },
  { id: 'mee', name: 'Mega Evolution Energy', officialCardCount: 16, releaseDate: '2025-09-25' },
  { id: 'future', name: 'Unreleased Set', officialCardCount: 100, releaseDate: '2026-12-01' },
  { id: 'undated', name: 'Undated Set', officialCardCount: 100 },
  { id: 'me03', name: 'Perfect Order', officialCardCount: 88, releaseDate: '2026-03-27' },
  { id: 'me05', name: 'Pitch Black', officialCardCount: 84, releaseDate: '2026-07-17' },
];

test('selectRecentSetSummaries returns newest released main sets first', () => {
  assert.deepEqual(
    selectRecentSetSummaries(sets, { asOfDate: '2026-10-09' }).map((set) => set.id),
    ['me05', 'me04', 'me03'],
  );
});

test('selectRecentSetSummaries skips sets released after the as-of date and respects the limit', () => {
  assert.deepEqual(
    selectRecentSetSummaries(sets, { asOfDate: '2026-06-01', limit: 1 }).map((set) => set.id),
    ['me04'],
  );
  assert.deepEqual(
    selectRecentSetSummaries(sets, { asOfDate: '2026-12-01', limit: 2 }).map((set) => set.id),
    ['future', 'me05'],
  );
});
