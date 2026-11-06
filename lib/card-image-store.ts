import { createCardImageMirror, createVercelBlobDeps, isCardImageBlobEnabled, type CardImageMirror } from "./card-image-blob"
import { createR2Deps, getR2Config } from "./card-image-r2"
import { convertSourceImageToWebp } from "./card-image-transform"

/**
 * Selects the storage backend for the card image mirror (TCGdex and fallback-source images).
 *
 *   CARD_IMAGE_STORE=r2    Cloudflare R2 (needs R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET;
 *                          R2_PUBLIC_BASE_URL recommended)
 *   CARD_IMAGE_STORE=blob  Vercel Blob (needs BLOB_READ_WRITE_TOKEN; CARD_IMAGE_BLOB=0 still turns it off)
 *   CARD_IMAGE_STORE=off   no mirror, TCGdex live
 *   unset / unknown        no mirror; inherited credentials never select a backend
 *
 * A selected backend with missing or invalid credentials resolves to "off" (TCGdex live), never to another backend.
 */
export type CardImageStoreKind = "r2" | "blob" | "off"

export function getCardImageStoreKind(env: Record<string, string | undefined> = process.env): CardImageStoreKind {
  const requested = env.CARD_IMAGE_STORE?.trim().toLowerCase()
  if (requested === "r2") return getR2Config(env) ? "r2" : "off"
  if (requested === "off" || requested === "0" || requested === "none") return "off"
  return requested === "blob" && isCardImageBlobEnabled(env) ? "blob" : "off"
}

export function createCardImageMirrorFromEnv(env: Record<string, string | undefined> = process.env): CardImageMirror | null {
  const kind = getCardImageStoreKind(env)
  const logger = (message: string) => console.warn(`[card-image-${kind}] ${message}`)
  if (kind === "r2") {
    const config = getR2Config(env)
    return config ? createCardImageMirror({ ...createR2Deps(config), logger, transformSourceImage: convertSourceImageToWebp }) : null
  }
  if (kind === "blob") {
    return createCardImageMirror({ ...createVercelBlobDeps(env.BLOB_READ_WRITE_TOKEN), logger, transformSourceImage: convertSourceImageToWebp })
  }
  return null
}

let defaultMirror: CardImageMirror | null | undefined

/** Process-wide mirror (keeps the known-URL cache and blocked-store cooldown across requests). */
export function getDefaultCardImageMirror(): CardImageMirror | null {
  if (defaultMirror === undefined) defaultMirror = createCardImageMirrorFromEnv()
  return defaultMirror
}

export const CARD_IMAGE_STORE_NOT_CONFIGURED_MESSAGE =
  "Card image mirror is not configured. Set CARD_IMAGE_STORE=r2 with R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET and R2_PUBLIC_BASE_URL (or connect a Vercel Blob store)."
