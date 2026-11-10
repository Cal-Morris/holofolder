import { test, expect, emulateStandalone, mockBackends, Harness, openInventoryFilters } from "./fixtures"
import { inventoryProjectionPrices } from "../tests/fixtures/inventory-browse"

// Synthetic mixed copies and saved quotes, no providers, DB or production routes.
test("Inventory storage totals, explicit destinations and saved raw references survive filtering and offline", async ({ page, standalone, insets, baseURL }) => {
  if (standalone) await emulateStandalone(page, insets)
  await mockBackends(page, page.context(), { signedIn: false, baseURL })
  const batches: string[][] = []
  await page.route("**/api/card-prices?*", async route => {
    expect(route.request().method()).toBe("GET")
    const cards: { cardId: string }[] = JSON.parse(new URL(route.request().url()).searchParams.get("cards")!)
    batches.push(cards.map(c => c.cardId))
    await route.fulfill({ json: { prices: inventoryProjectionPrices().filter(p => cards.some(c => c.cardId === p.cardId)) } })
  })
  await page.goto("/app/e2e-harness/inventory")
  await expect(page.getByText("5 owned copies · 5 matching", { exact: true })).toBeVisible()
  await page.getByRole("combobox", { name: "Harness evidence" }).selectOption("projection")
  const totals = page.getByRole("region", { name: "Storage totals" })
  await expect(totals).toContainText("6 owned copies · 2 wanted · 1 Pokémon")
  await expect(totals).toContainText("Saved raw value: £25.00 · 4 priced · 1 raw unpriced")
  await expect(totals).toContainText("1 graded value unknown, excluded from raw total")
  const list = page.getByRole("list", { name: "Owned copies" })
  await expect(list.getByText("Synthetic Snorlax", { exact: true })).toHaveCount(3)
  await expect(list.getByText("Synthetic Trainer", { exact: true })).toBeVisible()
  await expect(list.getByText("Synthetic Energy", { exact: true })).toBeVisible()
  await expect(list.getByText(/Raw reference, not graded value: £10.00/)).toBeVisible()
  await totals.locator("summary").first().click()
  await page.getByText("Wanted cards by location", { exact: true }).click()
  const wants = page.getByRole("list", { name: "Wanted cards" }).getByRole("listitem")
  await expect(wants).toHaveCount(2)
  await expect(wants.first()).toContainText("Synthetic Trainer · Language unknown · Finish unknown · Alpha · Page 1 · Slot 1")
  await expect(page.getByRole("list", { name: "Wanted cards" })).not.toContainText("alpha-empty")
  expect(batches.filter(b => b.includes("synthetic-snorlax"))).toEqual([["synthetic-snorlax", "synthetic-trainer", "synthetic-energy"]])
  await openInventoryFilters(page)
  await page.getByRole("combobox", { name: "Storage", exact: true }).selectOption("alpha")
  await expect(totals).toContainText("1 owned copy · 2 wanted · 1 Pokémon")
  await expect(totals).toContainText("Saved raw value: £10.00 · 1 priced")
  await expect(list.getByRole("button")).toHaveCount(1)
  await page.context().setOffline(true)
  await page.getByRole("combobox", { name: "Storage", exact: true }).selectOption("")
  await page.getByRole("searchbox", { name: "Search inventory" }).fill("trainer")
  await expect(list.getByRole("button")).toHaveCount(1)
  await expect(totals).toContainText("Saved raw value: £25.00")
  await new Harness(page, insets, false).expectNoHorizontalOverflow()
  await page.getByRole("combobox", { name: "Harness evidence" }).selectOption("cached")
  await expect(totals).toContainText("Cached only")
  await page.getByRole("combobox", { name: "Harness account" }).selectOption("synthetic-other")
  await expect(page.getByRole("heading", { name: "Inventory unavailable" })).toBeVisible()
  await expect(totals).toHaveCount(0)
  await expect(list).toHaveCount(0)
})

test("Inventory caps confidence for an older regional source after finish selection", async ({ page, standalone, insets, baseURL }) => {
  if (standalone) await emulateStandalone(page, insets)
  await mockBackends(page, page.context(), { signedIn: false, baseURL })
  await page.route("**/api/card-prices?*", async route => {
    const prices = inventoryProjectionPrices()
    for (const price of prices) {
      const finish = price.finishPrices![0]
      finish.confidence = "high"
      finish.updatedAt = new Date().toISOString()
      finish.sourcePrices = [{ source: "cardmarket", label: "Synthetic older regional evidence", variantLabel: null,
        marketGbpAmount: finish.gbpAmount, lowGbpAmount: null, originalMarketAmount: 13,
        originalLowAmount: null, originalCurrency: "EUR", updatedAt: "2020-01-01T00:00:00Z" }]
    }
    await route.fulfill({ json: { prices } })
  })
  await page.goto("/app/e2e-harness/inventory")
  await page.getByRole("combobox", { name: "Harness evidence" }).selectOption("projection")
  const list = page.getByRole("list", { name: "Owned copies" })
  await expect(list.getByText(/low confidence · Updated 2020-01-01/)).toHaveCount(5)
  await expect(list.getByText(/high confidence/)).toHaveCount(0)
  await expect(list.getByText(/Raw reference, not graded value/)).toBeVisible()
  await new Harness(page, insets, false).expectNoHorizontalOverflow()
})
