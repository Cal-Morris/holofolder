import { test, expect } from "@playwright/test"

// /app/auth/login is a static server page with a client form island, so the form is in the HTML.
test("the sign-in form is in the prerendered HTML", async ({ request }) => {
  const response = await request.get("/app/auth/login")
  expect(response.status()).toBe(200)
  const html = await response.text()
  expect(html).toContain("Sign in to Binder")
  expect(html).toContain("Send magic link")
})

test("the sign-in form switches between magic link and password", async ({ page }) => {
  await page.goto("/app/auth/login")
  await expect(page.getByRole("heading", { name: "Sign in to Binder" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Send magic link" })).toBeVisible()
  await page.getByRole("button", { name: "Password", exact: true }).click()
  await expect(page.getByRole("button", { name: "Sign in with password" })).toBeVisible()
  await page.getByRole("button", { name: "Create account" }).click()
  await expect(page.getByPlaceholder("Confirm password")).toBeVisible()
})

test("a recovery link without a recovery session explains that the link has expired", async ({ page }) => {
  // The test server has no Supabase session, so the recovery check fails.
  await page.goto("/app/auth/login?mode=recovery")
  await expect(page.getByRole("heading", { name: "Set a new password" })).toBeVisible()
  await expect(page.getByText(/invalid or has expired|Could not reach/)).toBeVisible()
})
