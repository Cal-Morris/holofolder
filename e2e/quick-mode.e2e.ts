import { test, expect, type Harness } from "./fixtures"

const SCREENS = process.env.E2E_SCREENSHOT_DIR

const quickDialog = (harness: Harness) => harness.page.getByRole("dialog", { name: "Quick mode" })

/** Press and hold the dock's Search button (the one-tap-and-hold entry to Quick mode). */
async function longPressSearch(harness: Harness) {
  const search = harness.dock().getByRole("button", { name: "Search", exact: true })
  const box = (await search.boundingBox())!
  await harness.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await harness.page.mouse.down()
  await expect(quickDialog(harness)).toBeVisible()
  await harness.page.mouse.up()
  return quickDialog(harness)
}

async function expectUsable(harness: Harness) {
  const dialog = quickDialog(harness)
  const close = dialog.getByRole("button", { name: "Close quick mode" })
  await harness.expectWithinSafeViewport(close)
  await harness.expectHittable(close)
  await harness.expectMinTapTarget(close, 44)
  const field = dialog.getByRole("searchbox")
  await expect(field).toBeFocused()
  await harness.expectWithinSafeViewport(field)
  await harness.expectMinTapTarget(field, 48)
  // The field sits in the bottom third: thumb reach.
  expect((await field.boundingBox())!.y).toBeGreaterThan(harness.viewport.height * 0.66)
  await harness.expectNoHorizontalOverflow()
  return dialog
}

async function screenshot(harness: Harness, name: string) {
  if (SCREENS && test.info().project.name.startsWith("standalone-390")) await harness.page.screenshot({ path: `${SCREENS}/quick-${name}.png` })
}

test.describe("quick mode", () => {
  test.use({ signedIn: true })

  test("hold Search to open it, jump to a destination, and it stays a single overlay", async ({ harness }) => {
    const dialog = await longPressSearch(harness)
    // Holding Search must not also open the normal search sheet.
    await expect(harness.page.getByRole("dialog", { name: /search pokemon/i })).toHaveCount(0)
    await expectUsable(harness)
    const goTo = dialog.getByRole("region", { name: "Go to" })
    for (const name of ["Binder", "Want list", "List", "Sets", "Analytics", "Settings"]) {
      const button = goTo.getByRole("button", { name: new RegExp(`^${name}`) })
      await expect(button).toBeVisible()
      await harness.expectMinTapTarget(button, 48)
    }
    await screenshot(harness, "home")

    await goTo.getByRole("button", { name: /^Want list/ }).click()
    await expect(dialog).toBeHidden()
    await expect(harness.page.getByText("No wanted cards yet")).toBeVisible()
    await harness.expectScrollUnlocked()
  })

  test("one field finds Pokémon, cards and destinations; picking a card opens it", async ({ harness }) => {
    const dialog = await longPressSearch(harness)
    const field = dialog.getByRole("searchbox")
    await field.fill("charm")
    const pokemon = dialog.getByRole("region", { name: "Pokémon" })
    await expect(pokemon.getByRole("button", { name: /charmander/i })).toContainText("Owned")
    await expect(pokemon.getByRole("button", { name: /charmeleon/i })).toContainText("Missing")
    const cards = dialog.getByRole("region", { name: "Cards" })
    const card = cards.getByRole("button", { name: /^Charmander, 151 /i }).first()
    await expect(card).toBeVisible()
    await harness.expectMinTapTarget(card, 48)
    await screenshot(harness, "search")

    await field.fill("wish")
    await expect(dialog.getByRole("region", { name: "Go to" }).getByRole("button", { name: /^Want list/ })).toBeVisible()

    await field.fill("charm")
    await dialog.getByRole("region", { name: "Cards" }).getByRole("button", { name: /^Charmander, 151 /i }).first().click()
    // A picked card opens its deal check first; More details goes on to the card itself.
    const check = dialog.getByTestId("quick-card-check")
    await expect(check).toBeVisible()
    await check.getByRole("button", { name: "More details" }).click()
    await expect(dialog).toBeHidden()
    await expect(harness.page.getByRole("dialog", { name: /charmander/i })).toBeVisible()

    // The pick is shared with Search's "Recently viewed" row.
    await harness.page.keyboard.press("Escape")
    await expect(harness.dialogs()).toHaveCount(0)
    await harness.dock().getByRole("button", { name: "Search", exact: true }).click()
    await expect(harness.page.getByRole("region", { name: "Recently viewed cards" }).getByRole("button", { name: /^Charmander / }).first()).toBeVisible()
  })

  test("Enter takes the top Pokémon to its binder slot, and the search is remembered", async ({ harness }) => {
    const dialog = await longPressSearch(harness)
    await dialog.getByRole("searchbox").fill("bulbas")
    await expect(dialog.getByRole("region", { name: "Pokémon" }).getByRole("button", { name: /bulbasaur/i })).toBeVisible()
    await dialog.getByRole("searchbox").press("Enter")
    await expect(dialog).toBeHidden()
    await expect(harness.page.getByRole("dialog", { name: /bulbasaur details/i })).toBeVisible()

    await harness.page.keyboard.press("Escape")
    await expect(harness.dialogs()).toHaveCount(0)
    await harness.expectScrollUnlocked()
    const again = await longPressSearch(harness)
    const recent = again.getByRole("region", { name: "Recent searches" }).getByRole("button", { name: "bulbas" })
    await expect(recent).toBeVisible()
    await recent.click()
    await expect(again.getByRole("searchbox")).toHaveValue("bulbas")
  })

  test("closes with X, Escape and back; also opens from the Search sheet and Ctrl+K", async ({ harness }) => {
    const { page } = harness
    let dialog = await longPressSearch(harness)
    await dialog.getByRole("button", { name: "Close quick mode" }).click()
    await expect(dialog).toBeHidden()
    await harness.expectScrollUnlocked()

    await harness.dock().getByRole("button", { name: "Search", exact: true }).click()
    const search = page.getByRole("dialog", { name: /search pokemon/i })
    await expect(search).toBeVisible()
    await search.getByRole("button", { name: "Quick mode" }).click()
    dialog = quickDialog(harness)
    await expect(dialog).toBeVisible()
    await expect(search).toHaveCount(0)
    await page.keyboard.press("Escape")
    await expect(dialog).toBeHidden()

    const url = page.url()
    await page.keyboard.press("Control+k")
    await expect(dialog).toBeVisible()
    await page.goBack()
    await expect(dialog).toBeHidden()
    expect(page.url()).toBe(url)
    await expect(harness.dialogs()).toHaveCount(0)
  })

  test("offline it says so and finds cards saved on this device", async ({ harness }) => {
    const { page } = harness
    // Load the Quick mode chunk while online, as an installed app would have it cached.
    let dialog = await longPressSearch(harness)
    await dialog.getByRole("button", { name: "Close quick mode" }).click()
    await page.route("**/app/api/tcg-card-search**", (route) => route.abort("internetdisconnected"))
    await page.context().setOffline(true)

    dialog = await longPressSearch(harness)
    await expect(dialog.getByRole("status").filter({ hasText: "Offline" })).toBeVisible()
    await dialog.getByRole("searchbox").fill("bulbasaur")
    const cards = dialog.getByRole("region", { name: "Cards" })
    await expect(cards.getByRole("heading")).toContainText("on this device")
    await expect(cards.getByRole("button", { name: /^Bulbasaur, Base Set/i })).toBeVisible()
    await screenshot(harness, "offline")
    await page.context().setOffline(false)
  })
})
