// Turns a photo of one card into the cards it could be: read its name and number on the device, then look them up
// (the card search online, the cards saved on this device offline). Shared by Show mode's Scan and page scan.
import { recognizeCardTextSignalsFromImage } from '@/lib/card-scan-ocr';
import {
  decideScanOutcome,
  isScanReadComplete,
  rankScanCandidates,
  readScannedCard,
  type CardScanOutcome,
  type ScannedCardRead,
} from '@/lib/card-scan-identify';
import {
  confidentPicture,
  decidePictureScan,
  orderByLanguage,
  pictureIndexLanguages,
  type PictureCandidate,
} from '@/lib/card-picture-match';
import type { PictureMatch } from '@/lib/card-picture-match';
import { searchOfflineCards } from '@/lib/offline-card-index';
import { formatPokemonDisplayName, getPokemonById } from '@/lib/pokemon-catalog';
import type { SearchCardResult } from '@/lib/pokemon-card-browse';

export const SCAN_REGIONS = ['name', 'number-left', 'number-right', 'bottom'] as const;
/** Most matches a pocket offers as tap-to-pick choices; more than this opens the picker instead. */
const MAX_POCKET_CHOICES = 6;
/** A pocket still unread by now (reader download or search stuck on dead Wi-Fi) is left for you to choose. */
const POCKET_READ_TIMEOUT_MS = 30_000;

export function lookupPokemon(id: number) {
  const entry = getPokemonById(id);
  return entry ? { id: entry.id, name: formatPokemonDisplayName(entry.name) } : null;
}

export async function searchCards(
  query: string,
  isOnline: boolean,
  getOfflineCards: () => Promise<SearchCardResult[]>,
  includeNonPokemon = false,
) {
  const onDevice = async () => searchOfflineCards(await getOfflineCards().catch(() => []), query);
  if (!query) return { cards: [] as SearchCardResult[], offline: !isOnline };
  if (!isOnline || (typeof navigator !== 'undefined' && navigator.onLine === false))
    return { cards: await onDevice(), offline: true };
  try {
    const response = await fetch(
      `/app/api/tcg-card-search?q=${encodeURIComponent(query.toLowerCase())}${includeNonPokemon ? '&includeNonPokemon=1' : ''}`,
    );
    if (!response.ok) throw new Error(`Card search failed (${response.status})`);
    const payload = (await response.json()) as { cards?: SearchCardResult[] };
    return { cards: Array.isArray(payload?.cards) ? payload.cards : [], offline: false };
  } catch {
    return { cards: await onDevice(), offline: true };
  }
}

/** Card details for picture matches, in match order: the card search online, else the cards saved on this device. */
export async function resolvePictureCandidates(
  matches: readonly PictureMatch[],
  collected: readonly string[],
  getOfflineCards: () => Promise<SearchCardResult[]>,
): Promise<PictureCandidate[]> {
  const ordered = orderByLanguage(
    matches,
    pictureIndexLanguages(collected, [...new Set(matches.map((m) => m.language))]),
  );
  const found = new Map<string, SearchCardResult>();
  const key = (id: string, language: string | undefined) => `${language ?? 'en'}:${id}`;
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('offline');
    const ids = new Map<string, string[]>();
    for (const m of ordered) ids.set(m.language, [...(ids.get(m.language) ?? []), encodeURIComponent(m.id)]);
    const read = (response: Response) => {
      if (!response.ok) throw new Error(`Card lookup failed (${response.status})`);
      return response.json() as Promise<{ cards?: SearchCardResult[] }>;
    };
    const lookups = [...ids].map(([language, list]) =>
      fetch(`/app/api/tcg-card-search?ids=${list.join(',')}&language=${language}`)
        .then(read)
        .then((payload) => {
          for (const card of payload.cards ?? []) found.set(key(card.id, language), card);
        }),
    );
    await Promise.all(lookups);
  } catch {
    for (const card of await getOfflineCards().catch(() => [])) {
      found.set(key(card.id, card.language), card);
      if (!found.has(key(card.id, 'en'))) found.set(key(card.id, 'en'), card);
    }
  }
  return ordered.flatMap((m) => {
    const card = found.get(key(m.id, m.language));
    return card ? [{ card, score: m.score }] : [];
  });
}

