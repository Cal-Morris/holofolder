/* eslint-disable react-hooks/rules-of-hooks -- Playwright fixtures call `use`, not a React hook. */
import { test as base, expect, type Page, type TestInfo } from "@playwright/test"
import { Harness, SAFE_AREA, SEEDED_COLLECTION, SUPABASE_URL, emulateStandalone, mockBackends } from "./fixtures"

// Offline binders need the real service worker (the rest of the suite blocks it), so mocks are context-level.
const MY_BINDER = "e2e00000-0000-4000-8000-000000000001"
const TRADES = "e2e00000-0000-4000-8000-000000000002"

const test = base.extend<{ harness: Harness }>({
  serviceWorkers: "allow",
  harness: async ({ page, baseURL }, use, testInfo) => {
    const standalone = Boolean(testInfo.project.metadata?.standalone)
    const insets = standalone ? SAFE_AREA : { top: 0, bottom: 0, left: 0, right: 0 }
    if (standalone) await emulateStandalone(page, insets)
    await mockBackends(page.context(), page.context(), { signedIn: true, baseURL })
    // Per-binder rows: "Trades" holds only Charmander, "Spare" is empty.
    await page.context().route(`${SUPABASE_URL}/rest/v1/pokemon_collection**`, (route) => {
      const binder = new URL(route.request().url()).searchParams.get("binder_id")
      if (binder === `eq.${TRADES}`) return route.fulfill({ json: SEEDED_COLLECTION.filter((row) => row.pokemon_id === 4) })
      if (binder && binder !== `eq.${MY_BINDER}`) return route.fulfill({ json: [] })
      return route.fulfill({ json: SEEDED_COLLECTION })
    })
    await page.context().route("**/api/binders**", (route) => route.fulfill({ status: 503, json: { error: "offline test" } }))
    await use(new Harness(page, insets, true))
  },
})

async function snap(page: Page, testInfo: TestInfo, name: string) {
  const dir = process.env.BINDERS_SCREENS_DIR
  if (!dir || !testInfo.project.name.startsWith("browser-375")) return
  await page.screenshot({ path: `${dir}/binders-offline-${name}.png` })
}

async function goOffline(page: Page) {
  await page.context().setOffline(true)
  const session = await page.context().newCDPSession(page)
  await session.send("Network.enable")
  await session.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
}

const slot = (page: Page, dexId: number) => page.locator(`button[data-dex-id="${dexId}"]`).first()

async function openBinder(harness: Harness, binderId?: string) {
  const { page } = harness
  await page.goto(`/e2e-harness?signedIn=1&binders=3${binderId ? `&binder=${binderId}` : ""}`)
  await expect(harness.dock()).toBeVisible({ timeout: 30_000 })
  await expect(slot(page, 1)).toBeVisible()
}

/** Visit "Trades" then "My binder" online, so both are saved on this device and the offline shell is cached. */
async function prepareOnline(harness: Harness) {
  const { page } = harness
  await openBinder(harness, TRADES)
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined))
  await expect.poll(() => page.evaluate(async () => Boolean(navigator.serviceWorker.controller) && Boolean(await caches.match("/app-shell"))), { timeout: 30_000 }).toBe(true)
  await expect.poll(() => page.evaluate((id) => window.localStorage.getItem(`pokemon_collection_snapshot_v1:${id}`)?.includes("base1-46") ?? false, TRADES), { timeout: 30_000 }).toBe(true)
  await openBinder(harness)
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("pokemon_collection_snapshot_v1")?.includes("base1-44") ?? false), { timeout: 30_000 }).toBe(true)
  // Each binder kept its own copy: "Trades" still holds only Charmander.
  const trades = await page.evaluate((id) => JSON.parse(window.localStorage.getItem(`pokemon_collection_snapshot_v1:${id}`) ?? "null"), TRADES)
  expect(trades.collection.map((row: { pokemon_id: number }) => row.pokemon_id)).toEqual([4])
  expect(await page.evaluate(() => JSON.parse(window.localStorage.getItem("binderdex_device_binders_v1") ?? "null")?.binders?.length)).toBe(3)
}

test.describe("multiple binders offline", () => {
  test("offline, binders opened before still switch; the others are disabled with a notice", async ({ harness }, testInfo) => {
    test.slow()
    const { page } = harness
    await prepareOnline(harness)
    await goOffline(page)
    await page.reload()
    await expect(harness.dock()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId("binder-switcher-trigger")).toHaveAttribute("aria-label", "Binders: My binder")

    await page.getByTestId("binder-switcher-trigger").click()
    const sheet = page.getByRole("dialog", { name: "Binders" })
    await expect(sheet).toBeVisible()
    await expect(sheet.getByText("Binders saved on this device still open", { exact: false })).toBeVisible()
    await expect(sheet.getByRole("button", { name: /^Spare/ })).toBeDisabled()
    await expect(sheet.getByRole("button", { name: /^Spare/ })).toContainText("Needs a connection")
    const trades = sheet.getByRole("button", { name: /^Trades/ })
    await expect(trades).toBeEnabled()
    await expect(trades).toContainText("Saved on this device")
    await harness.expectHittable(trades)
    await snap(page, testInfo, "switcher")

    await trades.click()
    await expect(page).toHaveURL(new RegExp(`binder=${TRADES}`))
    await expect(page.getByTestId("binder-switcher-trigger")).toHaveAttribute("aria-label", "Binders: Trades", { timeout: 30_000 })
    await expect(slot(page, 4)).toBeVisible()
    await expect(slot(page, 4)).toContainText("Owned")
    await expect(slot(page, 1)).not.toContainText("Owned")
    await snap(page, testInfo, "trades")
  })

  test("reloading a non-default binder offline opens its own saved copy; an unsaved one falls back with a notice", async ({ harness }) => {
    test.slow()
    const { page } = harness
    await prepareOnline(harness)
    await openBinder(harness, TRADES)
    await goOffline(page)
    await page.reload()
    await expect(harness.dock()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId("binder-switcher-trigger")).toHaveAttribute("aria-label", "Binders: Trades")
    await expect(slot(page, 4)).toContainText("Owned")
    await expect(slot(page, 1)).not.toContainText("Owned")
    // The default binder's offline copy is untouched by the other binder.
    const main = await page.evaluate(() => JSON.parse(window.localStorage.getItem("pokemon_collection_snapshot_v1") ?? "null"))
    expect(main.collection.map((row: { pokemon_id: number }) => row.pokemon_id).sort()).toEqual([1, 4])

    await page.goto(`/e2e-harness?signedIn=1&binders=3&binder=e2e00000-0000-4000-8000-000000000004`)
    await expect(harness.dock()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole("status").filter({ hasText: "“Spare” isn't saved on this device yet" })).toBeVisible()
    await expect(page.getByTestId("binder-switcher-trigger")).toHaveAttribute("aria-label", /Binders: (Trades|My binder)/)
  })
})
