/* eslint-disable react-hooks/rules-of-hooks -- Playwright fixtures use `use`. */
import { test as base, expect } from "@playwright/test"
import { Harness, SAFE_AREA, emulateStandalone, mockBackends, SEEDED_COLLECTION, SUPABASE_URL } from "./fixtures"

const test = base.extend<{ harness: Harness }>({
  serviceWorkers: "allow",
  harness: async ({ page, baseURL }, use, info) => {
    const insets = info.project.metadata?.standalone ? SAFE_AREA : { top: 0, bottom: 0, left: 0, right: 0 }
    if (info.project.metadata?.standalone) await emulateStandalone(page, insets)
    await mockBackends(page.context(), page.context(), { signedIn: true, baseURL })
    await use(new Harness(page, insets, true))
  },
})

// Synthetic 65 eligible printings, plus Japanese, jumbo and missing-image examples.
const wanted = Array.from({ length: 64 }, (_, i) => ({ card_id: i === 0 ? "base1-4-stamped" : `synthetic-${i}`, card_name: i === 0 ? "Stamped Bulbasaur" : `Synthetic ${i}`, card_image: `https://assets.tcgdex.net/en/base/base1/${i}/high.webp`, card_set: "Synthetic", card_language: "en", card_finish: i === 0 ? "reverse_holo" : "normal", added_at: "2026-01-01" }))
const rows = [{ ...SEEDED_COLLECTION[0], card_image: "https://assets.tcgdex.net/en/base/base1/44/high.webp", wanted_cards: [
  ...wanted, wanted[0],
  { ...wanted[1], card_language: "ja" },
  { ...wanted[2], card_finish: "jumbo" },
  { ...wanted[3], card_id: "synthetic-missing", card_image: "" },
] }]
const check = (kind: "asking" | "sold") => ({ summary: { kind, currency: "GBP", count: 2, low: 2, median: 3, high: 4 }, checkedAt: "2026-01-01T00:00:00Z", searchUrl: "https://www.ebay.co.uk/sch/i.html?_nkw=synthetic-saved", ...(kind === "sold" ? { sales: [{ amount: 2, title: "Synthetic sold A", soldAt: "2026-01-01" }, { amount: 4, title: "Synthetic sold B", soldAt: "2026-01-02" }] } : { listings: [{ amount: 2, title: "Synthetic asking A" }, { amount: 4, title: "Synthetic asking B" }] }) })
function price(cardId: string, language: string) {
  const quote = { cardId, language, marketGbpAmount: 7, gbpAmount: 7, confidence: "medium", source: "cardmarket", updatedAt: "2026-01-01T00:00:00Z", fxDate: "2026-01-01",
    sourcePrices: [{ source: "cardmarket", label: "Cardmarket", variantLabel: "Reverse Holo", marketGbpAmount: 7, lowGbpAmount: 5, originalMarketAmount: 8, originalLowAmount: 6, originalCurrency: "EUR", updatedAt: "2026-01-01" }, { source: "tcgplayer", label: "TCGplayer", variantLabel: "Reverse Holo", marketGbpAmount: 7, originalMarketAmount: 9, originalCurrency: "USD", updatedAt: "2026-01-01" }],
    trendPoints: [{ label: "7d", source: "cardmarket", gbpAmount: 6, originalAmount: 7, originalCurrency: "EUR" }],
  }
  return { ...quote, finishPrices: ["normal", "reverse_holo"].map(finish => ({ ...quote, finish, variantKey: finish, variantLabel: finish })), historyPoints: [{ date: "2026-01-01", source: "tcgplayer", currency: "USD", amount: 8, lowAmount: 6, finish: "normal", productId: "123" }] }
}
async function openPrep(harness: Harness) {
  const { page } = harness
  const show = page.getByRole("region", { name: "Show mode" })
  if (!await show.isVisible()) await page.getByRole("button", { name: "Show mode", exact: true }).click()
  await harness.dock().getByRole("button", { name: "Search", exact: true }).click()
  await page.getByRole("button", { name: "Prepare offline", exact: true }).click()
  return page.getByRole("region", { name: "Prepare this binder", exact: true })
}

