import { test, expect, MOCK_CARDS, SEEDED_COLLECTION, SUPABASE_URL } from "./fixtures"

test.describe("distinct catalog printings", () => {
  test.use({ signedIn: true })

  test("selects a stamped printing, keeps the base wanted card and reloads the exact identity", async ({ harness }) => {
    const page = harness.page
    // Synthetic stamped Bulbasaur verifies persistence without changing real market/card data.
    const base = MOCK_CARDS[0]
    const stamped = { ...base, id: `${base.id}~123456`, name: "Bulbasaur (Pokémon Center)", image: "https://product-images.tcgplayer.com/123456.jpg", variants: { holo: true } }
    const wanted = { card_id: base.id, card_name: base.name, card_image: base.image, card_set: base.set.name, card_language: "en", card_finish: "holo", added_at: "2026-10-15T00:00:00Z" }
    let rows: Array<Record<string, unknown>> = SEEDED_COLLECTION.map(row => ({ ...row, wanted_cards: row.pokemon_id === 1 ? [wanted] : [] }))
    await page.route("**/app/api/tcgdex-cache**", route => route.fulfill({ json: { cards: [base, stamped] } }))
    await page.route(`${SUPABASE_URL}/rest/v1/pokemon_collection**`, route => route.fulfill({ json: rows }))
    await page.route("**/app/api/collection**", async route => {
      const body = route.request().postDataJSON()
      const row = { ...rows.find(row => row.pokemon_id === body.pokemonId), pokemon_id: body.pokemonId, pokemon_name: body.pokemonName, card_id: body.cardId, card_name: body.cardName, card_image: body.cardImage, card_set: body.cardSet, card_language: body.cardLanguage, card_finish: body.cardFinish, wanted_cards: body.wantedCards, status: body.status }
      rows = rows.map(existing => existing.pokemon_id === body.pokemonId ? row : existing)
      await route.fulfill({ json: { item: row } })
    })
    await page.reload()
    await harness.openViewOptions()
    await page.getByRole("group", { name: "Binder cards", exact: true }).getByRole("button", { name: "Owned", exact: true }).click()
    await page.getByRole("button", { name: "Close view options", exact: true }).click()
    const detail = await harness.openCardDetail()
    await detail.getByRole("button", { name: /edit card|add card/i }).first().click()
    const selector = page.getByRole("dialog", { name: /card selector/i })
    await expect(selector.getByText("2 of 2 cards")).toBeVisible()
    await expect(selector.getByText(stamped.name, { exact: true }).filter({ visible: true })).toBeVisible()
    const select = selector.getByRole("button", { name: "Add card Bulbasaur (Pokémon Center) from Base Set", exact: true })
    await harness.expectMinTapTarget(select, 32)
    await select.click()
    await expect.poll(() => rows.find(row => row.pokemon_id === 1)?.card_id).toBe(stamped.id)
    expect(rows.find(row => row.pokemon_id === 1)?.wanted_cards).toEqual([wanted])
    await page.reload()
    await harness.openViewOptions()
    await page.getByRole("group", { name: "Binder cards", exact: true }).getByRole("button", { name: "Owned", exact: true }).click()
    await page.getByRole("button", { name: "Close view options", exact: true }).click()
    const reloaded = await harness.openCardDetail()
    await reloaded.locator("summary").filter({ hasText: "Card & variant" }).click()
    await expect(reloaded.getByText(stamped.name, { exact: true }).first()).toBeVisible()
    await harness.expectNoHorizontalOverflow()
  })
})
