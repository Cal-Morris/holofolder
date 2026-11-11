import { test, expect } from "@playwright/test"

// app/not-found.tsx is static, so an unknown URL gets the app's own 404 page (with the root layout
// and a way back) rather than the bare framework one. A single segment could be a binder slug
// (/app/<slug>, which sends signed-out visitors to sign in), so the URL has a non-binder view.
test("unknown URLs show the Holo Folder not-found page with a 404 status", async ({ page }) => {
  const response = await page.goto("/app/this-page/does-not-exist")
  expect(response?.status()).toBe(404)
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible()
  await expect(page.getByRole("link", { name: "Home" })).toHaveAttribute("href", "https://holofolder.com")
})
