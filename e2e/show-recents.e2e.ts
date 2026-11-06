import { emptyHistory, historyStorageKey } from "../lib/binder-history"
import { test, expect, SUPABASE_URL } from "./fixtures"
import { HUNT_COLLECTION, HUNT_PRICES } from "./hunt-fixtures"
import { mockCardPrices } from "./price-fixtures"

const scopedKey = historyStorageKey({ accountId: "00000000-0000-4000-8000-0000000000e2", ownerId: "00000000-0000-4000-8000-0000000000e2", binderId: "local" })

// Synthetic history in the existing shared store, including a legacy Search entry.
const recent = [
  { id: "sv03.5-004", name: "Charmander", number: "004/165", setName: "151", dexId: 4, pokemonName: "charmander", viewedAt: "2026-01-01", finish: "reverse_holo", variants: { normal: true, reverse: true } },
  { id: "sv03.5-166", name: "Bulbasaur", number: "166/165", setName: "151", dexId: 1, pokemonName: "bulbasaur", viewedAt: "2026-01-01" },
]

test.describe("Show recently viewed", () => {
  test.use({ signedIn: true })

  test("shared recents reopen exact printings, update order, and clear without squeezing Hunt", async ({ harness, page }, info) => {
    await page.route(`${SUPABASE_URL}/rest/v1/pokemon_collection**`, route => route.request().method() === "GET" ? route.fulfill({ json: HUNT_COLLECTION }) : route.fallback())
    let meteredRequests = 0
    await page.route("**/api/card-price-checks**", route => {
      meteredRequests++
      return route.abort()
    })
    await mockCardPrices(page, HUNT_PRICES)
    await page.evaluate(({ key, snapshot }) => localStorage.setItem(key, JSON.stringify(snapshot)), { key: scopedKey, snapshot: { ...emptyHistory(), cards: recent, clientId: crypto.randomUUID(), sequence: 0, pending: [] } })
    await page.reload()
    await page.getByRole("button", { name: "Show mode", exact: true }).click()
    await harness.dock().getByRole("button", { name: "Search", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "Quick mode" })
    const rail = dialog.getByRole("region", { name: "Recently viewed cards" })
    await expect(rail).toBeVisible()
    await expect(dialog.getByRole("searchbox")).not.toBeFocused()
    const charmander = rail.getByRole("button", { name: /^Charmander,/ })
    await expect(charmander).toHaveAttribute("data-standing", "wanted")
    await harness.expectMinTapTarget(charmander, 36)
    await harness.expectMinTapTarget(rail.getByRole("button", { name: "Clear recently viewed cards" }), 36)
    await harness.expectWithinSafeViewport(rail)
    await harness.expectNoHorizontalOverflow()
    const hunt = dialog.getByTestId("show-hunt")
    const huntBox = await hunt.boundingBox()
    expect(huntBox!.height).toBeGreaterThan(200)
    await page.screenshot({ path: `/tmp/show-recents-${info.project.name}.png` })
    await charmander.click()
    const check = dialog.getByTestId("quick-card-check")
    await expect(check).toContainText("Charmander")
    await expect(check.getByRole("radio", { name: "Reverse", exact: true })).toBeChecked()
    await check.getByRole("button", { name: /^Back/ }).first().click()
    await rail.getByRole("button", { name: /^Bulbasaur,/ }).click()
    await expect(check).toContainText("166/165")
    await check.getByRole("button", { name: /^Back/ }).first().click()
    await expect(rail.locator("button[data-standing]").first()).toHaveAccessibleName(/^Bulbasaur,/)
    await expect(rail.locator("button[data-standing]")).toHaveCount(2)
    await rail.getByRole("button", { name: "Clear recently viewed cards" }).click()
    await expect(rail).toHaveCount(0)
    const emptyHuntBox = await hunt.boundingBox()
    expect(emptyHuntBox!.height).toBe(huntBox!.height)
    await test.info().attach("hunt-scroll-height", { body: JSON.stringify({ withRecents: huntBox!.height, withoutRecents: emptyHuntBox!.height }), contentType: "application/json" })
    await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).cards.length, scopedKey)).toBe(0)
    // Hunt selection immediately repopulates history, retaining its known finish.
    await hunt.getByRole("button", { name: /^Charmander, 151/ }).click()
    await check.getByRole("button", { name: /^Back/ }).first().click()
    await expect(rail.getByRole("button", { name: /^Charmander,/ })).toContainText("Reverse")
    expect(meteredRequests).toBe(0)
    await page.evaluate(() => document.documentElement.classList.remove("dark"))
    await page.screenshot({ path: `/tmp/show-recents-light-${info.project.name}.png` })
    await harness.expectNoHorizontalOverflow()
  })

  test("empty history hides the rail, search picks appear on return and offline reopen needs no search", async ({ harness, page }) => {
    await page.getByRole("button", { name: "Show mode", exact: true }).click()
    await harness.dock().getByRole("button", { name: "Search", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "Quick mode" })
    const rail = dialog.getByRole("region", { name: "Recently viewed cards" })
    await expect(rail).toHaveCount(0)
    await dialog.getByRole("searchbox").fill("bulbasaur")
    await dialog.getByRole("region", { name: "Cards", exact: true }).getByRole("button", { name: /Bulbasaur, 151 166/ }).click()
    const check = dialog.getByTestId("quick-card-check")
    await expect(check).toBeVisible()
    await check.getByRole("button", { name: /^Back/ }).first().click()
    await dialog.getByRole("searchbox").fill("")
    await expect(rail.locator("button[data-standing]")).toHaveCount(1)
    await page.evaluate(() => Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false }))
    await page.route("**/api/tcg-card-search**", route => route.abort())
    await rail.getByRole("button", { name: /^Bulbasaur,/ }).click()
    await expect(check).toContainText("151")
  })

  test("regular Search history is shared with Show mode and stays cleared after reopening", async ({ harness, page }) => {
    await harness.dock().getByRole("button", { name: "Search", exact: true }).click()
    const search = page.getByRole("dialog", { name: "Search Pokemon" })
    await search.getByRole("textbox").fill("charm")
    await search.getByRole("region", { name: "Card results" }).getByRole("button", { name: /charmander 168\/165 151/i }).click()
    await page.getByRole("button", { name: "Close all cards" }).click()
    await page.getByRole("button", { name: "Show mode", exact: true }).click()
    await harness.dock().getByRole("button", { name: "Search", exact: true }).click()
    const show = page.getByRole("dialog", { name: "Quick mode" })
    await expect(show.getByRole("region", { name: "Recently viewed cards" }).getByRole("button", { name: /Charmander, 151 168\/165/ })).toBeVisible()
    await show.getByRole("button", { name: "Clear recently viewed cards" }).click()
    await show.getByRole("button", { name: "Close quick mode" }).click()
    await harness.dock().getByRole("button", { name: "Search", exact: true }).click()
    await expect(show.getByRole("region", { name: "Recently viewed cards" })).toHaveCount(0)
  })

})
