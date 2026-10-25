import { mockCardPrices } from "./price-fixtures"
import { test, expect } from "./fixtures"

async function openAnalytics(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Open controls", exact: true }).click()
  await page.getByRole("button", { name: "Analytics", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Analytics", exact: true })).toBeVisible()
}

test("analytics preserves phone dock and honestly separates completion from pricing", async ({ harness }) => {
  const page = harness.page
  await harness.open()
  await openAnalytics(page)
  await expect(page.getByText("0 / 1025", { exact: true })).toBeVisible()
  await expect(page.getByText("0 of 0 owned cards priced", { exact: false })).toBeVisible()
  await expect(page.getByText("Sign in to record private history.", { exact: true })).toBeVisible()
  const geometry = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }))
  expect(geometry.scroll).toBeLessThanOrEqual(geometry.width)
  await page.getByRole("button", { name: "List", exact: true }).last().click()
  await expect(page.getByRole("heading", { name: "Manage the dex quickly" })).toBeVisible()
})

test.describe("signed-in analytics", () => {
  test.use({ signedIn: true })
  test("recorded history, private activity pagination and request failure remain usable", async ({ harness }) => {
  const page = harness.page
  let calls = 0
  await page.route("**/api/collection-analytics?**", route => {
    calls++
    const older = new URL(route.request().url()).searchParams.has("beforeId")
    return route.fulfill({ json: { activity: [{ id: older ? "1" : "2", pokemon_id: 1, pokemon_name: "Fixture Pokémon", recorded_at: "2026-10-11T12:00:00Z", before_state: null, after_state: { card_id: "fixture", card_name: older ? "Fixture older card" : "Fixture added card", status: "collected" } }], priceHistory: [], nextCursor: older ? null : "2", historyAvailable: true } })
  })
  await harness.open()
  await openAnalytics(page)
  await expect(page.getByText("2 / 1025", { exact: true })).toBeVisible()
  await expect(page.getByText("Added Fixture added card", { exact: true })).toBeVisible()
  const activity = page.getByRole("region", { name: "Collection activity" })
  await activity.getByRole("button", { name: "Load older activity" }).click()
  await expect(page.getByText("Added Fixture older card", { exact: true })).toBeVisible()
  expect(calls).toBeGreaterThanOrEqual(2)
  await page.getByText("Current price evidence", { exact: true }).click()
  await expect(page.getByText("Thin data", { exact: true })).toBeVisible()
  await expect(page.getByText("Good time", { exact: true })).toHaveCount(0)
  const beforeEdit = calls
  await page.getByRole("button", { name: "Browse this Pokémon", exact: true }).click()
  const browser = page.getByRole("dialog", { name: "All Bulbasaur cards", exact: true })
  await browser.getByRole("button", { name: "Want Bulbasaur 44/102", exact: true }).click()
  await expect.poll(() => calls).toBeGreaterThan(beforeEdit)
  await harness.closeControl(browser).click()
  await expect(page.getByText("Added Fixture older card", { exact: true })).toHaveCount(0)
  await page.unroute("**/api/collection-analytics?**")
  await page.route("**/api/collection-analytics?**", route => route.fulfill({ status: 503, json: { error: "Unavailable" } }))
  await activity.getByRole("button", { name: "Refresh history", exact: true }).click()
  await expect(page.getByRole("button", { name: "Retry history" })).toBeVisible()
})

})

