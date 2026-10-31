/* eslint-disable react-hooks/rules-of-hooks -- Playwright fixtures call `use`, not a React hook. */
import { test as base, expect, type Page } from "@playwright/test"
import { Harness, SAFE_AREA, emulateStandalone, mockBackends } from "./fixtures"

// These tests need the real service worker (the rest of the suite blocks it), so they set up their own
// harness with context-level mocks: page routes don't see requests the worker makes.
const test = base.extend<{ harness: Harness }>({
  serviceWorkers: "allow",
  harness: async ({ page, baseURL }, use, testInfo) => {
    const standalone = Boolean(testInfo.project.metadata?.standalone)
    const insets = standalone ? SAFE_AREA : { top: 0, bottom: 0, left: 0, right: 0 }
    if (standalone) await emulateStandalone(page, insets)
    await mockBackends(page.context(), page.context(), { signedIn: true, baseURL })
    await use(new Harness(page, insets, true))
  },
})

// Chrome DevTools "Slow 3G", plus a 4x slower CPU.
async function emulateSlow3G(page: Page) {
  const session = await page.context().newCDPSession(page)
  await session.send("Network.enable")
  await session.send("Network.emulateNetworkConditions", { offline: false, latency: 2000, downloadThroughput: 50_000, uploadThroughput: 50_000 })
  await session.send("Emulation.setCPUThrottlingRate", { rate: 4 })
  return session
}

/**
 * Go offline for the whole context and, through CDP, for this page too: the page-level CDP sessions used
 * for standalone emulation and throttling can otherwise leave navigator.onLine true after a reload.
 */
async function goOffline(page: Page) {
  await page.context().setOffline(true)
  const session = await page.context().newCDPSession(page)
  await session.send("Network.enable")
  await session.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
}

/** First online visit: wait until the worker controls the page, the offline shell is cached and the collection is saved locally. */
async function visitOnlineAndPrepare(harness: Harness, timeout = 30_000) {
  await harness.open()
  const { page } = harness
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined))
  await expect.poll(() => page.evaluate(async () => Boolean(navigator.serviceWorker.controller) && Boolean(await caches.match("/app-shell"))), { timeout }).toBe(true)
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("pokemon_collection_snapshot_v1")?.includes("base1-44") ?? false), { timeout }).toBe(true)
}

async function expectBinderFromLocalData(harness: Harness) {
  const { page } = harness
  await expect(harness.dock()).toBeVisible({ timeout: 30_000 })
  await expect(page.locator("button[data-dex-id=\"1\"]").first()).toBeVisible()
  await expect(page.getByText(/^Offline · /).first()).toBeVisible()
  const detail = await harness.openCardDetail()
  await detail.locator("summary").filter({ hasText: "Card & variant" }).click()
  // The owned printing comes from the saved collection, not the server.
  await expect(detail.getByText(/base set/i).first()).toBeVisible()
}

test.describe("offline", () => {
  test("reloading offline opens the binder from the cached app shell and saved collection", async ({ harness }) => {
    await visitOnlineAndPrepare(harness)
    await goOffline(harness.page)
    await harness.page.reload()
    await expectBinderFromLocalData(harness)
    await harness.expectNoHorizontalOverflow()
  })

  test("opening the app offline at / or another page also lands in the binder", async ({ harness }) => {
    await visitOnlineAndPrepare(harness)
    await goOffline(harness.page)
    for (const path of ["/", "/home"]) {
      await harness.page.goto(path)
      await expect(harness.dock()).toBeVisible({ timeout: 30_000 })
      await expect(harness.page.locator("button[data-dex-id=\"1\"]").first()).toBeVisible()
    }
  })

  test("card lists fetched online are still there offline after a reload", async ({ harness }) => {
    await visitOnlineAndPrepare(harness)
    // Let the warm-up and slot previews fill the data cache.
    await expect.poll(() => harness.page.evaluate(async () => {
      for (const name of await caches.keys()) {
        if (!name.endsWith("-data")) continue
        const keys = await (await caches.open(name)).keys()
        if (keys.some((request) => request.url.includes("/api/tcgdex-cache?pokemonId=1&"))) return true
      }
      return false
    }), { timeout: 30_000 }).toBe(true)

    await goOffline(harness.page)
    await harness.page.reload()
    const detail = await harness.openCardDetail()
    await detail.getByRole("button", { name: /all bulbasaur cards/i }).click()
    await expect(harness.page.getByRole("list", { name: /cards/i }).getByRole("listitem")).toHaveCount(6)
  })

  test("when the server stalls (dead card-show Wi-Fi) the app opens from the shell instead of hanging", async ({ harness, context }) => {
    await visitOnlineAndPrepare(harness)
    await context.route((url) => url.pathname === "/", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 20_000))
      await route.fallback().catch(() => undefined)
    })
    const started = Date.now()
    await harness.page.goto("/", { waitUntil: "commit" })
    await expect(harness.dock()).toBeVisible({ timeout: 15_000 })
    await expect(harness.page.locator("button[data-dex-id=\"1\"]").first()).toBeVisible()
    expect(Date.now() - started).toBeLessThan(15_000)
  })

  test("after a first visit on slow 3G the app still opens offline", async ({ harness }) => {
    test.slow()
    await emulateSlow3G(harness.page)
    await visitOnlineAndPrepare(harness, 120_000)
    await goOffline(harness.page)
    await harness.page.reload()
    await expectBinderFromLocalData(harness)
  })
})

test.describe("offline, signed out", () => {
  const signedOutTest = base.extend<{ visitor: Page }>({
    serviceWorkers: "allow",
    visitor: async ({ page, baseURL }, use, testInfo) => {
      if (testInfo.project.metadata?.standalone) await emulateStandalone(page, SAFE_AREA)
      await mockBackends(page.context(), page.context(), { signedIn: false, baseURL })
      await use(page)
    },
  })

  signedOutTest("a first visit to /home installs the worker, so /home reloads offline into the shell", async ({ visitor: page }) => {
    await page.goto("/home")
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
    // Registered after load and idle; the shell is stored once its assets and lazy chunks are cached.
    await expect.poll(() => page.evaluate(async () => Boolean(navigator.serviceWorker.controller) && Boolean(await caches.match("/app-shell"))), { timeout: 30_000 }).toBe(true)

    await goOffline(page)
    await page.reload()
    await expect(page.getByText(/^Offline · /).first()).toBeVisible({ timeout: 30_000 })
    await expect(page.locator("button[data-dex-id=\"1\"]").first()).toBeVisible()
    await expect(page.getByRole("heading", { name: /this page couldn.t load/i })).toHaveCount(0)
  })
})
