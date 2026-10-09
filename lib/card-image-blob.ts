import { buildTcgdexAssetImageUrl, TCGDEX_ASSET_HOST } from "./tcgdex-shared"
import { BlobNotFoundError, head as blobHead, list as blobList, put as blobPut } from "@vercel/blob"

/**
 * Mirror of TCGdex card images in Vercel Blob.
 *
 * Only `assets.tcgdex.net` card images are ever copied (never Scrydex / pokemontcg.io / Limitless / TCGplayer).
 * Blob is the primary source once an image is mirrored; TCGdex is only contacted when a copy is missing.
 * Without BLOB_READ_WRITE_TOKEN (or with CARD_IMAGE_BLOB=0) everything falls back to live TCGdex.
 */

export { TCGDEX_ASSET_HOST }
export const CARD_IMAGE_BLOB_PREFIX = "cards"
export const CARD_IMAGE_QUALITIES = ["high", "low"] as const
export const CARD_IMAGE_EXTENSIONS = ["webp", "png", "jpg"] as const
export const CARD_IMAGE_CACHE_SECONDS = 60 * 60 * 24 * 365
const MAX_IMAGE_BYTES = 8 * 1024 * 1024

export type CardImageQuality = (typeof CARD_IMAGE_QUALITIES)[number]
export type CardImageExtension = (typeof CARD_IMAGE_EXTENSIONS)[number]

export interface TcgdexCardImageRef {
  language: string
  seriesId: string
  setId: string
  localId: string
  quality: CardImageQuality
  extension: CardImageExtension
}

const SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._\-!+%]{0,63}$/

const CONTENT_TYPES: Record<CardImageExtension, string> = {
  webp: "image/webp",
  png: "image/png",
  jpg: "image/jpeg",
}

/** Parses `https://assets.tcgdex.net/<lang>/<series>/<set>/<localId>/<quality>.<ext>`; anything else returns null. */
export function parseTcgdexCardImageUrl(value: string | URL): TcgdexCardImageRef | null {
  let url: URL
  try {
    url = typeof value === "string" ? new URL(value) : value
  } catch {
    return null
  }

  if (url.protocol !== "https:" || url.hostname !== TCGDEX_ASSET_HOST || url.search || url.hash) {
    return null
  }

  const segments = url.pathname.split("/").slice(1)
  if (segments.length !== 5) return null

  const [language, seriesId, setId, localId, file] = segments.map((segment) => {
    try {
      return decodeURIComponent(segment)
    } catch {
      return ""
    }
  })
  const fileMatch = /^(high|low)\.(webp|png|jpg)$/.exec(file)
  if (!fileMatch) return null
  if (![language, seriesId, setId, localId].every((segment) => SEGMENT_PATTERN.test(segment) && !segment.includes(".."))) {
    return null
  }

  return {
    language,
    seriesId,
    setId,
    localId,
    quality: fileMatch[1] as CardImageQuality,
    extension: fileMatch[2] as CardImageExtension,
  }
}

export function buildTcgdexCardImageUrl(ref: TcgdexCardImageRef) {
  return buildTcgdexAssetImageUrl(ref.language, ref.seriesId, ref.setId, ref.localId, ref.quality, ref.extension)
}

/** Deterministic Blob pathname: `cards/<lang>/<setId>/<localId>/<quality>.<ext>`. */
export function getCardImageBlobPathname(ref: Pick<TcgdexCardImageRef, "language" | "setId" | "localId" | "quality" | "extension">) {
  return `${CARD_IMAGE_BLOB_PREFIX}/${[ref.language, ref.setId, ref.localId].map(encodeURIComponent).join("/")}/${ref.quality}.${ref.extension}`
}

export function getCardImageBlobSetPrefix(language: string, setId: string) {
  return `${CARD_IMAGE_BLOB_PREFIX}/${encodeURIComponent(language)}/${encodeURIComponent(setId)}/`
}

export function getCardImageContentType(extension: CardImageExtension) {
  return CONTENT_TYPES[extension]
}

export function isCardImageBlobEnabled(env: Record<string, string | undefined> = process.env) {
  return Boolean(env.BLOB_READ_WRITE_TOKEN?.trim()) && env.CARD_IMAGE_BLOB !== "0"
}

export interface CardImageBlobDeps {
  head: (pathname: string) => Promise<{ url: string } | null>
  put: (pathname: string, body: ArrayBuffer, contentType: string) => Promise<{ url: string }>
  list: (prefix: string) => Promise<string[]>
  fetch: typeof fetch
  logger?: (message: string) => void
}

export interface LoadedCardImage {
  body: ArrayBuffer
  contentType: string
  source: "blob" | "tcgdex"
  /** Upload to run after responding (only when the image came from TCGdex and Blob is enabled). */
  pendingUpload?: () => Promise<void>
}

function isBlobNotFound(error: unknown) {
  return error instanceof BlobNotFoundError || (error instanceof Error && error.name === "BlobNotFoundError")
}

export function createVercelBlobDeps(token = process.env.BLOB_READ_WRITE_TOKEN): CardImageBlobDeps {
  return {
    async head(pathname) {
      try {
        const result = await blobHead(pathname, { token })
        return { url: result.url }
      } catch (error) {
        if (isBlobNotFound(error)) return null
        throw error
      }
    },
    async put(pathname, body, contentType) {
      const result = await blobPut(pathname, body, {
        access: "public",
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType,
        cacheControlMaxAge: CARD_IMAGE_CACHE_SECONDS,
        token,
      })
      return { url: result.url }
    },
    async list(prefix) {
      const pathnames: string[] = []
      let cursor: string | undefined
      do {
        const page = await blobList({ prefix, cursor, limit: 1000, token })
        for (const blob of page.blobs) pathnames.push(blob.pathname)
        cursor = page.hasMore ? page.cursor : undefined
      } while (cursor)
      return pathnames
    },
    fetch: (...args) => fetch(...args),
  }
}

