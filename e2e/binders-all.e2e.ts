import type { Page, Request, TestInfo } from "@playwright/test"
import { expect, SEEDED_COLLECTION, SUPABASE_URL, test, type Harness } from "./fixtures"

const MY_BINDER = "e2e00000-0000-4000-8000-000000000001"
const TRADES = "e2e00000-0000-4000-8000-000000000002"
const SPARE = "e2e00000-0000-4000-8000-000000000004"
const PARTNER_OWNER = "00000000-0000-4000-8000-0000000000e3"

const wanted = (cardId: string, cardName: string) => [{ card_id: cardId, card_name: cardName, card_set: "151", card_language: "en", card_finish: "normal", added_at: "2026-02-01T00:00:00.000Z" }]
const slotRow = (binderId: string, pokemonId: number, name: string, card: { id: string; name: string } | null, wantedCard?: { id: string; name: string }) => ({
  id: `${binderId.slice(-3)}-${pokemonId}`, binder_id: binderId, user_id: "owner", pokemon_id: pokemonId, pokemon_name: name,
  card_id: card?.id ?? null, card_name: card?.name ?? null, card_set: card ? "151" : null, card_language: card ? "en" : null, card_finish: card ? "normal" : null,
  wanted_cards: wantedCard ? wanted(wantedCard.id, wantedCard.name) : [], status: card ? "collected" : "wishlisted", collected_at: "2026-01-01T00:00:00.000Z",
})

// My binder: Bulbasaur and Charmander, Charmeleon wanted. Trades: Squirtle and Charmander. Spare: Charizard ex wanted.
const MY_ROWS = [...SEEDED_COLLECTION.map((row) => ({ ...row, binder_id: MY_BINDER })), slotRow(MY_BINDER, 5, "charmeleon", null, { id: "sv03.5-005", name: "Charmeleon" })]
const OTHER_ROWS = [
  slotRow(TRADES, 4, "charmander", { id: "base1-46", name: "Charmander" }),
  slotRow(TRADES, 7, "squirtle", { id: "sv03.5-007", name: "Squirtle" }),
  slotRow(SPARE, 6, "charizard", null, { id: "sv03.5-006", name: "Charizard ex" }),
]

/** Per-binder reads plus the all-binders read (`binder_id=neq.<open binder>`). */
async function mockBinderRows(page: Page) {
  const state = { reads: [] as Request[], failOthers: false }
  await page.route(`${SUPABASE_URL}/rest/v1/pokemon_collection**`, (route) => {
    const binder = new URL(route.request().url()).searchParams.get("binder_id") ?? ""
    if (binder.startsWith("neq.")) {
      state.reads.push(route.request())
      if (state.failOthers) return route.abort("internetdisconnected")
      return route.fulfill({ json: [...MY_ROWS, ...OTHER_ROWS].filter((row) => row.binder_id !== binder.slice(4)) })
    }
    const id = binder.startsWith("eq.") ? binder.slice(3) : MY_BINDER
    return route.fulfill({ json: [...MY_ROWS, ...OTHER_ROWS].filter((row) => row.binder_id === id) })
  })
  await page.route("**/api/binders**", (route) => route.fulfill({ status: 503, json: { error: "not needed" } }))
  return state
}

async function snap(page: Page, testInfo: TestInfo, name: string) {
  const dir = process.env.BINDERS_SCREENS_DIR
  if (!dir || !testInfo.project.name.startsWith("browser-375")) return
  await page.screenshot({ path: `${dir}/binders-all-${name}.png` })
}

async function open(harness: Harness, query = "") {
  await harness.page.goto(`/e2e-harness?signedIn=1&binders=3${query}`)
  await expect(harness.dock()).toBeVisible({ timeout: 30_000 })
  await expect(harness.page.locator('button[data-dex-id="1"]').first()).toBeVisible()
}

async function searchFor(harness: Harness, text: string) {
  await harness.dock().getByRole("button", { name: "Search", exact: true }).click()
  const dialog = harness.page.getByRole("dialog", { name: /search pokemon/i })
  await expect(dialog).toBeVisible()
  await dialog.getByRole("textbox").fill(text)
  return dialog
}

