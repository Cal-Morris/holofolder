import { test, expect } from "./fixtures"
import { mockCardPrices } from "./price-fixtures"

test.use({ signedIn: true })

test("eBay asks load on demand and remain separate from the card valuation", async ({ harness }) => {
  // Synthetic market quote and asking-price sample, never real sale data.
  await mockCardPrices(harness.page, { "base1-44": { confidence: "medium", market: 8 } })
  await harness.page.addInitScript(() => localStorage.removeItem("binderdex_card_price_cache_v7"))
  let lookups = 0
  await harness.page.route("**/api/ebay/listings?**", async route => {
    lookups++
    expect(new URL(route.request().url()).searchParams.get("cardId")).toBe("base1-44")
    await route.fulfill({ json: { summary: { kind: "asking", currency: "GBP", count: 3, median: 12, low: 10, high: 20 }, checkedAt: "2026-10-27T12:00:00Z", searchUrl: "https://www.ebay.co.uk/sch/i.html?_nkw=Bulbasaur" } })
  })
  await harness.page.reload()
  const detail = await harness.openCardDetail()
  const market = detail.getByText("Market", { exact: true }).locator("..")
  await expect(market).toContainText("£8.00")
  await detail.getByText("Price details", { exact: true }).click()
  const indicator = detail.getByRole("region", { name: "eBay asking prices" })
  await expect(indicator.getByText(/Active listings, not sold prices/)).toBeVisible()
  expect(lookups).toBe(0)
  const check = indicator.getByRole("button", { name: "Check eBay asking prices" })
  await harness.expectMinTapTarget(check)
  await check.click()
  await expect(indicator.getByText(/£12.00.*median asking price.*3 matched listings/)).toBeVisible()
  await expect(indicator.getByText(/postage excluded/)).toBeVisible()
  await expect(market).toContainText("£8.00")
  const link = indicator.getByRole("link", { name: "View listings on eBay" })
  await expect(link).toHaveAttribute("href", /^https:\/\/www\.ebay\.co\.uk\//)
  await harness.expectMinTapTarget(link)
  await harness.expectNoHorizontalOverflow()
})

test("eBay lookup degrades clearly offline without making a request", async ({ harness, context }) => {
  let lookups = 0
  await harness.page.route("**/api/ebay/listings?**", async route => { lookups++; await route.abort() })
  const detail = await harness.openCardDetail()
  await detail.getByText("Price details", { exact: true }).click()
  await context.setOffline(true)
  await detail.getByRole("button", { name: "Check eBay asking prices" }).click()
  await expect(detail.getByRole("status")).toHaveText("Connect to the internet to check eBay listings.")
  expect(lookups).toBe(0)
  await context.setOffline(false)
})

test("eBay lookup failure and an empty sample do not invent a price", async ({ harness }) => {
  let failed = true
  await harness.page.route("**/api/ebay/listings?**", async route => {
    if (failed) await route.fulfill({ status: 503, json: { error: "eBay listings are temporarily unavailable. Try again later." } })
    else await route.fulfill({ json: { summary: { kind: "asking", currency: "GBP", count: 0, median: null, low: null, high: null }, checkedAt: "2026-10-27T12:00:00Z", searchUrl: "https://www.ebay.co.uk/sch/i.html?_nkw=Bulbasaur" } })
  })
  const detail = await harness.openCardDetail()
  await detail.getByText("Price details", { exact: true }).click()
  const indicator = detail.getByRole("region", { name: "eBay asking prices" })
  await indicator.getByRole("button", { name: "Check eBay asking prices" }).click()
  await expect(indicator.getByRole("status")).toContainText("temporarily unavailable")
  failed = false
  await indicator.getByRole("button", { name: "Check eBay asking prices" }).click()
  await expect(indicator.getByText("No matching listings in the search sample.")).toBeVisible()
  await expect(indicator.getByText(/median asking price/)).toHaveCount(0)
  await harness.expectNoHorizontalOverflow()
})

test("eBay lookup is available when the card has no market quote", async ({ harness }) => {
  await mockCardPrices(harness.page, {})
  await harness.page.addInitScript(() => localStorage.removeItem("binderdex_card_price_cache_v7"))
  await harness.page.reload()
  const detail = await harness.openCardDetail()
  await detail.getByText("Price details", { exact: true }).click()
  await expect(detail.getByRole("button", { name: "Check eBay asking prices" })).toBeVisible()
  await expect(detail.getByRole("region", { name: "eBay asking prices" })).toContainText("Active listings, not sold prices")
})

test("eBay listings API requires a signed-in session", async ({ request }) => {
  const response = await request.get("/api/ebay/listings?cardId=base1-44")
  expect(response.status()).toBe(401)
  expect(response.headers()["cache-control"]).toBe("no-store")
})
