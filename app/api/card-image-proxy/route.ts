import { after, NextRequest, NextResponse } from 'next/server';
import { getCardImageStoreKind, getDefaultCardImageMirror } from '@/lib/card-image-store';
import { CARD_IMAGE_SOURCE_PREFIX } from '@/lib/card-image-sources';
import { parseCardImageKey } from '@/lib/tcgdex-card-image';
import { getSetSeriesId } from '@/lib/catalog-queries';
import type { LoadedCardImage } from '@/lib/card-image-blob';
import { IMMUTABLE_IMAGE_CACHE_HEADERS } from '@/lib/http-cache';

export const instant = false;

// Pokémon artwork and sprites (PokeAPI on GitHub). Only this repository path: raw.githubusercontent.com serves anything.
const POKEAPI_ORIGIN = 'https://raw.githubusercontent.com';
const POKEAPI_SPRITES_PATH_PREFIX = '/PokeAPI/sprites/master/sprites/pokemon/';

/** `?url=` is only for Pokémon artwork; card images are requested by our own key (`?key=`). */
export function isAllowedImageUrl(url: URL) {
  return (
    url.protocol === 'https:' &&
    !url.port &&
    !url.username &&
    !url.password &&
    url.hostname === 'raw.githubusercontent.com' &&
    url.pathname.startsWith(POKEAPI_SPRITES_PATH_PREFIX) &&
    !url.pathname.includes('..') &&
    /\.(?:png|svg|gif|webp)$/i.test(url.pathname)
  );
}

const SOURCE_KEY_PATTERN = /^[A-Za-z0-9_%!+./-]+\.webp$/;

function notFound(message: string) {
  return Object.assign(new Error(message), { status: 404 });
}

/**
 * A card image by our key. A TCGdex print we don't hold yet is fetched from TCGdex and copied into our store after
 * responding; a fallback-source image is only ever served from the store (the sync and backfills copy those in).
 */
async function loadCardImage(key: string): Promise<LoadedCardImage> {
  const print = parseCardImageKey(key);
  const stored =
    !print && key.startsWith(`${CARD_IMAGE_SOURCE_PREFIX}/`) && SOURCE_KEY_PATTERN.test(key) && !key.includes('..');
  if (!print && !stored) throw Object.assign(new Error('Invalid card image key'), { status: 400 });
  const mirror = getDefaultCardImageMirror();
  if (!mirror) throw Object.assign(new Error('Card image store is not configured'), { status: 503 });
  if (!print) return mirror.loadStoredImage(key);
  const seriesId = await getSetSeriesId(print.setId);
  if (!seriesId) throw notFound(`Unknown set ${print.setId}`);
  return mirror.loadImage({ ...print, seriesId });
}

/** Widths the proxy will resize to (`&w=`). A fixed set keeps the CDN cache small. */
export const PROXY_IMAGE_WIDTHS = [96, 160, 240, 320, 480, 600] as const;

export function parseProxyImageWidth(value: string | null): number | null {
  if (value === null) return null;
  const width = Number(value);
  return (PROXY_IMAGE_WIDTHS as readonly number[]).includes(width) ? width : null;
}

async function resizeImage(buffer: ArrayBuffer, width: number) {
  const { default: sharp } = await import('sharp');
  return sharp(Buffer.from(buffer)).resize({ width, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
}

function errorStatus(error: unknown) {
  const status = (error as { status?: unknown })?.status;
  return status === 400 || status === 404 || status === 503 ? status : 502;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const rawWidth = params.get('w');
  const width = parseProxyImageWidth(rawWidth);
  if (rawWidth !== null && width === null) {
    return NextResponse.json(
      { error: `Unsupported width; use one of ${PROXY_IMAGE_WIDTHS.join(', ')}` },
      { status: 400 },
    );
  }

  const key = params.get('key');
  if (key !== null) {
    let image: LoadedCardImage;
    try {
      image = await loadCardImage(key);
    } catch (error) {
      const status = errorStatus(error);
      return NextResponse.json(
        { error: status === 400 ? 'Invalid card image key' : 'Card image unavailable' },
        { status },
      );
    }
    if (image.pendingUpload) after(image.pendingUpload);
    // The store keeps the original scan; `&w=` serves a smaller WebP for thumbnails and phones (cached at the CDN).
    let body: ArrayBuffer | Buffer = image.body;
    let contentType = image.contentType;
    if (width !== null && !contentType.includes('svg')) {
      try {
        body = await resizeImage(image.body, width);
        contentType = 'image/webp';
      } catch (error) {
        console.error('[card-image-proxy] resize failed, serving the original:', error);
      }
    }
    return new NextResponse(new Uint8Array(body), {
      headers: {
        'content-type': contentType,
        'x-content-type-options': 'nosniff',
        'x-card-image-source': image.source === 'blob' ? getCardImageStoreKind() : image.source,
        ...IMMUTABLE_IMAGE_CACHE_HEADERS,
      },
    });
  }

  const rawUrl = params.get('url');
  if (!rawUrl) {
    return NextResponse.json({ error: 'Missing key or url parameter' }, { status: 400 });
  }
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return NextResponse.json({ error: 'Invalid image URL' }, { status: 400 });
  }
  if (!isAllowedImageUrl(url)) {
    return NextResponse.json({ error: 'Image host is not allowed' }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${POKEAPI_ORIGIN}/${url.pathname.slice(1)}`, {
      redirect: 'error',
      headers: {
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
      next: { revalidate: 60 * 60 * 24 },
    });
  } catch {
    return NextResponse.json({ error: 'Upstream image unavailable' }, { status: 502 });
  }

  if (!upstream.ok) {
    return NextResponse.json(
      { error: `Upstream image fetch failed with ${upstream.status}` },
      { status: upstream.status },
    );
  }

  let contentType = upstream.headers.get('content-type') || 'image/webp';
  let body: ArrayBuffer | Buffer = await upstream.arrayBuffer();

  if (width !== null && !contentType.includes('svg')) {
    try {
      body = await resizeImage(body, width);
      contentType = 'image/webp';
    } catch (error) {
      console.error('[card-image-proxy] resize failed, serving the original:', error);
    }
  }

  return new NextResponse(new Uint8Array(body), {
    headers: {
      'content-type': contentType,
      'x-content-type-options': 'nosniff',
      'x-card-image-source': 'upstream',
      ...IMMUTABLE_IMAGE_CACHE_HEADERS,
    },
  });
}
