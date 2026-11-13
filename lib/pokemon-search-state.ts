export type PokemonSearchStateFilter = 'all' | 'current' | 'needed' | 'missing' | 'upgrade' | 'wanted' | 'perfect';
export type PokemonSearchSlotState = 'open' | 'owned' | 'wanted' | 'perfect' | 'upgrade';

export interface PokemonSearchFilterState {
  slotState?: PokemonSearchSlotState | null;
  isCurrentPage?: boolean;
}

export interface PokemonSearchPageJump {
  page: number;
  label: string;
}

export interface PokemonSearchItem {
  id: number;
  name: string;
}

export interface PokemonSearchScoredItem<T extends PokemonSearchItem> extends PokemonSearchItem {
  score: number;
  item: T;
}

export function getInitialPokemonSearchFilter(): PokemonSearchStateFilter {
  return 'all';
}

export function matchesPokemonSearchStateFilter(filter: PokemonSearchStateFilter, state: PokemonSearchFilterState) {
  if (filter === 'current') {
    return Boolean(state.isCurrentPage);
  }

  if (filter === 'needed') {
    return state.slotState === 'open' || state.slotState === 'wanted';
  }

  if (filter === 'missing') {
    return state.slotState === 'open';
  }

  if (filter === 'upgrade') {
    return state.slotState === 'owned' || state.slotState === 'upgrade';
  }

  if (filter === 'wanted') {
    return state.slotState === 'wanted';
  }

  if (filter === 'perfect') {
    return state.slotState === 'perfect';
  }

  return true;
}

export function normalizePokemonSearchText(value: string) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/♀/g, ' female ')
    .replace(/♂/g, ' male ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function compactSearchText(value: string) {
  return normalizePokemonSearchText(value).replace(/\s+/g, '');
}

export function getPokemonSearchTerms(name: string) {
  const normalizedName = normalizePokemonSearchText(name);
  const compactName = compactSearchText(name);
  const terms = new Set([normalizedName, compactName]);

  const dashParts = name.split('-').filter(Boolean);
  if (dashParts.length > 1) {
    terms.add(normalizePokemonSearchText(dashParts[0]));
    terms.add(compactSearchText(dashParts[0]));
  }

  if (name === 'nidoran-f') {
    terms.add('nidoran female');
    terms.add('nidoranfemale');
  }

  if (name === 'nidoran-m') {
    terms.add('nidoran male');
    terms.add('nidoranmale');
  }

  return Array.from(terms).filter(Boolean);
}

/** Optimal string alignment distance (Levenshtein + adjacent transpositions), capped for speed. */
export function getEditDistance(a: string, b: string, max = 3) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dist: number[][] = Array.from({ length: rows }, (_, i) => {
    const row = Array.from({ length: cols }, () => 0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j < cols; j++) dist[0][j] = j;
  for (let i = 1; i < rows; i++) {
    let rowMin = Number.POSITIVE_INFINITY;
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(dist[i - 1][j] + 1, dist[i][j - 1] + 1, dist[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, dist[i - 2][j - 2] + 1);
      }
      dist[i][j] = value;
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > max) return max + 1;
  }
  return dist[a.length][b.length];
}

/**
 * Typos allowed for a query of this length (none for very short queries). Five letters and up get two, so
 * "ominite" finds Omanyte; four-letter queries stay at one because two edits there match half the Pokédex.
 */
function allowedTypos(length: number) {
  if (length >= 5) return 2;
  if (length >= 4) return 1;
  return 0;
}

/** "25", "#25", "#025", "no 25" → 25 */
export function parseDexNumberQuery(query: string) {
  const match = /^(?:#|no\.?\s*|dex\s*)?0*(\d{1,4})$/i.exec(query.trim());
  if (!match) return null;
  const value = Number.parseInt(match[1], 10);
  return value > 0 ? value : null;
}

export function scorePokemonSearchItem(query: string, item: PokemonSearchItem) {
  const normalizedQuery = normalizePokemonSearchText(query);
  const compactQuery = compactSearchText(query);

  if (!normalizedQuery) return 0;

  const dexNumber = parseDexNumberQuery(query);
  if (dexNumber !== null) {
    if (item.id === dexNumber) return 1100;
    // "#2" also suggests #20-#29 and #200-#299, ranked after the exact number.
    return String(item.id).startsWith(String(dexNumber)) ? 300 - String(item.id).length : 0;
  }

  const terms = getPokemonSearchTerms(item.name);
  let bestScore = 0;

  for (const term of terms) {
    // oxlint-disable-next-line react-doctor/js-set-map-lookups -- substring check on a string
    const comparableQuery = term.includes(' ') ? normalizedQuery : compactQuery;
    let score = 0;

    // oxlint-disable-next-line react-doctor/js-set-map-lookups -- substring check on a string
    if (comparableQuery === 'male' && term.includes('female')) {
      score = 0;
    } else if (term === comparableQuery) {
      score = 1000;
    } else if (term.startsWith(comparableQuery)) {
      score = 900;
      // oxlint-disable-next-line react-doctor/js-set-map-lookups -- substring check on a string
    } else if (term.includes(comparableQuery)) {
      score = 800;
    } else {
      let queryIndex = 0;
      for (let index = 0; index < term.length && queryIndex < comparableQuery.length; index++) {
        if (term[index] === comparableQuery[queryIndex]) {
          queryIndex++;
        }
      }

      if (queryIndex === comparableQuery.length) {
        score = 100 + queryIndex * 20;
      } else {
        // Typo tolerance: compare against the start of the name so "pikachuu" or "charzard" still match.
        const typos = allowedTypos(comparableQuery.length);
        if (typos > 0) {
          const prefix = term.slice(0, comparableQuery.length);
          const distance = Math.min(
            getEditDistance(comparableQuery, term, typos),
            getEditDistance(comparableQuery, prefix, typos),
          );
          score = distance <= typos ? 400 - distance * 100 : 0;
        }
      }
    }

    bestScore = Math.max(bestScore, score);
  }

  return bestScore;
}

export function searchPokemonItems<T extends PokemonSearchItem>(query: string, items: T[], limit = 8) {
  if (!query.trim()) return [];

  return items
    .flatMap((item): PokemonSearchScoredItem<T>[] => {
      const score = scorePokemonSearchItem(query, item);
      return score > 0 ? [{ ...item, item, score }] : [];
    })
    .sort((a, b) => b.score - a.score || a.id - b.id)
    .slice(0, limit);
}

export function getPokemonSearchPageJump(query: string, totalPages: number): PokemonSearchPageJump | null {
  const trimmedQuery = query.trim().toLowerCase();
  const match = /^(?:page\s*)?(\d+)$/.exec(trimmedQuery);

  if (!match) return null;

  const page = Number.parseInt(match[1], 10);
  if (!Number.isInteger(page) || page < 1 || page > totalPages) return null;

  return {
    page,
    label: `Jump to page ${page}`,
  };
}
