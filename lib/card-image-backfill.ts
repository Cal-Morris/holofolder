import {
  getCardImageBlobPathname,
  parseTcgdexCardImageUrl,
  type CardImageExtension,
  type CardImageMirror,
  type CardImageQuality,
  type TcgdexCardImageRef,
} from './card-image-blob';
import { mapWithConcurrency } from './card-db-sync-concurrency';
import { pickMirrorableSourceImage, type SourceCardImageRef } from './card-image-sources';

export interface MirrorableCard {
  seriesId: string;
  setId: string;
  localId: string;
  /** Languages TCGdex has an image for (tcg_cards.image_languages_json). */
  imageLanguages: string[];
  /** external_ids_json.tcgdex.image, used when the asset manifest has no entry yet (e.g. brand-new sets). */
  tcgdexImageUrl?: string | null;
  /** tcg_cards.external_ids_json: catalog / pokemontcg / TCGplayer fallbacks for cards TCGdex has no image for. */
  externalIds?: unknown;
}

export interface MirrorSetImagesOptions {
  languages: string[];
  qualities: readonly CardImageQuality[];
  extension?: CardImageExtension;
  concurrency?: number;
  /** Epoch ms after which no new uploads are started. */
  deadline?: number;
  /** Stop after this many uploads (across the call). */
  maxUploads?: number;
}

export interface MirrorSetImagesResult {
  setId: string;
  planned: number;
  alreadyMirrored: number;
  uploaded: number;
  failed: number;
  /** True when every planned image for this set is now in the store. */
  complete: boolean;
  /** Fallback-source images (TCGplayer, pokemontcg.io, Scrydex, Limitless) among `planned` / `uploaded`. */
  sourcePlanned?: number;
  sourceUploaded?: number;
  /** Up to three distinct failure messages, so a failing backfill is diagnosable from its response. */
  errors?: string[];
}

const MAX_REPORTED_ERRORS = 3;

/** Every TCGdex image ref we want in Blob for these cards (only languages TCGdex actually has). */
export function planCardImageRefs(
  cards: MirrorableCard[],
  options: Pick<MirrorSetImagesOptions, 'languages' | 'qualities' | 'extension'>,
) {
  const refs: TcgdexCardImageRef[] = [];
  for (const card of cards) {
    const fromImageUrl = card.tcgdexImageUrl ? parseTcgdexCardImageUrl(card.tcgdexImageUrl) : null;
    const available = new Set(card.imageLanguages);
    if (fromImageUrl && fromImageUrl.setId === card.setId && fromImageUrl.localId === card.localId) {
      available.add(fromImageUrl.language);
    }
    for (const language of options.languages) {
      if (!available.has(language)) continue;
      for (const quality of options.qualities) {
        refs.push({
          language,
          seriesId: card.seriesId,
          setId: card.setId,
          localId: card.localId,
          quality,
          extension: options.extension ?? 'webp',
        });
      }
    }
  }
  return refs;
}

/** Fallback-source images the app shows for these cards (one per distinct store key). */
export function planSourceImageRefs(cards: MirrorableCard[]): SourceCardImageRef[] {
  const refs = new Map<string, SourceCardImageRef>();
  for (const card of cards) {
    if (card.externalIds === undefined) continue;
    const ref = pickMirrorableSourceImage({ imageLanguages: card.imageLanguages, externalIds: card.externalIds });
    if (ref && !refs.has(ref.pathname)) refs.set(ref.pathname, ref);
  }
  return [...refs.values()];
}

