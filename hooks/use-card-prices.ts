'use client';

import { useEffect, useMemo, useState } from 'react';
import { normalizeDisplayFxRates, type DisplayFxRates } from '@/lib/regional-price';
import { normalizePriceHistory, type CardPriceHistoryPoint } from '@/lib/card-price-history';
import { mapWithConcurrency } from '@/lib/card-db-sync-concurrency';
import { getOfflineStore, type OfflineKeyValueStore } from '@/lib/offline-store/kv';

import {
  CARD_PRICE_MISSING_CACHE_TTL_MS,
  getCardPriceKey,
  normalizeFinishPrices,
  normalizeBuySignal,
  normalizeCardLanguage,
  normalizePriceConfidence,
  normalizePriceSource,
  normalizeSourcePrices,
  normalizeTrendPoints,
  type CardLanguage,
  type CardPriceSnapshot as ServerCardPriceSnapshot,
} from '@/lib/card-pricing';

// lib/card-pricing.ts is the single source of pricing types and normalizers; re-exported here
// so existing client imports keep working.
export type {
  BuySignalStatus,
  CardBuySignal,
  CardLanguage,
  CardPriceSourceSummary,
  CardPriceTrendPoint,
  PriceConfidence,
  PriceSource,
  SupportedCurrency,
} from '@/lib/card-pricing';
export {
  getBuySignalStatusLabel,
  getCardPriceKey,
  getPriceSourceLabel,
  normalizeBuySignal,
  normalizeCardLanguage,
  normalizePriceConfidence,
  normalizePriceSource,
  normalizeSourcePrices,
  normalizeTrendPoints,
} from '@/lib/card-pricing';

export interface CardPriceLookup {
  cardId: string;
  language?: CardLanguage | string | null;
}

/** Client copy of a server snapshot, stamped with when this browser fetched it. */
export interface CardPriceSnapshot extends ServerCardPriceSnapshot {
  fetchedAt: number;
}

const CARD_PRICE_CACHE_KEY = 'binderdex_card_price_cache_v7';
// Prices refresh daily on the server, so a quote this browser fetched today is shown without asking again.
export const CARD_PRICE_CACHE_STALE_MS = 24 * 60 * 60 * 1000;
const CARD_PRICE_REQUEST_BATCH_SIZE = 25;
/**
 * Most quotes kept in the localStorage quick cache. Full evidence for every card lives in IndexedDB, so an
 * evicted quote is still readable there; this cap only stops the quick cache from eating the shared quota.
 */
export const CARD_PRICE_CACHE_MAX_ENTRIES = 500;
/** Times a write is retried, halving the kept quotes each time, after the browser reports a full quota. */
export const CARD_PRICE_CACHE_QUOTA_RETRIES = 4;

export interface CardPriceFetchPlan {
  cachedPrices: Record<string, CardPriceSnapshot>;
  fetchBatches: CardPriceLookup[][];
}

export function buildCardPriceFetchPlan(
  lookups: Array<string | CardPriceLookup>,
  cache: Record<string, CardPriceSnapshot>,
  options: { isOnline?: boolean; now?: number; batchSize?: number } = {},
): CardPriceFetchPlan {
  const now = options.now ?? Date.now();
  const batchSize = options.batchSize ?? CARD_PRICE_REQUEST_BATCH_SIZE;
  const cachedPrices: Record<string, CardPriceSnapshot> = {};
  const missingLookups: CardPriceLookup[] = [];
  const staleLookups: CardPriceLookup[] = [];

  for (const lookup of normalizeCardPriceLookups(lookups)) {
    const cacheKey = getCardPriceKey(lookup.cardId, lookup.language);
    const cached = cache[cacheKey];

    if (!cached) {
      missingLookups.push(lookup);
      continue;
    }

    cachedPrices[cacheKey] = cached;
    const ttl = cached.marketGbpAmount == null ? CARD_PRICE_MISSING_CACHE_TTL_MS : CARD_PRICE_CACHE_STALE_MS;
    // No history check: batch quotes never carry it, card detail loads it (useCardPriceHistory).
    if (now - cached.fetchedAt >= ttl || cached.finishPrices === undefined) {
      staleLookups.push(lookup);
    }
  }

  // No force flag: the server serves its shared row while it's fresh and only calls providers once that's stale.
  const fetchBatches =
    options.isOnline === false
      ? []
      : [...chunkCardPriceLookups(staleLookups, batchSize), ...chunkCardPriceLookups(missingLookups, batchSize)];

  return { cachedPrices, fetchBatches };
}

