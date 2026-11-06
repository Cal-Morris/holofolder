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
  if (!(await page.evaluate(() => JSON.parse(localStorage.getItem("binderdex:show-mode:v1") ?? "null")?.on))) {
    await page.getByRole("button", { name: "Show mode", exact: true }).click()
  }
  await expect(page.getByRole("region", { name: "Show mode", exact: true })).toBeVisible()
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Search", exact: true }).click()
}

// Synthetic backend model. Real PostgreSQL authorization, retry and concurrency are verified separately
// by scripts/verify-binder-history.ts; this fixture checks the browser's scope and offline lifecycle.
class HistoryBackend {
  data = new Map<string, HistorySnapshot>()
  requests: Array<{ binder: string; owner: string; account: string; actions: HistoryAction[] }> = []
  delay: (() => Promise<void>) | null = null
  private receipts = new Map<string, number>()
  private owners = new Map<string, string>()
  async install(page: Page) {
    await page.route(rpc, async route => {
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
      await this.delay?.()
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

async function readQueue(page: Page) {
  return page.evaluate(async ({ binder, owner }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("binderdex-history", 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      return await new Promise<import("../lib/binder-history").HistoryStore>((resolve, reject) => {
        const request = db.transaction("history").objectStore("history").get(`binderdex:history:v1:${owner}:${owner}:${binder}`)
        request.onsuccess = () => resolve(JSON.parse(request.result))
        request.onerror = () => reject(request.error)
      })
    } finally { db.close() }
  }, { binder: BINDER, owner: OWNER })
}
async function pick(page: Page, name: string) {
  await show(page).getByRole("searchbox").fill(name)
  await show(page).getByRole("region", { name: "Cards", exact: true }).getByRole("button", { name: new RegExp(`${name}, 151 ${name === "bulbasaur" ? "166" : "168"}`, "i") }).click()
  await show(page).getByTestId("quick-card-check").getByRole("button", { name: /^Back/ }).first().click()
  await show(page).getByRole("searchbox").fill("")
}
async function online(page: Page, value: boolean) {
  await page.evaluate(value => {
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => value })
    if (value) window.dispatchEvent(new Event("online"))
  }, value)
}

test.describe("same-origin history transactions", () => {
  test.use({ signedIn: true })
  test("simultaneous tabs retain both queues across an offline tab close and reload", async ({ page, context, baseURL, harness }) => {
    void harness
    const server = new HistoryBackend()
    await server.install(page)
    await page.goto("/e2e-harness?signedIn=1&binders=1")
    const other = await context.newPage()
    await mockBackends(other, context, { signedIn: true, baseURL })
    await server.install(other)
    await other.goto("/e2e-harness?signedIn=1&binders=1")
    await openShow(page)
    await openShow(other)
    await show(page).getByRole("searchbox").fill("bulbasaur")
    await show(other).getByRole("searchbox").fill("charmander")
    await expect(show(page).getByRole("button", { name: /Bulbasaur, 151 166/ })).toBeVisible()
    await expect(show(other).getByRole("button", { name: /Charmander, 151 168/ })).toBeVisible()
    await Promise.all([online(page, false), online(other, false)])
    await Promise.all([pick(page, "bulbasaur"), pick(other, "charmander")])
    await expect.poll(async () => (await readQueue(page)).cards.length).toBe(2)
    const queued = await readQueue(page)
    expect(new Set(queued.pending.map(action => action.seq)).size).toBe(4)
    expect(queued.pending).toHaveLength(4)
    await other.close()
    // A full reload while still offline retains the durable shared queue.
    await page.addInitScript(() => Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false }))
    await page.reload()
    await openShow(page)
    await expect(rail(page).getByRole("button", { name: /Bulbasaur,/ })).toBeVisible()
    await expect(rail(page).getByRole("button", { name: /Charmander,/ })).toBeVisible()
    expect((await readQueue(page)).pending).toHaveLength(4)
    await online(page, true)
    await expect.poll(() => server.data.get(BINDER)?.cards.length).toBe(2)
    await expect.poll(async () => (await readQueue(page)).pending.length).toBe(0)
    expect(server.data.get(BINDER)?.searches.sort()).toEqual(["bulbasaur", "charmander"])
  })

  test("delayed pre-clear response cannot restore history or poison the next search", async ({ page, context, baseURL, harness }) => {
    void harness
    const server = new HistoryBackend()
    await server.install(page)
    await page.goto("/e2e-harness?signedIn=1&binders=1")
    await openShow(page)
    await pick(page, "bulbasaur")
    await expect.poll(async () => (await readQueue(page)).pending.length).toBe(0)
    const other = await context.newPage()
    await mockBackends(other, context, { signedIn: true, baseURL })
    await server.install(other)
    await other.goto("/e2e-harness?signedIn=1&binders=1")
    await openShow(other)
    await expect(rail(other).getByRole("button", { name: /Bulbasaur,/ })).toBeVisible()
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    let delayed = false
    server.delay = async () => { delayed = true; await held }
    await page.evaluate(() => window.dispatchEvent(new Event("focus")))
    await expect.poll(() => delayed).toBe(true)
    const count = server.requests.length
    await show(other).getByRole("button", { name: "Clear recently viewed cards for this binder" }).click()
    await show(other).getByRole("button", { name: "Clear recent searches for this binder" }).click()
    await pick(other, "charmander")
    await expect.poll(async () => (await readQueue(page)).searches).toEqual(["charmander"])
    expect(server.requests.length).toBe(count)
    expect((await readQueue(page)).pending).toHaveLength(4)
    await other.close()
    server.delay = null
    release()
    await expect.poll(async () => (await readQueue(page)).pending.length).toBe(0)
    expect(server.data.get(BINDER)?.searches).toEqual(["charmander"])
    expect(server.data.get(BINDER)?.cards.map(card => card.id)).toEqual(["sv03.5-168"])
    await page.reload()
    await openShow(page)
    await expect(rail(page).getByRole("button", { name: /Charmander,/ })).toBeVisible()
    await expect(rail(page).getByRole("button", { name: /Bulbasaur,/ })).toHaveCount(0)
    await pick(page, "bulbasaur")
    await expect.poll(() => server.data.get(BINDER)?.searches).toEqual(["bulbasaur", "charmander"])
  })

  test("binder switch ignores the old hook's delayed response", async ({ page, harness }) => {
    void harness
    const server = new HistoryBackend()
    await server.install(page)
    await page.goto("/e2e-harness?signedIn=1&binders=1")
    await openShow(page)
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    let delayed = false
    server.delay = async () => { server.delay = null; delayed = true; await held }
    await pick(page, "bulbasaur")
    await expect.poll(() => delayed).toBe(true)
    const before = await readQueue(page)
    expect(before.pending.length).toBeGreaterThan(0)
    await show(page).getByRole("button", { name: "Close quick mode" }).click()
    await page.getByTestId("binder-switcher-trigger").click()
    await page.getByRole("dialog", { name: "Binders" }).getByRole("button", { name: /^Trades/ }).click()
    await expect(page.getByTestId("binder-switcher-trigger")).toHaveAttribute("aria-label", "Binders: Trades")
    await expect.poll(() => server.requests.some(request => request.binder === OTHER)).toBe(true)
    release()
    // Waiting on the same lock proves the obsolete callback has completed before inspecting disk.
    await page.evaluate(async ({ binder, owner }) => {
      await navigator.locks.request(`binderdex:history:v1:${owner}:${owner}:${binder}:sync`, () => {})
    }, { binder: BINDER, owner: OWNER })
    expect(await readQueue(page)).toEqual(before)
    await openShow(page)
    await expect(rail(page)).toHaveCount(0)
    expect(server.data.get(OTHER)?.cards).toEqual([])
  })

  test("without Web Locks, edits stay durable locally and no unsafe sync is sent", async ({ page, harness }) => {
    void harness
    const server = new HistoryBackend()
    await server.install(page)
    await page.addInitScript(() => Object.defineProperty(navigator, "locks", { value: undefined }))
    await page.goto("/e2e-harness?signedIn=1&binders=1")
    await openShow(page)
    await pick(page, "bulbasaur")
    await expect.poll(async () => (await readQueue(page)).pending.length).toBe(2)
    await page.reload()
    await openShow(page)
    await expect(rail(page).getByRole("button", { name: /Bulbasaur,/ })).toBeVisible()
    expect(server.requests).toHaveLength(0)
    expect((await readQueue(page)).pending).toHaveLength(2)
  })

})