async function openView(harness: Harness, name: "Want list" | "Analytics") {
  const { page } = harness
  if (name === "Want list") return harness.dock().getByRole("button", { name: "Wanted", exact: true }).click()
  await harness.dock().getByRole("button", { name: "Binder", exact: true }).click()
  await page.getByRole("button", { name: "More", exact: true }).click()
  await page.getByRole("menuitem", { name: "Analytics", exact: true }).click()
}

async function closeSearch(harness: Harness, dialog: import("@playwright/test").Locator) {
  await harness.closeControl(dialog).click()
  await expect(dialog).toHaveCount(0)
}

test.describe("owned and wanted across binders", () => {
  test.use({ signedIn: true })

  test("search and the Pokémon views say which other binder owns a Pokémon", async ({ harness }, testInfo) => {
    const { page } = harness
    const { reads } = await mockBinderRows(page)
    await open(harness)
    await expect.poll(() => reads.length, { timeout: 15_000 }).toBeGreaterThan(0)
    const query = new URL(reads[0].url()).searchParams
    expect(query.get("binder_id")).toBe(`neq.${MY_BINDER}`)
    expect(query.get("user_id")).toBe("eq.00000000-0000-4000-8000-0000000000e2")

    const search = await searchFor(harness, "squirtle")
    const hint = search.getByTestId("owned-elsewhere").first()
    await expect(hint).toHaveText("Owned in Trades")
    await harness.expectWithinSafeViewport(hint)
    await snap(page, testInfo, "search")
    // Bulbasaur is only in this binder: no hint.
    await search.getByRole("textbox").fill("bulbasaur")
    await expect(search.getByRole("button", { name: /^bulbasaur/i }).first()).toBeVisible()
    await expect(search.getByTestId("owned-elsewhere")).toHaveCount(0)
    await closeSearch(harness, search)

    await harness.dock().getByRole("button", { name: "Browse", exact: true }).click()
    await page.getByRole("group", { name: "Browse perspective" }).getByRole("button", { name: "Pokémon", exact: true }).click()
    await page.getByRole("searchbox", { name: "Search Pokémon by name or dex number" }).fill("squirtle")
    const catalogue = page.getByRole("list", { name: "Pokémon catalogue" })
    await expect(catalogue.getByTestId("owned-elsewhere").first()).toHaveText("Owned in Trades")
    await snap(page, testInfo, "pokemon-view")
    await page.getByRole("button", { name: "Browse Squirtle cards", exact: true }).click()
    const cards = page.getByRole("dialog", { name: "All Squirtle cards", exact: true })
    await expect(cards.getByTestId("card-owned-elsewhere")).toHaveCount(1)
    await expect(cards.getByTestId("card-owned-elsewhere")).toHaveText("In Trades")
    await harness.expectNoHorizontalOverflow()
  })

  test("the want list and analytics switch between this binder and all binders", async ({ harness }, testInfo) => {
    const { page } = harness
    await mockBinderRows(page)
    await open(harness)
    await openView(harness, "Want list")
    const scope = page.getByTestId("binder-scope").first()
    await expect(scope).toBeVisible()
    const list = page.getByRole("list", { name: "Wanted cards" })
    await expect(list.getByRole("button", { name: /^Open Charmeleon/ })).toBeVisible()
    await expect(list.getByRole("button", { name: /^Open Charizard ex/ })).toHaveCount(0)
    await harness.expectMinTapTarget(scope.getByRole("button", { name: "All binders" }))

    await scope.getByRole("button", { name: "All binders" }).click()
    await expect(scope.getByRole("button", { name: "All binders" })).toHaveAttribute("aria-pressed", "true")
    const other = list.getByRole("listitem").filter({ hasText: "Charizard ex" })
    await expect(other.getByTestId("wanted-row-binder")).toHaveText("In Spare")
    // Other binders' cards are view only; the open binder's keep their actions.
    await expect(other.getByRole("button", { name: /^Got it/ })).toHaveCount(0)
    await expect(list.getByRole("listitem").filter({ hasText: "Charmeleon" }).getByRole("button", { name: /^Got it/ })).toBeVisible()
    await harness.expectNoHorizontalOverflow()
    await snap(page, testInfo, "want-list")

    // The choice is remembered per view.
    await page.reload()
    await expect(harness.dock()).toBeVisible({ timeout: 30_000 })
    await openView(harness, "Want list")
    await expect(page.getByTestId("binder-scope").first().getByRole("button", { name: "All binders" })).toHaveAttribute("aria-pressed", "true")
    await expect(page.getByRole("list", { name: "Wanted cards" }).getByTestId("wanted-row-binder")).toHaveText("In Spare")

    await openView(harness, "Analytics")
    await expect(page.getByRole("heading", { name: "Analytics", exact: true })).toBeVisible()
    await expect(page.getByText("2 / 1025", { exact: true })).toBeVisible()
    const analyticsScope = page.getByTestId("binder-scope").first()
    await analyticsScope.getByRole("button", { name: "All binders" }).click()
    await expect(page.getByText("3 / 1025", { exact: true })).toBeVisible()
    await expect(analyticsScope.getByRole("button", { name: "All binders" })).toHaveAttribute("aria-pressed", "true")
    await page.mouse.move(0, 0)
    await page.waitForTimeout(300)
    await snap(page, testInfo, "analytics")
    await analyticsScope.getByRole("button", { name: "This binder" }).click()
    await expect(page.getByText("2 / 1025", { exact: true })).toBeVisible()
  })

  test("the hints come from this device's copy when the other binders can't be read", async ({ harness }) => {
    const { page } = harness
    const rows = await mockBinderRows(page)
    await open(harness)
    const search = await searchFor(harness, "squirtle")
    await expect(search.getByTestId("owned-elsewhere").first()).toHaveText("Owned in Trades")
    await closeSearch(harness, search)
    // Give the device copy time to save (it's written a moment after the read).
    await page.waitForTimeout(3_000)

    rows.failOthers = true
    const before = rows.reads.length
    await open(harness)
    await expect.poll(() => rows.reads.length, { timeout: 15_000 }).toBeGreaterThan(before)
    const again = await searchFor(harness, "squirtle")
    await expect(again.getByTestId("owned-elsewhere").first()).toHaveText("Owned in Trades")
  })

  test("a partner sees owned hints from every one of the owner's binders", async ({ harness }) => {
    const { page } = harness
    const { reads } = await mockBinderRows(page)
    // The signed-in user is the owner's partner.
    await page.route(`${SUPABASE_URL}/rest/v1/partnerships**`, (route) => route.fulfill({ json: [{ owner_user_id: PARTNER_OWNER }] }))
    await open(harness, `&partner=1&binder=${TRADES}`)
    await expect.poll(() => reads.length, { timeout: 15_000 }).toBeGreaterThan(0)
    const query = new URL(reads[0].url()).searchParams
    expect(query.get("user_id")).toBe(`eq.${PARTNER_OWNER}`)
    expect(query.get("binder_id")).toBe(`neq.${TRADES}`)
    // From Trades, Bulbasaur is in My binder only; Charmander is here and in My binder.
    const search = await searchFor(harness, "bulbasaur")
    await expect(search.getByTestId("owned-elsewhere").first()).toHaveText("Owned in My binder")
    await closeSearch(harness, search)
    await openView(harness, "Want list")
    await page.getByTestId("binder-scope").first().getByRole("button", { name: "All binders" }).click()
    const list = page.getByRole("list", { name: "Wanted cards" })
    await expect(list.getByTestId("wanted-row-binder")).toHaveCount(2)
    await expect(list.getByRole("listitem").filter({ hasText: "Charmeleon" }).getByTestId("wanted-row-binder")).toHaveText("In My binder")
    await expect(list.getByRole("listitem").filter({ hasText: "Charizard ex" }).getByTestId("wanted-row-binder")).toHaveText("In Spare")
  })
})

