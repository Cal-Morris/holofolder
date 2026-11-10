import { test, expect, Harness, mockBackends, emulateStandalone } from "./fixtures"
import type { Page } from "@playwright/test"
import { join } from "node:path"
import { syntheticSlotPickerSnapshot } from "../tests/fixtures/slot-picker"

/**
 * The tap-an-empty-pocket flow as the user sees it, on the native slot harnesses (synthetic slots and cards only).
 * Set SLOT_SHOTS_DIR to also write a screenshot of every state, named `<project>-<state>.png`.
 */
const shotsDir = process.env.SLOT_SHOTS_DIR
const shot = async (page: Page, name: string, prefix = test.info().project.name) => {
  if (shotsDir) await page.screenshot({ path: join(shotsDir, `${prefix}-${name}.png`) })
}
// Synthetic Snorlax printings (normal and holo, so the finish is an explicit choice).
const snorlaxList = () => syntheticSlotPickerSnapshot().cards.filter(c => c.id.startsWith("synthetic-snorlax")).map(({ dexIds: _dexIds, ...card }) => card)
const routeCards = async (page: Page) => {
  await page.route("**/app/api/tcgdex-cache**", route => route.fulfill({ json: { cards: snorlaxList(), source: "mirror" } }))
  await page.route("**/app/api/tcg-card-search**", route => route.fulfill({ json: { cards: syntheticSlotPickerSnapshot().cards.slice(2, 5) } }))
  await page.route("**/app/api/card-prices", route => route.fulfill({ json: { prices: [] } }))
}
const details = (page: Page) => page.getByRole("dialog", { name: /details$/ })
const selector = (page: Page) => page.getByRole("dialog", { name: "Card selector" })
const slot = (page: Page, id: string) => page.locator(`button[data-slot-id="${id}"]`)
const cardA = (page: Page) => selector(page).getByRole("button", { name: "Add card Snorlax A from Synthetic set" })
const variant = (page: Page) => page.getByRole("dialog", { name: "Which variant?" })

const suites: { title: string; viewport?: { width: number; height: number }; prefix?: string }[] = [
  { title: "phone profiles" },
  { title: "desktop 1280x900", viewport: { width: 1280, height: 900 }, prefix: "desktop-1280x900" },
]
for (const suite of suites) {
  test.describe(`empty pocket card selection, ${suite.title}`, () => {
    test.use({ signedIn: true, ...(suite.viewport ? { viewport: suite.viewport, isMobile: false, hasTouch: false } : {}),
      harness: async ({ page, context, standalone, insets, baseURL }, provide) => {
        if (standalone) await emulateStandalone(page, insets)
        await mockBackends(page, context, { signedIn: true, baseURL })
        await provide(new Harness(page, insets, true))
      } })
    test.beforeEach(({ page: _page }, info) => { test.skip(Boolean(suite.viewport) && info.project.name !== "browser-390x844", "desktop runs once") })
    const prefix = suite.prefix
    const open = async (page: Page, query = "slots=picker&rows=2&cols=4") => {
      await routeCards(page)
      await page.goto(`/app/e2e-harness?signedIn=1&${query}`)
      if (page.viewportSize()!.width >= 1024) await expect(page.getByRole("region", { name: "Inside cover", exact: true })).toBeVisible()
    }

    test("a. selector opens straight on the species cards", async ({ harness }) => {
      const { page } = harness
      await open(page)
      await slot(page, "slot-e").click()
      await expect(cardA(page)).toBeVisible()
      await expect(selector(page).getByRole("button", { name: "Add card Snorlax B from Synthetic set" })).toBeVisible()
      await expect(page.getByRole("button", { name: "Choose card", exact: true })).toHaveCount(0)
      await expect(details(page)).toHaveCount(0)
      await harness.expectNoHorizontalOverflow()
      await shot(page, "a-selector-species-cards", prefix)
    })

    test("b. finish choice, then copy choice, before anything is saved", async ({ harness }) => {
      const { page } = harness
      await open(page)
      await slot(page, "slot-e").click()
      await cardA(page).click()
      await expect(variant(page)).toBeVisible()
      await expect(page.getByLabel("Synthetic draft count")).toHaveText("0")
      await shot(page, "b1-finish-choice", prefix)
      await variant(page).getByRole("button", { name: /^Add Normal/ }).click()
      const copy = page.getByRole("dialog", { name: "Which copy?" })
      await expect(copy.getByRole("button", { name: "Use my raw copy", exact: true })).toBeVisible()
      await expect(copy.getByRole("button", { name: "Use my PSA 9", exact: true })).toBeVisible()
      await expect(details(page)).toHaveCount(0)
      await expect(page.getByLabel("Synthetic draft count")).toHaveText("0")
      await harness.expectWithinSafeViewport(copy.getByRole("button").last())
      for (const action of await copy.locator("button:visible").all()) await harness.expectMinTapTarget(action, 36)
      await harness.expectNoHorizontalOverflow()
      await shot(page, "b2-copy-choice", prefix)
    })

    test("c. saved on device, straight back on the binder", async ({ harness }) => {
      const { page } = harness
      await open(page, "slots=durable&rows=2&cols=2")
      const pager = page.getByRole("spinbutton", { name: "Binder page number" })
      await pager.fill("2")
      await pager.press("Enter")
      await slot(page, "slot-e").click()
      await cardA(page).click()
      await variant(page).getByRole("button", { name: /^Add Holo/ }).click()
      // Saved headlessly on device: the selector closes straight back onto the binder, no draft panel in between.
      await expect(selector(page)).toHaveCount(0)
      await expect(details(page)).toHaveCount(0)
      await expect(slot(page, "slot-e")).toHaveAccessibleName("Snorlax A, Owned")
      await shot(page, "c2-saved-on-binder", prefix)
    })

    test("d. a free pocket opens the same visual selector, searching every card", async ({ harness }) => {
      const { page } = harness
      await open(page)
      await slot(page, "slot-g").click()
      const dialog = selector(page)
      await expect(details(page)).toHaveCount(0)
      await expect(dialog.getByRole("searchbox", { name: "Search cards" })).toBeVisible()
      await expect(dialog.getByRole("button", { name: /Choose card|Edit slot|Cancel/ })).toHaveCount(0)
      await expect(dialog.getByRole("heading", { name: "Add a card", exact: true })).toHaveCount(1)
      await harness.expectWithinSafeViewport(dialog)
      await harness.expectNoHorizontalOverflow()
      await shot(page, "d-free-pocket-search", prefix)
    })

    test("e. an owned pocket opens the card's details", async ({ harness }) => {
      const { page } = harness
      await open(page)
      await slot(page, "slot-a").click()
      const dialog = details(page)
      await expect(dialog.getByRole("heading", { name: "Snorlax A", exact: true })).toBeVisible()
      await expect(dialog).toContainText(/owned/i)
      await expect(dialog.getByText(/Edit slot|Card options|Unassigned/)).toHaveCount(0)
      await expect(selector(page)).toHaveCount(0)
      await shot(page, "e-owned-card-first", prefix)
    })

    test("f. a read-only empty pocket shows only its detail", async ({ harness }) => {
      const { page } = harness
      await open(page, "slots=picker&readOnly=1&rows=2&cols=4")
      await slot(page, "slot-e").click()
      const dialog = details(page)
      await expect(dialog).toContainText("Not collected")
      await expect(selector(page)).toHaveCount(0)
      await expect(dialog.getByRole("button", { name: /Choose card|Edit slot|Set target|More card options/ })).toHaveCount(0)
      await shot(page, "f-readonly-empty-pocket", prefix)
    })
  })
}