test("binder download reads all saved evidence, retries missing images, then cold boots offline", async ({ harness, context }) => {
  test.setTimeout(120_000)
  const { page } = harness
  let offline = false
  let failImage = true
  let paidRequests = 0
  const checks: string[] = []
  const downloadedPrices: string[] = []
  await context.route(`${SUPABASE_URL}/rest/v1/pokemon_collection**`, route => route.fulfill({ json: rows }))
  await context.route("**/api/card-price-checks?**", route => {
    if (route.request().method() !== "GET") paidRequests++
    const id = new URL(route.request().url()).searchParams.get("cardId")!
    checks.push(id)
    return route.fulfill({ json: { ebay: id === "synthetic-missing" ? null : check("asking"), soldcomps: id === "synthetic-missing" ? null : check("sold"), errors: {} } })
  })
  await context.route("**/api/card-prices**", route => {
    const url = new URL(route.request().url())
    const lookups = route.request().method() === "GET" ? JSON.parse(url.searchParams.get("cards") ?? "[]") : route.request().postDataJSON()?.cards ?? []
    if (route.request().method() === "GET") downloadedPrices.push(...lookups.map((card: { cardId: string }) => card.cardId))
    return route.fulfill({ json: { prices: lookups.filter((card: { cardId: string }) => card.cardId !== "synthetic-missing").map((card: { cardId: string; language: string }) => price(card.cardId, card.language)) } })
  })
  await context.route("**/api/card-image-proxy?**", route => {
    if (failImage && decodeURIComponent(route.request().url()).includes("/63/")) return route.fulfill({ status: 503, body: "Synthetic image failure" })
    return route.fallback()
  })
  // Mock routes can otherwise answer even while Chromium is offline. Block all real network traffic too.
  await context.route("**/*", route => offline ? route.abort("internetdisconnected") : route.fallback())
  await harness.open()
  await expect.poll(() => page.evaluate(async () => Boolean(navigator.serviceWorker.controller) && Boolean(await caches.match("/app-shell"))), { timeout: 30_000 }).toBe(true)
  const prep = await openPrep(harness)
  await expect(prep).toContainText("All 68 owned and wanted printings")
  const download = prep.getByRole("button", { name: "Download binder", exact: true })
  await harness.expectMinTapTarget(download, 36)
  await harness.expectWithinSafeViewport(download)
  await download.click()
  await expect(prep).toContainText("Download finished with missing evidence", { timeout: 30_000 })
  await expect(prep).toContainText("Cards 68/68")
  await expect(prep).toContainText("Images 66/68")
  await expect(prep).toContainText("Asking 65/68 · Sold 65/68")
  expect(new Set(checks).size).toBe(66)
  expect(checks).toContain("base1-44")
  expect(checks).toContain("base1-4-stamped")
  expect(downloadedPrices).toContain("base1-44")
  expect(paidRequests).toBe(0)
  failImage = false
  await prep.getByRole("button", { name: "Resume / retry download" }).click()
  await expect(prep).toContainText("Download finished with missing evidence", { timeout: 30_000 })
  await expect(prep).toContainText("Images 67/68")
  expect(checks.filter(id => id === "base1-44")).toHaveLength(2)
  await harness.expectNoHorizontalOverflow()

  expect(await page.evaluate(async () => {
    const keys = (await Promise.all((await caches.keys()).map(async name => (await (await caches.open(name)).keys()).map(request => request.url)))).flat()
    return keys.filter(url => /\/api\/card-price(?:s|-)checks|\/api\/card-prices/.test(url))
  })).toEqual([])
  const evidence = await page.evaluate(() => new Promise<{ historyPoints: unknown[]; sourcePrices: unknown[]; finishPrices: unknown[] }>((resolve, reject) => {
    const request = indexedDB.open("binderdex-offline", 1)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      const read = db.transaction("records").objectStore("records").get("price-evidence:base1-4-stamped::en")
      read.onsuccess = () => { resolve(read.result); db.close() }
      read.onerror = () => reject(read.error)
    }
  }))
  expect(evidence.historyPoints).toHaveLength(1)
  expect(evidence.sourcePrices).toHaveLength(2)
  expect(evidence.finishPrices).toHaveLength(2)

  // Remove the quick quote cache. Full price evidence must now come from IndexedDB on cold reload.
  await page.evaluate(() => localStorage.removeItem("binderdex_card_price_cache_v7"))
  offline = true
  await context.setOffline(true)
  const cdp = await context.newCDPSession(page)
  await cdp.send("Network.enable")
  await cdp.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  await page.reload()
  await expect(harness.dock()).toBeVisible({ timeout: 30_000 })
  const saved = await openPrep(harness)
  await expect(saved).toContainText("Cards 68/68")
  await expect(saved).toContainText("Images 67/68")
  await expect(saved).toContainText("Asking 65/68 · Sold 65/68")
  await expect(saved).toContainText("Offline. Saved evidence is usable")
  await page.getByRole("button", { name: "Back", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Quick mode" })
  const search = dialog.getByRole("searchbox")
  await search.fill("base1-44")
  await expect(dialog.locator('button[data-standing="owned"]').first()).toBeVisible()
  await search.fill("base1-4-stamped")
  const wantedResult = dialog.locator('button[data-standing="wanted"]').first()
  await expect(wantedResult).toBeVisible()
  await wantedResult.click()
  const detail = dialog.getByTestId("quick-card-check")
  await detail.getByRole("radio", { name: "Reverse", exact: true }).click()
  const sources = detail.getByRole("region", { name: "Catalog price sources" })
  await expect(sources.getByRole("heading")).toContainText("Reverse")
  await expect(sources).toContainText("Cardmarket")
  await expect(sources).toContainText("TCGplayer")
  const comparisons = detail.getByRole("region", { name: "Price comparisons" })
  await expect(comparisons.getByLabel("Sold price history")).toBeVisible()
  await comparisons.locator("summary").filter({ hasText: "Sold records" }).click()
  await expect(comparisons.getByText("Synthetic sold A")).toBeVisible()
  await comparisons.locator("summary").filter({ hasText: "Asking records" }).click()
  await expect(comparisons.getByText("Synthetic asking A")).toBeVisible()
  await expect(comparisons.getByRole("link", { name: /View sold listings/ })).toHaveAttribute("href", /synthetic-saved/)
  expect(paidRequests).toBe(0)
  await harness.expectNoHorizontalOverflow()
})
