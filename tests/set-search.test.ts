import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { formatSetHitMeta, isSetSearchQuery, rankSetMatches } from '../lib/set-search';
import type { TCGSetSummary } from '../lib/tcg-set-slots';

// Synthetic set summaries (not real catalogue data).
const sets: TCGSetSummary[] = [
  { id: 'fx3', name: 'Fixture Storm', seriesName: 'Fixture Series', officialCardCount: 90, releaseDate: '2026-03-01' },
  { id: 'fx2', name: 'Storm Fixture', officialCardCount: 80 },
  { id: 'fx1', name: 'Fixture', officialCardCount: 70 },
  { id: 'abc', name: 'Brainstorming' },
];

describe('rankSetMatches', () => {
  test('ignores one-letter queries', () => {
    assert.deepEqual(rankSetMatches(sets, 'f'), []);
    assert.equal(isSetSearchQuery(' f '), false);
    assert.equal(isSetSearchQuery('fx'), true);
  });

  test('exact name or id first, then name prefix, then word prefix, then substring', () => {
    assert.deepEqual(
      rankSetMatches(sets, 'fixture', 10).map((set) => set.id),
      ['fx1', 'fx3', 'fx2'],
    );
    assert.deepEqual(
      rankSetMatches(sets, 'storm', 10).map((set) => set.id),
      ['fx2', 'fx3', 'abc'],
    );
    assert.deepEqual(
      rankSetMatches(sets, 'fx', 10).map((set) => set.id),
      ['fx3', 'fx2', 'fx1'],
    );
    assert.deepEqual(
      rankSetMatches(sets, 'FX2', 10).map((set) => set.id),
      ['fx2'],
    );
  });

  test('short queries skip substring matches; limit and duplicates are respected', () => {
    assert.deepEqual(rankSetMatches(sets, 'or', 10), []);
    assert.deepEqual(
      rankSetMatches([...sets, sets[0]], 'fixture', 2).map((set) => set.id),
      ['fx1', 'fx3'],
    );
  });

  test("drops sets that don't match (stale offline lists)", () => {
    assert.deepEqual(rankSetMatches(sets, 'zzz'), []);
  });
});

describe('formatSetHitMeta', () => {
  test('leaves unknown parts out', () => {
    assert.equal(formatSetHitMeta(sets[0]), 'Fixture Series · 90 cards · 2026-03-01');
    assert.equal(formatSetHitMeta(sets[3]), '');
  });
});

// Synthetic summary; identity is checked against the published source group.
test('Delta Reign matches its name, canonical id and printed DLR code', () => {
  const delta = { id: 'me06', name: 'Delta Reign' };
  for (const query of ['delta reign', 'Delta', 'ME06', ' DLR '])
    assert.deepEqual(rankSetMatches([delta], query), [delta]);
  assert.deepEqual(rankSetMatches([], 'DLR'), []);
});

// Synthetic dates and ids exercise year lookup independently of set names.
test('year lookup returns every release in that year, newest first, with no three-set cap', () => {
  const releases = [1, 4, 2, 3].map((month) => ({
    id: `year-${month}`,
    name: `Fixture ${month}`,
    releaseDate: `2017-0${month}-01`,
  }));
  const unrelated = [
    { id: '2017', name: '2017 Fixture', releaseDate: '2018-01-01' },
    { id: 'unknown', name: 'Unknown' },
  ];
  assert.deepEqual(
    rankSetMatches([...releases, ...unrelated, releases[0]], ' 2017 ').map((set) => set.id),
    ['year-4', 'year-3', 'year-2', 'year-1'],
  );
  assert.deepEqual(rankSetMatches(releases, '2016'), []);
  assert.equal(rankSetMatches(releases, '2017', 2).length, 2);
});

// Synthetic sets: a year narrowed by a set code, a set name or a series name.
test('a year with a set or series name keeps only that year’s matching releases', () => {
  const dated: TCGSetSummary[] = [
    { id: 'zz9', name: 'Fixture Siege', seriesName: 'Zed Zone', releaseDate: '2016-08-03' },
    { id: 'zz8', name: 'Fixture Fates', seriesName: 'Zed Zone', releaseDate: '2016-05-02' },
    { id: 'zz7', name: 'Fixture Roar', seriesName: 'Zed Zone', releaseDate: '2015-11-04' },
    { id: 'sm1', name: 'Fixture Sun', seriesName: 'Sun & Moon', releaseDate: '2017-02-03' },
    { id: 'other', name: 'Other Fixture', seriesName: 'Other', releaseDate: '2016-01-01' },
  ];
  const ids = (query: string) => rankSetMatches(dated, query).map((set) => set.id);
  assert.deepEqual(ids('zz 2016'), ['zz9', 'zz8']);
  assert.deepEqual(ids('2016 zz'), ['zz9', 'zz8']);
  assert.deepEqual(ids('zed zone 2016'), ['zz9', 'zz8']);
  assert.deepEqual(ids('sun moon 2017'), ['sm1']);
  assert.deepEqual(ids('siege 2016'), ['zz9']);
  assert.deepEqual(ids('2016'), ['zz9', 'zz8', 'other']);
  assert.deepEqual(ids('zz 2014'), []);
});
