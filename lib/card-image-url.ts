import { appPath } from '@/lib/app-path';
import { parseTcgdexCardImageUrl, getCardImageBlobPathname, currentCardImageKey } from '@/lib/tcgdex-card-image';
import { parseSourceCardImageUrl, isCardImageSourceUrl } from '@/lib/card-image-sources';

export const PUBLIC_CARD_IMAGE_BASE = 'https://assets.holofolder.com/';

const CARD_IMAGE_PROXY_PATH = '/app/api/card-image-proxy';

function isCardImageUrl(url: URL) {
  return url.hostname === 'assets.tcgdex.net' || url.hostname.endsWith('.tcgdex.net') || isCardImageSourceUrl(url);
}

/** Same-origin fallback for origin misses and older offline image caches. */
export function toCardImageProxySrc(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'null' || trimmed === 'undefined') return null;
  if (trimmed.startsWith('/api/')) return appPath(trimmed);
  if (trimmed.startsWith('/') || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) return trimmed;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return isCardImageUrl(url) ? `${CARD_IMAGE_PROXY_PATH}?url=${encodeURIComponent(url.toString())}` : trimmed;
  } catch {
    return null;
  }
}

/** Public card objects load directly from the CDN; the proxy remains the miss/offline fallback. */
export function toCardImageSrc(value: unknown): string | null {
  const proxy = toCardImageProxySrc(value);
  if (!proxy) return null;
  try {
    let url = new URL(proxy, 'https://holofolder.com');
    if (url.pathname === CARD_IMAGE_PROXY_PATH && url.searchParams.has('url'))
      url = new URL(url.searchParams.get('url')!);
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
  } catch {}
  return proxy;
}
