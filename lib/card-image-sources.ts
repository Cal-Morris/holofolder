import { readCatalogMetadata } from './card-catalog';
import { CARD_IMAGE_BLOB_PREFIX } from './tcgdex-card-image';
import { pickTcgdexImageFromExternalIds, TCGDEX_ASSET_HOST } from './tcgdex-shared';

/**
 * Fallback card image sources (used when TCGdex has no image for a card).
 *
 * Every image from these hosts is copied into the card image store (R2 or Blob) under a deterministic key and served
 * from there by `/app/api/card-image-proxy`; the origin is only contacted when the copy is missing. Copies are stored as
 * WebP (see `lib/card-image-transform.ts`), so each source image costs one small object.
 */
export const CARD_IMAGE_SOURCE_PREFIX = `${CARD_IMAGE_BLOB_PREFIX}/src`;

export type CardImageSource =
  'tcgplayer' | 'pokemontcg' | 'scrydex' | 'limitless' | 'playshop' | 'pokemoncom' | 'malie';

export const CARD_IMAGE_SOURCE_HOSTS: Readonly<Record<string, CardImageSource>> = {
  'product-images.tcgplayer.com': 'tcgplayer',
  'images.pokemontcg.io': 'pokemontcg',
  'images.scrydex.com': 'scrydex',
  'limitlesstcg.nyc3.cdn.digitaloceanspaces.com': 'limitless',
  // Shared Shopify CDN: only the playshop.fr store path is a card image source (see PATH_RULES).
  'cdn.shopify.com': 'playshop',
  // Shared Pokémon asset CDN: only the TCG card image path is a card image source (see PATH_RULES).
  'assets.pokemon.com': 'pokemoncom',
  // malie.io's exports of the official Pokémon TCG Live and TCG Online card renders (English PNGs only, see PATH_RULES).
  'cdn.malie.io': 'malie',
};

/** Sources on a host that also serves other content: only URLs matching the source's path rule are card images. */
const SHARED_HOST_SOURCES: ReadonlySet<CardImageSource> = new Set(['playshop', 'pokemoncom', 'malie']);

/** Source priority when several are known for a card (best scans first). */
export const CARD_IMAGE_SOURCE_PRIORITY: readonly CardImageSource[] = [
  'malie',
  'pokemoncom',
  'limitless',
  'scrydex',
  'pokemontcg',
  'tcgplayer',
  'playshop',
];

/** Sources whose stored copy is trimmed of the plain white margin around the card (retailer photos). */
export const TRIMMED_CARD_IMAGE_SOURCES: ReadonlySet<CardImageSource> = new Set(['playshop']);

export interface SourceCardImageRef {
  source: CardImageSource;
  /** Canonical origin URL (what the catalog stores and the client requests through the proxy). */
  url: string;
  /** Store key: `pokemon/tcg/cards/src/<source>/<…>.webp`. */
  pathname: string;
}

