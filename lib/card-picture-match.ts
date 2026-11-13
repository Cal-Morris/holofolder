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
 * Why the picture alone never fills a card in (277 hand-labelled binder pockets, 2026-11-13, see the card-recognition
 * plan's "Decision rule, measured"): cards missing from the gallery still score about 0.70, close to the 0.77 median
 * of right answers, and the first picture was right for only 79 of 194 identifiable pockets. So a card is offered
 * outright only when the read agrees with one of the top `PICTURE_AGREE_TOP` picture matches, and the agreement has to
 * include the full collector number (number and set total). Measured on the same pockets with this matcher
 * (2026-11-13): letting a name alone agree offered 6 cards, all wrong (a same-named card or reprint in the top five);
 * a bare number offered 2, both wrong (noise read as "2/3" or "1/100"). Requiring number and total offered none
 * wrongly. The right card was among the five picture choices for 113 of 194 identifiable pockets.
 *
 * Below that, a sure top picture is pre-selected as a suggestion you can change or skip, when it scores at least
 * `PICTURE_SUGGEST_SIMILARITY` and leads the next picture by `PICTURE_SUGGEST_MARGIN`. The plan's step-0 run put
 * ≥ 0.78 and ≥ 0.03 ahead at 26 offered, 24 right (92%), and ≥ 0.76 at 37, 32 right (86%). Replayed through this
 * code on the shipped index's reads (2026-11-13): ≥ 0.78 pre-selects 29, 26 right (90%); ≥ 0.76 pre-selects 40, 37
 * right (92%), once nine pockets labelled "not in the gallery" were checked by eye (newer promos and Delta Reign cards
 * the index has since gained). The 3 wrong at either gate: two same-artwork reprints (a Base Set card matched to its
 * First Partner or Legendary Collection reprint) and one crop holding half a card. Missing cards (~0.70) stay below.
 */
export const PICTURE_SUGGEST_SIMILARITY = 0.78;
export const PICTURE_SUGGEST_MARGIN = 0.03;

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

/** What the decision rule reads from a card (a search result, or a catalog card from the developer API). */
export type PictureAgreementCard = Pick<SearchCardResult, 'id' | 'name' | 'localId'> & {
  dexIds?: readonly number[];
  set: { officialCardCount?: number | null };
};

export interface PictureCandidate<T extends PictureAgreementCard = SearchCardResult> {
  card: T;
  score: number;
}

export type PictureScanDecision<T extends PictureAgreementCard = SearchCardResult> =
  | { kind: 'match'; card: T }
  /** The picture alone cleared the suggestion gate: `candidates[0]` is pre-selected, the rest stay one tap away. */
  | { kind: 'suggest'; card: T; candidates: T[] }
  | { kind: 'choose'; candidates: T[] };

/**
 * The best raw picture match (`findPictureMatches` output, best first), when it is sure and far enough ahead of the
 * next to pre-select. Judged before cards are looked up, so a runner-up that couldn't be resolved still counts.
 */
export function confidentPicture(matches: readonly PictureMatch[]) {
  const [best, next] = matches;
  if (!best || best.score < PICTURE_SUGGEST_SIMILARITY) return null;
  return !next || best.score - next.score >= PICTURE_SUGGEST_MARGIN ? best : null;
}

/** Which parts of a read (or a caller's hints) agree with a card; `score` ranks the agreeing ones. */
export function pictureReadAgreement(card: PictureAgreementCard, read: ScannedCardRead) {
  const name =
    !!read.pokemon &&
    (!!card.dexIds?.includes(read.pokemon.id) ||
      scanWords(read.pokemon.name).every((word) => scanWords(card.name).includes(word)));
  const number = !!read.number && normalizeLocalId(card.localId) === normalizeLocalId(read.number.number);
  const total = number && !!read.number?.total && card.set.officialCardCount === Number(read.number.total);
  return { name, number, total, score: (name ? 2 : 0) + (number ? 2 : 0) + (total ? 1 : 0), fullNumber: total };
}

/**
 * What a scan offers from its picture matches (best first, collected languages first) and its text read. A card is
 * offered only when its collector number and set total (and the name, when read) agree with one of the top five
 * pictures and no other of the five agrees as well. Otherwise the `confident` top picture (`confidentPicture`), once looked up, is
 * suggested ahead of the other choices, or up to five pictures (the agreeing ones first) become tap-to-pick choices.
 * Never one choice on its own: the review pre-selects a lone candidate.
 */
export function decidePictureScan<T extends PictureAgreementCard = SearchCardResult>(
  pictures: readonly PictureCandidate<T>[],
  read: ScannedCardRead,
  confident: PictureMatch | null = null,
): PictureScanDecision<T> {
  const top = pictures.slice(0, PICTURE_AGREE_TOP).map(({ card }) => ({ card, ...pictureReadAgreement(card, read) }));
  const best = Math.max(0, ...top.map((entry) => entry.score));
  const agreeing = top.filter((entry) => entry.score === best && best > 0);
  if (agreeing.length === 1 && agreeing[0].fullNumber) return { kind: 'match', card: agreeing[0].card };
  const ordered = [...top.filter((entry) => entry.score > 0), ...top.filter((entry) => entry.score === 0)];
  const candidates = ordered.slice(0, PICTURE_CHOICES).map((entry) => entry.card);
  const sure = confident && pictures.find((p) => p.card.id === confident.id && p.score === confident.score)?.card;
  if (sure)
    return {
      kind: 'suggest',
      card: sure,
      candidates: [sure, ...candidates.filter((c) => c !== sure)].slice(0, PICTURE_CHOICES),
    };
  return { kind: 'choose', candidates: candidates.length > 1 ? candidates : [] };
}
