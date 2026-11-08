import { test, expect, SEEDED_COLLECTION, SUPABASE_URL } from "./fixtures"

test.use({ signedIn: true })

test("prepares the whole next page while keeping the current page visible", async ({ harness }) => {
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
    await expect(page.getByRole("status", { name: "Page loading" })).toContainText("Opening page 2")
    await expect(page.getByRole("spinbutton", { name: "Binder page number" })).toHaveValue("2")
    await expect(page.locator('button[data-dex-id="1"]').first()).toBeVisible()
    await expect(page.locator('button[data-dex-id="17"]')).toHaveCount(0)
    // Controls stay live while the current page remains readable.
    await harness.expectHittable(page.getByRole("button", { name: "Next binder page", exact: true }))
    await harness.expectNoHorizontalOverflow()
    release()
    await expect(page.locator('button[data-dex-id="17"] img').first()).toHaveAttribute("fetchpriority", "high")
    await expect(page.getByRole("status", { name: "Page loading" })).toHaveCount(0)
    expect(await page.locator('button[data-dex-id="17"] img').first().evaluate(img => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0)).toBe(true)
    for (const target of [1, 2]) {
      const control = page.getByRole("button", { name: target === 1 ? "Previous binder page" : "Next binder page", exact: true })
      const readyAtPaint = await control.evaluate(async button => {
        ;(button as HTMLButtonElement).click()
        await new Promise(requestAnimationFrame)
        const images = Array.from(document.querySelectorAll<HTMLImageElement>("button[data-dex-id] img"))
        return images.length > 0 && images.every(img => img.complete && img.naturalWidth > 0)
      })
      expect(readyAtPaint, "return visits must not paint an empty grid").toBe(true)
      await expect(page.locator(`button[data-dex-id="${target === 1 ? 1 : 17}"]`).first()).toBeVisible()
      await expect(page.getByRole("status", { name: "Page loading" })).toHaveCount(0)
    }
  } finally {
    release()
  }
})

for (const action of ["cancel", "skip ahead", "switch tab", "open card"] as const) {
  test(`a pending page change can ${action} without applying a late result`, async ({ harness }) => {
    const { page } = harness
    // Synthetic second-page printings with a held response; page three uses cached mock artwork.
    const rows = Array.from({ length: 16 }, (_, index) => ({ ...SEEDED_COLLECTION[0], pokemon_id: 17 + index, card_id: `synthetic-${index}`, card_image: `https://assets.tcgdex.net/en/mock/pending/${index}/high.webp` }))
    await page.route(`${SUPABASE_URL}/rest/v1/pokemon_collection**`, route => route.fulfill({ json: [...SEEDED_COLLECTION, ...rows] }))
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    let requested = false
    await page.route("**/app/api/card-image-proxy?**", async route => {
      if ((new URL(route.request().url()).searchParams.get("url") ?? "").includes("/mock/pending/")) {
        requested = true
        await pending
      }
      await route.fallback()
    })
    await page.goto(harness.path)
    try {
      await expect.poll(() => requested).toBe(true)
      await page.getByRole("button", { name: "Next binder page", exact: true }).click()
      const status = page.getByRole("status", { name: "Page loading" })
      await expect(status).toContainText("Opening page 2")
      if (action === "cancel") {
        const cancel = status.getByRole("button", { name: "Cancel page change" })
        await harness.expectMinTapTarget(cancel, 36)
        await harness.expectHittable(cancel)
        await harness.expectWithinSafeViewport(cancel)
        await cancel.click()
      } else if (action === "skip ahead") {
        await page.getByRole("button", { name: "Next binder page", exact: true }).click()
        await expect(page.locator('button[data-dex-id="33"]').first()).toBeVisible()
      } else if (action === "open card") {
        await harness.openCardDetail()
      } else {
        await harness.dock().getByRole("button", { name: "List", exact: true }).click()
        await expect(page.getByRole("heading", { name: "List", exact: true })).toBeVisible()
      }
      await expect(status).toHaveCount(0)
      release()
      await page.evaluate(() => new Promise<void>(resolve => setTimeout(resolve, 0)))
      if (action === "skip ahead") {
        await expect(page.getByRole("spinbutton", { name: "Binder page number" })).toHaveValue("3")
        await expect(page.locator('button[data-dex-id="33"]').first()).toBeVisible()
      } else if (action === "cancel") {
        await expect(page.getByRole("spinbutton", { name: "Binder page number" })).toHaveValue("1")
        await expect(page.locator('button[data-dex-id="1"]').first()).toBeVisible()
      } else if (action === "open card") {
        await expect(page.getByRole("dialog", { name: /bulbasaur details/i })).toBeVisible()
        await expect(page.getByRole("spinbutton", { name: "Binder page number" })).toHaveValue("1")
      } else {
        await harness.dock().getByRole("button", { name: "Binder", exact: true }).click()
        await expect(page.getByRole("spinbutton", { name: "Binder page number" })).toHaveValue("1")
      }
    } finally {
      release()
    }
  })
}
