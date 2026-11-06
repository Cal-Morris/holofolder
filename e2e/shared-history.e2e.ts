import type { Page } from "@playwright/test"
import { test, expect, mockBackends, emulateStandalone } from "./fixtures"
import { applyHistoryAction, emptyHistory, type HistoryAction, type HistorySnapshot } from "../lib/binder-history"

const BINDER = "e2e00000-0000-4000-8000-000000000001"
const OTHER = "e2e00000-0000-4000-8000-000000000002"
const OWNER = "00000000-0000-4000-8000-0000000000e2"
const rpc = "**/rest/v1/rpc/sync_binder_history"
const show = (page: Page) => page.getByRole("dialog", { name: "Quick mode" })
const rail = (page: Page) => show(page).getByRole("region", { name: "Recently viewed cards" })
async function openShow(page: Page) {
  if (!(await page.getByRole("region", { name: "Show mode", exact: true }).isVisible())) await page.getByRole("button", { name: "Show mode", exact: true }).click()
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Search", exact: true }).click()
}

// Synthetic backend model. Real PostgreSQL authorization, retry and concurrency are verified separately
// by scripts/verify-binder-history.ts; this fixture checks the browser's scope and offline lifecycle.
class HistoryBackend {
  data = new Map<string, HistorySnapshot>()
  requests: Array<{ binder: string; owner: string; account: string; actions: HistoryAction[] }> = []
  private receipts = new Map<string, number>()
  private owners = new Map<string, string>()
  async install(page: Page) {
    await page.route(rpc, route => {
      const body = route.request().postDataJSON()
      this.requests.push({ binder: body.target_binder, owner: body.expected_owner, account: body.expected_account, actions: body.actions })
      const owner = this.owners.get(body.target_binder)
      if (owner && owner !== body.expected_owner) return route.fulfill({ status: 403, json: { message: "Binder not found" } })
      this.owners.set(body.target_binder, body.expected_owner)
      let state = this.data.get(body.target_binder) ?? emptyHistory()
      const key = `${body.target_binder}:${body.device_id}`
      let last = this.receipts.get(key) ?? 0
      for (const action of body.actions as HistoryAction[]) {
        if (action.seq <= last) continue
        last = action.seq
        state = applyHistoryAction(state, action)
      }
      this.receipts.set(key, last)
      this.data.set(body.target_binder, state)
      return route.fulfill({ json: state })
    })
  }
}

