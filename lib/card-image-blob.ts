import { buildTcgdexAssetImageUrl, TCGDEX_ASSET_HOST } from "./tcgdex-shared"
import {
  BlobAccessError,
  BlobNotFoundError,
  BlobServiceRateLimited,
  BlobStoreNotFoundError,
  BlobStoreSuspendedError,
  head as blobHead,
  list as blobList,
  put as blobPut,
} from "@vercel/blob"

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

/** How long to skip Blob entirely after it reports the store as blocked/suspended or the token as rejected. */
export const BLOB_UNAVAILABLE_COOLDOWN_MS = 60 * 60 * 1000
/** Fallback cooldown after a rate-limit response without Retry-After. */
export const BLOB_RATE_LIMIT_COOLDOWN_MS = 60 * 1000

/**
 * Blob refused the request in a way that will keep failing for a while (store blocked/suspended over plan limits,
 * missing store, rejected token, rate limit). The mirror trips a cooldown and serves TCGdex directly meanwhile.
 */
export class BlobStoreUnavailableError extends Error {
  readonly cooldownMs: number

  constructor(message: string, cooldownMs = BLOB_UNAVAILABLE_COOLDOWN_MS) {
    super(message)
    this.name = "BlobStoreUnavailableError"
    this.cooldownMs = cooldownMs
  }
}

/** Maps @vercel/blob SDK errors that mean "the store is unusable for now" to BlobStoreUnavailableError. */
export function toBlobStoreUnavailableError(error: unknown): BlobStoreUnavailableError | null {
  if (error instanceof BlobStoreUnavailableError) return error
  if (error instanceof BlobStoreSuspendedError || error instanceof BlobStoreNotFoundError || error instanceof BlobAccessError) {
    return new BlobStoreUnavailableError(error.message)
  }
  if (error instanceof BlobServiceRateLimited) {
    const retryAfterMs = (error.retryAfter ?? 0) * 1000
    return new BlobStoreUnavailableError(error.message, retryAfterMs > 0 ? retryAfterMs : BLOB_RATE_LIMIT_COOLDOWN_MS)
  }
  return null
}

/** Status codes on a public blob URL that mean the store (not the single object) is unavailable. */
function blobResponseCooldownMs(status: number) {
  if (status === 403) return BLOB_UNAVAILABLE_COOLDOWN_MS // "Your store is blocked"
  if (status === 429) return BLOB_RATE_LIMIT_COOLDOWN_MS
  return null
}

export interface CardImageBlobDeps {
  head: (pathname: string) => Promise<{ url: string } | null>
  put: (pathname: string, body: ArrayBuffer, contentType: string) => Promise<{ url: string }>
  list: (prefix: string) => Promise<string[]>
  fetch: typeof fetch
  logger?: (message: string) => void
  /** Clock for the blocked-store cooldown (tests). */
  now?: () => number
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

async function withUnavailableMapping<T>(task: () => Promise<T>): Promise<T> {
  try {
    return await task()
  } catch (error) {
    throw toBlobStoreUnavailableError(error) ?? error
  }
}

export function createVercelBlobDeps(token = process.env.BLOB_READ_WRITE_TOKEN): CardImageBlobDeps {
  const deps = createRawVercelBlobDeps(token)
  return {
    ...deps,
    head: (pathname) => withUnavailableMapping(() => deps.head(pathname)),
    put: (pathname, body, contentType) => withUnavailableMapping(() => deps.put(pathname, body, contentType)),
    list: (prefix) => withUnavailableMapping(() => deps.list(prefix)),
  }
}

function createRawVercelBlobDeps(token: string | undefined): CardImageBlobDeps {
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
  let blockedUntil = 0
  const now = deps.now ?? Date.now

  function isBlobBlocked() {
    return now() < blockedUntil
  }

  function tripBlocked(reason: string, cooldownMs: number) {
    const until = now() + cooldownMs
    if (until > blockedUntil) {
      blockedUntil = until
      deps.logger?.(`Blob unavailable (${reason}); serving TCGdex directly for ${Math.round(cooldownMs / 1000)}s`)
    }
  }

  /** Trips the cooldown for store-level failures and rethrows everything. */
  function noteBlobError(error: unknown): never {
    const unavailable = toBlobStoreUnavailableError(error)
    if (unavailable) tripBlocked(unavailable.message, unavailable.cooldownMs)
    throw error
  }

  function assertBlobAvailable() {
    if (isBlobBlocked()) {
      throw new BlobStoreUnavailableError("Blob store is in its blocked cooldown", blockedUntil - now())
    }
  }

  function remember(pathname: string, url: string) {
    knownUrls.set(pathname, url)
    if (!blobBaseUrl && url.endsWith(pathname)) {
      blobBaseUrl = url.slice(0, url.length - pathname.length)
    }
  }

  async function findExisting(pathname: string): Promise<string | null> {
    const known = knownUrls.get(pathname)
    if (known) return known
    assertBlobAvailable()
    const result = await deps.head(pathname).catch(noteBlobError)
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
    assertBlobAvailable()
    try {
      const result = await deps.put(pathname, body, contentType)
      remember(pathname, result.url)
      return result.url
    } catch (error) {
      if (toBlobStoreUnavailableError(error)) noteBlobError(error)
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
    assertBlobAvailable()
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
    if (isBlobBlocked()) {
      // A blocked store must not add latency: no Blob lookup and no upload attempt until the cooldown ends.
      return { ...(await fetchFromTcgdex(ref)), source: "tcgdex" }
    }

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
        const cooldownMs = blobResponseCooldownMs(response.status)
        if (cooldownMs != null) {
          tripBlocked(`blob URL returned ${response.status}`, cooldownMs)
        } else {
          knownUrls.delete(pathname)
        }
      }
    } catch (error) {
      deps.logger?.(`Blob lookup failed for ${pathname}: ${error instanceof Error ? error.message : String(error)}`)
    }

    const image = await fetchFromTcgdex(ref)
    if (isBlobBlocked()) {
      return { ...image, source: "tcgdex" }
    }
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
    assertBlobAvailable()
    return new Set(await deps.list(getCardImageBlobSetPrefix(language, setId)).catch(noteBlobError))
  }

  return { ensureMirrored, loadImage, listSetPathnames, upload, fetchFromTcgdex, isBlobBlocked }
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
