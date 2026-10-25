import { test, expect, type Harness } from "./fixtures"
import { E2E_USER } from "./fixtures"
import { seedWantList, WANTED_COLLECTION } from "./wanted-fixtures"

/** Many single-card wants so the Wanted list scrolls on every phone size. */
const LONG_WANT_LIST = [
  ...WANTED_COLLECTION,
  ...Array.from({ length: 30 }, (_, index) => {
    const id = 20 + index
    const localId = String(id).padStart(3, "0")
    return {
      id: `e2e-${id}`, user_id: E2E_USER.id, pokemon_id: id, pokemon_name: `pokemon-${id}`, status: "wishlisted", collected_at: "2026-01-01T00:00:00.000Z",
      wanted_cards: [{ card_id: `sv03.5-${localId}`, card_name: `Card ${id}`, card_set: "151", local_id: localId, set_total: 165, card_language: "en", card_finish: "normal", card_image: `https://assets.tcgdex.net/en/mock/sv03.5/${localId}/high.webp`, added_at: "2026-02-01T00:00:00.000Z" }],
    }
  }),
]

const dockGlass = (harness: Harness) => harness.dock().locator("[data-scroll-blur]")
const backdrop = (harness: Harness, selector: string) =>
  harness.page.locator(selector).first().evaluate((element) => getComputedStyle(element).backdropFilter)

/** Scrolls `scroller` a few pixels every frame for about a second, without waiting for it. */
async function keepScrolling(harness: Harness, testId: string) {
  await harness.page.getByTestId(testId).evaluate((element) => {
    let frame = 0
    const step = () => {
      element.scrollTop += frame % 2 ? 4 : -4
      if (++frame < 60) requestAnimationFrame(step)
    }
    element.scrollTop = 200
    requestAnimationFrame(step)
  })
}

test.describe("sticky blur freezes while scrolling", () => {
  test.use({ signedIn: true })

  test("dock and Wanted filter bar drop their blur mid-scroll and get it back once settled", async ({ harness }) => {
    const { page } = harness
    await seedWantList(page, LONG_WANT_LIST)
    await page.reload()
    await expect(harness.dock()).toBeVisible({ timeout: 30_000 })
    await harness.dock().getByRole("button", { name: "Wanted", exact: true }).click()
    const list = page.getByTestId("wanted-list")
    await expect(list).toBeVisible()
    await expect.poll(() => list.evaluate((element) => element.scrollHeight - element.clientHeight), { timeout: 10_000 }).toBeGreaterThan(200)

    const bar = '[data-testid="wanted-list"] [data-scroll-blur]'
    await expect(page.locator("html")).not.toHaveAttribute("data-scrolling")
    expect(await dockGlass(harness).evaluate((element) => getComputedStyle(element).backdropFilter)).toContain("blur(")
    expect(await backdrop(harness, bar)).toContain("blur(")

    await keepScrolling(harness, "wanted-list")
    await expect(page.locator("html")).toHaveAttribute("data-scrolling")
    expect(await dockGlass(harness).evaluate((element) => getComputedStyle(element).backdropFilter)).toBe("none")
    expect(await backdrop(harness, bar)).toBe("none")
    // Without the blur the dock and filter bar turn opaque, so rows never show through sharply.
    const alpha = (element: Element) => {
      const match = getComputedStyle(element).backgroundColor.match(/\/\s*([\d.]+)\)$|rgba\([^)]*,\s*([\d.]+)\)$/)
      return match ? Number(match[1] ?? match[2]) : 1
    }
    expect(await dockGlass(harness).evaluate(alpha)).toBe(1)
    expect(await page.locator(bar).first().evaluate(alpha)).toBe(1)

    await expect(page.locator("html")).not.toHaveAttribute("data-scrolling", { timeout: 5_000 })
    expect(await dockGlass(harness).evaluate((element) => getComputedStyle(element).backdropFilter)).toContain("blur(")
    expect(await backdrop(harness, bar)).toContain("blur(")
  })

  test("List view scrolling freezes the dock too", async ({ harness }) => {
    const { page } = harness
    await harness.dock().getByRole("button", { name: "List", exact: true }).click()
    await expect(page.getByPlaceholder("Search name, card, set, or dex #")).toBeVisible()
    const scroller = page.getByTestId("view-scroller")
    await expect.poll(() => scroller.evaluate((element) => element.scrollHeight - element.clientHeight), { timeout: 10_000 }).toBeGreaterThan(200)
    await keepScrolling(harness, "view-scroller")
    await expect(page.locator("html")).toHaveAttribute("data-scrolling")
    expect(await dockGlass(harness).evaluate((element) => getComputedStyle(element).backdropFilter)).toBe("none")
    await expect(page.locator("html")).not.toHaveAttribute("data-scrolling", { timeout: 5_000 })
    expect(await dockGlass(harness).evaluate((element) => getComputedStyle(element).backdropFilter)).toContain("blur(")
  })
})
