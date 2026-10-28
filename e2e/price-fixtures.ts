import type { PricedCardFinish } from "../lib/card-pricing"
import type { CardPriceHistoryPoint } from "../lib/card-price-history"
import type { Page } from "@playwright/test"

/**
 * TEST FIXTURES ONLY: synthetic price snapshots served from a mocked /api/card-prices.
 * None of these amounts are real market data.
 */
export interface FixturePrice {
  history?: CardPriceHistoryPoint[]
  confidence: "high" | "medium" | "low" | "unknown"
  market: number
  /** Cardmarket-style trend points (label -> GBP), e.g. { "30d": 10, "7d": 11, Trend: 12 }. */
  trend?: Record<string, number>
  finishes?: Array<{ finish: PricedCardFinish; market: number; trend?: Record<string, number>; confidence?: FixturePrice["confidence"] }>
}

/** Reset both price stores when a test replaces the catalogue fixture on an already open page. */
export async function clearCardPriceCache(page: Page) {
  await page.evaluate(() => {
    if (location.protocol !== "http:" && location.protocol !== "https:") return
    localStorage.removeItem("binderdex_card_price_cache_v7")
    return new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("binderdex-offline", 1)
      open.onupgradeneeded = () => open.result.createObjectStore("records")
      open.onerror = () => reject(open.error)
      open.onsuccess = () => {
        const db = open.result
        const transaction = db.transaction("records", "readwrite")
        const records = transaction.objectStore("records")
        const keys = records.getAllKeys()
        keys.onsuccess = () => {
          for (const key of keys.result) if (String(key).startsWith("price-evidence:")) records.delete(key)
        }
        transaction.oncomplete = () => { db.close(); resolve() }
        transaction.onerror = () => reject(transaction.error)
      }
    })
  })
}

export async function mockCardPrices(page: Page, byCardId: Record<string, FixturePrice>) {
  await page.route("**/api/card-prices**", async (route) => {
    const body = route.request().postDataJSON?.() ?? {}
    const lookups: Array<{ cardId: string; language?: string }> = Array.isArray(body?.cards) ? body.cards : []
    const updatedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    await route.fulfill({
      json: {
        prices: lookups.map((lookup) => {
          const fixture = byCardId[lookup.cardId]
          return {
            cardId: lookup.cardId,
            historyPoints: fixture?.history ?? [],
            language: lookup.language ?? "en",
            gbpAmount: fixture?.market ?? null,
            marketGbpAmount: fixture?.market ?? null,
            goodGbpAmount: null,
            lowGbpAmount: null,
            highGbpAmount: null,
            confidence: fixture?.confidence ?? "unknown",
            sourcePrices: [],
            trendPoints: Object.entries(fixture?.trend ?? {}).map(([label, gbpAmount]) => ({
              label,
              source: "cardmarket",
              gbpAmount,
              originalAmount: gbpAmount,
              originalCurrency: "GBP",
            })),
            buySignal: null,
            originalAmount: null,
            originalCurrency: null,
            source: fixture ? "cardmarket" : null,
            variantLabel: null,
            updatedAt: fixture ? updatedAt : null,
            fxDate: null,
            finishPrices: fixture?.finishes?.map((variant) => ({
              cardId: lookup.cardId, language: lookup.language ?? "en",
              finish: variant.finish, variantKey: variant.finish, variantLabel: variant.finish,
              marketGbpAmount: variant.market, gbpAmount: variant.market,
              confidence: variant.confidence ?? fixture.confidence,
              source: "cardmarket", sourcePrices: [], updatedAt, fxDate: null,
              trendPoints: Object.entries(variant.trend ?? {}).map(([label, gbpAmount]) => ({ label, source: "cardmarket", gbpAmount, originalAmount: gbpAmount, originalCurrency: "GBP" })),
            })) ?? [],
          }
        }),
      },
    })
  })
  await clearCardPriceCache(page)
}
