import { test, expect, Harness, mockBackends, emulateStandalone } from "./fixtures"
import { mockCardPrices } from "./price-fixtures"
import { syntheticSlotPickerSnapshot } from "../tests/fixtures/slot-picker"

// Synthetic slots, copies and prices only (tests/fixtures/slot-picker.ts, e2e/price-fixtures.ts).
test.describe("pocket detail loading", () => {
  test.use({ signedIn: true, harness: async ({ page, context, standalone, insets, baseURL }, provide) => {
    if (standalone) await emulateStandalone(page, insets)
    await mockBackends(page, context, { signedIn: true, baseURL })
    await provide(new Harness(page, insets, true))
  } })

  test("a slow saved price fills its reserved space without shifting the pocket detail", async ({ harness }) => {
    const { page } = harness
    await mockCardPrices(page, { "synthetic-snorlax-a": { confidence: "high", market: 4, finishes: [{ finish: "normal", market: 4 }] } })
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    // Registered last, so it runs first: hold the saved-price read until the sheet has painted.
    await page.route("**/app/api/card-prices**", async route => { await held; await route.fallback() })
    await page.route("**/app/api/tcgdex-cache**", route => route.fulfill({ json: { cards: syntheticSlotPickerSnapshot().cards.filter(c => c.dexIds?.includes(143)).map(({ dexIds: _d, ...c }) => c), source: "mirror" } }))
    await page.goto("/app/e2e-harness?signedIn=1&slots=picker&rows=2&cols=4")
    if (page.viewportSize()!.width >= 1024) await expect(page.getByRole("region", { name: "Inside cover", exact: true })).toBeVisible()

    await page.locator('button[data-slot-id="slot-a"]').click()
    const dialog = page.getByRole("dialog", { name: /details$/ })
    const heading = dialog.getByRole("heading", { name: "Snorlax A", exact: true })
    const prices = dialog.getByRole("region", { name: "Prices" })
    await expect(prices).toHaveAttribute("aria-busy", "true")
    await page.evaluate(() => new Promise(requestAnimationFrame))
    const before = { heading: await heading.boundingBox(), dialog: await dialog.boundingBox() }
    await page.evaluate(() => {
      const w = window as unknown as { __shift: number }
      w.__shift = 0
      new PerformanceObserver(list => { for (const entry of list.getEntries()) w.__shift += (entry as unknown as { value: number }).value })
        .observe({ type: "layout-shift" })
    })

    release()
    await expect(prices).toContainText(/Market\s*£4/)
    await expect(prices).not.toHaveAttribute("aria-busy", "true")
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const after = { heading: await heading.boundingBox(), dialog: await dialog.boundingBox() }
    const shift = await page.evaluate(() => (window as unknown as { __shift: number }).__shift)
    test.info().annotations.push({ type: "layout-shift", description: `cls=${shift.toFixed(4)} headingDy=${(after.heading!.y - before.heading!.y).toFixed(1)} dialogDh=${(after.dialog!.height - before.dialog!.height).toFixed(1)}` })
    console.log(`[${test.info().project.name}] cls=${shift.toFixed(4)} headingDy=${(after.heading!.y - before.heading!.y).toFixed(1)} dialogDh=${(after.dialog!.height - before.dialog!.height).toFixed(1)}`)
    expect(Math.abs(after.heading!.y - before.heading!.y)).toBeLessThan(1)
    expect(Math.abs(after.dialog!.height - before.dialog!.height)).toBeLessThan(1)
    expect(shift).toBeLessThan(0.001)
  })
})
