import { test, expect } from "./fixtures"

test.use({ signedIn: true })

for (const width of [768, 1024, 1280, 1440]) {
  test(`desktop toolbar fits at ${width}px without scrolling`, async ({ harness }) => {
    await harness.page.setViewportSize({ width, height: 900 })
    const search = harness.page.locator("nav").first().getByRole("button", { name: "Search", exact: true })
    const toolbar = search.locator("../..")
    await expect(search).toBeVisible()
    const size = await toolbar.evaluate(element => ({ width: element.clientWidth, content: element.scrollWidth }))
    expect(size.content).toBeLessThanOrEqual(size.width)
    await harness.expectHittable(harness.page.getByRole("button", { name: "Next Needed", exact: true }))
    await harness.page.getByRole("button", { name: "Filters", exact: true }).click()
    await harness.expectHittable(harness.page.getByRole("button", { name: "Perfect", exact: true }))
  })
}
