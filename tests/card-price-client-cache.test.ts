import test from "node:test"
import assert from "node:assert/strict"
import {
  CARD_PRICE_CACHE_STALE_MS,
  buildCardPriceFetchPlan,
  getCardPriceKey,
  type CardPriceSnapshot,
} from "../hooks/use-card-prices"

const now = new Date("2026-06-28T18:00:00.000Z").getTime()

function priceSnapshot(cardId: string, fetchedAt: number): CardPriceSnapshot {
  return {
    cardId,
    language: "en",
    gbpAmount: 12,
    marketGbpAmount: 12,
    goodGbpAmount: 9,
    lowGbpAmount: 8,
    highGbpAmount: 14,
    confidence: "high",
    originalAmount: 16,
    originalCurrency: "USD",
    source: "tcgplayer",
    variantLabel: "Normal",
    updatedAt: "2026-06-28T12:00:00.000Z",
    fxDate: "2026-06-28",
    fetchedAt,
  }
}

test("buildCardPriceFetchPlan shows stale cached prices while force-refreshing them", () => {
  const cacheKey = getCardPriceKey("sv1-001", "en")
  const plan = buildCardPriceFetchPlan(
    [{ cardId: "sv1-001", language: "en" }],
    {
      [cacheKey]: priceSnapshot("sv1-001", now - CARD_PRICE_CACHE_STALE_MS - 1),
    },
    { now },
  )

  assert.equal(plan.cachedPrices[cacheKey]?.gbpAmount, 12)
  assert.equal(plan.fetchBatches.length, 1)
  assert.equal(plan.fetchBatches[0].force, true)
  assert.deepEqual(plan.fetchBatches[0].lookups, [{ cardId: "sv1-001", language: "en" }])
})

test("buildCardPriceFetchPlan keeps fresh cache local and fetches missing prices without force", () => {
  const freshKey = getCardPriceKey("sv1-001", "en")
  const plan = buildCardPriceFetchPlan(
    [
      { cardId: "sv1-001", language: "en" },
      { cardId: "sv1-002", language: "fr" },
    ],
    {
      [freshKey]: priceSnapshot("sv1-001", now - CARD_PRICE_CACHE_STALE_MS + 1),
    },
    { now },
  )

  assert.equal(plan.cachedPrices[freshKey]?.gbpAmount, 12)
  assert.deepEqual(plan.fetchBatches, [
    {
      force: false,
      lookups: [{ cardId: "sv1-002", language: "fr" }],
    },
  ])
})

test("buildCardPriceFetchPlan does not fetch while offline", () => {
  const cacheKey = getCardPriceKey("sv1-001", "en")
  const plan = buildCardPriceFetchPlan(
    [
      { cardId: "sv1-001", language: "en" },
      { cardId: "sv1-002", language: "en" },
    ],
    {
      [cacheKey]: priceSnapshot("sv1-001", now - CARD_PRICE_CACHE_STALE_MS - 1),
    },
    { isOnline: false, now },
  )

  assert.equal(plan.cachedPrices[cacheKey]?.gbpAmount, 12)
  assert.deepEqual(plan.fetchBatches, [])
})
