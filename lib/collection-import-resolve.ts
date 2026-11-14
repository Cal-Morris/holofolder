import { isCardFinish, isCardLanguage, type CardFinish } from '@/lib/domain/cards';
import type { ImportLookup } from '@/lib/collection-import';
import { inferCardFinish, normalizeLocalId, type SearchCardResult } from '@/lib/pokemon-card-browse';

export function readImportLookups(body: unknown): ImportLookup[] {
  if (
    !body ||
    typeof body !== 'object' ||
    !('lookups' in body) ||
    !Array.isArray(body.lookups) ||
    !body.lookups.length ||
    body.lookups.length > 25
  )
    throw new Error('Send between 1 and 25 card lookups.');
  const fields = new Set(['language', 'finish', 'list', 'cardId', 'tcgplayerId', 'cardName', 'set', 'number']);
  return body.lookups.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid lookup.');
    const value = raw as Record<string, unknown>;
    if (
      Object.entries(value).some(
        ([key, v]) => !fields.has(key) || typeof v !== 'string' || v.length > 240 || /[\u0000-\u001f]/.test(v),
      ) ||
      !isCardLanguage(value.language) ||
      !isCardFinish(value.finish) ||
      (value.list !== 'owned' && value.list !== 'wanted')
    )
      throw new Error('Invalid card identity, language, finish or list.');
    if (value.tcgplayerId && !/^\d{1,12}$/.test(String(value.tcgplayerId)))
      throw new Error('TCGplayer IDs must be numeric.');
    if (value.cardId && value.tcgplayerId) throw new Error('Choose one ID namespace.');
    if (!value.cardId && !value.tcgplayerId && !(value.cardName && value.set && value.number))
      throw new Error('Map a catalogue ID, TCGplayer product ID, or name, set and number.');
    return value as unknown as ImportLookup;
  });
}

