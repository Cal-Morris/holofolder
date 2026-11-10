import { test, expect, mockBackends, emulateStandalone, E2E_USER, Harness, collectionPicker, viewPicker, chooseCollection, chooseView } from "./fixtures"
import { inventoryBrowseFixture, inventoryBrowseCatalog, inventoryBrowseLayouts } from "../tests/fixtures/inventory-browse"

// Synthetic native storage: two named collections with ordered slots (same evidence shape as browser-host.e2e.ts).
const alpha = "22222222-2222-4222-8222-222222222222"
const trades = "33333333-3333-4333-8333-333333333333"
const slotId = (n: number) => `44444444-4444-4444-8444-${String(n).padStart(12, "0")}`
const storageId = (id: string) => id === "alpha" ? alpha : trades
const layouts = inventoryBrowseLayouts.map(l => ({ ...l, collectionId: storageId(l.collectionId) }))
function syntheticSnapshot() {
  const snapshot = inventoryBrowseFixture(5)
  snapshot.ownerUserId = E2E_USER.id
  snapshot.items.forEach(i => { i.ownerUserId = E2E_USER.id })
  snapshot.collections.forEach(c => { c.ownerUserId = E2E_USER.id })
  snapshot.binders.forEach(b => { b.ownerUserId = E2E_USER.id; b.slots.forEach(s => { s.ownerUserId = E2E_USER.id }) })
  const slots = new Map(snapshot.binders.flatMap((b, i) => b.slots.map((s, n) => [s.id, slotId(i * 100 + n)] as const)))
  snapshot.collections.forEach(c => { c.id = storageId(c.id) })
  snapshot.binders.forEach(b => { b.collectionId = storageId(b.collectionId); b.slots.forEach(s => { s.id = slots.get(s.id)!; s.collectionId = b.collectionId }) })
  snapshot.placements.forEach(p => { p.collectionId = storageId(p.collectionId); p.slotId = slots.get(p.slotId)! })
  return snapshot
}
async function fulfillInventory(route: import("@playwright/test").Route) {
  const url = new URL(route.request().url()), snapshot = syntheticSnapshot()
  await route.fulfill({ headers: { "Cache-Control": "private, no-store" }, json: { version: 2,
    requestId: url.searchParams.get("requestId"), scope: { actorUserId: E2E_USER.id, ownerUserId: E2E_USER.id,
      authSessionId: "synthetic-e2e-auth-session", sessionId: url.searchParams.get("sessionId") }, snapshot,
    navigation: { catalog: inventoryBrowseCatalog, layouts },
    evidence: { inventoryRevision: snapshot.inventoryRevision, items: snapshot.items.length, placements: snapshot.placements.length,
      collections: snapshot.collections.length, binders: snapshot.binders.length, slots: snapshot.binders.reduce((n, b) => n + b.slots.length, 0),
      storage: snapshot.binders.map(b => ({ collectionId: b.collectionId, collectionVersion: 1, layoutRevision: b.layoutRevision, slotCount: b.slots.length })) } } })
}
test.beforeEach(async ({ page, context, standalone, insets, baseURL }) => {
  if (standalone) await emulateStandalone(page, insets)
  await mockBackends(page, context, { signedIn: true, baseURL })
  await page.route("**/app/e2e-harness/storage/inventory?*", fulfillInventory)
})
const entry = "/app/e2e-harness?signedIn=1&browserHost=1"
const dock = (page: import("@playwright/test").Page) => page.getByRole("navigation", { name: "Main navigation", exact: true })
const brand = (page: import("@playwright/test").Page) => page.getByTestId("app-header").getByRole("button", { name: "Holo Folder: back to binder", exact: true })

