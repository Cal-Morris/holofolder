/**
 * Card nicknames ("moonbreon", "bubble mew", "gold star rayquaza"): what collectors call a card instead of its printed
 * name. The table is lib/card-nicknames.json, built by `bun run card-nicknames` from card-nicknames/nicknames.csv and
 * the rules in scripts/card-nicknames.ts. Pure, shared by the server search and the on-device search.
 */
import NICKNAMES from './card-nicknames.json';

const TABLE: Readonly<Record<string, readonly string[]>> = NICKNAMES;
const KEYS = Object.keys(TABLE);

/** Lowercase, accents and punctuation dropped, single spaces ("Ho-Oh ☆" → "ho oh"). */
export function normalizeNickname(value: string) {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export interface NicknameMatch {
  /** Card ids the nickname names. */
  ids: string[];
  /** The rest of the query ("rayquaza" in "gold star rayquaza"), to match against card names; '' when none. */
  rest: string;
}

/**
 * The cards a query names by nickname: the whole query ("moonbreon"), a nickname plus a card name at either end
 * ("gold star rayquaza", "umbreon alt art"), or, while typing, the start of a one-word nickname ("moonbr"). The
 * longest nickname wins, so "alt art" beats a shorter one inside it.
 */
export function matchCardNicknames(query: string, table: Readonly<Record<string, readonly string[]>> = TABLE) {
  const text = normalizeNickname(query);
  if (!text) return null;
  const keys = table === TABLE ? KEYS : Object.keys(table);
  let best: { key: string; rest: string } | null = null;
  for (const key of keys) {
    if (best && best.key.length >= key.length) continue;
    if (text === key) best = { key, rest: '' };
    else if (text.startsWith(`${key} `)) best = { key, rest: text.slice(key.length + 1) };
    else if (text.endsWith(` ${key}`)) best = { key, rest: text.slice(0, -key.length - 1) };
  }
  if (best) return { ids: [...table[best.key]], rest: best.rest } satisfies NicknameMatch;
  if (text.length < 4 || text.includes(' ')) return null;
  const ids = keys.flatMap((key) => (!key.includes(' ') && key.startsWith(text) ? table[key] : []));
  return ids.length ? ({ ids: [...new Set(ids)], rest: '' } satisfies NicknameMatch) : null;
}

/** True when a card's name holds the rest of a nickname query (accents and punctuation ignored). */
export function matchesNicknameRest(name: string, rest: string) {
  return !rest || normalizeNickname(name).includes(rest);
}
