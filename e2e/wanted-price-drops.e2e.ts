import { expect, test } from "./fixtures"
import { mockCardPrices } from "./price-fixtures"
import { WANTED_PRICES, seedWantList } from "./wanted-fixtures"

// Price-drop alerts on the want list: a quiet badge on the row, a count in the summary line and a
// "Price drops" quick filter in Sort & filter. TEST FIXTURES ONLY: synthetic prices.
test.describe("want list price drops", () => {
  test.use({ signedIn: true })

  async function openWantList(harness: import("./fixtures").Harness, withDrop: boolean) {
    const { page } = harness
    await seedWantList(page)
    // Charizard ex: £18.50 now against a £26 30-day average (−29%; −23% on the 7-day).
    if (withDrop) await mockCardPrices(page, { ...WANTED_PRICES, "sv03.5-006": { confidence: "medium", market: 18.5, trend: { "30d": 26, "7d": 24, Trend: 18.5 } } })
    await page.reload()
    await expect(harness.dock()).toBeVisible({ timeout: 30_000 })
    await harness.dock().getByRole("button", { name: "Wanted", exact: true }).click()
    await expect(page.getByTestId("wanted-row")).toHaveCount(6)
  }

  test("a dropped card gets a badge, the summary a small count", async ({ harness }) => {
    const { page } = harness
    await openWantList(harness, true)
    const row = page.locator('[data-testid="wanted-row"][data-card-id="sv03.5-006"]')
    const badge = row.getByTestId("price-drop-badge")
    await expect(badge).toBeVisible()
    await expect(badge).toHaveAttribute("aria-label", "Price dropped −29% over 30d")
    await expect(badge).toContainText("−29%")
    await expect(page.getByTestId("price-drop-badge")).toHaveCount(1)
    await expect(row.getByRole("button", { name: "Open Charizard ex from 151, price dropped" })).toBeVisible()
    // The rising card keeps its own badge and no drop badge.
    await expect(page.locator('[data-testid="wanted-row"][data-card-id="sv03.5-168"]').getByTestId("price-rising-badge")).toBeVisible()
    await expect(page.getByTestId("wanted-drop-count")).toHaveText("· 1 price drop")
    await expect(page.getByTestId("wanted-summary")).toContainText("6 wanted")

    const rowBox = (await row.boundingBox())!
    const badgeBox = (await badge.boundingBox())!
    expect(badgeBox.x + badgeBox.width, "badge stays inside its row").toBeLessThanOrEqual(rowBox.x + rowBox.width + 0.5)
    // The badge doesn't squeeze the card name into an ellipsis on a phone.
    const name = row.getByText("Charizard ex", { exact: true })
    expect(await name.evaluate((element) => element.scrollWidth <= element.clientWidth + 1), "card name fits beside the badge").toBe(true)
    await harness.expectNoHorizontalOverflow()
  })

  test("the Price drops quick filter narrows the list and clears from its chip", async ({ harness }) => {
    const { page } = harness
    await openWantList(harness, true)
    await page.getByTestId("wanted-sort-filter").click()
    const sheet = page.getByRole("dialog", { name: "Sort and filter want list" })
    const chip = sheet.getByRole("button", { name: /^Price drops/ })
    await expect(chip).toHaveAttribute("aria-pressed", "false")
    await expect(chip).toContainText("1")
    await chip.scrollIntoViewIfNeeded()
    await page.waitForTimeout(400)
    await harness.expectHittable(chip)
    await chip.click()
    await expect(chip).toHaveAttribute("aria-pressed", "true")
    await sheet.getByRole("button", { name: /^Show 1 card$/ }).click()
    await expect(sheet).toHaveCount(0)

    await expect(page.getByTestId("wanted-row")).toHaveCount(1)
    await expect(page.getByTestId("wanted-row").first()).toHaveAttribute("data-card-id", "sv03.5-006")
    await page.getByRole("button", { name: "Remove filter Price drops" }).click()
    await expect(page.getByTestId("wanted-row")).toHaveCount(6)
  })

  test("with no drops there is no count and no Price drops chip", async ({ harness }) => {
    const { page } = harness
    await openWantList(harness, false)
    await expect(page.getByTestId("price-drop-badge")).toHaveCount(0)
    await expect(page.getByTestId("wanted-drop-count")).toHaveCount(0)
    await page.getByTestId("wanted-sort-filter").click()
    const sheet = page.getByRole("dialog", { name: "Sort and filter want list" })
    await expect(sheet.getByRole("button", { name: /^Rising only/ })).toBeVisible()
    await expect(sheet.getByRole("button", { name: /^Price drops/ })).toHaveCount(0)
  })
})
