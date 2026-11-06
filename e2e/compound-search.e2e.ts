import { test, expect } from "./fixtures"
import { searchOfflineCards } from "../lib/offline-card-index"

// Synthetic search fixture, no prices or collection writes.
const cards = [
  { id: "sv03.5-063", localId: "063", name: "Abra", set: { id: "sv03.5", name: "151" }, dexIds: [63] },
  { id: "base1-43", localId: "43", name: "Abra", set: { id: "base1", name: "Base Set" }, dexIds: [63] },
]

test("ordinary Search renders compound card hits and a useful empty state", async ({ harness, page }, info) => {
  await page.route("**/api/tcg-card-search**", route => {
    const query = new URL(route.request().url()).searchParams.get("q") ?? ""
    return route.fulfill({ json: { cards: searchOfflineCards(cards, query) } })
  })
  await harness.dock().getByRole("button", { name: "Search", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Search Pokemon" })
  const input = dialog.getByRole("textbox")
  await input.fill("abra 151")
  const results = dialog.getByRole("region", { name: "Card results" })
  await expect(results.getByText("151", { exact: true })).toBeVisible()
  await expect(results.getByText("Base Set", { exact: true })).toHaveCount(0)
  await harness.expectNoHorizontalOverflow()
  await page.screenshot({ path: `/tmp/compound-${info.project.name}-results.png` })
  await input.fill("zzzz nonexistent")
  await expect(dialog.getByText("No matches. Try a Pokémon name, a set, or both, like Abra 151.")).toBeVisible()
  await page.screenshot({ path: `/tmp/compound-${info.project.name}-empty.png` })
  await dialog.getByRole("button", { name: "Close search" }).click()
  await page.getByRole("button", { name: "Show mode", exact: true }).click()
  await harness.dock().getByRole("button", { name: "Search", exact: true }).click()
  const show = page.getByRole("dialog", { name: "Quick mode" })
  await show.getByRole("searchbox").fill("abra 151")
  await expect(show.getByRole("region", { name: "Cards", exact: true }).getByRole("button", { name: /Abra, 151/ })).toBeVisible()
  await expect(show.getByRole("region", { name: "Cards", exact: true }).getByText("Base Set", { exact: true })).toHaveCount(0)
  await page.evaluate(async cards => {
    const cache = await caches.open("compound-fixture-data")
    await cache.put("/api/tcg-card-search?q=fixture", new Response(JSON.stringify({ cards }), { headers: { "content-type": "application/json" } }))
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false })
  }, cards)
  await show.getByRole("searchbox").fill("151 abra")
  await expect(show.getByRole("region", { name: "Cards", exact: true })).toContainText("on this device")
  await expect(show.getByRole("region", { name: "Cards", exact: true }).getByRole("button", { name: /Abra, 151/ })).toBeVisible()
  await expect(show.getByRole("region", { name: "Cards", exact: true }).getByText("Base Set", { exact: true })).toHaveCount(0)
})
