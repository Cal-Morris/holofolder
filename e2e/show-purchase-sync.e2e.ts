import type { Locator, Page } from "@playwright/test"
import { test, expect, E2E_USER, SUPABASE_URL, type Harness } from "./fixtures"
import { mockCardPrices } from "./price-fixtures"

const SCREENS = process.env.E2E_SCREENSHOT_DIR
const QUEUE_KEY = "binderdex:show-purchase-queue:v1"

async function screenshot(harness: Harness, name: string) {
  if (SCREENS && test.info().project.name.startsWith("standalone-390")) await harness.page.screenshot({ path: `${SCREENS}/quick-${name}.png` })
}

const banner = (harness: Harness) => harness.page.getByRole("region", { name: "Show mode" })
const quickDialog = (harness: Harness) => harness.page.getByRole("dialog", { name: "Quick mode" })

type Row = Record<string, unknown> & { client_id: string }

/** public.show_purchases with its real unique key: inserts ignore a client_id that is already there. */
async function mockShowPurchases(page: Page, initial: Row[] = []) {
  const account = { rows: new Map(initial.map((row) => [row.client_id, row])), posts: [] as Array<{ url: string; prefer: string; body: Row[] }>, deletes: [] as string[] }
  await page.route(`${SUPABASE_URL}/rest/v1/show_purchases**`, async (route) => {
    const request = route.request()
    const method = request.method()
    if (method === "POST") {
      const body = request.postDataJSON() as Row[] | Row
      const rows = Array.isArray(body) ? body : [body]
      account.posts.push({ url: request.url(), prefer: request.headers()["prefer"] ?? "", body: rows })
      for (const row of rows) if (!account.rows.has(row.client_id)) account.rows.set(row.client_id, row)
      return route.fulfill({ status: 201, body: "" })
    }
    if (method === "DELETE") {
      const ids = (new URL(request.url()).searchParams.get("client_id") ?? "").replace(/^in\.\(|\)$/g, "").split(",").map((id) => id.replace(/"/g, ""))
      for (const id of ids) { account.deletes.push(id); account.rows.delete(id) }
      return route.fulfill({ status: 204, body: "" })
    }
    return route.fulfill({ json: [...account.rows.values()] })
  })
  return account
}

async function openShowMode(harness: Harness) {
  if (!(await banner(harness).isVisible())) await harness.page.getByRole("button", { name: "Show mode", exact: true }).click()
  await harness.page.getByRole("button", { name: "Search", exact: true }).click()
  await expect(quickDialog(harness)).toBeVisible()
  return quickDialog(harness)
}

async function checkCharizard(harness: Harness) {
  const dialog = await openShowMode(harness)
  await dialog.getByRole("searchbox").fill("charizard")
  await dialog.getByRole("region", { name: "Cards" }).getByRole("button", { name: /^Charizard ex, 151 / }).first().click()
  const check = dialog.getByTestId("quick-card-check")
  await expect(check.getByTestId("quick-card-market-price")).toHaveText("£10.00")
  return check
}

async function typePrice(scope: Locator, price: string) {
  const input = scope.getByRole("textbox", { name: /price/i })
  await input.fill(price)
  await input.press("Enter")
  await expect(input).toHaveValue(price)
}

const queueLength = (page: Page) => page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "[]").length, QUEUE_KEY)

test.describe("show purchases on the account", () => {
  test.use({ signedIn: true })

  test("bought offline: queued on the device, sent once when back online, never duplicated", async ({ harness }) => {
    const { page } = harness
    await mockCardPrices(page, { "sv03.5-006": { market: 10, confidence: "high" } })
    const account = await mockShowPurchases(page)
    // The deal check is lazy-loaded (precached by the service worker in the app, blocked here): open it online.
    const check = await checkCharizard(harness)

    await page.context().setOffline(true)
    await typePrice(check, "8")
    await check.getByRole("button", { name: "Bought", exact: true }).click()
    await expect(check.getByTestId("quick-card-status")).toHaveText("Owned")
    await page.keyboard.press("Escape")
    await expect(banner(harness)).toContainText("1 bought · £8.00 · Offline")
    await expect.poll(() => queueLength(page)).toBe(1)
    await screenshot(harness, "show-purchase-queued")
    expect(account.posts).toHaveLength(0)

    await page.context().setOffline(false)
    await expect.poll(() => account.posts.length).toBe(1)
    const [post] = account.posts
    expect(new URL(post.url).searchParams.get("on_conflict")).toBe("owner_user_id,client_id")
    expect(post.prefer).toContain("resolution=ignore-duplicates")
    expect(post.body).toHaveLength(1)
    expect(post.body[0]).toMatchObject({ owner_user_id: E2E_USER.id, card_id: "sv03.5-006", card_name: "Charizard ex", price: 8, market_price: 10, currency: "GBP" })
    await expect.poll(() => queueLength(page)).toBe(0)
    await expect(banner(harness)).toContainText("1 bought · £8.00")

    // Reloading (or the next sync) doesn't send it again or count it twice.
    await page.reload()
    await expect(banner(harness)).toContainText("1 bought · £8.00")
    await page.waitForTimeout(800)
    expect(account.posts).toHaveLength(1)
    expect(account.rows.size).toBe(1)
  })

  test("a fresh install or a partner's phone shows the show's purchases, and Undo deletes from the account", async ({ harness }) => {
    const { page } = harness
    await mockCardPrices(page, { "sv03.5-006": { market: 10, confidence: "high" } })
    const boughtAt = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const account = await mockShowPurchases(page, [
      { owner_user_id: E2E_USER.id, client_id: "partner-1", card_id: "sv03.5-007", card_name: "Squirtle", language: "en", finish: "normal", price: 12, market_price: 15, currency: "GBP", bought_at: boughtAt, bundle_id: null },
      // A purchase from an earlier show stays out of today's tally.
      { owner_user_id: E2E_USER.id, client_id: "old-show", card_id: "sv03.5-004", card_name: "Charmander", language: "en", finish: "normal", price: 99, market_price: null, currency: "GBP", bought_at: new Date(Date.now() - 3 * 86_400_000).toISOString(), bundle_id: null },
    ])
    await page.reload()
    await page.getByRole("button", { name: "Show mode", exact: true }).click()
    await expect(banner(harness)).toContainText("1 bought · £12.00")
    await harness.expectNoHorizontalOverflow()
    await screenshot(harness, "show-purchase-synced")

    const check = await checkCharizard(harness)
    await typePrice(check, "8")
    await check.getByRole("button", { name: "Bought", exact: true }).click()
    await expect.poll(() => account.posts.length).toBe(1)
    const clientId = account.posts[0].body[0].client_id
    await page.getByTestId("undo-snackbar").getByRole("button", { name: "Undo", exact: true }).click()
    await expect.poll(() => account.deletes).toEqual([clientId])
    await page.keyboard.press("Escape")
    await expect(banner(harness)).toContainText("1 bought · £12.00")
    await expect.poll(() => queueLength(page)).toBe(0)
  })

  test("Show mode Pokémon results say Not in binder", async ({ harness }) => {
    const dialog = await openShowMode(harness)
    await dialog.getByRole("searchbox").fill("charmeleon")
    await expect(dialog.getByRole("region", { name: "Pokémon" }).getByRole("button", { name: /charmeleon/i })).toContainText("Not in binder")
  })
})
