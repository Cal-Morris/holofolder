import { test, expect } from "./fixtures"

test.describe("Pokémon perspective", () => {
  test.use({ signedIn: true })

  test("opens a dedicated species catalogue, filters and remembers the browse destination", async ({ harness }) => {
    const page = harness.page
    await harness.dock().getByRole("button", { name: "Sets", exact: true }).click()
    const perspective = page.getByRole("group", { name: "Browse perspective" })
    const pokemon = perspective.getByRole("button", { name: "Pokémon", exact: true })
    await harness.expectMinTapTarget(pokemon)
    await pokemon.click()
    await expect(page.getByRole("heading", { name: "Explore every Pokémon" })).toBeVisible()
    // The catalogue windows the 1,000+ species; it does not eagerly fetch their printings.
    expect(await page.getByRole("list", { name: "Pokémon catalogue" }).getByRole("listitem").count()).toBeLessThan(50)
    await page.getByTestId("view-scroller").evaluate(element => { element.scrollTop = element.scrollHeight })
    await page.getByRole("searchbox", { name: "Search Pokémon by name or dex number" }).fill("#0001")
    const browse = page.getByRole("button", { name: "Browse Bulbasaur cards", exact: true })
    await harness.expectMinTapTarget(browse)
    await browse.click()
    await expect(page.getByRole("dialog", { name: "All Bulbasaur cards", exact: true })).toBeVisible()
    await harness.dock().getByRole("button", { name: "List", exact: true }).click()
    await expect(harness.dialogs()).toHaveCount(0)
    await expect(page.getByRole("heading", { name: "Manage the dex quickly" })).toBeVisible()
    await harness.dock().getByRole("button", { name: "Sets", exact: true }).click()
    await expect(page.getByRole("heading", { name: "Explore every Pokémon" })).toBeVisible()
    await page.getByRole("searchbox", { name: "Search Pokémon by name or dex number" }).fill("charmander")
    await expect(page.getByRole("button", { name: "Browse Charmander cards", exact: true })).toBeVisible()
    await page.getByRole("group", { name: "Filter Pokémon species" }).getByRole("button", { name: /^missing/i }).click()
    await expect(page.getByText("No Pokémon match this search.")).toBeVisible()
    await harness.expectNoHorizontalOverflow()
    await harness.expectHittable(harness.dock().getByRole("button", { name: "Binder", exact: true }))
  })

  test("a missing offline browse chunk leaves the current view usable", async ({ harness }) => {
    const page = harness.page
    await harness.dock().getByRole("button", { name: "Sets", exact: true }).click()
    await expect(page.getByRole("heading", { name: "Find matches across sets" })).toBeVisible()
    await page.route("**/_next/static/chunks/*.js", route => route.abort())
    await page.getByRole("group", { name: "Browse perspective" }).getByRole("button", { name: "Pokémon" }).click()
    await expect(page.getByRole("alert").filter({ hasText: "Pokémon browsing could not load" })).toBeVisible()
    await expect(page.getByRole("heading", { name: "Find matches across sets" })).toBeVisible()
    await harness.expectHittable(harness.dock().getByRole("button", { name: "Binder", exact: true }))
  })

  test("unavailable card lookup stays distinct from an empty mirror", async ({ harness }) => {
    const page = harness.page
    await page.route("**/api/tcgdex-cache**", route => route.abort())
    await harness.dock().getByRole("button", { name: "Sets", exact: true }).click()
    await page.getByRole("group", { name: "Browse perspective" }).getByRole("button", { name: "Pokémon" }).click()
    await page.getByRole("searchbox").fill("mew")
    await page.getByRole("button", { name: "Browse Mew cards", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "All Mew cards", exact: true })
    await expect(dialog.getByText(/Could not load cards/)).toBeVisible()
    await expect(dialog.getByText("Card catalogue unavailable", { exact: true })).toBeVisible()
    await harness.closeControl(dialog).click()
    await page.route("**/api/tcgdex-cache**", route => route.fulfill({ json: { cards: [] } }))
    await page.getByRole("searchbox").fill("mewtwo")
    await page.getByRole("button", { name: "Browse Mewtwo cards", exact: true }).click()
    await expect(page.getByText("No mirrored cards found for this Pokémon yet.")).toBeVisible()
  })
})
