import { parseTcgdexCardImageUrl, getCardImageBlobPathname, currentCardImageKey } from '@/lib/tcgdex-card-image';
import { parseSourceCardImageUrl } from '@/lib/card-image-sources';

export function developerImageSource(value: string) {
  if (value.startsWith('tcgdex:')) return `https://assets.tcgdex.net/${value.slice(7)}`;
  try {
    const url = new URL(value, 'https://holofolder.com');
    if (
      ['https://holofolder.com', 'https://app.holofolder.com'].includes(url.origin) &&
      ['/api/card-image-proxy', '/app/api/card-image-proxy'].includes(url.pathname)
    )
      return url.searchParams.get('url') ?? value;
  } catch {}
  return value;
}
export function developerImageKey(value: unknown, r2Bases: readonly string[] = []): string | null {
  if (typeof value !== 'string') return null;
  const source = developerImageSource(value),
    tcgdex = parseTcgdexCardImageUrl(source);
  if (tcgdex) return getCardImageBlobPathname(tcgdex);
  const external = parseSourceCardImageUrl(source);
  if (external) return external.pathname;
  try {
    const url = new URL(source);
    if (url.username || url.password || url.hash) return null;
    for (const base of r2Bases) {
      const prefix = new URL(base);
      if (url.origin !== prefix.origin || !url.pathname.startsWith(prefix.pathname)) continue;
      const key = url.pathname.slice(prefix.pathname.length);
      // Old-bucket keys (cards/...) are answered with the current key (pokemon/tcg/cards/...).
      if (
        /^(?:pokemon\/tcg\/)?cards\/(?:[A-Za-z0-9_%!+.-]+\/)+[A-Za-z0-9_%!+.-]+\.(?:webp|png|jpg)$/.test(key) &&
        !key.includes('..') &&
        !/%(?:2f|5c|00)/i.test(key)
      )
        return currentCardImageKey(key);
    }
  } catch {}
  return null;
}
export function normalizeStoredDeveloperImage(value: unknown, r2Bases: readonly string[] = []): string | null {
  if (typeof value !== 'string') return null;
  const source = developerImageSource(value),
    key = developerImageKey(source, r2Bases);
  if (!key) return null;
  if (parseTcgdexCardImageUrl(source) || parseSourceCardImageUrl(source)) return source;
  return `${r2Bases[0]}${key}`;
}
export function developerArtworkReference(value: string): string | null {
  const parsed = parseTcgdexCardImageUrl(developerImageSource(value));
  if (!parsed) return null;
  return `tcgdex:${[parsed.language, parsed.seriesId, parsed.setId, parsed.localId].map(encodeURIComponent).join('/')}/${parsed.quality}.${parsed.extension}`;
}
