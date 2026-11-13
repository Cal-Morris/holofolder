// Set hits for the Search sheet and Quick mode: which mirrored sets a typed query names, best match first.
// Pure (no React), so the ranking is unit-tested; the fetch lives in hooks/use-card-search.ts.
import { resolveSetSearchAlias } from '@/lib/set-search-aliases';
import type { TCGSetSummary } from '@/lib/tcg-set-slots';

/** How many set rows the Search sheet and Quick mode show above their card results. */
export const SEARCH_SET_RESULT_LIMIT = 3;

const normalize = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** Same threshold as the set search API (two characters). */
export function isSetSearchQuery(query: string) {
  return normalize(query).length >= 2;
}

/** "2016", "xy 2016" or "2016 xy": a release year, optionally narrowed by a set or series name. */
export function parseSetYearQuery(query: string): { year: string; text: string } | null {
  const trimmed = normalize(query);
  const match = /^(?:(.+?) )?((?:19|20)\d{2})$/.exec(trimmed) ?? /^((?:19|20)\d{2}) (.+)$/.exec(trimmed);
  if (!match) return null;
  return /^(?:19|20)\d{2}$/.test(match[2])
    ? { year: match[2], text: match[1] ?? '' }
    : { year: match[1], text: match[2] };
}

export function isSetYearQuery(query: string) {
  return parseSetYearQuery(query) !== null;
}

const words = (value: string) =>
  normalize(value)
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .replace(/ +/g, ' ')
    .trim();

/** Whether a set released in the query's year, and (with text) the set or its series matches that text. */
export function matchesSetYearQuery(set: TCGSetSummary, query: { year: string; text: string }) {
  if (!set.releaseDate?.startsWith(`${query.year}-`)) return false;
  if (!query.text) return true;
  const code = normalize(resolveSetSearchAlias(query.text));
  return (
    matchScore(set, query.text) > 0 ||
    (code !== query.text && matchScore(set, code) > 0) ||
    (Boolean(set.seriesName) && ` ${words(set.seriesName!)} `.includes(` ${words(query.text)}`))
  );
}

function matchScore(set: TCGSetSummary, needle: string) {
  const id = normalize(set.id);
  const name = normalize(set.name);
  if (id === needle || name === needle) return 4;
  if (name.startsWith(needle)) return 3;
  if (name.split(' ').some((word) => word.startsWith(needle)) || id.startsWith(needle)) return 2;
  if (needle.length >= 3 && (name.includes(needle) || id.includes(needle))) return 1;
  return 0;
}

/**
 * Sets whose name or id match the query: exact id or name first, then name prefix, then a word or id prefix,
 * then (3+ characters) a substring. A four-digit year returns every dated release in that year, newest first.
 * Ties keep the input order (the API returns newest first). Duplicate ids
 * are dropped; sets that don't match at all (e.g. a stale offline list) are left out.
 */
export function rankSetMatches(
  sets: readonly TCGSetSummary[],
  query: string,
  limit = isSetYearQuery(query) ? Infinity : SEARCH_SET_RESULT_LIMIT,
): TCGSetSummary[] {
  const needle = normalize(query);
  const code = normalize(resolveSetSearchAlias(query));
  const year = parseSetYearQuery(needle);
  if (needle.length < 2) return [];
  const seen = new Set<string>();
  const scored: Array<{ set: TCGSetSummary; score: number; index: number }> = [];
  sets.forEach((set, index) => {
    if (!set?.id || !set.name || seen.has(set.id)) return;
    // A printed code ("MEW") ranks its set first without hiding sets whose names start with the same letters.
    const score = year
      ? Number(matchesSetYearQuery(set, year))
      : Math.max(matchScore(set, needle), code === needle ? 0 : matchScore(set, code));
    if (!score) return;
    seen.add(set.id);
    scored.push({ set, score, index });
  });
  return scored
    .sort(
      (a, b) =>
        (year ? (b.set.releaseDate ?? '').localeCompare(a.set.releaseDate ?? '') : b.score - a.score) ||
        a.index - b.index,
    )
    .slice(0, Math.max(0, limit))
    .map((entry) => entry.set);
}

/** "Mega Evolution · 102 cards · 2026-01-30", with unknown parts left out. */
export function formatSetHitMeta(set: TCGSetSummary) {
  return [set.seriesName, set.officialCardCount ? `${set.officialCardCount} cards` : null, set.releaseDate]
    .filter(Boolean)
    .join(' · ');
}
