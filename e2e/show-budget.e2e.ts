import { test, expect, SUPABASE_URL, E2E_USER } from "./fixtures"

test.describe("Show spending budget", () => {
  test.use({ signedIn: true, locale: "en-GB" })
  test("shows remaining and over-budget spending, follows the shared tally, and persists offline", async ({ harness }) => {
    const { page } = harness
    // Synthetic purchase from the shared account, not a real provider or account.
    let purchases = [{ owner_user_id: E2E_USER.id, client_id: "synthetic-a", card_id: "synthetic", card_name: "Synthetic fixture", language: "en", finish: "normal", price: 12, market_price: null, currency: "GBP", bought_at: new Date().toISOString(), bundle_id: null }]
    await page.route(`${SUPABASE_URL}/rest/v1/show_purchases**`, route => route.fulfill({ json: purchases }))
    await page.reload()
    await page.getByRole("button", { name: "Show mode", exact: true }).click()
    await harness.dock().getByRole("button", { name: "Search", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "Quick mode" })
    const budget = dialog.getByRole("region", { name: "Show budget" })
    await budget.getByRole("button", { name: "Set show budget" }).click()
    await budget.getByRole("textbox", { name: "Spending limit" }).fill("20")
    const save = budget.getByRole("button", { name: "Save budget" })
    await harness.expectMinTapTarget(save, 36)
    await save.click()
    await expect(budget).toContainText("£8.00 left")
    await budget.getByRole("button", { name: "Edit budget" }).click()
    await budget.getByRole("textbox", { name: "Spending limit" }).fill("10")
    await save.click()
    await expect(budget).toContainText("£2.00 over budget")
    await dialog.getByRole("searchbox").fill("charizard")
    await dialog.getByRole("button", { name: /^Charizard ex, 151 006\/165/ }).click()
    const check = dialog.getByTestId("quick-card-check")
    await expect(check.getByRole("region", { name: "Show budget" })).toContainText("£2.00 over budget")
    purchases = []
    await page.evaluate(() => {
      const current = JSON.parse(localStorage.getItem("binderdex:show-session:v1")!)
      current.purchases = []
      localStorage.setItem("binderdex:show-session:v1", JSON.stringify(current))
      window.dispatchEvent(new Event("binderdex:show-session"))
    })
    await expect(check.getByRole("region", { name: "Show budget" })).toContainText("£10.00 left")
    await harness.expectNoHorizontalOverflow()
    await page.keyboard.press("Escape")
    await page.reload()
    // Service workers are blocked here; prime Quick mode's code after reload, as the installed app does.
    await harness.dock().getByRole("button", { name: "Search", exact: true }).click()
    await expect(budget).toContainText("£10.00 left")
    await page.keyboard.press("Escape")
    await page.context().setOffline(true)
    await harness.dock().getByRole("button", { name: "Search", exact: true }).click()
    await expect(budget).toContainText("£10.00 left")
    await budget.getByRole("button", { name: "Clear budget" }).click()
    await expect(budget.getByRole("button", { name: "Set show budget" })).toBeVisible()
    await page.context().setOffline(false)
  })
})
