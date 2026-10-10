import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures"

// Read a record from the app's IndexedDB offline store (lib/offline-store/kv.ts).
function readRecord<T = unknown>(page: Page, key: string) {
  return page.evaluate((recordKey) => new Promise<unknown>((resolve) => {
    const open = indexedDB.open("binderdex-offline")
    open.onerror = () => resolve(null)
    open.onsuccess = () => {
      const db = open.result
      if (!db.objectStoreNames.contains("records")) {
        db.close()
        resolve(null)
        return
      }
      const request = db.transaction("records", "readonly").objectStore("records").get(recordKey)
      request.onsuccess = () => {
        db.close()
        resolve(request.result ?? null)
      }
      request.onerror = () => {
        db.close()
        resolve(null)
      }
    }
  }), key) as Promise<T | null>
}

const BASE_SET = { id: "base1", name: "Base Set", seriesName: "Base", officialCardCount: 102, releaseDate: "1999-01-09" }
const BASE_SET_SLOTS = [
  {
    dexId: 1,
    pokemonName: "Bulbasaur",
    cards: [{ id: "base1-44", localId: "44", name: "Bulbasaur", language: "en", set: BASE_SET, rarity: "Common", inferredFinish: "normal" }],
  },
  {
    dexId: 4,
    pokemonName: "Charmander",
    cards: [{ id: "base1-46", localId: "46", name: "Charmander", language: "en", set: BASE_SET, rarity: "Common", inferredFinish: "normal" }],
  },
]

test.describe("IndexedDB offline store", () => {
  test.use({ signedIn: true })

  test("keeps the collection, pending edits and last-known prices in IndexedDB", async ({ harness }) => {
    const { page } = harness
    await expect.poll(async () => {
      const record = await readRecord<{ collection: Array<{ pokemon_id: number }>; pendingOperations: unknown[] }>(page, "collection")
      return record?.collection.map((item) => item.pokemon_id).sort((a, b) => a - b) ?? null
    }, { timeout: 15_000 }).toEqual([1, 4])
    expect(await readRecord(page, "meta:migrated-from-local-storage")).not.toBeNull()

    // Prices are copied from the app's own price cache (filled by the mocked /api/card-prices).
    await expect.poll(async () => {
      const record = await readRecord<{ prices: Record<string, { cardId: string; marketGbpAmount: number }> }>(page, "prices")
      return Object.values(record?.prices ?? {}).some((price) => price.cardId === "base1-44" && price.marketGbpAmount === 0.2)
    }, { timeout: 20_000 }).toBe(true)
  })

  test("migrates an existing localStorage snapshot on first run", async ({ harness }) => {
    const { page } = harness
    // Seed from a static same-origin page: with the binder open, its page-hide flush would write the
    // collection to IndexedDB during the reload, and the migration would rightly keep that instead.
    await page.goto("/icon.svg")
    await page.evaluate(() => new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase("binderdex-offline")
      request.onsuccess = request.onerror = request.onblocked = () => resolve()
    }))
    await page.evaluate(() => {
      localStorage.setItem("pokemon_collection_snapshot_v1", JSON.stringify({
        ownerUserId: "00000000-0000-4000-8000-0000000000e2",
        savedAt: "2026-10-01T00:00:00.000Z",
        collection: [{ id: "legacy-25", pokemon_id: 25, pokemon_name: "pikachu", wanted_cards: [], status: "collected", collected_at: "2026-10-01T00:00:00.000Z" }],
      }))
    })
    await harness.open()

    await expect.poll(() => readRecord<{ result: string }>(page, "meta:migrated-from-local-storage").then((marker) => marker?.result ?? null), { timeout: 15_000 })
      .toBe("migrated")
  })

  test("a set opened online opens again offline from IndexedDB", async ({ harness, context }) => {
    const { page } = harness
    await page.route("**/api/tcg-set-slots**", (route) => {
      const url = new URL(route.request().url())
      if (url.searchParams.get("recent") === "1") return route.fulfill({ json: { sets: [BASE_SET], selectedSet: null, slots: [] } })
      if (url.searchParams.get("setId") === "base1") return route.fulfill({ json: { sets: [BASE_SET], selectedSet: BASE_SET, slots: BASE_SET_SLOTS } })
      return route.fulfill({ json: { sets: [BASE_SET], selectedSet: null, slots: [] } })
    })

    await harness.dock().getByRole("button", { name: "Sets", exact: true }).click()
    await page.getByRole("button", { name: "Base Set", exact: true }).click()
    const slotFilter = page.getByPlaceholder("Filter slots, names, numbers, rarities...")
    await expect(slotFilter).toBeVisible()
    await expect(page.getByRole("button", { name: "Select Charmander", exact: true })).toBeVisible()
    await expect.poll(async () => (await readRecord(page, "sets:query:query=Base+Set&setId=base1")) !== null, { timeout: 10_000 }).toBe(true)

    // Offline: the API is unreachable.
    await page.unroute("**/api/tcg-set-slots**")
    await page.route("**/api/tcg-set-slots**", (route) => route.abort("internetdisconnected"))
    await context.setOffline(true)

    await page.getByRole("button", { name: "Clear set search" }).click()
    await expect(page.getByRole("button", { name: "Select Charmander", exact: true })).toBeHidden()
    await page.getByRole("button", { name: "Base Set", exact: true }).click()
    await expect(page.getByRole("button", { name: "Select Charmander", exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "Select Bulbasaur", exact: true })).toBeVisible()
    await expect(page.getByText(/could not load set coverage|failed to fetch|set lookup failed/i)).toHaveCount(0)

    await context.setOffline(false)
  })
})
