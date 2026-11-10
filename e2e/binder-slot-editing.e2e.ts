import { test, expect, Harness, mockBackends, emulateStandalone } from "./fixtures"

test.describe("staged explicit layout editing", () => {
  test.use({ signedIn: true, harness: async ({ page, context, standalone, insets, baseURL }, provide) => {
    if (standalone) await emulateStandalone(page, insets)
    await mockBackends(page, context, { signedIn: true, baseURL })
    // These staged specs open their explicit synthetic slot surface, not authenticated startup.
    await provide(new Harness(page, insets, true))
  } })
  const sheet = (page: import("@playwright/test").Page) => page.getByRole("dialog", { name: /details$/ })
  const slot = (page: import("@playwright/test").Page, id: string) => page.locator(`button[data-slot-id="${id}"]`)
  const toolbar = (page: import("@playwright/test").Page) => page.getByRole("region", { name: "Layout editing", exact: true })
  test.beforeEach(async ({ harness }) => {
    await harness.page.goto("/app/e2e-harness?signedIn=1&slots=picker&rows=2&cols=2")
    // Complete a real interaction before effect-installed listeners or synthetic events.
    await slot(harness.page, "slot-a").click()
    await expect(sheet(harness.page)).toBeVisible()
    await harness.closeControl(sheet(harness.page)).click()
    await expect(sheet(harness.page)).toHaveCount(0)
  })

  test("browse taps, holds, drags, swipes and cancelled pointers never emit layout drafts", async ({ harness }) => {
    const { page } = harness
    await expect(toolbar(page).getByRole("button", { name: "Edit layout", exact: true })).toBeVisible()
    const target = slot(page, "slot-a")
    await target.dispatchEvent("pointerdown", { pointerId: 1, clientX: 30, clientY: 30 })
    await target.dispatchEvent("pointermove", { pointerId: 1, clientX: 100, clientY: 60 })
    await target.dispatchEvent("pointercancel", { pointerId: 1 })
    await target.dispatchEvent("dragstart")
    await target.dispatchEvent("dragend")
    await target.dispatchEvent("contextmenu")
    await target.click({ delay: 650 })
    await expect(sheet(page).getByRole("button", { name: /Insert|Move|Append/ })).toHaveCount(0)
    await harness.closeControl(sheet(page)).click()
    const box = (await target.boundingBox())!
    await page.mouse.move(box.x + 10, box.y + 30)
    await page.mouse.down()
    await page.mouse.move(box.x + 10, box.y + 100, { steps: 8 })
    await page.mouse.up()
    await expect(page.getByLabel("Synthetic draft count")).toHaveText("0")
  })

  test("first insertion shifts whole slots across pages, keyboard moves preserve the target and copy", async ({ harness }) => {
    const { page } = harness
    const writes: string[] = []
    page.on("request", r => { if (/\/api\/(inventory|binder-slots|collection)(\?|$)/.test(r.url()) && r.method() !== "GET") writes.push(r.url()) })
    const before = (await slot(page, "slot-a").boundingBox())!
    await expect(slot(page, "slot-a")).toHaveAccessibleDescription("A1")
    await toolbar(page).getByRole("button", { name: "Edit layout", exact: true }).click()
    await expect(toolbar(page)).toContainText("Editing layout")
    const editingSlot = (await slot(page, "slot-a").boundingBox())!
    await harness.expectMinTapTarget(slot(page, "slot-a"), 36)
    for (const control of await toolbar(page).getByRole("button").all()) await harness.expectMinTapTarget(control, 36)
    await slot(page, "slot-a").click()
    const dialog = sheet(page)
    await expect(dialog.getByRole("button", { name: "Choose card", exact: true })).toHaveCount(0)
    await expect(dialog.getByRole("button", { name: "Move earlier", exact: true })).toBeDisabled()
    await dialog.getByRole("button", { name: "Insert free slot before", exact: true }).click()
    await expect(page.getByLabel("Synthetic draft count")).toHaveText("1")
    await expect(dialog).toContainText("Slot 2 of 8")
    await dialog.getByRole("spinbutton", { name: "Saved position", exact: true }).fill("8")
    await dialog.getByRole("spinbutton", { name: "Saved position", exact: true }).press("Enter")
    await expect(page.getByLabel("Synthetic draft count")).toHaveText("2")
    await expect(dialog).toContainText("Slot 8 of 8")
    await expect(dialog).not.toContainText("item-a")
    await expect(dialog).toContainText("Snorlax A")
    await expect(dialog.getByRole("button", { name: "Move later", exact: true })).toBeDisabled()
    await harness.expectWithinSafeViewport(dialog)
    const bounds = (await dialog.boundingBox())!, dock = (await harness.dock().boundingBox())!
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(dock.y)
    for (const control of await dialog.getByRole("button").all()) await harness.expectMinTapTarget(control, 36)
    await harness.expectNoHorizontalOverflow()
    console.log("layout geometry", test.info().project.name, JSON.stringify({ beforeSlot: before, editingSlot, sheet: bounds, dockTop: dock.y }))
    await dialog.getByRole("button", { name: "Done", exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(toolbar(page).getByRole("button", { name: "Edit layout", exact: true })).toBeVisible()
    const pager = page.getByRole("spinbutton", { name: "Binder page number" })
    await pager.fill("2")
    await pager.press("Enter")
    await expect(slot(page, "slot-a")).toBeVisible()
    await expect(slot(page, "slot-a")).toHaveAccessibleName("Snorlax A, Owned")
    // Coordinates follow the pocket's position on this page, not the stable slot id.
    await expect(slot(page, "slot-a")).toHaveAccessibleDescription("B2")
    await toolbar(page).getByRole("button", { name: "Edit layout", exact: true }).click()
    await slot(page, "slot-a").click()
    await sheet(page).getByRole("button", { name: "Insert free slot after", exact: true }).click()
    await expect(sheet(page)).toContainText("Slot 8 of 9")
    await sheet(page).getByRole("button", { name: "Done", exact: true }).click()
    await expect(pager).toHaveAttribute("max", "3")
    await pager.fill("3")
    await pager.press("Enter")
    await expect(page.locator("button[data-slot-id]")).toHaveCount(1)
    await expect(page.locator("button[data-slot-id]")).toHaveAccessibleName("Free slot, Empty spacer")
    await expect(page.locator("button[data-slot-id]")).toHaveAccessibleDescription("A1")
    expect(writes).toEqual([])
  })

  test("append creates a trailing page and works on an empty collection", async ({ harness }) => {
    const { page } = harness
    await toolbar(page).getByRole("button", { name: "Edit layout", exact: true }).click()
    await toolbar(page).getByRole("button", { name: "Append free slot", exact: true }).click()
    await toolbar(page).getByRole("button", { name: "Append free slot", exact: true }).click()
    await expect(page.getByLabel("Synthetic draft count")).toHaveText("2")
    await page.evaluate(() => window.dispatchEvent(new Event("synthetic-layout-empty")))
    await expect(page.getByText("No slots in this binder", { exact: true })).toBeVisible()
    await toolbar(page).getByRole("button", { name: "Append free slot", exact: true }).click()
    await expect(page.locator("button[data-slot-id]")).toHaveCount(1)
    await expect(page.locator("button[data-slot-id]")).toHaveAccessibleName("Free slot, Empty spacer")
    await expect(page.getByLabel("Synthetic draft count")).toHaveText("3")
  })

  test("stable before/after moves and cancel selection keep handed-off drafts", async ({ harness }) => {
    const { page } = harness
    await toolbar(page).getByRole("button", { name: "Edit layout", exact: true }).click()
    await slot(page, "slot-a").click()
    const dialog = sheet(page)
    await dialog.getByRole("combobox", { name: "Saved anchor slot", exact: true }).selectOption("slot-g")
    await dialog.getByRole("button", { name: "Move after", exact: true }).click()
    await expect(dialog).toContainText("Slot 7 of 7")
    await dialog.getByRole("combobox", { name: "Saved anchor slot", exact: true }).selectOption("slot-b")
    await dialog.getByRole("button", { name: "Move before", exact: true }).click()
    await expect(dialog).toContainText("Slot 1 of 7")
    await dialog.getByRole("button", { name: "Insert free slot after", exact: true }).click()
    await dialog.getByRole("button", { name: "Cancel selection", exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByLabel("Synthetic draft count")).toHaveText("3")
    await expect(toolbar(page)).toContainText("Editing layout")
    await slot(page, "slot-a").click()
    await expect(sheet(page)).toContainText("Slot 1 of 8")
    await expect(sheet(page).getByRole("button", { name: /Undo|Remove slot/ })).toHaveCount(0)
  })

  test("pointer begun in Browse cannot become edit selection, Done clears selection and reload starts Browse", async ({ harness }) => {
    const { page } = harness
    const target = slot(page, "slot-a")
    await target.dispatchEvent("pointerdown", { pointerId: 1, clientX: 30, clientY: 30 })
    const edit = toolbar(page).getByRole("button", { name: "Edit layout", exact: true })
    await edit.focus()
    await page.keyboard.press("Enter")
    await expect(toolbar(page)).toContainText("Editing layout")
    const append = toolbar(page).getByRole("button", { name: "Append free slot", exact: true })
    await append.dispatchEvent("pointerdown", { pointerId: 2, clientX: 30, clientY: 30 })
    await append.dispatchEvent("pointercancel", { pointerId: 2 })
    await append.dispatchEvent("click", { detail: 1 })
    await expect(page.getByLabel("Synthetic draft count")).toHaveText("0")
    await target.dispatchEvent("pointerup", { pointerId: 1, clientX: 30, clientY: 30 })
    await target.dispatchEvent("click", { detail: 1 })
    await expect(sheet(page)).toHaveCount(0)
    await target.click()
    await expect(sheet(page)).toBeVisible()
    await sheet(page).getByRole("button", { name: "Done", exact: true }).click()
    await expect(target).toHaveAttribute("aria-pressed", "false")
    await toolbar(page).getByRole("button", { name: "Edit layout", exact: true }).click()
    await page.reload()
    await expect(toolbar(page).getByRole("button", { name: "Edit layout", exact: true })).toBeVisible()
    await expect(page.getByLabel("Synthetic draft count")).toHaveText("0")
  })

  test("owner/binder and view changes exit editing and discard unfinished destination", async ({ harness }) => {
    const { page } = harness
    for (const kind of ["owner", "binder"]) {
      await toolbar(page).getByRole("button", { name: "Edit layout", exact: true }).click()
      await slot(page, "slot-a").click()
      await sheet(page).getByRole("spinbutton", { name: "Saved position", exact: true }).fill("7")
      await page.evaluate(kind => window.dispatchEvent(new CustomEvent("synthetic-slot-scope-change", { detail: kind })), kind)
      await expect(sheet(page)).toHaveCount(0)
      await expect(toolbar(page).getByRole("button", { name: "Edit layout", exact: true })).toBeVisible()
    }
    await toolbar(page).getByRole("button", { name: "Edit layout", exact: true }).click()
    await harness.dock().getByRole("button", { name: "List", exact: true }).click()
    await expect(toolbar(page)).toHaveCount(0)
    await harness.dock().getByRole("button", { name: "Binder", exact: true }).click()
    await expect(toolbar(page).getByRole("button", { name: "Edit layout", exact: true })).toBeVisible()
    await expect(page.getByLabel("Synthetic draft count")).toHaveText("0")
  })

  test("layout sheet uses every shared dismissal and keeps dock reachable", async ({ harness }) => {
    const { page } = harness
    await toolbar(page).getByRole("button", { name: "Edit layout", exact: true }).click()
    for (const dismissal of ["x", "escape", "back", "backdrop", "swipe", "dock"]) {
      await slot(page, "slot-a").click()
      const dialog = sheet(page)
      await expect(dialog.getByRole("spinbutton", { name: "Saved position", exact: true })).toBeVisible()
      await harness.expectWithinSafeViewport(dialog)
      await harness.expectHittable(harness.closeControl(dialog))
      if (dismissal === "x") await harness.closeControl(dialog).click()
      if (dismissal === "escape") await page.keyboard.press("Escape")
      if (dismissal === "back") await page.goBack()
      if (dismissal === "backdrop") await harness.tapBackdrop(dialog)
      if (dismissal === "swipe") await harness.swipeDown(dialog)
      if (dismissal === "dock") await harness.dock().getByRole("button", { name: "List", exact: true }).click()
      await expect(dialog).toHaveCount(0)
      await harness.expectScrollUnlocked()
    }
    await expect(page.getByLabel("Synthetic draft count")).toHaveText("0")
  })

  test("presentation filters disable layout editing and returning to All starts Browse", async ({ harness }) => {
    const { page } = harness
    await toolbar(page).getByRole("button", { name: "Edit layout", exact: true }).click()
    await page.getByRole("button", { name: "View", exact: true }).click()
    const options = page.getByRole("dialog", { name: "View options", exact: true })
    await options.getByRole("combobox", { name: "Generation", exact: true }).selectOption("1")
    await harness.closeControl(options).click()
    await expect(toolbar(page)).toHaveCount(0)
    await page.getByRole("button", { name: "View", exact: true }).click()
    await options.getByRole("combobox", { name: "Generation", exact: true }).selectOption("0")
    await harness.closeControl(options).click()
    await expect(toolbar(page).getByRole("button", { name: "Edit layout", exact: true })).toBeVisible()
    await expect(page.getByLabel("Synthetic draft count")).toHaveText("0")
  })

  test("rejected draft retries original operation and slot IDs without claiming success", async ({ harness }) => {
    const { page } = harness
    await toolbar(page).getByRole("button", { name: "Edit layout", exact: true }).click()
    await page.evaluate(() => window.dispatchEvent(new Event("synthetic-layout-reject-once")))
    await toolbar(page).getByRole("button", { name: "Append free slot", exact: true }).click()
    await expect(toolbar(page).getByRole("alert")).toContainText("Save not confirmed.")
    await expect(page.getByLabel("Synthetic draft count")).toHaveText("0")
    const rejected = JSON.parse((await page.getByLabel("Synthetic rejected draft").textContent())!)
    await toolbar(page).getByRole("button", { name: "Retry same draft", exact: true }).click()
    await expect(page.getByLabel("Synthetic draft count")).toHaveText("1")
    expect(JSON.parse((await page.getByLabel("Synthetic latest draft").textContent())!)).toEqual(rejected)
    const id = rejected.intent.request.commands[0].ids[0]
    await page.getByRole("spinbutton", { name: "Binder page number" }).fill("2")
    await page.getByRole("spinbutton", { name: "Binder page number" }).press("Enter")
    await expect(slot(page, id)).toBeVisible()
    await expect(toolbar(page).getByRole("alert")).toHaveCount(0)
  })

  test("read-only callers have no layout controls", async ({ harness }) => {
    const { page } = harness
    await page.goto("/app/e2e-harness?signedIn=1&slots=picker&readOnly=1&rows=2&cols=2")
    await expect(slot(page, "slot-a")).toBeVisible()
    await expect(toolbar(page)).toHaveCount(0)
  })
})
