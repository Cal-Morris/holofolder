import { test, expect, SEEDED_COLLECTION, SUPABASE_URL } from "./fixtures"
import type { TCGSetSlotsResponse, TCGSetSlotCard } from "../lib/tcg-set-slots"

// Synthetic sets/printings exercise overlapping species and alternate art/finishes.
const sets = [{ id: "fixture-a", name: "Fixture Rivals" }, { id: "fixture-b", name: "Fixture Rising" }]
const card = (setIndex: number, dexId: number, number: string): TCGSetSlotCard => ({
  id: `${sets[setIndex].id}-${number}`, name: dexId === 179 ? "Mareep" : dexId === 180 ? "Flaaffy" : "Ampharos", localId: number,
  language: "en", set: sets[setIndex], inferredFinish: "normal", variants: { normal: true, reverse: true },
})
const mareep = card(0, 179, "1")
const alternate = { ...card(0, 179, "4"), rarity: "Illustration rare" }
const payloads: TCGSetSlotsResponse[] = sets.map((set, index) => ({
  sets: [set], selectedSet: set,
  slots: [
    { dexId: 179, pokemonName: "mareep", cards: index === 0 ? [mareep, alternate] : [card(1, 179, "1")] },
    { dexId: index === 0 ? 180 : 181, pokemonName: index === 0 ? "flaaffy" : "ampharos", cards: [card(index, index === 0 ? 180 : 181, "2")] },
  ],
}))

async function setup(harness: import("./fixtures").Harness, failSecond = false) {
  const page = harness.page
  await page.route(`${SUPABASE_URL}/rest/v1/pokemon_collection**`, route => route.fulfill({ json: [
    { ...SEEDED_COLLECTION[0], pokemon_id: 179, pokemon_name: "mareep", card_id: mareep.id, card_set: sets[0].name, wanted_cards: [{ card_id: "other-set-want", card_name: "Mareep", added_at: "2026-01-01" }] },
    { ...SEEDED_COLLECTION[0], id: "wanted-flaaffy", pokemon_id: 180, pokemon_name: "flaaffy", status: "wishlisted", card_id: "another-set-flaaffy" },
  ] }))
  await page.reload()
  await page.route("**/api/tcg-set-slots**", route => {
    const params = new URL(route.request().url()).searchParams
    const index = sets.findIndex(set => set.id === params.get("setId"))
    if (failSecond && index === 1) return route.fulfill({ status: 503, json: { error: "Fixture unavailable" } })
    return route.fulfill({ json: index >= 0 ? payloads[index] : { sets, selectedSet: null, slots: [] } })
  })
  await harness.dock().getByRole("button", { name: "Sets", exact: true }).click()
  await page.getByRole("button", { name: "Fixture Rivals", exact: true }).click()
  await expect(page.getByRole("button", { name: "Select mareep", exact: true })).toBeVisible()
  await page.getByRole("textbox", { name: "Search sets by name or code" }).fill("rising")
  await page.getByRole("button", { name: "Fixture Rising", exact: true }).first().click()
  if (failSecond) await expect(page.getByTestId("view-scroller").getByRole("alert")).toContainText("Could not load Fixture Rising")
  else await expect(page.getByRole("button", { name: "Select ampharos", exact: true })).toBeVisible()
}

