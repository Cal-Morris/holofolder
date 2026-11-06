import { test, expect, SUPABASE_URL } from "./fixtures"
import { HUNT_COLLECTION } from "./hunt-fixtures"
import { mockCardPrices } from "./price-fixtures"

// Synthetic 471-card hunt, spread across 157 Pokémon; no real collection writes.
const collection = Array.from({ length: 157 }, (_, i) => ({
  ...HUNT_COLLECTION[0], id: `workspace-${i}`, pokemon_id: i + 1,
  pokemon_name: i === 0 ? "bulbasaur" : `Pokemon ${i + 1}`,
  wanted_cards: Array.from({ length: 3 }, (_, j) => ({
    ...HUNT_COLLECTION[0].wanted_cards[j % 2],
    card_id: `${j === 1 ? "me02" : "sv03.5"}-${1000 + i * 3 + j}`,
    local_id: String(1000 + i * 3 + j),
  })),
}))

for (const theme of ["light", "dark"]) {
  test.describe(`Show workspace ${theme}`, () => {
    test.use({ signedIn: true })
    test("471-card hunt stays usable, with detail only on selection", async ({ harness }, testInfo) => {
      const { page } = harness
      await page.route(`${SUPABASE_URL}/rest/v1/pokemon_collection**`, route =>
        route.request().method() === "GET" ? route.fulfill({ json: collection }) : route.fallback())
      await mockCardPrices(page, Object.fromEntries(collection.flatMap(row => row.wanted_cards.map(card => [card.card_id, { market: 40, confidence: "high" as const }]))))
      await page.reload()
      await page.getByRole("button", { name: "Show mode", exact: true }).click()
      await page.getByRole("region", { name: "Show mode" }).getByRole("button", { name: "Search", exact: true }).click()
      const dialog = page.getByRole("dialog", { name: "Quick mode" })
      const hunt = dialog.getByTestId("show-hunt")
      await expect(hunt.getByRole("heading", { name: /471 cards/ })).toBeVisible()
      await expect(hunt.locator("button[data-standing]")).toHaveCount(471)
      await page.evaluate(theme => document.documentElement.classList.toggle("dark", theme === "dark"), theme)
      const sizes = testInfo.project.name === "browser-390x844" ? [390, 1280, 1440] : [harness.viewport.width]
      for (const width of sizes) {
        await page.setViewportSize({ width, height: width > 1000 ? 900 : harness.viewport.height })
        await harness.expectNoHorizontalOverflow()
        await expect(dialog.getByRole("searchbox")).toBeVisible()
        const prefix = `${process.env.E2E_SCREENSHOT_DIR ?? "/tmp/show-workspace"}/${testInfo.project.name}-${width}-${theme}`
        await page.evaluate(theme => document.documentElement.classList.toggle("dark", theme === "dark"), theme)
        await page.screenshot({ path: `${prefix}.png` })
        const geometry = await hunt.evaluate(el => ({ huntWidth: el.getBoundingClientRect().width, controls: el.querySelector("[data-hunt-controls]")?.getBoundingClientRect().height }))
        console.log(JSON.stringify({ width, theme, project: testInfo.project.name, ...geometry }))
        await expect(dialog.getByTestId("show-detail-pane")).toHaveCount(0)
        if (width > 1000) expect(geometry.huntWidth).toBeGreaterThan(900)
      }
      const first = hunt.locator("button[data-standing]").first()
      await first.click()
      const check = dialog.getByTestId("quick-card-check")
      await expect(check).toBeVisible()
      await harness.expectNoHorizontalOverflow()
      const pane = (await check.boundingBox())!
      for (const control of [check.getByRole("textbox", { name: "Asking price" }), check.getByRole("button", { name: "Bought", exact: true }), check.getByRole("button", { name: "Add to bundle" })]) {
        await harness.expectWithinSafeViewport(control)
        const box = (await control.boundingBox())!
        expect(box.x).toBeGreaterThanOrEqual(pane.x)
        expect(box.x + box.width).toBeLessThanOrEqual(pane.x + pane.width)
      }
      if (page.viewportSize()!.width > 1000) {
        await expect(hunt).toBeVisible()
        await expect(dialog.getByTestId("show-detail-pane")).toBeVisible()
      }
      await page.screenshot({ path: `${process.env.E2E_SCREENSHOT_DIR ?? "/tmp/show-workspace"}/${testInfo.project.name}-${theme}-selected.png` })
      await check.getByRole("button", { name: "Back to results" }).click()
      await expect(hunt).toBeVisible()
      await expect(hunt.locator("button[data-standing]")).toHaveCount(471)
      await page.keyboard.press("Escape")
      await expect(dialog).toBeHidden()
    })
  })
}