export function normalizeCardPriceLookups(cardLookups: Array<string | CardPriceLookup>) {
  const byKey = new Map<string, CardPriceLookup>();

  for (const lookup of cardLookups) {
    const cardId = typeof lookup === 'string' ? lookup : lookup?.cardId;
    if (typeof cardId !== 'string' || cardId.length === 0) {
      continue;
    }

    const language = normalizeCardLanguage(typeof lookup === 'string' ? 'en' : lookup.language);
    byKey.set(getCardPriceKey(cardId, language), { cardId, language });
  }

  // oxlint-disable-next-line react-doctor/js-tosorted-immutable -- the spread turns a Map iterator into an array; it isn't a copy.
  return [...byKey.values()].sort((left, right) => {
    const cardComparison = left.cardId.localeCompare(right.cardId);
    return cardComparison === 0
      ? normalizeCardLanguage(left.language).localeCompare(normalizeCardLanguage(right.language))
      : cardComparison;
  });
}

/** Same quote for rendering: same fetch, and the same history/finish evidence loaded (IndexedDB adds full history). */
function isSamePriceSnapshot(left: CardPriceSnapshot | undefined, right: CardPriceSnapshot) {
  if (left === right) return true;
  if (!left) return false;
  return (
    left.fetchedAt === right.fetchedAt &&
    (left.historyPoints?.length ?? -1) === (right.historyPoints?.length ?? -1) &&
    (left.finishPrices === undefined) === (right.finishPrices === undefined)
  );
}

/**
 * Merges quotes into hook state, returning `current` itself when nothing would change, so a lookup change
 * that only re-reads already-shown cached quotes does not re-render (and re-regionalize) every consumer.
 */
export function mergeCardPriceState(
  current: Record<string, CardPriceSnapshot>,
  updates: Record<string, CardPriceSnapshot>,
) {
  let next: Record<string, CardPriceSnapshot> | null = null;
  for (const [key, price] of Object.entries(updates)) {
    if (isSamePriceSnapshot(current[key], price)) continue;
    next ??= { ...current };
    next[key] = price;
  }
  return next ?? current;
}

function getCardPriceLookupsKey(lookups: CardPriceLookup[]) {
  return lookups.map((lookup) => getCardPriceKey(lookup.cardId, lookup.language)).join(',');
}

/**
 * Which lookup set a typing caller should price: keeps `held` (same array) when `next` asks for the same
 * cards, or, while `holding` (e.g. a search is still loading), for no card `held` lacks. So a keystroke
 * that briefly empties or narrows the results does not drop and then re-request the same quotes.
 */
export function pickStableCardPriceLookups(held: CardPriceLookup[], next: CardPriceLookup[], holding: boolean) {
  if (held === next) return held;
  if (getCardPriceLookupsKey(held) === getCardPriceLookupsKey(next)) return held;
  if (holding && held.length > 0) {
    const heldKeys = new Set(held.map((lookup) => getCardPriceKey(lookup.cardId, lookup.language)));
    if (next.every((lookup) => heldKeys.has(getCardPriceKey(lookup.cardId, lookup.language)))) return held;
  }
  return next;
}

