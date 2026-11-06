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

test("search instructions have their own row below the header controls", async ({ harness, page }) => {
  await harness.dock().getByRole("button", { name: "Search", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Search Pokemon" })
  const hint = dialog.getByText("Find Pokémon, cards, sets or artists.")
  const quick = dialog.getByRole("button", { name: "Quick mode", exact: true })
  const close = dialog.getByRole("button", { name: "Close search", exact: true })
  await expect(hint).toBeVisible()
  for (const control of [quick, close]) {
    await harness.expectMinTapTarget(control)
    await harness.expectHittable(control)
    const box = (await control.boundingBox())!
    expect((await hint.boundingBox())!.y).toBeGreaterThanOrEqual(box.y + box.height)
  }
  await harness.expectNoHorizontalOverflow()
})

test("desktop view navigation keeps 36px targets", async ({ harness, page }) => {
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    const header = page.getByTestId("app-header")
    for (const name of ["Binder", "List", "Wanted", "Browse"]) {
      const tab = header.getByRole("button", { name, exact: true })
      await expect(tab).toBeVisible()
      await harness.expectMinTapTarget(tab)
    }
    await harness.expectNoHorizontalOverflow()
  }
})
