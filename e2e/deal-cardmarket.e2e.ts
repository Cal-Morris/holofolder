import { test, expect, type Harness } from "./fixtures"
import { clearCardPriceCache } from "./price-fixtures"

// Synthetic catalog evidence: deliberately different headline and exact-finish quotes.
async function mockEvidence(harness: Harness, source = "cardmarket", withEvidence = true) {
  await harness.page.route("**/api/card-prices**", async route => {
    const updatedAt = new Date(Date.now() - 2 * 86400000).toISOString()
    const quote = {
      gbpAmount: 8, marketGbpAmount: 8, confidence: "high", source,
      lowGbpAmount: 6, highGbpAmount: null, goodGbpAmount: null,
      originalAmount: 10, originalCurrency: "EUR", updatedAt, fxDate: null,
      buySignal: null, variantLabel: "Normal",
      sourcePrices: withEvidence ? [{ source, label: source === "cardmarket" ? "Cardmarket" : "PokePulse", variantLabel: "Normal", marketGbpAmount: 8, lowGbpAmount: 6, originalMarketAmount: 10, originalLowAmount: 7.5, originalCurrency: "EUR", updatedAt }] : [],
      trendPoints: withEvidence ? [{ label: "30d", gbpAmount: 6 }, { label: "7d", gbpAmount: 7 }, { label: "Trend", gbpAmount: 8 }].map(point => ({ ...point, source, originalAmount: point.gbpAmount / 0.8, originalCurrency: "EUR" })) : [],
    }
    await route.fulfill({ json: { fx: { date: new Date().toISOString().slice(0, 10), eurToGbp: 0.8, usdToGbp: 0.7 }, prices: route.request().postDataJSON().cards.map((card: { cardId: string; language: string }) => ({
      ...card, ...quote, gbpAmount: 80, marketGbpAmount: 80,
      sourcePrices: [
        { ...quote.sourcePrices[0], source, label: "Wrong headline finish", marketGbpAmount: 80, originalMarketAmount: 100 },
        // Preserve a synthetic USD conversion in cached snapshots as well as the response FX.
        { ...quote.sourcePrices[0], source: "tcgplayer", label: "Wrong headline USD", marketGbpAmount: 80, originalMarketAmount: 80 / 0.7, originalCurrency: "USD" },
      ],
      finishPrices: [{ ...card, ...quote, finish: "normal", variantKey: "normal" }],
    })) } })
  })
  await clearCardPriceCache(harness.page)
}

async function openCheck(harness: Harness, show: boolean) {
  if (show) await harness.page.getByRole("button", { name: "Show mode", exact: true }).click()
  await harness.page.keyboard.press("Control+k")
  const dialog = harness.page.getByRole("dialog", { name: "Quick mode" })
  await dialog.getByRole("searchbox").fill("charmeleon")
  await dialog.getByRole("region", { name: "Cards" }).getByRole("button", { name: /^Charmeleon, 151 / }).first().click()
  const check = dialog.getByTestId("quick-card-check")
  await expect(check).toBeVisible()
  await check.getByRole("textbox", { name: /price/i }).press("Enter")
  return check
}

