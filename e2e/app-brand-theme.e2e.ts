import { test, expect } from "./fixtures"

test.describe("Holo Folder visual language", () => {
  test.use({ signedIn: true })

  test("uses the marketing palette and locally loaded typography", async ({ harness }) => {
    const { page } = harness
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(7, 7, 10)")
    await expect(page.locator("body")).toHaveCSS("font-family", /Inter/)
    await expect.poll(() => page.evaluate(async () => {
      await document.fonts.ready
      return [...document.fonts].some(font => font.family === "Inter" && font.status === "loaded")
    })).toBe(true)
    await expect(harness.dock().getByRole("button", { name: "Binder", exact: true })).toHaveCSS("color", "rgb(185, 166, 255)")
    await expect(page.locator('meta[name="theme-color"]:not([media])').first()).toHaveAttribute("content", "#07070a")
    const remoteFonts = await page.evaluate(() => performance.getEntriesByType("resource").map(entry => entry.name).filter(url => /fonts\.(googleapis|gstatic)\.com/.test(url)))
    expect(remoteFonts).toEqual([])
    await page.screenshot({ path: test.info().outputPath("binder-dark.png") })
  })

  test("keeps the same surfaces and readable controls across views and sheets", async ({ harness }) => {
    const { page } = harness
    for (const tab of ["Binder", "List", "Wanted", "Browse"] as const) {
      await harness.dock().getByRole("button", { name: tab, exact: true }).click()
      await expect(harness.dock().getByRole("button", { name: tab, exact: true })).toHaveAttribute("aria-pressed", "true")
      await expect(page.getByTestId("main-content")).toBeVisible()
      await harness.expectNoHorizontalOverflow()
      await harness.expectWithinSafeViewport(harness.dock().locator(":scope > div").first())
    }
    await page.getByTestId("app-header").getByRole("button", { name: "More", exact: true }).click()
    await page.getByRole("menuitem", { name: "Settings", exact: true }).click()
    const settings = page.getByRole("dialog", { name: "Settings", exact: true })
    await expect(settings).toHaveCSS("background-color", "rgb(17, 17, 22)")
    await harness.expectMinTapTarget(harness.closeControl(settings))
    await page.screenshot({ path: test.info().outputPath("settings-dark.png") })
    await harness.closeControl(settings).click()
    await page.getByTestId("app-header").getByRole("button", { name: "More", exact: true }).click()
    await page.getByRole("menuitem", { name: "Light mode", exact: true }).click()
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(247, 246, 251)")
    await expect(page.locator("body")).toHaveCSS("color", "rgb(21, 18, 31)")
    await harness.expectNoHorizontalOverflow()
    await page.screenshot({ path: test.info().outputPath("browse-light.png") })
  })
})