test.describe("synthetic priced analytics", () => {
  test.use({ signedIn: true })
  test("exact values, movers and source-separated history survive gaps", async ({ harness }) => {
    const page = harness.page
    await mockCardPrices(page, {
      "base1-44": { market: 12, confidence: "high", finishes: [{ finish: "normal", market: 12, trend: { "7d": 10, Trend: 12 } }] },
      "base1-46": { market: 6, confidence: "high", finishes: [{ finish: "normal", market: 6, trend: { "7d": 10, Trend: 6 } }] },
    })
    const point = { card_id: "base1-44", language: "en", finish: "normal", variant_key: "normal", source: "cardmarket", confidence: "high", recorded_at: "2026-10-11T12:00:00Z", source_updated_at: "2026-10-11T11:00:00Z", gbp_amount: 10 }
    await page.route("**/api/collection-analytics?**", route => route.fulfill({ json: { historyAvailable: true, activity: [], nextCursor: null, priceHistory: [{ ...point, observed_day: "2026-10-08" }, { ...point, observed_day: "2026-10-11", gbp_amount: 12 }, { ...point, source: "tcgplayer", observed_day: "2026-10-11", gbp_amount: 50 }] } }))
    await page.evaluate(() => { for (const key of Object.keys(localStorage)) if (key.includes("price")) localStorage.removeItem(key) })
    await page.reload()
    await openAnalytics(page)
    await expect(page.getByText("£18.00", { exact: true })).toBeVisible()
    await expect(page.getByRole("region", { name: "Rising cards" }).getByText("+20%", { exact: true })).toBeVisible()
    await expect(page.getByRole("region", { name: "Falling cards" }).getByText("-40%", { exact: true })).toBeVisible()
    const history = page.getByRole("region", { name: "Card price history" })
    await expect(history.locator(".recharts-line-curve")).toHaveCount(1)
    await page.getByLabel("History source", { exact: true }).selectOption("tcgplayer:normal")
    await expect(history.getByText("Collecting history.", { exact: false })).toBeVisible()
    await harness.expectNoHorizontalOverflow()
    await harness.expectMinTapTarget(page.getByLabel("History card", { exact: true }))
  })
})

test("analytics API rejects anonymous access without caching private data", async ({ request }) => {
  const response = await request.get("/api/collection-analytics")
  expect(response.status()).toBe(401)
  expect(response.headers()["cache-control"]).toBe("private, no-store")
})


test("an unavailable analytics chunk preserves the current view and dock", async ({ harness }) => {
  const page = harness.page
  // Idle preload could already have fetched Analytics; turn it off so the chunk is still
  // missing when the route is blocked.
  await page.addInitScript(() => { window.requestIdleCallback = () => 0 })
  await harness.open()
  await page.route("**/_next/static/chunks/*.js", route => route.abort())
  await page.getByRole("button", { name: "Open controls", exact: true }).click()
  await page.getByRole("button", { name: "Analytics", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: "Analytics could not load" })).toBeVisible()
  await harness.expectHittable(harness.dock().getByRole("button", { name: "List", exact: true }))
  await page.unroute("**/_next/static/chunks/*.js")
  await harness.dock().getByRole("button", { name: "List", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Manage the dex quickly" })).toBeVisible()
})

test("read-only binders expose no private analytics destination", async ({ harness }) => {
  const page = harness.page
  let privateRequests = 0
  page.on("request", request => { if (request.url().includes("/api/collection-analytics")) privateRequests++ })
  await page.goto("/e2e-harness?readOnly=1")
  await page.getByRole("button", { name: "Open controls", exact: true }).click()
  await expect(page.getByRole("button", { name: "Analytics", exact: true })).toHaveCount(0)
  expect(privateRequests).toBe(0)
})

test.describe("collection export", () => {
  test.use({ signedIn: true })

  test("exports the collection as a CSV, offline too", async ({ harness }) => {
    const page = harness.page
    await page.route("**/api/collection-analytics?**", route => route.fulfill({ json: { activity: [], priceHistory: [], nextCursor: null, historyAvailable: true } }))
    await harness.open()
    await openAnalytics(page)
    await page.context().setOffline(true)
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Export CSV", exact: true }).click(),
    ])
    await page.context().setOffline(false)
    expect(download.suggestedFilename()).toMatch(/^binderdex-collection-\d{4}-\d{2}-\d{2}\.csv$/)
    const fs = await import("node:fs/promises")
    const lines = (await fs.readFile((await download.path())!, "utf8")).trimEnd().split("\r\n")
    expect(lines[0]).toBe("dex_number,pokemon,list,slot_status,card_id,card_name,set,language,finish,market_gbp,price_source,added")
    expect(lines.length).toBeGreaterThan(1)
    await harness.expectNoHorizontalOverflow()
  })
})
