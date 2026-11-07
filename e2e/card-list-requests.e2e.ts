import { test, expect } from "./fixtures"

test.describe("card list requests", () => {
  test.use({ signedIn: true })

  test("loading missing binder slots does not fetch arbitrary card lists", async ({ harness }) => {
    const { page } = harness
    // Count inside the document so nothing from the previous page load is mixed in.
    await page.addInitScript(() => {
      const counts: Record<string, number> = {}
      ;(window as unknown as { __cardListRequests: Record<string, number> }).__cardListRequests = counts
      const originalFetch = window.fetch.bind(window)
      window.fetch = (input, init) => {
        const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
        const url = new URL(raw, window.location.href)
        if (url.pathname === "/app/api/tcgdex-cache") {
          const key = `${url.searchParams.get("pokemonId")}:${url.searchParams.get("language")}`
          counts[key] = (counts[key] ?? 0) + 1
        }
        return originalFetch(input, init)
      }
    })
    // Answer slowly, like a real network, so re-renders happen while requests are still in flight.
    await page.route("**/app/api/tcgdex-cache**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_500))
      await route.fallback()
    })

    await page.reload()
    await expect(harness.dock()).toBeVisible({ timeout: 30_000 })
    await expect(page.locator("button[data-dex-id=\"1\"]").first()).toBeVisible()
    // Let adjacent image prefetch, collection refreshes and offline warm-up settle.
    await page.waitForTimeout(6_000)

    const counts = await page.evaluate(() => (window as unknown as { __cardListRequests: Record<string, number> }).__cardListRequests)
    expect(counts, "missing slots use Pokémon artwork without loading candidate printings").toEqual({})
  })
})
