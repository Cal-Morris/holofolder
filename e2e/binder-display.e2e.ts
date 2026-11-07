import { clearCardPriceCache } from "./price-fixtures"
import { test, expect, SUPABASE_URL, SEEDED_COLLECTION } from "./fixtures"

test.describe("binder printing display", () => {
  test.use({ signedIn: true })

  test("each mode uses its own printing and missing slots stay artwork", async ({ harness }) => {
    const { page } = harness
    // Synthetic printings with distinct names, artwork and metadata.
    const owned = { ...SEEDED_COLLECTION[0], card_name: "Owned Bulbasaur", card_image: "https://assets.tcgdex.net/en/mock/base1/44/high.webp" }
    const wanted = { card_id: "sv03.5-166", card_name: "Wanted Bulbasaur", card_image: "https://assets.tcgdex.net/en/mock/sv03.5/166/high.webp", card_set: "151", card_language: "ja", card_finish: "holo", added_at: "2026-10-11T00:00:00Z" }
    await page.route(`${SUPABASE_URL}/rest/v1/pokemon_collection**`, route => route.fulfill({ json: [{ ...owned, wanted_cards: [wanted] }, SEEDED_COLLECTION[1]] }))
    await page.route("**/app/api/card-prices**", async route => {
      const body = route.request().postDataJSON() ?? {}
      await route.fulfill({ json: { prices: (body.cards ?? []).map((card: { cardId: string; language?: string }) => ({
        ...card, language: card.language ?? "en", gbpAmount: card.cardId === wanted.card_id ? 20 : 3,
        marketGbpAmount: card.cardId === wanted.card_id ? 20 : 3, confidence: "medium", updatedAt: new Date().toISOString(),
      })) } })
    })
    await clearCardPriceCache(page)
    await page.reload()
    const slot = page.locator('button[data-dex-id="1"]')
    await harness.openViewOptions()
    const modes = page.getByRole("group", { name: "Binder cards" })
    await expect(modes.getByRole("button", { name: "Mixed", exact: true })).toHaveAttribute("aria-pressed", "true")
    await expect(slot.locator("img")).toHaveAttribute("alt", "Wanted Bulbasaur")
    await harness.openViewOptions()
    await modes.getByRole("button", { name: "Owned", exact: true }).click()
    await expect(slot.locator("img")).toHaveAttribute("alt", "Owned Bulbasaur")
    await page.getByRole("button", { name: "Close view options", exact: true }).click()
    await slot.click()
    const detail = page.getByRole("dialog", { name: /bulbasaur details/i })
    await expect(detail.getByRole("img", { name: "Owned Bulbasaur", exact: true }).first()).toBeVisible()
    await expect(detail.getByText("Market", { exact: true }).locator("..")).toContainText("£3.00")
    await detail.getByRole("button", { name: /^close/i }).click()
    await harness.openViewOptions()
    await page.getByRole("group", { name: "Binder cards" }).getByRole("button", { name: "Wanted", exact: true }).click()
    await expect(slot.locator("img")).toHaveAttribute("alt", "Wanted Bulbasaur")
    await expect(page.locator('button[data-dex-id="4"] img')).toHaveAttribute("src", /official-artwork%2F4.png/)
    await expect(page.locator('button[data-dex-id="5"] img')).toHaveAttribute("src", /official-artwork%2F5.png/)
    await page.getByRole("button", { name: "Close view options", exact: true }).click()
    await slot.click()
    await expect(detail.getByRole("img", { name: "Wanted Bulbasaur", exact: true }).first()).toBeVisible()
    await detail.locator("summary").filter({ hasText: "Card & variant" }).click()
    await expect(detail).toContainText("Japanese")
    await expect(detail).toContainText("151")
    await expect(detail).toContainText("Owned since 1 Jan 2026")
    await expect(detail).toContainText("Wanted saved 11 Oct 2026")
    await expect(detail.getByText("Market", { exact: true }).locator("..")).toContainText("£20.00")
  })

  test("legacy wishlisted printing keeps its metadata and saved date across all modes", async ({ harness }) => {
    const { page } = harness
    // Synthetic legacy row, before wanted_cards held its printing.
    const legacy = { ...SEEDED_COLLECTION[0], status: "wishlisted", card_name: "Legacy Wanted Bulbasaur", card_image: "https://assets.tcgdex.net/ja/mock/base1/44/high.webp", card_set: "Legacy Set", card_language: "ja", card_finish: "reverse_holo", collected_at: "2025-02-03T00:00:00.000Z", wanted_cards: [] }
    await page.route(`${SUPABASE_URL}/rest/v1/pokemon_collection**`, route => route.fulfill({ json: [legacy] }))
    await page.reload()
    const slot = page.locator('button[data-dex-id="1"]')
    await harness.openViewOptions()
    const modes = page.getByRole("group", { name: "Binder cards" })
    await expect(slot.locator("img")).toHaveAttribute("alt", "Legacy Wanted Bulbasaur")
    await harness.openViewOptions()
    await modes.getByRole("button", { name: "Owned", exact: true }).click()
    await expect(slot.locator("img")).toHaveAttribute("src", /official-artwork%2F1.png/)
    await page.getByRole("button", { name: "Close view options", exact: true }).click()
    let detail = await harness.openCardDetail()
    await detail.locator("summary").filter({ hasText: "Card & variant" }).click()
    const cardDetails = detail.locator("details").filter({ has: page.locator("summary").filter({ hasText: /^Card & variant$/ }) })
    await expect(cardDetails.getByText("Legacy Wanted Bulbasaur", { exact: true })).toBeVisible()
    await expect(detail).toContainText("Legacy Set · Japanese · Reverse holo")
    await expect(detail).toContainText("Wanted saved 3 Feb 2025")
    await expect(detail.getByText(/Owned since/)).toHaveCount(0)
    await harness.closeControl(detail).click()
    await harness.openViewOptions()
    await page.getByRole("group", { name: "Binder cards" }).getByRole("button", { name: "Wanted", exact: true }).click()
    await expect(slot.locator("img")).toHaveAttribute("alt", "Legacy Wanted Bulbasaur")
    await page.getByRole("button", { name: "Close view options", exact: true }).click()
    detail = await harness.openCardDetail()
    await detail.locator("summary").filter({ hasText: "Card & variant" }).click()
    await expect(detail).toContainText("Wanted saved 3 Feb 2025")
    await expect(detail.getByText(/Owned since/)).toHaveCount(0)
  })
})

test("header keeps its width across dock views on wide screens", async ({ harness }) => {
  const { page } = harness
  await page.setViewportSize({ width: 1600, height: 1000 })
  const header = page.locator("nav").first().locator(":scope > div").first()
  const binder = await header.boundingBox()
  for (const name of ["List", "Wanted", "Browse", "Binder"]) {
    await page.locator("nav").first().getByRole("button", { name, exact: true }).filter({ visible: true }).first().click()
    const box = await header.boundingBox()
    expect(box!.width).toBe(binder!.width)
    expect(box!.x).toBe(binder!.x)
  }
})
