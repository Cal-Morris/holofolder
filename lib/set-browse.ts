import { resolveSetSearchAlias } from '@/lib/set-search-aliases';
import type { TCGSetSummary } from '@/lib/tcg-set-slots';

const OTHER_SERIES = 'Other';

export interface SetSeriesGroup {
  series: string;
  sets: TCGSetSummary[];
}

const newestFirst = (left: TCGSetSummary, right: TCGSetSummary) =>
  (right.releaseDate ?? '').localeCompare(left.releaseDate ?? '') || left.name.localeCompare(right.name);

/** Sets grouped by TCGdex series, newest series first, newest set first inside each. */
export function groupSetsBySeries(sets: readonly TCGSetSummary[]): SetSeriesGroup[] {
  const groups = new Map<string, TCGSetSummary[]>();
  for (const set of [...sets].sort(newestFirst)) {
    const series = set.seriesName?.trim() || OTHER_SERIES;
    groups.set(series, [...(groups.get(series) ?? []), set]);
  }
  // Map keeps insertion order, and each group's first set is its newest, so groups are already newest first.
  return [...groups].map(([series, grouped]) => ({ series, sets: grouped }));
}

/** Series to filter by, in browse order. */
export function listSetSeries(sets: readonly TCGSetSummary[]) {
  return groupSetsBySeries(sets).map(({ series, sets: grouped }) => ({ series, count: grouped.length }));
}

/** Sets in `series` (null = every series) whose name, code or series matches `query`, grouped for display. */
export function filterSetGroups(
  sets: readonly TCGSetSummary[],
  { series, query }: { series: string | null; query: string },
) {
  const text = resolveSetSearchAlias(query);
  return groupSetsBySeries(sets)
    .filter((group) => !series || group.series === series)
    .map((group) => ({
      ...group,
      sets: text
        ? group.sets.filter((set) =>
            [set.name, set.id, group.series].some((value) => value.toLowerCase().includes(text)),
          )
        : group.sets,
    }))
    .filter((group) => group.sets.length > 0);
}

/** Up to three letters standing in for a set without a symbol or logo ("Perfect Order" → "PO"). */
export function getSetMonogram(set: Pick<TCGSetSummary, 'id' | 'name'>) {
  const words = set.name.split(/[\s:&-]+/).filter((word) => /[\p{L}\p{N}]/u.test(word));
  const letters = words.length > 1 ? words.map((word) => [...word][0]).join('') : set.name || set.id;
  return [...letters.replace(/[^\p{L}\p{N}]/gu, '')].slice(0, 3).join('').toUpperCase() || '?';
}

function httpsUrl(value: unknown) {
  return typeof value === 'string' && value.startsWith('https://') ? value : undefined;
}

/** TCGdex stores asset bases without an extension; the PNG is the variant every asset has. */
function tcgdexAsset(value: unknown) {
  const url = httpsUrl(value);
  return url && !/\.(png|webp|jpg)$/.test(url) ? `${url}.png` : url;
}

/**
 * The set's symbol and logo from the mirrored set row: TCGdex's own assets first, then the pokemontcg.io
 * images the sync matched to the set. Only URLs the mirror holds, nothing guessed.
 */
export function pickSetArtwork({
  tcgdexSymbol,
  tcgdexLogo,
  pokemonTcgImages,
}: {
  tcgdexSymbol?: unknown;
  tcgdexLogo?: unknown;
  pokemonTcgImages?: unknown;
}) {
  const images =
    pokemonTcgImages && typeof pokemonTcgImages === 'object' ? (pokemonTcgImages as Record<string, unknown>) : {};
  // TCGdex logos are reliable; its symbols are often listed without the asset existing, so prefer pokemontcg.io's.
  const symbol = httpsUrl(images.symbol) ?? tcgdexAsset(tcgdexSymbol);
  const logo = tcgdexAsset(tcgdexLogo) ?? httpsUrl(images.logo);
  return { ...(symbol ? { symbol } : {}), ...(logo ? { logo } : {}) };
}
