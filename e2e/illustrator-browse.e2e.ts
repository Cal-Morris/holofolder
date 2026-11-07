import { test, expect, type Harness } from "./fixtures"
import { setNetwork } from "./collection-server"

// Illustrator credits on the mock printings are synthetic (see MOCK_ILLUSTRATORS in fixtures.ts):
// Mitsuhiro Arita has Base Set Bulbasaur 44 and Charmander 46 (both owned in the seed) and 151 Bulbasaur 166.
const ARITA = /cards illustrated by mitsuhiro arita/i
const SCREENS = process.env.E2E_SCREENSHOT_DIR

const illustratorDialog = (harness: Harness) => harness.page.getByRole("dialog", { name: ARITA })
const illustratorCards = (harness: Harness) => illustratorDialog(harness).getByRole("list", { name: /cards by mitsuhiro arita/i }).getByRole("listitem")

async function openSearch(harness: Harness) {
  await harness.dock().getByRole("button", { name: "Search", exact: true }).click()
  const dialog = harness.page.getByRole("dialog", { name: /search pokemon/i })
  await expect(dialog).toBeVisible()
  return dialog
}

async function openFromSearch(harness: Harness, query: string) {
  const search = await openSearch(harness)
  await search.getByRole("textbox").fill(query)
  const result = search.getByRole("region", { name: /illustrator results/i }).getByRole("button", { name: /^illustrator mitsuhiro arita, 3 cards$/i })
  await expect(result).toBeVisible()
  await harness.expectMinTapTarget(result, 44)
  await result.click()
  await expect(search).toBeHidden()
  return expectUsableIllustratorView(harness)
}

async function expectUsableIllustratorView(harness: Harness) {
  const dialog = illustratorDialog(harness)
  await expect(dialog).toBeVisible()
  const close = dialog.getByRole("button", { name: "Close illustrator cards" })
  await harness.expectWithinSafeViewport(close)
  await harness.expectHittable(close)
  await harness.expectMinTapTarget(close)
  expect((await dialog.boundingBox())!.y).toBeGreaterThanOrEqual(harness.insets.top - 0.5)
  await harness.expectNoHorizontalOverflow()
  await expect(illustratorCards(harness)).toHaveCount(3)
  return dialog
}

async function screenshot(harness: Harness, name: string) {
  const project = test.info().project.name
  if (SCREENS && project.startsWith("standalone-390")) await harness.page.screenshot({ path: `${SCREENS}/illustrator-${name}.png` })
}

