// Sold comps and eBay asking checks pinned on this device (IndexedDB), so the last-known result shows
// instantly and offline. The server's card_price_checks row stays the source of truth; this is a copy.
import {
  isCardPriceCheck,
  PRICE_CHECK_FRESH_MS,
  type CardPriceCheck,
  type PriceCheckSource,
} from '@/lib/card-price-checks';
import type { CardFinish } from '@/lib/domain/cards';
import { getOfflineStore, type OfflineKeyValueStore } from '@/lib/offline-store/kv';

const PREFIX = 'price-check:';
export const PRICE_CHECK_SOURCES: readonly PriceCheckSource[] = ['ebay', 'soldcomps'];

/** The finish the API keys checks by: exact for normal/holo/reverse, otherwise "any". */
export function priceCheckFinish(finish: CardFinish | string | null | undefined) {
  return finish && ['normal', 'holo', 'reverse_holo'].includes(finish) ? finish : 'any';
}

export function priceCheckKey(
  cardId: string,
  finish: CardFinish | string | null | undefined,
  source: PriceCheckSource,
) {
  return `${PREFIX}${cardId}:${priceCheckFinish(finish)}:${source}`;
}

export function isPriceCheckFresh(check: Pick<CardPriceCheck, 'checkedAt'> | null | undefined, now = Date.now()) {
  if (!check) return false;
  const age = now - Date.parse(check.checkedAt);
  return Number.isFinite(age) && age < PRICE_CHECK_FRESH_MS;
}

/** "just now", "35 min ago", "3 h ago", "2 d ago". */
export function formatPriceCheckAge(checkedAt: string, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(checkedAt)) / 60_000));
  if (!Number.isFinite(minutes) || minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.floor(hours / 24)} d ago`;
}

const kindOf = (source: PriceCheckSource) => (source === 'ebay' ? 'asking' : 'sold');

export async function pinCardPriceCheck(
  cardId: string,
  finish: CardFinish | string | null | undefined,
  source: PriceCheckSource,
  check: CardPriceCheck,
  store: OfflineKeyValueStore | null = getOfflineStore(),
) {
  if (!store || !isCardPriceCheck(check) || check.summary.kind !== kindOf(source)) return;
  try {
    const key = priceCheckKey(cardId, finish, source);
    // Never replace a newer pin with an older answer (e.g. two tabs, or a slow response).
    const existing = await store.get<CardPriceCheck>(key);
    if (isCardPriceCheck(existing) && Date.parse(existing.checkedAt) > Date.parse(check.checkedAt)) return;
    await store.set(key, check);
  } catch {
    /* best effort: storage full or unavailable */
  }
}

export async function readPinnedCardPriceCheck(
  cardId: string,
  finish: CardFinish | string | null | undefined,
  source: PriceCheckSource,
  store: OfflineKeyValueStore | null = getOfflineStore(),
): Promise<CardPriceCheck | null> {
  if (!store) return null;
  try {
    const value = await store.get<unknown>(priceCheckKey(cardId, finish, source));
    return isCardPriceCheck(value) && value.summary.kind === kindOf(source) ? value : null;
  } catch {
    return null;
  }
}

export async function readPinnedCardPriceChecks(
  cardId: string,
  finish: CardFinish | string | null | undefined,
  store: OfflineKeyValueStore | null = getOfflineStore(),
) {
  const [ebay, soldcomps] = await Promise.all(
    PRICE_CHECK_SOURCES.map((source) => readPinnedCardPriceCheck(cardId, finish, source, store)),
  );
  return { ebay, soldcomps };
}
