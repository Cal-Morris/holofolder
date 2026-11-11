import { mockCardPrices } from "./price-fixtures"
import { test, expect } from "./fixtures"

async function openAnalytics(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "More", exact: true }).click()
  await page.getByRole("menuitem", { name: "Analytics", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Analytics", exact: true })).toBeVisible()
}

test("analytics preserves phone dock and honestly separates completion from pricing", async ({ harness }) => {
  const page = harness.page
  await harness.open()
  await openAnalytics(page)
  // A guest sees the harness's two seeded owned Pokémon, read-only.
  await expect(page.getByText("2 / 1025", { exact: true })).toBeVisible()
  await expect(page.getByText(/of 2 owned cards priced/).first()).toBeVisible()
  await expect(page.getByText("Sign in to record private history.", { exact: true })).toBeVisible()
  const geometry = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }))
  expect(geometry.scroll).toBeLessThanOrEqual(geometry.width)
  await page.getByRole("button", { name: "List", exact: true }).last().click()
  await expect(page.getByRole("heading", { name: "List", exact: true })).toBeVisible()
})

test("an unavailable analytics chunk preserves the current view and dock", async ({ harness }) => {
  const page = harness.page
  // Idle preload could already have fetched Analytics; turn it off so the chunk is still
  // missing when the route is blocked.
  await page.addInitScript(() => { window.requestIdleCallback = () => 0 })
  await harness.open()
  await page.route("**/app/_next/static/chunks/*.js", route => route.abort())
  await page.getByRole("button", { name: "More", exact: true }).click()
  await page.getByRole("menuitem", { name: "Analytics", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: "Analytics could not load" })).toBeVisible()
  await harness.expectHittable(harness.dock().getByRole("button", { name: "List", exact: true }))
  await page.unroute("**/app/_next/static/chunks/*.js")
  await harness.dock().getByRole("button", { name: "List", exact: true }).click()
  await expect(page.getByRole("heading", { name: "List", exact: true })).toBeVisible()
})

test("read-only binders expose no private analytics destination", async ({ harness }) => {
  const page = harness.page
  await page.goto("/app/e2e-harness?readOnly=1")
  await page.getByRole("button", { name: "More", exact: true }).click()
  await expect(page.getByRole("menuitem", { name: "Analytics", exact: true })).toHaveCount(0)
})

test.describe("collection export", () => {
  test.use({ signedIn: true })

  test("exports the collection as a CSV, offline too", async ({ harness }) => {
    const page = harness.page
    await harness.open()
    await openAnalytics(page)
    await page.context().setOffline(true)
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Export CSV", exact: true }).click(),
    ])
    await page.context().setOffline(false)
    expect(download.suggestedFilename()).toMatch(/^holofolder-collection-\d{4}-\d{2}-\d{2}\.csv$/)
    const fs = await import("node:fs/promises")
    const lines = (await fs.readFile((await download.path())!, "utf8")).trimEnd().split("\r\n")
    expect(lines[0]).toBe("dex_number,pokemon,list,slot_status,card_id,card_name,set,language,finish,market_gbp,price_source,price_basis,added")
    expect(lines.length).toBeGreaterThan(1)
    await harness.expectNoHorizontalOverflow()
  })
})


test.describe("manual analytics comparisons", () => {
  test.use({ signedIn: true })
  test("price evidence offers the shared comparison without automatic source requests", async ({ harness }) => {
    let requests = 0
    await mockCardPrices(harness.page, { "base1-44": { confidence: "medium", market: 10 } })
    await harness.page.route("**/app/api/card-price-checks?**", async route => {
      requests++
      // Synthetic empty source samples, not market data.
      const source = new URL(route.request().url()).searchParams.get("source")
      const check = { summary: { kind: source === "ebay" ? "asking" : "sold", currency: "GBP", count: 0, median: null, low: null, high: null }, checkedAt: new Date().toISOString() }
      await route.fulfill({ json: { ebay: source === "ebay" ? check : null, soldcomps: source === "soldcomps" ? check : null, errors: {} } })
    })
    await openAnalytics(harness.page)
    await harness.page.getByText("Current price evidence", { exact: true }).click()
    const comparison = harness.page.getByRole("region", { name: "Price comparisons" })
    await expect(comparison.getByRole("button", { name: "Check prices", exact: true })).toBeVisible()
    expect(requests).toBe(0)
    await comparison.getByRole("button", { name: "Check prices", exact: true }).click()
    await expect(comparison.getByText("No matching sales in the search sample.")).toBeVisible()
    expect(requests).toBe(2)
    await harness.expectNoHorizontalOverflow()
  })
})
