import { test, expect, type Harness } from "./fixtures"
import type { Locator, Page } from "@playwright/test"
import { mockCardPrices } from "./price-fixtures"

// On iOS (tab and installed app) and Android the on-screen keyboard only shrinks window.visualViewport;
// fixed bottom chrome stays put underneath it (lib/keyboard-inset.ts). Chromium has no soft keyboard,
// so these tests shorten the visual viewport the way the keyboard does and fire its resize event.
const KEYBOARD = 300

async function setKeyboard(page: Page, height: number) {
  await page.evaluate((covered) => {
    const proto = Object.getPrototypeOf(window.visualViewport!)
    Object.defineProperty(proto, "height", { configurable: true, get: () => window.innerHeight - covered })
    Object.defineProperty(proto, "offsetTop", { configurable: true, get: () => 0 })
    window.visualViewport!.dispatchEvent(new Event("resize"))
  }, height)
}

const html = (page: Page) => page.locator("html")

async function expectAboveKeyboard(harness: Harness, locator: Locator, name: string) {
  const box = (await locator.boundingBox())!
  expect(box, `${name} rendered`).not.toBeNull()
  expect(box.y + box.height, `${name} sits above the keyboard`).toBeLessThanOrEqual(harness.viewport.height - KEYBOARD + 0.5)
  expect(box.y, `${name} stays on screen`).toBeGreaterThanOrEqual(-0.5)
}

test.describe("on-screen keyboard", () => {
  test.use({ signedIn: true })

  test("Show mode search: the search bar rides above the keyboard and settles back when it closes", async ({ harness }) => {
    const { page } = harness
    await page.getByRole("button", { name: "Show mode", exact: true }).click()
    await page.getByRole("region", { name: "Show mode" }).getByRole("button", { name: "Search", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "Quick mode" })
    const search = dialog.getByRole("searchbox")
    await expect(search).toBeVisible()
    const footer = search.locator("xpath=ancestor::div[contains(@class,'border-t')][1]")
    const restingBottom = (await footer.boundingBox())!
    await search.focus()

    await setKeyboard(page, KEYBOARD)
    await expect(html(page)).toHaveAttribute("data-keyboard-open", "")
    expect(await html(page).evaluate((element) => getComputedStyle(element).getPropertyValue("--keyboard-inset").trim())).toBe(`${KEYBOARD}px`)
    await expectAboveKeyboard(harness, search, "Show mode search")
    // The footer's fill runs on behind the keyboard; its content pads to the keyboard's top edge.
    expect(await footer.evaluate((element) => parseFloat(getComputedStyle(element).paddingBottom))).toBeCloseTo(KEYBOARD + 12, 0)
    await search.fill("bulba")
    await expect(search).toBeFocused()

    await setKeyboard(page, 0)
    await expect(html(page)).not.toHaveAttribute("data-keyboard-open")
    const settled = (await footer.boundingBox())!
    expect(Math.abs(settled.y + settled.height - (restingBottom.y + restingBottom.height))).toBeLessThanOrEqual(1)
  })

  test("List search: the dock steps aside while typing and comes back when the field blurs", async ({ harness }) => {
    const { page } = harness
    await harness.dock().getByRole("button", { name: "List", exact: true }).click()
    const search = page.getByPlaceholder("Search name, card, set, or dex #")
    await search.focus()
    await setKeyboard(page, KEYBOARD)
    await expect(html(page)).toHaveAttribute("data-keyboard-open", "")
    await expect(harness.dock()).toBeHidden()
    await expectAboveKeyboard(harness, search, "List search")
    // Content pads to the keyboard's top edge so the last rows can scroll above it.
    const padding = await page.getByTestId("main-content").evaluate((element) => parseFloat(getComputedStyle(element).paddingBottom))
    const isPhone = harness.viewport.width < 640
    if (isPhone) expect(padding).toBeCloseTo(KEYBOARD + 8, 0)

    await search.blur()
    await expect(html(page)).not.toHaveAttribute("data-keyboard-open")
    await expect(harness.dock()).toBeVisible()
    for (const name of ["Search", "Binder", "List", "Wanted", "Sets"]) await harness.expectHittable(harness.dock().getByRole("button", { name, exact: true }))
    await setKeyboard(page, 0)
  })

  test("Show mode deal check: the asking price raises the decimal keyboard and the check rides above it", async ({ harness }) => {
    const { page } = harness
    await mockCardPrices(page, { "sv03.5-006": { market: 10, confidence: "high" } })
    await page.getByRole("button", { name: "Show mode", exact: true }).click()
    await page.getByRole("region", { name: "Show mode" }).getByRole("button", { name: "Search", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "Quick mode" })
    await dialog.getByRole("searchbox").fill("charizard")
    await dialog.getByRole("region", { name: "Cards" }).getByRole("button", { name: /^Charizard ex, 151 / }).first().click()
    const check = dialog.getByTestId("quick-card-check")
    const input = check.getByRole("textbox", { name: "Asking price" })
    const keypad = check.getByRole("group", { name: "Keypad" })
    await expect(input).toBeFocused()
    // The phone's own decimal keyboard, not just the on-screen keypad; big enough text that iOS doesn't zoom.
    await expect(input).toHaveAttribute("inputmode", "decimal")
    expect(await input.evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16)
    await expect(keypad).toBeVisible()

    await setKeyboard(page, KEYBOARD)
    await expect(html(page)).toHaveAttribute("data-keyboard-open", "")
    await expect(harness.dock()).toBeHidden()
    // The keyboard stands in for the keypad, so the keypad steps aside and the field and actions sit on top of it.
    await expect(keypad).toBeHidden()
    await expectAboveKeyboard(harness, input, "Asking price")
    await expectAboveKeyboard(harness, check.getByRole("button", { name: "Bought", exact: true }), "Bought")

    // Typing filters to digits, comma and dot, as before.
    await input.fill("")
    await input.pressSequentially("7x.5£")
    await expect(input).toHaveValue("7.5")
    await expect(check.getByTestId("deal-verdict")).toHaveAttribute("data-verdict", "great")
    await expect(input).toBeFocused()

    // Done closes the keyboard and brings the keypad back.
    await input.press("Enter")
    await expect(input).not.toBeFocused()
    await setKeyboard(page, 0)
    await expect(html(page)).not.toHaveAttribute("data-keyboard-open")
    await expect(keypad).toBeVisible()
    await keypad.getByRole("button", { name: "Delete digit" }).click()
    await expect(input).toHaveValue("7.")
  })

  test("a shorter visual viewport with nothing focused (toolbars, zoom) changes nothing", async ({ harness }) => {
    const { page } = harness
    await setKeyboard(page, KEYBOARD)
    await page.waitForTimeout(100)
    await expect(html(page)).not.toHaveAttribute("data-keyboard-open")
    await expect(harness.dock()).toBeVisible()
  })

  test("a shortcut-bar-sized change while typing (hardware keyboard) keeps the dock", async ({ harness }) => {
    const { page } = harness
    await harness.dock().getByRole("button", { name: "List", exact: true }).click()
    await page.getByPlaceholder("Search name, card, set, or dex #").focus()
    await setKeyboard(page, 70)
    await page.waitForTimeout(100)
    await expect(html(page)).not.toHaveAttribute("data-keyboard-open")
    await expect(harness.dock()).toBeVisible()
  })
})
