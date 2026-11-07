import { test, expect, type Harness } from "./fixtures"
import { E2E_USER } from "./fixtures"
import { seedWantList, WANTED_COLLECTION } from "./wanted-fixtures"

type Tab = "List" | "Sets" | "Wanted"
const scrollerId = (tab: Tab) => (tab === "Wanted" ? "wanted-list" : "view-scroller")

async function openTab(harness: Harness, tab: Tab) {
  await harness.dock().getByRole("button", { name: tab === "Sets" ? "Browse" : tab, exact: true }).click()
  // Wait for the new view itself, not the outgoing one that is still on screen mid-transition.
  if (tab === "List") await expect(harness.page.getByPlaceholder("Search name, card, set, or dex #")).toBeVisible()
  if (tab === "Sets") await expect(harness.page.getByRole("group", { name: "Browse perspective" })).toBeVisible()
  await expect(harness.page.getByTestId(scrollerId(tab))).toHaveCount(1)
  await expect(harness.page.getByTestId(scrollerId(tab))).toBeVisible()
}

async function scrollRange(harness: Harness, tab: Tab) {
  const scroller = harness.page.getByTestId(scrollerId(tab))
  await expect.poll(() => scroller.evaluate((element) => element.scrollHeight - element.clientHeight), { timeout: 10_000 }).toBeGreaterThan(0)
  return scroller.evaluate((element) => element.scrollHeight - element.clientHeight)
}

async function scrollTo(harness: Harness, tab: Tab, top: number) {
  await harness.page.getByTestId(scrollerId(tab)).evaluate((element, y) => {
    element.scrollTop = y
    element.dispatchEvent(new Event("scroll"))
  }, top)
  // Positions are saved once per frame.
  await harness.page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}

/**
 * List rows are virtualised and measured as they render, and Chrome's scroll anchoring keeps the same
 * rows on screen when a measurement lands, which can nudge scrollTop by a few dozen pixels after a
 * restore (more so on a busy machine). Half a row means "same place" without depending on that timing.
 */
const LIST_TOLERANCE_PX = 48

function scrollTopOf(harness: Harness, tab: Tab) {
  return () => harness.page.getByTestId(scrollerId(tab)).evaluate((element) => element.scrollTop)
}

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

test.describe("per-view scroll restoration", () => {
  test.use({ signedIn: true })

  test("List keeps its place across a tab switch and opening a card", async ({ harness }) => {
    await openTab(harness, "List")
    const range = await scrollRange(harness, "List")
    const target = Math.min(900, range - 10)
    await scrollTo(harness, "List", target)

    await openTab(harness, "Sets")
    await expect.poll(scrollTopOf(harness, "Sets")).toBe(0)
    await openTab(harness, "List")
    await expect.poll(scrollTopOf(harness, "List")).toBeGreaterThanOrEqual(target - LIST_TOLERANCE_PX)

    // Picking a row opens its card on the binder; after closing it, List is where it was.
    // Tap a row in the middle of the viewport (rows above it are rendered but scrolled away).
    const key = await harness.page.getByTestId("view-scroller").evaluate((element) => {
      const rect = element.getBoundingClientRect()
      const middle = rect.top + rect.height / 2
      const rows = [...element.querySelectorAll("[data-virtual-key]")]
      const row = rows.find((candidate) => {
        const box = candidate.getBoundingClientRect()
        return box.top <= middle && box.bottom >= middle
      }) ?? rows.find((candidate) => candidate.getBoundingClientRect().top >= rect.top)
      return row?.getAttribute("data-virtual-key")
    })
    expect(key).toBeTruthy()
    await harness.page.locator(`[data-virtual-key="${key}"]`).click()
    await expect(harness.dialogs().first()).toBeVisible()
    await harness.page.goBack()
    await expect(harness.dialogs()).toHaveCount(0)
    await openTab(harness, "List")
    await expect.poll(scrollTopOf(harness, "List")).toBeGreaterThanOrEqual(target - LIST_TOLERANCE_PX)
  })

  test("each view remembers its own position", async ({ harness }) => {
    await openTab(harness, "List")
    await scrollRange(harness, "List")
    await scrollTo(harness, "List", 400)
    await openTab(harness, "Sets")
    const setsRange = await harness.page.getByTestId("view-scroller").evaluate((element) => element.scrollHeight - element.clientHeight)
    const setsTarget = Math.min(60, setsRange)
    if (setsTarget > 0) await scrollTo(harness, "Sets", setsTarget)
    await harness.dock().getByRole("button", { name: "Binder", exact: true }).click()
    await openTab(harness, "Sets")
    await expect.poll(scrollTopOf(harness, "Sets")).toBeGreaterThanOrEqual(setsTarget - 2)
    await openTab(harness, "List")
    await expect.poll(scrollTopOf(harness, "List")).toBeGreaterThanOrEqual(400 - LIST_TOLERANCE_PX)
  })

  test("Wanted keeps its place after leaving the page and coming back", async ({ harness }) => {
    const { page } = harness
    await seedWantList(page, LONG_WANT_LIST)
    await page.reload()
    await expect(harness.dock()).toBeVisible({ timeout: 30_000 })
    await openTab(harness, "Wanted")
    const range = await scrollRange(harness, "Wanted")
    const target = Math.min(300, Math.floor(range / 2))
    await scrollTo(harness, "Wanted", target)

    await page.goto("/app")
    await page.goBack()
    await expect(harness.dock()).toBeVisible({ timeout: 30_000 })
    await openTab(harness, "Wanted")
    await expect.poll(scrollTopOf(harness, "Wanted"), { timeout: 10_000 }).toBeGreaterThanOrEqual(target - 2)
  })
})
