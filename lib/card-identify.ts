/**
 * Identifying a card from a photo on the server (POST /cards/identify, the identify_card MCP tool and the app's online
 * scans): request limits, the caller's name and number hints, and the response shape. Pure: the model run and the
 * search are in lib/server/card-identify.ts. The decision rule is #768's (lib/card-picture-match.ts): the picture
 * narrows the field, and only a number and set total that agree with one of the top five settle it.
 */
import type { ScannedCardRead, ScannedNumber } from '@/lib/card-scan-identify';
import {
  decidePictureScan,
  pictureIndexLanguages,
  pictureReadAgreement,
  PICTURE_SUGGEST_MARGIN,
  PICTURE_SUGGEST_SIMILARITY,
  type PictureAgreementCard,
} from '@/lib/card-picture-match';

/** Image size after base64 decoding. Vercel caps request bodies at 4.5 MB, and base64 adds a third. */
export const IDENTIFY_MAX_IMAGE_BYTES = 3_000_000;
/** The JSON body (REST) or tool arguments (MCP): the base64 image plus a little room for the hints. */
export const IDENTIFY_MAX_REQUEST_BYTES = 4_100_000;
export const IDENTIFY_DEFAULT_LIMIT = 5;
export const IDENTIFY_MAX_LIMIT = 20;
/** Picture matches the server always fetches, so hints can agree with any of the top five whatever `limit` is. */
export const IDENTIFY_SEARCH_K = 20;
/** Requests per minute: per API key or MCP connection, and per IP for the app's same-origin route. */
export const IDENTIFY_RATE_LIMITS = { developer: 20, app: 60 } as const;
/** Languages with their own picture index; every other card language shares the English print's picture. */
export const IDENTIFY_INDEX_LANGUAGES = ['en', 'ja'] as const;

/**
 * Picture-only confidence, measured on 277 binder pockets (2026-11-13): offering the top match at similarity ≥ 0.78
 * and ≥ 0.03 ahead of the second was right 92% of the time, ≥ 0.76 86%. Below that it's a list to choose from.
 */
export const PICTURE_MEDIUM_MEASURED = { similarity: 0.76, margin: 0.03, precision: 0.86, recall: 0.38 } as const;

export type IdentifyConfidence = 'confirmed' | 'high' | 'medium' | 'low' | 'none';

/** The image bytes from base64 (a `data:image/…;base64,` prefix is allowed), or an error message. */
export function decodeIdentifyImage(value: string): Uint8Array | string {
  const base64 = value.replace(/^data:image\/[\w.+-]+;base64,/, '').replace(/\s+/g, '');
  if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length % 4 === 1)
    return 'image must be a base64-encoded JPEG, PNG or WebP.';
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.byteLength > IDENTIFY_MAX_IMAGE_BYTES)
    return `image must be at most ${IDENTIFY_MAX_IMAGE_BYTES / 1_000_000} MB; resize it to about 1000 px first.`;
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** "25", "025/102", "TG05/TG30": the collector number and, after a slash, the set total. */
export function parseNumberHint(value: string | undefined): ScannedNumber | null {
  const [number, total] = (value ?? '')
    .trim()
    .split('/', 2)
    .map((part) => part.trim());
  if (!number) return null;
  return { number, total: total || null };
}

/** The caller's hints as a scan read, so the app's decision rule applies to them unchanged. */
export function hintRead(hints: { name?: string; number?: string }): ScannedCardRead {
  const name = hints.name?.trim();
  return {
    // No dex id: a hint names the card, and the rule then compares its words with the card name.
    pokemon: name ? { id: 0, name } : null,
    number: parseNumberHint(hints.number),
    query: '',
    signals: null,
  };
}

/** The picture index languages to search for a card language; all of them when none is given. */
export function identifyLanguages(language: string | undefined) {
  return language ? pictureIndexLanguages([language], IDENTIFY_INDEX_LANGUAGES) : null;
}

export function pictureConfidence(scores: readonly number[]): Exclude<IdentifyConfidence, 'confirmed'> {
  if (!scores.length) return 'none';
  const margin = scores[0] - (scores[1] ?? 0);
  for (const [label, rule] of [
    ['high', { similarity: PICTURE_SUGGEST_SIMILARITY, margin: PICTURE_SUGGEST_MARGIN }],
    ['medium', PICTURE_MEDIUM_MEASURED],
  ] as const)
    if (scores[0] >= rule.similarity && margin >= rule.margin) return label;
  return 'low';
}

export interface IdentifyCandidate<T> {
  similarity: number;
  card: T;
  /** Present when hints were sent: which agree with this card (null for a hint that wasn't sent). */
  agrees?: { name: boolean | null; number: boolean | null; setTotal: boolean | null };
  /** The one card the hints settle under the decision rule (confidence "confirmed"). */
  confirmed?: true;
}

/**
 * The response from picture matches (best first): the first `limit` candidates with their similarity, which hints
 * agree with each, and a confidence label. "confirmed" means the number and set total agree
 * with one of the top five pictures and no other agrees as well; otherwise the label is the picture's alone. Never reorders or drops a
 * candidate for the caller.
 */
export function shapeIdentifyResult<T extends PictureAgreementCard>(
  matches: ReadonlyArray<{ card: T; similarity: number }>,
  hints: { name?: string; number?: string },
  limit = IDENTIFY_DEFAULT_LIMIT,
) {
  const read = hintRead(hints);
  const hinted = !!(read.pokemon || read.number);
  const decision = hinted
    ? decidePictureScan(
        matches.map(({ card, similarity }) => ({ card, score: similarity })),
        read,
      )
    : null;
  const confirmed = decision?.kind === 'match' ? decision.card : null;
  // The confirmed card is always included, even past a small `limit`.
  const shown = Math.max(limit, matches.findIndex(({ card }) => card === confirmed) + 1);
  const candidates = matches.slice(0, shown).map(({ card, similarity }): IdentifyCandidate<T> => {
    const agreement = pictureReadAgreement(card, read);
    return {
      similarity: Number(similarity.toFixed(4)),
      card,
      ...(hinted
        ? {
            agrees: {
              name: read.pokemon ? agreement.name : null,
              number: read.number ? agreement.number : null,
              setTotal: read.number?.total ? agreement.total : null,
            },
          }
        : {}),
      ...(card === confirmed ? { confirmed: true as const } : {}),
    };
  });
  const confidence: IdentifyConfidence = confirmed
    ? 'confirmed'
    : pictureConfidence(matches.map((match) => match.similarity));
  return { confidence, candidates };
}
