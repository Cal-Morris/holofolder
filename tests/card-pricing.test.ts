import test from "node:test"
import assert from "node:assert/strict"
import {
  buildCardPriceSnapshotFromPricing,
  buildPokePulseSearchPriceSnapshot,
  buildTcgplayerProductPriceSnapshot,
  fetchCardPriceSnapshot,
  pickPokePulseSearchItem,
  pickPokePulseMarketDataRecord,
  pickTcgplayerSearchProduct,
  pickTcgplayerProductIdsFromExternalIds,
} from "../lib/card-pricing"

const fxRates = {
  date: "2026-06-28",
  eurToGbp: 0.85,
  usdToGbp: 0.75,
}

test("buildCardPriceSnapshotFromPricing uses TCGplayer market as market and low as show target for English cards", () => {
  const snapshot = buildCardPriceSnapshotFromPricing("sv1-001", "en", {
    tcgplayer: {
      updated: "2026-06-27T10:00:00.000Z",
      normal: {
        lowPrice: 8,
        midPrice: 12,
        marketPrice: 10,
        highPrice: 14,
      },
    },
    cardmarket: {
      updated: "2026-06-27T00:00:00.000Z",
      trend: 9,
      avg1: 8.8,
      avg7: 8.6,
      avg30: 8.4,
      low: 7,
    },
  }, fxRates)

  assert.equal(snapshot.gbpAmount, 7.5)
  assert.equal(snapshot.marketGbpAmount, 7.5)
  assert.equal(snapshot.goodGbpAmount, 6)
  assert.equal(snapshot.lowGbpAmount, 5.95)
  assert.equal(snapshot.highGbpAmount, 8.8)
  assert.equal(snapshot.confidence, "high")
  assert.equal(snapshot.source, "tcgplayer")
  assert.equal(snapshot.variantLabel, "Normal")
  assert.deepEqual(snapshot.sourcePrices.map((source) => ({
    source: source.source,
    marketGbpAmount: source.marketGbpAmount,
    lowGbpAmount: source.lowGbpAmount,
    variantLabel: source.variantLabel,
  })), [
    { source: "tcgplayer", marketGbpAmount: 7.5, lowGbpAmount: 6, variantLabel: "Normal" },
    { source: "cardmarket", marketGbpAmount: 7.65, lowGbpAmount: 5.95, variantLabel: "Trend" },
  ])
  assert.deepEqual(snapshot.trendPoints.map((point) => ({
    label: point.label,
    gbpAmount: point.gbpAmount,
    source: point.source,
  })), [
    { label: "30d", gbpAmount: 7.14, source: "cardmarket" },
    { label: "7d", gbpAmount: 7.31, source: "cardmarket" },
    { label: "1d", gbpAmount: 7.48, source: "cardmarket" },
    { label: "Trend", gbpAmount: 7.65, source: "cardmarket" },
  ])
})

test("buildCardPriceSnapshotFromPricing prefers Cardmarket trend for European languages", () => {
  const snapshot = buildCardPriceSnapshotFromPricing("sv1-002", "fr", {
    tcgplayer: {
      updated: "2026-06-27T10:00:00.000Z",
      normal: {
        lowPrice: 20,
        marketPrice: 30,
      },
    },
    cardmarket: {
      updated: "2026-06-27T00:00:00.000Z",
      trend: 18,
      low: 12,
    },
  }, fxRates)

  assert.equal(snapshot.gbpAmount, 15.3)
  assert.equal(snapshot.marketGbpAmount, 15.3)
  assert.equal(snapshot.goodGbpAmount, 10.2)
  assert.equal(snapshot.lowGbpAmount, 10.2)
  assert.equal(snapshot.highGbpAmount, 25.88)
  assert.equal(snapshot.confidence, "low")
  assert.equal(snapshot.source, "cardmarket")
  assert.equal(snapshot.variantLabel, "Trend")
})

