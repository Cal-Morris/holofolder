import { test, expect } from "./fixtures"

// Uses the default harness price fixture (TEST FIXTURE ONLY): TCGplayer £0.20 ($0.26 USD) and
// Cardmarket £0.05 (€0.06 EUR), which disagree by far more than 35%.

test.describe("UK locale", () => {
  test.use({ locale: "en-GB", signedIn: true })

  test("shows UK prices and the Prices control in GBP only", async ({ harness }) => {
    await expect(harness.page.getByRole("button", { name: "Show prices", exact: true })).toHaveText("£")
    const detail = await harness.openCardDetail()
    await expect(detail.getByText("Market", { exact: true }).locator("..")).toContainText("£0.05")
    await detail.locator("summary").filter({ hasText: "Price details" }).click()
    await expect(detail.getByText("Original US$0.26 USD", { exact: true })).toBeVisible()
    await expect(detail.getByText("Original €0.06 EUR", { exact: true })).toBeVisible()
    await detail.locator("summary").filter({ hasText: "Price details" }).click()
    await detail.locator("summary").filter({ hasText: "Card & variant" }).click()
    await expect(detail.getByText("Current card", { exact: true }).locator("..").getByText("£0.05", { exact: true })).toBeVisible()
  })

  test("the card selector prices each printing for the UK", async ({ harness }) => {
    const detail = await harness.openCardDetail()
    await detail.getByRole("button", { name: /edit card|add card/i }).first().click()
    const selector = harness.page.getByRole("dialog", { name: /card selector/i })
    await expect(selector.getByText("M £0.05", { exact: true }).filter({ visible: true }).first()).toBeVisible()
    await expect(selector.getByText("M £0.20", { exact: true }).filter({ visible: true })).toHaveCount(0)
    await harness.expectNoHorizontalOverflow()
  })
})

test.describe("variant prices (UK)", () => {
  test.use({ locale: "en-GB", signedIn: true })

  test("each variant chip on the card detail shows its own UK price", async ({ harness }) => {
    // TEST FIXTURE ONLY: Bulbasaur 44 normal (Cardmarket £0.05 vs TCGplayer £0.20) and a TCGplayer-only reverse holo £0.80.
    const evidence = (gbp: number, source: "tcgplayer" | "cardmarket") => ({
      source, label: source, variantLabel: null, marketGbpAmount: gbp, lowGbpAmount: null,
      originalMarketAmount: source === "tcgplayer" ? gbp * 1.3 : gbp * 1.2, originalLowAmount: null,
      originalCurrency: source === "tcgplayer" ? "USD" : "EUR", updatedAt: new Date().toISOString(),
    })
    const quote = (gbp: number, sources: ReturnType<typeof evidence>[]) => ({
      gbpAmount: gbp, marketGbpAmount: gbp, goodGbpAmount: null, lowGbpAmount: null, highGbpAmount: null, confidence: "medium",
      sourcePrices: sources, trendPoints: [], buySignal: null, originalAmount: null, originalCurrency: null,
      source: sources[0].source, variantLabel: null, updatedAt: new Date().toISOString(), fxDate: null,
    })
    await harness.page.route("**/api/card-prices**", async (route) => {
      const lookups: Array<{ cardId: string; language?: string }> = route.request().postDataJSON()?.cards ?? []
      await route.fulfill({ json: { prices: lookups.map(({ cardId, language }) => ({
        cardId, language: language ?? "en", historyPoints: [],
        ...quote(0.2, [evidence(0.2, "tcgplayer"), evidence(0.05, "cardmarket")]),
        finishPrices: cardId === "base1-44" ? [
          { ...quote(0.2, [evidence(0.2, "tcgplayer"), evidence(0.05, "cardmarket")]), cardId, language: "en", finish: "normal", variantKey: "normal" },
          { ...quote(0.8, [evidence(0.8, "tcgplayer")]), cardId, language: "en", finish: "reverse_holo", variantKey: "reverseHolofoil" },
          { ...quote(90, [evidence(90, "tcgplayer")]), cardId, language: "en", finish: "normal", variantKey: "1st-edition" },
        ] : [],
      })) } })
    })
    await harness.page.addInitScript(() => {
      localStorage.removeItem("binderdex_card_price_cache_v7")
      indexedDB.deleteDatabase("binderdex-offline")
    })
    await harness.open()

    const detail = await harness.openCardDetail()
    await detail.locator("summary").filter({ hasText: "Card & variant" }).click()
    await expect(detail.getByRole("button", { name: "Normal, £0.05", exact: true })).toBeVisible()
    await expect(detail.getByRole("button", { name: "Reverse, £0.80", exact: true })).toBeVisible()
    // No quote for a finish: the chip stays a plain label.
    await expect(detail.getByRole("button", { name: "Holo", exact: true })).toBeVisible()
    await harness.expectNoHorizontalOverflow()
  })
})

test.describe("US locale", () => {
  test.use({ locale: "en-US", signedIn: true })

  test("leads with the TCGplayer price in USD", async ({ harness }) => {
    const detail = await harness.openCardDetail()
    await expect(detail.getByText("Market", { exact: true }).locator("..")).toContainText("$0.26")
    await detail.locator("summary").filter({ hasText: "Card & variant" }).click()
    await expect(detail.getByText("Current card", { exact: true }).locator("..").getByText("$0.26", { exact: true })).toBeVisible()
  })

  test("the card selector prices each printing in USD", async ({ harness }) => {
    const detail = await harness.openCardDetail()
    await detail.getByRole("button", { name: /edit card|add card/i }).first().click()
    const selector = harness.page.getByRole("dialog", { name: /card selector/i })
    await expect(selector.getByText("M $0.26", { exact: true }).filter({ visible: true }).first()).toBeVisible()
    await expect(selector.getByText(/£/).filter({ visible: true })).toHaveCount(0)
  })
})
