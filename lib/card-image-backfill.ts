import {
  getCardImageBlobPathname,
  parseTcgdexCardImageUrl,
  type CardImageExtension,
  type CardImageMirror,
  type CardImageQuality,
  type TcgdexCardImageRef,
} from "./card-image-blob"
import { mapWithConcurrency } from "./card-db-sync-concurrency"

export interface MirrorableCard {
  seriesId: string
  setId: string
  localId: string
  /** Languages TCGdex has an image for (tcg_cards.image_languages_json). */
  imageLanguages: string[]
  /** external_ids_json.tcgdex.image, used when the asset manifest has no entry yet (e.g. brand-new sets). */
  tcgdexImageUrl?: string | null
}

export interface MirrorSetImagesOptions {
  languages: string[]
  qualities: readonly CardImageQuality[]
  extension?: CardImageExtension
  concurrency?: number
  /** Epoch ms after which no new uploads are started. */
  deadline?: number
  /** Stop after this many uploads (across the call). */
  maxUploads?: number
}

export interface MirrorSetImagesResult {
  setId: string
  planned: number
  alreadyMirrored: number
  uploaded: number
  failed: number
  /** True when every planned image for this set is now in Blob. */
  complete: boolean
}

/** Every TCGdex image ref we want in Blob for these cards (only languages TCGdex actually has). */
export function planCardImageRefs(cards: MirrorableCard[], options: Pick<MirrorSetImagesOptions, "languages" | "qualities" | "extension">) {
  const refs: TcgdexCardImageRef[] = []
  for (const card of cards) {
    const fromImageUrl = card.tcgdexImageUrl ? parseTcgdexCardImageUrl(card.tcgdexImageUrl) : null
    const available = new Set(card.imageLanguages)
    if (fromImageUrl && fromImageUrl.setId === card.setId && fromImageUrl.localId === card.localId) {
      available.add(fromImageUrl.language)
    }
    for (const language of options.languages) {
      if (!available.has(language)) continue
      for (const quality of options.qualities) {
        refs.push({
          language,
          seriesId: card.seriesId,
          setId: card.setId,
          localId: card.localId,
          quality,
          extension: options.extension ?? "webp",
        })
      }
    }
  }
  return refs
}

/** Copies a set's missing images into Blob. Uses one `list` per language to skip existing copies (idempotent / resumable). */
export async function mirrorSetImages(
  mirror: CardImageMirror,
  setId: string,
  cards: MirrorableCard[],
  options: MirrorSetImagesOptions,
): Promise<MirrorSetImagesResult> {
  const refs = planCardImageRefs(cards.filter((card) => card.setId === setId), options)
  const existing = new Set<string>()
  for (const language of new Set(refs.map((ref) => ref.language))) {
    for (const pathname of await mirror.listSetPathnames(language, setId)) existing.add(pathname)
  }

  const missing = refs.filter((ref) => !existing.has(getCardImageBlobPathname(ref)))
  let uploaded = 0
  let failed = 0
  let skipped = 0
  const maxUploads = options.maxUploads ?? Number.POSITIVE_INFINITY

  await mapWithConcurrency(missing, options.concurrency ?? 8, async (ref) => {
    if ((options.deadline && Date.now() > options.deadline) || uploaded + failed >= maxUploads || mirror.isBlobBlocked()) {
      skipped += 1
      return
    }
    try {
      await mirror.ensureMirrored(ref, { assumeMissing: true })
      uploaded += 1
    } catch {
      failed += 1
    }
  })

  return {
    setId,
    planned: refs.length,
    alreadyMirrored: refs.length - missing.length,
    uploaded,
    failed,
    complete: skipped === 0 && failed === 0,
  }
}

export function parseImageLanguages(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0) : []
}

export interface CardImageBackfillRequest {
  setIds: string[]
  cursor: string | null
  languages: string[]
  qualities: CardImageQuality[]
  maxSets: number
  maxUploads: number
}

export const DEFAULT_BACKFILL_MAX_SETS = 10
export const MAX_BACKFILL_MAX_SETS = 50
export const DEFAULT_BACKFILL_MAX_UPLOADS = 1500
export const MAX_BACKFILL_MAX_UPLOADS = 5000
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/
const LANGUAGE_PATTERN = /^[a-z]{2}(?:-[a-z]{2})?$/

export class InvalidBackfillRequestError extends Error {}

function boundedInt(value: string | null, fallback: number, max: number) {
  if (value == null || value.trim() === "") return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed >= 1 ? Math.min(parsed, max) : fallback
}

function listParam(searchParams: URLSearchParams, name: string) {
  return [...new Set(searchParams.getAll(name).flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean))]
}

/** `?set=me05,30th` | `?cursor=<setId>` (resume, inclusive) | `?lang=en,fr` | `?quality=high,low` | `?maxSets=10` | `?maxUploads=1500` */
export function parseCardImageBackfillRequest(searchParams: URLSearchParams): CardImageBackfillRequest {
  const setIds = listParam(searchParams, "set")
  const cursor = searchParams.get("cursor")?.trim() || null
  const languages = listParam(searchParams, "lang").map((value) => value.toLowerCase())
  const qualities = listParam(searchParams, "quality")

  const badIds = [...setIds, ...(cursor ? [cursor] : [])].filter((id) => !ID_PATTERN.test(id))
  if (badIds.length) throw new InvalidBackfillRequestError(`Invalid set id(s): ${badIds.join(", ")}`)
  const badLanguages = languages.filter((language) => !LANGUAGE_PATTERN.test(language))
  if (badLanguages.length) throw new InvalidBackfillRequestError(`Invalid language(s): ${badLanguages.join(", ")}`)
  const badQualities = qualities.filter((quality) => quality !== "high" && quality !== "low")
  if (badQualities.length) throw new InvalidBackfillRequestError(`Invalid quality: ${badQualities.join(", ")}`)

  return {
    setIds,
    cursor,
    languages: languages.length ? languages : ["en"],
    qualities: (qualities.length ? qualities : ["high", "low"]) as CardImageQuality[],
    maxSets: boundedInt(searchParams.get("maxSets"), DEFAULT_BACKFILL_MAX_SETS, MAX_BACKFILL_MAX_SETS),
    maxUploads: boundedInt(searchParams.get("maxUploads"), DEFAULT_BACKFILL_MAX_UPLOADS, MAX_BACKFILL_MAX_UPLOADS),
  }
}