/** Content-stable lookups for search-as-you-type callers; see pickStableCardPriceLookups. */
export function useStableCardPriceLookups(lookups: CardPriceLookup[], holding: boolean) {
  const [held, setHeld] = useState(lookups);
  const picked = pickStableCardPriceLookups(held, lookups, holding);
  // Adopt a genuinely new set during render (React's derived-state pattern), so the next keystroke compares against it.
  if (picked !== held) setHeld(picked);
  return picked;
}

export function useCardPrices(cardLookups: Array<string | CardPriceLookup>, enabled: boolean) {
  const [pricesByCardId, setPricesByCardId] = useState<Record<string, CardPriceSnapshot>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [fxRates, setFxRates] = useState<DisplayFxRates | null>(null);
  const [onlineVersion, setOnlineVersion] = useState(0);

  // Keyed by content, not array identity: callers often rebuild the same lookups each render (e.g. while
  // a search is loading), and a new array per render would re-run the effect below in a loop.
  // Memoised on identity too, so a stable (useMemo'd) lookup array is not re-sorted on every render.
  const requestKey = useMemo(
    () =>
      normalizeCardPriceLookups(cardLookups)
        .map((lookup) => getCardPriceKey(lookup.cardId, lookup.language))
        .join(','),
    [cardLookups],
  );
  const stableLookups = useMemo(
    () =>
      requestKey
        ? requestKey.split(',').map((key) => {
            const separator = key.lastIndexOf('::');
            return { cardId: key.slice(0, separator), language: key.slice(separator + 2) } as CardPriceLookup;
          })
        : [],
    [requestKey],
  );

  useEffect(() => {
    if (!enabled) return;
    const handleOnline = () => setOnlineVersion((version) => version + 1);
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [enabled]);

  // oxlint-disable-next-line react-doctor/no-cascading-set-state, react-doctor/no-fetch-in-effect -- shows cached prices at once, then fetches with a cancel flag; the updates land in separate ticks.
  useEffect(() => {
    if (!enabled || stableLookups.length === 0) {
      // oxlint-disable-next-line react/set-state-in-effect, react-doctor/no-adjust-state-on-prop-change -- clears loading when the lookups go away; the fetch below owns the flag otherwise.
      setIsLoading(false);
      return;
    }

    const cache = readPriceCache();
    const quickPrices = buildCardPriceFetchPlan(stableLookups, cache, { isOnline: false }).cachedPrices;
    let cancelled = false;
    setPricesByCardId((current) => mergeCardPriceState(current, quickPrices));
    // oxlint-disable-next-line react-doctor/no-adjust-state-on-prop-change -- paints cached prices before the network round.
    setIsLoading(true);

    void loadPriceEvidence(stableLookups)
      .catch(() => [])
      .then((evidence) => {
        if (cancelled) return [];
        for (const price of evidence) {
          const key = getCardPriceKey(price.cardId, price.language);
          if (!cache[key] || price.fetchedAt >= cache[key].fetchedAt) cache[key] = price;
        }
        const plan = buildCardPriceFetchPlan(stableLookups, cache, { isOnline: navigator.onLine });
        setPricesByCardId((current) => mergeCardPriceState(current, plan.cachedPrices));
        // Everything shown is fresh: skip the fetch round and the localStorage rewrite below.
        if (plan.fetchBatches.length === 0) return [];

        return mapWithConcurrency(plan.fetchBatches, 2, (batch) =>
          cancelled
            ? Promise.resolve([])
            : fetch('/app/api/card-prices', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ cards: batch }),
              })
                .then(async (response) => {
                  if (!response.ok) {
                    throw new Error(`Price API returned ${response.status}`);
                  }

                  const payload = await response.json();
                  const fx = normalizeDisplayFxRates(payload?.fx);
                  if (fx && !cancelled) {
                    setFxRates((current) =>
                      current?.date === fx.date && current.jpyToGbp === fx.jpyToGbp ? current : fx,
                    );
                  }
                  return Array.isArray(payload?.prices) ? payload.prices : [];
                })
                .catch((error) => {
                  console.error('[holofolder] Failed to fetch card price batch:', error);
                  return [];
                }),
        );
      })
      .then((priceBatches) => {
        if (cancelled || priceBatches.every((batch) => batch.length === 0)) return;
        const mergedCache = readPriceCache();
        const updates: Record<string, CardPriceSnapshot> = {};

        for (const fetchedPrices of priceBatches) {
          for (const price of fetchedPrices) {
            if (!price || typeof price.cardId !== 'string') {
              continue;
            }

            const snapshot = normalizeFetchedCardPrice(price);
            if (!snapshot) continue;
            const cacheKey = getCardPriceKey(snapshot.cardId, snapshot.language);

            updates[cacheKey] = snapshot;
            mergedCache[cacheKey] = snapshot;
          }
        }

        writePriceCache(mergedCache);
        void persistPriceEvidence(Object.values(updates)).catch(() => undefined);

        setPricesByCardId((current) => mergeCardPriceState(current, updates));
      })
      .catch((error) => {
        console.error('[holofolder] Failed to fetch card prices:', error);
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, stableLookups, onlineVersion]);

  return {
    pricesByCardId,
    isLoading,
    /** Latest ECB rates from the price API, for converting into the user's display currency. */
    fxRates,
  };
}

