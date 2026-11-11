import { test, expect, openSettingsPage } from "./fixtures"

test.use({ signedIn: true })

for (const entry of ["More", "Binders", "Settings"] as const) {
  test(`Studio opens from ${entry} without the overlay undoing navigation`, async ({ harness }) => {
    const { page } = harness
    await page.goto("/app/e2e-harness?signedIn=1&binders=1")
    if (entry === "Binders") {
      await page.getByTestId("binder-switcher-trigger").click()
    } else {
      await page.getByRole("button", { name: "More", exact: true }).click()
      if (entry === "Settings") {
        await page.getByRole("menuitem", { name: "Settings", exact: true }).click()
        await openSettingsPage(page.getByRole("dialog", { name: "Settings", exact: true }), "Layout")
      }
    }
    const studioLink = entry === "More"
      ? page.getByRole("menuitem", { name: "Binder Studio", exact: true })
      : page.getByRole("link", { name: /Binder Studio/ })
    await expect(studioLink).toHaveAttribute("href", "/app/studio")
    await harness.expectMinTapTarget(studioLink, 44)
    await harness.expectWithinSafeViewport(studioLink)
    await harness.expectHittable(studioLink)
    await harness.expectNoHorizontalOverflow()
    // The signed-in client is synthetic; the real Studio route opens as a guest.
    await page.context().clearCookies()
    await studioLink.click()
    await expect(page).toHaveURL(/\/app\/studio$/)
    await expect(page.getByRole("heading", { name: "Binder Studio", exact: true })).toBeVisible()
    await expect(page.getByRole("dialog")).toHaveCount(0)
    const back = page.getByRole("link", { name: "Your binder", exact: true })
    await expect(back).toHaveAttribute("href", "/app")
    await back.click()
    await expect(page).toHaveURL(/\/app\/auth\/login$/)
    await expect(page.getByRole("heading", { name: "Start your binder" })).toBeVisible()
  })
}

test("Studio keeps back and save actions within the safe area", async ({ harness }) => {
  const { page } = harness
  await page.context().clearCookies()
  await page.goto("/app/e2e-harness/studio?theme=light")
  const back = page.getByRole("link", { name: "Your binder", exact: true })
  await harness.expectMinTapTarget(back, 44)
  await harness.expectWithinSafeViewport(back)
  await harness.expectHittable(back)
  await harness.expectWithinSafeViewport(page.getByRole("button", { name: "Save appearance" }))
  await harness.expectNoHorizontalOverflow()
  await page.screenshot({ path: test.info().outputPath("studio-app-chrome.png") })
})
