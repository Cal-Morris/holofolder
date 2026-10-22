import { expect, test } from "./fixtures"
import { seedWantList } from "./wanted-fixtures"

test.describe("want list on mobile", () => {
  test.use({ signedIn: true })

  test.beforeEach(async ({ harness }) => {
    const { page } = harness
    await seedWantList(page)
    await page.reload()
    await expect(harness.dock()).toBeVisible({ timeout: 30_000 })
    await harness.dock().getByRole("button", { name: "Wanted", exact: true }).click()
    await expect(page.getByTestId("wanted-row")).toHaveCount(6)
  })

  test("one summary line, plain rows and Insights collapsed", async ({ harness }) => {
    const { page } = harness
    const summary = page.getByTestId("wanted-summary")
    await expect(summary).toContainText("6 wanted")
    await expect(summary).toContainText("to complete")
    await expect(summary).toContainText("1 unpriced")

    // The heavy stats are tucked away until asked for.
    const insights = page.getByTestId("wanted-insights")
    await expect(insights).not.toHaveAttribute("open", "")
    await expect(insights.getByText("Sets", { exact: true })).toBeHidden()

    const charmander = page.locator('[data-testid="wanted-row"][data-card-id="sv03.5-168"]')
    await expect(charmander).toContainText("151 · #168/165")
    await expect(charmander.getByTestId("price-rising-badge")).toBeVisible()

    const search = page.getByRole("searchbox", { name: "Search want list" })
    await harness.expectMinTapTarget(search, 44)
    await harness.expectWithinSafeViewport(search)
    // The view fades in when switched to; wait for it to settle before checking nothing covers the box.
    await expect(() => harness.expectHittable(search)).toPass()
    await harness.expectMinTapTarget(page.getByRole("button", { name: "Got it: Charmander" }), 44)
    await harness.expectMinTapTarget(page.getByRole("button", { name: "Share list" }), 44)
    await harness.expectMinTapTarget(page.getByRole("combobox", { name: "Sort want list" }), 44)
    await harness.expectNoHorizontalOverflow()

    // An Insights chip filters the list and shows up as a removable chip.
    await insights.locator("summary").click()
    await insights.getByRole("button", { name: /^30th Celebration/ }).click()
    await expect(page.getByTestId("wanted-row")).toHaveCount(1)
    await page.getByRole("button", { name: "Remove filter 30th Celebration" }).click()
    await expect(page.getByTestId("wanted-row")).toHaveCount(6)
  })

  test("search by name, Pokémon, set, number and illustrator", async ({ harness }) => {
    const { page } = harness
    const search = page.getByRole("searchbox", { name: "Search want list" })
    const rows = page.getByTestId("wanted-row")

    await search.fill("char")
    await expect(rows).toHaveCount(3)
    await search.fill("squirtle 30th")
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toHaveAttribute("data-card-id", "30th-007")
    await search.fill("#166")
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toHaveAttribute("data-card-id", "sv03.5-166")
    await search.fill("kouki saito")
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toHaveAttribute("data-card-id", "sv03.5-168")

    await search.fill("mewtwo")
    await expect(rows).toHaveCount(0)
    await expect(page.getByText(/Nothing on your want list matches/)).toBeVisible()
    await page.getByRole("button", { name: "Show all wanted cards" }).click()
    await expect(rows).toHaveCount(6)
    await harness.expectNoHorizontalOverflow()
  })

  test("sort by price and recently added", async ({ harness }) => {
    const { page } = harness
    const ids = () => page.getByTestId("wanted-row").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-card-id")))
    const sort = page.getByRole("combobox", { name: "Sort want list" })

    await sort.selectOption("highest")
    await expect.poll(ids).toEqual(["sv03.5-168", "sv03.5-166", "sv03.5-006", "sv03.5-007", "sv03.5-005", "30th-007"])
    await sort.selectOption("lowest")
    await expect.poll(ids).toEqual(["sv03.5-005", "sv03.5-007", "sv03.5-006", "sv03.5-166", "sv03.5-168", "30th-007"])
    await sort.selectOption("newest")
    await expect.poll(async () => (await ids())[0]).toBe("30th-007")
  })

  test("Got it takes the card off the want list", async ({ harness }) => {
    const { page } = harness
    await page.getByRole("button", { name: "Got it: Charmeleon" }).click()
    await expect(page.locator('[data-testid="wanted-row"][data-card-id="sv03.5-005"]')).toHaveCount(0)
    await expect(page.getByTestId("wanted-summary")).toContainText("5 wanted")
  })
})
