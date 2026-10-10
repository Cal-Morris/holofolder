import { test, expect } from "./fixtures"

test.describe("card list requests", () => {
  test.use({ signedIn: true })

  test("loading the binder fetches each visible Pokémon's card list once", async ({ harness }) => {
    const { page } = harness
    // Count inside the document so nothing from the previous page load is mixed in.
    await page.addInitScript(() => {
      const counts: Record<string, number> = {}
      ;(window as unknown as { __cardListRequests: Record<string, number> }).__cardListRequests = counts
      const originalFetch = window.fetch.bind(window)
      window.fetch = (input, init) => {
        const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
        const url = new URL(raw, window.location.href)
        if (url.pathname === "/api/tcgdex-cache") {
          const key = `${url.searchParams.get("pokemonId")}:${url.searchParams.get("language")}`
          counts[key] = (counts[key] ?? 0) + 1
        }
        return originalFetch(input, init)
      }
    })
    // Answer slowly, like a real network, so re-renders happen while requests are still in flight.
    await page.route("**/api/tcgdex-cache**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_500))
      await route.fallback()
    })

    await page.reload()
    await expect(harness.dock()).toBeVisible({ timeout: 30_000 })
    await expect(page.locator("button[data-dex-id=\"1\"]").first()).toBeVisible()
    // Let slot previews, collection refreshes and the offline warm-up settle.
    await page.waitForTimeout(6_000)

    const counts = await page.evaluate(() => (window as unknown as { __cardListRequests: Record<string, number> }).__cardListRequests)
    expect(Object.keys(counts).length, "the binder page should request card lists").toBeGreaterThan(0)
    const duplicates = Object.entries(counts).filter(([, count]) => count > 1)
    expect(duplicates, "no Pokémon card list should be fetched twice").toEqual([])
  })
})
