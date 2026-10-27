import type { Locator } from "@playwright/test"
import { test, expect, type Harness } from "./fixtures"
import { mockCardPrices } from "./price-fixtures"

const SCREENS = process.env.E2E_SCREENSHOT_DIR

async function screenshot(harness: Harness, name: string) {
  if (SCREENS && test.info().project.name.startsWith("standalone-390")) await harness.page.screenshot({ path: `${SCREENS}/quick-${name}.png` })
}

const banner = (harness: Harness) => harness.page.getByRole("region", { name: "Show mode" })
const quickDialog = (harness: Harness) => harness.page.getByRole("dialog", { name: "Quick mode" })

async function openQuickInShowMode(harness: Harness) {
  if (!(await banner(harness).isVisible())) {
    await harness.page.getByRole("button", { name: "Show mode", exact: true }).click()
  }
  await banner(harness).getByRole("button", { name: "Search", exact: true }).click()
  await expect(quickDialog(harness)).toBeVisible()
  return quickDialog(harness)
}

/** Search, tap a card in the results, and land on its price check. */
async function checkCard(harness: Harness, query: string, cardName: RegExp) {
  const dialog = quickDialog(harness)
  await dialog.getByRole("searchbox").fill(query)
  await dialog.getByRole("region", { name: "Cards" }).getByRole("button", { name: cardName }).first().click()
  const check = dialog.getByTestId("quick-card-check")
  await expect(check).toBeVisible()
  return check
}

/** Clear the asking price and type a new one on the on-screen keypad. */
async function typePrice(scope: Locator, price: string) {
  const keypad = scope.getByRole("group", { name: "Keypad" })
  const input = scope.getByRole("textbox", { name: /price/i })
  while ((await input.inputValue()).length > 0) await keypad.getByRole("button", { name: "Delete digit" }).click()
  for (const key of price) await keypad.getByRole("button", { name: key === "." ? "Decimal point" : key, exact: true }).click()
  await expect(input).toHaveValue(price)
}

