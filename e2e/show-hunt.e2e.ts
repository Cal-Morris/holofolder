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
    for (const name of ["Sort", "Era", "Set", "Illustrator"]) await harness.expectMinTapTarget(hunt.getByRole("combobox", { name }), 44)
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

    await hunt.getByRole("combobox", { name: "Sort" }).selectOption("value")
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

  test("Good pickups: wanted cards whose price dropped, biggest fall first, one tap to the deal check", async ({ harness }) => {
    const { page } = harness
    await page.route(`${SUPABASE_URL}/rest/v1/pokemon_collection**`, (route) =>
      route.request().method() === "GET" ? route.fulfill({ json: HUNT_COLLECTION }) : route.fallback())
    // Synthetic trends: Charizard −40% vs 30d, Bulbasaur 151 −20% vs 7d, Phantasmal Bulbasaur −5% (under the drop rule).
    await mockCardPrices(page, {
      ...HUNT_PRICES,
      "sv03.5-006": { ...HUNT_PRICES["sv03.5-006"], trend: { Trend: 50, "30d": 83.33 } },
      "sv03.5-166": { ...HUNT_PRICES["sv03.5-166"], trend: { Trend: 40, "7d": 50 } },
      "me02-001": { ...HUNT_PRICES["me02-001"], trend: { Trend: 3, "7d": 3.15 } },
    })
    await page.reload()
    await expect(page.locator('button[data-dex-id="1"]').first()).toBeVisible()
    const dialog = await openShowMode(harness)
    const pickups = dialog.getByRole("region", { name: "Good pickups" })
    await pickups.locator("summary").click()
    await expect(pickups).toBeVisible()
    const tiles = pickups.getByTestId("good-pickup")
    await expect(tiles).toHaveCount(2)
    await expect(tiles.nth(0)).toHaveAccessibleName(/^Charizard ex, 151, price dropped 40% over 30d, pay up to £55\.00/)
    await expect(tiles.nth(1)).toHaveAccessibleName(/^Bulbasaur, 151, price dropped 20% over 7d, pay up to £44\.00/)
    await expect(tiles.nth(0).getByTestId("price-drop-badge")).toContainText("−40%")
    await harness.expectMinTapTarget(tiles.nth(0), 48)
    await screenshot(harness, "good-pickups")

    // Filters apply: Mega Evolution has no qualifying drop, so the strip hides.
    await dialog.getByTestId("show-hunt").getByRole("combobox", { name: "Era" }).selectOption({ label: "Mega Evolution (1)" })
    await expect(pickups).toBeHidden()
    await dialog.getByTestId("show-hunt").getByRole("combobox", { name: "Era" }).selectOption("")

    await pickups.locator("summary").click()
    await tiles.nth(0).click()
    await expect(dialog.getByTestId("quick-card-check")).toBeVisible()
  })

  test("% down / % up sort the Hunting list, a Pokémon's cards and the card search by price move", async ({ harness }) => {
    const { page } = harness
    await page.route(`${SUPABASE_URL}/rest/v1/pokemon_collection**`, (route) =>
      route.request().method() === "GET" ? route.fulfill({ json: HUNT_COLLECTION }) : route.fallback())
    // Synthetic trends: Charmander −50% vs 7d, Charizard −40% vs 30d, Bulbasaur 151 −20%, Phantasmal Bulbasaur +50%.
    await mockCardPrices(page, {
      ...HUNT_PRICES,
      "sv03.5-004": { ...HUNT_PRICES["sv03.5-004"], market: 1, trend: { Trend: 1, "7d": 2 } },
      "sv03.5-006": { ...HUNT_PRICES["sv03.5-006"], trend: { Trend: 50, "30d": 83.33 } },
      "sv03.5-166": { ...HUNT_PRICES["sv03.5-166"], trend: { Trend: 40, "7d": 50 } },
      "me02-001": { ...HUNT_PRICES["me02-001"], trend: { Trend: 4.5, "7d": 3 } },
    })
    await page.reload()
    await expect(page.locator('button[data-dex-id="1"]').first()).toBeVisible()
    const dialog = await openShowMode(harness)
    const hunt = dialog.getByTestId("show-hunt")
    const sort = hunt.getByRole("combobox", { name: "Sort" })
    await harness.expectMinTapTarget(sort, 44)
    await harness.expectNoHorizontalOverflow()

    await sort.selectOption("falling")
    await expect.poll(() => groupNames(hunt)).toEqual(["Hunting Charmander", "Hunting Charizard", "Hunting Bulbasaur", "Hunting Squirtle"])
    await screenshot(harness, "hunt-sort-down")
    await sort.selectOption("rising")
    await expect.poll(() => groupNames(hunt)).toEqual(["Hunting Bulbasaur", "Hunting Charizard", "Hunting Charmander", "Hunting Squirtle"])
    await expect(hunt.getByRole("region", { name: "Hunting Bulbasaur" }).locator("button[data-standing]").first()).toHaveAccessibleName(/^Bulbasaur, Phantasmal Flames/)

    // A Pokémon's cards: the rise leads with % up, Default goes back to wanted-first by value.
    await hunt.getByRole("button", { name: "Bulbasaur: all cards" }).click()
    const view = dialog.getByTestId("show-pokemon-cards")
    const rows = view.locator("button[data-standing]")
    const moves = view.getByRole("radiogroup", { name: "Price move" })
    await expect(rows.first()).toHaveAccessibleName(/^Bulbasaur, 151 166/)
    await moves.getByRole("radio", { name: "Biggest price rise first" }).click()
    await expect(rows.first()).toHaveAccessibleName(/^Bulbasaur, Phantasmal Flames/)
    await moves.getByRole("radio", { name: "Biggest price drop first" }).click()
    await expect(rows.first()).toHaveAccessibleName(/^Bulbasaur, 151 166/)
    await view.getByRole("button", { name: "Back to hunting" }).click()

    // Card search: same chips over the found cards.
    await dialog.getByRole("searchbox").fill("bulbasaur")
    const cards = dialog.getByRole("region", { name: "Cards" })
    const found = cards.locator("button[data-standing]")
    await expect.poll(() => found.count()).toBeGreaterThan(2)
    await cards.getByRole("radiogroup", { name: "Price move" }).getByRole("radio", { name: "Biggest price rise first" }).click()
    await expect(found.first()).toHaveAccessibleName(/^Bulbasaur, Phantasmal Flames/)
    await cards.getByRole("radiogroup", { name: "Price move" }).getByRole("radio", { name: "Biggest price drop first" }).click()
    await expect(found.first()).toHaveAccessibleName(/^Bulbasaur, 151 166/)
    await harness.expectNoHorizontalOverflow()
  })

  test("Check comps bakes sold comps for the Hunting cards, dearest first, with progress", async ({ harness }) => {
    const { page } = harness
    // Synthetic sold / asking samples, checked just now; never real sale data.
    const checkedAt = new Date().toISOString()
    const requested: string[] = []
    let release!: () => void
    const held = new Promise<void>((resolve) => { release = resolve })
    await page.route("**/api/card-price-checks?**", async (route) => {
      const params = new URL(route.request().url()).searchParams
      const source = params.get("source")
      if (source === "soldcomps") requested.push(params.get("cardId") ?? "")
      await held
      await route.fulfill({ json: {
        ebay: source === "ebay" ? { summary: { kind: "asking", currency: "GBP", count: 2, median: 5, low: 4, high: 6 }, checkedAt } : null,
        soldcomps: source === "soldcomps" ? { summary: { kind: "sold", currency: "GBP", count: 2, median: 5, low: 4, high: 6 }, checkedAt } : null,
        errors: {},
      } })
    })
    await seedHuntList(harness)
    const dialog = await openShowMode(harness)
    const comps = dialog.getByTestId("show-check-comps")
    const button = comps.getByRole("button", { name: "Check comps" })
    await harness.expectMinTapTarget(button, 48)
    await button.click()
    await expect(comps.getByRole("status")).toContainText("Checking comps 0/4")
    await expect(comps.getByRole("progressbar", { name: "Comps checked" })).toHaveAttribute("aria-valuemax", "4")
    await harness.expectMinTapTarget(comps.getByRole("button", { name: "Stop checking comps" }), 48)
    // The rest of Show stays usable while it runs.
    await expect(dialog.getByTestId("show-hunt").getByRole("combobox", { name: "Sort" })).toBeEnabled()
    await harness.expectNoHorizontalOverflow()
    await screenshot(harness, "show-check-comps")
    release()
    await expect(comps.getByRole("status")).toHaveText("Sold comps ready for 4/4 cards.")
    await expect(comps.getByRole("progressbar")).toHaveCount(0)
    // Dearest first (Charizard ex £50, then Bulbasaur £40).
    expect(requested.slice(0, 2).sort()).toEqual(["sv03.5-006", "sv03.5-166"])
    expect([...requested].sort()).toEqual(["me02-001", "sv03.5-004", "sv03.5-006", "sv03.5-166"])
  })

  test("Check comps big run: in-app confirm Cancel aborts, Check now proceeds", async ({ harness }, testInfo) => {
    const { page } = harness
    const checkedAt = new Date().toISOString()
    const requested: string[] = []
    await page.route("**/api/card-price-checks?**", async (route) => {
      const params = new URL(route.request().url()).searchParams
      const source = params.get("source")
      if (source === "soldcomps") requested.push(params.get("cardId") ?? "")
      await route.fulfill({ json: {
        ebay: source === "ebay" ? { summary: { kind: "asking", currency: "GBP", count: 1, median: 2, low: 1, high: 3 }, checkedAt } : null,
        soldcomps: source === "soldcomps" ? { summary: { kind: "sold", currency: "GBP", count: 1, median: 2, low: 1, high: 3 }, checkedAt } : null,
        errors: {},
      } })
    })

    // 15+ wanted printings so the engine asks confirmSpend (CHECK_COMPS_CONFIRM_AT).
    const bigWanted = Array.from({ length: 15 }, (_, i) => {
      const n = String(i + 1).padStart(3, "0")
      return {
        card_id: `sv03.5-${n}`,
        card_name: `Bulbasaur ${n}`,
        card_set: "151",
        card_language: "en",
        card_finish: "normal",
        rarity: "Common",
        local_id: n,
        set_total: 165,
        card_image: `https://assets.tcgdex.net/en/sv/sv03.5/${n}/high.webp`,
        added_at: "2026-10-01T00:00:00.000Z",
      }
    })
    const collection = [{
      ...HUNT_COLLECTION[0],
      wanted_cards: bigWanted,
    }]
    const prices = Object.fromEntries(bigWanted.map((card, i) => [card.card_id, { market: 20 - i * 0.5, confidence: "high" as const }]))
    await page.route(`${SUPABASE_URL}/rest/v1/pokemon_collection**`, (route) =>
      route.request().method() === "GET" ? route.fulfill({ json: collection }) : route.fallback())
    await mockCardPrices(page, prices)
    await page.reload()
    await expect(page.locator('button[data-dex-id="1"]').first()).toBeVisible()

    const dialog = await openShowMode(harness)
    const comps = dialog.getByTestId("show-check-comps")
    await comps.getByRole("button", { name: "Check comps" }).click()

    const confirm = page.getByTestId("check-comps-confirm")
    await expect(confirm).toBeVisible()
    await expect(confirm).toContainText("15 cards need a sold comps refresh. Check them now?")
    await expect(confirm).not.toContainText("left today")
    const cancel = confirm.getByRole("button", { name: "Cancel" })
    const checkNow = confirm.getByRole("button", { name: "Check now" })
    await harness.expectMinTapTarget(cancel, 48)
    await harness.expectMinTapTarget(checkNow, 48)
    await harness.expectWithinSafeViewport(checkNow)
    await harness.expectNoHorizontalOverflow()

    const shotDir = process.env.E2E_SCREENSHOT_DIR || "/workspace/pixel-shots"
    const tag = testInfo.project.name
    await page.screenshot({ path: `${shotDir}/check-comps-confirm-${tag}.png` })

    await cancel.click()
    await expect(confirm).toHaveCount(0)
    await expect(comps.getByRole("status")).toHaveText("Check comps cancelled.")
    expect(requested).toEqual([])

    await comps.getByRole("button", { name: "Check comps" }).click()
    await expect(page.getByTestId("check-comps-confirm")).toBeVisible()
    // Backdrop tap cancels.
    await page.getByTestId("check-comps-confirm-backdrop").click({ position: { x: 8, y: 8 } })
    await expect(page.getByTestId("check-comps-confirm")).toHaveCount(0)
    await expect(comps.getByRole("status")).toHaveText("Check comps cancelled.")

    await comps.getByRole("button", { name: "Check comps" }).click()
    await expect(page.getByTestId("check-comps-confirm")).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(page.getByTestId("check-comps-confirm")).toHaveCount(0)

    await comps.getByRole("button", { name: "Check comps" }).click()
    await page.getByTestId("check-comps-confirm").getByRole("button", { name: "Check now" }).click()
    await expect(page.getByTestId("check-comps-confirm")).toHaveCount(0)
    await expect(comps.getByRole("status")).toContainText(/Checking comps|Sold comps ready/)
    await expect.poll(() => requested.length).toBe(15)
  })

  test("no Good pickups strip when nothing on the want list has dropped", async ({ harness }) => {
    await seedHuntList(harness)
    const dialog = await openShowMode(harness)
    await expect(dialog.getByTestId("show-hunt")).toBeVisible()
    await expect(dialog.getByRole("region", { name: "Good pickups" })).toHaveCount(0)
  })

  test("era, set and illustrator filters narrow the Hunting list", async ({ harness }) => {
    await seedHuntList(harness)
    const dialog = await openShowMode(harness)
    const hunt = dialog.getByTestId("show-hunt")
    const eras = hunt.getByRole("combobox", { name: "Era" })
    await expect(eras.locator("option")).toHaveText(["All eras", "Mega Evolution (1)", "Scarlet & Violet (3)"])
    await eras.selectOption({ label: "Mega Evolution (1)" })
    await expect.poll(() => groupNames(hunt)).toEqual(["Hunting Bulbasaur"])
    await expect(hunt.getByRole("button", { name: /^Bulbasaur, Phantasmal Flames/ })).toBeVisible()
    await expect(hunt.getByRole("button", { name: /^Bulbasaur, 151/ })).toHaveCount(0)
    await eras.selectOption("")

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
