import { test, expect, mockBackends, emulateStandalone, E2E_USER, Harness } from "./fixtures"
import { inventoryBrowseFixture } from "../tests/fixtures/inventory-browse"
import { fixture, catalogRows, snapshotCardIds } from "../tests/fixtures/inventory-read-server"
import { buildInventoryCatalog } from "../lib/server/inventory-read-catalog"

const alpha = "22222222-2222-4222-8222-222222222222"

for (const desktop of [false, true]) test(`native printing images and cover totals ${desktop ? "desktop" : "phone"}`, async ({ page, context, standalone, insets, baseURL }, info) => {
  test.skip(desktop && info.project.name !== "browser-390x844", "One explicit desktop check")
  if (desktop) await page.setViewportSize({ width: 1920, height: 1304 })
  if (standalone) await emulateStandalone(page, insets)
  await mockBackends(page, context, { signedIn: true, baseURL })
  // Synthetic ownership; use the actual server mirror projection, not a hand-authored image payload.
  const snapshot = inventoryBrowseFixture(1)
  snapshot.ownerUserId = E2E_USER.id
  snapshot.items.forEach(i => { i.ownerUserId = E2E_USER.id })
  snapshot.collections = [{ ...snapshot.collections[0], ownerUserId: E2E_USER.id, id: alpha, name: "National dex" }]
  const binder = snapshot.binders[0]
  binder.collectionId = alpha; binder.ownerUserId = E2E_USER.id
  binder.slots.forEach(s => { s.ownerUserId = E2E_USER.id; s.collectionId = alpha })
  binder.slots[0].target = { kind: "pokemon", pokemonId: 6 }
  binder.slots[0].inventoryItemId = snapshot.items[0].id; binder.slots[0].status = "finalized"
  binder.slots[1].target = { kind: "pokemon", pokemonId: 1 }
  binder.slots[9].inventoryItemId = null; binder.slots[9].status = null
  snapshot.binders = [binder]
  snapshot.placements = [{ inventoryItemId: snapshot.items[0].id, collectionId: alpha, slotId: binder.slots[0].id, version: 1 }]
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
      evidence: { inventoryRevision: 1, items: 1, placements: 1, collections: 1, binders: 1, slots: 12,
        storage: [{ collectionId: alpha, collectionVersion: 1, layoutRevision: 1, slotCount: 12 }] } } })
  })
  await page.goto(`/app/e2e-harness?signedIn=1&binder=${alpha}`)
  const owned = page.getByRole("button", { name: "Charizard, Owned", exact: true })
  await expect(owned).toBeVisible()
  await expect(owned.locator("img")).toHaveAttribute("src", /cards\/en\/base1\/4\/high\.webp/)
  const unfilled = page.getByRole("button", { name: "bulbasaur, Unfilled target", exact: true })
  await expect(unfilled).toBeVisible()
  await expect(unfilled.locator("img")).toHaveAttribute("src", /official-artwork/)
  const h = new Harness(page, desktop ? { top: 0, bottom: 0, left: 0, right: 0 } : insets, true)
  await h.expectMinTapTarget(owned); await h.expectWithinSafeViewport(owned)
  await h.expectNoHorizontalOverflow()
  // Native phones show one page; the inside cover is visible in the desktop spread.
  if (!desktop) return
  const cover = page.getByRole("region", { name: "Inside cover", exact: true })
  await expect(cover).toBeVisible()
  await expect(cover.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50")
  await expect(cover.getByRole("progressbar")).toHaveAttribute("aria-valuetext", "1 of 2 slots collected")
  await expect(cover).toContainText("12 slots")
  await expect(cover.locator("dl")).toHaveText(/Collected1 \/ 2Needed1Perfect1/)
  await h.expectNoHorizontalOverflow()
})