const PATH_RULES: Record<CardImageSource, { pattern: RegExp; key: (match: RegExpExecArray) => string }> = {
  // https://product-images.tcgplayer.com/<productId>.jpg
  tcgplayer: { pattern: /^\/([1-9]\d{0,9})\.jpg$/, key: (m) => m[1] },
  // https://images.pokemontcg.io/<setId>/<number>[_hires].png ("!" is a collector number in Unown sets; keys stay plain ASCII)
  pokemontcg: {
    pattern: /^\/([a-z0-9][a-z0-9.-]{0,31})\/([A-Za-z0-9!][A-Za-z0-9_!-]{0,47})\.png$/,
    key: (m) => `${m[1]}/${m[2].replaceAll('!', 'exclamation')}`,
  },
  // https://images.scrydex.com/pokemon/<cardId>/<large|medium|small>
  scrydex: {
    pattern: /^\/pokemon\/([A-Za-z0-9][A-Za-z0-9._-]{0,63})\/(large|medium|small)$/,
    key: (m) => `${m[1]}/${m[2]}`,
  },
  // https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/<SET>/<SET>_<NNN>_<R>_<LANG>[_LG|_SM].png
  limitless: {
    pattern: /^\/tpci\/([A-Z0-9]{1,10})\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})\.(png|jpg|webp)$/,
    key: (m) => `${m[1]}/${m[2]}`,
  },
  // https://cdn.shopify.com/s/files/1/1015/7057/6719/files/<handle>.<png|jpg> (playshop.fr product scans of single cards)
  playshop: {
    pattern: /^\/s\/files\/1\/1015\/7057\/6719\/files\/([a-z0-9][a-z0-9-]{0,95})\.(png|jpg)$/,
    key: (m) => m[1],
  },
  // https://assets.pokemon.com/static-assets/content-assets/cms2/img/cards/web/<SET>/<SET>_EN_<number>.png
  pokemoncom: {
    pattern: /^\/static-assets\/content-assets\/cms2\/img\/cards\/web\/([A-Z0-9]{1,16})\/(\1_EN_[A-Z0-9]{1,12})\.png$/,
    key: (m) => `${m[1]}/${m[2]}`,
  },
  // https://cdn.malie.io/file/malie-io/tcgl/cards/png/en/<set>/<set>_en_<NNN>_std.png (TCG Live)
  // https://cdn.malie.io/file/malie-io/art/cards/png/en_US/<ERA>/<CODE>/en_US-<CODE>-<NNN>-<name>.png (TCG Online)
  malie: {
    pattern:
      /^\/file\/malie-io\/(?:tcgl\/cards\/png\/en\/([a-z0-9-]{1,16})\/([a-z0-9_-]{1,64})|art\/cards\/png\/en_US\/([A-Za-z0-9_]{1,16})\/([A-Za-z0-9_-]{1,32})\/(en_US-[A-Za-z0-9_.-]{1,120}))\.png$/,
    key: (m) => (m[1] ? `tcgl/${m[1]}/${m[2]}` : `ptcgo/${m[3]}/${m[4]}/${m[5]}`),
  },
};

/** Store key of the small rendition beside a fallback-source image: `….webp` → `….low.webp`. */
export function getSourceImageLowPathname(pathname: string) {
  return pathname.startsWith(`${CARD_IMAGE_SOURCE_PREFIX}/`) &&
    pathname.endsWith('.webp') &&
    !pathname.endsWith('.low.webp')
    ? `${pathname.slice(0, -5)}.low.webp`
    : null;
}

export function getCardImageSourceForHost(hostname: string): CardImageSource | null {
  return Object.hasOwn(CARD_IMAGE_SOURCE_HOSTS, hostname) ? CARD_IMAGE_SOURCE_HOSTS[hostname] : null;
}

/**
 * True when the URL may be served as a card image: its host is a fallback source and, for hosts shared with
 * other content, its path matches the source's rule. Use this (not the host alone) before proxying.
 */
export function isCardImageSourceUrl(url: URL) {
  const source = getCardImageSourceForHost(url.hostname);
  if (!source) return false;
  return !SHARED_HOST_SOURCES.has(source) || parseSourceCardImageUrl(url) !== null;
}

