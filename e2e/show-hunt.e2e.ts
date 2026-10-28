import { test, expect, SUPABASE_URL, type Harness } from "./fixtures"
import { HUNT_COLLECTION, HUNT_PRICES } from "./hunt-fixtures"
import { mockCardPrices } from "./price-fixtures"

const SCREENS = process.env.E2E_SCREENSHOT_DIR

async function screenshot(harness: Harness, name: string) {
  if (SCREENS && test.info().project.name.startsWith("standalone-390")) await harness.page.screenshot({ path: `${SCREENS}/quick-${name}.png` })
}

const banner = (harness: Harness) => harness.page.getByRole("region", { name: "Show mode" })
const quickDialog = (harness: Harness) => harness.page.getByRole("dialog", { name: "Quick mode" })

async function seedHuntList(harness: Harness) {
  const { page } = harness
  await page.route(`${SUPABASE_URL}/rest/v1/pokemon_collection**`, (route) =>
    route.request().method() === "GET" ? route.fulfill({ json: HUNT_COLLECTION }) : route.fallback())
  await mockCardPrices(page, HUNT_PRICES)
  await page.reload()
  await expect(page.locator('button[data-dex-id="1"]').first()).toBeVisible()
}

async function openShowMode(harness: Harness) {
  if (!(await banner(harness).isVisible())) await harness.page.getByRole("button", { name: "Show mode", exact: true }).click()
  await banner(harness).getByRole("button", { name: "Search", exact: true }).click()
  const dialog = quickDialog(harness)
  await expect(dialog).toBeVisible()
  return dialog
}

const groupNames = (hunt: ReturnType<Harness["page"]["getByTestId"]>) =>
  hunt.locator('section[aria-label^="Hunting "]').evaluateAll((sections) => sections.map((section) => section.getAttribute("aria-label")))

