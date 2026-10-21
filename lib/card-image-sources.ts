import { readCatalogMetadata } from "./card-catalog"
import { pickTcgdexImageFromExternalIds } from "./tcgdex-shared"

/**
 * Fallback card image sources (used when TCGdex has no image for a card).
 *
 * Every image from these hosts is copied into the card image store (R2 or Blob) under a deterministic key and served
 * from there by `/api/card-image-proxy`; the origin is only contacted when the copy is missing. Copies are stored as
 * WebP (see `lib/card-image-transform.ts`), so each source image costs one small object.
 */
export const CARD_IMAGE_SOURCE_PREFIX = "cards/src"

export type CardImageSource = "tcgplayer" | "pokemontcg" | "scrydex" | "limitless"

export const CARD_IMAGE_SOURCE_HOSTS: Readonly<Record<string, CardImageSource>> = {
  "product-images.tcgplayer.com": "tcgplayer",
  "images.pokemontcg.io": "pokemontcg",
  "images.scrydex.com": "scrydex",
  "limitlesstcg.nyc3.cdn.digitaloceanspaces.com": "limitless",
}

/** Source priority when several are known for a card (best scans first). */
export const CARD_IMAGE_SOURCE_PRIORITY: readonly CardImageSource[] = ["limitless", "scrydex", "pokemontcg", "tcgplayer"]

export interface SourceCardImageRef {
  source: CardImageSource
  /** Canonical origin URL (what the catalog stores and the client requests through the proxy). */
  url: string
  /** Store key: `cards/src/<source>/<…>.webp`. */
  pathname: string
}

const PATH_RULES: Record<CardImageSource, { pattern: RegExp; key: (match: RegExpExecArray) => string }> = {
  // https://product-images.tcgplayer.com/<productId>.jpg
  tcgplayer: { pattern: /^\/([1-9]\d{0,9})\.jpg$/, key: (m) => m[1] },
  // https://images.pokemontcg.io/<setId>/<number>[_hires].png ("!" is a collector number in Unown sets; keys stay plain ASCII)
  pokemontcg: { pattern: /^\/([a-z0-9][a-z0-9.-]{0,31})\/([A-Za-z0-9!][A-Za-z0-9_!-]{0,47})\.png$/, key: (m) => `${m[1]}/${m[2].replaceAll("!", "exclamation")}` },
  // https://images.scrydex.com/pokemon/<cardId>/<large|medium|small>
  scrydex: { pattern: /^\/pokemon\/([A-Za-z0-9][A-Za-z0-9._-]{0,63})\/(large|medium|small)$/, key: (m) => `${m[1]}/${m[2]}` },
  // https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/<SET>/<SET>_<NNN>_<R>_<LANG>[_LG|_SM].png
  limitless: { pattern: /^\/tpci\/([A-Z0-9]{1,10})\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})\.(png|jpg|webp)$/, key: (m) => `${m[1]}/${m[2]}` },
}

export function getCardImageSourceForHost(hostname: string): CardImageSource | null {
  return Object.hasOwn(CARD_IMAGE_SOURCE_HOSTS, hostname) ? CARD_IMAGE_SOURCE_HOSTS[hostname] : null
}

/** Parses an image URL from one of the fallback sources; anything else (or any odd path) returns null. */
export function parseSourceCardImageUrl(value: string | URL): SourceCardImageRef | null {
  let url: URL
  try {
    url = typeof value === "string" ? new URL(value) : value
  } catch {
    return null
  }
  if (url.protocol !== "https:" || url.search || url.hash || url.port || url.username || url.password) return null
  const source = getCardImageSourceForHost(url.hostname)
  if (!source) return null
  const rule = PATH_RULES[source]
  const match = rule.pattern.exec(url.pathname)
  if (!match || url.pathname.includes("..")) return null
  return { source, url: url.toString(), pathname: `${CARD_IMAGE_SOURCE_PREFIX}/${source}/${rule.key(match)}.webp` }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function normalizeProductId(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return String(value)
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return value.trim()
  return null
}

function pickTcgplayerProductId(tcgdex: Record<string, unknown> | null) {
  if (!tcgdex) return null
  const direct = normalizeProductId(asRecord(tcgdex.thirdParty)?.tcgplayer)
  if (direct) return direct
  if (!Array.isArray(tcgdex.variantThirdParty)) return null
  for (const candidate of tcgdex.variantThirdParty) {
    const productId = normalizeProductId(asRecord(candidate)?.tcgplayer)
    if (productId) return productId
  }
  return null
}

/**
 * Best image URL for a card without a TCGdex asset-manifest image: the reviewed catalog image, then the TCGdex
 * image recorded on the card, then pokemontcg.io / Scrydex, then the TCGplayer product image.
 */
export function pickExternalCardImageUrl(value: unknown) {
  const externalIds = asRecord(value)
  if (!externalIds) return undefined

  const reviewedImage = readCatalogMetadata(externalIds).image
  if (reviewedImage) return reviewedImage

  const tcgdexImage = pickTcgdexImageFromExternalIds(externalIds)
  if (tcgdexImage) return tcgdexImage

  const pokemonTcg = asRecord(externalIds.pokemon_tcg)
  for (const key of ["imageLarge", "imageSmall"] as const) {
    const candidate = pokemonTcg?.[key]
    if (typeof candidate === "string" && candidate.length > 0) return candidate
  }

  const tcgplayerProductId = pickTcgplayerProductId(asRecord(externalIds.tcgdex))
  return tcgplayerProductId ? `https://product-images.tcgplayer.com/${encodeURIComponent(tcgplayerProductId)}.jpg` : undefined
}

/**
 * The fallback-source image the app shows for this card, if any (null when it shows a TCGdex image or nothing).
 * Mirrors the read path in `lib/tcg-mirror.ts`: the catalog image wins, then TCGdex languages, then the fallbacks.
 */
export function pickMirrorableSourceImage(card: { imageLanguages: readonly string[]; externalIds: unknown }): SourceCardImageRef | null {
  const reviewed = readCatalogMetadata(card.externalIds).image
  const url = reviewed ?? (card.imageLanguages.length ? undefined : pickExternalCardImageUrl(card.externalIds))
  return url ? parseSourceCardImageUrl(url) : null
}
