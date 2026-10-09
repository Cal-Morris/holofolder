import { test, expect } from "./fixtures"

test("settings credits TCGdex and the Pokémon rights holders", async ({ harness, page }) => {
  await harness.open()
  await page.locator("nav").first().getByRole("button", { name: /open settings/i }).click()
  const attribution = page.getByRole("dialog").getByTestId("card-data-attribution")
  await expect(attribution).toBeVisible()
  await expect(attribution).toContainText("TCGdex")
  await expect(attribution).toContainText("The Pokémon Company")
  await expect(attribution.getByRole("link", { name: "TCGdex" })).toHaveAttribute("href", "https://tcgdex.dev")
})