export function normalizeFetchedCardPrice(value: unknown): CardPriceSnapshot | null {
  if (!value || typeof value !== 'object' || typeof (value as { cardId?: unknown }).cardId !== 'string') return null;
  const price = value as Partial<CardPriceSnapshot> & { cardId: string };
  const snapshot: CardPriceSnapshot = {
    // Absent means not loaded (batch and summary quotes), not "no history".
    historyPoints: Array.isArray(price.historyPoints) ? normalizePriceHistory(price.historyPoints) : undefined,
    finishPrices: normalizeFinishPrices(price.finishPrices),
    cardId: price.cardId,
    language: normalizeCardLanguage(price.language),
    gbpAmount: typeof price.gbpAmount === 'number' && Number.isFinite(price.gbpAmount) ? price.gbpAmount : null,
    marketGbpAmount:
      typeof price.marketGbpAmount === 'number' && Number.isFinite(price.marketGbpAmount)
        ? price.marketGbpAmount
        : typeof price.gbpAmount === 'number' && Number.isFinite(price.gbpAmount)
          ? price.gbpAmount
          : null,
    goodGbpAmount:
      typeof price.goodGbpAmount === 'number' && Number.isFinite(price.goodGbpAmount) ? price.goodGbpAmount : null,
    lowGbpAmount:
      typeof price.lowGbpAmount === 'number' && Number.isFinite(price.lowGbpAmount) ? price.lowGbpAmount : null,
    highGbpAmount:
      typeof price.highGbpAmount === 'number' && Number.isFinite(price.highGbpAmount) ? price.highGbpAmount : null,
    confidence: normalizePriceConfidence(price.confidence),
    sourcePrices: normalizeSourcePrices(price.sourcePrices),
    trendPoints: normalizeTrendPoints(price.trendPoints),
    buySignal: normalizeBuySignal(price.buySignal),
    originalAmount:
      typeof price.originalAmount === 'number' && Number.isFinite(price.originalAmount) ? price.originalAmount : null,
    originalCurrency:
      price.originalCurrency === 'USD' || price.originalCurrency === 'EUR' ? price.originalCurrency : null,
    source: normalizePriceSource(price.source),
    variantLabel: typeof price.variantLabel === 'string' ? price.variantLabel : null,
    updatedAt: typeof price.updatedAt === 'string' ? price.updatedAt : null,
    fxDate: typeof price.fxDate === 'string' ? price.fxDate : null,
    fetchedAt: Date.now(),
  };
  return snapshot;
}

