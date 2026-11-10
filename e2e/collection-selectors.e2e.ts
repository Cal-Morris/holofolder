import type { Page, Route } from "@playwright/test"
import { test, expect, mockBackends, emulateStandalone, E2E_USER, Harness, collectionPicker, viewPicker, chooseCollection, chooseView } from "./fixtures"
import { inventoryBrowseFixture, inventoryBrowseCatalog, inventoryBrowseLayouts } from "../tests/fixtures/inventory-browse"

const alpha = "22222222-2222-4222-8222-222222222222"
const trades = "33333333-3333-4333-8333-333333333333"
const uuid = (a: number, b: number) => `${String(a).padStart(8, "0")}-0000-4000-8000-${String(b).padStart(12, "0")}`
// Synthetic stress name, not a real collection.
const LONG = "SYNTHETIC very long collection name for overflow testing, Japanese illustration rares and special art favourites 2024"
const entry = (id = alpha) => `/app/e2e-harness?signedIn=1&browserHost=1&binder=${id}&view=binder`

function snapshotFor(kind: "plain" | "long" | "many") {
  const snapshot = inventoryBrowseFixture(5)
  const slots = new Map(snapshot.binders.flatMap((b, i) => b.slots.map((s, n) => [s.id, uuid(4, i * 100 + n)] as const)))
  const ids = (id: string) => id === "alpha" ? alpha : trades
  snapshot.ownerUserId = E2E_USER.id
  snapshot.items.forEach(i => { i.ownerUserId = E2E_USER.id })
  snapshot.collections.forEach(c => { c.ownerUserId = E2E_USER.id; c.id = ids(c.id) })
  snapshot.binders.forEach(b => { b.ownerUserId = E2E_USER.id; b.collectionId = ids(b.collectionId); b.slots.forEach(s => { s.ownerUserId = E2E_USER.id; s.id = slots.get(s.id)!; s.collectionId = b.collectionId }) })
  snapshot.placements.forEach(p => { p.collectionId = ids(p.collectionId); p.slotId = slots.get(p.slotId)! })
  const layouts = inventoryBrowseLayouts.map(l => ({ ...l, collectionId: ids(l.collectionId) }))
  if (kind === "long") snapshot.collections[0].name = LONG
  if (kind === "many") for (let n = 0; n < 18; n++) {
    const id = uuid(5, n)
    snapshot.collections.push({ ...structuredClone(snapshot.collections[1]), id, name: n === 3 ? LONG : `SYNTHETIC binder ${n + 1}` })
    snapshot.binders.push({ ...structuredClone(snapshot.binders[1]), collectionId: id, slots: snapshot.binders[1].slots.map((s, k) => ({ ...s, id: uuid(6, n * 100 + k), collectionId: id, inventoryItemId: null, status: null })) })
    layouts.push({ ...layouts[1], collectionId: id })
  }
  return { snapshot, layouts }
}
async function fulfill(route: Route, kind: "plain" | "long" | "many") {
  const { snapshot, layouts } = snapshotFor(kind)
  const url = new URL(route.request().url())
  await route.fulfill({ headers: { "Cache-Control": "private, no-store" }, json: { version: 2, requestId: url.searchParams.get("requestId"),
    scope: { actorUserId: E2E_USER.id, ownerUserId: E2E_USER.id, authSessionId: "synthetic-e2e-auth-session", sessionId: url.searchParams.get("sessionId") }, snapshot,
    navigation: { catalog: inventoryBrowseCatalog, layouts },
    evidence: { inventoryRevision: snapshot.inventoryRevision, items: snapshot.items.length, placements: snapshot.placements.length, collections: snapshot.collections.length,
      binders: snapshot.binders.length, slots: snapshot.binders.reduce((n, b) => n + b.slots.length, 0),
      storage: snapshot.binders.map(b => ({ collectionId: b.collectionId, collectionVersion: 1, layoutRevision: b.layoutRevision, slotCount: b.slots.length })) } } })
}
async function open(page: Page, kind: "plain" | "long" | "many" = "plain", id = alpha) {
  await page.route("**/app/e2e-harness/storage/inventory?*", route => fulfill(route, kind))
  await page.goto(entry(id))
  await expect(page.getByRole("button", { name: "Storage", exact: true })).toBeVisible({ timeout: 30000 })
}
test.beforeEach(async ({ page, context, standalone, insets, baseURL }) => {
  if (standalone) await emulateStandalone(page, insets)
  await mockBackends(page, context, { signedIn: true, baseURL })
})
const collectionMenu = (page: Page) => page.getByRole("dialog", { name: "Choose collection", exact: true })
const viewMenu = (page: Page) => page.getByRole("dialog", { name: "Choose view", exact: true })

