import { test, expect } from "@playwright/test"

// The local test server has no Supabase session, so every request here is a signed-out visitor.
test("signed-out / redirects before any binder HTML or JS is sent", async ({ request }) => {
  const response = await request.get("/", { maxRedirects: 0 })
  expect(response.status()).toBe(307)
  expect(new URL(response.headers().location, "http://localhost").pathname).toBe("/home")
  expect(await response.text()).not.toContain("/_next/static/")
})

test("signed-out visitors opening / land on /home without loading the binder page first", async ({ page }) => {
  const documents: string[] = []
  page.on("response", (response) => {
    if (response.request().isNavigationRequest()) documents.push(`${response.status()} ${new URL(response.url()).pathname}`)
  })
  await page.goto("/")
  await expect(page).toHaveURL(/\/home$/)
  await expect(page.locator("h1").first()).toBeVisible()
  expect(documents).toEqual(["307 /", "200 /home"])
})