/** The card a picture scan agreed on, as a scan outcome (with the Pokémon its deal check opens under). */
export function pictureMatchOutcome(card: SearchCardResult, read: ScannedCardRead): CardScanOutcome {
  const dexId = card.dexIds?.find((id) => id === read.pokemon?.id) ?? card.dexIds?.[0] ?? read.pokemon?.id;
  const pokemon = (dexId !== undefined ? lookupPokemon(dexId) : null) ?? read.pokemon ?? { id: 0, name: card.name };
  return { kind: 'match', card, pokemon, query: read.query };
}

/**
 * Reads one pocket's crop from a page photo. `candidates` is the one clear match, a confident picture suggestion
 * ahead of its alternatives, or a handful of likely cards to tap, or empty; `query` is what was read (a name, maybe a
 * number) so the picker can open already searched.
 * Never throws: a pocket that can't be read is simply left for you to choose.
 */
export async function identifyPocketCrop(
  crop: string,
  getOfflineCards: () => Promise<SearchCardResult[]>,
  {
    recognize = recognizeCardTextSignalsFromImage,
    matchPicture = noPicture,
    collected = ['en'] as readonly string[],
    timeoutMs = POCKET_READ_TIMEOUT_MS,
  }: PocketReadOptions = {},
): Promise<PocketRead> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unread = new Promise<PocketRead>((resolve) => {
    timer = setTimeout(() => resolve({ candidates: [], query: '' }), timeoutMs);
  });
  try {
    return await Promise.race([readPocket(crop, getOfflineCards, recognize, matchPicture, collected), unread]);
  } finally {
    clearTimeout(timer);
  }
}

/** `suggested`: `candidates[0]` is a confident picture match to pre-select, the rest are the other picture choices. */
export interface PocketRead {
  candidates: SearchCardResult[];
  query: string;
  suggested?: boolean;
}

export interface PocketReadOptions {
  recognize?: typeof recognizeCardTextSignalsFromImage;
  /** The picture scanner (lib/card-picture-scanner.ts matchCardPicture); null when it isn't on this device. */
  matchPicture?: (crop: string) => Promise<{ matches: PictureMatch[] } | null>;
  /** Card languages the user collects, whose picture matches come first. */
  collected?: readonly string[];
  timeoutMs?: number;
}

const noPicture = async () => null;

async function readPocket(
  crop: string,
  getOfflineCards: () => Promise<SearchCardResult[]>,
  recognize: typeof recognizeCardTextSignalsFromImage,
  matchPicture: NonNullable<PocketReadOptions['matchPicture']>,
  collected: readonly string[],
): Promise<PocketRead> {
  try {
    // The picture and the text are read in separate workers, so they run side by side.
    const [signals, picture] = await Promise.all([
      recognize(crop, { regions: SCAN_REGIONS, isEnough: isScanReadComplete }),
      matchPicture(crop).catch(() => null),
    ]);
    const read = readScannedCard(signals);
    if (picture?.matches.length) {
      const decision = decidePictureScan(
        await resolvePictureCandidates(picture.matches, collected, getOfflineCards),
        read,
        confidentPicture(picture.matches),
      );
      const query = read.pokemon?.name ?? read.query;
      if (decision.kind === 'match') return { candidates: [decision.card], query };
      if (decision.kind === 'suggest') return { candidates: decision.candidates, query, suggested: true };
      if (decision.candidates.length) return { candidates: decision.candidates, query };
    }
    if (!read.query) return { candidates: [], query: '' };
    const { cards } = await searchCards(read.query, true, getOfflineCards, true);
    const outcome = decideScanOutcome(cards, read, lookupPokemon);
    const query = read.pokemon?.name ?? read.query;
    if (outcome.kind === 'match') return { candidates: [outcome.card], query };
    const ranked = rankScanCandidates(cards, read).map((entry) => entry.card);
    // A lone name-only hit isn't sure enough to pre-pick (the review picks a single candidate for you).
    return {
      candidates: ranked.length > 1 && ranked.length <= MAX_POCKET_CHOICES ? ranked : [],
      query,
    };
  } catch (error) {
    console.info('[holofolder] Pocket not read:', error);
    return { candidates: [], query: '' };
  }
}