test("native brand and Binder return to the current collection's binder page from Search, Quick mode, Dex and other views", async ({ page, insets }, info) => {
  await page.goto(`${entry}&binder=${alpha}&page=2`)
  const collection = collectionPicker(page)
  const view = viewPicker(page)
  const pageTwo = page.locator(`[data-slot-id="${slotId(9)}"]`)
  const atAlphaPageTwo = async () => {
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await expect(collection).toHaveAttribute("data-value", alpha)
    await expect(view).toHaveAttribute("data-value", "binder")
    await expect(pageTwo).toBeVisible()
    await expect(page.getByRole("spinbutton", { name: "Binder page number" })).toHaveValue("2")
  }
  await expect(pageTwo).toBeVisible()
  const h = new Harness(page, insets, true)
  const home = brand(page)
  await expect(home.locator("img")).toBeVisible()
  await h.expectMinTapTarget(home, 36); await h.expectWithinSafeViewport(home); await h.expectHittable(home)
  await page.screenshot({ path: info.outputPath("brand-binder.png") })

  // Search sheet (covers the header on phones): the dock Binder tab closes it and stays on the binder, not the search surface.
  await dock(page).getByRole("button", { name: "Search", exact: true }).click()
  await expect(page.getByRole("dialog", { name: /search pokemon/i })).toBeVisible()
  await page.screenshot({ path: info.outputPath("search-open.png") })
  await dock(page).getByRole("button", { name: "Binder", exact: true }).click()
  await atAlphaPageTwo()

  // Quick mode is full screen: its own Binder destination returns to the collection, from the global Dex too.
  const openQuickBinder = async () => {
    await dock(page).getByRole("button", { name: "Search", exact: true }).click()
    await page.getByRole("button", { name: "Quick mode", exact: true }).click()
    const quick = page.getByRole("dialog", { name: "Quick mode" })
    await expect(quick).toBeVisible()
    await quick.getByRole("button", { name: /^Binder/ }).first().click()
  }
  await openQuickBinder()
  await atAlphaPageTwo()

  // Global National Dex: Binder must not paint the legacy global Dex binder.
  await page.getByRole("navigation", { name: "Binder navigation" }).getByRole("button", { name: "More", exact: true }).click()
  await page.getByRole("menuitem", { name: "National Dex", exact: true }).click()
  await expect(page.getByText("National Dex", { exact: true }).first()).toBeVisible()
  await page.screenshot({ path: info.outputPath("dex.png") })
  await home.click()
  await atAlphaPageTwo()
  await page.getByRole("navigation", { name: "Binder navigation" }).getByRole("button", { name: "More", exact: true }).click()
  await page.getByRole("menuitem", { name: "National Dex", exact: true }).click()
  await expect(page.getByText("National Dex", { exact: true }).first()).toBeVisible()
  await openQuickBinder()
  await atAlphaPageTwo()

  // Wanted, then keyboard activation of the brand.
  await dock(page).getByRole("button", { name: "Wanted", exact: true }).click()
  await expect(dock(page).getByRole("button", { name: "Wanted", exact: true })).toHaveAttribute("aria-pressed", "true")
  // Real keyboard traversal, so :focus-visible applies.
  await home.focus()
  await page.keyboard.press("Tab")
  await page.keyboard.press("Shift+Tab")
  await expect(home).toBeFocused()
  expect(await home.evaluate(e => e.matches(":focus-visible"))).toBe(true)
  await page.screenshot({ path: info.outputPath("brand-focus.png") })
  await page.keyboard.press("Enter")
  await atAlphaPageTwo()

  // A remembered List presentation: Binder returns to binder pages at the same page.
  await chooseView(page, "list")
  await expect(view).toHaveAttribute("data-value", "list")
  await dock(page).getByRole("button", { name: "Binder", exact: true }).click()
  await atAlphaPageTwo()

  // Browse, then the dock Binder tab.
  await dock(page).getByRole("button", { name: "Browse", exact: true }).click()
  await expect(page.getByRole("group", { name: "Browse perspective" })).toBeVisible()
  await dock(page).getByRole("button", { name: "Binder", exact: true }).click()
  await atAlphaPageTwo()

  // History still walks back through the explicit destinations.
  await page.goBack()
  await expect(page.getByRole("group", { name: "Browse perspective" })).toBeVisible()
  await page.goForward()
  await atAlphaPageTwo()
  await h.expectNoHorizontalOverflow()
})

