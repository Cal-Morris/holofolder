import { test, expect, Harness, mockBackends, emulateStandalone } from "./fixtures"
import type { Locator, Page } from "@playwright/test"
import { syntheticSlotPickerSnapshot } from "../tests/fixtures/slot-picker"

// Layout editing happens on the binder's own pockets. Synthetic slots, copies and catalog only
// (tests/fixtures/slot-picker.ts); the staged harness counts prepared drafts and applies them to the view.
test.describe("layout editing on the pockets", () => {
  test.use({ signedIn: true, harness: async ({ page, context, standalone, insets, baseURL }, provide) => {
    if (standalone) await emulateStandalone(page, insets)
    await mockBackends(page, context, { signedIn: true, baseURL })
    await provide(new Harness(page, insets, true))
  } })
  test.beforeEach(async ({ harness }) => {
    const { page } = harness
    await page.route("**/app/api/tcgdex-cache**", route => route.fulfill({ json: { cards: syntheticSlotPickerSnapshot().cards.filter(c => c.dexIds?.includes(143)).map(({ dexIds: _d, ...c }) => c), source: "mirror" } }))
    await page.route("**/app/api/card-prices**", route => route.fulfill({ json: { prices: [] } }))
    await page.goto("/app/e2e-harness?signedIn=1&slots=picker&rows=2&cols=4")
    await expect(pocket(page, "slot-a")).toBeVisible()
  })
  const pocket = (page: Page, id: string) => page.locator(`button[data-slot-id="${id}"]`)
  const bar = (page: Page) => page.getByRole("region", { name: "Layout editing", exact: true })
  const count = (page: Page) => page.getByLabel("Synthetic draft count")
  const draft = async (page: Page) => JSON.parse(await page.getByLabel("Synthetic latest draft").textContent() ?? "null")
  const order = (page: Page) => page.locator("[data-binder-page] button[data-slot-id]").evaluateAll(els => els.map(el => el.getAttribute("data-slot-id")))
  const menu = (page: Page) => page.getByRole("dialog", { name: /pocket options$/ })
  const edit = async (page: Page) => {
    await bar(page).getByRole("button", { name: "Edit layout", exact: true }).click()
    await expect(bar(page).getByRole("button", { name: "Done", exact: true })).toBeVisible()
  }
  /** The keyboard's menu key (and Shift+F10) arrive as a contextmenu event with no pointer position. */
  const menuKey = (target: Locator) => target.evaluate(el => { (el as HTMLElement).focus(); el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 0, clientY: 0, detail: 0 })) })
  const touch = async (target: Locator, type: string, dx = 0, dy = 0) => {
    const box = (await target.boundingBox())!
    await target.dispatchEvent(type, { pointerType: "touch", pointerId: 7, isPrimary: true, bubbles: true, clientX: box.x + box.width / 2 + dx, clientY: box.y + box.height / 2 + dy })
  }

  test("empty, one and many: pockets are selected on the page under one compact bar", async ({ harness }) => {
    const { page } = harness
    const before = await pocket(page, "slot-a").boundingBox()
    await edit(page)
    await expect(bar(page).getByRole("status")).toHaveText("Tap pockets to select")
    // One compact bar, not a panel: no second list of the pockets and no staging wording.
    const box = (await bar(page).boundingBox())!
    expect(box.height).toBeLessThanOrEqual(harness.viewport.width >= 640 ? 64 : 112)
    await expect(bar(page).getByRole("button", { name: /Slot \d|Select slot|Select page|Append free slot/ })).toHaveCount(0)
    await expect(bar(page)).not.toContainText(/draft|Save on this device|Saved position|anchor/i)
    await expect(bar(page).getByRole("button", { name: "Move", exact: true })).toBeDisabled()
    // The binder page keeps its place and (nearly) its size under the bar.
    const during = await pocket(page, "slot-a").boundingBox()
    expect(during!.width).toBeGreaterThan(before!.width * 0.7)
    await pocket(page, "slot-a").click()
    await expect(bar(page).getByRole("status")).toHaveText("1 selected")
    await expect(pocket(page, "slot-a")).toHaveAttribute("aria-pressed", "true")
    await expect(pocket(page, "slot-a").locator('[data-pocket-mark="selected"]')).toBeVisible()
    await expect(pocket(page, "slot-b").locator('[data-pocket-mark="available"]')).toBeVisible()
    await pocket(page, "slot-c").click(); await pocket(page, "slot-f").click()
    await expect(bar(page).getByRole("status")).toHaveText("3 selected")
    // A tap in layout editing never opens a card, a selector or a form, and prepares nothing.
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await expect(count(page)).toHaveText("0")
    await pocket(page, "slot-c").click()
    await expect(bar(page).getByRole("status")).toHaveText("2 selected")
    for (const action of await bar(page).locator("button:visible").all()) await harness.expectMinTapTarget(action, 36)
    await harness.expectNoHorizontalOverflow()
    await bar(page).getByRole("button", { name: "Done", exact: true }).click()
    await expect(pocket(page, "slot-a")).toHaveAttribute("aria-pressed", "false")
    await expect(pocket(page, "slot-a").locator("[data-pocket-mark]")).toHaveCount(0)
    await expect(count(page)).toHaveText("0")
  })

  test("a move picks its destination by tapping a pocket and saves as one change", async ({ harness }) => {
    const { page } = harness
    await edit(page)
    await pocket(page, "slot-a").click(); await pocket(page, "slot-c").click()
    await bar(page).getByRole("button", { name: "Move", exact: true }).click()
    await expect(bar(page).getByRole("status")).toHaveText("Tap where they go")
    // A selected pocket can't be its own destination.
    await pocket(page, "slot-c").click()
    await expect(bar(page).getByRole("alert")).toContainText("isn't selected")
    await expect(count(page)).toHaveText("0")
    await pocket(page, "slot-f").click()
    await expect(count(page)).toHaveText("1")
    expect(await order(page)).toEqual(["slot-b", "slot-d", "slot-e", "slot-a", "slot-c", "slot-f", "slot-g"])
    expect((await draft(page)).intent.request.commands).toHaveLength(1)
    // The moved pockets stay selected and the bar is ready for the next action.
    await expect(bar(page).getByRole("status")).toHaveText("2 selected")
    await expect(bar(page).getByRole("alert")).toHaveCount(0)
    await bar(page).getByRole("button", { name: "Move", exact: true }).click()
    await bar(page).getByRole("button", { name: "Cancel", exact: true }).click()
    await expect(bar(page).getByRole("status")).toHaveText("2 selected")
    await bar(page).getByRole("button", { name: "Move", exact: true }).click()
    await bar(page).getByRole("button", { name: "To the start", exact: true }).click()
    await expect(count(page)).toHaveText("2")
    expect((await order(page)).slice(0, 2)).toEqual(["slot-a", "slot-c"])
  })

  test("pockets are added at the end, or before and after the selection", async ({ harness }) => {
    const { page } = harness
    await edit(page)
    await bar(page).getByRole("button", { name: "Add", exact: true }).click()
    const add = bar(page).getByRole("menu", { name: "Add an empty pocket" })
    await expect(add.getByRole("menuitem")).toHaveCount(2)
    await add.getByRole("menuitem", { name: "At the end of the binder" }).click()
    await expect(count(page)).toHaveText("1")
    await expect(page.locator("[data-binder-page] button[data-slot-id]")).toHaveCount(8)
    await pocket(page, "slot-a").click()
    await bar(page).getByRole("button", { name: "Add", exact: true }).click()
    await add.getByRole("menuitem", { name: "Before the selection" }).click()
    await expect(count(page)).toHaveText("2")
    expect((await order(page))[1]).toBe("slot-a")
    await expect(bar(page).getByRole("alert")).toHaveCount(0)
  })

  test("right-click and the menu key open a short pocket menu; every action there is also in layout editing", async ({ harness }) => {
    const { page } = harness
    await pocket(page, "slot-a").click({ button: "right" })
    const dialog = menu(page)
    await expect(dialog).toHaveAccessibleName("Snorlax A pocket options")
    await expect(dialog).toContainText("Page 1 · Pocket 1")
    const items = dialog.getByRole("menuitem")
    await expect(items).toHaveText(["View card", "Take the card out", "Remove from collection", "Move this pocket", "Add a pocket before", "Add a pocket after", "Select"])
    for (const item of await items.all()) await harness.expectMinTapTarget(item, 36)
    await harness.expectWithinSafeViewport(dialog)
    await harness.expectNoHorizontalOverflow()
    // Escape, backdrop and back all close it without doing anything.
    await page.keyboard.press("Escape")
    await expect(dialog).toHaveCount(0)
    await menuKey(pocket(page, "slot-a"))
    await expect(dialog).toBeVisible()
    await harness.tapBackdrop(dialog)
    await expect(dialog).toHaveCount(0)
    await menuKey(pocket(page, "slot-e"))
    await expect(dialog).toHaveAccessibleName("Snorlax pocket options")
    // An empty pocket has no card to take out or remove.
    await expect(dialog.getByRole("menuitem")).toHaveText(["Add a card", "Move this pocket", "Add a pocket before", "Add a pocket after", "Select"])
    await page.evaluate(() => window.history.back())
    await expect(dialog).toHaveCount(0)
    expect(page.url()).toContain("e2e-harness")
    await expect(count(page)).toHaveText("0")
    // Select: layout editing opens with this pocket selected.
    await menuKey(pocket(page, "slot-b"))
    await dialog.getByRole("menuitem", { name: "Select", exact: true }).click()
    await expect(bar(page).getByRole("status")).toHaveText("1 selected")
    await expect(pocket(page, "slot-b")).toHaveAttribute("aria-pressed", "true")
    await bar(page).getByRole("button", { name: "Done", exact: true }).click()
    // Move this pocket: straight to choosing where it goes.
    await pocket(page, "slot-a").click({ button: "right" })
    await dialog.getByRole("menuitem", { name: "Move this pocket" }).click()
    await expect(bar(page).getByRole("status")).toHaveText("Tap where it goes")
    await pocket(page, "slot-d").click()
    await expect(count(page)).toHaveText("1")
    expect((await order(page)).slice(0, 4)).toEqual(["slot-b", "slot-c", "slot-a", "slot-d"])
    await bar(page).getByRole("button", { name: "Done", exact: true }).click()
    // Add a pocket after, straight from the menu.
    await pocket(page, "slot-g").click({ button: "right" })
    await dialog.getByRole("menuitem", { name: "Add a pocket after" }).click()
    await expect(count(page)).toHaveText("2")
    await expect(dialog).toHaveCount(0)
    await expect(page.locator("[data-binder-page] button[data-slot-id]")).toHaveCount(8)
    await harness.expectScrollUnlocked()
  })

  test("a graded card can be taken out but not removed from the menu, and View card opens its details", async ({ harness }) => {
    const { page } = harness
    await pocket(page, "slot-b").click({ button: "right" })
    await expect(menu(page).getByRole("menuitem", { name: "Remove from collection" })).toHaveCount(0)
    await expect(menu(page).getByRole("menuitem", { name: "Take the card out" })).toBeVisible()
    await menu(page).getByRole("menuitem", { name: "View card" }).click()
    await expect(menu(page)).toHaveCount(0)
    await expect(page.getByRole("dialog", { name: /details$/ })).toContainText("PSA")
    await expect(count(page)).toHaveText("0")
  })

  test("a long press opens the menu, is dropped by a pan, and never also counts as a tap", async ({ harness }) => {
    const { page } = harness
    const target = pocket(page, "slot-a")
    // Held still: the menu opens, and lifting the finger (with the click that follows) opens nothing else.
    await touch(target, "pointerdown")
    await expect(menu(page)).toBeVisible()
    await touch(target, "pointerup")
    await target.dispatchEvent("click", { detail: 1, bubbles: true })
    await expect(page.getByRole("dialog", { name: /details$/ })).toHaveCount(0)
    await expect(menu(page)).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(menu(page)).toHaveCount(0)
    // A pan, a scroll or a page swipe: the finger moves, so nothing opens, then or later.
    await touch(target, "pointerdown")
    await touch(target, "pointermove", 24, 0)
    await page.waitForTimeout(700)
    await expect(menu(page)).toHaveCount(0)
    await touch(target, "pointerup", 24, 0)
    // The browser taking over the gesture cancels it too.
    await touch(target, "pointerdown")
    await touch(target, "pointercancel")
    await page.waitForTimeout(700)
    await expect(page.getByRole("dialog")).toHaveCount(0)
    // A short tap is still an ordinary tap: the card's details.
    await target.click()
    await expect(page.getByRole("dialog", { name: /details$/ })).toBeVisible()
    await expect(count(page)).toHaveText("0")
  })

  test("the card's details lead into layout editing for that pocket", async ({ harness }) => {
    const { page } = harness
    await pocket(page, "slot-a").click()
    const details = page.getByRole("dialog", { name: /details$/ })
    await details.getByRole("button", { name: "More card options" }).click()
    await details.getByRole("menuitem", { name: "Rearrange pockets" }).click()
    await expect(details).toHaveCount(0)
    await expect(bar(page).getByRole("status")).toHaveText("1 selected")
    await expect(pocket(page, "slot-a")).toHaveAttribute("aria-pressed", "true")
  })

  test("read-only binders have no pocket menu and no layout editing", async ({ harness }) => {
    const { page } = harness
    await page.goto("/app/e2e-harness?signedIn=1&slots=picker&readOnly=1&rows=2&cols=4")
    await expect(pocket(page, "slot-a")).toBeVisible()
    await menuKey(pocket(page, "slot-a"))
    await expect(menu(page)).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Edit layout", exact: true })).toHaveCount(0)
    await expect(pocket(page, "slot-a")).not.toHaveAttribute("aria-haspopup", "menu")
  })
})
