import { test, expect } from "./fixtures"

test.use({ locale: "en-GB" })

test("settings defaults region and currency from the browser locale and allows overrides", async ({ harness, page }) => {
  await harness.open()
  await page.locator("nav").first().getByRole("button", { name: /open settings/i }).click()
  const dialog = page.getByRole("dialog", { name: /settings/i })
  await dialog.getByRole("button", { name: "Account", exact: true }).click()

  const region = dialog.getByLabel("Region", { exact: true })
  const currency = dialog.getByLabel("Currency", { exact: true })
  const language = dialog.getByLabel("Card language", { exact: true })
  const summary = dialog.getByTestId("pricing-preferences-summary")

  await expect(region).toHaveValue("auto")
  await expect(region.locator("option:checked")).toHaveText("Automatic (United Kingdom)")
  await expect(currency.locator("option:checked")).toHaveText("From region (GBP)")
  await expect(language.locator("option:checked")).toHaveText("Automatic (English)")
  await expect(summary).toContainText("in GBP")

  await region.selectOption("US")
  await expect(summary).toContainText("in USD")
  await expect(currency.locator("option:checked")).toHaveText("From region (USD)")

  await currency.selectOption("EUR")
  await expect(summary).toContainText("in EUR")

  await region.selectOption("UK")
  await expect(currency).toHaveValue("EUR")
  await expect(summary).toContainText("in EUR")
  await currency.selectOption("auto")
  await expect(summary).toContainText("in GBP")

  await language.selectOption("ja")
  await expect(summary).toContainText("Japanese")

  // Controls are tall enough to tap comfortably on phones.
  const box = await region.boundingBox()
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(40)
  await harness.expectNoHorizontalOverflow()
})