test("selectors are enclosed buttons with the current value and a chevron", async ({ page, insets }) => {
  await open(page)
  const h = new Harness(page, insets, true)
  for (const [trigger, text] of [[collectionPicker(page), "Alpha"], [viewPicker(page), "Binder"]] as const) {
    await expect(trigger).toBeVisible()
    await expect(trigger).toHaveText(text)
    await expect(trigger).toHaveAttribute("aria-haspopup", "dialog")
    await expect(trigger).toHaveAttribute("aria-expanded", "false")
    await expect(trigger).toHaveCSS("border-top-width", "1px")
    await expect(trigger.locator("svg")).toHaveCount(1)
    await h.expectMinTapTarget(trigger, 36)
    await h.expectWithinSafeViewport(trigger)
  }
  await expect(page.getByRole("combobox", { name: "Collection", exact: true })).toHaveCount(0)
  await h.expectNoHorizontalOverflow()
})

test("choosing a collection and a view navigates to exactly that", async ({ page }) => {
  await open(page)
  await chooseCollection(page, trades)
  await expect(collectionPicker(page)).toHaveAttribute("data-value", trades)
  await expect(collectionPicker(page)).toHaveText("Trades")
  await expect(page).toHaveURL(new RegExp(`binder=${trades}`))
  await chooseView(page, "list")
  await expect(viewPicker(page)).toHaveAttribute("data-value", "list")
  await expect(viewPicker(page)).toHaveText("List")
  await expect(page).toHaveURL(/view=list/)
  await expect(collectionPicker(page)).toHaveAttribute("data-value", trades)
  await viewPicker(page).click()
  await expect(viewMenu(page).getByRole("menuitemradio")).toContainText(["Binder", "List"])
  await expect(viewMenu(page).getByRole("menuitemradio", { name: "List", exact: true })).toHaveAttribute("aria-checked", "true")
})

test("menus are labelled, bounded, mark the selection and dismiss every way without changing it", async ({ page, insets }) => {
  await open(page)
  const h = new Harness(page, insets, true)
  const trigger = collectionPicker(page), menu = collectionMenu(page)
  const opened = async () => { await trigger.click(); await expect(menu).toBeVisible(); await expect(trigger).toHaveAttribute("aria-expanded", "true") }
  await opened()
  await expect(menu.getByText("Collection", { exact: true })).toBeVisible()
  await expect(menu.getByRole("menuitemradio", { name: "Alpha", exact: true })).toHaveAttribute("aria-checked", "true")
  await expect(menu.getByRole("menuitemradio", { name: "Trades", exact: true })).toHaveAttribute("aria-checked", "false")
  const box = (await menu.boundingBox())!, size = h.viewport
  expect(box.width).toBeLessThanOrEqual(288)
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(size.width)
  const close = menu.getByRole("button", { name: "Close collection", exact: true })
  await h.expectMinTapTarget(close, 36); await h.expectWithinSafeViewport(close); await h.expectHittable(close)
  await close.click(); await expect(menu).toBeHidden()
  await opened(); await page.locator("[data-overlay-backdrop]").click({ position: { x: size.width - 4, y: size.height / 2 } }); await expect(menu).toBeHidden()
  await opened(); await page.keyboard.press("Escape"); await expect(menu).toBeHidden()
  await expect(trigger).toBeFocused()
  const before = page.url()
  await opened(); await page.goBack(); await expect(menu).toBeHidden()
  expect(page.url()).toBe(before)
  await expect(trigger).toHaveAttribute("data-value", alpha)
  await expect(page.getByRole("button", { name: "Storage", exact: true })).toBeVisible()
  await h.expectScrollUnlocked()
  // A dock tab switch closes it.
  await opened(); await h.dock().getByRole("button", { name: "Wanted", exact: true }).click(); await expect(menu).toBeHidden()
  // It does not stack with another overlay.
  await page.getByRole("button", { name: "Storage", exact: true }).click()
  await expect(h.dialogs()).toHaveCount(1)
  await expect(menu).toBeHidden()
})

