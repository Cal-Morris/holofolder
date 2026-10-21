import { getCardImageSourceForHost } from "@/lib/card-image-sources"

const CARD_IMAGE_PROXY_PATH = "/api/card-image-proxy"

function isCardImageHost(hostname: string) {
  return hostname === "assets.tcgdex.net" || hostname.endsWith(".tcgdex.net") || getCardImageSourceForHost(hostname) !== null
}

/**
 * The URL a card image is rendered from. Card images from TCGdex and the fallback sources are always
 * served through the image proxy, which reads them from our image store (and copies them there on a
 * miss), so the browser never loads them from a third-party host. Same-origin, data: and blob: URLs
 * and images from other hosts are returned unchanged.
 */
export function toCardImageSrc(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed || trimmed === "null" || trimmed === "undefined") return null
  if (trimmed.startsWith("/") || trimmed.startsWith("data:") || trimmed.startsWith("blob:")) return trimmed
  try {
    const url = new URL(trimmed)
    if (url.protocol !== "https:" && url.protocol !== "http:") return null
    return isCardImageHost(url.hostname) ? `${CARD_IMAGE_PROXY_PATH}?url=${encodeURIComponent(url.toString())}` : trimmed
  } catch {
    return null
  }
}
