// Quick mode: one search field that jumps anywhere in the app. Pure helpers (destinations, matching and the
// on-device recent searches); the overlay itself is components/quick-mode.tsx.
import { normalizePokemonSearchText } from '@/lib/pokemon-search-state';

export const QUICK_DESTINATION_IDS = [
  'binder',
  'list',
  'wanted',
  'sets',
  'pokemon',
  'analytics',
  'settings',
  'scan',
  'show-mode',
] as const;
export type QuickDestinationId = (typeof QUICK_DESTINATION_IDS)[number];

export interface QuickDestination {
  id: QuickDestinationId;
  label: string;
  hint: string;
  keywords: readonly string[];
}

export const QUICK_DESTINATIONS: readonly QuickDestination[] = [
  { id: 'binder', label: 'Binder', hint: 'Your binder pages', keywords: ['binder', 'pages', 'home', 'dex'] },
  {
    id: 'wanted',
    label: 'Want list',
    hint: "Cards you're hunting",
    keywords: ['wanted', 'want list', 'wishlist', 'hunt', 'chase'],
  },
  {
    id: 'list',
    label: 'List',
    hint: 'Every slot as a checklist',
    keywords: ['list', 'checklist', 'slots', 'collection'],
  },
  {
    id: 'sets',
    label: 'Sets',
    hint: 'Browse sets and completion',
    keywords: ['sets', 'set', 'expansions', 'completion'],
  },
  {
    id: 'pokemon',
    label: 'Pokémon',
    hint: 'Browse cards by Pokémon',
    keywords: ['pokemon', 'pokémon', 'browse', 'species'],
  },
  {
    id: 'analytics',
    label: 'Analytics',
    hint: 'Value, spend and stats',
    keywords: ['analytics', 'stats', 'value', 'worth', 'export', 'csv'],
  },
  {
    id: 'settings',
    label: 'Settings',
    hint: 'Region, currency, binder',
    keywords: ['settings', 'preferences', 'region', 'currency', 'account', 'options'],
  },
  {
    id: 'scan',
    label: 'Scan a page',
    hint: 'Photograph a binder page',
    keywords: ['scan', 'camera', 'photo', 'page scan'],
  },
  {
    id: 'show-mode',
    label: 'Show mode',
    hint: 'At a card show: fast search, screen stays on',
    keywords: ['show mode', 'card show', 'show', 'event', 'convention', 'fair', 'market', 'stall', 'trade'],
  },
];

/** Destinations whose label or keywords start with (or contain, for longer queries) the query. */
export function matchQuickDestinations(query: string, destinations: readonly QuickDestination[] = QUICK_DESTINATIONS) {
  const needle = normalizePokemonSearchText(query);
  if (!needle) return [...destinations];
  const scored: Array<{ destination: QuickDestination; score: number }> = [];
  for (const destination of destinations) {
    const terms = [destination.label, ...destination.keywords].map(normalizePokemonSearchText);
    let score = 0;
    for (const term of terms) {
      if (term === needle) score = Math.max(score, 3);
      else if (term.startsWith(needle) || term.split(' ').some((word) => word.startsWith(needle)))
        score = Math.max(score, 2);
      else if (needle.length >= 3 && term.includes(needle)) score = Math.max(score, 1);
    }
    if (score > 0) scored.push({ destination, score });
  }
  return scored.sort((a, b) => b.score - a.score).map((entry) => entry.destination);
}

export const RECENT_QUICK_SEARCHES_KEY = 'binderdex:quick-searches:v1';
export const RECENT_QUICK_SEARCHES_LIMIT = 8;

/** Newest first, case-insensitively de-duplicated, blank and one-letter queries dropped. */
export function addRecentQuickSearch(list: readonly string[], query: string, limit = RECENT_QUICK_SEARCHES_LIMIT) {
  const trimmed = query.trim().replace(/\s+/g, ' ').slice(0, 60);
  if (trimmed.length < 2) return [...list];
  const key = trimmed.toLowerCase();
  return [trimmed, ...list.filter((entry) => entry.toLowerCase() !== key)].slice(0, limit);
}

export function parseRecentQuickSearches(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length >= 2)
      .slice(0, RECENT_QUICK_SEARCHES_LIMIT);
  } catch {
    return [];
  }
}

type QuickStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function readRecentQuickSearches(storage: QuickStorage | undefined) {
  try {
    return parseRecentQuickSearches(storage?.getItem(RECENT_QUICK_SEARCHES_KEY));
  } catch {
    return [];
  }
}

export function writeRecentQuickSearches(storage: QuickStorage | undefined, list: readonly string[]) {
  try {
    storage?.setItem(RECENT_QUICK_SEARCHES_KEY, JSON.stringify(list));
  } catch {
    // Full or blocked storage just means recents aren't remembered.
  }
}

/** Long-press timing for the dock's Search button (opens Quick mode). */
export const QUICK_LONG_PRESS_MS = 450;
