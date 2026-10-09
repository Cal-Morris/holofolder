import test from "node:test"
import assert from "node:assert/strict"
import {
  buildCardPriceSnapshotFromPricing,
  buildTcgplayerProductPriceSnapshot,
  normalizePokePulseMarketData,
  parseEcbFxRates,
  pickTcgplayerSearchProduct,
  readPriceAmount,
} from "../lib/card-pricing"

// Test fixture FX rates (not real market data).
const fxRates = { date: "2026-06-28", eurToGbp: 0.85, usdToGbp: 0.75 }

function ecbXml(rates: Record<string, string>, date = "2026-10-08") {
  const cubes = Object.entries(rates)
    .map(([currency, rate]) => `<Cube currency='${currency}' rate='${rate}'/>`)
    .join("")
  return `<gesmes:Envelope><Cube><Cube time='${date}'>${cubes}</Cube></Cube></gesmes:Envelope>`
}

test("parseEcbFxRates derives EUR->GBP and USD->GBP from the ECB EUR base", () => {
  const rates = parseEcbFxRates(ecbXml({ USD: "1.2500", JPY: "160.00", GBP: "0.8500" }))

  assert.equal(rates.date, "2026-10-08")
  assert.equal(rates.eurToGbp, 0.85)
  assert.equal(rates.usdToGbp, 0.85 / 1.25)
})

test("parseEcbFxRates rejects feeds that are missing a currency", () => {
  assert.throws(() => parseEcbFxRates(ecbXml({ USD: "1.25" })), /usable/)
  assert.throws(() => parseEcbFxRates(ecbXml({ GBP: "0.85" })), /usable/)
  assert.throws(() => parseEcbFxRates("<html>maintenance</html>"), /usable/)
})

test("parseEcbFxRates rejects implausible rates instead of mispricing every card", () => {
  assert.throws(() => parseEcbFxRates(ecbXml({ USD: "1.25", GBP: "85.0" })), /out of bounds/)
  assert.throws(() => parseEcbFxRates(ecbXml({ USD: "0.0125", GBP: "0.85" })), /out of bounds/)
  assert.throws(() => parseEcbFxRates(ecbXml({ USD: "0", GBP: "0.85" })), /usable/)
})

test("readPriceAmount only accepts finite prices above zero", () => {
  assert.equal(readPriceAmount(4.2), 4.2)
  assert.equal(readPriceAmount(0), null)
  assert.equal(readPriceAmount(-1), null)
  assert.equal(readPriceAmount(Number.NaN), null)
  assert.equal(readPriceAmount(Number.POSITIVE_INFINITY), null)
  assert.equal(readPriceAmount("4.2"), null)
  assert.equal(readPriceAmount(null), null)
})

test("zero TCGplayer market falls through to Cardmarket instead of pricing the card at £0", () => {
  const snapshot = buildCardPriceSnapshotFromPricing("fixture-001", "en", {
    tcgplayer: { normal: { marketPrice: 0, midPrice: 0, lowPrice: 0 } },
    cardmarket: { trend: 10, low: 8 },
  }, fxRates)

  assert.equal(snapshot.source, "cardmarket")
  assert.equal(snapshot.marketGbpAmount, 8.5)
  assert.equal(snapshot.goodGbpAmount, 6.8)
})

test("zero Cardmarket fields are skipped when picking market, good target and trend points", () => {
  const snapshot = buildCardPriceSnapshotFromPricing("fixture-002", "fr", {
    cardmarket: { trend: 0, avg30: 12, avg7: 0, avg1: -3, low: 0, "low-holo": 0 },
  }, fxRates)

  assert.equal(snapshot.source, "cardmarket")
  assert.equal(snapshot.variantLabel, "Avg30")
  assert.equal(snapshot.marketGbpAmount, 10.2)
  // No usable low, so the good target falls back to 80% of market rather than £0.
  assert.equal(snapshot.goodGbpAmount, 8.16)
  assert.deepEqual(snapshot.trendPoints.map((point) => point.label), ["30d", "Trend"])
})

test("a card whose providers only report zeros stays unpriced", () => {
  const snapshot = buildCardPriceSnapshotFromPricing("fixture-003", "en", {
    tcgplayer: { normal: { marketPrice: 0 } },
    cardmarket: { trend: 0, low: 0 },
  }, fxRates)

  assert.equal(snapshot.marketGbpAmount, null)
  assert.equal(snapshot.confidence, "unknown")
})

test("TCGplayer product fallback ignores a zero lowest price", () => {
  const snapshot = buildTcgplayerProductPriceSnapshot("fixture-004", "en", {
    productId: 1,
    marketPrice: 20,
    lowestPriceWithShipping: 0,
    lowestPrice: 16,
  }, fxRates)

  assert.equal(snapshot?.marketGbpAmount, 15)
  assert.equal(snapshot?.goodGbpAmount, 12)
  assert.equal(buildTcgplayerProductPriceSnapshot("fixture-004", "en", { marketPrice: 0 }, fxRates), null)
})

test("TCGplayer search ignores products without a positive market price", () => {
  const product = pickTcgplayerSearchProduct(
    { name: "Fixturemon", localId: "001", setName: "Fixture Set", rarity: null },
    [{ productId: 1, productName: "Fixturemon - 001", setName: "Fixture Set", marketPrice: 0, customAttributes: { number: "001" } }],
  )

  assert.equal(product, null)
})

test("PokePulse market data drops non-positive prices but keeps a zero sales volume", () => {
  const data = normalizePokePulseMarketData({
    market_price: { value: 0 },
    last_sold_price: -2,
    average_price: 5,
    sales_volume: 0,
    price_trends: [{ date: "2026-10-01", price: 0 }, { date: "2026-10-02", price: 4.5 }],
  })

  assert.equal(data.marketAmount, null)
  assert.equal(data.lastSoldAmount, null)
  assert.equal(data.averageAmount, 5)
  assert.equal(data.salesVolume, 0)
  assert.deepEqual(data.trendPoints.map((point) => point.gbpAmount), [4.5])
})
