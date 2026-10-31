import { test, expect, SUPABASE_URL, type Harness } from "./fixtures"
import { HUNT_COLLECTION } from "./hunt-fixtures"

// Outside Show mode, Search and Quick mode stamp each printing Owned / Wanted like Show mode does,
// and Quick mode lists wanted printings first. (Owned: Base Set Bulbasaur; wanted: 151 #166 and Phantasmal Flames #001.)

const SCREENS = process.env.E2E_SCREENSHOT_DIR

async function screenshot(harness: Harness, name: string) {
  if (SCREENS && test.info().project.name.startsWith("standalone-390")) await harness.page.screenshot({ path: `${SCREENS}/badges-${name}.png` })
}

async function seedCollection(harness: Harness) {
  const { page } = harness
  await page.route(`${SUPABASE_URL}/rest/v1/pokemon_collection**`, (route) =>
    route.request().method() === "GET" ? route.fulfill({ json: HUNT_COLLECTION }) : route.fallback())
  await page.reload()
  await expect(page.locator('button[data-dex-id="1"]').first()).toBeVisible()
}

test.describe("Owned / Wanted badges outside Show mode", () => {
  test.use({ signedIn: true })

  test("Quick mode badges each printing and lists wanted ones first", async ({ harness }) => {
    await seedCollection(harness)
    const search = harness.dock().getByRole("button", { name: "Search", exact: true })
    const box = (await search.boundingBox())!
    await harness.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await harness.page.mouse.down()
    const dialog = harness.page.getByRole("dialog", { name: "Quick mode" })
    await expect(dialog).toBeVisible()
    await harness.page.mouse.up()
    await expect(dialog.getByRole("heading", { name: "Quick mode" })).toBeVisible()

    await dialog.getByRole("searchbox").fill("bulbasaur")
    const cards = dialog.getByRole("region", { name: "Cards" })
    const rows = cards.locator("button[data-standing]")
    await expect(cards.getByRole("button", { name: /^Bulbasaur, Base Set .*, Owned/ })).toBeVisible()
    await expect(cards.getByRole("button", { name: /^Bulbasaur, 151 166.*, Wanted/ })).toContainText("Wanted")
    await expect(cards.getByRole("button", { name: /^Bulbasaur, Phantasmal Flames .*, Wanted/ })).toContainText("Wanted")
    // A printing that's neither owned nor wanted carries no pill (no "Not in binder" noise outside Show).
    await expect(cards.getByRole("button", { name: /^Bulbasaur, Crown Zenith / })).not.toContainText(/Owned|Wanted|Not in binder/)

    const standings = await rows.evaluateAll((buttons) => buttons.map((button) => button.getAttribute("data-standing")))
    expect(standings.slice(0, 2)).toEqual(["wanted", "wanted"])
    expect(standings.slice(2)).not.toContain("wanted")
    await screenshot(harness, "quick")
    await harness.expectNoHorizontalOverflow()
  })

  test("Search card hits carry Owned / Wanted badges on their thumbnails", async ({ harness }) => {
    await seedCollection(harness)
    await harness.dock().getByRole("button", { name: "Search", exact: true }).click()
    const sheet = harness.page.getByRole("dialog", { name: /search pokemon/i })
    await expect(sheet).toBeVisible()
    await sheet.getByPlaceholder(/Search Pokémon, cards/).fill("bulbasaur")
    const hits = sheet.getByRole("region", { name: "Card results" })
    await expect(hits.locator('button[data-standing="owned"]').filter({ hasText: "Base Set" })).toContainText("Owned")
    await expect(hits.getByRole("button", { name: /^Bulbasaur 166\/165 151, Wanted$/ })).toContainText("Wanted")
    await expect(hits.locator('button[data-standing="missing"]').first()).not.toContainText(/Owned|Wanted/)
    await hits.scrollIntoViewIfNeeded()
    await screenshot(harness, "search")
    await harness.expectNoHorizontalOverflow()
  })
})