test.describe("deal checker", () => {
  test.use({ signedIn: true })

  test("the verdict follows the thresholds: great, good, fair, overpriced, walk away", async ({ harness }) => {
    await mockCardPrices(harness.page, { "sv03.5-006": { market: 10, confidence: "high" } })
    await openQuickInShowMode(harness)
    const check = await checkCard(harness, "charizard", /^Charizard ex, 151 /)
    await expect(check.getByTestId("quick-card-market-price")).toHaveText("£10.00")
    await expect(check.getByTestId("quick-card-cache-age")).toContainText("Updated")
    const input = check.getByRole("textbox", { name: "Asking price" })
    await expect(input).toBeFocused()

    const verdict = check.getByTestId("deal-verdict")
    const cases: Array<[string, string, string]> = [
      ["7", "great", "Great deal"],
      ["8.5", "good", "Good price"],
      ["10", "fair", "Fair price"],
      ["11", "fair", "Fair price"],
      ["12", "overpriced", "Overpriced"],
      ["14", "walk-away", "Walk away"],
    ]
    for (const [price, key, label] of cases) {
      await typePrice(check, price)
      await expect(verdict).toHaveAttribute("data-verdict", key)
      await expect(verdict).toContainText(label)
    }
    await expect(verdict.getByTestId("deal-diff")).toContainText("40%")
    await expect(verdict.getByTestId("deal-diff")).toContainText("£4.00")
    await expect(verdict.getByTestId("deal-pay-up-to")).toHaveText("Pay up to £11.00")

    await typePrice(check, "7")
    for (const name of ["Bought", "Add owned", "Want", "Add to bundle"]) {
      const button = check.getByRole("button", { name, exact: true })
      await harness.expectWithinSafeViewport(button)
      await harness.expectHittable(button)
      await harness.expectMinTapTarget(button, 48)
    }
    const seven = check.getByRole("group", { name: "Keypad" }).getByRole("button", { name: "7", exact: true })
    await harness.expectMinTapTarget(seven, 48)
    await harness.expectNoHorizontalOverflow()
    await screenshot(harness, "deal-verdict")
  })

  test("£6 in a binder for a £4 card is a walk away; £6 for a £10 card is great", async ({ harness }) => {
    await mockCardPrices(harness.page, {
      "sv03.5-007": { market: 4, confidence: "high" },
      "sv03.5-006": { market: 10, confidence: "high" },
    })
    await openQuickInShowMode(harness)
    let check = await checkCard(harness, "squirtle", /^Squirtle, 151 /)
    await expect(check.getByTestId("quick-card-market-price")).toHaveText("£4.00")
    await typePrice(check, "6")
    await expect(check.getByTestId("deal-verdict")).toHaveAttribute("data-verdict", "walk-away")
    await check.getByRole("button", { name: "Back to results" }).click()

    check = await checkCard(harness, "charizard", /^Charizard ex, 151 /)
    await typePrice(check, "6")
    await expect(check.getByTestId("deal-verdict")).toHaveAttribute("data-verdict", "great")
  })

  test("custom thresholds from Settings change the verdict", async ({ harness }) => {
    const { page } = harness
    await mockCardPrices(page, { "sv03.5-006": { market: 10, confidence: "high" } })
    await page.getByRole("button", { name: "More", exact: true }).click()
    await page.getByRole("menuitem", { name: "Settings" }).click()
    const settings = page.getByRole("dialog", { name: /settings/i })
    await settings.getByRole("button", { name: "Display", exact: true }).click()
    const deal = settings.getByRole("group", { name: "Deal checker" })
    const great = deal.getByRole("spinbutton", { name: "Great deal threshold" }).or(deal.getByRole("textbox", { name: "Great deal threshold" }))
    await great.fill("40")
    await great.press("Enter")
    await page.keyboard.press("Escape")
    await expect(settings).toBeHidden()

    await openQuickInShowMode(harness)
    const check = await checkCard(harness, "charizard", /^Charizard ex, 151 /)
    await typePrice(check, "7")
    await expect(check.getByTestId("deal-verdict")).toHaveAttribute("data-verdict", "good")
    await typePrice(check, "6")
    await expect(check.getByTestId("deal-verdict")).toHaveAttribute("data-verdict", "great")
  })

  test("thin data is flagged and a rising card gets a nudge", async ({ harness }) => {
    await mockCardPrices(harness.page, {
      "sv03.5-007": { market: 4, confidence: "low" },
      "sv03.5-006": { market: 10, confidence: "high", trend: { "7d": 8, Trend: 10 } },
    })
    await openQuickInShowMode(harness)
    let check = await checkCard(harness, "squirtle", /^Squirtle, 151 /)
    await typePrice(check, "4")
    await expect(check.getByTestId("deal-verdict")).toContainText("Thin price data")
    await check.getByRole("button", { name: "Back to results" }).click()

    check = await checkCard(harness, "charizard", /^Charizard ex, 151 /)
    await expect(check.getByText("Rising", { exact: true })).toBeVisible()
    await typePrice(check, "12")
    await expect(check.getByTestId("deal-verdict")).toHaveAttribute("data-verdict", "overpriced")
    await expect(check.getByTestId("deal-verdict")).toContainText("Rising: this price may be fair soon")
  })

  test("the variant toggle switches the market price", async ({ harness }) => {
    await mockCardPrices(harness.page, {
      "sv03.5-005": { market: 3, confidence: "high", finishes: [{ finish: "normal", market: 3 }, { finish: "reverse_holo", market: 6 }] },
    })
    await openQuickInShowMode(harness)
    const check = await checkCard(harness, "charmeleon", /^Charmeleon, 151 /)
    await expect(check.getByTestId("quick-card-status")).toHaveText("Not in binder")
    const variants = check.getByRole("radiogroup", { name: "Variant" })
    await variants.getByRole("radio", { name: /normal/i }).click()
    await expect(check.getByTestId("quick-card-market-price")).toHaveText("£3.00")
    await typePrice(check, "5")
    await expect(check.getByTestId("deal-verdict")).toHaveAttribute("data-verdict", "walk-away")
    await variants.getByRole("radio", { name: /reverse/i }).click()
    await expect(variants.getByRole("radio", { name: /reverse/i })).toHaveAttribute("aria-checked", "true")
    await expect(check.getByTestId("quick-card-market-price")).toHaveText("£6.00")
    await expect(check.getByTestId("deal-verdict")).toHaveAttribute("data-verdict", "good")
  })

  test("Bought adds it as owned, logs the price to the tally, and Undo takes it back", async ({ harness }) => {
    const { page } = harness
    await mockCardPrices(page, { "sv03.5-006": { market: 10, confidence: "high" } })
    await openQuickInShowMode(harness)
    const check = await checkCard(harness, "charizard", /^Charizard ex, 151 /)
    await expect(check.getByTestId("quick-card-status")).toHaveText("Not in binder")
    await typePrice(check, "8")
    await check.getByRole("button", { name: "Bought", exact: true }).click()
    await expect(check.getByTestId("quick-card-status")).toHaveText("Owned")
    const snackbar = page.getByTestId("undo-snackbar")
    await expect(snackbar).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(banner(harness)).toContainText("1 bought · £8.00")

    await openQuickInShowMode(harness)
    const again = await checkCard(harness, "charizard", /^Charizard ex, 151 /)
    await expect(again.getByTestId("quick-card-status")).toHaveText("Owned")
    await typePrice(again, "9")
    await again.getByRole("button", { name: "Bought", exact: true }).click()
    await page.getByTestId("undo-snackbar").getByRole("button", { name: "Undo", exact: true }).click()
    await page.keyboard.press("Escape")
    await expect(banner(harness)).toContainText("1 bought · £8.00")

    // Settings shows the tally and can clear it.
    await page.getByRole("button", { name: "More", exact: true }).click()
    await page.getByRole("menuitem", { name: "Settings" }).click()
    const settings = page.getByRole("dialog", { name: /settings/i })
    await settings.getByRole("button", { name: "Display", exact: true }).click()
    await expect(settings.getByTestId("show-tally-settings")).toContainText("£8.00")
  })

  test("Want, then Mark got when you find it", async ({ harness }) => {
    await mockCardPrices(harness.page, { "sv03.5-007": { market: 4, confidence: "high" } })
    await openQuickInShowMode(harness)
    const check = await checkCard(harness, "squirtle", /^Squirtle, 151 /)
    await check.getByRole("button", { name: "Want", exact: true }).click()
    await expect(check.getByTestId("quick-card-status")).toHaveText("Wanted")
    const got = check.getByRole("button", { name: "Mark got", exact: true })
    await harness.expectMinTapTarget(got, 48)
    await got.click()
    await expect(check.getByTestId("quick-card-status")).toHaveText("Owned")
  })

  test("bundle mode judges one asking price against the combined market", async ({ harness }) => {
    const { page } = harness
    await mockCardPrices(page, {
      "sv03.5-006": { market: 10, confidence: "high" },
      "sv03.5-007": { market: 4, confidence: "high" },
    })
    const dialog = await openQuickInShowMode(harness)
    let check = await checkCard(harness, "charizard", /^Charizard ex, 151 /)
    await check.getByRole("button", { name: "Add to bundle" }).click()
    await expect(check.getByRole("button", { name: "In bundle" })).toBeVisible()
    await check.getByRole("button", { name: "Back to results" }).click()
    check = await checkCard(harness, "squirtle", /^Squirtle, 151 /)
    await check.getByRole("button", { name: "Add to bundle" }).click()
    await check.getByRole("button", { name: "Back to results" }).click()

    await dialog.getByRole("button", { name: /^Bundle · 2 cards · market £14\.00/ }).click()
    const bundle = dialog.getByTestId("quick-bundle")
    await expect(bundle.getByTestId("bundle-market-total")).toContainText("£14.00")
    await expect(bundle.getByRole("list", { name: "Cards in bundle" }).getByRole("listitem")).toHaveCount(2)
    await typePrice(bundle, "11")
    await expect(bundle.getByTestId("bundle-verdict")).toHaveAttribute("data-verdict", "great")
    await typePrice(bundle, "15")
    await expect(bundle.getByTestId("bundle-verdict")).toHaveAttribute("data-verdict", "fair")
    await typePrice(bundle, "11")
    const bought = bundle.getByRole("button", { name: "Bought bundle" })
    await harness.expectWithinSafeViewport(bought)
    await harness.expectMinTapTarget(bought, 48)
    await harness.expectNoHorizontalOverflow()
    await screenshot(harness, "deal-bundle")

    await bought.click()
    await page.keyboard.press("Escape")
    await expect(banner(harness)).toContainText("2 bought · £11.00")
    await openQuickInShowMode(harness)
    await expect(dialog.getByRole("button", { name: /^Bundle ·/ })).toHaveCount(0)
    const after = await checkCard(harness, "squirtle", /^Squirtle, 151 /)
    await expect(after.getByTestId("quick-card-status")).toHaveText("Owned")
  })

  test("offline it still judges from the saved price and says how old it is", async ({ harness }) => {
    const { page } = harness
    await mockCardPrices(page, { "sv03.5-006": { market: 10, confidence: "high" } })
    await openQuickInShowMode(harness)
    const check = await checkCard(harness, "charizard", /^Charizard ex, 151 /)
    await expect(check.getByTestId("quick-card-market-price")).toHaveText("£10.00")
    await page.route("**/api/card-prices**", (route) => route.abort("internetdisconnected"))
    await page.context().setOffline(true)
    await expect(check.getByTestId("quick-card-cache-age")).toContainText("Offline · saved price from")
    await typePrice(check, "12")
    await expect(check.getByTestId("deal-verdict")).toHaveAttribute("data-verdict", "overpriced")
    await page.context().setOffline(false)
  })
})

