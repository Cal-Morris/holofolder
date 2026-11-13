/**
 * Show mode's "Scan": turn what the camera read off one card (its name line and collector number)
 * into a card search, and decide whether the best hit is certain enough to open its deal check.
 * Pure helpers, shared by components/quick-card-scanner.tsx and unit tests.
 */
import { scoreCardTextSignals, type CardTextSignals } from '@/lib/card-scan-text';
import { normalizeLocalId, type SearchCardResult } from '@/lib/pokemon-card-browse';
import { POKEMON_CATALOG, formatPokemonDisplayName, type PokemonEntry } from '@/lib/pokemon-catalog';

export interface ScannedPokemon {
  id: number;
  /** Display name, e.g. "Mr. Mime". */
  name: string;
}

export interface ScannedNumber {
  /** Collector number as printed, without leading zeros ("6", "tg05"). */
  number: string;
  /** The set total after the slash, when it was read ("165"). */
  total: string | null;
}

export interface ScannedCardRead {
  pokemon: ScannedPokemon | null;
  number: ScannedNumber | null;
  /** What to type into search: "Charizard 6/165", "Charizard", "6/165" or "". */
  query: string;
  signals: CardTextSignals | null;
}

export type CardScanOutcome =
  | { kind: 'match'; card: SearchCardResult; pokemon: ScannedPokemon; query: string }
  | { kind: 'choose'; query: string }
  | { kind: 'unread'; query: string };

interface NameIndexEntry {
  id: number;
  name: string;
  tokens: string[];
}

let nameIndex: NameIndexEntry[] | null = null;
let nameIndexSource: readonly PokemonEntry[] | null = null;

export function scanWords(text: string) {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

function getNameIndex(catalog: readonly PokemonEntry[]) {
  if (nameIndex && nameIndexSource === catalog) return nameIndex;
  const seen = new Set<string>();
  nameIndex = [];
  for (const entry of catalog) {
    const name = formatPokemonDisplayName(entry.name);
    const tokens = scanWords(name);
    const key = tokens.join(' ');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    nameIndex.push({ id: entry.id, name, tokens });
  }
  nameIndexSource = catalog;
  return nameIndex;
}

/** Levenshtein distance, stopping early above `max`. */
function editDistanceWithin(a: string, b: string, max: number) {
  if (Math.abs(a.length - b.length) > max) return false;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      rowMin = Math.min(rowMin, current[j]);
    }
    if (rowMin > max) return false;
    previous = current;
  }
  return previous[b.length] <= max;
}

/**
 * The Pokémon named on the card: the first catalog name in the text (the name line is read first),
 * ignoring "Evolves from X". Long single-word names tolerate one misread letter ("Charizavd").
 */
export function findPokemonNameInText(
  text: string,
  catalog: readonly PokemonEntry[] = POKEMON_CATALOG,
): ScannedPokemon | null {
  const tokens = scanWords(text);
  if (tokens.length === 0) return null;
  const index = getNameIndex(catalog);
  let best: { at: number; exact: boolean; length: number; entry: NameIndexEntry } | null = null;
  for (const entry of index) {
    const length = entry.tokens.length;
    for (let at = 0; at + length <= tokens.length; at += 1) {
      if (best && at > best.at) break;
      if (tokens[at - 1] === 'from') continue;
      let exact = true;
      let matches = true;
      for (let offset = 0; offset < length; offset += 1) {
        const token = tokens[at + offset];
        const want = entry.tokens[offset];
        if (token === want) continue;
        if (length === 1 && want.length >= 5 && editDistanceWithin(token, want, 1)) {
          exact = false;
          continue;
        }
        matches = false;
        break;
      }
      if (!matches) continue;
      const better =
        !best ||
        at < best.at ||
        (at === best.at && exact && !best.exact) ||
        (at === best.at && exact === best.exact && length > best.length);
      if (better) best = { at, exact, length, entry };
      break;
    }
  }
  return best ? { id: best.entry.id, name: best.entry.name } : null;
}

