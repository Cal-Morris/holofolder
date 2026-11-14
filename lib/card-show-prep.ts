import { fetchOfflineResource } from '@/lib/offline-download';
import { mapWithConcurrency } from '@/lib/card-db-sync-concurrency';
import { appPath } from '@/lib/app-path';
// "Prepare for card show": download chosen sets (coverage data + card thumbnails through the image proxy)
// so they open offline. The service worker caches what this fetches: /app/api/tcg-set-slots in its data cache
// (network-first) and /app/api/card-image-proxy in its image cache (cache-first).
import { SET_SLOTS_WIRE_VERSION, type TCGSetSlotsResponse, type TCGSetSummary } from '@/lib/tcg-set-slots';
import { getCardPriceKey, normalizeCardPriceLookups, type CardPriceLookup } from '@/lib/card-pricing';

/** Rough size of one proxied low-res card thumbnail, used until real samples are measured. */
export const FALLBACK_THUMBNAIL_BYTES = 32 * 1024;
export const ESTIMATE_SAMPLE_SIZE = 3;
export const PREP_CONCURRENCY = 4;
export const SHOW_IMAGE_CACHE = 'binderdex-v1-show-images';
/**
 * Marks thumbnail downloads as card show prep. The service worker then keeps them in its own image
 * cache (`binderdex-v1-show-images`), which everyday browsing can't evict.
 */
export const SAVE_FOR_SHOW_HEADERS = { 'X-Binderdex-Save': 'show' } as const;

/**
 * The one query string for a set's coverage, so the Sets view, the set preset picker and card show prep share
 * browser, CDN and offline copies: query = set name, setId, any non-English language, then `v=2` for the slim
 * response (clients from before it keep getting the old shape). The server ignores `query` when `setId` is given.
 */
export function getSetSlotsQuery(set: Pick<TCGSetSummary, 'id' | 'name'>, language = 'en') {
  return new URLSearchParams({
    query: set.name,
    setId: set.id,
    ...(language === 'en' ? {} : { language }),
    v: SET_SLOTS_WIRE_VERSION,
  }).toString();
}

/** The same lookup as saved before `v=2` (IndexedDB keys and service-worker copies may still use it). */
export function getLegacySetSlotsQuery(set: Pick<TCGSetSummary, 'id' | 'name'>) {
  return new URLSearchParams({ query: set.name, setId: set.id }).toString();
}

export function getSetSlotsUrl(set: Pick<TCGSetSummary, 'id' | 'name'>, language = 'en') {
  return `/app/api/tcg-set-slots?${getSetSlotsQuery(set, language)}`;
}

/** The low-res thumbnail of a card image, through the image proxy. */
export function getProxiedThumbnailUrl(image: string | undefined | null) {
  if (!image) return null;
  const trimmed = image.trim();
  if (!trimmed) return null;
  const low = trimmed.replace(/\/high\.(webp|png|jpg)$/, '/low.$1');
  if (low.startsWith('/')) return appPath(low);
  try {
    const url = new URL(low);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return `/app/api/card-image-proxy?url=${encodeURIComponent(url.toString())}`;
  } catch {
    return null;
  }
}

/** Every distinct card thumbnail in the set, including value-ranking printings. */
export function getSetThumbnailUrls(payload: Pick<TCGSetSlotsResponse, 'slots' | 'cards'> | null | undefined) {
  const urls = new Set<string>();
  const cards = payload?.cards ?? payload?.slots.flatMap((slot) => slot.cards ?? []) ?? [];
  for (const card of cards) {
    const url = getProxiedThumbnailUrl(card.image);
    if (url) urls.add(url);
  }
  return [...urls];
}

export interface CardShowPlan {
  sampledImageUrls?: string[];
  priceLookups: CardPriceLookup[];
  sets: Array<{ set: TCGSetSummary; url: string; dataBytes: number; imageUrls: string[] }>;
  imageUrls: string[];
  dataBytes: number;
  sampledImageBytes: number[];
  estimatedBytes: number;
}

export function estimateCardShowBytes(imageCount: number, dataBytes: number, sampledImageBytes: number[]) {
  const sampled = sampledImageBytes.filter((bytes) => bytes > 0);
  const perImage =
    sampled.length > 0 ? sampled.reduce((sum, bytes) => sum + bytes, 0) / sampled.length : FALLBACK_THUMBNAIL_BYTES;
  return Math.round(dataBytes + perImage * imageCount);
}

export function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

// Bodies are read in full (thumbnails are small) so the service worker's copy is never cut short.
async function responseBytes(response: Response) {
  return (await response.arrayBuffer()).byteLength;
}

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Step 1 (small): load each set's coverage (also caches it), list its thumbnails and download a few of them
 * to measure a real per-image size. Nothing big is downloaded before the user sees the estimate.
 */
