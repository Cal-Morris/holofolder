import { test, expect, mockBackends, emulateStandalone, E2E_USER, Harness } from "./fixtures"
import type { Route } from "@playwright/test"
import { inventoryBrowseFixture, inventoryBrowseCatalog, inventoryBrowseLayouts } from "../tests/fixtures/inventory-browse"

const alpha = "22222222-2222-4222-8222-222222222222"
const trades = "33333333-3333-4333-8333-333333333333"
const id = (value: string) => value === "alpha" ? alpha : trades
const entry = "/app/e2e-harness?signedIn=1"
// Synthetic authenticated HTTP evidence, actual production BinderApp/endpoint selection and IDB.
async function inventory(route: Route, owner = E2E_USER.id, empty = false, created?: { collectionId: string; name: string }) {
  const snapshot = inventoryBrowseFixture(5), url = new URL(route.request().url())
  snapshot.ownerUserId = owner
  snapshot.items.forEach(i => { i.ownerUserId = owner })
  snapshot.collections.forEach(c => { c.ownerUserId = owner; c.id = id(c.id) })
  snapshot.binders.forEach(b => { b.ownerUserId = owner; b.collectionId = id(b.collectionId); b.slots.forEach(s => { s.ownerUserId = owner; s.collectionId = b.collectionId }) })
  snapshot.placements.forEach(p => { p.collectionId = id(p.collectionId) })
  if (empty) { snapshot.items = []; snapshot.collections = []; snapshot.binders = []; snapshot.placements = [] }
  if (created) {
    snapshot.inventoryRevision = 2
    snapshot.collections = [{ id: created.collectionId, ownerUserId: owner, name: created.name, kind: "binder", defaultPresentation: "binder", version: 0 }]
    snapshot.binders = [{ ownerUserId: owner, collectionId: created.collectionId, layoutRevision: 0, presetManifest: null, slots: [] }]
  }
  await route.fulfill({ headers: { "Cache-Control": "private, no-store" }, json: { version: 2,
    requestId: url.searchParams.get("requestId"), scope: { actorUserId: E2E_USER.id, ownerUserId: owner,
      authSessionId: "synthetic-e2e-auth-session", sessionId: url.searchParams.get("sessionId") }, snapshot,
    ...(created ? { defaultCollectionId: created.collectionId } : empty ? {} : { defaultCollectionId: trades }),
    navigation: { catalog: inventoryBrowseCatalog, layouts: created ? [{ collectionId: created.collectionId, layoutRevision: 0, rows: 4, cols: 4 }] : empty ? [] : inventoryBrowseLayouts.map(l => ({ ...l, collectionId: id(l.collectionId) })) },
    evidence: { inventoryRevision: snapshot.inventoryRevision, items: snapshot.items.length, placements: snapshot.placements.length,
      collections: snapshot.collections.length, binders: snapshot.binders.length, slots: snapshot.binders.reduce((n, b) => n + b.slots.length, 0),
      storage: snapshot.binders.map(b => ({ collectionId: b.collectionId, collectionVersion: snapshot.collections.find(c => c.id === b.collectionId)!.version, layoutRevision: b.layoutRevision, slotCount: b.slots.length })) } } })
}

test.beforeEach(async ({ page, context, standalone, insets, baseURL }) => {
  if (standalone) await emulateStandalone(page, insets)
  await mockBackends(page, context, { signedIn: true, baseURL })
  await page.route("**/app/api/inventory?*", route => inventory(route))
})

test("production host uses the native default, device view and explicit link without legacy writes", async ({ page, insets }) => {
  const legacyWrites: string[] = []
  page.on("request", r => { if (r.method() !== "GET" && /\/api\/collection|\/rest\/v1\/pokemon_collection/.test(r.url())) legacyWrites.push(r.url()) })
  await page.goto(entry)
  const select = page.getByRole("combobox", { name: "Collection", exact: true })
  await expect(select).toHaveValue(trades)
  await select.selectOption(alpha)
  await page.getByRole("combobox", { name: "Collection view", exact: true }).selectOption("list")
  await page.getByRole("searchbox", { name: "Filter collection" }).fill("charizard")
  await page.reload()
  await expect(select).toHaveValue(alpha)
  await expect(page.getByRole("searchbox", { name: "Filter collection" })).toHaveValue("charizard")
  await page.goto(`${entry}&binder=${trades}&view=binder`)
  await expect(select).toHaveValue(trades)
  await expect(page.getByRole("combobox", { name: "Collection view", exact: true })).toHaveValue("binder")
  const h = new Harness(page, insets, true)
  await h.expectNoHorizontalOverflow()
  for (const name of ["Inventory", "Binder", "Search"]) {
    const control = page.getByRole("navigation", { name: "Main navigation", exact: true }).getByRole("button", { name, exact: true })
    await h.expectMinTapTarget(control); await h.expectWithinSafeViewport(control); await h.expectHittable(control)
  }
  expect(legacyWrites).toEqual([])
})

