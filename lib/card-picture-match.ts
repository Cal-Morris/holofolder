/**
 * Picture matching for card scans: compare a crop's fingerprint (lib/card-picture-fingerprint.ts) with every card in
 * the index (lib/card-assets/fingerprints.ts) and decide what a scan may offer. Pure logic, no model and no I/O.
 */
import { scanWords, type ScannedCardRead } from '@/lib/card-scan-identify';
import { normalizeLocalId, type SearchCardResult } from '@/lib/pokemon-card-browse';

import { PICTURE_DIM } from '@/lib/card-picture-fingerprint';

/** How many picture matches a scan keeps, and how many of those the read text may agree with. */
export const PICTURE_TOP_K = 20;
export const PICTURE_AGREE_TOP = 5;
/** Most picture candidates a scan offers as tap-to-pick choices. */
export const PICTURE_CHOICES = 5;

/**
 * Why the picture alone never picks a card (277 hand-labelled binder pockets, 2026-11-13, see the card-recognition
 * plan's "Decision rule, measured"): cards missing from the gallery still score about 0.70, close to the 0.77 median
 * of right answers. Offering the top match at similarity ≥ 0.76 and ≥ 0.03 ahead of the second was only 86%
 * precise (catching 38% of identifiable pockets), and ≥ 0.78 only 92% (29%). So a card is offered only when the
 * read agrees with one of the top `PICTURE_AGREE_TOP` picture matches, and the agreement has to include the full
 * collector number (number and set total). Measured on the same pockets with this matcher (2026-11-13): letting a
 * name alone agree offered 6 cards, all wrong (a same-named card or reprint in the top five); a bare number offered
 * 2, both wrong (noise read as "2/3" or "1/100"). Requiring number and total offered none wrongly. The right card
 * was among the five picture choices for 113 of 194 identifiable pockets.
 */
export const PICTURE_ALONE_MEASURED = { similarity: 0.78, margin: 0.03, precision: 0.92, recall: 0.29 } as const;

/** One language's fingerprints as published: N × 384 int8 rows, row i is ids[i]. */
export interface PictureIndex {
  language: string;
  ids: readonly string[];
  vectors: Int8Array;
  /** Each row's length, so a dot product becomes a cosine (rows are quantised with different scales). */
  norms: Float32Array;
}

export function buildPictureIndex(language: string, vectors: ArrayBuffer | Uint8Array, ids: readonly string[]) {
  const bytes = vectors instanceof Uint8Array ? vectors : new Uint8Array(vectors);
  if (bytes.byteLength !== ids.length * PICTURE_DIM) throw new Error(`${language}: fingerprints don't match the ids`);
  const rows = new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const norms = new Float32Array(ids.length);
  for (let row = 0; row < ids.length; row++) {
    let sum = 0;
    const start = row * PICTURE_DIM;
    for (let index = 0; index < PICTURE_DIM; index++) sum += rows[start + index] * rows[start + index];
    norms[row] = Math.sqrt(sum) || 1;
  }
  return { language, ids, vectors: rows, norms } satisfies PictureIndex;
}

export interface PictureMatch {
  id: string;
  language: string;
  score: number;
}

/**
 * The `k` rows most like `query` (an L2-normalised fingerprint), by cosine, best first. A plain loop over every
 * row: 26k cards is about 10M multiply-adds, a few milliseconds, so no search structure is needed.
 */
export function findPictureMatches(query: Float32Array, indexes: readonly PictureIndex[], k = PICTURE_TOP_K) {
  const top: PictureMatch[] = [];
  for (const index of indexes) {
    const { vectors, norms, ids } = index;
    for (let row = 0; row < ids.length; row++) {
      let dot = 0;
      const start = row * PICTURE_DIM;
      for (let i = 0; i < PICTURE_DIM; i++) dot += query[i] * vectors[start + i];
      const score = dot / norms[row];
      if (top.length === k && score <= top[k - 1].score) continue;
      let at = top.length;
      while (at > 0 && top[at - 1].score < score) at--;
      top.splice(at, 0, { id: ids[row], language: index.language, score });
      if (top.length > k) top.pop();
    }
  }
  return top;
}

/** Keeps the user's collected languages first (each part still best first). */
export function orderByLanguage<T extends { language: string }>(matches: readonly T[], languages: readonly string[]) {
  const wanted = new Set(languages);
  return [...matches.filter((m) => wanted.has(m.language)), ...matches.filter((m) => !wanted.has(m.language))];
}

/**
 * The index languages to download for the card languages someone collects. Only Japanese and Korean prints have
 * their own artwork scans; every other language shares the English print's picture (and TCGdex card id).
 */
export function pictureIndexLanguages(cardLanguages: Iterable<string>, available: readonly string[]) {
  const has = new Set(available);
  const wanted = new Set<string>();
  for (const language of cardLanguages) wanted.add(has.has(language) ? language : 'en');
  if (!wanted.size) wanted.add('en');
  return available.filter((language) => wanted.has(language));
}

/**
 * Card languages in a collection (owned and wanted) plus the preferred one, always with English: most prints share the
 * English artwork, and a signed-in (native) binder's legacy rows are empty, so the collection alone can miss them.
 */
export function collectedCardLanguages(
  collection: readonly { card_language?: string; wanted_cards?: readonly { card_language?: string }[] }[],
  preferred?: string | null,
) {
  const languages = new Set<string>(['en', ...(preferred ? [preferred] : [])]);
  for (const item of collection) {
    if (item.card_language) languages.add(item.card_language);
    for (const card of item.wanted_cards ?? []) if (card.card_language) languages.add(card.card_language);
  }
  return [...languages];
}

export interface PictureCandidate {
  card: SearchCardResult;
  score: number;
}

export type PictureScanDecision =
  { kind: 'match'; card: SearchCardResult } | { kind: 'choose'; candidates: SearchCardResult[] };

function agreement(card: SearchCardResult, read: ScannedCardRead) {
  const name =
    !!read.pokemon &&
    (card.dexIds?.includes(read.pokemon.id) ||
      scanWords(read.pokemon.name).every((word) => scanWords(card.name).includes(word)));
  const number = !!read.number && normalizeLocalId(card.localId) === normalizeLocalId(read.number.number);
  const total = number && !!read.number?.total && card.set.officialCardCount === Number(read.number.total);
  return { score: (name ? 2 : 0) + (number ? 2 : 0) + (total ? 1 : 0), fullNumber: total };
}

/**
 * What a scan offers from its picture matches (best first, collected languages first) and its text read. A card is
 * offered only when its collector number and set total (and the name, when read) agree with one of the top five
 * pictures and no other of the five agrees as well; otherwise up to five pictures (the agreeing ones first) become tap-to-pick choices. Never one choice on its own:
 * the review pre-selects a lone candidate, and the picture alone must never pick.
 */
export function decidePictureScan(pictures: readonly PictureCandidate[], read: ScannedCardRead): PictureScanDecision {
  const top = pictures.slice(0, PICTURE_AGREE_TOP).map(({ card }) => ({ card, ...agreement(card, read) }));
  const best = Math.max(0, ...top.map((entry) => entry.score));
  const agreeing = top.filter((entry) => entry.score === best && best > 0);
  if (agreeing.length === 1 && agreeing[0].fullNumber) return { kind: 'match', card: agreeing[0].card };
  const ordered = [...top.filter((entry) => entry.score > 0), ...top.filter((entry) => entry.score === 0)];
  const candidates = ordered.slice(0, PICTURE_CHOICES).map((entry) => entry.card);
  return { kind: 'choose', candidates: candidates.length > 1 ? candidates : [] };
}
