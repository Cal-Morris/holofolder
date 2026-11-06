import { test, expect, type Harness } from "./fixtures"
import type { Locator } from "@playwright/test"

// Installed iPhone app: the page draws under the status bar, so the header has to sit clearly below
// the safe area and every control in it has to be a comfortable 44px tap target.
test.use({ signedIn: true })

const TOP_GAP = 12
const MIN_TARGET = 44

async function visibleButtons(container: Locator) {
  const all = await container.locator("button, input").all()
  const visible: Locator[] = []
  for (const item of all) if (await item.isVisible()) visible.push(item)
  return visible
}

async function expectBelowTopInset(harness: Harness, locator: Locator) {
  const box = await locator.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.y, "control should sit at least 12px below the status bar").toBeGreaterThanOrEqual(harness.insets.top + TOP_GAP - 0.5)
}

test("header controls sit below the status bar and are easy to tap", async ({ harness }, testInfo) => {
  test.skip(!testInfo.project.metadata?.standalone, "installed-app layout only")
  const header = harness.page.getByTestId("app-header")
  await expect(header).toBeVisible()
  const controls = await visibleButtons(header)
  expect(controls.length).toBeGreaterThanOrEqual(4)
  for (const control of controls) {
    await expectBelowTopInset(harness, control)
    const box = (await control.boundingBox())!
    const name = (await control.getAttribute("aria-label")) ?? (await control.innerText())
    const target = /binder (page|spread)|Binder page/.test(name) ? 36 : MIN_TARGET
    expect(Math.round(box.height), `${name} height`).toBeGreaterThanOrEqual(target)
    expect(Math.round(box.width), `${name} width`).toBeGreaterThanOrEqual(target)
    expect(box.x).toBeGreaterThanOrEqual(-0.5)
    expect(box.x + box.width).toBeLessThanOrEqual(harness.viewport.width + 0.5)
    if (await control.isEnabled()) await harness.expectHittable(control)
  }
  // Controls on the same row never overlap, so a tap lands on the control you can see.
  const boxes = (await Promise.all(controls.map((control) => control.boundingBox()))).map((box) => box!)
  for (const [index, a] of boxes.entries()) {
    for (const b of boxes.slice(index + 1)) {
      const sameRow = Math.abs(a.y - b.y) < 8
      const overlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
      if (sameRow) expect(overlap, "header controls should not overlap").toBeLessThanOrEqual(0.5)
    }
  }
  await harness.expectNoHorizontalOverflow()
})

test("dock controls are 44px tall and clear the home indicator", async ({ harness }, testInfo) => {
  test.skip(!testInfo.project.metadata?.standalone, "installed-app layout only")
  const controls = await visibleButtons(harness.dock())
  expect(controls.length).toBeGreaterThanOrEqual(5)
  for (const control of controls) {
    await harness.expectWithinSafeViewport(control)
    expect(Math.round((await control.boundingBox())!.height)).toBeGreaterThanOrEqual(MIN_TARGET)
    await harness.expectHittable(control)
  }
})

test("full-screen panels keep their top controls below the status bar", async ({ harness }, testInfo) => {
  test.skip(!testInfo.project.metadata?.standalone, "installed-app layout only")
  await harness.page.getByRole("button", { name: "More", exact: true }).click()
  await harness.page.getByRole("menuitem", { name: "Settings" }).click()
  const settings = harness.page.getByRole("dialog", { name: /settings/i })
  await expect(settings).toBeVisible()
  await expectBelowTopInset(harness, settings)
  await harness.page.keyboard.press("Escape")
  await expect(settings).toHaveCount(0)
})

test("the More menu holds the extra header actions as full-size rows", async ({ harness }, testInfo) => {
  test.skip(!testInfo.project.metadata?.standalone, "installed-app layout only")
  const header = harness.page.getByTestId("app-header")
  await header.getByRole("button", { name: "More", exact: true }).click()
  const menu = harness.page.getByRole("dialog", { name: "More", exact: true })
  await expect(menu).toBeVisible()
  await harness.expectWithinSafeViewport(menu)
  for (const label of [/^Previous /, /^Settings$/, /mode$/]) {
    const item = menu.getByRole("menuitem", { name: label })
    await expect(item).toBeVisible()
    await harness.expectMinTapTarget(item, MIN_TARGET)
    await harness.expectHittable(item)
  }
  await harness.page.keyboard.press("Escape")
  await expect(menu).toHaveCount(0)
  await header.getByRole("button", { name: "View", exact: true }).click()
  await expect(menu).toHaveCount(0)
  await expect(harness.page.getByRole("button", { name: "Close view options", exact: true })).toBeVisible()
})

test("the show offer is a single slim strip", async ({ harness }, testInfo) => {
  test.skip(!testInfo.project.metadata?.standalone, "installed-app layout only")
  const offer = harness.page.getByRole("region", { name: "At a card show?" })
  await expect(offer).toBeVisible()
  expect((await offer.boundingBox())!.height, "one row").toBeLessThanOrEqual(52)
  await harness.expectMinTapTarget(offer.getByRole("button", { name: "Not now" }), MIN_TARGET)
  await offer.getByRole("button", { name: "Not now" }).click()
  await expect(offer).toHaveCount(0)
  await harness.page.reload()
  await expect(harness.dock()).toBeVisible()
  await expect(harness.page.locator('button[data-dex-id="1"]').first()).toBeVisible()
  await expect(offer, "dismissal is remembered").toHaveCount(0)
})
