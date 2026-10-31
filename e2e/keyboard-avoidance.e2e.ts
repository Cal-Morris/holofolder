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

/** While typing a price: verdict pinned right on top of the field, actions out of the way. */
async function expectTypingLayout(harness: Harness, scope: Locator, input: Locator, pinnedId: string, fullId: string, actions: string[]) {
  const pinned = scope.getByTestId(pinnedId)
  await expect(pinned).toBeVisible()
  await expect(scope.getByTestId(fullId)).toBeHidden()
  await expect(scope.getByRole("group", { name: "Keypad" })).toHaveCount(0)
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
    // The dialog itself now ends at the keyboard's top edge, so the footer adds no keyboard padding.
    expect(await footer.evaluate((element) => parseFloat(getComputedStyle(element).paddingBottom))).toBeCloseTo(12, 0)
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
    await expect(input).toBeFocused()
    // The phone's own decimal keyboard, not just custom buttons; big enough text that iOS doesn't zoom.
    await expect(input).toHaveAttribute("inputmode", "decimal")
    expect(await input.evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16)
    await expect(check.getByRole("group", { name: "Keypad" })).toHaveCount(0)

    await setKeyboard(page, KEYBOARD)
    await expect(html(page)).toHaveAttribute("data-keyboard-open", "")
    await expect(harness.dock()).toBeHidden()
    // The native keyboard handles entry; actions wait for Done.
    await expectTypingLayout(harness, check, input, "deal-verdict-pinned", "deal-verdict", ["Bought", "Add owned", "Want", "Add to bundle"])

    // Typing filters to digits, comma and dot, as before, and the pinned verdict follows it.
    await input.fill("")
    await input.pressSequentially("7x.5£")
    await expect(input).toHaveValue("7.5")
    await expect(check.getByTestId("deal-verdict-pinned")).toHaveAttribute("data-verdict", "great")
    await expect(check.getByTestId("deal-verdict-pinned")).toContainText("Great deal")
    await expect(check.getByTestId("deal-verdict-pinned")).toContainText("25% under")
    await expect(input).toBeFocused()

    // Done closes the keyboard and restores the actions.
    const done = check.getByRole("button", { name: "Done editing price" })
    await harness.expectMinTapTarget(done, 48)
    await expectAboveKeyboard(harness, done, "Done button")
    await done.click()
    await expect(input).not.toBeFocused()
    await setKeyboard(page, 0)
    await expect(html(page)).not.toHaveAttribute("data-keyboard-open")
    await expect(check.getByRole("group", { name: "Keypad" })).toHaveCount(0)
    await expect(check.getByTestId("deal-verdict")).toBeVisible()
    await expect(check.getByTestId("deal-verdict")).toHaveAttribute("data-verdict", "great")
    await expect(check.getByTestId("deal-verdict-pinned")).toBeHidden()
    for (const name of ["Bought", "Add owned", "Want", "Add to bundle"]) await expect(check.getByRole("button", { name, exact: true })).toBeVisible()
    await input.evaluate((element: HTMLInputElement) => element.setSelectionRange(0, 0))
    await input.click({ position: { x: 4, y: 10 } })
    expect(await input.evaluate((element: HTMLInputElement) => [element.selectionStart, element.selectionEnd])).toEqual([3, 3])
    await input.press("Backspace")
    await expect(input).toHaveValue("7.")
    await input.blur()
    if (test.info().project.name === "standalone-390x844" && test.info().repeatEachIndex === 0) {
      await page.screenshot({ path: "/tmp/binderdex-native-input-dark.png" })
      await page.evaluate(() => document.documentElement.classList.remove("dark"))
      await page.screenshot({ path: "/tmp/binderdex-native-input-light.png" })
      await page.evaluate(() => document.documentElement.classList.add("dark"))
    }
  })

  test("Quick mode deal check (no Show mode): the verdict pins above the asking price and the actions step aside", async ({ harness }) => {
    const { page } = harness
    await mockCardPrices(page, { "sv03.5-006": { market: 10, confidence: "high" } })
    const search = harness.dock().getByRole("button", { name: "Search", exact: true })
    const box = (await search.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    const dialog = page.getByRole("dialog", { name: "Quick mode" })
    await expect(dialog).toBeVisible()
    await page.mouse.up()
    await expect(dialog.getByRole("heading", { name: "Quick mode" })).toBeVisible()
    await dialog.getByRole("searchbox").fill("charizard")
    await dialog.getByRole("region", { name: "Cards" }).getByRole("button", { name: /^Charizard ex, 151 / }).first().click()
    const check = dialog.getByTestId("quick-card-check")
    const input = check.getByRole("textbox", { name: "Asking price" })
    await expect(input).toBeFocused()

    await setKeyboard(page, KEYBOARD)
    await expect(html(page)).toHaveAttribute("data-keyboard-open", "")
    await input.fill("7")
    await expectTypingLayout(harness, check, input, "deal-verdict-pinned", "deal-verdict", ["Add owned", "Want"])
    await expect(check.getByTestId("deal-verdict-pinned")).toHaveAttribute("data-verdict", "great")

    await check.getByRole("button", { name: "Done editing price" }).click()
    await setKeyboard(page, 0)
    await expect(html(page)).not.toHaveAttribute("data-keyboard-open")
    await expect(check.getByTestId("deal-verdict")).toBeVisible()
    for (const name of ["Add owned", "Want"]) await expect(check.getByRole("button", { name, exact: true })).toBeVisible()
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
    await expect(check.getByRole("group", { name: "Keypad" })).toHaveCount(0)
    await expect(check.getByTestId("deal-verdict-pinned")).toBeVisible()
    await expect(check.getByRole("button", { name: "Bought", exact: true })).toBeHidden()
    await input.blur()
    await expect(html(page)).not.toHaveAttribute("data-keyboard-open")
    await expect(check.getByRole("group", { name: "Keypad" })).toHaveCount(0)
    await setKeyboard(page, 0)
  })

  for (const panned of [0, 120, KEYBOARD]) {
    test(`Show mode deal check: the card stays in view and the middle shrinks (iOS pan ${panned}px)`, async ({ harness }) => {
      // Callum's iPhone: with the asking field focused, iOS slid the whole full-height dialog up with the
      // keyboard, card off the top. The dialog must instead fit the visible part of the page.
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
      await setKeyboard(page, KEYBOARD, panned)
      await expect(html(page)).toHaveAttribute("data-keyboard-open", "")

      // The visible strip of the page, in layout-viewport coordinates.
      const top = panned
      const bottom = panned + harness.viewport.height - KEYBOARD
      await expect.poll(async () => (await dialog.boundingBox())!.y).toBeCloseTo(top, 0)
      const box = (await dialog.boundingBox())!
      expect(box.y + box.height, "dialog ends at the keyboard").toBeCloseTo(bottom, 0)
      const inView = async (locator: Locator, name: string) => {
        const rect = (await locator.boundingBox())!
        expect(rect.y, `${name} below the top of the visible page`).toBeGreaterThanOrEqual(top - 0.5)
        expect(rect.y + rect.height, `${name} above the keyboard`).toBeLessThanOrEqual(bottom + 0.5)
      }
      await inView(check.getByRole("heading", { name: "Charizard ex" }), "Card name")
      await inView(check.getByRole("button", { name: "Back to results" }), "Back button")
      await inView(check.getByTestId("deal-verdict-pinned"), "Pinned verdict")
      await inView(input, "Asking price")
      // The footer sits on the keyboard's top edge, with no extra keyboard-sized padding below the field.
      const footer = input.locator("xpath=ancestor::div[contains(@class,'border-t')][1]")
      expect(await footer.evaluate((element) => parseFloat(getComputedStyle(element).paddingBottom))).toBeCloseTo(12, 0)

      await input.blur()
      await setKeyboard(page, 0)
      await expect(html(page)).not.toHaveAttribute("data-keyboard-open")
      await expect.poll(async () => (await dialog.boundingBox())!.height).toBeCloseTo(harness.viewport.height, 0)
    })
  }

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
    await input.evaluate((element: HTMLInputElement) => element.setSelectionRange(0, 0))
    await input.click({ position: { x: 4, y: 10 } })
    expect(await input.evaluate((element: HTMLInputElement) => [element.selectionStart, element.selectionEnd])).toEqual([2, 2])
    await input.press("Backspace")
    await expect(input).toHaveValue("1")
    await input.press("1")
    await expectTypingLayout(harness, bundle, input, "bundle-verdict-pinned", "bundle-verdict", ["Bought bundle"])
    await expect(bundle.getByTestId("bundle-verdict-pinned")).toHaveAttribute("data-verdict", "great")

    await bundle.getByRole("button", { name: "Done editing price" }).click()
    await expect(input).not.toBeFocused()
    await setKeyboard(page, 0)
    await expect(html(page)).not.toHaveAttribute("data-keyboard-open")
    await expect(bundle.getByTestId("bundle-verdict")).toBeVisible()
    await expect(bundle.getByTestId("bundle-verdict-pinned")).toBeHidden()
    await expect(bundle.getByRole("group", { name: "Keypad" })).toHaveCount(0)
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
