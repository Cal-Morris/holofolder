import { test, expect, mockBackends, emulateStandalone, E2E_USER, Harness } from "./fixtures"
import { inventoryBrowseFixture } from "../tests/fixtures/inventory-browse"
import { fixture } from "../tests/fixtures/inventory-read-server"
import { readInventoryCatalog } from "../lib/server/inventory-read-catalog"

const alpha = "22222222-2222-4222-8222-222222222222"

for (const desktop of [false, true]) test(`native pocket presentation ${desktop ? "desktop" : "phone"}`, async ({ page, context, standalone, insets, baseURL }, info) => {
  test.skip(desktop && info.project.name !== "browser-390x844", "One explicit desktop check")
  if (desktop) await page.setViewportSize({ width: 1920, height: 1304 })
  if (standalone) await emulateStandalone(page, insets)
  await mockBackends(page, context, { signedIn: true, baseURL })
  // Synthetic ownership; use the actual server mirror projection, not a hand-authored image payload.
  const snapshot = inventoryBrowseFixture(2)
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
  snapshot.items[1].identity = { kind: "pokemon", pokemonId: 6 }
  snapshot.items[1].grading = null
  binder.slots[2].inventoryItemId = snapshot.items[1].id
  binder.slots[2].status = "collected"
  binder.slots[3].target = { kind: "card", cardId: "base1-4", language: "en", finish: "holo" }
  snapshot.placements.push({ inventoryItemId: snapshot.items[1].id, collectionId: alpha, slotId: binder.slots[2].id, version: 1 })
  const f = fixture(0)
  f.tables.tcg_cards = [{ id: "base1-4", series_id: "base", set_id: "base1", local_id: "4", name_en: "Charizard",
    name_json: { en: "Charizard" }, image_languages_json: ["en"], external_ids_json: {} }]
  f.tables.tcg_sets = [{ id: "base1", name_en: "Base Set" }]
  f.tables.tcg_card_dex_ids = [{ card_id: "base1-4", dex_id: 6 }]
  const catalog = await readInventoryCatalog(f.client, snapshot, new AbortController().signal, () => {})
  await page.route("**/app/api/inventory?*", async route => {
    const url = new URL(route.request().url())
    await route.fulfill({ headers: { "Cache-Control": "private, no-store" }, json: { version: 2, requestId: url.searchParams.get("requestId"),
      scope: { actorUserId: E2E_USER.id, ownerUserId: E2E_USER.id, authSessionId: "synthetic-e2e-auth-session", sessionId: url.searchParams.get("sessionId") },
      snapshot, navigation: { catalog, layouts: [{ collectionId: alpha, layoutRevision: 1, rows: 4, cols: 4 }] },
      evidence: { inventoryRevision: 1, items: 2, placements: 2, collections: 1, binders: 1, slots: 12,
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
  const species = page.getByRole("button", { name: "charizard, Owned", exact: true })
  const unfilledCard = page.getByRole("button", { name: "Charizard, Unfilled target", exact: true })
  const free = page.getByRole("button", { name: "Free slot, Empty spacer", exact: true }).first()
  await expect(species.locator("img")).toHaveAttribute("src", /official-artwork/)
  await expect(species).toContainText("Owned")
  await expect(unfilled).toContainText("Unfilled target")
  await expect(free).toContainText("Free slot")
  await expect(free.locator("img")).toHaveCount(0)
  const measurements = []
  for (const pocket of [owned, unfilledCard]) {
    await expect(pocket.locator("img")).toBeVisible()
    await expect.poll(() => pocket.locator("img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true)
    const geometry = await pocket.evaluate(button => {
      const image = button.querySelector("img")!
      const b = button.getBoundingClientRect(), i = image.getBoundingClientRect()
      const style = getComputedStyle(image)
      const caption = button.querySelector("span")!
      const c = caption.getBoundingClientRect()
      return { width: b.width, height: b.height, imageWidth: i.width, imageHeight: i.height,
        inset: i.left - b.left, padding: style.padding, fit: style.objectFit,
        radius: getComputedStyle(button).borderRadius, overflow: getComputedStyle(button).overflow,
        captionHeight: c.height, captionWidth: c.width }
    })
    measurements.push(geometry)
    expect(geometry.width / geometry.height).toBeCloseTo(63 / 88, 2)
    expect(geometry.fit).toBe("contain")
    expect(geometry.overflow).toBe("hidden")
    expect(geometry.padding).toBe("0px")
    expect(geometry.inset).toBeCloseTo(0, 1)
    expect(geometry.imageWidth).toBeCloseTo(geometry.width, 1)
    expect(geometry.imageHeight).toBeCloseTo(geometry.height, 1)
    expect(geometry.captionHeight).toBeLessThanOrEqual(1)
    expect(geometry.captionWidth).toBeLessThanOrEqual(1)
  }
  for (const pocket of [owned, species, unfilled, unfilledCard, free]) {
    await h.expectMinTapTarget(pocket)
    await h.expectWithinSafeViewport(pocket)
    await h.expectHittable(pocket)
  }
  await page.screenshot({ path: `/tmp/pocket-after-${desktop ? "desktop" : info.project.name}.png` })
  await info.attach("pocket-geometry", { body: JSON.stringify(measurements, null, 2), contentType: "application/json" })
  console.log(`POCKET after ${desktop ? "desktop" : info.project.name} ${JSON.stringify(measurements)}`)
  await owned.click()
  await expect(page.getByRole("dialog", { name: "Charizard, Owned details", exact: true })).toBeVisible()
})