/** Lowercase words without accents, punctuation or "&", so "Pokémon GO" = "Pokemon GO" and "S&V—151" = "s and v 151". */
export function importNameKey(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replaceAll('&', ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
const SERIES_PREFIX =
  /^(scarlet and violet|sword and shield|sun and moon|xy|black and white|heartgold soulsilver|diamond and pearl|mega evolution) /;
const GALLERY_SUFFIXES = ['trainer gallery', 'galarian gallery', 'shiny vault'];
/** "SV Black Star Promos", "Scarlet & Violet Promo Cards" → our "SVP Black Star Promos". */
const PROMO_SETS: Record<string, string> = {
  sv: 'svp',
  'scarlet and violet': 'svp',
  swsh: 'swsh',
  'sword and shield': 'swsh',
  sm: 'sm',
  'sun and moon': 'sm',
  xy: 'xy',
  bw: 'bw',
  'black and white': 'bw',
  me: 'mep',
  'mega evolution': 'mep',
  hgss: 'hgss',
  'heartgold soulsilver': 'hgss',
  dp: 'dp',
  'diamond and pearl': 'dp',
  wizards: 'wizards',
  wotc: 'wizards',
  nintendo: 'nintendo',
};
/**
 * Set IDs a file's set name can mean, in our catalogue's names for that language. Tries the exact name first, then
 * without a code prefix ("SV03: Obsidian Flames"), a "Base Set" suffix or a series prefix ("Scarlet & Violet 151"), and
 * adds the set's gallery subsets, since some trackers file Trainer Gallery cards under the main set.
 */
export function matchImportSets(sets: readonly { id: string; name: string }[], setName: string) {
  const keys = new Map<string, string[]>();
  for (const set of sets) {
    const key = importNameKey(set.name);
    keys.set(key, [...new Set([...(keys.get(key) ?? []), set.id])]);
  }
  if (sets.some((set) => set.id === setName.trim())) return [setName.trim()];
  const base = importNameKey(setName.replace(/^[a-z]{1,5}\d{0,3}[a-z]?\s*:\s*/i, ''));
  const promo = PROMO_SETS[/^(.+?) (?:black star )?promos?(?: cards)?$/.exec(base)?.[1] ?? ''];
  const tries = [
    importNameKey(setName),
    base,
    base.replace(/ base set$/, ''),
    base.replace(SERIES_PREFIX, ''),
    ...(promo ? [`${promo} black star promos`] : []),
  ];
  for (const key of tries) {
    const ids = keys.get(key);
    if (!ids) continue;
    if (ids.length !== 1) return [];
    return [ids[0], ...GALLERY_SUFFIXES.flatMap((suffix) => keys.get(`${key} ${suffix}`) ?? [])];
  }
  return [];
}

function namesAgree(file: string, catalogue: string) {
  const a = importNameKey(file.replace(/\s+-\s+[a-z]*\d+\s*\/\s*[a-z]*\d+$/i, '')),
    b = importNameKey(catalogue);
  return a === b || a.startsWith(`${b} `) || b.startsWith(`${a} `);
}

/**
 * The finish a file row means on this printing. Trackers say "Normal" or "Holofoil" for the standard print, so that
 * becomes the printing's own finish (double rare, illustration rare and so on). Reverse holo must be a real variant.
 * A printing with no recorded variants takes the file's word for it.
 */
function importFinish(card: SearchCardResult, wanted: CardFinish): CardFinish | null {
  const inferred = inferCardFinish(card.rarity, card.variants);
  const finishes = new Set<CardFinish>();
  if (inferred !== 'normal' || card.variants?.normal === true) finishes.add(inferred);
  if (card.variants?.normal) finishes.add('normal');
  if (card.variants?.holo) finishes.add('holo');
  if (card.variants?.reverse) finishes.add('reverse_holo');
  if (card.variants?.jumbo) finishes.add('jumbo');
  const standard = wanted === 'normal' || wanted === 'holo';
  if (standard && !['normal', 'holo', 'reverse_holo', 'jumbo'].includes(inferred)) return inferred;
  if (finishes.has(wanted)) return wanted;
  const prints = [...finishes].filter((f) => f !== 'reverse_holo' && f !== 'jumbo');
  if (standard && prints.length === 1) return prints[0];
  if (!Object.values(card.variants ?? {}).some(Boolean)) return wanted;
  return null;
}

export type ImportCandidate = SearchCardResult & { englishName?: string };
export type ImportResolution = { card: SearchCardResult; finish: CardFinish } | { problem: string };
export function resolveImportLookup(lookup: ImportLookup, candidates: ImportCandidate[]): ImportResolution {
  const matches = candidates.flatMap((card) => {
    if (card.language !== lookup.language) return [];
    if (lookup.cardId && ![card.id, card.canonicalId, ...(card.aliasIds ?? [])].includes(lookup.cardId)) return [];
    if (
      lookup.cardName &&
      !namesAgree(lookup.cardName, card.name) &&
      !(card.englishName && namesAgree(lookup.cardName, card.englishName))
    )
      return [];
    if (lookup.number) {
      const [number, total, extra] = lookup.number.split('/').map((part) => part.trim());
      if (extra !== undefined || normalizeLocalId(number) !== normalizeLocalId(card.localId)) return [];
      // A gallery total such as TG30 isn't the set's printed count, so only a plain number is checked.
      if (total && /^\d+$/.test(total) && card.set.officialCardCount && Number(total) !== card.set.officialCardCount)
        return [];
    }
    const finish = importFinish(card, lookup.finish);
    const { englishName: _english, ...result } = card;
    return finish ? [{ card: result, finish }] : [];
  });
  const unique = [...new Map(matches.map((match) => [match.card.id, match])).values()];
  if (unique.length === 1) return unique[0];
  return {
    problem: unique.length
      ? 'More than one card in our catalogue matches. Add this card by hand.'
      : 'No card in our catalogue matches this name, set, number and print.',
  };
}
