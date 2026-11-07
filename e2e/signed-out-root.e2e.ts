import { test, expect } from "@playwright/test"

// The local test server has no Supabase session, so every request here is a signed-out visitor.
test("signed-out / redirects before any binder HTML or JS is sent", async ({ request }) => {
  const response = await request.get("/app", { maxRedirects: 0 })
  expect(response.status()).toBe(307)
  expect(new URL(response.headers().location, "http://localhost").pathname).toBe("/app/auth/login")
  expect(await response.text()).not.toContain("/app/_next/static/")
})

test("signed-out visitors opening / land on /app/auth/login without loading the binder page first", async ({ page }) => {
  const documents: string[] = []
  page.on("response", (response) => {
    if (response.request().isNavigationRequest()) documents.push(`${response.status()} ${new URL(response.url()).pathname}`)
  })
  await page.goto("/app")
  await expect(page).toHaveURL(/\/app\/auth\/login$/)
  await expect(page.locator("h1").first()).toBeVisible()
  expect(documents).toEqual(["307 /app", "200 /app/auth/login"])
})

test("PWA entry and resources are served inside the Framer app boundary", async ({ request }) => {
  const response = await request.get("/app/manifest.webmanifest")
  expect(response.status()).toBe(200)
  const manifest = await response.json()
  expect(manifest.start_url).toBe("/app")
  expect(manifest.scope).toBe("/app")
  for (const icon of manifest.icons) {
    expect(icon.src).toMatch(/^\/app\//)
    expect((await request.get(icon.src)).status()).toBe(200)
  }
  const worker = await request.get("/app/sw.js")
  expect(worker.status()).toBe(200)
  expect(worker.headers()["service-worker-allowed"]).toBe("/")
  const callback = await request.get("/app/auth/callback", { maxRedirects: 0 })
  expect(new URL(callback.headers().location, "http://localhost").pathname).toBe("/app/auth/error")
})
