import { test, expect, emulateStandalone, type Harness } from "./fixtures"
import type { Page } from "@playwright/test"

// iOS 26 installed apps can get a web view that is short at the bottom by the status-bar height
// (lib/ios-viewport-gap.ts). Then the dock drops its duplicate home-indicator padding and sits near
// the bottom of the tappable view; everywhere else (browser tabs, a full-height installed app, a view
// below an opaque status bar) the dock keeps clear of the home indicator exactly as before.

async function fakeScreen(page: Page, width: number, height: number) {
  await page.addInitScript(([w, h]) => {
    Object.defineProperty(window.screen, "width", { get: () => w, configurable: true })
    Object.defineProperty(window.screen, "height", { get: () => h, configurable: true })
  }, [width, height])
}

async function setInsets(page: Page, top: number, bottom: number) {
  const session = await page.context().newCDPSession(page)
  await session.send("Emulation.setSafeAreaInsetsOverride" as never, { insets: { top, bottom, left: 0, right: 0 } } as never).catch(() => undefined)
}

async function dockBar(harness: Harness) {
  const bar = harness.dock().locator(":scope > div").first()
  await expect(bar).toBeVisible()
  return (await bar.boundingBox())!
}

async function reloadAt(harness: Harness, width: number, height: number) {
  await harness.page.setViewportSize({ width, height })
  await harness.page.reload()
  await expect(harness.page.locator('button[data-dex-id="1"]').first()).toBeVisible()
  await harness.page.waitForTimeout(150)
}

test.describe("installed app", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(!testInfo.project.metadata?.standalone || !testInfo.project.name.includes("390"), "one installed-app run")
  })

  test("a short iOS 26 view: the dock drops the duplicate padding and stays inside the view", async ({ harness }) => {
    // 393x852 phone, 59px status bar: the view is 852 - 59 = 793 tall.
    await fakeScreen(harness.page, 393, 852)
    await reloadAt(harness, 393, 793)
    await expect(harness.page.locator("html")).toHaveAttribute("data-ios-viewport-gap", "59")
    const bar = await dockBar(harness)
    expect(bar.y + bar.height, "dock sits near the bottom of the view").toBeGreaterThanOrEqual(793 - 12)
    expect(bar.y + bar.height, "dock stays inside the tappable view").toBeLessThanOrEqual(793 + 0.5)
    for (const name of ["Search", "Binder", "List", "Wanted", "Sets"]) await harness.expectHittable(harness.dock().getByRole("button", { name, exact: true }))
    await harness.expectNoHorizontalOverflow()
  })

  test("a full-height view keeps the dock clear of the home indicator", async ({ harness }) => {
    await fakeScreen(harness.page, 393, 852)
    await reloadAt(harness, 393, 852)
    await expect(harness.page.locator("html")).toHaveAttribute("data-ios-viewport-gap", "0")
    const bar = await dockBar(harness)
    expect(bar.y + bar.height).toBeLessThanOrEqual(852 - harness.insets.bottom + 0.5)
    expect(bar.y + bar.height).toBeGreaterThanOrEqual(852 - harness.insets.bottom - 12)
  })

  test("a view below an opaque status bar (no top inset) keeps the home-indicator padding", async ({ harness }) => {
    await fakeScreen(harness.page, 393, 852)
    await setInsets(harness.page, 0, 34)
    await reloadAt(harness, 393, 793)
    await expect(harness.page.locator("html")).toHaveAttribute("data-ios-viewport-gap", "0")
    const bar = await dockBar(harness)
    expect(bar.y + bar.height).toBeLessThanOrEqual(793 - 34 + 0.5)
  })
})

test.describe("browser tab", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(Boolean(testInfo.project.metadata?.standalone) || !testInfo.project.name.includes("390"), "one browser-tab run")
  })

  test("toolbars make the view shorter than the screen, and nothing changes", async ({ harness }) => {
    await fakeScreen(harness.page, 393, 852)
    await setInsets(harness.page, 59, 34)
    await reloadAt(harness, 393, 793)
    await expect(harness.page.locator("html")).toHaveAttribute("data-ios-viewport-gap", "0")
    const bar = await dockBar(harness)
    expect(bar.y + bar.height).toBeLessThanOrEqual(793 - 34 + 0.5)
  })

  test("standalone emulation is what switches it on", async ({ page, harness }) => {
    await emulateStandalone(page, { top: 59, bottom: 34, left: 0, right: 0 })
    await fakeScreen(page, 393, 852)
    await reloadAt(harness, 393, 793)
    await expect(page.locator("html")).toHaveAttribute("data-ios-viewport-gap", "59")
  })
})
