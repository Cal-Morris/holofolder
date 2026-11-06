import { test, expect } from "./fixtures"
import { clearCardPriceCache, mockCardPrices } from "./price-fixtures"

test.describe("analytics dashboard", () => {
  test.use({ signedIn: true })
  for (const theme of ["light", "dark"]) {
    test(`collection breakdown and card paths in ${theme}`, async ({ harness }, testInfo) => {
      const page = harness.page
      // Synthetic exact-finish prices, never real provider requests.
      await mockCardPrices(page, { "base1-44": { market: 12, confidence: "high", finishes: [{ finish: "normal", market: 12 }] } })
      await page.route("**/api/collection-analytics?**", route => route.fulfill({ json: { historyAvailable: true, activity: [], priceHistory: [], nextCursor: null } }))
      await clearCardPriceCache(page)
      await page.reload()
      await page.evaluate(theme => document.documentElement.classList.toggle("dark", theme === "dark"), theme)
      await page.getByRole("button", { name: "More", exact: true }).click()
      await page.getByRole("menuitem", { name: "Analytics", exact: true }).click()
      const overview = page.getByRole("region", { name: "Collection overview" })
      await expect(overview.getByText("£12.00", { exact: true })).toBeVisible()
      await expect(overview.getByText("1 of 2 owned cards priced", { exact: false })).toBeVisible()
      await harness.expectNoHorizontalOverflow()
      await page.screenshot({ path: testInfo.outputPath(`analytics-${theme}.png`) })
      const cards = page.getByRole("region", { name: "Explore collection cards" })
      await overview.getByRole("button", { name: "1 unpriced, excluded from value" }).click()
      await expect(cards.getByRole("button", { name: "Browse Charmander cards" })).toBeVisible()
      await page.getByRole("region", { name: "Owned cards by set" }).getByRole("button", { name: "Base Set" }).click()
      await expect(cards.getByRole("button", { name: "Browse Bulbasaur cards" })).toBeVisible()
      await expect(cards.getByRole("button", { name: "Browse Charmander cards" })).toBeVisible()
      const browse = cards.getByRole("button", { name: "Browse Bulbasaur cards" })
      await harness.expectMinTapTarget(browse)
      await browse.click()
      const dialog = page.getByRole("dialog", { name: "All Bulbasaur cards", exact: true })
      await expect(dialog).toBeVisible()
      await harness.closeControl(dialog).click()
      await cards.getByRole("button", { name: "Price details for Bulbasaur" }).click()
      await expect(page.getByRole("region", { name: "Card price history" })).toBeFocused()
      await expect(page.getByLabel("History card", { exact: true })).toHaveValue(/base1-44/)
      await page.context().setOffline(true)
      await expect(page.getByText("Offline, showing cached collection", { exact: false })).toBeVisible()
      await harness.expectNoHorizontalOverflow()
      await page.context().setOffline(false)
    })
  }
  test("desktop overview uses two columns", async ({ harness }, testInfo) => {
    test.skip(testInfo.project.name !== "browser-390x844", "One desktop check")
    await harness.page.setViewportSize({ width: 1440, height: 1000 })
    await harness.page.getByRole("button", { name: "More", exact: true }).click()
    await harness.page.getByRole("menuitem", { name: "Analytics", exact: true }).click()
    const sets = await harness.page.getByRole("region", { name: "Owned cards by set" }).boundingBox()
    const cards = await harness.page.getByRole("region", { name: "Explore collection cards" }).boundingBox()
    expect(cards!.x).toBeGreaterThan(sets!.x + sets!.width)
    await harness.expectNoHorizontalOverflow()
    await harness.page.screenshot({ path: testInfo.outputPath("analytics-desktop.png") })
  })
})