test("buildCardPriceSnapshotFromPricing marks inferred price ranges as medium confidence", () => {
  const snapshot = buildCardPriceSnapshotFromPricing("sv1-003", "en", {
    tcgplayer: {
      updated: "2026-06-27T10:00:00.000Z",
      normal: {
        marketPrice: 10,
      },
    },
  }, fxRates)

  assert.equal(snapshot.marketGbpAmount, 7.5)
  assert.equal(snapshot.goodGbpAmount, 6)
  assert.equal(snapshot.lowGbpAmount, 6.38)
  assert.equal(snapshot.highGbpAmount, 8.63)
  assert.equal(snapshot.confidence, "medium")
})

test("buildCardPriceSnapshotFromPricing lowers confidence and widens range when sources disagree", () => {
  const snapshot = buildCardPriceSnapshotFromPricing("sv1-004", "en", {
    tcgplayer: {
      updated: "2026-06-27T10:00:00.000Z",
      normal: {
        lowPrice: 8,
        marketPrice: 10,
      },
    },
    cardmarket: {
      updated: "2026-06-27T00:00:00.000Z",
      trend: 20,
      avg1: 19,
      avg7: 18,
      avg30: 16,
      low: 15,
    },
  }, fxRates)

  assert.equal(snapshot.marketGbpAmount, 7.5)
  assert.equal(snapshot.lowGbpAmount, 6)
  assert.equal(snapshot.highGbpAmount, 19.55)
  assert.equal(snapshot.confidence, "low")
  assert.equal(snapshot.sourcePrices.length, 2)
})

test("a catalog printing only uses its own product price", () => {
  assert.deepEqual(pickTcgplayerProductIdsFromExternalIds({ catalog: { productId: "685563" }, tcgdex: { thirdParty: { tcgplayer: 685562 } } }), ["685563"])
})

test("a missing localized card cannot borrow its English product price", async () => {
  const originalFetch = globalThis.fetch
  const requests: string[] = []
  // Synthetic provider responses distinguish English product evidence from Japanese absence.
  globalThis.fetch = (async (url: string | URL | Request) => {
    requests.push(String(url))
    return String(url).includes("tcgdex.net")
      ? new Response("not found", { status: 404 })
      : Response.json({ productId: 685563, marketPrice: 20, lowestPrice: 18 })
  }) as typeof fetch
  try {
    const metadata = { id: "mep-070~685563", name: "Tyrunt (Pokémon Center)", localId: "070", setName: "MEP Black Star Promos", rarity: "Promo", externalIds: { catalog: { productId: "685563", variantId: "stamp", tcgdexCardId: "mep-070" } } }
    const japanese = await fetchCardPriceSnapshot(metadata.id, "ja", fxRates, metadata)
    assert.equal(japanese.marketGbpAmount, null)
    assert.equal(requests.length, 1)
    const english = await fetchCardPriceSnapshot(metadata.id, "en", fxRates, metadata)
    assert.equal(english.marketGbpAmount, 15)
    assert.equal(english.cardId, metadata.id)
  } finally { globalThis.fetch = originalFetch }
})

test("an English-only stamp cannot reuse English variant evidence returned by a localized endpoint", async () => {
  const originalFetch = globalThis.fetch
  // Synthetic quote intentionally appears under a French endpoint with the same English product ID.
  globalThis.fetch = (async () => Response.json({ variants_detailed: [{ variantId: "stamp", type: "holo", thirdParty: { tcgplayer: 685563 }, pricing: { tcgplayer: { holo: { marketPrice: 20, lowPrice: 18 } } } }] })) as typeof fetch
  try {
    const snapshot = await fetchCardPriceSnapshot("mep-070~685563", "fr", fxRates, { id: "mep-070~685563", name: "Tyrunt", localId: "070", setName: "Promos", rarity: "Promo", externalIds: { catalog: { productId: "685563", variantId: "stamp", tcgdexCardId: "mep-070" } } })
    assert.equal(snapshot.marketGbpAmount, null)
  } finally { globalThis.fetch = originalFetch }
})

