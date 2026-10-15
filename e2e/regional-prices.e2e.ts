import { test, expect } from "./fixtures"

// Uses the default harness price fixture (TEST FIXTURE ONLY): TCGplayer £0.20 ($0.26 USD) and
// Cardmarket £0.05 (€0.06 EUR), which disagree by far more than 35%.

test.describe("UK locale", () => {
  test.use({ locale: "en-GB", signedIn: true })

  test("leads with the Cardmarket-grounded GBP price and shows the EUR market price second", async ({ harness }) => {
    const detail = await harness.openCardDetail()
    await expect(detail.getByText("Market", { exact: true }).locator("..")).toContainText("£0.05")
    await detail.locator("summary").filter({ hasText: "Card & variant" }).click()
    await expect(detail.getByText("Current card", { exact: true }).locator("..").getByText("£0.05 (€0.06 EUR)", { exact: true })).toBeVisible()
  })
})

test.describe("US locale", () => {
  test.use({ locale: "en-US", signedIn: true })

  test("leads with the TCGplayer price in USD", async ({ harness }) => {
    const detail = await harness.openCardDetail()
    await expect(detail.getByText("Market", { exact: true }).locator("..")).toContainText("$0.26")
    await detail.locator("summary").filter({ hasText: "Card & variant" }).click()
    await expect(detail.getByText("Current card", { exact: true }).locator("..").getByText("$0.26", { exact: true })).toBeVisible()
  })
})
