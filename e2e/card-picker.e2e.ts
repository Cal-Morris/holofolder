import { test, expect, type Harness } from "./fixtures"

async function openPicker(harness: Harness) {
  const { page } = harness
  await page.locator('button[data-dex-id="7"]').first().click()
  const detail = page.getByRole("dialog", { name: /squirtle details/i })
  await detail.getByRole("button", { name: "Add card", exact: true }).click()
  const selector = page.getByRole("dialog", { name: /card selector/i })
  await expect(selector).toBeVisible()
  return selector
}

test.describe("card picker layout", () => {
  test.use({ signedIn: true })

  test("opens on search with cards above the fold and one compact filters control", async ({ harness }) => {
    const selector = await openPicker(harness)
    const search = selector.getByRole("searchbox", { name: "Search cards" })
    await expect(search).toBeVisible()
    await expect(selector.getByRole("button", { name: "Scan card", exact: true })).toBeVisible()

    // The first card is on screen without scrolling.
    const firstCard = selector.getByRole("button", { name: /^Add card Squirtle from / }).first()
    await expect(firstCard).toBeInViewport({ ratio: 1 })

    // Language, variant, set, rarity and sort live behind one button, not stacked rows.
    await expect(selector.getByRole("button", { name: "Japanese" })).toHaveCount(0)
    await expect(selector.getByRole("combobox")).toHaveCount(0)
    const filtersButton = selector.getByRole("button", { name: /filters · sort/i })
    await harness.expectMinTapTarget(filtersButton, 36)
    await harness.expectNoHorizontalOverflow()

    // Search narrows the cards.
    await search.fill("celebration")
    await expect(selector.getByText(/^[12] of 3 cards$/)).toBeVisible()
    await search.fill("")
    await expect(selector.getByText("3 of 3 cards")).toBeVisible()
  })

  test("filters apply from the sheet and show as removable chips", async ({ harness }) => {
    const { page } = harness
    const selector = await openPicker(harness)
    await selector.getByRole("button", { name: /filters · sort/i }).click()
    const sheet = page.getByRole("dialog", { name: "Filters and sort" })
    await expect(sheet).toBeVisible()
    await sheet.getByRole("button", { name: "Japanese", exact: true }).click()
    await sheet.getByRole("button", { name: "Reverse", exact: true }).click()
    await sheet.getByRole("combobox", { name: "Set" }).selectOption({ label: "151" })
    await sheet.getByRole("button", { name: "Show 1 card", exact: true }).click()
    await expect(sheet).toHaveCount(0)

    const chips = selector.getByRole("list", { name: "Active filters" })
    await expect(chips.getByRole("listitem")).toHaveCount(3)
    await expect(selector.getByText("1 of 3 cards")).toBeVisible()
    await harness.expectNoHorizontalOverflow()

    await chips.getByRole("button", { name: "Remove filter 151" }).click()
    await expect(chips.getByRole("listitem")).toHaveCount(2)
    await selector.getByRole("button", { name: "Clear all", exact: true }).click()
    await expect(chips).toHaveCount(0)
    await expect(selector.getByText("3 of 3 cards")).toBeVisible()

    // Escape closes only the sheet, then the picker.
    await selector.getByRole("button", { name: /filters · sort/i }).click()
    await expect(sheet).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(sheet).toHaveCount(0)
    await expect(selector).toBeVisible()
  })

  test("marking owned without a card is in the overflow menu", async ({ harness }) => {
    const { page } = harness
    const selector = await openPicker(harness)
    await expect(selector.getByRole("button", { name: "Mark owned without card" })).toHaveCount(0)
    await selector.getByRole("button", { name: "More options" }).click()
    await selector.getByRole("menuitem", { name: "Mark owned without card" }).click()
    await expect(selector).toHaveCount(0)
    await expect(page.locator('button[data-dex-id="7"]').first()).toBeVisible()
  })

  test("a search with no matches says so and clears in one tap", async ({ harness }) => {
    const selector = await openPicker(harness)
    await selector.getByRole("searchbox", { name: "Search cards" }).fill("zzzz no such card")
    await expect(selector.getByText("No cards match", { exact: true })).toBeVisible()
    await selector.getByRole("button", { name: "Clear search and filters" }).click()
    await expect(selector.getByText("3 of 3 cards")).toBeVisible()
    await expect(selector.getByRole("searchbox", { name: "Search cards" })).toHaveValue("")
  })

  test("a single-finish card is picked in one tap", async ({ harness }) => {
    const { page } = harness
    const selector = await openPicker(harness)
    await selector.getByRole("button", { name: "Add card Squirtle from 30th Celebration", exact: true }).click()
    await expect(page.getByRole("dialog", { name: "Which variant?" })).toHaveCount(0)
    await expect(selector).toHaveCount(0)
  })
})
