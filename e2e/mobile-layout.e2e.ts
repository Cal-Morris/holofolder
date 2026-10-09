import { test, expect, type Harness } from "./fixtures"

const header = (harness: Harness) => harness.page.locator("nav").first()
const pager = (harness: Harness) => harness.page.getByTestId("mobile-header-pager")

for (const signedIn of [false, true]) {
  test.describe(`binder header pager (${signedIn ? "signed in" : "signed out"})`, () => {
    test.use({ signedIn })

    test("lives in the header, fits on one row and pages the binder", async ({ harness }) => {
      await expect(pager(harness)).toBeVisible()
      const headerBox = (await header(harness).boundingBox())!
      const pagerBox = (await pager(harness).boundingBox())!
      expect(pagerBox.y).toBeGreaterThanOrEqual(headerBox.y - 0.5)
      expect(pagerBox.y + pagerBox.height).toBeLessThanOrEqual(headerBox.y + headerBox.height + 0.5)
      // Nothing in the pager wraps onto a second line.
      expect(pagerBox.height).toBeLessThanOrEqual(46)
      // Header controls stay on a single row (no wrapping) and inside the safe area.
      await harness.expectWithinSafeViewport(pager(harness))
      await harness.expectWithinSafeViewport(header(harness).getByRole("button", { name: /open settings/i }))
      await harness.expectNoHorizontalOverflow()

      const pageInput = harness.page.getByRole("spinbutton", { name: "Binder page number" })
      const next = pager(harness).getByRole("button", { name: /^next binder/i })
      const prev = pager(harness).getByRole("button", { name: /^previous binder/i })
      await harness.expectMinTapTarget(next)
      await harness.expectMinTapTarget(prev)
      // Nothing else in the header (e.g. Sign in) covers the pager controls.
      for (const control of await pager(harness).locator("button:not([disabled])").all()) {
        if (await control.isVisible()) await harness.expectHittable(control)
      }
      await harness.expectHittable(pageInput)
      await expect(pageInput).toHaveValue("1")
      await expect(prev).toBeDisabled()
      await next.click()
      await expect(pageInput).toHaveValue("2")
      await prev.click()
      await expect(pageInput).toHaveValue("1")
    })

    test("is not shown outside the binder view", async ({ harness }) => {
      await harness.dock().getByRole("button", { name: "List", exact: true }).click()
      await expect(pager(harness)).toHaveCount(0)
    })
  })
}
