import { buildTcgdexAssetImageUrl, TCGDEX_ASSET_HOST } from './tcgdex-shared';

export { TCGDEX_ASSET_HOST };
/**
 * Every card image object lives under a brand/game root, so other games can share the bucket later
 * (`pokemon/tcg-pocket/...`). Objects in the old `binderdex-card-images` bucket had no root (`cards/...`).
 */
export const CARD_ASSET_ROOT = 'pokemon/tcg';
export const CARD_IMAGE_BLOB_PREFIX = `${CARD_ASSET_ROOT}/cards`;
/** Key prefix of the old bucket layout; old public URLs (`/cards/...`) are rewritten to the new one at the edge. */
export const LEGACY_CARD_IMAGE_BLOB_PREFIX = 'cards';

/** Maps an old-layout key (`cards/...`) to the current one; current keys pass through. */
export function currentCardImageKey(key: string) {
  return key.startsWith(`${LEGACY_CARD_IMAGE_BLOB_PREFIX}/`) ? `${CARD_ASSET_ROOT}/${key}` : key;
}
export const CARD_IMAGE_QUALITIES = ['high', 'low'] as const;
export const CARD_IMAGE_EXTENSIONS = ['webp', 'png', 'jpg'] as const;

export type CardImageQuality = (typeof CARD_IMAGE_QUALITIES)[number];
export type CardImageExtension = (typeof CARD_IMAGE_EXTENSIONS)[number];

export interface TcgdexCardImageRef {
  language: string;
  seriesId: string;
  setId: string;
  localId: string;
  quality: CardImageQuality;
  extension: CardImageExtension;
}

const SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._\-!+%]{0,63}$/;

/** Parses `https://assets.tcgdex.net/<lang>/<series>/<set>/<localId>/<quality>.<ext>`; anything else returns null. */
/** What fallback-source fetches accept: formats the WebP conversion can always decode. */
export const SOURCE_IMAGE_ACCEPT = 'image/webp,image/png,image/jpeg;q=0.9';

export function parseTcgdexCardImageUrl(value: string | URL): TcgdexCardImageRef | null {
  let url: URL;
  try {
    url = typeof value === 'string' ? new URL(value) : value;
  } catch {
    return null;
  }

  if (url.protocol !== 'https:' || url.hostname !== TCGDEX_ASSET_HOST || url.search || url.hash) {
    return null;
  }

  const segments = url.pathname.split('/').slice(1);
  if (segments.length !== 5) return null;

  const [language, seriesId, setId, localId, file] = segments.map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return '';
    }
  });
  const fileMatch = /^(high|low)\.(webp|png|jpg)$/.exec(file);
  if (!fileMatch) return null;
  if (
    ![language, seriesId, setId, localId].every((segment) => SEGMENT_PATTERN.test(segment) && !segment.includes('..'))
  ) {
    return null;
  }

  return {
    language,
    seriesId,
    setId,
    localId,
    quality: fileMatch[1] as CardImageQuality,
    extension: fileMatch[2] as CardImageExtension,
  };
}

export function buildTcgdexCardImageUrl(ref: TcgdexCardImageRef) {
  return buildTcgdexAssetImageUrl(ref.language, ref.seriesId, ref.setId, ref.localId, ref.quality, ref.extension);
}

/** Deterministic Blob pathname: `pokemon/tcg/cards/<lang>/<setId>/<localId>/<quality>.<ext>`. */
export function getCardImageBlobPathname(
  ref: Pick<TcgdexCardImageRef, 'language' | 'setId' | 'localId' | 'quality' | 'extension'>,
) {
  return `${CARD_IMAGE_BLOB_PREFIX}/${[ref.language, ref.setId, ref.localId].map(encodeURIComponent).join('/')}/${ref.quality}.${ref.extension}`;
}