/** Copies a set's missing images into Blob. Uses one `list` per language to skip existing copies (idempotent / resumable). */
export async function mirrorSetImages(
  mirror: CardImageMirror,
  setId: string,
  cards: MirrorableCard[],
  options: MirrorSetImagesOptions,
): Promise<MirrorSetImagesResult> {
  const setCards = cards.filter((card) => card.setId === setId);
  const refs = planCardImageRefs(setCards, options);
  const sourceRefs = planSourceImageRefs(setCards);
  const existing = new Set<string>();
  const listings = await Promise.all(
    Array.from(new Set(refs.map((ref) => ref.language)), (language) => mirror.listSetPathnames(language, setId)),
  );
  for (const pathnames of listings) for (const pathname of pathnames) existing.add(pathname);

  const missing = refs.filter((ref) => !existing.has(getCardImageBlobPathname(ref)));
  let uploaded = 0;
  let failed = 0;
  let skipped = 0;
  const errors = new Set<string>();
  const maxUploads = options.maxUploads ?? Number.POSITIVE_INFINITY;

  await mapWithConcurrency(missing, options.concurrency ?? 8, async (ref) => {
    if (
      (options.deadline && Date.now() > options.deadline) ||
      uploaded + failed >= maxUploads ||
      mirror.isBlobBlocked()
    ) {
      skipped += 1;
      return;
    }
    try {
      await mirror.ensureMirrored(ref, { assumeMissing: true });
      uploaded += 1;
    } catch (error) {
      failed += 1;
      if (errors.size < MAX_REPORTED_ERRORS) errors.add(error instanceof Error ? error.message : String(error));
    }
  });

  // Source images are spread over per-source prefixes, so each is checked with a HEAD (Class B) before uploading.
  let sourceExisting = 0;
  let sourceUploaded = 0;
  await mapWithConcurrency(sourceRefs, options.concurrency ?? 8, async (ref) => {
    if (
      (options.deadline && Date.now() > options.deadline) ||
      uploaded + failed >= maxUploads ||
      mirror.isBlobBlocked()
    ) {
      skipped += 1;
      return;
    }
    try {
      const result = await mirror.ensureSourceMirrored(ref);
      if (result.uploaded) {
        uploaded += 1;
        sourceUploaded += 1;
      } else {
        sourceExisting += 1;
      }
    } catch (error) {
      failed += 1;
      if (errors.size < MAX_REPORTED_ERRORS)
        errors.add(`${ref.source}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  return {
    setId,
    planned: refs.length + sourceRefs.length,
    alreadyMirrored: refs.length - missing.length + sourceExisting,
    uploaded,
    failed,
    ...(sourceRefs.length ? { sourcePlanned: sourceRefs.length, sourceUploaded } : {}),
    complete: skipped === 0 && failed === 0,
    ...(errors.size > 0 ? { errors: [...errors] } : {}),
  };
}

export function parseImageLanguages(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    : [];
}

export interface CardImageBackfillRequest {
  setIds: string[];
  cursor: string | null;
  languages: string[];
  qualities: CardImageQuality[];
  maxSets: number;
  maxUploads: number;
}

export const DEFAULT_BACKFILL_MAX_SETS = 10;
export const MAX_BACKFILL_MAX_SETS = 50;
export const DEFAULT_BACKFILL_MAX_UPLOADS = 1500;
export const MAX_BACKFILL_MAX_UPLOADS = 5000;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const LANGUAGE_PATTERN = /^[a-z]{2}(?:-[a-z]{2})?$/;

export class InvalidBackfillRequestError extends Error {}

function boundedInt(value: string | null, fallback: number, max: number) {
  if (value == null || value.trim() === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.min(parsed, max) : fallback;
}

function listParam(searchParams: URLSearchParams, name: string) {
  return [
    ...new Set(
      searchParams.getAll(name).flatMap((value) =>
        value.split(',').flatMap((part) => {
          const item = part.trim();
          return item ? [item] : [];
        }),
      ),
    ),
  ];
}

/** `?set=me05,30th` | `?cursor=<setId>` (resume, inclusive) | `?lang=en,fr` | `?quality=high,low` | `?maxSets=10` | `?maxUploads=1500` */
export function parseCardImageBackfillRequest(searchParams: URLSearchParams): CardImageBackfillRequest {
  const setIds = listParam(searchParams, 'set');
  const cursor = searchParams.get('cursor')?.trim() || null;
  const languages = listParam(searchParams, 'lang').map((value) => value.toLowerCase());
  const qualities = listParam(searchParams, 'quality');

  const badIds = [...setIds, ...(cursor ? [cursor] : [])].filter((id) => !ID_PATTERN.test(id));
  if (badIds.length) throw new InvalidBackfillRequestError(`Invalid set id(s): ${badIds.join(', ')}`);
  const badLanguages = languages.filter((language) => !LANGUAGE_PATTERN.test(language));
  if (badLanguages.length) throw new InvalidBackfillRequestError(`Invalid language(s): ${badLanguages.join(', ')}`);
  const badQualities = qualities.filter((quality) => quality !== 'high' && quality !== 'low');
  if (badQualities.length) throw new InvalidBackfillRequestError(`Invalid quality: ${badQualities.join(', ')}`);

  return {
    setIds,
    cursor,
    languages: languages.length ? languages : ['en'],
    qualities: (qualities.length ? qualities : ['high', 'low']) as CardImageQuality[],
    maxSets: boundedInt(searchParams.get('maxSets'), DEFAULT_BACKFILL_MAX_SETS, MAX_BACKFILL_MAX_SETS),
    maxUploads: boundedInt(searchParams.get('maxUploads'), DEFAULT_BACKFILL_MAX_UPLOADS, MAX_BACKFILL_MAX_UPLOADS),
  };
}