test.describe("shared binder history", () => {
  test.use({ signedIn: true })
  test("two devices share cards and searches, offline reconnect merges and shared Clear defeats stale queues", async ({ harness, page, browser, baseURL, standalone, insets }) => {
    const server = new HistoryBackend()
    await server.install(page)
    await page.goto("/e2e-harness?signedIn=1&binders=1")
    const otherContext = await browser.newContext({ viewport: page.viewportSize()!, serviceWorkers: "block" })
    try {
      const other = await otherContext.newPage()
      if (standalone) await emulateStandalone(other, insets)
      await mockBackends(other, otherContext, { signedIn: true, baseURL })
      await server.install(other)
      await other.goto(`${baseURL}/e2e-harness?signedIn=1&binders=1`)
      await openShow(page)
      await openShow(other)
      const search = show(page).getByRole("searchbox")
      await search.fill("bulbasaur")
      await expect(show(page).getByRole("region", { name: "Cards", exact: true }).getByRole("button", { name: /Bulbasaur, 151 166/ })).toBeVisible()
      expect(server.requests.flatMap(request => request.actions)).toHaveLength(0)
      await show(page).getByRole("region", { name: "Cards", exact: true }).getByRole("button", { name: /Bulbasaur, 151 166/ }).click()
      await expect.poll(() => server.data.get(BINDER)?.cards.length).toBe(1)
      await expect.poll(() => server.data.get(BINDER)?.searches).toEqual(["bulbasaur"])
      await other.evaluate(() => window.dispatchEvent(new Event("focus")))
      await expect(rail(other).getByRole("button", { name: /Bulbasaur,/ })).toBeVisible()
      await expect(show(other).getByRole("region", { name: "Recent searches" }).getByRole("button", { name: "bulbasaur", exact: true })).toBeVisible()

      // A disconnected device adds a card against the pre-clear generation.
      await other.evaluate(() => Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false }))
      await rail(other).getByRole("button", { name: /Bulbasaur,/ }).click()
      await show(other).getByTestId("quick-card-check").getByRole("button", { name: /^Back/ }).first().click()
      await show(page).getByTestId("quick-card-check").getByRole("button", { name: /^Back/ }).first().click()
      await search.fill("")
      await harness.expectMinTapTarget(show(page).getByRole("button", { name: "Clear recent searches for this binder" }), 36)
      await harness.expectMinTapTarget(show(page).getByRole("region", { name: "Recent searches" }).getByRole("button", { name: "bulbasaur", exact: true }), 36)
      await show(page).getByRole("button", { name: "Clear recently viewed cards for this binder" }).click()
      await show(page).getByRole("button", { name: "Clear recent searches for this binder" }).click()
      await expect.poll(() => server.data.get(BINDER)?.cards.length).toBe(0)
      await expect.poll(() => server.data.get(BINDER)?.searches.length).toBe(0)
      await other.evaluate(() => {
        Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true })
        window.dispatchEvent(new Event("online"))
      })
      await expect(rail(other)).toHaveCount(0)
      await expect(show(other).getByRole("region", { name: "Recent searches" })).toHaveCount(0)
      expect(server.data.get(BINDER)?.cards).toEqual([])

      // New actions made after learning the clear are accepted and survive a full reload.
      await show(other).getByRole("searchbox").fill("charmander")
      await show(other).getByRole("region", { name: "Cards", exact: true }).getByRole("button", { name: /Charmander, 151 168/ }).click()
      await expect.poll(() => server.data.get(BINDER)?.cards[0]?.id).toBe("sv03.5-168")
      await page.reload()
      await openShow(page)
      await expect(rail(page).getByRole("button", { name: /Charmander,/ })).toBeVisible()
      await harness.expectNoHorizontalOverflow()
      expect(server.requests.every(request => request.binder === BINDER && request.owner === OWNER && request.account === OWNER)).toBe(true)
    } finally { await otherContext.close() }
  })

  test("binder/account caches stay separate; legacy global history and read-only shares never sync", async ({ harness }) => {
    const { page } = harness
    const server = new HistoryBackend()
    await server.install(page)
    await page.evaluate(() => {
      localStorage.setItem("binderdex:recent-cards:v1", JSON.stringify([{ id: "private-1", name: "Private", number: "#1", setName: "Private", dexId: 1, pokemonName: "bulbasaur", viewedAt: "2026-01-01" }]))
      localStorage.setItem("binderdex:quick-searches:v1", JSON.stringify(["private old query"]))
    })
    await page.goto("/e2e-harness?signedIn=1&binders=1")
    await openShow(page)
    await expect(rail(page)).toHaveCount(0)
    await expect(show(page).getByRole("region", { name: "Recent searches" })).toHaveCount(0)
    await show(page).getByRole("searchbox").fill("charmander")
    const picked = show(page).getByRole("region", { name: "Cards", exact: true }).getByRole("button", { name: /Charmander, 151 168/ })
    await expect(picked).toBeVisible()
    await page.evaluate(() => Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false }))
    await picked.click()
    await expect(show(page).getByTestId("quick-card-check")).toBeVisible()
    await page.goto(`/e2e-harness?signedIn=1&binders=1&binder=${OTHER}`)
    await openShow(page)
    await expect(rail(page)).toHaveCount(0)
    await expect.poll(() => server.requests.some(request => request.binder === OTHER)).toBe(true)
    expect(server.data.get(BINDER)?.cards ?? []).toHaveLength(0)
    expect(server.requests.filter(request => request.binder === OTHER).flatMap(request => request.actions)).toHaveLength(0)
    await page.goto("/e2e-harness?signedIn=1&binders=1")
    await expect.poll(() => server.data.get(BINDER)?.cards.length).toBe(1)
    await page.route("**/rest/v1/partnerships**", route => route.fulfill({ json: [{ owner_user_id: "00000000-0000-4000-8000-0000000000e3", user1_id: OWNER, user2_id: "00000000-0000-4000-8000-0000000000e3" }] }))
    await page.goto("/e2e-harness?signedIn=1&binders=1&partner=1")
    await expect.poll(() => server.requests.some(request => request.owner === "00000000-0000-4000-8000-0000000000e3")).toBe(true)
    await openShow(page)
    await expect(rail(page)).toHaveCount(0)
    // Tear down the previous page before observing read-only requests, so its in-flight focus
    // refresh cannot be attributed to the share view.
    await page.goto("about:blank")
    let privateRequests = 0
    await page.route(rpc, route => { privateRequests++; return route.abort() })
    await page.goto("/e2e-harness?signedIn=1&binders=1&readOnly=1")
    await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Search", exact: true }).click()
    await expect(show(page)).toBeVisible()
    await expect(page.getByRole("region", { name: "Recently viewed cards" })).toHaveCount(0)
    expect(privateRequests).toBe(0)
    expect(server.requests.flatMap(request => request.actions).some(action => JSON.stringify(action).includes("private"))).toBe(false)
  })
})