test.describe("multi-set matching", () => {
  test.use({ signedIn: true })

  test("combines sets and Pokémon without hiding alternate printings, then clears temporary selections", async ({ harness }) => {
    await setup(harness)
    const page = harness.page
    const search = page.getByRole("textbox", { name: "Add Pokémon to match" })
    await search.fill("mareep")
    await page.getByRole("button", { name: "Match Mareep", exact: true }).click()
    await search.fill("flaaffy")
    await page.getByRole("button", { name: "Match Flaaffy", exact: true }).click()
    await expect(page.getByRole("button", { name: "Select ampharos", exact: true })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Select flaaffy", exact: true })).toBeVisible()
    const group = page.getByRole("region", { name: "Mareep matches", exact: true })
    await expect(group.getByRole("button", { name: /Fixture Rivals.*#1/ })).toBeVisible()
    await expect(group.getByRole("button", { name: /Fixture Rivals.*#4/ })).toBeVisible()
    await expect(group.getByRole("button", { name: /Fixture Rising.*#1/ })).toBeVisible()
    await expect(group.getByText("Already have", { exact: true })).toBeVisible()
    await expect(group.getByText("Your binder card", { exact: true }).first()).toBeVisible()
    await group.getByRole("button", { name: /Fixture Rising.*#1/ }).click()
    await expect(group.getByRole("button", { name: "Replace binder card", exact: true })).toBeVisible()
    await harness.expectMinTapTarget(page.getByRole("button", { name: "Remove Fixture Rising", exact: true }))
    await page.getByRole("button", { name: "Remove Fixture Rising", exact: true }).click()
    await expect(group.getByRole("button", { name: /Fixture Rising.*#1/ })).toHaveCount(0)
    const tabs = page.getByRole("group", { name: "Set checklist" })
    await tabs.getByRole("button", { name: "Cards", exact: true }).click()
    await page.getByRole("textbox", { name: "Filter set checklist" }).fill("no-such-printing")
    await expect(page.getByText("No cards match the current filters.")).toBeVisible()
    await tabs.getByRole("button", { name: "Pokémon", exact: true }).click()
    await expect(page.getByRole("button", { name: "Select mareep", exact: true })).toBeVisible()
    await harness.expectNoHorizontalOverflow()
    await page.screenshot({ path: `/tmp/set-matching-${test.info().project.name}.png` })
    await group.scrollIntoViewIfNeeded()
    await expect(() => harness.expectHittable(group.getByRole("button", { name: "Mareep", exact: true }))).toPass({ timeout: 1000 })
    await page.screenshot({ path: `/tmp/set-matching-results-${test.info().project.name}.png` })
    await page.getByRole("button", { name: "Clear all matches", exact: true }).click()
    await expect(search).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Select mareep", exact: true })).toHaveCount(0)
  })

  test("quick filters follow binder state even when wants are in other sets", async ({ harness }) => {
    await setup(harness)
    const page = harness.page
    await page.getByRole("button", { name: "More", exact: true }).click()
    await page.getByRole("menuitem", { name: "Light mode" }).click()
    const filters = page.getByRole("group", { name: "Filter by BinderDex state" })
    await filters.getByRole("button", { name: /^Missing from binder/ }).click()
    await expect(page.getByRole("button", { name: "Select mareep", exact: true })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Select flaaffy", exact: true })).toBeVisible()
    await filters.getByRole("button", { name: /^Already have/ }).click()
    await expect(page.getByRole("button", { name: "Select mareep", exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "Select flaaffy", exact: true })).toHaveCount(0)
    await filters.getByRole("button", { name: /^Wanted/ }).click()
    await expect(page.getByRole("button", { name: "Select mareep", exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "Select flaaffy", exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "Select ampharos", exact: true })).toHaveCount(0)
    await harness.expectNoHorizontalOverflow()
  })

  test("a failed set does not hide loaded matches and can be retried", async ({ harness }) => {
    await setup(harness, true)
    const page = harness.page
    await expect(page.getByRole("button", { name: "Select mareep", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Remove Fixture Rising", exact: true }).click()
    await page.route("**/api/tcg-set-slots**", route => {
      const id = new URL(route.request().url()).searchParams.get("setId")
      return route.fulfill({ json: id === sets[1].id ? payloads[1] : { sets, selectedSet: null, slots: [] } })
    })
    await page.getByRole("textbox", { name: "Search sets by name or code" }).fill("rising")
    await page.getByRole("button", { name: "Fixture Rising", exact: true }).click()
    await expect(page.getByRole("button", { name: "Select ampharos", exact: true })).toBeVisible()
    await expect(page.getByTestId("view-scroller").getByRole("alert")).toHaveCount(0)
  })

  test("both saved sets reopen offline after temporary selections are discarded", async ({ harness }) => {
    await setup(harness)
    const page = harness.page
    await expect.poll(() => page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("binderdex-offline")
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
        const request = db.transaction("records").objectStore("records").getAllKeys()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      db.close()
      return keys.filter(key => String(key).startsWith("sets:query:") && String(key).includes("setId=")).length
    })).toBe(2)
    await harness.dock().getByRole("button", { name: "Binder", exact: true }).click()
    await page.route("**/api/tcg-set-slots**", route => route.abort("internetdisconnected"))
    await page.context().setOffline(true)
    await harness.dock().getByRole("button", { name: "Sets", exact: true }).click()
    await expect(page.getByRole("button", { name: "Remove Fixture Rivals", exact: true })).toHaveCount(0)
    await page.getByRole("button", { name: "Fixture Rivals", exact: true }).click()
    await page.getByRole("textbox", { name: "Search sets by name or code" }).fill("rising")
    await page.getByRole("button", { name: "Fixture Rising", exact: true }).click()
    await expect(page.getByRole("button", { name: "Select ampharos", exact: true })).toBeVisible()
    await expect(page.getByRole("region", { name: "Mareep matches" }).getByRole("button", { name: /Fixture Rivals.*#4/ })).toBeVisible()
    await expect(page.getByText("Showing saved set data on this device.")).toBeVisible()
    await expect(page.getByTestId("view-scroller").getByRole("alert")).toHaveCount(0)
  })

})