/** A card-show download must report IndexedDB failure; the localStorage quick cache is trimmed to fit instead. */
export async function saveCardPricesForOffline(prices: unknown[], store = getOfflineStore()) {
  const updates: CardPriceSnapshot[] = [];
  for (const value of prices) {
    const price = normalizeFetchedCardPrice(value);
    if (price) {
      updates.push(price);
    }
  }
  // IndexedDB holds the full evidence offline; the localStorage copy below is a best-effort quick cache.
  await persistPriceEvidence(updates, store);
  const cache = readPriceCache();
  for (const price of updates) cache[getCardPriceKey(price.cardId, price.language)] = price;
  writePriceCache(cache);
}

const PRICE_EVIDENCE_BATCH_SIZE = 100;
const PRICE_HISTORY_KEY_PREFIX = 'price-history:';

/** Card detail history, kept under its own key so batch quotes (which carry none) never overwrite it. */
interface SavedPriceHistory {
  fetchedAt: number;
  points: CardPriceHistoryPoint[];
}

async function persistPriceEvidence(prices: CardPriceSnapshot[], store = getOfflineStore()) {
  if (!store) throw new Error('Offline price storage is unavailable on this device');
  for (let offset = 0; offset < prices.length; offset += PRICE_EVIDENCE_BATCH_SIZE) {
    const batch = prices.slice(offset, offset + PRICE_EVIDENCE_BATCH_SIZE);
    // oxlint-disable-next-line react-doctor/async-await-in-loop -- 100 keys per IndexedDB write keeps transactions small; batches run in order.
    await store.setMany(
      batch.flatMap(({ historyPoints, ...quote }) => {
        const key = getCardPriceKey(quote.cardId, quote.language);
        const entries: Array<readonly [string, unknown]> = [[`price-evidence:${key}`, quote]];
        // History is stored once, under its own key, so a later batch quote can't overwrite it.
        if (historyPoints)
          entries.push([
            `${PRICE_HISTORY_KEY_PREFIX}${key}`,
            { fetchedAt: quote.fetchedAt, points: historyPoints } satisfies SavedPriceHistory,
          ]);
        return entries;
      }),
    );
  }
}

/**
 * Card detail history: reports the saved copy, then, online and when it's missing or older than a quote's
 * TTL, downloads the card's saved evidence (no provider call) and saves its history for offline use.
 */
export async function loadCardPriceHistory(
  lookup: CardPriceLookup,
  onPoints: (points: CardPriceHistoryPoint[]) => void,
  {
    store = getOfflineStore(),
    online = typeof navigator === 'undefined' || navigator.onLine,
    now = Date.now(),
    request = fetch,
  }: { store?: OfflineKeyValueStore | null; online?: boolean; now?: number; request?: typeof fetch } = {},
) {
  const card = { cardId: lookup.cardId, language: normalizeCardLanguage(lookup.language) };
  const key = `${PRICE_HISTORY_KEY_PREFIX}${getCardPriceKey(card.cardId, card.language)}`;
  const saved = await store?.get<SavedPriceHistory>(key).catch(() => undefined);
  const valid = saved && Number.isFinite(saved.fetchedAt) && Array.isArray(saved.points) ? saved : null;
  if (valid) onPoints(normalizePriceHistory(valid.points));
  if (!online || (valid && now - valid.fetchedAt < CARD_PRICE_CACHE_STALE_MS)) return;

  const response = await request(`/app/api/card-prices?${new URLSearchParams({ cards: JSON.stringify([card]) })}`, {
    cache: 'no-store',
  });
  if (!response.ok) return;
  const payload = await response.json();
  if (!Array.isArray(payload?.prices)) return;
  const price = payload.prices.find(
    (value: unknown) =>
      (value as CardPriceSnapshot | null)?.cardId === card.cardId &&
      normalizeCardLanguage((value as CardPriceSnapshot).language) === card.language,
  );
  // No saved row means no recorded history yet: known empty, not an error.
  const points = normalizePriceHistory(price?.historyPoints);
  onPoints(points);
  await store?.set(key, { fetchedAt: now, points } satisfies SavedPriceHistory).catch(() => undefined);
}