test.describe("Cardmarket catalog in the deal checker", () => {
  test.use({ signedIn: true })

  for (const show of [true, false]) {
    test(`${show ? "Show" : "Quick"} shows exact-finish quotes and trend separately, including offline`, async ({ harness }) => {
      await mockEvidence(harness)
      const check = await openCheck(harness, show)
      const sources = check.getByRole("region", { name: "Catalog price sources" })
      await sources.scrollIntoViewIfNeeded()
      await expect(sources).toContainText("Cardmarket, Normal")
      await expect(sources).toContainText("£8.00 GBP")
      await expect(sources).toContainText("Low £6.00 GBP")
      await expect(sources).toContainText("Original €10.00 EUR")
      await expect(sources).toContainText("Low €7.50 EUR")
      await expect(sources).toContainText("Updated 2 days ago")
      await expect(sources).toContainText("not sold records")
      await expect(sources).toContainText("converted from the original source currency")
      await expect(sources.getByText("Cardmarket trend · GBP")).toBeVisible()
      await expect(sources.locator(".recharts-surface")).toBeVisible()
      const stroke = await sources.locator(".recharts-area-curve").evaluate(el => getComputedStyle(el).stroke)
      expect(stroke).not.toBe("none")
      expect(stroke).not.toBe("rgb(0, 0, 0)")
      await expect(sources).not.toContainText("Wrong headline finish")
      const comparisons = check.getByRole("region", { name: "Price comparisons" })
      await expect(comparisons).not.toContainText("Cardmarket")
      await expect(comparisons.getByRole("button", { name: "Check prices", exact: true })).toBeEnabled()
      const action = check.getByRole("button", { name: "Add owned", exact: true })
      await harness.expectWithinSafeViewport(action)
      await harness.expectHittable(action)
      const before = await action.boundingBox()
      await sources.scrollIntoViewIfNeeded()
      expect((await action.boundingBox())?.y).toBe(before?.y)
      await harness.expectNoHorizontalOverflow()
      expect(await sources.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)

      await harness.page.context().setOffline(true)
      await expect(check.getByTestId("quick-card-cache-age")).toContainText("Offline")
      await check.getByRole("radio", { name: /reverse/i }).click()
      await expect(sources).toContainText("No catalog evidence saved for this finish")
      await expect(sources).not.toContainText("Cardmarket trend")
      await expect(sources).not.toContainText("€10.00")
      await check.getByRole("radio", { name: /normal/i }).click()
      await sources.scrollIntoViewIfNeeded()
      await expect(sources).toContainText("Original €10.00 EUR")
      await expect(sources.locator(".recharts-surface")).toBeVisible()
      await harness.expectNoHorizontalOverflow()
      await harness.page.context().setOffline(false)
    })
  }

  for (const currency of ["EUR", "USD"]) {
    test(`catalog GBP attribution stays explicit with ${currency} display`, async ({ harness }) => {
      await harness.page.route("**/api/settings", route => route.fulfill({ json: { settings: { preferredCurrency: currency, pricingRegion: "UK" } } }))
      await mockEvidence(harness)
      await harness.page.reload()
      const check = await openCheck(harness, false)
      await expect(check.getByTestId("quick-card-market-price")).toHaveText(currency === "EUR" ? "€10.00" : "$11.43")
      const sources = check.getByRole("region", { name: "Catalog price sources" })
      await expect(sources).toContainText("£8.00 GBP")
      await expect(sources).toContainText("Original €10.00 EUR")
      await expect(sources).toContainText("Cardmarket trend · GBP")
    })
  }

  test("keyboard keeps the asking field reachable and restores actions on Done", async ({ harness }) => {
    await mockEvidence(harness)
    const check = await openCheck(harness, true)
    const input = check.getByRole("textbox", { name: "Asking price" })
    await input.fill("6")
    const setKeyboard = async (height: number) => harness.page.evaluate(covered => {
      const proto = Object.getPrototypeOf(window.visualViewport!)
      Object.defineProperty(proto, "height", { configurable: true, get: () => window.innerHeight - covered })
      window.visualViewport!.dispatchEvent(new Event("resize"))
    }, height)
    await setKeyboard(300)
    await expect(harness.page.locator("html")).toHaveAttribute("data-keyboard-open", "")
    const pinned = check.getByTestId("deal-verdict-pinned")
    await expect(pinned).toBeVisible()
    for (const control of [input, pinned, check.getByRole("button", { name: "Done editing price" })]) {
      await control.scrollIntoViewIfNeeded()
      const box = (await control.boundingBox())!
      expect(box.y).toBeGreaterThanOrEqual(harness.insets.top)
      expect(box.y + box.height).toBeLessThanOrEqual(harness.viewport.height - 300)
    }
    await expect(check.getByRole("button", { name: "Bought", exact: true })).toBeHidden()
    await check.getByRole("button", { name: "Done editing price" }).click()
    await setKeyboard(0)
    await expect(harness.page.locator("html")).not.toHaveAttribute("data-keyboard-open")
    for (const name of ["Bought", "Add owned", "Want", "Add to bundle"]) {
      const button = check.getByRole("button", { name, exact: true })
      await button.scrollIntoViewIfNeeded()
      await harness.expectWithinSafeViewport(button)
      await harness.expectHittable(button)
    }
  })

  test("missing evidence has no empty chart", async ({ harness }) => {
    await mockEvidence(harness, "cardmarket", false)
    const check = await openCheck(harness, true)
    const sources = check.getByRole("region", { name: "Catalog price sources" })
    await expect(sources).toContainText("No catalog evidence saved for this finish")
    await expect(sources.locator(".recharts-surface")).toHaveCount(0)
  })

  test("other providers are not labelled Cardmarket trend", async ({ harness }) => {
    await mockEvidence(harness, "pokepulse")
    const check = await openCheck(harness, false)
    const sources = check.getByRole("region", { name: "Catalog price sources" })
    await expect(sources).toContainText("PokePulse")
    await expect(sources).not.toContainText("Cardmarket trend")
    await expect(sources.locator(".recharts-surface")).toHaveCount(0)
  })
})


