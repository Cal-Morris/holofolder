import { test, expect } from "./fixtures"

// Uses the default harness price fixture (TEST FIXTURE ONLY): TCGplayer £0.20 ($0.26 USD) and
// Cardmarket £0.05 (€0.06 EUR), which disagree by far more than 35%.

test.describe("UK locale", () => {
  test.use({ locale: "en-GB", signedIn: true })

  test("shows UK prices and the Prices control in GBP only", async ({ harness }) => {
    await expect(harness.page.getByRole("button", { name: "Show prices", exact: true })).toHaveText("£")
    const detail = await harness.openCardDetail()
    await expect(detail.getByText("Market", { exact: true }).locator("..")).toContainText("£0.05")
    await detail.locator("summary").filter({ hasText: "Price details" }).click()
    await expect(detail.getByText("Original US$0.26 USD", { exact: true })).toBeVisible()
    await expect(detail.getByText("Original €0.06 EUR", { exact: true })).toBeVisible()
    await detail.locator("summary").filter({ hasText: "Price details" }).click()
    await detail.locator("summary").filter({ hasText: "Card & variant" }).click()
    await expect(detail.getByText("Current card", { exact: true }).locator("..").getByText("£0.05", { exact: true })).toBeVisible()
  })

  test("the card selector prices each printing for the UK", async ({ harness }) => {
    const detail = await harness.openCardDetail()
    await detail.getByRole("button", { name: /edit card|add card/i }).first().click()
    const selector = harness.page.getByRole("dialog", { name: /card selector/i })
    await expect(selector.getByText("M £0.05", { exact: true }).filter({ visible: true }).first()).toBeVisible()
    await expect(selector.getByText("M £0.20", { exact: true }).filter({ visible: true })).toHaveCount(0)
    await harness.expectNoHorizontalOverflow()
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

  test("the card selector prices each printing in USD", async ({ harness }) => {
    const detail = await harness.openCardDetail()
    await detail.getByRole("button", { name: /edit card|add card/i }).first().click()
    const selector = harness.page.getByRole("dialog", { name: /card selector/i })
    await expect(selector.getByText("M $0.26", { exact: true }).filter({ visible: true }).first()).toBeVisible()
    await expect(selector.getByText(/£/).filter({ visible: true })).toHaveCount(0)
  })
})
