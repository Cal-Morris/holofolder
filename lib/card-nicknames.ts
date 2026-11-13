/**
 * Card nicknames ("moonbreon", "bubble mew", "gold star rayquaza"): what collectors call a card instead of its printed
 * name. The table is lib/card-nicknames.json, built by `bun run card-nicknames` from lib/card-nicknames.csv and
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
  const best = matchPhrase(text, keys);
  if (best) return { ids: [...table[best.key]], rest: best.rest } satisfies NicknameMatch;
  if (text.length < 4 || text.includes(' ')) return null;
  const ids = keys.flatMap((key) => (!key.includes(' ') && key.startsWith(text) ? table[key] : []));
  return ids.length ? ({ ids: [...new Set(ids)], rest: '' } satisfies NicknameMatch) : null;
}

/** The longest key that is the whole text or a whole-word start or end of it, and what's left. */
function matchPhrase(text: string, keys: readonly string[]) {
  let best: { key: string; rest: string; at: 'start' | 'end' } | null = null;
  for (const key of keys) {
    if (best && best.key.length >= key.length) continue;
    if (text === key || text.startsWith(`${key} `)) best = { key, rest: text.slice(key.length + 1), at: 'start' };
    else if (text.endsWith(` ${key}`)) best = { key, rest: text.slice(0, -key.length - 1), at: 'end' };
  }
  return best;
}

const SIR = ['Special illustration rare'];
const IR = ['Illustration rare'];
const GOLD = ['Hyper rare', 'Mega Hyper Rare'];
const FULL_ART = ['Ultra Rare'];
const SHINY = ['Shiny rare', 'Shiny Ultra Rare', 'Shiny rare V', 'Shiny rare VMAX'];
const CHR = ['Character Rare'];
const CSR = ['Character Super Rare'];

/** Rarity words collectors add to a search ("charizard sir"), as the catalog's (TCGdex) rarity names. */
const RARITY_WORDS: Readonly<Record<string, readonly string[]>> = {
  sir: SIR,
  sar: SIR,
  'special illustration rare': SIR,
  'special art rare': SIR,
  ir: IR,
  'illustration rare': IR,
  'art rare': IR,
  gold: GOLD,
  'gold rare': GOLD,
  'hyper rare': GOLD,
  'full art': FULL_ART,
  ur: FULL_ART,
  'ultra rare': FULL_ART,
  'secret rare': ['Secret Rare'],
  'double rare': ['Double rare'],
  shiny: SHINY,
  'shiny rare': SHINY,
  chr: CHR,
  'character rare': CHR,
  csr: CSR,
  'character super rare': CSR,
  promo: ['Promo'],
  prime: ['Rare PRIME'],
  'lv x': ['Rare Holo LV.X'],
  lvx: ['Rare Holo LV.X'],
};
const RARITY_KEYS = Object.keys(RARITY_WORDS);

/**
 * A rarity word at either end of a search ("charizard sir", "full art lugia"): the rarities it means and the rest of
 * the search. Needs something else to search for, and a nickname at the same end wins ("gold star rayquaza" isn't gold + "star …").
 */
export function matchRarityWords(query: string) {
  const text = normalizeNickname(query);
  const match = matchPhrase(text, RARITY_KEYS);
  if (!match?.rest || matchPhrase(text, KEYS)?.at === match.at) return null;
  return { rarities: RARITY_WORDS[match.key], rest: match.rest };
}

/** True when a card has one of the rarities. */
export function hasRarity(card: { rarity?: string | null }, rarities: readonly string[]) {
  return Boolean(card.rarity && rarities.includes(card.rarity));
}

/** True when a card's name holds the rest of a nickname query (accents and punctuation ignored). */
export function matchesNicknameRest(name: string, rest: string) {
  return !rest || normalizeNickname(name).includes(rest);
}
