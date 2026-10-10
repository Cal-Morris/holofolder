import { test, expect } from "./fixtures"
import { mockCardPrices } from "./price-fixtures"

// Synthetic set includes a Trainer, two Pokémon printings, and no real prices.
const set = { id: "synthetic", name: "Synthetic set", officialCardCount: 10 }
const cards = [
  { id: "synthetic-1", localId: "1", name: "Bulbasaur", language: "en", set, inferredFinish: "normal", rarity: "Common", image: "https://assets.tcgdex.net/en/mock/synthetic/1/high.webp" },
  { id: "synthetic-2", localId: "2", name: "Bulbasaur", language: "en", set, inferredFinish: "holo", rarity: "Rare" },
  { id: "synthetic-3", localId: "3", name: "Trainer fixture", language: "en", set, inferredFinish: "normal", rarity: "Uncommon" },
]

test("set value and momentum rankings include all cards and separate finishes", async ({ harness }) => {
  const { page } = harness
  await page.route("**/api/tcg-set-slots**", (route) => {
    const selected = new URL(route.request().url()).searchParams.has("setId")
    return route.fulfill({ json: { sets: [set], selectedSet: selected ? set : null, slots: selected ? [{ dexId: 1, pokemonName: "bulbasaur", cards: cards.slice(0, 2) }] : [], cards: selected ? cards : [] } })
  })
  await mockCardPrices(page, {
    "synthetic-1": { confidence: "high", market: 12, finishes: [{ finish: "normal", market: 12, trend: { "7d": 10, Trend: 12 } }, { finish: "reverse_holo", market: 18, trend: { "7d": 10, Trend: 18 } }] },
    "synthetic-2": { confidence: "medium", market: 24, finishes: [{ finish: "holo", market: 24, trend: { "7d": 20, Trend: 24 } }] },
    "synthetic-3": { confidence: "high", market: 30, finishes: [{ finish: "normal", market: 30, trend: { "7d": 20, Trend: 30 } }] },
  })
  await harness.dock().getByRole("button", { name: "Sets", exact: true }).click()
  await page.getByRole("button", { name: "Synthetic set", exact: true }).click()
  let region = page.getByRole("region", { name: "Synthetic set top value cards" })
  await expect(region.getByRole("listitem")).toHaveCount(4)
  await expect(region.getByRole("listitem").first()).toContainText("Trainer fixture")
  await expect(region.getByRole("listitem").first()).toContainText("£30")
  await expect(region.locator("img").first()).toHaveAttribute("src", /^\/api\/card-image-proxy\?url=/)
  const finishButton = region.getByRole("button", { name: "Non-holo", exact: true })
  await finishButton.evaluate((element) => element.scrollIntoView({ block: "center" }))
  await harness.expectMinTapTarget(finishButton)
  await harness.expectWithinSafeViewport(finishButton)
  await harness.expectHittable(finishButton)
  await region.getByRole("button", { name: "Non-holo", exact: true }).click()
  await expect(region.getByRole("listitem")).toHaveCount(2)
  await region.getByRole("button", { name: "Holo", exact: true }).click()
  await expect(region.getByRole("listitem")).toHaveCount(1)
  await region.getByRole("button", { name: "All finishes", exact: true }).click()
  await region.getByRole("button", { name: "Breakout", exact: true }).click()
  region = page.getByRole("region", { name: "Synthetic set breakout cards" })
  await expect(region.getByRole("listitem")).toHaveCount(4)
  await expect(region.getByRole("listitem").first()).toContainText("+80%")
  await harness.expectNoHorizontalOverflow()
  // The cached finish evidence remains available when the network goes away.
  await page.context().setOffline(true)
  await region.getByRole("button", { name: "Top value", exact: true }).click()
  await expect(page.getByRole("region", { name: "Synthetic set top value cards" }).getByRole("listitem")).toHaveCount(4)
  await page.route("**/api/tcg-set-slots**", (route) => route.abort("internetdisconnected"))
  await page.route("**/api/card-prices**", (route) => route.abort("internetdisconnected"))
  await harness.dock().getByRole("button", { name: "Binder", exact: true }).click()
  await harness.dock().getByRole("button", { name: "Sets", exact: true }).click()
  await page.getByRole("button", { name: "Synthetic set", exact: true }).click()
  await expect(page.getByRole("region", { name: "Synthetic set top value cards" }).getByRole("listitem")).toHaveCount(4)
})
