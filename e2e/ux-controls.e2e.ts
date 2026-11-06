import { test, expect } from "./fixtures"

test("list actions meet the minimum target size without overflowing", async ({ harness, page }) => {
  await harness.dock().getByRole("button", { name: "List", exact: true }).click()
  const actions = [
    page.getByRole("button", { name: "All bulbasaur cards", exact: true }),
    page.getByRole("button", { name: "Own", exact: true }).first(),
    page.getByRole("button", { name: "Add card for bulbasaur", exact: true }),
    page.getByRole("button", { name: "Wantlist card for bulbasaur", exact: true }),
  ]
  for (const action of actions) {
    await expect(action).toBeVisible()
    await harness.expectMinTapTarget(action)
    await harness.expectHittable(action)
  }
  await harness.expectNoHorizontalOverflow()
})

test("search has one title and reachable header controls", async ({ harness, page }) => {
  await harness.dock().getByRole("button", { name: "Search", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Search Pokemon" })
  const quick = dialog.getByRole("button", { name: "Quick mode", exact: true })
  const close = dialog.getByRole("button", { name: "Close search", exact: true })
  await expect(dialog.getByText("Search", { exact: true })).toBeVisible()
  for (const control of [quick, close]) {
    await harness.expectMinTapTarget(control)
    await harness.expectHittable(control)
  }
  await harness.expectNoHorizontalOverflow()
})

test("desktop view navigation keeps 36px targets", async ({ harness, page }) => {
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    const header = page.getByTestId("app-header")
    for (const name of ["Binder", "List", "Wanted", "Sets"]) {
      const tab = header.getByRole("button", { name, exact: true })
      await expect(tab).toBeVisible()
      await harness.expectMinTapTarget(tab)
    }
    await harness.expectNoHorizontalOverflow()
  }
})

test("list nested keyboard action does not open the slot", async ({ harness, page }) => {
  await harness.dock().getByRole("button", { name: "List", exact: true }).click()
  const action = page.getByRole("button", { name: "Add card for bulbasaur", exact: true })
  await action.focus()
  await action.press("Enter")
  await expect(page.getByRole("dialog")).toHaveCount(1)
  await expect(page.getByRole("dialog", { name: "Welcome, sign in" })).toBeVisible()
})

test("settings clears the dock and empty wanted offers a price check", async ({ harness, page }) => {
  await page.getByRole("button", { name: "More", exact: true }).click()
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true })
  await expect(dialog).toBeVisible()
  await harness.expectWithinSafeViewport(dialog)
  const dock = harness.dock()
  await expect.poll(async () => {
    const box = (await dialog.boundingBox())!
    return box.y + box.height
  }).toBeLessThan((await dock.boundingBox())!.y)
  await harness.expectHittable(dock.getByRole("button", { name: "Wanted", exact: true }))
  await dock.getByRole("button", { name: "Wanted", exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await page.getByRole("button", { name: "Check a card price", exact: true }).click()
  await expect(page.getByRole("dialog", { name: "Quick mode", exact: true }).getByRole("heading", { name: "Price check", exact: true })).toBeVisible()
})
