import { AwsClient } from "aws4fetch"
import { BLOB_RATE_LIMIT_COOLDOWN_MS, BlobStoreUnavailableError, CARD_IMAGE_CACHE_SECONDS, type CardImageBlobDeps } from "./card-image-blob"

/**
 * Cloudflare R2 backend for the card image mirror, via R2's S3-compatible API (signed with aws4fetch).
 *
 * Objects use the same deterministic keys as the Blob backend (`cards/<lang>/<setId>/<localId>/<quality>.<ext>`).
 * Reads go through R2_PUBLIC_BASE_URL (r2.dev or a custom domain) when set, so they are plain cacheable GETs;
 * without it, reads are signed GetObject calls against the S3 endpoint.
 */

export interface R2Config {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  /** e.g. https://img.cal.gg/ or https://pub-xxxx.r2.dev/ (normalised to end with "/"). */
  publicBaseUrl: string | null
}

const R2_ENV_NAMES = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"] as const
const ACCOUNT_ID_PATTERN = /^[a-f0-9]{32}$/i
const BUCKET_PATTERN = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/

/** Reads the R2 settings from env; null when any required value is missing or malformed. */
export function getR2Config(env: Record<string, string | undefined> = process.env): R2Config | null {
  const values = R2_ENV_NAMES.map((name) => env[name]?.trim() ?? "")
  if (values.some((value) => !value)) return null
  const [accountId, accessKeyId, secretAccessKey, bucket] = values
  if (!ACCOUNT_ID_PATTERN.test(accountId) || !BUCKET_PATTERN.test(bucket)) return null
  return { accountId, accessKeyId, secretAccessKey, bucket, publicBaseUrl: normalizePublicBaseUrl(env.R2_PUBLIC_BASE_URL) }
}

export function normalizePublicBaseUrl(value: string | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  try {
    const url = new URL(trimmed)
    if (url.protocol !== "https:" || url.search || url.hash) return null
    return url.toString().replace(/\/?$/, "/")
  } catch {
    return null
  }
}

export function getR2BucketEndpoint(config: Pick<R2Config, "accountId" | "bucket">) {
  return `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}/`
}

/**
 * Mirror pathnames are already URL-safe (each segment encodeURIComponent'd by getCardImageBlobPathname), so they
 * are used in URLs as-is. R2 stores the decoded key, so listed keys are re-encoded the same way to compare.
 */
function keyToPathname(key: string) {
  return key.split("/").map(encodeURIComponent).join("/")
}

/** Errors that mean the bucket/credentials are unusable for now trip the mirror's cooldown. */
function r2Error(operation: string, status: number, code: string | null = null) {
  const detail = code ? `${status} ${code}` : String(status)
  if (status === 401 || status === 403) {
    return new BlobStoreUnavailableError(`R2 ${operation} was refused (${detail})`)
  }
  if (status === 429 || status === 503) {
    return new BlobStoreUnavailableError(`R2 ${operation} was throttled (${detail})`, BLOB_RATE_LIMIT_COOLDOWN_MS)
  }
  return Object.assign(new Error(`R2 ${operation} failed with ${detail}`), { status })
}

/** Builds the error for a failed S3 response, including R2's `<Code>` (never echoes request data). */
async function r2ResponseError(operation: string, response: Response) {
  let code: string | null = null
  try {
    code = /<Code>([A-Za-z0-9.]{1,64})<\/Code>/.exec(await response.text())?.[1] ?? null
  } catch {
    code = null
  }
  return r2Error(operation, response.status, code)
}

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
}

/** Minimal ListObjectsV2 parser: keys plus the continuation token. */
export function parseListObjectsV2(xml: string) {
  const keys = [...xml.matchAll(/<Key>([\s\S]*?)<\/Key>/g)].map((match) => decodeXml(match[1]))
  const truncated = /<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(xml)
  const token = /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1]
  return { keys, nextContinuationToken: truncated && token ? decodeXml(token) : null }
}

export function createR2Deps(config: R2Config, options: { fetch?: typeof fetch; onObjects?: (keys:string[])=>Promise<void> } = {}): CardImageBlobDeps & { baseUrl: string } {
  const fetchImpl = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args))
  const endpoint = getR2BucketEndpoint(config)
  const baseUrl = config.publicBaseUrl ?? endpoint
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: "s3",
    region: "auto",
    retries: 0,
  })

  async function signedFetch(url: string, init: RequestInit = {}) {
    const signed = await client.sign(url, init)
    // Pass url + init (not the signed Request): Next's patched fetch re-streams Request bodies without a
    // Content-Length, which R2 rejects with 411 MissingContentLength. The original ArrayBuffer body keeps it.
    return fetchImpl(signed.url, { method: signed.method, headers: signed.headers, body: init.body })
  }

  return {
    baseUrl,
    async head(pathname) {
      const response = await signedFetch(`${endpoint}${pathname}`, { method: "HEAD" })
      if (response.status === 404) return null
      if (!response.ok) throw await r2ResponseError("HEAD", response)
      await options.onObjects?.([pathname])
      const metadata = Object.fromEntries([...response.headers].flatMap(([name, value]) => name.startsWith("x-amz-meta-") ? [[name.slice(11), value]] : []))
      return { url: `${baseUrl}${pathname}`, metadata }
    },
    async put(pathname, body, contentType, putOptions) {
      const response = await signedFetch(`${endpoint}${pathname}`, {
        method: "PUT",
        body,
        headers: {
          "content-type": contentType,
          "cache-control": `public, max-age=${CARD_IMAGE_CACHE_SECONDS}, immutable`,
          // Never overwrite (unless refreshing): concurrent writers get 412 and reuse the existing object.
          ...(putOptions?.overwrite ? {} : { "if-none-match": "*" }),
          ...Object.fromEntries(Object.entries(putOptions?.metadata ?? {}).map(([key, value]) => [`x-amz-meta-${key}`, value])),
        },
      })
      if (!response.ok) throw await r2ResponseError("PUT", response)
      await options.onObjects?.([pathname])
      return { url: `${baseUrl}${pathname}` }
    },
    async list(prefix) {
      const keys: string[] = []
      let token: string | null = null
      do {
        const query = new URLSearchParams({ "list-type": "2", prefix, "max-keys": "1000" })
        if (token) query.set("continuation-token", token)
        const response = await signedFetch(`${endpoint}?${query}`)
        if (!response.ok) throw await r2ResponseError("LIST", response)
        const page = parseListObjectsV2(await response.text())
        const pageKeys=page.keys.map(keyToPathname)
        await options.onObjects?.(pageKeys)
        keys.push(...pageKeys)
        token = page.nextContinuationToken
      } while (token)
      return keys
    },
    // Reads of private S3-endpoint URLs must be signed; public URLs and TCGdex are plain fetches.
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
      return url.startsWith(endpoint) ? signedFetch(url, init) : fetchImpl(input, init)
    }) as typeof fetch,
  }
}
