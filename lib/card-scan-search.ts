// Turns a photo of one card into the cards it could be: read its name and number on the device, then look them up
// (the card search online, the cards saved on this device offline). Shared by Show mode's Scan and page scan.
import { recognizeCardTextSignalsFromImage } from '@/lib/card-scan-ocr';
import { decideScanOutcome, isScanReadComplete, rankScanCandidates, readScannedCard } from '@/lib/card-scan-identify';
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

/**
 * Reads one pocket's crop from a page photo. `candidates` is the one clear match, or a handful of likely cards to
 * tap, or empty; `query` is what was read (a name, maybe a number) so the picker can open already searched.
 * Never throws: a pocket that can't be read is simply left for you to choose.
 */
export async function identifyPocketCrop(
  crop: string,
  getOfflineCards: () => Promise<SearchCardResult[]>,
  { recognize = recognizeCardTextSignalsFromImage, timeoutMs = POCKET_READ_TIMEOUT_MS } = {},
): Promise<{ candidates: SearchCardResult[]; query: string }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unread = new Promise<{ candidates: SearchCardResult[]; query: string }>((resolve) => {
    timer = setTimeout(() => resolve({ candidates: [], query: '' }), timeoutMs);
  });
  try {
    return await Promise.race([readPocket(crop, getOfflineCards, recognize), unread]);
  } finally {
    clearTimeout(timer);
  }
}

async function readPocket(
  crop: string,
  getOfflineCards: () => Promise<SearchCardResult[]>,
  recognize: typeof recognizeCardTextSignalsFromImage,
): Promise<{ candidates: SearchCardResult[]; query: string }> {
  try {
    const read = readScannedCard(await recognize(crop, { regions: SCAN_REGIONS, isEnough: isScanReadComplete }));
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
