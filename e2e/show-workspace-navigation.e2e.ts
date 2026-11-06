import { test, expect } from "@playwright/test"
import { mockBackends } from "./fixtures"
import { mockCardPrices } from "./price-fixtures"

test.describe("desktop Show workspace navigation", () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false })
  test.beforeEach(async ({ page, baseURL }) => {
    test.skip(test.info().project.name !== "browser-390x844", "desktop context, run once")
    await mockBackends(page, page.context(), { signedIn: true, baseURL })
    await mockCardPrices(page, { "sv03.5-006": { market: 10, confidence: "high" } })
    await page.goto("/e2e-harness?signedIn=1")
    await page.getByRole("button", { name: "Show mode", exact: true }).click()
    await page.getByTestId("app-header").getByRole("button", { name: "Search", exact: true }).click()
  })

  test("search receives focus and precedes hunting controls in keyboard order", async ({ page }) => {
    const dialog = page.getByRole("dialog", { name: "Quick mode" })
    await expect(dialog.getByRole("searchbox")).toBeFocused()
    await page.keyboard.press("Tab")
    await expect(dialog.getByRole("button", { name: "Scan a card" })).toBeFocused()
    await page.keyboard.press("Tab")
    await expect(dialog.getByRole("combobox", { name: "Sort", exact: true })).toBeFocused()
  })

  test("switches directly between selected card and bundle without a hidden pending view", async ({ page }) => {
    const dialog = page.getByRole("dialog", { name: "Quick mode" })
    await dialog.getByRole("searchbox").fill("charizard")
    const card = dialog.getByRole("region", { name: "Cards", exact: true }).getByRole("button", { name: /^Charizard ex, 151 / }).first()
    await card.click()
    const check = dialog.getByTestId("quick-card-check")
    await check.getByRole("button", { name: "Add to bundle", exact: true }).click()
    await dialog.getByRole("button", { name: /Check bundle/ }).click()
    const bundle = dialog.getByTestId("quick-bundle")
    await expect(bundle).toBeVisible()
    await expect(check).toHaveCount(0)
    await card.click()
    await expect(check).toBeVisible()
    await expect(bundle).toHaveCount(0)
    await check.getByRole("button", { name: "Back to results", exact: true }).click()
    await expect(dialog.getByTestId("show-detail-pane")).toHaveCount(0)
  })
})