test("keyboard opens, moves, selects, and Escape returns focus to the trigger", async ({ page }) => {
  await open(page)
  const trigger = collectionPicker(page), menu = collectionMenu(page)
  await trigger.focus(); await page.keyboard.press("Enter")
  await expect(menu).toBeVisible()
  await expect(menu.getByRole("menuitemradio", { name: "Alpha", exact: true })).toBeFocused()
  await page.keyboard.press("ArrowDown")
  await expect(menu.getByRole("menuitemradio", { name: "Trades", exact: true })).toBeFocused()
  await page.keyboard.press("ArrowDown")
  await expect(menu.getByRole("menuitemradio", { name: "Alpha", exact: true })).toBeFocused()
  await page.keyboard.press("ArrowUp")
  await expect(menu.getByRole("menuitemradio", { name: "Trades", exact: true })).toBeFocused()
  // Tab stays inside the dialog.
  for (let n = 0; n < 4; n++) { await page.keyboard.press("Tab"); expect(await menu.evaluate(el => el.contains(document.activeElement))).toBe(true) }
  await menu.getByRole("menuitemradio", { name: "Trades", exact: true }).focus()
  await page.keyboard.press("Escape")
  await expect(menu).toBeHidden(); await expect(trigger).toBeFocused()
  await expect(trigger).toHaveAttribute("data-value", alpha)
  await page.keyboard.press("Space")
  await expect(menu).toBeVisible()
  await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter")
  await expect(menu).toBeHidden()
  await expect(trigger).toHaveAttribute("data-value", trades)
  await expect(page).toHaveURL(new RegExp(`binder=${trades}`))
})

for (const kind of ["long", "many"] as const) test(`${kind} collection names stay bounded and keep the toolbar on screen`, async ({ page, insets }) => {
  await open(page, kind, kind === "many" ? uuid(5, 3) : alpha)
  const h = new Harness(page, insets, true)
  const trigger = collectionPicker(page), view = viewPicker(page), storage = page.getByRole("button", { name: "Storage", exact: true })
  await expect(trigger).toContainText("SYNTHETIC very long")
  await expect(trigger.locator("span")).toHaveCSS("text-overflow", "ellipsis")
  for (const control of [trigger, view, storage]) { await h.expectWithinSafeViewport(control); await h.expectHittable(control) }
  await h.expectNoHorizontalOverflow()
  const [t, v, s] = [await trigger.boundingBox(), await view.boundingBox(), await storage.boundingBox()]
  expect(t!.x + t!.width).toBeLessThanOrEqual(v!.x + 1)
  expect(v!.x + v!.width).toBeLessThanOrEqual(s!.x)
  await trigger.click()
  const menu = collectionMenu(page)
  await expect(menu).toBeVisible()
  const box = (await menu.boundingBox())!
  expect(box.width).toBeLessThanOrEqual(288); expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(h.viewport.width)
  expect(box.y + box.height).toBeLessThanOrEqual(h.viewport.height)
  await h.expectWithinSafeViewport(menu.getByRole("button", { name: "Close collection", exact: true }))
  const list = menu.getByRole("menu", { name: "Choose collection", exact: true })
  if (kind === "many") {
    expect(await list.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true)
    await menu.getByRole("menuitemradio", { name: /SYNTHETIC binder 18/ }).scrollIntoViewIfNeeded()
  }
  // A wrapped long name keeps its own row: no option is squeezed so its text spills over a neighbour.
  const rows = await menu.getByRole("menuitemradio").evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return [r.top, r.bottom, e.scrollHeight, e.clientHeight] }))
  rows.forEach((row, i) => { expect(row[2]).toBeLessThanOrEqual(row[3] + 1); if (i) expect(row[0]).toBeGreaterThanOrEqual(rows[i - 1][1] - 0.5) })
  expect(await menu.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  await h.expectNoHorizontalOverflow()
  await page.keyboard.press("Escape")
})