test.describe("browse by illustrator", () => {
  test.use({ signedIn: true })

  test("global search finds an illustrator by surname or with a typo and lists their cards across sets", async ({ harness }) => {
    const search = await openSearch(harness)
    await search.getByRole("textbox").fill("mitsuhro arita")
    await expect(search.getByRole("region", { name: /illustrator results/i }).getByRole("button", { name: /mitsuhiro arita/i })).toBeVisible()
    await screenshot(harness, "search")
    await harness.page.keyboard.press("Escape")
    await harness.page.keyboard.press("Escape")
    await expect(harness.dialogs()).toHaveCount(0)

    const dialog = await openFromSearch(harness, "arita")
    await expect(dialog.getByTestId("illustrator-summary")).toHaveText("3 cards · 2 sets · 2 owned · 0 wanted")
    await expect(illustratorCards(harness).first()).toHaveAccessibleName(/bulbasaur 166\/165 151$/i)
    await expect(dialog.getByRole("listitem", { name: /charmander 46\/102 base set, owned/i })).toBeVisible()
    await expect(dialog.getByRole("listitem", { name: /bulbasaur 44\/102 base set, owned/i })).toBeVisible()
    await expect(dialog.getByRole("img").first()).toBeVisible()
    // Read-only: browsing never opens the card selector / edit flow.
    await expect(dialog.getByRole("button", { name: /^(add|want)\b/i })).toHaveCount(0)
    await screenshot(harness, "view")

    await dialog.getByRole("button", { name: "Close illustrator cards" }).click()
    await expect(harness.dialogs()).toHaveCount(0)
    await harness.expectScrollUnlocked()
  })

  test("sorts and filters by owned, wanted and missing", async ({ harness }) => {
    // Want Bulbasaur 166 first so the view has a wanted mark.
    const detail = await harness.openCardDetail()
    await detail.getByRole("button", { name: /all bulbasaur cards/i }).click()
    const allCards = harness.page.getByRole("dialog", { name: /all bulbasaur cards/i })
    await allCards.getByRole("button", { name: /^want bulbasaur 166\/165/i }).click()
    await expect(allCards.getByRole("listitem", { name: /166\/165 151, wanted/i })).toBeVisible()
    await harness.page.keyboard.press("Escape")
    await harness.page.keyboard.press("Escape")
    await expect(harness.dialogs()).toHaveCount(0)

    const dialog = await openFromSearch(harness, "arita")
    await expect(dialog.getByTestId("illustrator-summary")).toHaveText("3 cards · 2 sets · 2 owned · 1 wanted")
    await expect(dialog.getByRole("listitem", { name: /bulbasaur 166\/165 151, wanted/i })).toBeVisible()

    const filters = dialog.getByRole("group", { name: "Filter cards" })
    for (const chip of await filters.getByRole("button").all()) await harness.expectMinTapTarget(chip)
    await filters.getByRole("button", { name: /^owned/i }).click()
    await expect(illustratorCards(harness)).toHaveCount(2)
    await filters.getByRole("button", { name: /^wanted/i }).click()
    await expect(illustratorCards(harness)).toHaveCount(1)
    await filters.getByRole("button", { name: /^missing/i }).click()
    await expect(illustratorCards(harness)).toHaveCount(1)
    await filters.getByRole("button", { name: /^all/i }).click()

    await dialog.getByRole("combobox", { name: "Sort cards" }).selectOption("oldest")
    await expect(illustratorCards(harness).first()).toHaveAccessibleName(/base set, owned$/i)
    await expect(illustratorCards(harness).last()).toHaveAccessibleName(/166\/165 151, wanted$/i)
    await dialog.getByRole("combobox", { name: "Sort cards" }).selectOption("name")
    await expect(illustratorCards(harness).first()).toHaveAccessibleName(/^bulbasaur/i)
    await expect(illustratorCards(harness).last()).toHaveAccessibleName(/^charmander/i)

    await dialog.getByRole("searchbox").fill("charm")
    await expect(illustratorCards(harness)).toHaveCount(1)
    await dialog.getByRole("searchbox").fill("no-such-card")
    await expect(dialog.getByText("No cards match that filter.")).toBeVisible()
    await harness.expectNoHorizontalOverflow()
  })

  test("the illustrator on the card detail opens the view on top and closing returns to the detail", async ({ harness }) => {
    const detail = await harness.openCardDetail()
    const credit = detail.getByRole("button", { name: /^illustrator mitsuhiro arita: show all their cards$/i })
    await expect(credit).toBeVisible()
    await harness.expectMinTapTarget(credit)
    await screenshot(harness, "detail")
    await credit.click()
    await expectUsableIllustratorView(harness)
    await expect(harness.dialogs()).toHaveCount(1)

    await harness.page.keyboard.press("Escape")
    await expect(illustratorDialog(harness)).toBeHidden()
    await expect(harness.page.getByRole("dialog", { name: /bulbasaur details/i })).toBeVisible()

    // Browser back closes just the illustrator view as well.
    await credit.click()
    await expect(illustratorDialog(harness)).toBeVisible()
    await harness.page.goBack()
    await expect(illustratorDialog(harness)).toBeHidden()
    await expect(harness.page.getByRole("dialog", { name: /bulbasaur details/i })).toBeVisible()
  })

  test("closes with the backdrop, a swipe and a tab switch", async ({ harness }) => {
    let dialog = await openFromSearch(harness, "arita")
    await harness.tapBackdrop(dialog)
    await expect(harness.dialogs()).toHaveCount(0)

    dialog = await openFromSearch(harness, "arita")
    if (harness.viewport.width < 640) {
      await harness.swipeDown(dialog)
      await expect(harness.dialogs()).toHaveCount(0)
      dialog = await openFromSearch(harness, "arita")
    }

    await harness.dock().getByRole("button", { name: "Browse", exact: true }).click()
    await expect(harness.dialogs()).toHaveCount(0)
    await harness.expectScrollUnlocked()
    await harness.dock().getByRole("button", { name: "Binder", exact: true }).click()

    // From the card detail, a tab switch closes both layers.
    const detail = await harness.openCardDetail()
    await detail.getByRole("button", { name: /^illustrator mitsuhiro arita/i }).click()
    await expect(illustratorDialog(harness)).toBeVisible()
    await harness.dock().getByRole("button", { name: "List", exact: true }).click()
    await expect(harness.dialogs()).toHaveCount(0)
    await harness.expectScrollUnlocked()
  })

  test("works offline from the copy saved on the device", async ({ harness }) => {
    const dialog = await openFromSearch(harness, "arita")
    await dialog.getByRole("button", { name: "Close illustrator cards" }).click()
    await expect(harness.dialogs()).toHaveCount(0)

    // No signal: the API fails, so the view reads the copy saved in IndexedDB.
    await harness.page.route("**/app/api/tcg-illustrators**", (route) => route.abort())
    await setNetwork(harness.page, true)

    const offline = await openFromSearch(harness, "arita")
    await expect(offline.getByText("Offline: showing the copy saved on this device.")).toBeVisible()
    await expect(offline.getByRole("listitem", { name: /bulbasaur 44\/102 base set, owned/i })).toBeVisible()
    await offline.getByRole("button", { name: "Close illustrator cards" }).click()

    // An illustrator never opened before says so rather than showing an empty list.
    const search = await openSearch(harness)
    await search.getByRole("textbox").fill("saito")
    await search.getByRole("region", { name: /illustrator results/i }).getByRole("button", { name: /kouki saitō/i }).click()
    const unopened = harness.page.getByRole("dialog", { name: /cards illustrated by kouki saitō/i })
    await expect(unopened.getByText(/only illustrators you opened before are available/i)).toBeVisible()
    await setNetwork(harness.page, false)
  })
})