test.describe("Show mode finder", () => {
  test.use({ signedIn: true })

  test("opens on the Hunting list: the want list by Pokémon, most wanted or top value first, with pay-up-to prices", async ({ harness }) => {
    await seedHuntList(harness)
    const dialog = await openShowMode(harness)
    await expect(dialog.getByRole("heading", { name: "Show mode" })).toBeVisible()
    await harness.expectMinTapTarget(dialog.getByRole("button", { name: "Close quick mode" }), 48)
    for (const name of ["Search", "Exit show mode"]) await harness.expectMinTapTarget(banner(harness).getByRole("button", { name, exact: true }), 48)
    const hunt = dialog.getByTestId("show-hunt")
    await expect(hunt).toBeVisible()
    for (const name of ["Most wanted", "Top value"]) await harness.expectMinTapTarget(hunt.getByRole("radio", { name, exact: true }), 48)
    for (const name of ["Set", "Illustrator"]) await harness.expectMinTapTarget(hunt.getByRole("combobox", { name }), 48)
    // The keyboard stays down so the list can be read against a dealer's binder.
    await expect(dialog.getByRole("searchbox")).not.toBeFocused()
    await expect(hunt.getByRole("heading", { name: /Hunting · 4 cards/ })).toBeVisible()
    await expect.poll(() => groupNames(hunt)).toEqual(["Hunting Bulbasaur", "Hunting Charizard", "Hunting Charmander", "Hunting Squirtle"])
    await expect(hunt.getByRole("region", { name: "Hunting Squirtle" })).toContainText("any card")

    const bulbasaur = hunt.getByRole("region", { name: "Hunting Bulbasaur" })
    const topCard = bulbasaur.getByRole("button", { name: /^Bulbasaur, 151 166\/165/ })
    await expect(topCard).toHaveAttribute("data-standing", "wanted")
    await expect(topCard.getByTestId("hunt-pay-up-to")).toHaveText("£44.00")
    await expect(topCard).toContainText("Market £40.00")
    await harness.expectMinTapTarget(topCard, 48)
    // The want list's finish is priced, not the headline price.
    await expect(hunt.getByRole("region", { name: "Hunting Charmander" }).getByTestId("hunt-pay-up-to")).toHaveText("£2.75")

    await hunt.getByRole("radiogroup", { name: "Sort" }).getByRole("radio", { name: "Top value" }).click()
    await expect.poll(() => groupNames(hunt)).toEqual(["Hunting Charizard", "Hunting Bulbasaur", "Hunting Charmander", "Hunting Squirtle"])
    await harness.expectNoHorizontalOverflow()
    await screenshot(harness, "show-hunt")

    // One tap into the deal check, on the wanted printing.
    await hunt.getByRole("region", { name: "Hunting Charizard" }).getByRole("button", { name: /^Charizard ex, 151/ }).click()
    const check = dialog.getByTestId("quick-card-check")
    await expect(check).toBeVisible()
    await expect(check.getByTestId("quick-card-market-price")).toHaveText("£50.00")
    await check.getByRole("button", { name: /^Back/ }).first().click()
    await expect(dialog.getByTestId("show-hunt")).toBeVisible()
  })

  test("era, set and illustrator filters narrow the Hunting list", async ({ harness }) => {
    await seedHuntList(harness)
    const dialog = await openShowMode(harness)
    const hunt = dialog.getByTestId("show-hunt")
    const eras = hunt.getByRole("radiogroup", { name: "Era" })
    await expect(eras.getByRole("radio")).toHaveText(["All eras", "Mega Evolution1", "Scarlet & Violet3"])
    await eras.getByRole("radio", { name: /^Mega Evolution/ }).click()
    await expect.poll(() => groupNames(hunt)).toEqual(["Hunting Bulbasaur"])
    await expect(hunt.getByRole("button", { name: /^Bulbasaur, Phantasmal Flames/ })).toBeVisible()
    await expect(hunt.getByRole("button", { name: /^Bulbasaur, 151/ })).toHaveCount(0)
    await eras.getByRole("radio", { name: "All eras" }).click()

    await hunt.getByRole("combobox", { name: "Set" }).selectOption({ label: "151 (3)" })
    await expect.poll(() => groupNames(hunt)).toEqual(["Hunting Charizard", "Hunting Bulbasaur", "Hunting Charmander"])
    await hunt.getByRole("combobox", { name: "Set" }).selectOption("")

    await hunt.getByRole("combobox", { name: "Illustrator" }).selectOption("Mitsuhiro Arita")
    await expect.poll(() => groupNames(hunt)).toEqual(["Hunting Bulbasaur"])
    await expect(hunt.getByRole("button", { name: /^Bulbasaur, / })).toHaveCount(1)
    await expect(hunt.getByRole("button", { name: /^Bulbasaur, 151 166/ })).toBeVisible()
    // The want list's own illustrator counts too (Charizard), alongside the directory's cards (Charmander).
    await hunt.getByRole("combobox", { name: "Illustrator" }).selectOption("5ban Graphics")
    await expect.poll(() => groupNames(hunt)).toEqual(["Hunting Charizard", "Hunting Charmander"])
    await hunt.getByRole("combobox", { name: "Illustrator" }).selectOption("")
    await expect.poll(() => groupNames(hunt)).toHaveLength(4)
  })

  test("search by Pokémon: wanted first with what to pay, the rest, owned dimmed last", async ({ harness }) => {
    await seedHuntList(harness)
    const dialog = await openShowMode(harness)
    await dialog.getByRole("searchbox").fill("bulba")
    const pokemon = dialog.getByRole("region", { name: "Pokémon" })
    const bulbasaur = pokemon.getByRole("button", { name: /Bulbasaur/ }).first()
    await expect(bulbasaur).toContainText("2 wanted")
    await expect(bulbasaur.locator("img")).toHaveCount(1)
    await harness.expectMinTapTarget(bulbasaur, 48)
    await bulbasaur.click()

    const view = dialog.getByTestId("show-pokemon-cards")
    await expect(view).toBeVisible()
    await expect(view.getByTestId("show-pokemon-counts")).toContainText("6 cards · 2 wanted · 1 owned")
    const rows = view.locator("button[data-standing]")
    await expect.poll(() => rows.evaluateAll((buttons) => buttons.map((button) => button.getAttribute("data-standing"))))
      .toEqual(["wanted", "wanted", "missing", "missing", "missing", "owned"])
    await expect(rows.first()).toHaveAccessibleName(/^Bulbasaur, 151 166\/165.*wanted, pay up to £44\.00/)
    await expect(rows.last()).toHaveAccessibleName(/^Bulbasaur, Base Set 44\/102, owned/)
    await expect(rows.last()).toHaveCSS("opacity", "0.55")
    await harness.expectNoHorizontalOverflow()
    await screenshot(harness, "show-pokemon")

    await rows.nth(1).click()
    const check = dialog.getByTestId("quick-card-check")
    await expect(check).toBeVisible()
    await check.getByRole("button", { name: /^Back/ }).first().click()
    // Back returns to the Pokémon, then to Hunting.
    await expect(view).toBeVisible()
    await view.getByRole("button", { name: "Back to hunting" }).click()
    await expect(dialog.getByTestId("show-hunt")).toBeVisible()

    // Enter on a Pokémon search opens the top match.
    await dialog.getByRole("searchbox").fill("chariz")
    await dialog.getByRole("searchbox").press("Enter")
    await expect(dialog.getByRole("region", { name: "Charizard cards" })).toBeVisible()
  })

  test("works offline from the want list on this device", async ({ harness }) => {
    await seedHuntList(harness)
    // Prices seen once are kept on the device. (The deal check's code is lazy-loaded; the service worker
    // precaches it in the app, but it's blocked here, so open one check while online.)
    let dialog = await openShowMode(harness)
    await expect(dialog.getByTestId("hunt-pay-up-to").first()).toBeVisible()
    await dialog.getByTestId("hunt-pay-up-to").first().click()
    await expect(dialog.getByTestId("quick-card-check")).toBeVisible()
    await harness.page.keyboard.press("Escape")
    await expect(dialog).toBeHidden()

    await harness.page.context().setOffline(true)
    dialog = await openShowMode(harness)
    const hunt = dialog.getByTestId("show-hunt")
    await expect(hunt.getByRole("heading", { name: /Hunting · 4 cards · offline/ })).toBeVisible()
    await expect.poll(() => groupNames(hunt)).toHaveLength(4)
    await hunt.getByRole("button", { name: "Charmander: all cards" }).click()
    const view = dialog.getByTestId("show-pokemon-cards")
    await expect(view).toBeVisible()
    await expect(view.locator('button[data-standing="wanted"]').first()).toHaveAccessibleName(/^Charmander, 151 004\/165/)
    await view.locator('button[data-standing="wanted"]').first().click()
    await expect(dialog.getByTestId("quick-card-check")).toBeVisible()
    await harness.page.context().setOffline(false)
  })
})