test("failed complete refresh retains the view, disables new edits and can recover", async ({ page }) => {
  await page.goto(entry)
  await expect(page.getByRole("button", { name: "New storage", exact: true })).toBeEnabled()
  await page.route("**/app/api/inventory?*", route => route.fulfill({ status: 503, json: { error: "inventory_read_unavailable" } }))
  await page.getByRole("button", { name: "Refresh storage", exact: true }).click()
  await expect(page.getByRole("status").filter({ hasText: "Could not refresh storage" })).toBeVisible()
  await expect(page.getByRole("combobox", { name: "Collection", exact: true })).toHaveValue(trades)
  await expect(page.getByRole("button", { name: "New storage", exact: true })).toBeDisabled()
  await page.route("**/app/api/inventory?*", route => inventory(route))
  await page.getByRole("button", { name: "Refresh storage", exact: true }).click()
  await expect(page.getByRole("button", { name: "New storage", exact: true })).toBeEnabled()
})

for (const code of ["inventory_not_initialized", "legacy_inventory_incomplete"])
  test(`onboarding reports the trusted provisioning prerequisite: ${code}`, async ({ page, insets }) => {
    await page.route("**/app/api/inventory?*", route => route.fulfill({ status: 503, json: { error: code } }))
    await page.goto(entry)
    await expect(page.getByRole("status").filter({ hasText: /administrator/ })).toBeVisible()
    await expect(page.getByRole("button", { name: "New storage", exact: true })).toBeDisabled()
    await expect(page.getByRole("button", { name: "Refresh storage", exact: true })).toBeEnabled()
    await new Harness(page, insets, true).expectNoHorizontalOverflow()
  })

test("membership pause closes the old private lifetime, recheck resolves the new owner", async ({ page }) => {
  await page.goto(`${entry}&view=inventory`)
  await expect(page.locator('[data-item-id="copy-00001"]')).toBeVisible()
  await page.locator('[data-item-id="copy-00001"]').click()
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("holofolder-membership-lifecycle-v1", { detail: "pause" })))
  await expect(page.getByRole("dialog")).not.toBeVisible()
  await expect(page.locator('[data-item-id="copy-00001"]')).toHaveCount(0)
  const owner = "00000000-0000-4000-8000-0000000000e3"
  await page.route("**/rest/v1/partnerships?*", route => route.fulfill({ json: { id: "synthetic-partnership", owner_user_id: owner, user1_id: E2E_USER.id, user2_id: owner } }))
  await page.route("**/app/api/inventory?*", route => inventory(route, owner))
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("holofolder-membership-lifecycle-v1", { detail: "recheck" })))
  await expect(page.locator('[data-item-id="copy-00001"]')).toBeVisible()
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("binderdex_start_v1") ?? "null")?.ownerUserId)).toBe(owner)
})


test("initialized empty owner can review and persist the existing first storage command", async ({ page }) => {
  let created: { collectionId: string; name: string } | undefined
  let finish!: () => void
  const held = new Promise<void>(resolve => { finish = resolve })
  await page.route("**/app/api/inventory?*", route => inventory(route, E2E_USER.id, true, created))
  const sent: unknown[] = []
  await page.route("**/app/api/storage-collections", async route => {
    const request = route.request().postDataJSON()
    sent.push(request)
    await held
    created = { collectionId: request.collectionId, name: request.name }
    await route.fulfill({ headers: { "Cache-Control": "private, no-store" }, json: { version: 1, operationId: request.operationId,
      receipt: { inventoryRevision: 2, collectionId: request.collectionId, collectionVersion: 0, layoutRevision: 0, changed: true, slotIds: [], recoverySupported: false } } })
  })
  await page.goto(entry)
  await expect(page.getByRole("status").filter({ hasText: "Create your first storage" })).toBeVisible()
  await page.getByRole("button", { name: "New storage", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "New storage", exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByRole("textbox", { name: "Storage name", exact: true }).fill("My first binder")
  await dialog.getByRole("combobox", { name: "Starting arrangement" }).selectOption("blank")
  await dialog.getByRole("button", { name: "Review storage", exact: true }).click()
  await dialog.getByRole("button", { name: "Confirm create storage", exact: true }).click()
  await expect(dialog).toContainText("Creation pending sync")
  await expect.poll(() => sent.length).toBe(1)
  expect(sent[0]).toMatchObject({ version: 1, inventoryRevision: 1, name: "My first binder", manifest: { entries: [] } })
  await expect(page.getByRole("combobox", { name: "Collection", exact: true })).toHaveValue("")
  finish()
  await expect(page.getByRole("combobox", { name: "Collection", exact: true })).toHaveValue((sent[0] as { collectionId: string }).collectionId)
  await expect(dialog).not.toBeVisible()
})