/** The collector number, preferring a full "6/165" over a bare number. */
export function pickCollectorNumber(signals: CardTextSignals | null | undefined): ScannedNumber | null {
  if (!signals) return null;
  const full = signals.collectorNumbers.find((value) => value.includes('/'));
  if (full) {
    const [number, total] = full.split('/');
    if (number) return { number: normalizeLocalId(number), total: total ? normalizeLocalId(total) : null };
  }
  const prefixed = signals.collectorNumbers.find((value) => /^[a-z]+\d+$/.test(value));
  return prefixed ? { number: prefixed, total: null } : null;
}

export function readScannedCard(signals: CardTextSignals | null | undefined): ScannedCardRead {
  const pokemon = signals ? findPokemonNameInText(signals.rawText || signals.normalizedText) : null;
  const number = pickCollectorNumber(signals);
  const numberText = number ? (number.total ? `${number.number}/${number.total}` : number.number) : '';
  const query = [pokemon?.name ?? '', numberText].filter(Boolean).join(' ');
  return { pokemon, number, query, signals: signals ?? null };
}

/** Enough read to stop sampling frames: a name and a full collector number. */
export function isScanReadComplete(signals: CardTextSignals | null | undefined) {
  const read = readScannedCard(signals);
  return Boolean(read.pokemon && read.number?.total);
}

interface RankedScanCandidate {
  card: SearchCardResult;
  nameHit: boolean;
  numberHit: boolean;
  totalHit: boolean;
  score: number;
}

export function rankScanCandidates(cards: readonly SearchCardResult[], read: ScannedCardRead): RankedScanCandidate[] {
  const nameTokens = read.pokemon ? scanWords(read.pokemon.name) : [];
  const wantNumber = read.number ? normalizeLocalId(read.number.number) : null;
  const wantTotal = read.number?.total ? Number.parseInt(read.number.total, 10) : null;
  return cards
    .flatMap((card) => {
      const cardWords = scanWords(card.name);
      const nameHit =
        Boolean(read.pokemon) &&
        (card.dexIds?.includes(read.pokemon!.id) || nameTokens.every((token) => cardWords.includes(token)));
      const numberHit = wantNumber !== null && normalizeLocalId(card.localId) === wantNumber;
      const totalHit = numberHit && wantTotal !== null && card.set.officialCardCount === wantTotal;
      const score =
        (nameHit ? 2 : 0) +
        (numberHit ? 2 : 0) +
        (totalHit ? 1 : 0) +
        scoreCardTextSignals(read.signals, {
          name: card.name,
          localId: card.localId,
          set: card.set,
          rarity: card.rarity,
        });
      return nameHit || numberHit ? [{ card, nameHit, numberHit, totalHit, score }] : [];
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Opens a card only when there's no doubt: its name and number both match, and either the set total
 * matches too or it's the only card with that name and number. Anything less lands in the typed search.
 */
export function decideScanOutcome(
  cards: readonly SearchCardResult[],
  read: ScannedCardRead,
  lookupPokemon: (id: number) => ScannedPokemon | null,
): CardScanOutcome {
  if (!read.pokemon && !read.number) return { kind: 'unread', query: read.query };
  const ranked = rankScanCandidates(cards, read);
  const strong = ranked.filter((entry) => entry.nameHit && entry.numberHit);
  const exact = strong.filter((entry) => entry.totalHit);
  const pick = exact.length === 1 ? exact[0] : exact.length === 0 && strong.length === 1 ? strong[0] : null;
  if (!pick) return { kind: ranked.length > 0 || read.pokemon ? 'choose' : 'unread', query: read.query };
  const dexId = pick.card.dexIds?.find((id) => id === read.pokemon?.id) ?? pick.card.dexIds?.[0] ?? read.pokemon?.id;
  const pokemon = (dexId !== undefined ? lookupPokemon(dexId) : null) ??
    read.pokemon ?? { id: 0, name: pick.card.name };
  return { kind: 'match', card: pick.card, pokemon, query: read.query };
}
