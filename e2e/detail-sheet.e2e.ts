import { test, expect } from "./fixtures"

test.describe("card detail sheet on phones", () => {
  test.use({ signedIn: true })

  test("uses the full height above the dock, the full width and shows a large card preview", async ({ harness }) => {
    const dialog = await harness.openCardDetail()
    const dockTop = (await harness.dock().locator(":scope > div").first().boundingBox())!.y
    const box = (await dialog.boundingBox())!
    expect(box.y + box.height, "sheet must not cover the dock").toBeLessThanOrEqual(dockTop + 0.5)
    expect(dockTop - (box.y + box.height), "sheet hugs the dock").toBeLessThanOrEqual(10)
    expect(box.y).toBeGreaterThanOrEqual(harness.insets.top - 0.5)
    const { width } = harness.viewport
    expect(box.width).toBeGreaterThanOrEqual(Math.min(width - 16, 448) - 1)
    const preview = dialog.locator("img").first()
    await expect(preview).toBeVisible()
    expect((await preview.boundingBox())!.height, "card preview is readable").toBeGreaterThanOrEqual(64)
    await harness.expectNoHorizontalOverflow()
    await harness.expectHittable(harness.dock().getByRole("button", { name: "List", exact: true }))
  })

  test("all cards view also hugs the dock", async ({ harness }) => {
    const detail = await harness.openCardDetail()
    await detail.getByRole("button", { name: /all bulbasaur cards/i }).click()
    const dialog = harness.page.getByRole("dialog", { name: /all bulbasaur cards/i })
    await expect(dialog).toBeVisible()
    const dockTop = (await harness.dock().locator(":scope > div").first().boundingBox())!.y
    const box = (await dialog.boundingBox())!
    expect(box.y + box.height).toBeLessThanOrEqual(dockTop + 0.5)
    expect(dockTop - (box.y + box.height)).toBeLessThanOrEqual(10)
  })
})
