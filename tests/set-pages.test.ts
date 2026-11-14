import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { groupSetsBySeries } from '@/lib/set-browse';
import {
  assignSetSlugs,
  blogSetGuideUrl,
  countSetCards,
  formatReleaseDate,
  pagesNeeded,
  setSlug,
  toBinderPages,
} from '@/lib/set-pages';

// Synthetic set fixtures; names mirror real sets but ids, dates and counts are illustrative.
describe('setSlug', () => {
  test('lowercases, strips accents and apostrophes, joins with hyphens', () => {
    assert.equal(setSlug('Prismatic Evolutions'), 'prismatic-evolutions');
    assert.equal(setSlug('Pokémon GO'), 'pokemon-go');
    assert.equal(setSlug("McDonald's Collection 2026"), 'mcdonalds-collection-2026');
    assert.equal(setSlug('Sun & Moon'), 'sun-and-moon');
    assert.equal(setSlug('  HS—Triumphant! '), 'hs-triumphant');
    assert.equal(setSlug('ポケモン'), '');
  });
});

describe('assignSetSlugs', () => {
  test('the oldest set keeps the plain slug, later duplicates get their id', () => {
    const slugs = assignSetSlugs([
      { id: 'new', name: 'Base Set', releaseDate: '2025-01-01' },
      { id: 'base1', name: 'Base Set', releaseDate: '1999-01-09' },
      { id: 'x', name: '!!!' },
    ]);
    assert.equal(slugs.get('base1'), 'base-set');
    assert.equal(slugs.get('new'), 'base-set-new');
    assert.equal(slugs.get('x'), 'x');
  });

  test('slugs are unique even when the id fallback collides', () => {
    const slugs = assignSetSlugs([
      { id: 'a', name: 'Promo', releaseDate: '2000-01-01' },
      { id: 'b', name: 'Promo a', releaseDate: '2001-01-01' },
      { id: 'a2', name: 'Promo', releaseDate: '2002-01-01' },
      { id: 'a', name: 'Promo', releaseDate: '2003-01-01' },
    ]);
    assert.equal(new Set(slugs.values()).size, slugs.size);
  });
});

describe('pages', () => {
  test('nine-pocket pages round up', () => {
    assert.equal(pagesNeeded(0), 0);
    assert.equal(pagesNeeded(9), 1);
    assert.equal(pagesNeeded(10), 2);
    assert.equal(pagesNeeded(180), 20);
    assert.equal(pagesNeeded(181), 21);
  });

  test('toBinderPages fills pages in order with a short last page', () => {
    const pages = toBinderPages(Array.from({ length: 20 }, (_, i) => i + 1));
    assert.deepEqual(
      pages.map((page) => page.length),
      [9, 9, 2],
    );
    assert.equal(pages[1][0], 10);
  });
});

describe('countSetCards', () => {
  test('splits base and secret by the printed total', () => {
    assert.deepEqual(countSetCards(['001', '2', '3', '4', '5'], 3), { total: 5, base: 3, secret: 2 });
  });

  test('unnumbered cards count toward the total only', () => {
    assert.deepEqual(countSetCards(['1', 'TG01', 'SV001'], 1), { total: 3, base: 1, secret: 0 });
  });

  test('no printed total means no split', () => {
    assert.deepEqual(countSetCards(['1', '2'], undefined), { total: 2, base: undefined, secret: undefined });
  });
});

describe('index grouping', () => {
  test('groups by series, newest set first, keeping the summary fields', () => {
    const groups = groupSetsBySeries([
      { id: 'a', name: 'A', seriesName: 'Old', releaseDate: '2000-01-01', slug: 'a' },
      { id: 'c', name: 'C', seriesName: 'New', releaseDate: '2025-01-01', slug: 'c' },
      { id: 'b', name: 'B', seriesName: 'New', releaseDate: '2024-01-01', slug: 'b' },
    ]);
    assert.deepEqual(
      groups.map((group) => [group.series, group.sets.map((set) => set.slug)]),
      [
        ['New', ['c', 'b']],
        ['Old', ['a']],
      ],
    );
  });
});

test('blog guides map by slug', () => {
  assert.equal(blogSetGuideUrl('delta-reign'), 'https://holofolder.com/blog/pokemon-delta-reign-set-guide');
  assert.equal(blogSetGuideUrl('base-set'), undefined);
});

test('release dates read as day month year', () => {
  assert.equal(formatReleaseDate('2025-01-17'), '17 January 2025');
  assert.equal(formatReleaseDate(undefined), undefined);
});
