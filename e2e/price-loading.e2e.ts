import { test, expect, Harness, emulateStandalone, mockBackends } from "./fixtures"
import { mockCardPrices } from "./price-fixtures"

// Synthetic catalogue quotes, not real market data.
function quote(cardId: string, market = 8, fetchedAt = Date.now()) {
  return { cardId, language: "en", gbpAmount: market, marketGbpAmount: market, confidence: "medium",
    source: "cardmarket", sourcePrices: [], trendPoints: [], historyPoints: [], finishPrices: [], fetchedAt }
}

test.use({ signedIn: true, locale: "en-GB" })
test.beforeEach(async ({ page, standalone, insets, baseURL }) => {
  if (standalone) await emulateStandalone(page, insets)
  await mockBackends(page, page.context(), { signedIn: true, baseURL })
  // Seed storage before mounting the app, without racing its first price request.
  await page.route("**/price-test-setup", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Price test setup</title>" }))
  await page.goto("/price-test-setup")
  await mockCardPrices(page, { "base1-44": { confidence: "medium", market: 8 }, "base1-46": { confidence: "medium", market: 9 } })
})

test("a failed stale batch keeps the successful missing-card batch", async ({ page, insets }) => {
  await page.evaluate(snapshot => localStorage.setItem("binderdex_card_price_cache_v7", JSON.stringify({ "base1-46::en": snapshot })), quote("base1-46", 9, Date.now() - 3 * 60 * 60 * 1000))
  await page.route("**/api/card-prices**", route => route.request().postDataJSON().force
    ? route.fulfill({ status: 503, json: { error: "Synthetic batch failure" } })
    : route.fallback())
  const harness = new Harness(page, insets, true)
  await harness.open()
  const detail = await harness.openCardDetail()
  await expect(detail.getByText("Market", { exact: true }).locator("..")).toContainText("£8.00")
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("binderdex_card_price_cache_v7") ?? "{}")["base1-44::en"]?.marketGbpAmount)).toBe(8)
})

test("an offline price lookup retries when the connection returns", async ({ page, insets }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false }))
  let requests = 0
  await page.route("**/api/card-prices**", route => { requests++; return route.fallback() })
  const harness = new Harness(page, insets, true)
  await harness.open()
  const detail = await harness.openCardDetail()
  await expect(detail.getByText("Market", { exact: true }).locator("..")).toContainText("No price")
  expect(requests).toBe(0)
  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true })
    window.dispatchEvent(new Event("online"))
  })
  await expect(detail.getByText("Market", { exact: true }).locator("..")).toContainText("£8.00")
})

for (const legacy of [false, true]) {
  test(legacy ? "legacy IndexedDB prices refresh missing history" : "fresh IndexedDB-only prices display without another catalogue request", async ({ page, insets }) => {
    await page.evaluate(snapshots => new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("binderdex-offline", 1)
      open.onupgradeneeded = () => open.result.createObjectStore("records")
      open.onerror = () => reject(open.error)
      open.onsuccess = () => {
        const db = open.result
        const transaction = db.transaction("records", "readwrite")
        for (const snapshot of snapshots) transaction.objectStore("records").put(snapshot, `price-evidence:${snapshot.cardId}::en`)
        transaction.oncomplete = () => { db.close(); resolve() }
        transaction.onerror = () => reject(transaction.error)
      }
    }), [
      { ...quote("base1-44", legacy ? 3 : 8), ...(legacy ? { historyPoints: undefined } : {}) },
      quote("base1-46", 9),
    ])
    let requests = 0
    await page.route("**/api/card-prices**", route => { requests++; return route.fallback() })
    const harness = new Harness(page, insets, true)
    await harness.open()
    const detail = await harness.openCardDetail()
    await expect(detail.getByText("Market", { exact: true }).locator("..")).toContainText("£8.00")
    expect(requests).toBe(legacy ? 1 : 0)
    await harness.expectNoHorizontalOverflow()
  })
}
