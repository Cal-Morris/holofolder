import { test, expect } from "./fixtures"
import { mockCardPrices } from "./price-fixtures"

test.use({ signedIn: true })
test("dated history stays native USD and remains distinct from current GBP quotes", async ({ harness }) => {
  await mockCardPrices(harness.page, {
    // Synthetic native USD history and a separate current GBP quote.
    "base1-44": { confidence: "medium", market: 8, history: [
      { date: "2026-09-14", source: "tcgplayer", currency: "USD", amount: 4, lowAmount: 2, finish: "normal", productId: "123" },
      { date: "2026-09-15", source: "tcgplayer", currency: "USD", amount: 5, lowAmount: 3, finish: "normal", productId: "123" },
    ] },
  })
  await harness.page.addInitScript(() => localStorage.removeItem("binderdex_card_price_cache_v7"))
  await harness.page.reload()
  await expect(harness.dock()).toBeVisible()
  await expect.poll(() => harness.page.evaluate(() => JSON.parse(localStorage.getItem("binderdex_card_price_cache_v7") ?? "{}")["base1-44::en"]?.marketGbpAmount)).toBe(8)
  const detail = await harness.openCardDetail()
  await detail.getByText("Price details", { exact: true }).click()
  const history = detail.getByLabel("Recorded price history")
  await expect(history).toBeVisible()
  await harness.expectMinTapTarget(history.locator("summary"))
  await history.locator("summary").click()
  await expect(history.getByRole("table")).toBeVisible()
  await expect(history.getByRole("cell", { name: /^(?:US)?\$5\.00$/ })).toBeVisible()
  await expect(history.getByText(/US market quotes, not sold listings/)).toBeVisible()
  await harness.expectNoHorizontalOverflow()
})
