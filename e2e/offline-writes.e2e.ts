import type { Page, Route } from "@playwright/test"
import { collectionFingerprint } from "../lib/collection/sync"
import { normalizeCollectionItem } from "../lib/collection/normalize"
import type { CollectedPokemon } from "../lib/domain/cards"
import { expect, SEEDED_COLLECTION, SUPABASE_URL, test } from "./fixtures"

type Row = Record<string, unknown> & { pokemon_id: number }

/**
 * In-memory stand-in for pokemon_collection behind /api/collection, with the same contract as the real route:
 * upsert on (user, pokemon_id), delete by key, and compare-and-set via baseFingerprint (409 + current row).
 */
class FakeCollectionServer {
  rows = new Map<number, Row>()
  writes: Array<{ method: string; pokemonId: number; status: number; at: number }> = []
  failNext: Array<{ method: string; pokemonId: number; status: number }> = []

  constructor() {
    for (const row of SEEDED_COLLECTION) this.rows.set(row.pokemon_id, { ...row })
  }

  fingerprint(pokemonId: number) {
    const row = this.rows.get(pokemonId)
    return collectionFingerprint(row ? normalizeCollectionItem(row as Partial<CollectedPokemon>) : null)
  }

  async install(page: Page) {
    await page.route("**/api/collection**", (route) => this.handle(route))
    await page.route(`${SUPABASE_URL}/rest/v1/pokemon_collection**`, (route) =>
      route.request().method() === "GET"
        ? route.fulfill({ json: [...this.rows.values()].sort((a, b) => a.pokemon_id - b.pokemon_id) })
        : route.fallback())
  }

  private async handle(route: Route) {
    const request = route.request()
    const url = new URL(request.url())
    const method = request.method()
    const body = method === "POST" ? request.postDataJSON() : null
    const pokemonId = Number(method === "POST" ? body?.pokemonId : url.searchParams.get("pokemonId"))
    const baseFingerprint = method === "POST" ? body?.baseFingerprint : url.searchParams.get("baseFingerprint")

    const failure = this.failNext.findIndex((entry) => entry.method === method && entry.pokemonId === pokemonId)
    if (failure >= 0) {
      const [{ status }] = this.failNext.splice(failure, 1)
      this.writes.push({ method, pokemonId, status, at: Date.now() })
      return route.fulfill({ status, json: { error: `simulated ${status}` } })
    }

    if (typeof baseFingerprint === "string" && baseFingerprint && baseFingerprint !== this.fingerprint(pokemonId)) {
      this.writes.push({ method, pokemonId, status: 409, at: Date.now() })
      return route.fulfill({ status: 409, json: { error: "changed", item: this.rows.get(pokemonId) ?? null } })
    }

    if (method === "DELETE") {
      this.rows.delete(pokemonId)
      this.writes.push({ method, pokemonId, status: 200, at: Date.now() })
      return route.fulfill({ json: { success: true } })
    }

    const existing = this.rows.get(pokemonId)
    const row: Row = {
      id: existing?.id ?? `server-${pokemonId}`,
      user_id: "00000000-0000-4000-8000-0000000000e2",
      pokemon_id: pokemonId,
      pokemon_name: body.pokemonName,
      card_id: body.cardId ?? null,
      card_name: body.cardName ?? null,
      card_image: body.cardImage ?? null,
      card_set: body.cardSet ?? null,
      card_language: body.cardLanguage ?? "en",
      card_finish: body.cardFinish ?? "normal",
      wanted_cards: body.wantedCards ?? [],
      status: body.status ?? "collected",
      collected_at: existing?.collected_at ?? new Date().toISOString(),
    }
    this.rows.set(pokemonId, row)
    this.writes.push({ method, pokemonId, status: 200, at: Date.now() })
    return route.fulfill({ json: { item: row } })
  }
}

const cdpSessions = new WeakMap<Page, Awaited<ReturnType<ReturnType<Page["context"]>["newCDPSession"]>>>()

async function setNetwork(page: Page, offline: boolean) {
  await page.context().setOffline(offline)
  // CDP keeps navigator.onLine right in emulated standalone mode too (the session must stay attached).
  let session = cdpSessions.get(page)
  if (!session) {
    session = await page.context().newCDPSession(page)
    cdpSessions.set(page, session)
  }
  await session.send("Network.emulateNetworkConditions", { offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(!offline)
}

async function openDetail(page: Page, dexId: number) {
  await page.locator(`button[data-dex-id="${dexId}"]`).first().click()
  const dialog = page.getByRole("dialog", { name: /details$/i })
  await expect(dialog).toBeVisible()
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
    await expect(page.getByText("Offline mode")).toBeVisible()

    // Edit 1: Charmander becomes a holo. Edit 2: Bulbasaur is cleared.
    let detail = await openDetail(page, 4)
    await detail.getByRole("button", { name: "Holo", exact: true }).click()
    await expect(detail.getByRole("button", { name: "Holo", exact: true })).toHaveAttribute("aria-pressed", "true")
    await closeDetail(page)
    detail = await openDetail(page, 1)
    await detail.getByRole("button", { name: "Clear", exact: true }).click()
    await expect(page.getByText(/2 changes will sync when you're back online/)).toBeVisible()
    if (await page.getByRole("dialog", { name: /details$/i }).count()) await closeDetail(page)
    expect(server.writes, "nothing is sent while offline").toEqual([])

    // Reload while offline: the page comes from the service worker and the queued edits are still applied.
    await page.reload()
    await expect(harness.dock()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(/2 changes will sync when you're back online/)).toBeVisible()
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
    await expect(syncStatus(page)).toHaveText(/1 change waiting to sync, retrying/)
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
