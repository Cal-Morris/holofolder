import { test, expect } from "./fixtures"
import { clearCardPriceCache, mockCardPrices } from "./price-fixtures"

test.describe("analytics dashboard", () => {
  test.use({ signedIn: true })
  test("current binder value resets a remembered all-binders Analytics scope", async ({ harness }) => {
    const page = harness.page
    await page.goto("/app/e2e-harness?signedIn=1&binders=1")
    await page.getByRole("button", { name: "More", exact: true }).click()
    await page.getByRole("menuitem", { name: "Analytics", exact: true }).click()
    const scope = page.getByRole("group", { name: "Binders shown", exact: true })
    await scope.getByRole("button", { name: "All binders", exact: true }).click()
    await expect(scope.getByRole("button", { name: "All binders", exact: true })).toHaveAttribute("aria-pressed", "true")
    await harness.dock().getByRole("button", { name: "Binder", exact: true }).click()
    await page.getByRole("button", { name: "View binder value in Analytics" }).click()
    await expect(scope.getByRole("button", { name: "This binder", exact: true })).toHaveAttribute("aria-pressed", "true")
  })
  test("refinement uses saved sold evidence and reopens offline without a new request", async ({ harness }) => {
    const page = harness.page
    // Synthetic £11 sales agree with the synthetic £10 catalogue estimate.
    await mockCardPrices(page, { "base1-44": { market: 10, confidence: "high", finishes: [{ finish: "normal", market: 10 }] } })
    let calls = 0
    await page.route("**/app/api/card-price-checks?**", route => {
      calls++
      const params = new URL(route.request().url()).searchParams
      const source = params.get("source")!
      const sales = Array.from({ length: 12 }, (_, i) => ({ amount: 11, soldAt: new Date(Date.now() - (i % 3 + 1) * 86400000).toISOString().slice(0, 10) }))
      const check = params.get("cardId") === "base1-44" ? { summary: { kind: source === "ebay" ? "asking" : "sold", currency: "GBP", count: 12, low: 11, median: 11, high: 11 }, checkedAt: new Date().toISOString(), ...(source === "soldcomps" ? { sales } : {}) } : null
      return route.fulfill({ json: { [source]: check, errors: {} } })
    })
    await page.reload()
    await page.getByRole("button", { name: "View binder value in Analytics" }).click()
    const refinement = page.getByRole("region", { name: "Refine binder valuation" })
    await refinement.getByRole("button", { name: "Refine valuation", exact: true }).click()
    await expect(refinement.getByText("£11.00", { exact: true })).toBeVisible()
    await expect(refinement.getByText("1 sold · 0 Cardmarket fallback · 1 unpriced", { exact: true })).toBeVisible()
    const completedCalls = calls
    await harness.dock().getByRole("button", { name: "Binder", exact: true }).click()
    await page.context().setOffline(true)
    await page.getByRole("button", { name: "View binder value in Analytics" }).click()
    await expect(refinement.getByText("£11.00", { exact: true })).toBeVisible()
    expect(calls).toBe(completedCalls)
    await page.context().setOffline(false)
  })
  test("binder value leads to a readable Cardmarket valuation without paid checks", async ({ harness }) => {
    const page = harness.page
    let checks = 0
    await page.route("**/app/api/card-price-checks**", route => { checks++; return route.fulfill({ json: { ebay: null, soldcomps: null, errors: {} } }) })
    // Synthetic Cardmarket prices, no live provider calls.
    await mockCardPrices(page, { "base1-44": { market: 12, confidence: "high", finishes: [{ finish: "normal", market: 12 }] } })
    await page.reload()
    const value = page.getByRole("button", { name: "View binder value in Analytics" })
    await expect(value).toContainText("£12.00")
    await expect(value).toContainText("1 of 2")
    await harness.expectMinTapTarget(value)
    await value.click()
    const overview = page.getByRole("region", { name: "Collection overview" })
    await expect(overview.getByRole("heading", { name: "Binder value" })).toBeVisible()
    await expect(overview.getByText("Cardmarket estimate", { exact: false })).toBeVisible()
    const amount = overview.getByText("£12.00", { exact: true })
    const geometry = await amount.evaluate(node => ({ font: parseFloat(getComputedStyle(node).fontSize), width: node.parentElement!.getBoundingClientRect().width }))
    expect(geometry.font).toBeGreaterThanOrEqual(32)
    expect(geometry.width).toBeGreaterThan(300)
    expect(checks).toBe(0)
    const refine = page.getByRole("button", { name: "Refine valuation", exact: true })
    await harness.expectMinTapTarget(refine)
    await refine.click()
    await expect.poll(() => checks).toBeGreaterThan(0)
    await expect(page.getByText("0 sold · 1 Cardmarket fallback · 1 unpriced", { exact: true })).toBeVisible()
    await page.context().setOffline(true)
    await expect(refine).toBeDisabled()
    await harness.expectNoHorizontalOverflow()
    await page.context().setOffline(false)
  })
  for (const theme of ["light", "dark"]) {
    test(`collection breakdown and card paths in ${theme}`, async ({ harness }, testInfo) => {
      const page = harness.page
      // Synthetic exact-finish prices, never real provider requests.
      await mockCardPrices(page, { "base1-44": { market: 12, confidence: "high", finishes: [{ finish: "normal", market: 12 }] } })
      await page.route("**/app/api/collection-analytics?**", route => route.fulfill({ json: { historyAvailable: true, activity: [], priceHistory: [], nextCursor: null } }))
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
