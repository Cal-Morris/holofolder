import { test, expect } from "./fixtures"
import { mockCardPrices } from "./price-fixtures"

test.use({ signedIn: true })

// Synthetic independent asking and sold samples, not market data.
const comparisonFixture = {
  ebay: { summary: { kind: "asking", currency: "GBP", count: 3, median: 12, low: 10, high: 20 }, checkedAt: "2026-10-27T12:00:00Z", searchUrl: "https://www.ebay.co.uk/sch/i.html?_nkw=Bulbasaur" },
  soldcomps: { summary: { kind: "sold", currency: "GBP", count: 2, median: 9, low: 8, high: 10 }, checkedAt: "2026-10-27T12:00:00Z" },
  errors: {},
}

test("asking and sold comparisons load on demand and remain separate from the card valuation", async ({ harness }) => {
  // Synthetic market quote and asking-price sample, never real sale data.
  await mockCardPrices(harness.page, { "base1-44": { confidence: "medium", market: 8 } })
  await harness.page.addInitScript(() => localStorage.removeItem("binderdex_card_price_cache_v7"))
  let lookups = 0
  await harness.page.route("**/api/card-price-checks?**", async route => {
    lookups++
    expect(route.request().method()).toBe("POST")
    expect(new URL(route.request().url()).searchParams.get("cardId")).toBe("base1-44")
    await route.fulfill({ json: comparisonFixture })
  })
  await harness.page.reload()
  const detail = await harness.openCardDetail()
  const market = detail.getByText("Market", { exact: true }).locator("..")
  await expect(market).toContainText("£8.00")
  await detail.getByText("Price details", { exact: true }).click()
  const indicator = detail.getByRole("region", { name: "Price comparisons" })
  await expect(indicator.getByText(/Asking and sold prices shown separately/)).toBeVisible()
  expect(lookups).toBe(0)
  const check = indicator.getByRole("button", { name: "Check prices" })
  await harness.expectMinTapTarget(check)
  await check.click()
  await expect(indicator.getByText(/£12.00.*median asking price.*3 matched listings/)).toBeVisible()
  await expect(indicator.getByText(/Postage excluded/).first()).toBeVisible()
  await expect(indicator.getByText(/£9.00.*median sold price.*2 matched sales/)).toBeVisible()
  await expect(market).toContainText("£8.00")
  const link = indicator.getByRole("link", { name: "View listings on eBay" })
  await expect(link).toHaveAttribute("href", /^https:\/\/www\.ebay\.co\.uk\//)
  await harness.expectMinTapTarget(link)
  await harness.expectNoHorizontalOverflow()
})

test("eBay lookup degrades clearly offline without making a request", async ({ harness, context }) => {
  let lookups = 0
  await harness.page.route("**/api/card-price-checks?**", async route => { lookups++; await route.abort() })
  const detail = await harness.openCardDetail()
  await detail.getByText("Price details", { exact: true }).click()
  await context.setOffline(true)
  await detail.getByRole("button", { name: "Check prices" }).click()
  await expect(detail.getByRole("status")).toHaveText("Connect to the internet to check prices.")
  expect(lookups).toBe(0)
  await context.setOffline(false)
})

test("eBay lookup failure and an empty sample do not invent a price", async ({ harness }) => {
  let failed = true
  await harness.page.route("**/api/card-price-checks?**", async route => {
    if (failed) await route.fulfill({ status: 503, json: { error: "eBay listings are temporarily unavailable. Try again later." } })
    else await route.fulfill({ json: { ebay: { summary: { kind: "asking", currency: "GBP", count: 0, median: null, low: null, high: null }, checkedAt: "2026-10-27T12:00:00Z" }, soldcomps: null, errors: { soldcomps: "Monthly allowance used up." } } })
  })
  const detail = await harness.openCardDetail()
  await detail.getByText("Price details", { exact: true }).click()
  const indicator = detail.getByRole("region", { name: "Price comparisons" })
  await indicator.getByRole("button", { name: "Check prices" }).click()
  await expect(indicator.getByRole("status").first()).toContainText("temporarily unavailable")
  failed = false
  await indicator.getByRole("button", { name: "Check prices" }).click()
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
  await expect(detail.getByRole("button", { name: "Check prices" })).toBeVisible()
  await expect(detail.getByRole("region", { name: "Price comparisons" })).toContainText("Asking and sold prices shown separately")
})

test("eBay listings API requires a signed-in session", async ({ request }) => {
  const response = await request.get("/api/ebay/listings?cardId=base1-44")
  expect(response.status()).toBe(401)
  expect(response.headers()["cache-control"]).toBe("no-store")
})


test("Show mode checks both sources on tap and resets comparisons when the finish changes", async ({ harness }) => {
  let requests = 0
  await harness.page.route("**/api/card-price-checks?**", async route => {
    requests++
    expect(route.request().method()).toBe("POST")
    expect(new URL(route.request().url()).searchParams.get("cardId")).toBe("sv03.5-005")
    await route.fulfill({ json: comparisonFixture })
  })
  await harness.page.getByRole("button", { name: "Show mode", exact: true }).click()
  await harness.page.getByRole("region", { name: "Show mode" }).getByRole("button", { name: "Search", exact: true }).click()
  const dialog = harness.page.getByRole("dialog", { name: "Quick mode" })
  await dialog.getByRole("searchbox").fill("charmeleon")
  await dialog.getByRole("region", { name: "Cards" }).getByRole("button", { name: /^Charmeleon, 151 / }).first().click()
  const check = dialog.getByTestId("quick-card-check")
  const button = check.getByRole("button", { name: "Check prices", exact: true })
  await expect(button).toBeVisible()
  expect(requests).toBe(0)
  await harness.expectMinTapTarget(button)
  await button.click()
  await expect(check.getByText(/£9.00.*median sold price/)).toBeVisible()
  await expect(check.getByText(/£12.00.*median asking price/)).toBeVisible()
  await harness.expectNoHorizontalOverflow()
  const finish = check.getByRole("radiogroup", { name: "Variant" }).getByRole("radio", { name: /reverse/i })
  await finish.click()
  await expect(finish).toHaveAttribute("aria-checked", "true")
  await expect(check.getByText(/median sold price/)).toHaveCount(0)
  expect(requests).toBe(2)
})

test("price check writes and saved reads require authentication", async ({ request }) => {
  for (const method of ["GET", "POST"]) {
    const response = await request.fetch("/api/card-price-checks?cardId=base1-44&finish=normal", { method })
    expect(response.status()).toBe(401)
    expect(response.headers()["cache-control"]).toBe("no-store")
  }
})


for (const fast of ["ebay", "soldcomps"] as const) {
  test(`${fast} appears independently while the other source is pending`, async ({ harness }) => {
    const slow = fast === "ebay" ? "soldcomps" : "ebay"
    let release: (() => void) | undefined
    const gate = new Promise<void>(resolve => { release = resolve })
    await harness.page.route("**/api/card-price-checks?**", async route => {
      const source = new URL(route.request().url()).searchParams.get("source")
      if (source === slow) await gate
      await route.fulfill({ json: comparisonFixture })
    })
    const detail = await harness.openCardDetail()
    await detail.getByText("Price details", { exact: true }).click()
    const comparison = detail.getByRole("region", { name: "Price comparisons" })
    await comparison.getByRole("button", { name: "Check prices", exact: true }).click()
    try {
      await expect(comparison.getByText(fast === "ebay" ? /£12.00.*median asking price/ : /£9.00.*median sold price/)).toBeVisible()
      await expect(comparison.getByText(slow === "ebay" ? "Checking eBay…" : "Checking sold comps…", { exact: true })).toBeVisible()
    } finally { release?.() }
    await expect(comparison.getByText(/£12.00.*median asking price/)).toBeVisible()
    await expect(comparison.getByText(/£9.00.*median sold price/)).toBeVisible()
    await harness.expectNoHorizontalOverflow()
  })
}

// Synthetic fresh, concentrated sales which qualify for a buying guide.
const qualifyingFixture = () => ({ ...comparisonFixture, soldcomps: {
  summary: { kind: "sold", currency: "GBP", count: 10, median: 9.8, low: 9.6, high: 10 },
  checkedAt: new Date().toISOString(),
  sales: Array.from({ length: 10 }, (_, i) => ({ amount: [9.6, 9.7, 9.8, 9.9, 10][i % 5], soldAt: new Date(Date.now() - (i % 3 + 1) * 86400_000).toISOString().slice(0, 10) })),
} })

test("qualified sold guide changes Show mode verdict, plots an overlay and resets on finish change", async ({ harness }) => {
  await mockCardPrices(harness.page, { "sv03.5-005": { market: 10, confidence: "high", finishes: [{ finish: "normal", market: 10 }, { finish: "reverse_holo", market: 20 }] } })
  let requests = 0
  await harness.page.route("**/api/card-price-checks?**", async route => { requests++; await route.fulfill({ json: qualifyingFixture() }) })
  await harness.page.getByRole("button", { name: "Show mode", exact: true }).click()
  await harness.page.getByRole("region", { name: "Show mode" }).getByRole("button", { name: "Search", exact: true }).click()
  const dialog = harness.page.getByRole("dialog", { name: "Quick mode" })
  await dialog.getByRole("searchbox").fill("charmeleon")
  await dialog.getByRole("region", { name: "Cards" }).getByRole("button", { name: /^Charmeleon, 151 / }).first().click()
  const check = dialog.getByTestId("quick-card-check")
  await expect(check.getByTestId("quick-card-market-price")).toHaveText("£10.00")
  const keypad = check.getByRole("group", { name: "Keypad" })
  for (const name of ["1", "0", "Decimal point", "9"]) await keypad.getByRole("button", { name, exact: true }).click()
  await expect(check.getByTestId("deal-verdict")).toHaveAttribute("data-verdict", "fair")
  expect(requests).toBe(0)
  await check.getByRole("button", { name: "Check prices", exact: true }).click()
  await expect(check.getByTestId("quick-card-market-price")).toHaveText("£9.80")
  await expect(check.getByTestId("deal-verdict")).toHaveAttribute("data-verdict", "overpriced")
  await expect(check.getByRole("figure", { name: "Good-price overlap", exact: true })).toBeVisible()
  const chart = check.getByRole("figure", { name: "Sold prices and current eBay asking range" })
  const overlay = chart.getByRole("button", { name: "Hide current asking overlay" })
  await expect(overlay).toBeVisible()
  await harness.expectMinTapTarget(overlay)
  await overlay.click()
  await expect(chart.getByRole("button", { name: "Show current asking overlay" })).toHaveAttribute("aria-pressed", "false")
  await harness.expectNoHorizontalOverflow()
  if (test.info().project.name === "standalone-390x844" && test.info().repeatEachIndex === 0) await harness.page.screenshot({ path: "/tmp/binderdex-price-comparison-chart.png" })
  await check.getByRole("radiogroup", { name: "Variant" }).getByRole("radio", { name: /reverse/i }).click()
  await expect(check.getByTestId("quick-card-market-price")).toHaveText("£20.00")
  await expect(check.getByText(/median sold price/)).toHaveCount(0)
  expect(requests).toBe(2)
})

test("card details updates its good-price band only after a user checks qualifying sold evidence", async ({ harness }) => {
  await mockCardPrices(harness.page, { "base1-44": { market: 10, confidence: "high" } })
  await harness.page.addInitScript(() => localStorage.removeItem("binderdex_card_price_cache_v7"))
  await harness.page.route("**/api/card-price-checks?**", route => route.fulfill({ json: qualifyingFixture() }))
  await harness.page.reload()
  const detail = await harness.openCardDetail()
  await expect(detail.getByText("Good price · sold", { exact: true })).toHaveCount(0)
  await detail.getByText("Price details", { exact: true }).click()
  await detail.getByRole("button", { name: "Check prices", exact: true }).click()
  await expect(detail.getByText("Good price · sold", { exact: true })).toBeVisible()
  await expect(detail.getByRole("figure", { name: "Good-price overlap", exact: true })).toBeVisible()
  await harness.expectNoHorizontalOverflow()
})


test("card details compares sold evidence with the tracked finish quote", async ({ harness }) => {
  await mockCardPrices(harness.page, { "base1-44": { market: 10, confidence: "high", finishes: [{ finish: "normal", market: 10 }, { finish: "reverse_holo", market: 20 }] } })
  await harness.page.addInitScript(() => localStorage.removeItem("binderdex_card_price_cache_v7"))
  await harness.page.route("**/api/card-price-checks?**", route => route.fulfill({ json: qualifyingFixture() }))
  await harness.page.reload()
  const detail = await harness.openCardDetail()
  await detail.locator("summary").filter({ hasText: "Card & variant" }).click()
  await detail.getByRole("button", { name: /^Reverse/ }).click()
  await expect(detail.getByText("Market", { exact: true }).locator("..")).toContainText("£20.00")
  await detail.getByText("Price details", { exact: true }).click()
  await detail.getByRole("button", { name: "Check prices", exact: true }).click()
  await expect(detail.getByText(/sold and catalogue buying ranges do not overlap/)).toBeVisible()
  await expect(detail.getByText("Good price · sold", { exact: true })).toHaveCount(0)
})

test("switching finishes cancels the old check before it can overwrite new evidence", async ({ harness }) => {
  await mockCardPrices(harness.page, { "sv03.5-005": { market: 10, confidence: "high", finishes: [{ finish: "normal", market: 10 }, { finish: "reverse_holo", market: 20 }] } })
  let release: (() => void) | undefined
  const gate = new Promise<void>(resolve => { release = resolve })
  await harness.page.route("**/api/card-price-checks?**", async route => {
    const params = new URL(route.request().url()).searchParams
    if (params.get("source") === "soldcomps" && params.get("finish") === "normal") await gate
    const fixture = qualifyingFixture()
    if (params.get("finish") === "reverse_holo") {
      fixture.soldcomps.summary = { ...fixture.soldcomps.summary, median: 19.6, low: 19.2, high: 20 }
      fixture.soldcomps.sales = fixture.soldcomps.sales.map(sale => ({ ...sale, amount: sale.amount * 2 }))
    }
    await route.fulfill({ json: fixture }).catch(() => undefined)
  })
  await harness.page.getByRole("button", { name: "Show mode", exact: true }).click()
  await harness.page.getByRole("region", { name: "Show mode" }).getByRole("button", { name: "Search", exact: true }).click()
  const dialog = harness.page.getByRole("dialog", { name: "Quick mode" })
  await dialog.getByRole("searchbox").fill("charmeleon")
  await dialog.getByRole("region", { name: "Cards" }).getByRole("button", { name: /^Charmeleon, 151 / }).first().click()
  const check = dialog.getByTestId("quick-card-check")
  try {
    await check.getByRole("button", { name: "Check prices", exact: true }).click()
    await expect(check.getByText(/£12.00.*median asking price/)).toBeVisible()
    const cancelled = harness.page.waitForEvent("requestfailed", { predicate: request => request.url().includes("source=soldcomps") && request.url().includes("finish=normal") })
    await check.getByRole("radiogroup", { name: "Variant" }).getByRole("radio", { name: /reverse/i }).click()
    await cancelled
    await check.getByRole("button", { name: "Check prices", exact: true }).click()
    await expect(check.getByTestId("quick-card-market-price")).toHaveText("£19.60")
    await expect(check.getByRole("figure", { name: "Good-price overlap", exact: true })).toBeVisible()
  } finally { release?.() }
})
