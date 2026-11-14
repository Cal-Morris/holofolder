import { appPath } from '@/lib/app-path';
import { parseTcgdexCardImageUrl, getCardImageBlobPathname, currentCardImageKey } from '@/lib/tcgdex-card-image';
import {
  parseSourceCardImageUrl,
  isCardImageSourceUrl,
  getSourceImageLowPathname,
  pickCardImageUrl,
} from '@/lib/card-image-sources';

export const PUBLIC_CARD_IMAGE_BASE = 'https://assets.holofolder.com/';

const CARD_IMAGE_PROXY_PATH = '/app/api/card-image-proxy';

function isCardImageUrl(url: URL) {
  return url.hostname === 'assets.tcgdex.net' || url.hostname.endsWith('.tcgdex.net') || isCardImageSourceUrl(url);
}

function cleanImageValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'null' || trimmed === 'undefined') return null;
  return trimmed;
}

/**
 * Our public URL for a card image (`https://assets.holofolder.com/<key>`). Upstream URLs (TCGdex and the fallback
 * sources, as older saved data and the catalogue's source records hold them) and proxy URLs map to the same key.
 * Anything that isn't a card image (artwork, data and blob URLs) is returned as is.
 */
export function toCardImageSrc(value: unknown): string | null {
  const trimmed = cleanImageValue(value);
  if (!trimmed) return null;
  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) return trimmed;
  const relative = trimmed.startsWith('/');
  const unchanged = relative && trimmed.startsWith('/api/') ? appPath(trimmed) : trimmed;
  try {
    let url = relative ? new URL(trimmed, 'https://holofolder.com') : new URL(trimmed);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (relative && ['/api/card-image-proxy', CARD_IMAGE_PROXY_PATH].includes(url.pathname)) {
      const key = url.searchParams.get('key');
      if (key) return PUBLIC_CARD_IMAGE_BASE + key;
      const upstream = url.searchParams.get('url');
      if (!upstream || !URL.canParse(upstream)) return unchanged;
      url = new URL(upstream);
    } else if (relative) {
      return unchanged;
    }
    const tcgdex = parseTcgdexCardImageUrl(url);
    if (tcgdex) return PUBLIC_CARD_IMAGE_BASE + getCardImageBlobPathname(tcgdex);
    const external = parseSourceCardImageUrl(url);
    if (external) return PUBLIC_CARD_IMAGE_BASE + external.pathname;
    // Old-bucket URLs (its r2.dev address, or the asset domain before the pokemon/tcg prefix) map to the current key.
    if (
      (url.origin === 'https://pub-47cc306087724b00a06ee44b2d4ff58a.r2.dev' ||
        url.origin === PUBLIC_CARD_IMAGE_BASE.slice(0, -1)) &&
      url.pathname.startsWith('/cards/')
    )
      return PUBLIC_CARD_IMAGE_BASE + currentCardImageKey(url.pathname.slice(1));
    // An unrecognised card-image host never reaches the client.
    if (isCardImageUrl(url)) return null;
    return unchanged;
  } catch {
    return null;
  }
}

/**
 * Same-origin fallback for a card image our CDN doesn't have yet: the proxy looks the key up, copies the image into
 * our store from its source and serves it. Non-card images are returned as `toCardImageSrc` gives them.
 */
export function toCardImageProxySrc(value: unknown): string | null {
  const src = toCardImageSrc(value);
  if (!src?.startsWith(PUBLIC_CARD_IMAGE_BASE)) return src;
  return `${CARD_IMAGE_PROXY_PATH}?${new URLSearchParams({ key: src.slice(PUBLIC_CARD_IMAGE_BASE.length) })}`;
}

/** The card image the app shows (see `pickCardImageUrl`), as our asset URL; never an upstream host. */
export function pickCardAssetUrl(...args: Parameters<typeof pickCardImageUrl>): string | undefined {
  const src = toCardImageSrc(pickCardImageUrl(...args));
  return src?.startsWith(PUBLIC_CARD_IMAGE_BASE) ? src : undefined;
}

/** The small stored rendition of a public card object (TCGdex `low`, `<key>.low.webp` for other sources), if it has one. */
export function toSmallCardAssetSrc(src: string): string | null {
  if (!src.startsWith(PUBLIC_CARD_IMAGE_BASE)) return null;
  if (/\/high\.(webp|png|jpg)$/.test(src)) return src.replace(/\/high\.(webp|png|jpg)$/, '/low.$1');
  const low = getSourceImageLowPathname(src.slice(PUBLIC_CARD_IMAGE_BASE.length));
  return low ? PUBLIC_CARD_IMAGE_BASE + low : null;
}

/**
 * Thumbnail for plain `<img>` lists (Quick mode, Show mode): the small rendition, with the full image to switch to if
 * the small one isn't stored yet.
 */
export function toCardThumbnailSrc(value: unknown): { src: string; full: string } | null {
  const full = toCardImageSrc(value);
  if (!full) return null;
  return { src: toSmallCardAssetSrc(full) ?? full, full };
}