export async function planCardShowPrep(
  sets: TCGSetSummary[],
  options: { fetcher?: Fetcher; signal?: AbortSignal } = {},
): Promise<CardShowPlan> {
  const fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  const cache = typeof caches !== 'undefined' ? await caches.open(SHOW_IMAGE_CACHE) : null;
  const planned: CardShowPlan['sets'] = [];
  const priceLookups: CardPriceLookup[] = [];

  for (const set of sets) {
    const url = getSetSlotsUrl(set);
    const response = await fetchOfflineResource(url, { signal: options.signal, fetcher: fetcher as typeof fetch });
    if (!response.ok) throw new Error(`Couldn't load ${set.name} (${response.status})`);
    const text = await response.text();
    if (typeof caches !== 'undefined')
      await (await caches.open('binderdex-v4-data')).put(url, new Response(text, { headers: response.headers }));
    const payload = JSON.parse(text) as TCGSetSlotsResponse;
    const cards = payload.cards ?? payload.slots.flatMap((slot) => slot.cards ?? []);
    priceLookups.push(...cards.map((card) => ({ cardId: card.id, language: card.language ?? 'en' })));
    planned.push({ set, url, dataBytes: text.length, imageUrls: getSetThumbnailUrls(payload) });
  }

  const imageUrls = [...new Set(planned.flatMap((entry) => entry.imageUrls))];
  const sampledImageBytes: number[] = [];
  const sampledImageUrls: string[] = [];
  for (const url of imageUrls.slice(0, ESTIMATE_SAMPLE_SIZE)) {
    const response = await fetchOfflineResource(url, {
      signal: options.signal,
      fetcher: fetcher as typeof fetch,
      headers: SAVE_FOR_SHOW_HEADERS,
    }).catch(() => null);
    if (response?.ok) {
      try {
        const copy = response.clone();
        sampledImageBytes.push(await responseBytes(response));
        await cache?.put(url, copy);
        sampledImageUrls.push(url);
      } catch {
        /* Retry when downloading. */
      }
    }
  }
  const dataBytes = planned.reduce((sum, entry) => sum + entry.dataBytes, 0);

  return {
    priceLookups: normalizeCardPriceLookups(priceLookups),
    sets: planned,
    imageUrls,
    dataBytes,
    sampledImageBytes,
    sampledImageUrls,
    estimatedBytes: estimateCardShowBytes(imageUrls.length, dataBytes, sampledImageBytes),
  };
}

/** Save full price evidence before claiming the chosen sets are ready without signal. */
export async function downloadCardShowPrices(
  plan: Pick<CardShowPlan, 'priceLookups'>,
  options: {
    savePrices: (prices: unknown[]) => void | Promise<void>;
    fetcher?: Fetcher;
    signal?: AbortSignal;
    retryDelay?: (ms: number, signal?: AbortSignal) => Promise<void>;
    onProgress?: (progress: { done: number; total: number; priced: number; failed: number }) => void;
  },
) {
  const fetcher = options.fetcher ?? fetch;
  const lookups = normalizeCardPriceLookups(plan.priceLookups);
  const progress = { done: 0, total: lookups.length, priced: 0, failed: 0 };
  const batches = Array.from({ length: Math.ceil(lookups.length / 25) }, (_, i) => lookups.slice(i * 25, i * 25 + 25));
  await mapWithConcurrency(batches, 2, async (batch) => {
    options.signal?.throwIfAborted();
    let prices;
    try {
      const response = await fetchOfflineResource(
        `/app/api/card-prices?${new URLSearchParams({ cards: JSON.stringify(batch) })}`,
        { ...options, fetcher: fetcher as typeof fetch },
      );
      const payload = await response.json();
      if (!Array.isArray(payload?.prices)) throw new Error('The price download was incomplete');
      const requested = new Set(batch.map((card) => getCardPriceKey(card.cardId, card.language)));
      prices = payload.prices.filter(
        (price: { cardId?: unknown; language?: unknown }) =>
          typeof price?.cardId === 'string' && requested.has(getCardPriceKey(price.cardId, price.language)),
      );
    } catch {
      options.signal?.throwIfAborted();
      progress.failed += batch.length;
      progress.done += batch.length;
      options.onProgress?.({ ...progress });
      return;
    }
    await options.savePrices(prices);
    progress.done += batch.length;
    progress.priced += prices.filter(
      (price: { marketGbpAmount?: unknown }) =>
        typeof price.marketGbpAmount === 'number' &&
        Number.isFinite(price.marketGbpAmount) &&
        price.marketGbpAmount > 0,
    ).length;
    options.onProgress?.({ ...progress });
  });
  return progress;
}