/** History for one card's detail; null until known (saved or downloaded). Never invents points. */
export function useCardPriceHistory(cardId: string | undefined, language: string | undefined) {
  const key = cardId ? getCardPriceKey(cardId, normalizeCardLanguage(language)) : null;
  const [loaded, setLoaded] = useState<{ key: string; points: CardPriceHistoryPoint[] } | null>(null);

  useEffect(() => {
    if (!key || !cardId) return;
    let cancelled = false;
    void loadCardPriceHistory({ cardId, language }, (points) => {
      if (!cancelled) setLoaded({ key, points });
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [key, cardId, language]);

  return loaded?.key === key ? loaded.points : null;
}

export async function loadPriceEvidence(
  lookups: CardPriceLookup[],
  store: OfflineKeyValueStore | null = getOfflineStore(),
) {
  if (!store) return [];
  const results: CardPriceSnapshot[] = [];
  for (let offset = 0; offset < lookups.length; offset += PRICE_EVIDENCE_BATCH_SIZE) {
    const batch = lookups.slice(offset, offset + PRICE_EVIDENCE_BATCH_SIZE);
    // oxlint-disable-next-line react-doctor/async-await-in-loop -- 100 keys per IndexedDB read keeps transactions small; batches run in order.
    const savedPrices = await store.getMany<CardPriceSnapshot>(
      batch.map((lookup) => `price-evidence:${getCardPriceKey(lookup.cardId, lookup.language)}`),
    );
    for (const [index, lookup] of batch.entries()) {
      const saved = savedPrices[index];
      if (
        !saved ||
        saved.cardId !== lookup.cardId ||
        saved.language !== lookup.language ||
        !Number.isFinite(saved.fetchedAt)
      )
        continue;
      const price = normalizeFetchedCardPrice(saved);
      if (price)
        results.push({
          ...price,
          fetchedAt: saved.fetchedAt,
          finishPrices: saved.finishPrices === undefined ? undefined : price.finishPrices,
          historyPoints: saved.historyPoints === undefined ? undefined : price.historyPoints,
        });
    }
  }
  return results;
}

// Keep full history in IndexedDB; localStorage's small quota is reserved for quick current quotes.
function compactPriceCache(cache: Record<string, CardPriceSnapshot>) {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(cache).map(([key, price]) => [
        key,
        { ...price, historyPoints: price.historyPoints === undefined ? undefined : [] },
      ]),
    ),
  );
}

// Last parsed quick cache. Every hook instance re-reads it per lookup change; re-parsing and re-normalising
// hundreds of quotes each time is main-thread work, so unchanged storage reuses the parse.
let parsedPriceCache: { raw: string; cache: Record<string, CardPriceSnapshot> } | null = null;

/** Callers mutate the returned record, so each gets its own shallow copy of the memoised parse. */
function readPriceCache(): Record<string, CardPriceSnapshot> {
  try {
    const raw = localStorage.getItem(CARD_PRICE_CACHE_KEY);
    if (!raw) return {};
    if (parsedPriceCache?.raw === raw) return { ...parsedPriceCache.cache };
    const cache = parsePriceCache(raw);
    parsedPriceCache = { raw, cache };
    return { ...cache };
  } catch {
    return {};
  }
}

function parsePriceCache(raw: string): Record<string, CardPriceSnapshot> {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};

    const normalized: Record<string, CardPriceSnapshot> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!value || typeof value !== 'object' || typeof (value as { cardId?: unknown }).cardId !== 'string') {
        continue;
      }

      const snapshot = value as CardPriceSnapshot;
      normalized[key] = {
        ...snapshot,
        historyPoints: snapshot.historyPoints === undefined ? undefined : normalizePriceHistory(snapshot.historyPoints),
        finishPrices: snapshot.finishPrices === undefined ? undefined : normalizeFinishPrices(snapshot.finishPrices),
        marketGbpAmount:
          typeof snapshot.marketGbpAmount === 'number' && Number.isFinite(snapshot.marketGbpAmount)
            ? snapshot.marketGbpAmount
            : snapshot.gbpAmount,
        goodGbpAmount:
          typeof snapshot.goodGbpAmount === 'number' && Number.isFinite(snapshot.goodGbpAmount)
            ? snapshot.goodGbpAmount
            : null,
        lowGbpAmount:
          typeof snapshot.lowGbpAmount === 'number' && Number.isFinite(snapshot.lowGbpAmount)
            ? snapshot.lowGbpAmount
            : null,
        highGbpAmount:
          typeof snapshot.highGbpAmount === 'number' && Number.isFinite(snapshot.highGbpAmount)
            ? snapshot.highGbpAmount
            : null,
        confidence: normalizePriceConfidence(snapshot.confidence),
        sourcePrices: normalizeSourcePrices(snapshot.sourcePrices),
        trendPoints: normalizeTrendPoints(snapshot.trendPoints),
        buySignal: normalizeBuySignal(snapshot.buySignal),
      };
    }
    return normalized;
  } catch {
    return {};
  }
}

