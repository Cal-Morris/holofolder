import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures"
import { FakeCollectionServer, setNetwork } from "./collection-server"

async function openDetail(page: Page, dexId: number) {
  await page.locator(`button[data-dex-id="${dexId}"]`).first().click()
  const dialog = page.getByRole("dialog", { name: /details$/i })
  await expect(dialog).toBeVisible()
  await dialog.locator("summary").filter({ hasText: "Card & variant" }).click()
  return dialog
}

async function closeDetail(page: Page) {
  // Escape, because the (pre-existing) offline pill sits over the sheet's close button on small phones.
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog", { name: /details$/i })).toHaveCount(0)
}

const syncStatus = (page: Page) => page.locator("[data-sync-status]")

test.describe("offline writes", () => {
  test.use({ signedIn: true, serviceWorkers: "allow" })

  test("edits made offline survive an offline reload and sync once on reconnect, merging a concurrent change", async ({ harness }) => {
    const { page } = harness
    const server = new FakeCollectionServer()
    await server.install(page)

    // Let the service worker take control and cache the page, as after a first visit.
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined))
    await page.reload()
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
    await expect(harness.dock()).toBeVisible()

    const charmanderTiles = await page.locator('button[data-dex-id="4"]').count()
    await setNetwork(page, true)
    await expect(page.getByText(/^Offline · /)).toBeVisible()

    // Edit 1: Charmander becomes a holo. Edit 2: Bulbasaur is cleared.
    let detail = await openDetail(page, 4)
    await detail.getByRole("button", { name: "Holo", exact: true }).click()
    await expect(detail.getByRole("button", { name: "Holo", exact: true })).toHaveAttribute("aria-pressed", "true")
    await closeDetail(page)
    detail = await openDetail(page, 1)
    await detail.getByRole("button", { name: "Remove owned card", exact: true }).click()
    await page.getByRole("dialog", { name: /^remove bulbasaur$/i }).getByRole("button", { name: /remove completely/i }).click()
    await expect(page.getByText("Offline · 2 changes to sync")).toBeVisible()
    if (await page.getByRole("dialog", { name: /details$/i }).count()) await closeDetail(page)
    expect(server.writes, "nothing is sent while offline").toEqual([])

    // Reload while offline: the page comes from the service worker and the queued edits are still applied.
    await page.reload()
    await expect(harness.dock()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText("Offline · 2 changes to sync")).toBeVisible()
    detail = await openDetail(page, 4)
    await expect(detail.getByRole("button", { name: "Holo", exact: true })).toHaveAttribute("aria-pressed", "true")
    await closeDetail(page)

    // Meanwhile a partner adds a wanted card to Charmander on the server.
    const charmander = server.rows.get(4)!
    server.rows.set(4, { ...charmander, wanted_cards: [{ card_id: "sv03.5-168", card_name: "Charmander", card_language: "en", card_finish: "normal", added_at: "2026-10-09T00:00:00.000Z" }] })

    await setNetwork(page, false)
    await expect.poll(() => server.rows.has(1), { timeout: 20_000 }).toBe(false)
    await expect.poll(() => server.rows.get(4)?.card_finish, { timeout: 20_000 }).toBe("holo")
    expect((server.rows.get(4)!.wanted_cards as Array<{ card_id: string }>).map((card) => card.card_id), "partner's change kept").toEqual(["sv03.5-168"])
    await expect(syncStatus(page)).toHaveCount(0, { timeout: 15_000 })

    // Exactly one successful write per edit (the Charmander one after one 409 + merge), no duplicates.
    const summary = (status: number) => server.writes
      .filter((write) => write.status === status)
      .map((write) => `${write.method} #${write.pokemonId}`)
      .sort()
    expect(summary(200)).toEqual(["DELETE #1", "POST #4"])
    expect(summary(409)).toEqual(["POST #4"])
    expect([...server.rows.keys()].sort((a, b) => a - b)).toEqual([4])
    expect(await page.evaluate(() => localStorage.getItem("pokemon_collection_pending_ops_v1"))).toBe("[]")

    // The UI shows the synced result (server row adopted, nothing duplicated or reverted).
    detail = await openDetail(page, 4)
    await expect(detail.getByRole("button", { name: "Holo", exact: true })).toHaveAttribute("aria-pressed", "true")
    await closeDetail(page)
    expect(await page.locator('button[data-dex-id="4"]').count()).toBe(charmanderTiles)
  })

  test("a temporary server failure is retried with backoff and shows as pending", async ({ harness }) => {
    const { page } = harness
    const server = new FakeCollectionServer()
    await server.install(page)
    server.failNext.push({ method: "POST", pokemonId: 4, status: 503 }, { method: "POST", pokemonId: 4, status: 502 })

    const detail = await openDetail(page, 4)
    await detail.getByRole("button", { name: "Holo", exact: true }).click()
    await expect(syncStatus(page)).toHaveAttribute("data-sync-status", "waiting")
    await expect(syncStatus(page)).toHaveText("1 change syncing · retrying")
    await expect.poll(() => server.rows.get(4)?.card_finish, { timeout: 20_000 }).toBe("holo")
    await expect(syncStatus(page)).toHaveCount(0, { timeout: 15_000 })
    expect(server.writes.map((write) => write.status)).toEqual([503, 502, 200])
    // ~2 s then ~4 s (±25% jitter): retried with growing delays, not in a tight loop.
    expect(server.writes[1].at - server.writes[0].at).toBeGreaterThanOrEqual(1_400)
    expect(server.writes[2].at - server.writes[1].at).toBeGreaterThanOrEqual(2_900)
  })

  test("a change the server rejects is rolled back and explained", async ({ harness }) => {
    const { page } = harness
    const server = new FakeCollectionServer()
    await server.install(page)
    server.failNext.push({ method: "POST", pokemonId: 4, status: 422 })

    const detail = await openDetail(page, 4)
    await detail.getByRole("button", { name: "Holo", exact: true }).click()
    await expect(page.getByText(/couldn't save your change to charmander\. it was undone\./i)).toBeVisible()
    await expect(detail.getByRole("button", { name: "Normal", exact: true })).toHaveAttribute("aria-pressed", "true")
    expect(server.rows.get(4)?.card_finish).toBe("normal")
    expect(await page.evaluate(() => localStorage.getItem("pokemon_collection_pending_ops_v1") ?? "[]")).toBe("[]")
    await page.getByRole("button", { name: "Dismiss" }).click()
    await expect(syncStatus(page)).toHaveCount(0)
  })
})