test("pickTcgplayerProductIdsFromExternalIds reads direct and variant product ids", () => {
  const ids = pickTcgplayerProductIdsFromExternalIds({
    tcgdex: {
      thirdParty: { tcgplayer: 123 },
      variantThirdParty: [
        { tcgplayer: 456 },
        { tcgplayer: "456" },
        { tcgplayer: "bad" },
      ],
    },
  })

  assert.deepEqual(ids, ["123", "456"])
})

test("buildTcgplayerProductPriceSnapshot builds a fallback from exact TCGplayer product details", () => {
  const snapshot = buildTcgplayerProductPriceSnapshot("mep-027", "en", {
    productId: 659232,
    productName: "Haunter - 027",
    rarityName: "Illustration Rare",
    marketPrice: 56.59,
    lowestPriceWithShipping: 50,
    setCode: "MEP",
    setName: "ME: Mega Evolution Promo",
    customAttributes: {
      number: "027",
    },
  }, fxRates)

  assert.equal(snapshot?.marketGbpAmount, 42.44)
  assert.equal(snapshot?.goodGbpAmount, 37.5)
  assert.equal(snapshot?.lowGbpAmount, 37.5)
  assert.equal(snapshot?.highGbpAmount, 48.81)
  assert.equal(snapshot?.source, "tcgplayer")
  assert.equal(snapshot?.variantLabel, "Illustration Rare")
  assert.equal(snapshot?.confidence, "medium")
  assert.equal(snapshot?.sourcePrices[0].originalMarketAmount, 56.59)
})

test("pickTcgplayerSearchProduct accepts exact black star promo number matches outside TCGdex pricing", () => {
  const product = pickTcgplayerSearchProduct({
    name: "Rowlet",
    localId: "SM01",
    setName: "SM Black Star Promos",
    rarity: "Promo",
  }, [
    {
      productId: 140167,
      productName: "Rowlet - SM01 (General Mills Promo)",
      setName: "Miscellaneous Cards & Products",
      rarityName: "Promo",
      marketPrice: 2.76,
      lowestPrice: 0.2,
      customAttributes: { number: "SM01" },
    },
  ])

  assert.equal(product?.productId, 140167)
})

test("pickTcgplayerSearchProduct rejects jumbo and wrong collector number matches", () => {
  const product = pickTcgplayerSearchProduct({
    name: "Rowlet",
    localId: "SM01",
    setName: "SM Black Star Promos",
    rarity: "Promo",
  }, [
    {
      productId: 205166,
      productName: "Charizard GX - SM211 (SM Black Star Promo)",
      setName: "Jumbo Cards",
      rarityName: "Promo",
      marketPrice: 9.99,
      customAttributes: { number: "SM211" },
    },
    {
      productId: 123,
      productName: "Rowlet - SM02 (SM Black Star Promo)",
      setName: "SM Black Star Promos",
      rarityName: "Promo",
      marketPrice: 9.99,
      customAttributes: { number: "SM02" },
    },
  ])

  assert.equal(product, null)
})

test("pickPokePulseSearchItem prefers priced non-jumbo exact promo matches", () => {
  const item = pickPokePulseSearchItem({
    name: "Rowlet",
    localId: "SM01",
    setName: "Sun & Moon Promos",
    rarity: "Promo",
  }, [
    {
      slug: "rowlet-sm01-jumbo-size-25th-anniversary",
      name: "Rowlet",
      setName: "Sun & Moon Promos",
      number: "SM01",
      material: "Jumbo Size",
      currentPrice: 4.38,
    },
    {
      slug: "rowlet-sm01-holo",
      name: "Rowlet",
      setName: "Sun & Moon Promos",
      number: "SM01",
      material: "Holo",
      currentPrice: 4.95,
    },
  ])

  assert.equal(item?.slug, "rowlet-sm01-holo")
})

