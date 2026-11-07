import { test, expect, SEEDED_COLLECTION, SUPABASE_URL } from "./fixtures"

test.use({ signedIn: true })

test("starts the whole next page's image preload before waiting for slow responses", async ({ harness }) => {
  const { page } = harness
  // Synthetic next-page cards, with every response held to expose preload waterfalls.
  const rows = Array.from({ length: 16 }, (_, index) => ({ ...SEEDED_COLLECTION[0], pokemon_id: 17 + index, card_id: `synthetic-${index}`, card_image: `https://assets.tcgdex.net/en/mock/next/${index}/high.webp` }))
  await page.route(`${SUPABASE_URL}/rest/v1/pokemon_collection**`, route => route.fulfill({ json: [...SEEDED_COLLECTION, ...rows] }))
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  const started = new Set<string>()
  await page.route("**/app/api/card-image-proxy?**", async route => {
    const url = new URL(route.request().url()).searchParams.get("url") ?? ""
    if (url.includes("/mock/next/")) {
      started.add(url)
      await pending
    }
    await route.fallback()
  })
  await page.goto(harness.path)
  try {
    await expect.poll(() => started.size, { message: "all 16 next-page cards start preloading while responses remain pending" }).toBe(16)
    await page.getByRole("button", { name: "Next binder page", exact: true }).click()
    await expect(page.getByRole("spinbutton", { name: "Binder page number" })).toHaveValue("2")
    await expect(page.locator('button[data-dex-id="17"] img').first()).toHaveAttribute("fetchpriority", "high")
    // A slow image must not hold navigation or hide the rest of the binder controls.
    await harness.expectHittable(page.getByRole("button", { name: "Next binder page", exact: true }))
    await harness.expectNoHorizontalOverflow()
  } finally {
    release()
  }
})