/** Parses an image URL from one of the fallback sources; anything else (or any odd path) returns null. */
export function parseSourceCardImageUrl(value: string | URL): SourceCardImageRef | null {
  let url: URL;
  try {
    url = typeof value === 'string' ? new URL(value) : value;
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.search || url.hash || url.port || url.username || url.password) return null;
  const source = getCardImageSourceForHost(url.hostname);
  if (!source) return null;
  const rule = PATH_RULES[source];
  const match = rule.pattern.exec(url.pathname);
  if (!match || url.pathname.includes('..')) return null;
  return { source, url: url.toString(), pathname: `${CARD_IMAGE_SOURCE_PREFIX}/${source}/${rule.key(match)}.webp` };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function normalizeProductId(value: unknown) {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return String(value);
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return value.trim();
  return null;
}

function pickTcgplayerProductId(tcgdex: Record<string, unknown> | null) {
  if (!tcgdex) return null;
  const direct = normalizeProductId(asRecord(tcgdex.thirdParty)?.tcgplayer);
  if (direct) return direct;
  if (!Array.isArray(tcgdex.variantThirdParty)) return null;
  for (const candidate of tcgdex.variantThirdParty) {
    const productId = normalizeProductId(asRecord(candidate)?.tcgplayer);
    if (productId) return productId;
  }
  return null;
}

/** The official pokemon.com scan recorded by `bun run card-assets mirror-pokemoncom` (English only). */
export function pickPokemonComImageUrl(externalIds: unknown) {
  const image = asRecord(asRecord(externalIds)?.pokemoncom)?.image;
  return typeof image === 'string' && parseSourceCardImageUrl(image)?.source === 'pokemoncom' ? image : undefined;
}

/**
 * The image `card-assets publish` chose for this card and language (`external_ids_json.assets.<language>.image`,
 * see card-assets/AGENTS.md). Only URLs the image store can serve count.
 */
export function pickPublishedCardImageUrl(externalIds: unknown, language: string) {
  const image = asRecord(asRecord(asRecord(externalIds)?.assets)?.[language])?.image;
  if (typeof image !== 'string') return undefined;
  try {
    const url = new URL(image);
    return (url.protocol === 'https:' && url.hostname === TCGDEX_ASSET_HOST) || parseSourceCardImageUrl(url)
      ? image
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Image URL the app shows for a card in `language`. Every surface (search, sets, card detail, binder slots and the
 * developer API) goes through this, and `card-assets` mirrors it as its default rule:
 * 1. the image published from the card-assets ledger for this language,
 * 2. the reviewed catalog image,
 * 3. TCGdex in the requested language,
 * 4. for English, the official pokemon.com image (245 × 342, so only when TCGdex has no English print),
 * 5. TCGdex in the nearest other language,
 * 6. the other fallback sources.
 */
export function pickCardImageUrl(
  externalIds: unknown,
  imageLanguage: string | null,
  tcgdexImageUrl: string | null,
  language = 'en',
) {
  const chosen = pickPublishedCardImageUrl(externalIds, language) ?? readCatalogMetadata(externalIds).image;
  if (chosen) return chosen;
  if (tcgdexImageUrl && imageLanguage === language) return tcgdexImageUrl;
  const official = language === 'en' ? pickPokemonComImageUrl(externalIds) : undefined;
  return official ?? (tcgdexImageUrl || pickExternalCardImageUrl(externalIds));
}

/**
 * Best image URL for a card without a TCGdex asset-manifest image: the reviewed catalog image, then the TCGdex
 * image recorded on the card, then the official pokemon.com scan, then pokemontcg.io / Scrydex, then the TCGplayer
 * product image.
 */
export function pickExternalCardImageUrl(value: unknown) {
  const externalIds = asRecord(value);
  if (!externalIds) return undefined;

  const reviewedImage = readCatalogMetadata(externalIds).image;
  if (reviewedImage) return reviewedImage;

  const tcgdexImage = pickTcgdexImageFromExternalIds(externalIds);
  if (tcgdexImage) return tcgdexImage;

  const pokemonCom = pickPokemonComImageUrl(externalIds);
  if (pokemonCom) return pokemonCom;

  const pokemonTcg = asRecord(externalIds.pokemon_tcg);
  for (const key of ['imageLarge', 'imageSmall'] as const) {
    const candidate = pokemonTcg?.[key];
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  }

  const tcgplayerProductId = pickTcgplayerProductId(asRecord(externalIds.tcgdex));
  return tcgplayerProductId
    ? `https://product-images.tcgplayer.com/${encodeURIComponent(tcgplayerProductId)}.jpg`
    : undefined;
}

/**
 * The fallback-source image the app shows for this card, if any (null when it shows a TCGdex image or nothing).
 * Mirrors `pickCardImageUrl` for English.
 */
export function pickMirrorableSourceImage(card: {
  imageLanguages: readonly string[];
  externalIds: unknown;
}): SourceCardImageRef | null {
  // The English image pickCardImageUrl shows, when it isn't a TCGdex image.
  const chosen = pickPublishedCardImageUrl(card.externalIds, 'en') ?? readCatalogMetadata(card.externalIds).image;
  const url =
    chosen ??
    (card.imageLanguages.includes('en')
      ? undefined
      : (pickPokemonComImageUrl(card.externalIds) ??
        (card.imageLanguages.length ? undefined : pickExternalCardImageUrl(card.externalIds))));
  return url ? parseSourceCardImageUrl(url) : null;
}