test("pickPokePulseMarketDataRecord reads product-keyed internal market data", () => {
  const record = pickPokePulseMarketDataRecord({
    success: true,
    data: {
      "card:smp|SM01|Holo|null|null|null": {
        market_price: { value: 4.95 },
        last_sold_price: 4.5,
      },
    },
  }, "card:smp|SM01|Holo|null|null|null")

  assert.deepEqual(record, {
    market_price: { value: 4.95 },
    last_sold_price: 4.5,
  })
})

test("buildPokePulseSearchPriceSnapshot uses internal market data for trends and confidence", () => {
  const snapshot = buildPokePulseSearchPriceSnapshot("smp-SM01", "en", {
    slug: "rowlet-sm01-holo",
    productId: "card:smp|SM01|Holo|null|null|null",
    name: "Rowlet",
    setName: "Sun & Moon Promos",
    number: "SM01",
    material: "Holo",
    currentPrice: 4.95,
  }, {
    marketAmount: 5,
    lastSoldAmount: 4.6,
    averageAmount: 4.8,
    salesVolume: 12,
    trendPoints: [
      {
        label: "2026-06-26",
        source: "pokepulse",
        gbpAmount: 4.7,
        originalAmount: 4.7,
        originalCurrency: "GBP",
      },
    ],
  })

  assert.equal(snapshot?.marketGbpAmount, 5)
  assert.equal(snapshot?.goodGbpAmount, 4.25)
  assert.equal(snapshot?.confidence, "medium")
  assert.equal(snapshot?.sourcePrices[0].label, "PokePulse market data")
  assert.deepEqual(snapshot?.trendPoints.map((point) => point.label), ["2026-06-26"])
})

// Synthetic finish prices: normal, holo and reverse must remain separate.
test("pricing retains each exact finish and does not attach normal trends to holo", () => {
  const snapshot = buildCardPriceSnapshotFromPricing("synthetic-1", "en", {
    tcgplayer: { updated: "2026-10-10T10:00:00Z", normal: { marketPrice: 10, lowPrice: 9 }, holofoil: { marketPrice: 30, lowPrice: 28 }, reverseHolofoil: { marketPrice: 20, lowPrice: 18 } },
    cardmarket: { updated: "2026-10-10T10:00:00Z", trend: 9, avg7: 7, low: 8, "trend-holo": 90, "avg7-holo": 10 },
  }, fxRates, { normal: true, holo: false, reverse: true })
  assert.deepEqual(snapshot.finishPrices?.map((price) => [price.finish, price.marketGbpAmount]), [["normal", 7.5], ["holo", 22.5], ["reverse_holo", 15]])
  assert.ok(snapshot.finishPrices?.find((price) => price.finish === "normal")?.trendPoints.length)
  assert.deepEqual(snapshot.finishPrices?.find((price) => price.finish === "holo")?.trendPoints, [])
  assert.deepEqual(snapshot.finishPrices?.find((price) => price.finish === "reverse_holo")?.trendPoints, [])
})

test("ambiguous base and foil prices cannot become an exact finish", () => {
  const snapshot = buildCardPriceSnapshotFromPricing("synthetic-2", "en", {
    cardmarket: { trend: 9, low: 8, "trend-holo": 10 },
  }, fxRates, { normal: true, holo: true, reverse: true })
  assert.deepEqual(snapshot.finishPrices, [])
})

test("finish prices never borrow another provider's timestamp for an undated quote", () => {
  // Synthetic TCGplayer quote has no source date; Cardmarket does.
  const snapshot = buildCardPriceSnapshotFromPricing("synthetic-undated", "en", {
    tcgplayer: { normal: { marketPrice: 10, lowPrice: 9 } },
    cardmarket: { updated: "2026-10-10T10:00:00Z", trend: 9, avg7: 7, low: 8 },
  }, fxRates, { normal: true, holo: false })
  assert.equal(snapshot.finishPrices?.[0].source, "tcgplayer")
  assert.equal(snapshot.finishPrices?.[0].updatedAt, null)
})