test.describe("deal scale geometry", () => {
  test.use({ signedIn: true })
  for (const size of [null, { width: 1238, height: 500 }, { width: 667, height: 375 }, { width: 844, height: 300 }]) {
    test(`labels and actions fit ${size ? `${size.width}x${size.height}` : "phone"}`, async ({ harness }) => {
      if (size) await harness.page.setViewportSize(size)
      await mockEvidence(harness)
      const check = await openCheck(harness, true)
      const scale = check.getByRole("figure", { name: "Buying range" })
      const svg = scale.locator("svg")
      const bounds = await svg.evaluate(el => {
        const svg = el as SVGSVGElement
        return { height: svg.viewBox.baseVal.height, labels: Array.from(svg.querySelectorAll("text")).map(text => ({ text: text.textContent, bottom: text.getBBox().y + text.getBBox().height })) }
      })
      for (const label of bounds.labels) expect.soft(label.bottom, `${label.text} fits in SVG`).toBeLessThanOrEqual(bounds.height)
      const field = check.getByRole("textbox", { name: "Asking price" }).locator("xpath=ancestor::label[1]")
      const scaleBox = (await scale.boundingBox())!
      const fieldBox = (await field.boundingBox())!
      expect.soft(fieldBox.y - scaleBox.y - scaleBox.height, "gap clears 2px input focus ring").toBeGreaterThanOrEqual(4)
      const sources = check.getByRole("region", { name: "Catalog price sources" })
      await sources.scrollIntoViewIfNeeded()
      await expect(sources).toContainText("Original €10.00 EUR")
      await expect(sources).toBeInViewport({ ratio: 0.1 })
      const height = size?.height ?? harness.viewport.height
      for (const name of ["Bought", "Add owned", "Want", "Add to bundle"]) {
        const button = check.getByRole("button", { name, exact: true })
        await button.scrollIntoViewIfNeeded()
        const box = (await button.boundingBox())!
        expect(box.y, `${name} top`).toBeGreaterThanOrEqual(harness.insets.top)
        expect(box.y + box.height, `${name} bottom`).toBeLessThanOrEqual(height - harness.insets.bottom)
        await harness.expectHittable(button)
      }
      const want = check.getByRole("button", { name: "Want", exact: true })
      await want.click()
      await check.getByRole("button", { name: "Dismiss undo" }).click()
      const got = check.getByRole("button", { name: "Mark got", exact: true })
      await got.scrollIntoViewIfNeeded()
      await harness.expectWithinSafeViewport(got)
      await harness.expectHittable(got)
      await harness.expectNoHorizontalOverflow()
      if (!size || size.width === 1238) await harness.page.screenshot({ path: `/tmp/cardmarket-${test.info().project.name}-${size ? "desktop" : "phone"}.png` })
    })
  }
})