async function readImageResponse(response: Response) {
  const contentType = response.headers.get("content-type") || ""
  if (!contentType.startsWith("image/")) {
    throw new Error(`Unexpected content type ${contentType || "(none)"}`)
  }
  const body = await response.arrayBuffer()
  if (body.byteLength === 0 || body.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(`Unexpected image size ${body.byteLength}`)
  }
  return { body, contentType }
}

/**
 * Creates a mirror bound to a set of Blob/fetch dependencies. Keeps an in-process cache of known blob URLs and
 * de-duplicates concurrent uploads of the same pathname. Cross-instance races are handled by `allowOverwrite: false`
 * plus a follow-up `head()`: whoever loses the race just reuses the existing blob.
 */
export function createCardImageMirror(deps: CardImageBlobDeps) {
  const knownUrls = new Map<string, string>()
  const inflight = new Map<string, Promise<string>>()
  let blobBaseUrl: string | null = null

  function remember(pathname: string, url: string) {
    knownUrls.set(pathname, url)
    if (!blobBaseUrl && url.endsWith(pathname)) {
      blobBaseUrl = url.slice(0, url.length - pathname.length)
    }
  }

  async function findExisting(pathname: string): Promise<string | null> {
    const known = knownUrls.get(pathname)
    if (known) return known
    const result = await deps.head(pathname)
    if (result) remember(pathname, result.url)
    return result?.url ?? null
  }

  /** Runs `task` at most once at a time per pathname in this instance. */
  function runOnce(pathname: string, task: () => Promise<string>): Promise<string> {
    const existing = inflight.get(pathname)
    if (existing) return existing
    const promise = task().finally(() => inflight.delete(pathname))
    inflight.set(pathname, promise)
    return promise
  }

  async function putOrReuse(pathname: string, body: ArrayBuffer, contentType: string) {
    try {
      const result = await deps.put(pathname, body, contentType)
      remember(pathname, result.url)
      return result.url
    } catch (error) {
      // Most likely another instance uploaded it first (allowOverwrite: false). Reuse it if so.
      const url = await findExisting(pathname).catch(() => null)
      if (url) return url
      throw error
    }
  }

  function upload(pathname: string, body: ArrayBuffer, contentType: string): Promise<string> {
    return runOnce(pathname, () => putOrReuse(pathname, body, contentType))
  }

  async function fetchFromTcgdex(ref: TcgdexCardImageRef) {
    const response = await deps.fetch(buildTcgdexCardImageUrl(ref), {
      headers: { Accept: "image/avif,image/webp,image/*;q=0.8" },
    })
    if (!response.ok) {
      throw Object.assign(new Error(`TCGdex image fetch failed with ${response.status}`), { status: response.status })
    }
    return readImageResponse(response)
  }

  /** Copies one TCGdex image to Blob unless it is already there. Returns the blob URL and whether it uploaded. */
  async function ensureMirrored(ref: TcgdexCardImageRef, options: { assumeMissing?: boolean } = {}) {
    const pathname = getCardImageBlobPathname(ref)
    if (!options.assumeMissing) {
      const existing = await findExisting(pathname)
      if (existing) return { url: existing, uploaded: false }
    }
    let uploadedHere = false
    const url = await runOnce(pathname, async () => {
      const image = await fetchFromTcgdex(ref)
      uploadedHere = true
      return putOrReuse(pathname, image.body, getCardImageContentType(ref.extension))
    })
    return { url, uploaded: uploadedHere }
  }

  /**
   * Loads an image for the proxy: Blob first, TCGdex only when the copy is missing (in which case the bytes are
   * also scheduled for upload so the next request is served from Blob).
   */
  async function loadImage(ref: TcgdexCardImageRef): Promise<LoadedCardImage> {
    const pathname = getCardImageBlobPathname(ref)
    const candidateUrl = knownUrls.get(pathname) ?? (blobBaseUrl ? `${blobBaseUrl}${pathname}` : null)

    try {
      const blobUrl = candidateUrl ?? (await findExisting(pathname))
      if (blobUrl) {
        const response = await deps.fetch(blobUrl)
        if (response.ok) {
          remember(pathname, blobUrl)
          const image = await readImageResponse(response)
          return { ...image, source: "blob" }
        }
        knownUrls.delete(pathname)
      }
    } catch (error) {
      deps.logger?.(`Blob lookup failed for ${pathname}: ${error instanceof Error ? error.message : String(error)}`)
    }

    const image = await fetchFromTcgdex(ref)
    return {
      ...image,
      source: "tcgdex",
      pendingUpload: async () => {
        try {
          await upload(pathname, image.body, getCardImageContentType(ref.extension))
        } catch (error) {
          deps.logger?.(`Blob upload failed for ${pathname}: ${error instanceof Error ? error.message : String(error)}`)
        }
      },
    }
  }

  /** Existing blob pathnames under `cards/<lang>/<setId>/` (one list call per set). */
  async function listSetPathnames(language: string, setId: string) {
    return new Set(await deps.list(getCardImageBlobSetPrefix(language, setId)))
  }

  return { ensureMirrored, loadImage, listSetPathnames, upload, fetchFromTcgdex }
}

export type CardImageMirror = ReturnType<typeof createCardImageMirror>

let defaultMirror: CardImageMirror | null = null

export function getDefaultCardImageMirror() {
  if (!isCardImageBlobEnabled()) return null
  defaultMirror ??= createCardImageMirror({
    ...createVercelBlobDeps(),
    logger: (message) => console.warn(`[card-image-blob] ${message}`),
  })
  return defaultMirror
}
