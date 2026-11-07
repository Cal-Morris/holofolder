import { test, expect, SEEDED_COLLECTION, SUPABASE_URL } from "./fixtures"
import type { TCGSetSlotCard } from "../lib/tcg-set-slots"

test.describe("reviewed catalog aliases across sets", () => {
  test.use({ signedIn: true })

  test("deduplicates artwork, preserves saved alias state and keeps stamps distinct online and offline", async ({ harness }) => {
    const page = harness.page
    // Synthetic aliases model one physical card under parent/gallery provider IDs.
    const sets = [{ id: "fixture-parent", name: "Fixture Parent" }, { id: "fixture-gallery", name: "Fixture Gallery" }]
    const base: TCGSetSlotCard = { id: "fixture-parent-1", aliasIds: ["fixture-gallery-1"], localId: "1", name: "Bulbasaur", language: "en", set: sets[0], inferredFinish: "holo", rarity: "Promo" }
    const alias = { ...base, id: "fixture-gallery-1", canonicalId: base.id, aliasIds: [base.id], set: sets[1] }
    const stamp = { ...base, id: `${base.id}~123456`, aliasIds: undefined, name: "Bulbasaur (Pokémon Center)" }
    const reprint = { ...base, id: "fixture-gallery-2", aliasIds: undefined, localId: "2", set: sets[1] }
    const wanted = { card_id: alias.id, card_name: "Bulbasaur", card_language: "en", card_finish: "holo", added_at: "2026-01-01" }
    let rows: Array<Record<string, unknown>> = SEEDED_COLLECTION.map(row => row.pokemon_id === 1 ? { ...row, card_id: alias.id, wanted_cards: [wanted] } : row)
    await page.route(`${SUPABASE_URL}/rest/v1/pokemon_collection**`, route => route.fulfill({ json: rows }))
    await page.route("**/app/api/collection**", async route => {
      const body = route.request().postDataJSON()
      rows = rows.map(row => row.pokemon_id === body.pokemonId ? { ...row, card_id: body.cardId, wanted_cards: body.wantedCards, status: body.status } : row)
      await route.fulfill({ json: { item: rows.find(row => row.pokemon_id === body.pokemonId) } })
    })
    await page.route("**/app/api/tcg-set-slots**", route => {
      const index = sets.findIndex(set => set.id === new URL(route.request().url()).searchParams.get("setId"))
      const cards = index === 0 ? [base, stamp] : [alias, reprint]
      return route.fulfill({ json: { sets, selectedSet: sets[index] ?? null, cards: index < 0 ? [] : cards, slots: index < 0 ? [] : [{ dexId: 1, pokemonName: "bulbasaur", cards }] } })
    })
    await page.reload()
    const openSets = async () => {
      await harness.dock().getByRole("button", { name: "Browse", exact: true }).click()
      await page.getByRole("button", { name: "Fixture Parent", exact: true }).click()
      await page.getByRole("textbox", { name: "Search sets by name or code" }).fill("gallery")
      await page.getByRole("button", { name: "Fixture Gallery", exact: true }).first().click()
    }
    await openSets()
    const group = page.getByRole("region", { name: "Bulbasaur matches", exact: true })
    await expect(group.getByRole("button", { name: /Fixture Parent.*#1/ })).toHaveCount(2)
    await expect(group.getByRole("button", { name: /Fixture Gallery.*#1/ })).toHaveCount(0)
    await expect(group.getByRole("button", { name: "In binder", exact: true })).toBeDisabled()
    await expect(group.getByRole("button", { name: "Want", exact: true })).toBeDisabled()
    await expect(group.getByText("Your binder card", { exact: true }).first()).toBeVisible()
    await group.getByRole("button", { name: /Fixture Parent.*Pokémon Center/ }).click()
    await group.getByRole("button", { name: "Want", exact: true }).click()
    await expect.poll(() => (rows.find(row => row.pokemon_id === 1)?.wanted_cards as Array<{ card_id: string }>).map(card => card.card_id)).toEqual([stamp.id, alias.id])
    expect(rows.find(row => row.pokemon_id === 1)?.card_id).toBe(alias.id)
    const cardsTab = page.getByRole("group", { name: "Set checklist" }).getByRole("button", { name: "Cards", exact: true })
    await cardsTab.click()
    const checklist = page.getByRole("list", { name: /Fixture Parent.*card checklist/ })
    await expect(checklist.getByRole("listitem")).toHaveCount(3)
    await expect(checklist.getByText("Owned", { exact: true })).toHaveCount(1)
    await expect(checklist.getByText("Wanted", { exact: true })).toHaveCount(2)
    await harness.dock().getByRole("button", { name: "Binder", exact: true }).click()
    await page.route("**/app/api/tcg-set-slots**", route => route.abort("internetdisconnected"))
    await page.context().setOffline(true)
    await openSets()
    await cardsTab.click()
    await expect(checklist.getByRole("listitem")).toHaveCount(3)
    await expect(checklist.getByText("Owned", { exact: true })).toHaveCount(1)
    await expect(checklist.getByText("Wanted", { exact: true })).toHaveCount(2)
    await harness.expectNoHorizontalOverflow()
  })
})