test.describe("manual bundle price checks", () => {
  test.use({ signedIn: true })
  test("checks every card independently, updates the range and offer dot, and retains catalogue fallback", async ({ harness }) => {
    await mockCardPrices(harness.page, { "sv03.5-006": { market: 10, confidence: "high" }, "sv03.5-007": { market: 4, confidence: "high" } })
    let calls = 0
    let release: (() => void) | undefined
    const gate = new Promise<void>(resolve => { release = resolve })
    await harness.page.route("**/api/card-price-checks?**", async route => {
      calls++
      const query = new URL(route.request().url()).searchParams
      expect(route.request().method()).toBe("POST")
      if (query.get("cardId") === "sv03.5-007" && query.get("source") === "soldcomps") {
        await gate
        await route.fulfill({ status: 503, json: { error: "Sold provider unavailable" } }).catch(() => undefined)
      } else {
        const sold = query.get("source") === "soldcomps"
        const amount = query.get("cardId") === "sv03.5-006" ? 9.8 : 4
        // Synthetic concentrated sales across three dates.
        const check = { checkedAt: new Date().toISOString(), summary: { kind: sold ? "sold" : "asking", currency: "GBP", count: 12, low: amount, median: amount, high: amount }, ...(sold ? { sales: Array.from({ length: 12 }, (_, i) => ({ amount, soldAt: new Date(Date.now() - (i % 3 + 1) * 86400_000).toISOString().slice(0, 10) })) } : {}) }
        await route.fulfill({ json: { ebay: sold ? null : check, soldcomps: sold ? check : null, errors: {} } })
      }
    })
    const dialog = await openQuickInShowMode(harness)
    let card = await checkCard(harness, "charizard", /^Charizard ex, 151 /)
    await card.getByRole("button", { name: "Add to bundle" }).click()
    await card.getByRole("button", { name: "Back to results" }).click()
    card = await checkCard(harness, "squirtle", /^Squirtle, 151 /)
    await card.getByRole("button", { name: "Add to bundle" }).click()
    await card.getByRole("button", { name: "Back to results" }).click()
    await dialog.getByRole("button", { name: /^Bundle · 2 cards/ }).click()
    const bundle = dialog.getByTestId("quick-bundle")
    expect(calls).toBe(0)
    const button = bundle.getByRole("button", { name: "Check bundle prices", exact: true })
    await harness.expectMinTapTarget(button)
    await button.click()
    try {
      await expect(bundle.getByText("Sold reference", { exact: true })).toHaveCount(1)
      await expect(bundle.getByTestId("bundle-market-total")).toContainText("£13.80")
      await expect(bundle.getByText("Sold: checking…", { exact: true })).toBeVisible()
      await expect(bundle.getByText("eBay: 12 matches", { exact: true })).toHaveCount(2)
      await typePrice(bundle, "11")
      await expect(bundle.getByTestId("offer-price-dot")).toHaveAttribute("data-price", "11")
      await harness.expectWithinSafeViewport(bundle.getByRole("figure", { name: "Buying range" }))
      await harness.expectNoHorizontalOverflow()
    } finally { release?.() }
    await expect(bundle.getByText(/Sold: Sold provider unavailable/)).toBeVisible()
    await expect(bundle.getByText("Catalogue reference", { exact: true })).toHaveCount(1)
    await expect(button).toBeEnabled()
    expect(calls).toBe(4)
    await expect(bundle.getByText("1 of 2 use qualified sold evidence.", { exact: false })).toBeVisible()
    // Reopen: the qualified saved evidence survives, without any automatic refresh.
    await bundle.getByRole("button", { name: "Back to results" }).click()
    await dialog.getByRole("button", { name: /^Bundle · 2 cards/ }).click()
    await expect(bundle.getByTestId("bundle-market-total")).toContainText("£13.80")
    expect(calls).toBe(4)
    if (test.info().project.name === "standalone-390x844" && test.info().repeatEachIndex === 0) await harness.page.screenshot({ path: "/tmp/binderdex-readable-bundle.png" })
  })
})