function chunkCardPriceLookups(lookups: CardPriceLookup[], batchSize: number) {
  if (lookups.length === 0) return [];

  const chunks: CardPriceLookup[][] = [];
  for (let index = 0; index < lookups.length; index += batchSize) {
    chunks.push(lookups.slice(index, index + batchSize));
  }
  return chunks;
}

/** Keeps the `max` most recently fetched quotes (newest `fetchedAt` wins; ties keep the later-inserted entry). */
export function capPriceCacheEntries(cache: Record<string, CardPriceSnapshot>, max = CARD_PRICE_CACHE_MAX_ENTRIES) {
  const entries = Object.entries(cache);
  if (entries.length <= max) return cache;
  const ranked = entries
    .map(([key, price], index) => ({
      key,
      price,
      index,
      fetchedAt: Number.isFinite(price.fetchedAt) ? price.fetchedAt : 0,
    }))
    .sort((left, right) => right.fetchedAt - left.fetchedAt || right.index - left.index)
    .slice(0, Math.max(0, max));
  const kept = new Set(ranked.map((entry) => entry.key));
  return Object.fromEntries(entries.filter(([key]) => kept.has(key)));
}

function isQuotaExceededError(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const { name, code } = error as { name?: unknown; code?: unknown };
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22 || code === 1014;
}

/**
 * Writes the quick cache capped to CARD_PRICE_CACHE_MAX_ENTRIES. When the quota is full it halves the kept
 * quotes (oldest out first) and retries; if that still fails it drops the key so other prefs can save.
 * Returns how many quotes were stored (0 when the cache could not be written).
 */
export function writePriceCache(cache: Record<string, CardPriceSnapshot>, storage: Storage = localStorage) {
  let limit = CARD_PRICE_CACHE_MAX_ENTRIES;
  for (let attempt = 0; attempt <= CARD_PRICE_CACHE_QUOTA_RETRIES; attempt++) {
    const capped = capPriceCacheEntries(cache, limit);
    try {
      storage.setItem(CARD_PRICE_CACHE_KEY, compactPriceCache(capped));
      return Object.keys(capped).length;
    } catch (error) {
      if (!isQuotaExceededError(error)) break;
      limit = Math.floor(Math.min(limit, Object.keys(capped).length) / 2);
      if (limit < 1) break;
    }
  }
  try {
    storage.removeItem(CARD_PRICE_CACHE_KEY);
  } catch {
    // Nothing more to free.
  }
  return 0;
}
