import { test, expect, mockBackends, emulateStandalone, E2E_USER, Harness } from "./fixtures"
import { inventoryBrowseFixture, inventoryProjectionCatalog } from "../tests/fixtures/inventory-browse"

const collectionId = "22222222-2222-4222-8222-222222222222"
const itemId = "33333333-3333-4333-8333-333333333333"
// Synthetic catalogue rows, not real printings.
const pikachu = { card: { id: "synthetic-pikachu", name: "Synthetic Pikachu", localId: "2", language: "en" as const, set: { id: "synthetic", name: "Synthetic projection set" } }, speciesNames: ["Pikachu"], pokemonIds: [25] }
const catalog = [...inventoryProjectionCatalog, pikachu]

for (const desktop of [false, true]) test(`actual native host Browse, Sets and National Dex read native species ownership ${desktop ? "desktop" : "phone"}`, async ({ page, context, standalone, insets, baseURL }, info) => {
  test.skip(desktop && info.project.name !== "browser-390x844", "One desktop check")
  if (desktop) await page.setViewportSize({ width: 1440, height: 1000 })
  if (standalone) await emulateStandalone(page, insets)
  await mockBackends(page, context, { signedIn: true, baseURL })
  // Synthetic storage: an owned Snorlax copy, an explicit Pikachu want and a plain Bulbasaur target.
  const snapshot = inventoryBrowseFixture(0)
  snapshot.ownerUserId = E2E_USER.id
  snapshot.collections = [{ ...snapshot.collections[0], id: collectionId, ownerUserId: E2E_USER.id, name: "Synthetic species binder" }]
  const binder = snapshot.binders[0]
  binder.collectionId = collectionId
  binder.ownerUserId = E2E_USER.id
  binder.slots.forEach(slot => { slot.ownerUserId = E2E_USER.id; slot.collectionId = collectionId })
  snapshot.items = [{ id: itemId, ownerUserId: E2E_USER.id, identity: { kind: "card", cardId: "synthetic-snorlax", language: "en", finish: "normal" }, grading: null, acquiredAt: null, version: 1 }]
  snapshot.placements = [{ inventoryItemId: itemId, collectionId, slotId: binder.slots[0].id, version: 1 }]
  binder.slots[0].inventoryItemId = itemId
  binder.slots[0].status = "collected"
  binder.slots[1].wantedCards = [{ card_id: "synthetic-pikachu", card_name: "Synthetic Pikachu", card_language: "en", card_finish: "normal", added_at: "2026-11-09T00:00:00Z" }]
  binder.slots[2].target = { kind: "pokemon", pokemonId: 1 }
  snapshot.binders = [binder]
  await page.route("**/app/api/inventory?*", async route => {
    const url = new URL(route.request().url())
    await route.fulfill({ headers: { "Cache-Control": "private, no-store" }, json: { version: 2, requestId: url.searchParams.get("requestId"),
      scope: { actorUserId: E2E_USER.id, ownerUserId: E2E_USER.id, authSessionId: "synthetic-e2e-auth-session", sessionId: url.searchParams.get("sessionId") },
      snapshot, navigation: { catalog, layouts: [{ collectionId, layoutRevision: 1, rows: 4, cols: 4 }] },
      evidence: { inventoryRevision: 1, items: 1, placements: 1, collections: 1, binders: 1, slots: 12,
        storage: [{ collectionId, collectionVersion: 1, layoutRevision: 1, slotCount: 12 }] } } })
  })
  const set = { id: "synthetic", name: "Synthetic projection set" }
  const setCards = catalog.map(entry => ({ ...entry.card, set }))
  await page.route("**/app/api/tcg-set-slots**", route => {
    const params = new URL(route.request().url()).searchParams
    return route.fulfill({ json: params.get("setId") === set.id
      ? { sets: [set], selectedSet: set, cards: setCards, slots: [{ dexId: 25, pokemonName: "pikachu", cards: [setCards[3]] }, { dexId: 143, pokemonName: "snorlax", cards: [setCards[0]] }] }
      : { sets: [set], selectedSet: null, slots: [] } })
  })
  const writes: string[] = []
  page.on("request", request => { if (request.method() !== "GET" && /\/api\/(collection|binders|inventory|storage)(?:[/?]|$)/.test(request.url())) writes.push(request.url()) })
  await page.goto(`/app/e2e-harness?signedIn=1&binder=${collectionId}`)
  await expect(page.locator(`[data-slot-id="${binder.slots[0].id}"]`)).toBeVisible()
  const h = new Harness(page, insets, true)
  await page.getByRole("button", { name: "Browse", exact: true }).filter({ visible: true }).first().click()
  await page.getByRole("group", { name: "Browse perspective" }).getByRole("button", { name: "Pokémon", exact: true }).click()
  const filters = page.getByRole("group", { name: "Filter Pokémon species" })
  await expect(filters.getByRole("button", { name: "owned 1", exact: true })).toBeVisible()
  await expect(filters.getByRole("button", { name: "missing 1024", exact: true })).toBeVisible()
  await expect(filters.getByRole("button", { name: "wanted 1", exact: true })).toBeVisible()
  const catalogue = page.getByRole("list", { name: "Pokémon catalogue" })
  await page.getByRole("searchbox").filter({ visible: true }).fill("snorlax")
  await expect(catalogue.getByRole("listitem")).toContainText("Owned species")
  await page.getByRole("searchbox").filter({ visible: true }).fill("pikachu")
  await expect(catalogue.getByRole("listitem")).toContainText("Missing species · Wanted printing")
  await page.getByRole("searchbox").filter({ visible: true }).fill("bulbasaur")
  // A plain slot target is neither owned nor wanted.
  await expect(catalogue.getByRole("listitem")).toContainText("Missing species")
  await expect(catalogue.getByRole("listitem")).not.toContainText("Wanted")
  await h.expectNoHorizontalOverflow()

  await page.getByRole("group", { name: "Browse perspective" }).getByRole("button", { name: "Sets", exact: true }).click()
  await page.getByRole("button", { name: /^Synthetic projection set/ }).first().click()
  // Card-level completion counts the owned Snorlax copy; the Pikachu want and Trainer/Energy rows don't.
  await expect(page.getByRole("list", { name: "Set completion" })).toContainText("1/4 cards · 25%")
  const setFilters = page.getByRole("group", { name: "Filter by Holo Folder state" })
  await expect(setFilters.getByRole("button", { name: "Already have 1", exact: true })).toBeVisible()
  await expect(setFilters.getByRole("button", { name: "Wanted 1", exact: true })).toBeVisible()
  await expect(page.getByRole("region", { name: "Snorlax matches" })).toContainText("Already have")
  await expect(page.getByRole("region", { name: "Pikachu matches" })).toContainText("Wanted Pokémon")
  await h.expectNoHorizontalOverflow()

  await page.getByRole("navigation", { name: "Binder navigation" }).getByRole("button", { name: "More", exact: true }).click()
  await page.getByRole("menuitem", { name: "National Dex", exact: true }).click()
  for (const name of ["Owned 1", "Wanted 1", "Upgrade 1"]) await expect(page.getByRole("button", { name, exact: true })).toBeVisible()
  await page.getByRole("textbox", { name: "Search list" }).fill("snorlax")
  await expect(page.getByText("#0143 · Synthetic Snorlax", { exact: true })).toBeVisible()
  await h.expectNoHorizontalOverflow()
  expect(writes).toEqual([])
})