test("native brand returns to the other named collection when that is the current one, and survives reload", async ({ page }) => {
  await page.goto(`${entry}&binder=${alpha}`)
  const collection = collectionPicker(page)
  await expect(collection).toHaveAttribute("data-value", alpha)
  await chooseCollection(page, trades)
  await expect(collection).toHaveAttribute("data-value", trades)
  await expect(page.locator(`[data-slot-id="${slotId(100)}"]`)).toBeVisible()
  await dock(page).getByRole("button", { name: "Wanted", exact: true }).click()
  await page.reload()
  await expect(dock(page).getByRole("button", { name: "Wanted", exact: true })).toHaveAttribute("aria-pressed", "true")
  await brand(page).click()
  await expect(collection).toHaveAttribute("data-value", trades)
  await expect(viewPicker(page)).toHaveAttribute("data-value", "binder")
  await expect(page.locator(`[data-slot-id="${slotId(100)}"]`)).toBeVisible()
})

test("desktop header Binder tab and brand leave the global Dex for the current collection", async ({ browser, baseURL }, info) => {
  test.skip(info.project.name !== "browser-390x844", "desktop runs once")
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" })
  const page = await context.newPage()
  await mockBackends(page, context, { signedIn: true, baseURL })
  await page.route("**/app/e2e-harness/storage/inventory?*", fulfillInventory)
  await page.goto(`${baseURL}${entry}&binder=${alpha}&page=2`)
  const header = page.getByTestId("app-header")
  await expect(page.locator(`[data-slot-id="${slotId(9)}"]`)).toBeVisible()
  await header.getByRole("button", { name: "Wanted", exact: true }).click()
  await expect(header.getByRole("button", { name: "Wanted", exact: true })).toHaveAttribute("aria-pressed", "true")
  await header.getByRole("button", { name: "Binder", exact: true }).click()
  await expect(collectionPicker(page)).toHaveAttribute("data-value", alpha)
  await expect(page.locator(`[data-slot-id="${slotId(9)}"]`)).toBeVisible()
  await header.getByRole("button", { name: "Browse", exact: true }).click()
  await expect(header.getByRole("button", { name: "Browse", exact: true })).toHaveAttribute("aria-pressed", "true")
  await brand(page).hover()
  await page.screenshot({ path: info.outputPath("desktop-brand-hover.png") })
  await brand(page).click()
  await expect(page.locator(`[data-slot-id="${slotId(9)}"]`)).toBeVisible()
  await page.screenshot({ path: info.outputPath("desktop-binder.png") })
  await context.close()
})

test("read-only share brand stays in its own binder and writes nothing", async ({ page }, info) => {
  const writes: string[] = []
  page.on("request", r => { if (r.method() !== "GET" && r.method() !== "HEAD" && /\/app\/api\/(collection|settings|binders)/.test(r.url())) writes.push(`${r.method()} ${r.url()}`) })
  await page.goto("/app/e2e-harness?readOnly=1")
  const home = page.getByTestId("app-header").getByRole("button", { name: "Shared binder: back to binder", exact: true })
  await expect(home).toBeVisible()
  // The mark must not push header controls onto a second row on narrow phones.
  const more = page.getByTestId("app-header").getByRole("button", { name: "More", exact: true })
  expect(Math.abs((await more.boundingBox())!.y - (await home.boundingBox())!.y)).toBeLessThan(8)
  await dock(page).getByRole("button", { name: "List", exact: true }).click()
  await expect(dock(page).getByRole("button", { name: "List", exact: true })).toHaveAttribute("aria-pressed", "true")
  await home.click()
  await expect(dock(page).getByRole("button", { name: "Binder", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect(page).toHaveURL(/readOnly=1/)
  await page.screenshot({ path: info.outputPath("share-brand.png") })
  expect(writes).toEqual([])
})

test("Inventory and Binder dock tabs are mutually exclusive and Binder returns to the remembered page", async ({ page }) => {
  await page.goto(`${entry}&binder=${alpha}&page=2`)
  await expect(page.locator(`[data-slot-id="${slotId(9)}"]`)).toBeVisible()
  const pressed = dock(page).locator('button[aria-pressed="true"]')
  await dock(page).getByRole("button", { name: "Inventory", exact: true }).click()
  await expect(page.getByRole("searchbox", { name: "Search inventory" })).toBeVisible()
  await expect(pressed).toHaveCount(1)
  await expect(pressed).toHaveAccessibleName("Inventory")
  await dock(page).getByRole("button", { name: "Binder", exact: true }).click()
  await expect(page.locator(`[data-slot-id="${slotId(9)}"]`)).toBeVisible()
  await expect(pressed).toHaveCount(1)
  await expect(pressed).toHaveAccessibleName("Binder")
})
