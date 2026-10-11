import { test, expect } from "./fixtures"

test.describe("mobile slot quick actions", () => {
  test.use({ signedIn: true })

  test("tapping opens compact actions with details available", async ({ harness }) => {
    await harness.page.locator('button[data-dex-id="1"]').first().tap()
    const actions = harness.page.getByRole("dialog", { name: "Bulbasaur quick actions" })
    await expect(actions).toBeVisible()
    await expect(harness.page.getByRole("dialog", { name: /details$/i })).toHaveCount(0)
    await harness.expectWithinSafeViewport(actions)
    await harness.expectMinTapTarget(actions.getByRole("button", { name: "Details", exact: true }), 36)
    await actions.getByRole("button", { name: "Details", exact: true }).tap()
    await expect(harness.page.getByRole("dialog", { name: /bulbasaur.*details/i })).toBeVisible()
    await expect(actions).toHaveCount(0)
  })

  for (const dismissal of ["close", "escape", "back", "backdrop", "swipe", "dock"] as const) {
    test(`compact actions dismiss via ${dismissal}`, async ({ harness }) => {
      const slot = harness.page.locator('button[data-dex-id="1"]').first()
      await slot.tap()
      const actions = harness.page.getByRole("dialog", { name: "Bulbasaur quick actions" })
      await expect(actions).toBeVisible()
      if (dismissal === "close") await harness.closeControl(actions).tap()
      if (dismissal === "escape") await harness.page.keyboard.press("Escape")
      if (dismissal === "back") await harness.page.goBack()
      if (dismissal === "backdrop") await harness.tapBackdrop(actions)
      if (dismissal === "swipe") await harness.swipeDown(actions)
      if (dismissal === "dock") await harness.dock().getByRole("button", { name: "List", exact: true }).tap()
      await expect(actions).toHaveCount(0)
      await harness.expectScrollUnlocked()
      await expect(harness.page).toHaveURL(/e2e-harness/)
    })
  }
})
