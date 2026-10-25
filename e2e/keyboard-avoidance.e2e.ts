import { test, expect, type Harness } from "./fixtures"
import type { Locator, Page } from "@playwright/test"
import { mockCardPrices } from "./price-fixtures"

// On iOS (tab and installed app) and Android the on-screen keyboard only shrinks window.visualViewport;
// fixed bottom chrome stays put underneath it (lib/keyboard-inset.ts). Chromium has no soft keyboard,
// so these tests shorten the visual viewport the way the keyboard does and fire its resize event.
const KEYBOARD = 300

/** `panned`: iOS also scrolls the visual viewport up by that much to reveal a field low on the page. */
async function setKeyboard(page: Page, height: number, panned = 0) {
  await page.evaluate(([covered, offset]) => {
    const proto = Object.getPrototypeOf(window.visualViewport!)
    Object.defineProperty(proto, "height", { configurable: true, get: () => window.innerHeight - covered })
    Object.defineProperty(proto, "offsetTop", { configurable: true, get: () => offset })
    window.visualViewport!.dispatchEvent(new Event("resize"))
  }, [height, panned] as const)
}

/** While typing a price: verdict pinned right on top of the field, keypad and actions out of the way. */
async function expectTypingLayout(harness: Harness, scope: Locator, input: Locator, pinnedId: string, fullId: string, actions: string[]) {
  const pinned = scope.getByTestId(pinnedId)
  await expect(pinned).toBeVisible()
  await expect(scope.getByTestId(fullId)).toBeHidden()
  await expect(scope.getByRole("group", { name: "Keypad" })).toBeHidden()
  for (const name of actions) await expect(scope.getByRole("button", { name, exact: true })).toBeHidden()
  const pinnedBox = (await pinned.boundingBox())!
  const fieldBox = (await input.locator("xpath=ancestor::label[1]").boundingBox())!
  expect(pinnedBox.y + pinnedBox.height, "verdict sits directly above the asking field").toBeLessThanOrEqual(fieldBox.y + 0.5)
  expect(fieldBox.y - (pinnedBox.y + pinnedBox.height), "with nothing in between").toBeLessThanOrEqual(12)
  expect(pinnedBox.height, "a single compact line").toBeLessThanOrEqual(48)
  await expectAboveKeyboard(harness, pinned, "Pinned verdict")
  await expectAboveKeyboard(harness, input, "Asking price")
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
    // The keyboard stands in for the keypad, and the actions wait for Done: only the verdict, pinned on
    // top of the field, and the field itself sit above the keyboard.
    await expectTypingLayout(harness, check, input, "deal-verdict-pinned", "deal-verdict", ["Bought", "Add owned", "Want", "Add to bundle"])

    // Typing filters to digits, comma and dot, as before, and the pinned verdict follows it.
    await input.fill("")
    await input.pressSequentially("7x.5£")
    await expect(input).toHaveValue("7.5")
    await expect(check.getByTestId("deal-verdict-pinned")).toHaveAttribute("data-verdict", "great")
    await expect(check.getByTestId("deal-verdict-pinned")).toContainText("Great deal")
    await expect(check.getByTestId("deal-verdict-pinned")).toContainText("25% under")
    await expect(input).toBeFocused()

    // Done closes the keyboard and brings the keypad back.
    await input.press("Enter")
    await expect(input).not.toBeFocused()
    await setKeyboard(page, 0)
    await expect(html(page)).not.toHaveAttribute("data-keyboard-open")
    await expect(keypad).toBeVisible()
    await expect(check.getByTestId("deal-verdict")).toBeVisible()
    await expect(check.getByTestId("deal-verdict")).toHaveAttribute("data-verdict", "great")
    await expect(check.getByTestId("deal-verdict-pinned")).toBeHidden()
    for (const name of ["Bought", "Add owned", "Want", "Add to bundle"]) await expect(check.getByRole("button", { name, exact: true })).toBeVisible()
    await keypad.getByRole("button", { name: "Delete digit" }).click()
    await expect(input).toHaveValue("7.")
  })

  test("Show mode deal check: counts as typing when iOS pans the page up by the whole keyboard", async ({ harness }) => {
    // The installed iPhone app: the asking field is at the bottom, so iOS scrolls the visual viewport up
    // by the keyboard's height. Nothing at the layout viewport's bottom is covered, but the keyboard is up.
    const { page } = harness
    await mockCardPrices(page, { "sv03.5-006": { market: 10, confidence: "high" } })
    await page.getByRole("button", { name: "Show mode", exact: true }).click()
    await page.getByRole("region", { name: "Show mode" }).getByRole("button", { name: "Search", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "Quick mode" })
    await dialog.getByRole("searchbox").fill("charizard")
    await dialog.getByRole("region", { name: "Cards" }).getByRole("button", { name: /^Charizard ex, 151 / }).first().click()
    const check = dialog.getByTestId("quick-card-check")
    const input = check.getByRole("textbox", { name: "Asking price" })
    await expect(input).toBeFocused()
    await setKeyboard(page, KEYBOARD, KEYBOARD)
    await expect(html(page)).toHaveAttribute("data-keyboard-open", "")
    expect(await html(page).evaluate((element) => getComputedStyle(element).getPropertyValue("--keyboard-inset").trim())).toBe("0px")
    await expect(check.getByRole("group", { name: "Keypad" })).toBeHidden()
    await expect(check.getByTestId("deal-verdict-pinned")).toBeVisible()
    await expect(check.getByRole("button", { name: "Bought", exact: true })).toBeHidden()
    await input.blur()
    await expect(html(page)).not.toHaveAttribute("data-keyboard-open")
    await expect(check.getByRole("group", { name: "Keypad" })).toBeVisible()
    await setKeyboard(page, 0)
  })

  test("Show mode bundle check: the verdict pins above the bundle price while typing", async ({ harness }) => {
    const { page } = harness
    await mockCardPrices(page, {
      "sv03.5-006": { market: 10, confidence: "high" },
      "sv03.5-007": { market: 4, confidence: "high" },
    })
    await page.getByRole("button", { name: "Show mode", exact: true }).click()
    await page.getByRole("region", { name: "Show mode" }).getByRole("button", { name: "Search", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "Quick mode" })
    for (const [query, name] of [["charizard", /^Charizard ex, 151 /], ["squirtle", /^Squirtle, 151 /]] as const) {
      await dialog.getByRole("searchbox").fill(query)
      await dialog.getByRole("region", { name: "Cards" }).getByRole("button", { name }).first().click()
      const check = dialog.getByTestId("quick-card-check")
      await check.getByRole("button", { name: "Add to bundle" }).click()
      await check.getByRole("button", { name: "Back to results" }).click()
    }
    await dialog.getByRole("button", { name: /^Bundle · 2 cards/ }).click()
    const bundle = dialog.getByTestId("quick-bundle")
    const input = bundle.getByRole("textbox", { name: "Bundle price" })
    await input.focus()
    await setKeyboard(page, KEYBOARD)
    await expect(html(page)).toHaveAttribute("data-keyboard-open", "")
    await input.fill("11")
    await expectTypingLayout(harness, bundle, input, "bundle-verdict-pinned", "bundle-verdict", ["Bought bundle"])
    await expect(bundle.getByTestId("bundle-verdict-pinned")).toHaveAttribute("data-verdict", "great")

    await input.blur()
    await setKeyboard(page, 0)
    await expect(html(page)).not.toHaveAttribute("data-keyboard-open")
    await expect(bundle.getByTestId("bundle-verdict")).toBeVisible()
    await expect(bundle.getByTestId("bundle-verdict-pinned")).toBeHidden()
    await expect(bundle.getByRole("group", { name: "Keypad" })).toBeVisible()
    await expect(bundle.getByRole("button", { name: "Bought bundle" })).toBeVisible()
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
