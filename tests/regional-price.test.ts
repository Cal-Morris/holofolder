import { describe, test } from "node:test"
import assert from "node:assert/strict"
import type { CardPriceSnapshot, CardPriceSourceSummary } from "../lib/card-pricing"
import { parseEcbFxRates } from "../lib/card-pricing"
import {
  convertGbpForDisplay,
  downgradeConfidence,
  formatDisplayTotals,
  formatDisplayAmount,
  formatDisplayRange,
  formatRegionalPriceLabel,
  getSourceMarket,
  normalizeDisplayFxRates,
  regionalizeCardPrice,
  type DisplayFxRates,
} from "../lib/regional-price"

// TEST FIXTURES ONLY: synthetic amounts chosen to exercise the weighting rules. Not market data.
const FX: DisplayFxRates = { date: "2026-10-01", eurToGbp: 0.85, usdToGbp: 0.75, jpyToGbp: 0.005 }

function source(partial: Partial<CardPriceSourceSummary> & Pick<CardPriceSourceSummary, "source" | "originalCurrency" | "marketGbpAmount" | "originalMarketAmount">): CardPriceSourceSummary {
  return {
    label: partial.source,
    variantLabel: null,
    lowGbpAmount: null,
    originalLowAmount: null,
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...partial,
  }
}

const tcgplayer = (gbp: number) => source({ source: "tcgplayer", originalCurrency: "USD", marketGbpAmount: gbp, originalMarketAmount: gbp / FX.usdToGbp, variantLabel: "Holofoil" })
const cardmarket = (gbp: number) => source({ source: "cardmarket", originalCurrency: "EUR", marketGbpAmount: gbp, originalMarketAmount: gbp / FX.eurToGbp, variantLabel: "Trend" })
const ukSold = (gbp: number) => source({ source: "pokepulse", originalCurrency: "GBP", marketGbpAmount: gbp, originalMarketAmount: gbp })

function snapshot(sourcePrices: CardPriceSourceSummary[], partial: Partial<CardPriceSnapshot> = {}): CardPriceSnapshot {
  const primary = sourcePrices[0]
  return {
    cardId: "fixture-1",
    language: "en",
    gbpAmount: primary?.marketGbpAmount ?? null,
    marketGbpAmount: primary?.marketGbpAmount ?? null,
    goodGbpAmount: primary?.marketGbpAmount != null ? primary.marketGbpAmount * 0.9 : null,
    lowGbpAmount: primary?.marketGbpAmount != null ? primary.marketGbpAmount * 0.7 : null,
    highGbpAmount: primary?.marketGbpAmount != null ? primary.marketGbpAmount * 1.3 : null,
    confidence: "high",
    sourcePrices,
    trendPoints: [],
    buySignal: null,
    originalAmount: primary?.originalMarketAmount ?? null,
    originalCurrency: primary && primary.originalCurrency !== "GBP" ? primary.originalCurrency : null,
    source: primary?.source ?? null,
    variantLabel: primary?.variantLabel ?? null,
    updatedAt: primary?.updatedAt ?? null,
    fxDate: FX.date,
    ...partial,
  }
}

describe("source markets", () => {
  test("classifies providers by market", () => {
    assert.equal(getSourceMarket(tcgplayer(1)), "US")
    assert.equal(getSourceMarket(cardmarket(1)), "EU")
    assert.equal(getSourceMarket(ukSold(1)), "UK")
    assert.equal(getSourceMarket({ source: "ebay", originalCurrency: "GBP" }), "UK")
    assert.equal(getSourceMarket({ source: "ebay", originalCurrency: "USD" }), "US")
  })

  test("downgrades confidence one step", () => {
    assert.equal(downgradeConfidence("high"), "medium")
    assert.equal(downgradeConfidence("medium"), "low")
    assert.equal(downgradeConfidence("low"), "low")
    assert.equal(downgradeConfidence("unknown"), "unknown")
  })
})

