import { test, expect } from "./fixtures"

// Uses the default harness price fixture (TEST FIXTURE ONLY): TCGplayer £0.20 ($0.26 USD) and
// Cardmarket £0.05 (€0.06 EUR), which disagree by far more than 35%.

test.describe("UK locale", () => {
  test.use({ locale: "en-GB", signedIn: true })

  test("shows UK prices and the Prices control in GBP only", async ({ harness }) => {
    // The Prices toggle lives in Controls (the dock no longer repeats it).
    await harness.page.getByTestId("app-header").getByRole("button", { name: "View" }).click()
    await expect(harness.page.getByRole("button", { name: "Prices", exact: true })).toBeVisible()
    await harness.page.getByRole("button", { name: "Close view options" }).click()
    const detail = await harness.openCardDetail()
    await expect(detail.getByText("Market", { exact: true }).locator("..")).toContainText("£0.05")
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

test.describe("list prices (UK)", () => {
  test.use({ locale: "en-GB", signedIn: true })

  test("all-cards browse and set checklists use the UK price", async ({ harness }) => {
    const detail = await harness.openCardDetail()
    await detail.getByRole("button", { name: /all bulbasaur cards/i }).click()
    const browser = harness.page.getByRole("dialog", { name: /all bulbasaur cards/i })
    const tile = browser.getByRole("listitem", { name: /44\/102 base set/i })
    await expect(tile).toContainText("£0.05")
    await expect(tile).not.toContainText("£0.20")
    await harness.page.keyboard.press("Escape")
    await harness.page.keyboard.press("Escape")
    await expect(harness.dialogs()).toHaveCount(0)

    // TEST FIXTURE ONLY: a one-card set.
    const set = { id: "fixture-set", name: "Fixture Set", officialCardCount: 1 }
    const card = { id: "fixture-set-1", localId: "1", name: "Fixture Bulbasaur", language: "en", set, inferredFinish: "normal" }
    await harness.page.route("**/api/tcg-set-slots**", (route) => route.fulfill({ json: new URL(route.request().url()).searchParams.has("setId")
      ? { sets: [set], selectedSet: set, cards: [card], slots: [{ dexId: 1, pokemonName: "bulbasaur", cards: [card] }] }
      : { sets: [set], selectedSet: null, slots: [] } }))
    await harness.dock().getByRole("button", { name: "Browse", exact: true }).click()
    await harness.page.getByRole("textbox", { name: "Search sets by name or code" }).fill("fixture")
    await harness.page.getByRole("button", { name: /Fixture Set/ }).first().click()
    await harness.page.getByRole("group", { name: "Set checklist" }).getByRole("button", { name: "Cards", exact: true }).click()
    const row = harness.page.getByRole("list", { name: "Fixture Set card checklist" }).getByRole("listitem", { name: /fixture bulbasaur/i })
    await expect(row).toContainText("£0.05")
    await expect(row).not.toContainText("£0.20")
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

test.describe("card picker price sort (UK)", () => {
  test.use({ locale: "en-GB", signedIn: true })

  // TEST FIXTURE ONLY: synthetic Squirtle quotes, one printing unpriced.
  const QUOTES: Record<string, number | null> = { "sv03.5-007": 0.5, "30th-007": 12, "30th-c-003": null }

  test("sorts printings by UK price in Add and Wanted modes, remembers it and works offline", async ({ harness }) => {
    const { page } = harness
    await page.route("**/api/card-prices**", async (route) => {
      const lookups: Array<{ cardId: string; language?: string }> = route.request().postDataJSON()?.cards ?? []
      await route.fulfill({ json: { prices: lookups.map(({ cardId, language }) => {
        const gbp = QUOTES[cardId] ?? null
        return {
          cardId, language: language ?? "en", gbpAmount: gbp, marketGbpAmount: gbp, goodGbpAmount: null, lowGbpAmount: null,
          highGbpAmount: null, confidence: gbp ? "medium" : "unknown", trendPoints: [], historyPoints: [], finishPrices: [],
          sourcePrices: gbp ? [{ source: "cardmarket", label: "Cardmarket", variantLabel: null, marketGbpAmount: gbp, lowGbpAmount: null,
            originalMarketAmount: gbp * 1.2, originalLowAmount: null, originalCurrency: "EUR", updatedAt: new Date().toISOString() }] : [],
          source: gbp ? "cardmarket" : null, variantLabel: null, originalAmount: gbp ? gbp * 1.2 : null, originalCurrency: gbp ? "EUR" : null,
          updatedAt: new Date().toISOString(), fxDate: null, buySignal: null,
        }
      }) } })
    })
    await page.addInitScript(() => {
      localStorage.removeItem("binderdex_card_price_cache_v7")
      indexedDB.deleteDatabase("binderdex-offline")
    })
    await harness.open()

    const openSquirtle = async () => {
      await page.locator('button[data-dex-id="7"]').first().click()
      const detail = page.getByRole("dialog", { name: /squirtle details/i })
      await expect(detail).toBeVisible()
      return detail
    }
    const selector = page.getByRole("dialog", { name: /card selector/i })
    const filtersButton = selector.getByRole("button", { name: /filters · sort/i })
    const sheet = page.getByRole("dialog", { name: "Filters and sort" })
    const sortSelect = sheet.getByRole("combobox", { name: "Sort cards" })
    const order = () => selector.getByRole("button", { name: /^(Add|Want) card Squirtle from / })
      .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")!.replace(/^(Add|Want) card Squirtle from /, "")))
    const chooseSort = async (label: string) => {
      await filtersButton.click()
      await sortSelect.selectOption({ label })
      await sheet.getByRole("button", { name: /^Show \d+ cards?$/ }).click()
      await expect(sheet).toHaveCount(0)
      await expect(selector.getByRole("button", { name: `Remove filter ${label}` })).toBeVisible()
    }

    await (await openSquirtle()).getByRole("button", { name: "Add card", exact: true }).click()
    await expect(selector.getByText("M £12.00", { exact: true }).filter({ visible: true })).toBeVisible()
    await expect(selector.getByRole("list", { name: "Active filters" })).toHaveCount(0)
    expect((await filtersButton.boundingBox())!.height).toBeGreaterThanOrEqual(36)

    await chooseSort("Price: high to low")
    await expect.poll(order).toEqual(["30th Celebration", "151", "30th Classic Collection"])
    await chooseSort("Price: low to high")
    await expect.poll(order).toEqual(["151", "30th Celebration", "30th Classic Collection"])
    await harness.expectNoHorizontalOverflow()

    // Wanted mode keeps the same sort.
    await selector.getByRole("group", { name: "Picker mode" }).getByRole("button", { name: "Wanted" }).click()
    await expect.poll(order).toEqual(["151", "30th Celebration", "30th Classic Collection"])
    await chooseSort("Price: high to low")
    await expect.poll(order).toEqual(["30th Celebration", "151", "30th Classic Collection"])

    // Remembered for the session, and still sorted from cached prices with the price API offline.
    await selector.getByRole("button", { name: "Close card selector" }).click()
    await expect(selector).toHaveCount(0)
    await page.keyboard.press("Escape")
    await page.unroute("**/api/card-prices**")
    await page.route("**/api/card-prices**", (route) => route.abort("internetdisconnected"))
    await page.context().setOffline(true)
    await (await openSquirtle()).getByRole("button", { name: /^(want card|add wanted|track wanted)$/i }).click()
    await expect(selector).toBeVisible()
    await expect(selector.getByRole("button", { name: "Remove filter Price: high to low" })).toBeVisible()
    await expect(selector.getByRole("status").filter({ hasText: /offline/i })).toBeVisible()
    await expect.poll(order).toEqual(["30th Celebration", "151", "30th Classic Collection"])
    await page.context().setOffline(false)
  })
})
