import { test, expect, mockBackends, emulateStandalone, Harness } from "./fixtures"
import { fulfillListInventory, listEntry, LIST_SLOTS } from "./collection-list-fixture"

// Native collection List view with a synthetic full 1,025 slot binder (see collection-list-fixture.ts).
test.beforeEach(async ({ page, context, standalone, insets, baseURL }) => {
  if (standalone) await emulateStandalone(page, insets)
  await mockBackends(page, context, { signedIn: true, baseURL })
  await page.route("**/app/e2e-harness/storage/inventory?*", route => fulfillListInventory(route))
})

const list = (page: import("@playwright/test").Page) => page.getByRole("region", { name: "Collection slots" })
const rows = (page: import("@playwright/test").Page) => list(page).getByRole("listitem")

for (const width of [1280, 1440]) {
  test(`desktop ${width}px: bounded multi-column compact rows, no data dropped`, async ({ page }, info) => {
    test.skip(info.project.name !== "browser-390x844", "desktop geometry runs once, on the default browser project")
    await page.setViewportSize({ width, height: 900 })
    await page.goto(listEntry)
    await expect(rows(page)).toHaveCount(LIST_SLOTS)
    const first = (await rows(page).nth(0).boundingBox())!, second = (await rows(page).nth(1).boundingBox())!
    const section = (await list(page).boundingBox())!, filter = (await page.getByRole("searchbox", { name: "Filter collection" }).boundingBox())!
    expect(first.height, "compact row").toBeLessThanOrEqual(80)
    expect(first.height).toBeGreaterThanOrEqual(56)
    expect(second.y, "second row sits beside the first, so the list has several columns").toBeCloseTo(first.y, 0)
    expect(second.x).toBeGreaterThan(first.x + first.width - 1)
    const lastCol = (await rows(page).nth(2).boundingBox())!
    expect(lastCol.x + lastCol.width - first.x, "list content is bounded").toBeLessThanOrEqual(1152)
    expect(section.width - (lastCol.x + lastCol.width - first.x), "list does not span the screen").toBeGreaterThan(80)
    expect(filter.width, "filter is bounded").toBeLessThanOrEqual(448)
    await new Harness(page, { top: 0, bottom: 0, left: 0, right: 0 }, true).expectNoHorizontalOverflow()
    // Owned, wanted, missing and free-spacer states are all still represented, with display names and no internal wording.
    for (const label of ["Owned", "Wanted", "Missing", "Empty slot"]) await expect(rows(page).filter({ hasText: label }).first()).toBeAttached()
    await expect(rows(page).nth(1)).toContainText("Ivysaur")
    // Visible row text only: the artwork button keeps its screen-reader label from the shared OrderedSlot.
    await expect(list(page).locator("li > div:last-child").filter({ hasText: /Unfilled target|Owned copy|Empty spacer/ })).toHaveCount(0)
    expect(await list(page).evaluate(el => el.scrollHeight), "1,025 rows stay compact").toBeLessThan(1025 * 80 / 3 + 600)
  })
}

test("phone: one comfortable column, no overflow, 36px targets, long names stay inside the row", async ({ page, insets }) => {
  await page.goto(listEntry)
  await expect(rows(page)).toHaveCount(LIST_SLOTS)
  const h = new Harness(page, insets, true)
  await h.expectNoHorizontalOverflow()
  const first = rows(page).nth(0), second = rows(page).nth(1)
  const a = (await first.boundingBox())!, b = (await second.boundingBox())!
  expect(b.y, "single column").toBeGreaterThan(a.y + a.height - 1)
  expect(a.height).toBeLessThanOrEqual(80)
  await h.expectMinTapTarget(first.locator("[data-slot-id]"))
  // Row 0 carries the long synthetic card name; it must not escape its row.
  const name = first.locator("p").first(), box = (await name.boundingBox())!
  expect(box.x + box.width).toBeLessThanOrEqual(a.x + a.width)
  expect(await name.evaluate(el => el.scrollWidth > el.clientWidth), "long name is truncated, not wrapped over the row").toBe(true)
})

test("selecting a row, by artwork or anywhere on the row, selects that exact slot", async ({ page }) => {
  await page.goto(listEntry)
  await expect(rows(page)).toHaveCount(LIST_SLOTS)
  const detail = page.getByRole("dialog", { name: /details$/ })
  await page.locator('[data-slot-id="synthetic-list-slot-3"]').click()
  await expect(detail).toHaveAttribute("data-slot-id", "synthetic-list-slot-3")
  await detail.getByRole("button", { name: /^Close/ }).click()
  await expect(detail).not.toBeVisible()
  await rows(page).nth(7).getByRole("paragraph").first().click()
  await expect(detail).toHaveAttribute("data-slot-id", "synthetic-list-slot-7")
})

test("filter keeps slot order and ids", async ({ page }) => {
  await page.goto(listEntry)
  await expect(rows(page)).toHaveCount(LIST_SLOTS)
  await page.getByRole("searchbox", { name: "Filter collection" }).fill("slot-102")
  // Ids 102 and 1020-1024 match, in native order.
  await expect(rows(page)).toHaveCount(6)
  expect(await rows(page).locator("[data-slot-id]").evaluateAll(els => els.map(e => e.getAttribute("data-slot-id")))).toEqual(
    ["102", "1020", "1021", "1022", "1023", "1024"].map(n => `synthetic-list-slot-${n}`))
})
