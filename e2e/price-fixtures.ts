import type { PricedCardFinish, PriceSource } from '../lib/card-pricing';
import type { CardPriceHistoryPoint } from '../lib/card-price-history';
import type { Page, Request } from '@playwright/test';

/**
 * TEST FIXTURES ONLY: synthetic price snapshots served from a mocked /app/api/card-prices.
 * None of these amounts are real market data.
 */
export interface FixturePrice {
  source?: PriceSource;
  history?: CardPriceHistoryPoint[];
  confidence: 'high' | 'medium' | 'low' | 'unknown';
  market: number;
  /** The finish the headline `market` quotes. Native price checks only accept exact-finish rows, so this also
   * serves the headline as that finish's row (unless `finishes` already quotes it). */
  finish?: PricedCardFinish;
  /** Cardmarket-style trend points (label -> GBP), e.g. { "30d": 10, "7d": 11, Trend: 12 }. */
  trend?: Record<string, number>;
  finishes?: Array<{
    finish: PricedCardFinish;
    market: number;
    trend?: Record<string, number>;
    confidence?: FixturePrice['confidence'];
  }>;
}

/** Reset both price stores when a test replaces the catalogue fixture on an already open page. */
export async function clearCardPriceCache(page: Page) {
  await page.evaluate(() => {
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
    localStorage.removeItem('binderdex_card_price_cache_v7');
    return new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('binderdex-offline', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('records');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const transaction = db.transaction('records', 'readwrite');
        const records = transaction.objectStore('records');
        const keys = records.getAllKeys();
        keys.onsuccess = () => {
          for (const key of keys.result) if (/^price-(?:evidence|history):/.test(String(key))) records.delete(key);
        };
        transaction.oncomplete = () => {
          db.close();
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
      };
    });
  });
}

/** The card lookups a /app/api/card-prices request asks for: GET `?cards=` or a POST body (either may be absent). */
export function requestedPriceCards(request: Request): Array<{ cardId: string; language?: string }> {
  const body =
    request.method() === 'GET'
      ? { cards: JSON.parse(new URL(request.url()).searchParams.get('cards') ?? '[]') }
      : (request.postDataJSON?.() ?? {});
  return Array.isArray(body?.cards) ? body.cards : [];
}

export async function mockCardPrices(page: Page, byCardId: Record<string, FixturePrice>) {
  await page.route('**/app/api/card-prices**', async (route) => {
    const lookups = requestedPriceCards(route.request());
    const updatedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await route.fulfill({
      json: {
        prices: lookups.map((lookup) => {
          const fixture = byCardId[lookup.cardId];
          return {
            cardId: lookup.cardId,
            // Like the server: batch POST quotes carry no history; card detail GETs it.
            ...(route.request().method() === 'GET' ? { historyPoints: fixture?.history ?? [] } : {}),
            language: lookup.language ?? 'en',
            gbpAmount: fixture?.market ?? null,
            marketGbpAmount: fixture?.market ?? null,
            goodGbpAmount: null,
            lowGbpAmount: null,
            highGbpAmount: null,
            confidence: fixture?.confidence ?? 'unknown',
            sourcePrices: [],
            trendPoints: Object.entries(fixture?.trend ?? {}).map(([label, gbpAmount]) => ({
              label,
              source: fixture?.source ?? 'cardmarket',
              gbpAmount,
              originalAmount: gbpAmount,
              originalCurrency: 'GBP',
            })),
            buySignal: null,
            originalAmount: null,
            originalCurrency: null,
            source: fixture ? (fixture.source ?? 'cardmarket') : null,
            variantLabel: null,
            updatedAt: fixture ? updatedAt : null,
            fxDate: null,
            finishPrices: (
              [
                ...(fixture?.finish && !fixture.finishes?.some((variant) => variant.finish === fixture.finish)
                  ? [{ finish: fixture.finish, market: fixture.market, trend: fixture.trend }]
                  : []),
                ...(fixture?.finishes ?? []),
              ] as NonNullable<FixturePrice['finishes']>
            ).map((variant) => ({
              cardId: lookup.cardId,
              language: lookup.language ?? 'en',
              finish: variant.finish,
              variantKey: variant.finish,
              variantLabel: variant.finish,
              marketGbpAmount: variant.market,
              gbpAmount: variant.market,
              confidence: variant.confidence ?? fixture!.confidence,
              source: fixture!.source ?? 'cardmarket',
              sourcePrices: [],
              updatedAt,
              fxDate: null,
              trendPoints: Object.entries(variant.trend ?? {}).map(([label, gbpAmount]) => ({
                label,
                source: fixture!.source ?? 'cardmarket',
                gbpAmount,
                originalAmount: gbpAmount,
                originalCurrency: 'GBP',
              })),
            })),
          };
        }),
      },
    });
  });
  await clearCardPriceCache(page);
}
