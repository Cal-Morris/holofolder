import { test, expect } from "./fixtures"

test("Studio applies the account theme on a direct visit", async ({ harness }) => {
  await harness.page.goto("/app/e2e-harness/studio?theme=light")
  await expect(harness.page.locator(".binder-studio")).toHaveCSS("background-color", "rgb(247, 246, 251)")
  await expect(harness.page.locator(".studio-controls")).toHaveCSS("background-color", "rgb(255, 255, 255)")
  await harness.expectNoHorizontalOverflow()
  await harness.page.goto("/app/e2e-harness/studio?theme=dark")
  await expect(harness.page.locator(".binder-studio")).toHaveCSS("background-color", "rgb(7, 7, 10)")
  await expect(harness.page.locator(".studio-controls")).toHaveCSS("background-color", "rgb(17, 17, 22)")
})
