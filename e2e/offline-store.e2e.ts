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

  test("a set opened online opens again offline from IndexedDB", async ({ harness, context }) => {
    const { page } = harness
    await page.route("**/app/api/tcg-set-slots**", (route) => {
      const url = new URL(route.request().url())
      if (url.searchParams.get("recent") === "1") return route.fulfill({ json: { sets: [BASE_SET], selectedSet: null, slots: [] } })
      if (url.searchParams.get("setId") === "base1") return route.fulfill({ json: { sets: [BASE_SET], selectedSet: BASE_SET, slots: BASE_SET_SLOTS } })
      return route.fulfill({ json: { sets: [BASE_SET], selectedSet: null, slots: [] } })
    })

    await harness.dock().getByRole("button", { name: "Browse", exact: true }).click()
    await page.getByRole("button", { name: "Base Set", exact: true }).click()
    const slotFilter = page.getByRole("textbox", { name: "Add Pokémon to match" })
    await expect(slotFilter).toBeVisible()
    await expect(page.getByRole("button", { name: "Select Charmander", exact: true })).toBeVisible()
    await expect.poll(async () => (await readRecord(page, "sets:query:query=Base+Set&setId=base1")) !== null, { timeout: 10_000 }).toBe(true)

    // Offline: the API is unreachable.
    await page.unroute("**/app/api/tcg-set-slots**")
    await page.route("**/app/api/tcg-set-slots**", (route) => route.abort("internetdisconnected"))
    await context.setOffline(true)

    await page.getByRole("button", { name: "Remove Base Set" }).click()
    await expect(page.getByRole("button", { name: "Select Charmander", exact: true })).toBeHidden()
    await page.getByRole("button", { name: "Base Set", exact: true }).click()
    await expect(page.getByRole("button", { name: "Select Charmander", exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "Select Bulbasaur", exact: true })).toBeVisible()
    await expect(page.getByText(/could not load set coverage|failed to fetch|set lookup failed/i)).toHaveCount(0)

    await context.setOffline(false)
  })
})
