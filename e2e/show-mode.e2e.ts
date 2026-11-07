import { test, expect, E2E_USER, SUPABASE_URL, type Harness } from "./fixtures"

const SCREENS = process.env.E2E_SCREENSHOT_DIR

async function screenshot(harness: Harness, name: string) {
  if (SCREENS && test.info().project.name.startsWith("standalone-390")) await harness.page.screenshot({ path: `${SCREENS}/quick-${name}.png` })
}

const headerButton = (harness: Harness) => harness.page.getByRole("button", { name: "Show mode", exact: true })
const banner = (harness: Harness) => harness.page.getByRole("region", { name: "Show mode" })
const offer = (harness: Harness) => harness.page.getByRole("region", { name: "At a card show?" })

test.describe("show mode", () => {
  test.use({ signedIn: true })

  test("the header shows the active mode without an extra row, and Exit turns it off", async ({ harness }) => {
    const { page } = harness
    const card = offer(harness)
    await expect(card).toBeVisible()
    await expect(card).toContainText("At a card show?")
    const turnOn = card.getByRole("button", { name: "Turn on Show mode" })
    await harness.expectWithinSafeViewport(turnOn)
    await harness.expectHittable(turnOn)
    await harness.expectMinTapTarget(turnOn, 44)
    await harness.expectNoHorizontalOverflow()
    await screenshot(harness, "show-mode-offer")

    const header = page.getByTestId("app-header")
    const before = (await header.boundingBox())!
    const background = await header.evaluate(el => getComputedStyle(el).backgroundColor)
    await turnOn.click()
    await expect(card).toHaveCount(0)
    const on = banner(harness)
    await expect(on).toContainText("Show mode on")
    expect((await header.boundingBox())!.height).toBe(before.height)
    expect(await header.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe(background)
    await expect(headerButton(harness)).toHaveCount(0)
    for (const name of ["Exit show mode"]) {
      const button = on.getByRole("button", { name, exact: true })
      await harness.expectWithinSafeViewport(button)
      await harness.expectHittable(button)
      await harness.expectMinTapTarget(button, 36)
    }
    await harness.expectNoHorizontalOverflow()
    await screenshot(harness, "show-mode-on")

    // It sticks across reloads, on every main view.
    await page.reload()
    await expect(banner(harness)).toBeVisible()
    await harness.dock().getByRole("button", { name: "Wanted", exact: true }).click()
    await expect(page.getByText("No wanted cards yet")).toBeVisible()
    await expect(banner(harness)).toBeVisible()

    await banner(harness).getByRole("button", { name: "Exit show mode" }).click()
    await expect(banner(harness)).toHaveCount(0)
    await expect(headerButton(harness)).toHaveAttribute("aria-pressed", "false")
    // Used once, the binder stops offering it; the header button is how to turn it back on.
    await harness.dock().getByRole("button", { name: "Binder", exact: true }).click()
    await expect(page.locator('button[data-dex-id="1"]').first()).toBeVisible()
    await expect(offer(harness)).toHaveCount(0)
    await page.reload()
    await expect(page.locator('button[data-dex-id="1"]').first()).toBeVisible()
    await expect(offer(harness)).toHaveCount(0)
    await expect(headerButton(harness)).toBeVisible()
  })

  test("Show mode left on lapses when the app is reopened hours later", async ({ harness }) => {
    const { page } = harness
    const seed = (hoursAgo: number) => page.evaluate((hours) => {
      const at = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
      window.localStorage.setItem("binderdex:show-mode:v1", JSON.stringify({ on: true, since: at, seenAt: at }))
    }, hoursAgo)
    await seed(1)
    await page.reload()
    await expect(banner(harness)).toBeVisible()
    await seed(5)
    await page.reload()
    await expect(page.locator('button[data-dex-id="1"]').first()).toBeVisible()
    await expect(banner(harness)).toHaveCount(0)
    await expect(headerButton(harness)).toHaveAttribute("aria-pressed", "false")
    expect(await page.evaluate(() => window.localStorage.getItem("binderdex:show-mode:v1"))).toContain('"on":false')
  })

  test("the header button is on every main view, and with Show mode on a Search tap opens Quick mode", async ({ harness }) => {
    const { page } = harness
    for (const view of ["Binder", "List", "Wanted", "Browse"]) {
      await harness.dock().getByRole("button", { name: view, exact: true }).click()
      const button = headerButton(harness)
      await harness.expectWithinSafeViewport(button)
      await harness.expectHittable(button)
      await harness.expectMinTapTarget(button, 36)
      await expect(button).toContainText("Show")
      await harness.expectNoHorizontalOverflow()
    }
    await harness.dock().getByRole("button", { name: "Binder", exact: true }).click()
    await headerButton(harness).click()
    await expect(banner(harness)).toBeVisible()

    await harness.dock().getByRole("button", { name: "Search", exact: true }).click()
    const quick = page.getByRole("dialog", { name: "Quick mode" })
    await expect(quick).toBeVisible()
    await expect(page.getByRole("dialog", { name: /search pokemon/i })).toHaveCount(0)
    await page.keyboard.press("Escape")
    await expect(quick).toBeHidden()

    await harness.dock().getByRole("button", { name: "Search", exact: true }).click()
    await expect(quick).toBeVisible()
    // Quick mode lists it too, as a way out.
    await quick.getByRole("searchbox").fill("show")
    await quick.getByRole("button", { name: /^Exit Show mode/ }).click()
    await expect(quick).toBeHidden()
    await expect(banner(harness)).toHaveCount(0)

    // Off again: a Search tap is the normal Search sheet.
    await harness.dock().getByRole("button", { name: "Search", exact: true }).click()
    await expect(page.getByRole("dialog", { name: /search pokemon/i })).toBeVisible()
  })

  test("turn it on from Quick mode and from Settings", async ({ harness }) => {
    const { page } = harness
    await page.keyboard.press("Control+k")
    const quick = page.getByRole("dialog", { name: "Quick mode" })
    await quick.getByRole("searchbox").fill("card show")
    await quick.getByRole("button", { name: /^Show mode/ }).click()
    // Turning it on keeps you in Quick mode, now offering the way out.
    await expect(quick.getByRole("button", { name: /^Exit Show mode/ })).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(banner(harness)).toBeVisible()
    await banner(harness).getByRole("button", { name: "Exit show mode" }).click()

    await page.getByRole("button", { name: "More", exact: true }).click()
    await page.getByRole("menuitem", { name: "Settings" }).click()
    const settings = page.getByRole("dialog", { name: /settings/i })
    await settings.getByRole("button", { name: "Display", exact: true }).click()
    const toggle = settings.getByRole("switch", { name: "Show mode" })
    await expect(toggle).not.toBeChecked()
    await toggle.click()
    await expect(toggle).toBeChecked()
    await page.keyboard.press("Escape")
    await expect(banner(harness)).toBeVisible()
  })

  test("Not now hides the offer for good, offline too", async ({ harness }) => {
    const { page } = harness
    await offer(harness).getByRole("button", { name: "Not now" }).click()
    await expect(offer(harness)).toHaveCount(0)
    await page.reload()
    await expect(page.locator('button[data-dex-id="1"]').first()).toBeVisible()
    await expect(offer(harness)).toHaveCount(0)

    await page.context().setOffline(true)
    await page.waitForTimeout(300)
    await expect(offer(harness)).toHaveCount(0)
    await headerButton(harness).click()
    await expect(banner(harness)).toContainText("Offline")
    await page.context().setOffline(false)
  })

  test("the header's tally fits on a narrow phone, offline too", async ({ harness }) => {
    const { page } = harness
    const boughtAt = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    await page.route(`${SUPABASE_URL}/rest/v1/show_purchases**`, (route) => route.request().method() === "GET"
      ? route.fulfill({ json: [{ owner_user_id: E2E_USER.id, client_id: "p-1", card_id: "sv03.5-006", card_name: "Charizard ex", language: "en", finish: "holo", price: 1234.5, market_price: 1500, currency: "GBP", bought_at: boughtAt, bundle_id: null }] })
      : route.fulfill({ status: 201, body: "" }))
    await page.reload()
    await headerButton(harness).click()
    const on = banner(harness)
    await expect(on).toContainText("1 bought · £1,235")
    await page.context().setOffline(true)
    await expect(on).toContainText("1 bought · £1,235 · Offline")
    const status = on.getByRole("status")
    const clipped = await status.evaluate((element) => element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1)
    expect(clipped, await status.textContent() ?? "").toBe(false)
    for (const name of ["Exit show mode"]) await harness.expectMinTapTarget(on.getByRole("button", { name, exact: true }), 36)
    await harness.expectNoHorizontalOverflow()
    await screenshot(harness, "show-mode-banner-tally")
    await page.context().setOffline(false)
  })
  test("the header Show button still toggles when the device's storage is full", async ({ harness }) => {
    const { page } = harness
    // An installed app's offline caches can fill localStorage; saving the switch then fails.
    await page.evaluate(() => {
      let n = 0
      let size = 256 * 1024
      while (size >= 1) {
        try {
          window.localStorage.setItem(`e2e-fill-${n}`, "x".repeat(size))
          n++
        } catch {
          size = Math.floor(size / 2)
        }
      }
    })
    const button = headerButton(harness)
    await harness.expectHittable(button)
    await button.tap()
    await expect(button).toHaveCount(0)
    await expect(banner(harness)).toContainText("Show mode on")
    await banner(harness).getByRole("button", { name: "Exit show mode" }).click()
    await expect(banner(harness)).toHaveCount(0)
    await expect(button).toHaveAttribute("aria-pressed", "false")
    await page.evaluate(() => {
      for (const key of Object.keys(window.localStorage)) if (key.startsWith("e2e-fill-")) window.localStorage.removeItem(key)
    })
  })
  test("with storage full of other binders' offline copies, Show mode survives a reload", async ({ harness }) => {
    const { page } = harness
    // Other binders' saved copies (they also live in IndexedDB), then filler until nothing more fits.
    const snapshotKeys = await page.evaluate(() => {
      const keys: string[] = []
      for (let n = 0; n < 3; n++) {
        const key = `pokemon_collection_snapshot_v1:e2e-binder-${n}`
        try {
          window.localStorage.setItem(key, JSON.stringify({ savedAt: new Date(Date.UTC(2026, 0, 1 + n)).toISOString(), binderId: `e2e-binder-${n}`, collection: [], pad: "x".repeat(400 * 1024) }))
          keys.push(key)
        } catch {
          break
        }
      }
      let n = 0
      let size = 256 * 1024
      while (size >= 1) {
        try {
          window.localStorage.setItem(`e2e-fill-${n}`, "x".repeat(size))
          n++
        } catch {
          size = Math.floor(size / 2)
        }
      }
      return keys
    })
    expect(snapshotKeys.length).toBeGreaterThan(0)
    const button = headerButton(harness)
    await harness.expectHittable(button)
    await button.tap()
    await expect(button).toHaveCount(0)

    // Saved for real (not just this page view): the oldest binder copy made room.
    const remaining = await page.evaluate((keys) => keys.filter((key) => window.localStorage.getItem(key) !== null), snapshotKeys)
    expect(remaining).not.toContain(snapshotKeys[0])
    await page.reload()
    await expect(headerButton(harness)).toHaveCount(0)
    await expect(banner(harness)).toContainText("Show mode on")

    await page.evaluate(() => {
      for (const key of Object.keys(window.localStorage)) {
        if (key.startsWith("e2e-fill-") || key.startsWith("pokemon_collection_snapshot_v1:e2e-binder-")) window.localStorage.removeItem(key)
      }
    })
  })
})
