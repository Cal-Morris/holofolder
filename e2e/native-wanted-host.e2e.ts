import { test, expect, mockBackends, emulateStandalone, E2E_USER, Harness } from "./fixtures"
import { inventoryBrowseFixture, inventoryProjectionCatalog } from "../tests/fixtures/inventory-browse"

const collectionId = "22222222-2222-4222-8222-222222222222"

test("actual native host Wanted shows repeated Trainer and Energy wants, excluding empty targets", async ({ page, context, standalone, insets, baseURL }) => {
  if (standalone) await emulateStandalone(page, insets)
  await mockBackends(page, context, { signedIn: true, baseURL })
  // Synthetic storage and catalogue evidence, served through the real production host admission.
  const snapshot = inventoryBrowseFixture(0)
  snapshot.ownerUserId = E2E_USER.id
  snapshot.collections = [{ ...snapshot.collections[0], id: collectionId, ownerUserId: E2E_USER.id, name: "Synthetic wanted binder" }]
  const binder = snapshot.binders[0]
  binder.collectionId = collectionId
  binder.ownerUserId = E2E_USER.id
  binder.slots.forEach(slot => { slot.ownerUserId = E2E_USER.id; slot.collectionId = collectionId })
  const trainer = { card_id: "synthetic-trainer", card_name: "Synthetic Trainer", card_language: "en" as const, card_finish: "normal" as const, added_at: "2026-11-09T00:00:00Z" }
  binder.slots[0].wantedCards = [trainer, { ...trainer }]
  binder.slots[1].wantedCards = [{ ...trainer }]
  binder.slots[2].wantedCards = [{ ...trainer, card_id: "synthetic-energy", card_name: "Synthetic Energy" }]
  binder.slots[3].target = { kind: "card", cardId: "synthetic-energy", language: "en", finish: "normal" }
  binder.slots[4].target = { kind: "pokemon", pokemonId: 143 }
  snapshot.binders = [binder]
  snapshot.placements = []
  await page.route("**/app/api/inventory?*", async route => {
    const url = new URL(route.request().url())
    await route.fulfill({ headers: { "Cache-Control": "private, no-store" }, json: { version: 2, requestId: url.searchParams.get("requestId"),
      scope: { actorUserId: E2E_USER.id, ownerUserId: E2E_USER.id, authSessionId: "synthetic-e2e-auth-session", sessionId: url.searchParams.get("sessionId") },
      snapshot, navigation: { catalog: inventoryProjectionCatalog, layouts: [{ collectionId, layoutRevision: 1, rows: 4, cols: 4 }] },
      evidence: { inventoryRevision: 1, items: 0, placements: 0, collections: 1, binders: 1, slots: 12,
        storage: [{ collectionId, collectionVersion: 1, layoutRevision: 1, slotCount: 12 }] } } })
  })
  const writes: string[] = []
  page.on("request", request => { if (request.method() !== "GET" && /\/api\/(collection|binders|inventory|storage)(?:[/?]|$)/.test(request.url())) writes.push(request.url()) })
  await page.goto(`/app/e2e-harness?signedIn=1&binder=${collectionId}`)
  const dock = page.getByRole("navigation", { name: "Main navigation", exact: true })
  await dock.getByRole("button", { name: "Wanted", exact: true }).click()
  const wants = page.getByRole("region", { name: "Native wanted destinations" })
  await expect(wants).toContainText("4 explicit entries")
  await expect(wants.getByText("Synthetic Trainer · Normal", { exact: true })).toHaveCount(3)
  await expect(wants.getByText("Synthetic Energy · Normal", { exact: true })).toHaveCount(1)
  await expect(wants.getByRole("combobox")).toHaveCount(4)
  for (const [slot, index] of [["alpha-empty-0", 1], ["alpha-empty-0", 2], ["alpha-empty-1", 1], ["alpha-empty-2", 1]] as const) {
    await expect(wants.getByRole("combobox", { name: `Copy for ${slot} wanted entry ${index}`, exact: true })).toHaveCount(1)
  }
  const h = new Harness(page, insets, true)
  const firstChoice = wants.getByRole("combobox").first()
  await h.expectMinTapTarget(firstChoice)
  await h.expectWithinSafeViewport(firstChoice)
  await h.expectHittable(firstChoice)
  const energyChoice = wants.getByRole("combobox").last()
  await energyChoice.scrollIntoViewIfNeeded()
  await expect(wants.getByText("Synthetic Energy · Normal", { exact: true })).toBeVisible()
  await h.expectWithinSafeViewport(energyChoice)
  await h.expectHittable(energyChoice)
  await h.expectNoHorizontalOverflow()
  expect(writes).toEqual([])
})
