import { test, expect } from "./fixtures"
import { mockCardPrices } from "./price-fixtures"

test.describe("breakout cards in the all-cards view", () => {
  test.use({ signedIn: true })

  test("ranks confidently rising printings with % change and timeframe", async ({ harness }) => {
    await mockCardPrices(harness.page, {
      // Fixtures: +20% over 7d (score 0.20) outranks +30% over 30d (score 0.15).
      "sv03.5-166": { confidence: "high", market: 24, trend: { "30d": 21, "7d": 20, Trend: 24 } },
      "swsh12pt5-001": { confidence: "medium", market: 13, trend: { "30d": 10, Trend: 13 } },
      // Fixture: big rise but low confidence -> excluded.
      "base1-44": { confidence: "low", market: 40, trend: { "30d": 10, "7d": 12, Trend: 40 } },
    })

    const detail = await harness.openCardDetail()
    await detail.getByRole("button", { name: /all bulbasaur cards/i }).click()
    const dialog = harness.page.getByRole("dialog", { name: /all bulbasaur cards/i })
    const breakout = dialog.getByRole("region", { name: /bulbasaur breakout cards/i })
    await expect(breakout).toBeVisible()

    const items = breakout.getByRole("button", { name: /^breakout/i })
    await expect(items).toHaveCount(2)
    await expect(items.nth(0)).toHaveAccessibleName(/breakout 1: bulbasaur 166\/165 151, \+20% over 7d/i)
    await expect(items.nth(1)).toHaveAccessibleName(/breakout 2: bulbasaur 001\/159 crown zenith, \+30% over 30d/i)
    await expect(breakout.getByText(/base set/i)).toHaveCount(0)
    await harness.expectNoHorizontalOverflow()

    // Filtering hides the section so it never contradicts the filtered grid.
    await dialog.getByRole("button", { name: /^owned/i }).click()
    await expect(breakout).toBeHidden()
  })

  test("is hidden when no printing has confident momentum", async ({ harness }) => {
    // Default harness prices are low-confidence fixtures.
    const detail = await harness.openCardDetail()
    await detail.getByRole("button", { name: /all bulbasaur cards/i }).click()
    const dialog = harness.page.getByRole("dialog", { name: /all bulbasaur cards/i })
    await expect(dialog.getByRole("list", { name: /cards/i }).getByRole("listitem")).toHaveCount(6)
    await expect(dialog.getByRole("region", { name: /breakout/i })).toHaveCount(0)
  })
})

test("shows more than three Pokémon breakouts and filters by finish", async ({ harness }) => {
  // Synthetic finish-specific momentum on five printings.
  await mockCardPrices(harness.page, Object.fromEntries(["me05-001", "sv03.5-001", "sv03.5-166", "swsh12pt5-001", "me02-001"].map((id) => [id, {
    confidence: "high" as const, market: 12,
    finishes: [{ finish: "normal" as const, market: 12, trend: { "7d": 10, Trend: 12 } }, { finish: "reverse_holo" as const, market: 20, trend: { "7d": 10, Trend: 20 } }],
  }])))
  const detail = await harness.openCardDetail()
  await detail.getByRole("button", { name: /all bulbasaur cards/i }).click()
  const dialog = harness.page.getByRole("dialog", { name: /all bulbasaur cards/i })
  const region = dialog.getByRole("region", { name: /bulbasaur breakout cards/i })
  await expect(region.getByRole("listitem")).toHaveCount(10)
  await region.getByRole("button", { name: "Non-holo", exact: true }).click()
  await expect(region.getByRole("listitem")).toHaveCount(5)
  await harness.expectNoHorizontalOverflow()
})