test.describe("illustrator prices (UK)", () => {
  test.use({ signedIn: true, locale: "en-GB" })

  test("shows each card's price and sorts by price, unpriced cards last", async ({ harness }) => {
    // Synthetic Cardmarket-only quotes (TEST FIXTURE ONLY): Bulbasaur 44 £120, Bulbasaur 166 £45.50, Charmander 46 unpriced.
    const quotes: Record<string, number | null> = { "base1-44": 120, "sv03.5-166": 45.5, "base1-46": null }
    await harness.page.route("**/app/api/card-prices**", async (route) => {
      const lookups: Array<{ cardId: string; language?: string }> = route.request().postDataJSON()?.cards ?? []
      await route.fulfill({ json: { prices: lookups.map(({ cardId, language }) => {
        const gbp = quotes[cardId] ?? null
        return {
          cardId, language: language ?? "en", gbpAmount: gbp, marketGbpAmount: gbp, confidence: gbp ? "medium" : "unknown",
          sourcePrices: gbp ? [{ source: "cardmarket", label: "Cardmarket", variantLabel: "Trend", marketGbpAmount: gbp, originalMarketAmount: gbp * 1.15, originalCurrency: "EUR" }] : [],
          trendPoints: [], source: gbp ? "cardmarket" : null, originalAmount: gbp ? gbp * 1.15 : null, originalCurrency: gbp ? "EUR" : null,
        }
      }) } })
    })

    // The harness already priced the owned cards with the default fixture; start again from empty caches.
    await harness.page.addInitScript(() => {
      localStorage.removeItem("binderdex_card_price_cache_v7")
      // Queued before the app opens the store, so the app always starts from an empty offline cache.
      indexedDB.deleteDatabase("binderdex-offline")
    })
    await harness.open()

    const dialog = await openFromSearch(harness, "arita")
    const price = (name: RegExp) => dialog.getByRole("listitem", { name }).getByTestId("illustrator-card-price")
    await expect(price(/bulbasaur 44\/102/i)).toHaveText("£120")
    await expect(price(/bulbasaur 166\/165/i)).toHaveText("£45.50")
    await expect(price(/charmander 46\/102/i)).toHaveText("No price")

    const sort = dialog.getByRole("combobox", { name: "Sort cards" })
    await sort.selectOption("price-desc")
    await expect(illustratorCards(harness).nth(0)).toHaveAccessibleName(/^bulbasaur 44\/102/i)
    await expect(illustratorCards(harness).nth(1)).toHaveAccessibleName(/^bulbasaur 166\/165/i)
    await expect(illustratorCards(harness).nth(2)).toHaveAccessibleName(/^charmander 46\/102/i)
    await expect(dialog.getByTestId("illustrator-price-sort-note")).toHaveText("Cards without a price are listed last.")
    await screenshot(harness, "price-sort")

    await sort.selectOption("price-asc")
    await expect(illustratorCards(harness).nth(0)).toHaveAccessibleName(/^bulbasaur 166\/165/i)
    await expect(illustratorCards(harness).nth(1)).toHaveAccessibleName(/^bulbasaur 44\/102/i)
    await expect(illustratorCards(harness).nth(2)).toHaveAccessibleName(/^charmander 46\/102/i)
    await harness.expectNoHorizontalOverflow()
  })
})