export interface CardShowProgress {
  done: number;
  total: number;
  failed: number;
}

/** Step 2 (after the user confirms): download the remaining thumbnails, a few at a time. */
export async function downloadCardShowImages(
  plan: Pick<CardShowPlan, 'imageUrls' | 'sampledImageUrls'>,
  options: {
    fetcher?: Fetcher;
    signal?: AbortSignal;
    cache?: Cache;
    retryDelay?: (ms: number, signal?: AbortSignal) => Promise<void>;
    onProgress?: (progress: CardShowProgress) => void;
    concurrency?: number;
  } = {},
): Promise<CardShowProgress> {
  const fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  const cache = options.cache ?? (typeof caches !== 'undefined' ? await caches.open(SHOW_IMAGE_CACHE) : null);
  const sampled = new Set(cache ? [] : (plan.sampledImageUrls ?? []));
  const urls = plan.imageUrls.filter((url) => !sampled.has(url));
  const progress: CardShowProgress = {
    done: plan.imageUrls.length - urls.length,
    total: plan.imageUrls.length,
    failed: 0,
  };
  options.onProgress?.({ ...progress });

  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      if (options.signal?.aborted) return;
      const url = urls[next];
      next += 1;
      try {
        const saved = await cache?.match(url);
        if (!saved?.ok || !saved.headers.get('content-type')?.startsWith('image/')) {
          const response = await fetchOfflineResource(url, {
            ...options,
            fetcher: fetcher as typeof fetch,
            headers: SAVE_FOR_SHOW_HEADERS,
          });
          if (cache && !response.headers.get('content-type')?.startsWith('image/'))
            throw new Error('Image unavailable');
          await cache?.put(url, response);
        }
      } catch {
        if (options.signal?.aborted) return;
        progress.failed += 1;
      }
      progress.done += 1;
      options.onProgress?.({ ...progress });
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, options.concurrency ?? PREP_CONCURRENCY) }, worker));
  return progress;
}

export interface SavedShowSet {
  set: TCGSetSummary;
  images: number;
  imageTotal: number;
  priced: number;
  priceTotal: number;
}

/** Inspect the actual cached coverage and thumbnails, never a previous run's success flag. */
export async function inspectSavedShowSets(options: {
  cacheStorage: CacheStorage;
  loadPrices: (lookups: CardPriceLookup[]) => Promise<readonly { marketGbpAmount?: number | null }[]>;
}): Promise<SavedShowSet[]> {
  const names = await options.cacheStorage.keys();
  const imageUrls = new Set<string>();
  const imageRequests = await Promise.all(
    names.flatMap((name) =>
      /^binderdex-.*-(?:show-)?images$/.test(name)
        ? [options.cacheStorage.open(name).then((cache) => cache.keys())]
        : [],
    ),
  );
  for (const requests of imageRequests) for (const request of requests) imageUrls.add(request.url);
  const saved = new Map<string, SavedShowSet>();
  for (const name of names.filter((name) => /^binderdex-.*-data$/.test(name))) {
    const cache = await options.cacheStorage.open(name);
    for (const request of await cache.keys()) {
      const url = new URL(request.url);
      if (appPath(url.pathname) !== '/app/api/tcg-set-slots' || !url.searchParams.has('setId')) continue;
      const response = await cache.match(request);
      const payload = (await response?.json().catch(() => null)) as TCGSetSlotsResponse | null;
      if (
        !payload?.selectedSet ||
        typeof payload.selectedSet.id !== 'string' ||
        typeof payload.selectedSet.name !== 'string' ||
        !Array.isArray(payload.slots)
      )
        continue;
      const cards = payload.cards ?? payload.slots.flatMap((slot) => slot.cards ?? []);
      const lookups = normalizeCardPriceLookups(
        cards.map((card) => ({ cardId: card.id, language: card.language ?? 'en' })),
      );
      const thumbnails = getSetThumbnailUrls(payload);
      const prices = await options.loadPrices(lookups);
      saved.set(payload.selectedSet.id, {
        set: payload.selectedSet,
        images: thumbnails.filter((image) => imageUrls.has(new URL(image, url.origin).href)).length,
        imageTotal: thumbnails.length,
        priced: prices.filter(
          (price) =>
            typeof price.marketGbpAmount === 'number' &&
            Number.isFinite(price.marketGbpAmount) &&
            price.marketGbpAmount > 0,
        ).length,
        priceTotal: lookups.length,
      });
    }
  }
  return [...saved.values()];
}
