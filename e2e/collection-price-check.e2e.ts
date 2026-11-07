import { test, expect, SEEDED_COLLECTION, SUPABASE_URL } from "./fixtures"

test.use({ signedIn: true })

test("wanted batch counts all 65, confirms, reuses fresh checks and disables offline", async ({ harness }) => {
  const { page } = harness
  // Synthetic printings and checks only. Every metered request is intercepted.
  const wanted = Array.from({ length: 65 }, (_, i) => ({ card_id: `synthetic-${i}`, card_name: `Synthetic ${i}`, card_language: "en", card_finish: "normal", added_at: "2026-01-01T00:00:00Z" }))
  await page.route(`${SUPABASE_URL}/rest/v1/pokemon_collection**`, route => route.fulfill({ json: [{ ...SEEDED_COLLECTION[0], wanted_cards: [...wanted, wanted[0]] }] }))
  let calls = 0
  let marketRefreshes = 0
  await page.route("**/app/api/card-prices/refresh**", route => { marketRefreshes++; return route.abort() })
  await page.route("**/app/api/card-price-checks?**", route => {
    calls++
    const source = new URL(route.request().url()).searchParams.get("source")!
    return route.fulfill({ json: { [source]: { summary: { kind: source === "ebay" ? "asking" : "sold", currency: "GBP", count: 1, low: 2, median: 2, high: 2 }, checkedAt: new Date().toISOString() }, errors: {} } })
  })
  await page.reload()
  await harness.dock().getByRole("button", { name: "Wanted", exact: true }).click()
  const batch = page.getByTestId("collection-price-check")
  await expect(batch).toContainText("65 eligible printings in this binder")
  expect(calls).toBe(0)
  const start = batch.getByRole("button", { name: "Check wanted prices" })
  await harness.expectMinTapTarget(start, 36)
  await start.click()
  const dialog = page.getByRole("dialog", { name: /65 cards need/ })
  await expect(dialog).toBeVisible()
  expect(calls).toBe(0)
  await harness.expectWithinSafeViewport(dialog)
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(batch).toContainText("Price check cancelled")
  expect(calls).toBe(0)
  await start.click()
  await dialog.getByRole("button", { name: "Check now" }).click()
  await expect(batch).toContainText("65 checked, 0 already fresh, 0 incomplete", { timeout: 30_000 })
  expect(calls).toBe(130)
  await start.click()
  await expect(batch).toContainText("0 checked, 65 already fresh, 0 incomplete")
  expect(calls).toBe(130)
  expect(marketRefreshes).toBe(0)
  await page.evaluate(() => window.dispatchEvent(new Event("offline")))
  await expect(start).toBeDisabled()
  await expect(batch).toContainText("Connect to check prices")
  await harness.expectNoHorizontalOverflow()
})

test("owned batch stops in flight", async ({ harness }) => {
  const { page } = harness
  let calls = 0
  let release: () => void = () => {}
  const waiting = new Promise<void>(resolve => { release = resolve })
  await page.route("**/app/api/card-price-checks?**", async route => {
    calls++
    await waiting
    await route.abort().catch(() => {})
  })
  await harness.dock().getByRole("button", { name: "List", exact: true }).click()
  const batch = page.getByTestId("collection-price-check")
  await expect(batch).toContainText("2 eligible printings")
  expect(calls).toBe(0)
  await batch.getByRole("button", { name: "Check owned prices" }).click()
  await expect.poll(() => calls).toBe(2)
  await batch.getByRole("button", { name: "Stop checking prices" }).click()
  release()
  await expect(batch).toContainText("Stopped")
  expect(calls).toBe(2)
  await harness.expectNoHorizontalOverflow()
})
