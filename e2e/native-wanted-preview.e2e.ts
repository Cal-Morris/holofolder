import { test, expect, mockBackends, emulateStandalone, E2E_USER, Harness } from "./fixtures"
import { inventoryBrowseFixture } from "../tests/fixtures/inventory-browse"
import { fixture, catalogRows, snapshotCardIds } from "../tests/fixtures/inventory-read-server"
import { buildInventoryCatalog } from "../lib/server/inventory-read-catalog"
import type { Locator } from "@playwright/test"

const alpha = "22222222-2222-4222-8222-222222222222"
// Synthetic wants; images are served by the e2e placeholder route.
const want = (id: string, name: string) => ({ card_id: id, card_name: name, card_image: `https://assets.tcgdex.net/en/base/base1/${id.split("-")[1]}`, added_at: "2026-11-10T00:00:00Z" })

for (const desktop of [false, true]) test(`native wanted preview dimming ${desktop ? "desktop" : "phone"}`, async ({ page, context, standalone, insets, baseURL }, info) => {
  test.skip(desktop && info.project.name !== "browser-390x844", "One explicit desktop check")
  if (desktop) await page.setViewportSize({ width: 1920, height: 1304 })
  if (standalone) await emulateStandalone(page, insets)
  await mockBackends(page, context, { signedIn: true, baseURL })
  const snapshot = inventoryBrowseFixture(2)
  snapshot.ownerUserId = E2E_USER.id
  snapshot.items.forEach(i => { i.ownerUserId = E2E_USER.id; i.grading = null })
  snapshot.collections = [{ ...snapshot.collections[0], ownerUserId: E2E_USER.id, id: alpha, name: "National dex" }]
  const binder = snapshot.binders[0]
  binder.collectionId = alpha; binder.ownerUserId = E2E_USER.id
  binder.slots.forEach(s => { s.ownerUserId = E2E_USER.id; s.collectionId = alpha })
  // 0: raw owned card. 1: owned species copy that still wants an upgrade. 2/3: unowned targets repeating one want.
  binder.slots[0].target = { kind: "pokemon", pokemonId: 6 }
  binder.slots[0].inventoryItemId = snapshot.items[0].id; binder.slots[0].status = "collected"
  snapshot.items[1].identity = { kind: "pokemon", pokemonId: 9 }
  binder.slots[1].target = { kind: "pokemon", pokemonId: 9 }
  binder.slots[1].inventoryItemId = snapshot.items[1].id; binder.slots[1].status = "collected"
  binder.slots[1].wantedCards = [want("base1-2", "Blastoise")]
  binder.slots[2].target = { kind: "pokemon", pokemonId: 3 }; binder.slots[2].status = "wishlisted"
  binder.slots[2].wantedCards = [want("base1-15", "Venusaur")]
  binder.slots[3].target = { kind: "pokemon", pokemonId: 3 }; binder.slots[3].status = "wishlisted"
  binder.slots[3].wantedCards = [want("base1-15", "Venusaur")]
  binder.slots[4].target = { kind: "pokemon", pokemonId: 1 }
  binder.slots[9].inventoryItemId = null; binder.slots[9].status = null
  snapshot.binders = [binder]
  snapshot.placements = [
    { inventoryItemId: snapshot.items[0].id, collectionId: alpha, slotId: binder.slots[0].id, version: 1 },
    { inventoryItemId: snapshot.items[1].id, collectionId: alpha, slotId: binder.slots[1].id, version: 1 },
  ]
  const f = fixture(0)
  f.tables.tcg_cards = [{ id: "base1-4", series_id: "base", set_id: "base1", local_id: "4", name_en: "Charizard",
    name_json: { en: "Charizard" }, image_languages_json: ["en"], external_ids_json: {} }]
  f.tables.tcg_sets = [{ id: "base1", name_en: "Base Set" }]
  f.tables.tcg_card_dex_ids = [{ card_id: "base1-4", dex_id: 6 }]
  const catalog = buildInventoryCatalog(catalogRows(f.tables, snapshotCardIds(snapshot)))
  await page.route("**/app/api/inventory?*", async route => {
    const url = new URL(route.request().url())
    await route.fulfill({ headers: { "Cache-Control": "private, no-store" }, json: { version: 2, requestId: url.searchParams.get("requestId"),
      scope: { actorUserId: E2E_USER.id, ownerUserId: E2E_USER.id, authSessionId: "synthetic-e2e-auth-session", sessionId: url.searchParams.get("sessionId") },
      snapshot, navigation: { catalog, layouts: [{ collectionId: alpha, layoutRevision: 1, rows: 4, cols: 4 }] },
      evidence: { inventoryRevision: 1, items: 2, placements: 2, collections: 1, binders: 1, slots: 12,
        storage: [{ collectionId: alpha, collectionVersion: 1, layoutRevision: 1, slotCount: 12 }] } } })
  })
  await page.goto(`/app/e2e-harness?signedIn=1&binder=${alpha}`)

  const rawOwned = page.getByRole("button", { name: "Charizard, Owned", exact: true })
  const ownedWithWant = page.getByRole("button", { name: "blastoise, Owned", exact: true })
  const wanted = page.getByRole("button", { name: "venusaur, Unfilled target", exact: true })
  const target = page.getByRole("button", { name: "bulbasaur, Unfilled target", exact: true })
  await expect(rawOwned).toBeVisible()
  await expect(wanted).toHaveCount(2)
  const look = (pocket: Locator) => pocket.locator("img").evaluate((img: HTMLImageElement) => {
    const s = getComputedStyle(img)
    return { src: img.currentSrc || img.src, filter: s.filter, opacity: Number(s.opacity) }
  })

  const owned = await look(rawOwned)
  expect(owned.src).toMatch(/cards\/en\/base1\/4\//)
  expect(owned.filter).toBe("none")
  expect(owned.opacity).toBe(1)

  // Legacy PokemonSlot showed the wanted printing grayed (wishlisted tone) whenever a want existed.
  const upgrade = await look(ownedWithWant)
  expect(upgrade.src).toMatch(/base1(\/|%2F)2/)
  expect(upgrade.filter).toContain("grayscale(1)")
  for (const pocket of [wanted.nth(0), wanted.nth(1)]) {
    const wish = await look(pocket)
    expect(wish.src).toMatch(/base1(\/|%2F)15/)
    expect(wish.filter).toContain("grayscale(1)")
    expect(wish.opacity).toBeCloseTo(0.9, 2)
  }
  // Repeated wants stay separate pockets with their own slot ids.
  const ids = await wanted.evaluateAll(nodes => nodes.map(node => node.getAttribute("data-slot-id")))
  expect(new Set(ids).size).toBe(2)

  // A plain unfilled target keeps the honest artwork placeholder and existing dimming.
  const plain = await look(target)
  expect(plain.src).toMatch(/official-artwork/)
  expect(plain.filter).toContain("grayscale(1)")
  expect(plain.opacity).toBeCloseTo(0.45, 2)

  const h = new Harness(page, desktop ? { top: 0, bottom: 0, left: 0, right: 0 } : insets, true)
  await h.expectNoHorizontalOverflow()
  for (const pocket of [rawOwned, ownedWithWant, wanted.nth(0), target]) {
    await expect(pocket.locator(":scope > span")).toHaveClass("sr-only")
    await h.expectMinTapTarget(pocket)
    await h.expectWithinSafeViewport(pocket)
  }

  await page.screenshot({ path: info.outputPath(`wanted-preview-${desktop ? "desktop" : info.project.name}.png`) })
})