describe("regionalizeCardPrice", () => {
  test("US uses TCGplayer and blends agreeing Cardmarket evidence at 20%", () => {
    const result = regionalizeCardPrice(snapshot([cardmarket(10), tcgplayer(11)]), "US")
    assert.equal(result.priceBasis, "blended")
    assert.equal(result.gbpAmount, 10.8) // 11 * 0.8 + 10 * 0.2
    assert.equal(result.source, "tcgplayer")
    assert.equal(result.nativeCurrency, "USD")
    assert.equal(result.confidence, "high")
  })

  test("UK averages Cardmarket and UK sold data and anchors on the GBP source", () => {
    const result = regionalizeCardPrice(snapshot([tcgplayer(20), cardmarket(10), ukSold(12)]), "UK")
    // Native mean 11; TCGplayer at 20 disagrees by more than 35%, so it is ignored.
    assert.equal(result.priceBasis, "native")
    assert.equal(result.gbpAmount, 11)
    assert.equal(result.source, "pokepulse")
    assert.equal(result.nativeCurrency, "GBP")
    // The range stays the snapshot range (20 * 0.7 .. 20 * 1.3), widened to include the regional price.
    assert.equal(result.lowGbpAmount, 11)
    assert.equal(result.highGbpAmount, 26)
  })

  test("EU ignores UK-only sources", () => {
    const result = regionalizeCardPrice(snapshot([ukSold(30), cardmarket(10)]), "EU")
    assert.equal(result.gbpAmount, 10)
    assert.equal(result.source, "cardmarket")
  })

  test("foreign-only evidence keeps the price and downgrades confidence", () => {
    const base = snapshot([tcgplayer(15)])
    const result = regionalizeCardPrice(base, "UK")
    assert.equal(result.priceBasis, "foreign")
    assert.equal(result.gbpAmount, 15)
    assert.equal(result.confidence, "medium")
    assert.equal(regionalizeCardPrice(base, "JP").confidence, "medium")
  })

  test("snapshots without source evidence pass through unchanged", () => {
    const base = snapshot([], { gbpAmount: 4, marketGbpAmount: 4, source: "cardmarket" })
    const result = regionalizeCardPrice(base, "US")
    assert.equal(result.priceBasis, "unchanged")
    assert.equal(result.gbpAmount, 4)
    assert.equal(result.confidence, "high")
  })

  test("never invents a price for unpriced cards", () => {
    const result = regionalizeCardPrice(snapshot([], { gbpAmount: null, marketGbpAmount: null }), "UK")
    assert.equal(result.gbpAmount, null)
  })
})

describe("display", () => {
  test("UK prices use GBP without appending foreign currencies", () => {
    const result = regionalizeCardPrice(snapshot([tcgplayer(11.66)]), "UK")
    assert.equal(formatRegionalPriceLabel(result, { currency: "GBP", fxRates: FX }), "£11.66")
  })

  test("US shows USD without a redundant USD suffix", () => {
    const result = regionalizeCardPrice(snapshot([tcgplayer(7.5)]), "US")
    assert.equal(formatRegionalPriceLabel(result, { currency: "USD", fxRates: FX }), "$10.00")
  })

  test("EU anchored on Cardmarket shows EUR only", () => {
    const result = regionalizeCardPrice(snapshot([cardmarket(8.5)]), "EU")
    assert.equal(formatRegionalPriceLabel(result, { currency: "EUR", fxRates: FX }), "€10.00")
  })

  test("explicit currency overrides use only the selected currency", () => {
    const result = regionalizeCardPrice(snapshot([ukSold(9)]), "UK")
    assert.equal(formatRegionalPriceLabel(result, { currency: "USD", fxRates: FX }), "$12.00")
  })

  test("JPY rounds to whole yen", () => {
    assert.deepEqual(convertGbpForDisplay(1.234, { currency: "JPY", fxRates: FX }), { amount: 247, currency: "JPY" })
  })

  test("falls back to rates implied by the snapshot, then to GBP", () => {
    const base = snapshot([tcgplayer(7.5)])
    assert.deepEqual(convertGbpForDisplay(7.5, { currency: "USD", fxRates: null }, base), { amount: 10, currency: "USD" })
    assert.deepEqual(convertGbpForDisplay(7.5, { currency: "JPY", fxRates: null }, base), { amount: 7.5, currency: "GBP" })
  })

  test("totals use only the selected currency", () => {
    assert.equal(formatDisplayTotals(15, { USD: 20 }, { currency: "USD", fxRates: FX }), "$20.00")
    assert.equal(formatDisplayTotals(15, { USD: 20, EUR: 5 }, { currency: "GBP", fxRates: FX }), "£15.00")
  })
})

describe("FX", () => {
  test("parses JPY from the ECB feed when present", () => {
    const xml = `<Cube time='2026-10-01'><Cube currency='USD' rate='1.2'/><Cube currency='JPY' rate='170'/><Cube currency='GBP' rate='0.85'/></Cube>`
    const rates = parseEcbFxRates(xml)
    assert.ok(Math.abs((rates.jpyToGbp ?? Number.NaN) - (0.85 / 170)) < 1e-9)
    assert.equal(parseEcbFxRates(xml.replace("rate='170'", "rate='9999'")).jpyToGbp, null)
  })

  test("normalizes API rates", () => {
    assert.deepEqual(normalizeDisplayFxRates({ date: "2026-10-01", eurToGbp: 0.85, usdToGbp: 0.75 }), { date: "2026-10-01", eurToGbp: 0.85, usdToGbp: 0.75, jpyToGbp: null })
    assert.equal(normalizeDisplayFxRates({ date: "2026-10-01", eurToGbp: -1, usdToGbp: 0.75 }), null)
    assert.equal(normalizeDisplayFxRates(null), null)
  })
})


test("card amount and range use source FX evidence when API rates are unavailable", () => {
  const price = snapshot([tcgplayer(7.5)])
  const context = { currency: "USD" as const, fxRates: null }
  assert.equal(formatDisplayAmount(7.5, context, price), "$10.00")
  assert.equal(formatDisplayRange(3, 7.5, context, price), "$4.00-$10.00")
  assert.equal(formatDisplayRange(3, 7.5, { currency: "JPY", fxRates: null }, price), "£3.00-£7.50")
  assert.equal(formatDisplayRange(null, null, context, price), null)
})
