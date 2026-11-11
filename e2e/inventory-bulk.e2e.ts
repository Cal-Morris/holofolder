import { test, expect, mockBackends, emulateStandalone, Harness, E2E_USER, openStorage } from "./fixtures"
import type { Page } from "@playwright/test"
import type { SlotOfflineRecord } from "../lib/collection/slot-offline-queue"

test.use({ actionTimeout: 10_000 })
const collection = "22222222-2222-4222-8222-222222222222"
const entry = `/app/e2e-harness?signedIn=1&browserHost=1&binder=${collection}`
const first = "synthetic-raw-copy-0", second = "synthetic-raw-copy-1"
// Synthetic auth, catalog, RPC ledger and Activity only. Real app host/IDB/HTTP/fresh-read ACK.
async function record(page: Page): Promise<SlotOfflineRecord> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((yes, no) => { const r = ((q) => (q.onupgradeneeded = () => { if (!q.result.objectStoreNames.contains("records")) q.result.createObjectStore("records") }, q))(indexedDB.open("binderdex-offline", 1)); r.onsuccess = () => yes(r.result); r.onerror = () => no(r.error) })
    const rows = await new Promise<unknown[]>((yes, no) => { const r = db.transaction("records").objectStore("records").getAll(); r.onsuccess = () => yes(r.result); r.onerror = () => no(r.error) })
    db.close(); return rows.find(r => !!r && typeof r === "object" && "pending" in r) as SlotOfflineRecord
  })
}
// Checkbox names are collector-facing, so tests find a copy's checkbox through its row's data-item-id.
const pick = (page: Page, id: string) => page.getByRole("listitem").filter({ has: page.locator(`[data-item-id="${id}"]`) }).getByRole("checkbox")
async function inventory(page: Page) {
  await page.getByRole("navigation", { name: "Main navigation", exact: true }).getByRole("button", { name: "Inventory", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Inventory", exact: true })).toBeVisible()
}
// Selecting is a deliberate mode: Select turns each card into a checkbox and shows the selection bar.
const selection = (page: Page) => page.getByLabel("Inventory selection", { exact: true })
const review = (page: Page) => page.getByRole("dialog", { name: "Move selected cards", exact: true })
const send = (d: ReturnType<typeof review>) => d.getByRole("button", { name: "Move cards", exact: true })
async function selectMode(page: Page) {
  await page.getByRole("button", { name: "Select", exact: true }).click()
  await expect(selection(page)).toContainText("Tap cards to select")
}
async function open(page: Page, selecting = true) {
  await page.goto(entry); await inventory(page); await expect(page.getByRole("button", { name: "Add owned card", exact: true })).toBeVisible()
  if (selecting) await selectMode(page)
}
async function select(page: Page, ids = [first, second]) {
  for (const id of ids) await pick(page, id).check()
  await selection(page).getByRole("button", { name: "Move", exact: true }).click()
  await expect(review(page)).toBeVisible()
  return review(page)
}
// Each card gets its own empty pocket, in the order the cards were picked. Nothing is sent until Move cards.
async function mapBoth(d: ReturnType<typeof review>) {
  await d.getByRole("combobox").nth(0).selectOption(JSON.stringify([collection, "synthetic-slot-1"]))
  await d.getByRole("combobox").nth(1).selectOption(JSON.stringify(["33333333-3333-4333-8333-333333333333", "synthetic-other-slot"]))
}
async function moveReview(page: Page) {
  const d = await select(page)
  await mapBoth(d)
  return d
}
async function confirm(page: Page, button: ReturnType<typeof send>, count: number) {
  await button.click()
  await expect.poll(async () => (await record(page))?.receipts.length).toBe(count)
}
test.beforeEach(async ({ page, context, standalone, insets, baseURL }) => {
  if (standalone) await emulateStandalone(page, insets)
  await mockBackends(page, context, { signedIn: true, baseURL })
  await context.addCookies([{ name: "hf-storage-fixture", value: `raw-${crypto.randomUUID()}`, url: baseURL! }])
})
test("explicit bulk mapping cancels, moves and unassigns all copies, exact Activity link and phone geometry", async ({ page, insets }) => {
  const bodies: { commands: unknown[]; operationId: string }[] = []
  await page.route("**/app/e2e-harness/storage/inventory", async route => { bodies.push(route.request().postDataJSON()); await route.continue() })
  await open(page)
  const before = (await record(page)).snapshot!
  await expect(pick(page, "synthetic-raw-copy-2")).toBeDisabled()
  await expect(pick(page, first)).not.toHaveAccessibleName(/synthetic-raw-copy/)
  await expect(pick(page, first)).toHaveAccessibleName(/^Select .+, .+/)
  let d = await moveReview(page)
  // Each card is shown with where it is now. One of these is in a pocket and one is not in a binder,
  // so taking both out of their binders is not offered.
  await expect(d.getByRole("heading")).toHaveText("Move 2 cards")
  await expect(d).toContainText("Not in a binder")
  await expect(d.getByRole("button", { name: "Take out of binders", exact: true })).toHaveCount(0)
  const h = new Harness(page, insets, true)
  await h.expectWithinSafeViewport(d)
  await h.expectMinTapTarget(send(d))
  await h.expectHittable(send(d))
  await h.expectNoHorizontalOverflow()
  const box = await d.boundingBox()
  console.log(`bulk review geometry ${test.info().project.name}`, JSON.stringify(box))
  // Closing the sheet sends nothing and keeps the selection; the pockets are chosen again on reopening.
  await d.getByRole("button", { name: "Close", exact: true }).click()
  await expect(d).toBeHidden()
  expect(bodies).toHaveLength(0)
  await expect(selection(page)).toContainText("2 selected")
  await selection(page).getByRole("button", { name: "Move", exact: true }).click()
  await expect(send(d)).toBeDisabled()
  await mapBoth(d)
  await confirm(page, send(d), 1)
  expect(bodies).toHaveLength(1); expect(bodies[0].commands).toHaveLength(2)
  expect((await record(page)).snapshot!.items).toEqual(before.items)
  // A saved move ends the selection.
  await expect(selection(page)).toHaveCount(0)
  await selectMode(page)
  d = await select(page)
  // Both cards are in pockets now, so they can be taken out together.
  await confirm(page, d.getByRole("button", { name: "Take out of binders", exact: true }), 2)
  const after = (await record(page)).snapshot!
  expect(after.items).toEqual(before.items)
  expect(after.placements).toHaveLength(0)
  expect(after.binders.map(b => b.slots.map(s => [s.id, s.target, s.wantedCards, s.presetOrigin]))).toEqual(before.binders.map(b => b.slots.map(s => [s.id, s.target, s.wantedCards, s.presetOrigin])))
  const operationId = bodies[1].operationId
  const scope = { accountId: E2E_USER.id, ownerId: E2E_USER.id, membershipKey: JSON.stringify([null, E2E_USER.id]), memberIds: [E2E_USER.id] }
  await page.route("**/app/api/collection-activity**", route => {
    const query = new URL(route.request().url()).searchParams
    if (query.has("id")) expect(query.get("id")).toBe("103")
    else if (!query.has("scope")) expect(query.get("operationId")).toBe(operationId)
    return route.fulfill({ json: query.has("scope") ? { scope } : { scope, data: [{ id: "103", operation_id: operationId, recorded_at: "2026-11-10T12:00:00Z", format_version: 1, actor_kind: "user", actor_user_id: E2E_USER.id, source: "app", action: "inventory.bulk", affected_entities: { inventoryItemIds: [first, second], collectionIds: [collection], slotIds: ["synthetic-slot-1"] }, changes: [{ table: "inventory_placements", id: first, before: { slot_id: "synthetic-slot-1" }, after: null }] }], nextCursor: null, syncedAt: "2026-11-10T12:01:00Z" } })
  })
  await (await openStorage(page)).getByText("Recent changes", { exact: true }).click()
  await page.getByRole("combobox", { name: "Synchronized change" }).selectOption(operationId)
  await page.getByRole("button", { name: "Show in Activity" }).click()
  const activity = page.getByRole("dialog", { name: "Collection Activity", exact: true })
  await expect(activity.getByRole("button", { name: "Undo", exact: true })).toHaveCount(0)
  await activity.getByRole("button", { name: "Open exact entry 103", exact: true }).click()
  await activity.getByRole("button", { name: "See what undoing does", exact: true }).click()
  // The pocket changed after this move, so Activity says the change can no longer be undone and offers no undo.
  await expect(activity.getByRole("region", { name: "Review recovery", exact: true })).toContainText("This change can no longer be undone")
  await expect(activity.getByRole("button", { name: "Undo this change" })).toHaveCount(0)
})
test("selection crosses explicit pages and filters, clear resets all, overlay dismissal never dispatches", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "hf-storage-fixture", value: `raw-bulk-${crypto.randomUUID()}`, url: baseURL! }])
  await open(page, false)
  await expect(selection(page)).toHaveCount(0)
  await selectMode(page)
  // One card from each of the first two windows: the selection is kept while loading more and searching.
  const boxes = page.getByRole("list", { name: "Owned copies" }).getByRole("checkbox", { disabled: false })
  const places: string[] = []
  places.push((await boxes.first().getAttribute("aria-label"))!)
  await boxes.first().check()
  await page.getByRole("navigation", { name: "Inventory pages", exact: true }).getByRole("button", { name: "Show more", exact: true }).click()
  places.push((await boxes.nth(40).getAttribute("aria-label"))!)
  await boxes.nth(40).check()
  await page.getByRole("searchbox", { name: "Search inventory" }).fill("no matching synthetic card")
  await expect(selection(page)).toContainText("2 selected")
  await selection(page).getByRole("button", { name: "Move", exact: true }).click()
  let d = review(page)
  await expect(d.getByRole("heading")).toHaveText("Move 2 cards")
  await expect(d.getByRole("combobox")).toHaveCount(2)
  // Nothing can be sent until every card has a pocket, and taking out is only offered when all are in one.
  await expect(send(d)).toBeDisabled()
  await expect(d.getByRole("button", { name: "Take out of binders", exact: true })).toHaveCount(places.some(label => label.includes("Not in a binder")) ? 0 : 1)
  await page.keyboard.press("Escape"); await expect(d).toBeHidden()
  await selection(page).getByRole("button", { name: "Move", exact: true }).click()
  d = review(page)
  await d.getByRole("button", { name: "Close", exact: true }).click()
  await page.getByRole("button", { name: "Clear selection" }).click()
  await expect(selection(page)).toContainText("Tap cards to select")
  await expect(page.getByRole("list", { name: "Owned copies" }).getByRole("checkbox", { checked: true })).toHaveCount(0)
  expect((await record(page)).pending).toHaveLength(0)
})
test("lost bulk reply retains original bytes and ID through cached reload until a fresh complete ACK", async ({ page }) => {
  let lost = true, failRead = false
  const bodies: string[] = []
  await page.route("**/app/e2e-harness/storage/inventory", async route => {
    bodies.push(route.request().postData()!)
    const response = await route.fetch()
    if (lost) { lost = false; failRead = true; await route.abort("failed") } else await route.fulfill({ response })
  })
  await page.route("**/app/e2e-harness/storage/inventory?*", route => failRead ? route.abort("failed") : route.continue())
  await open(page)
  const before = (await record(page)).snapshot!
  const d = await moveReview(page)
  await send(d).click()
  await expect.poll(async () => (await record(page))?.pending[0]?.status).toBe("unavailable")
  const original = (await record(page)).pending[0].intent
  await page.reload(); await inventory(page)
  expect((await record(page)).pending[0].intent).toEqual(original)
  // While the change is still on its way, no new selection or Activity lookup is offered.
  await expect(page.getByRole("button", { name: "Select", exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Show in Activity" })).toHaveCount(0)
  failRead = false
  await page.getByRole("button", { name: "Try now" }).click()
  await expect.poll(async () => (await record(page)).receipts.length).toBe(1)
  expect(new Set(bodies).size).toBe(1)
  expect((await record(page)).snapshot!.items).toEqual(before.items)
})
for (const changed of ["revision", "membership", "session", "incomplete"] as const) test(`bulk confirmation fences changed ${changed} before dispatch`, async ({ page }) => {
  let posts = 0
  await page.route("**/app/e2e-harness/storage/inventory", async route => { posts++; await route.continue() })
  await open(page)
  const d = await moveReview(page)
  await page.route("**/app/e2e-harness/storage/inventory?*", async route => {
    const response = await route.fetch(), body = await response.json()
    if (changed === "revision") { body.snapshot.inventoryRevision++; body.evidence.inventoryRevision++ }
    if (changed === "membership") body.scope.ownerUserId = "33333333-3333-4333-8333-333333333333"
    if (changed === "session") body.scope.authSessionId = "synthetic-changed-session"
    if (changed === "incomplete") body.snapshot.items.pop()
    await route.fulfill({ response, json: body })
  })
  await send(d).click()
  // The check before sending reads the collection again. Any of these makes that read unusable for a save,
  // so the sheet closes with nothing sent; when the read itself was refused, the page says it is showing a saved copy.
  await expect(d).toBeHidden()
  if (changed !== "revision") await expect(page.getByRole("status").filter({ hasText: "Couldn't update just now" })).toBeVisible()
  expect(posts).toBe(0); expect((await record(page)).pending).toHaveLength(0)
})

test("bulk sheet dismisses with shared back, backdrop, swipe and dock without dispatch", async ({ page, insets }) => {
  await open(page)
  const h = new Harness(page, insets, true)
  await pick(page, first).check()
  const opener = selection(page).getByRole("button", { name: "Move", exact: true })
  const d = review(page)
  for (const method of ["back", "backdrop", "swipe"] as const) {
    await opener.click(); await expect(d).toBeVisible()
    await h.expectMinTapTarget(d.getByRole("button", { name: "Close", exact: true }))
    if (method === "back") await page.goBack()
    if (method === "backdrop") await h.tapBackdrop(d)
    if (method === "swipe") await h.swipeDown(d)
    await expect(d).toBeHidden(); await h.expectScrollUnlocked(); await expect(opener).toBeFocused()
  }
  await page.evaluate(() => document.documentElement.classList.toggle("dark"))
  await opener.click(); await h.expectWithinSafeViewport(d); await h.expectNoHorizontalOverflow()
  await page.getByRole("navigation", { name: "Main navigation", exact: true }).getByRole("button", { name: "Binder", exact: true }).click()
  await expect(d).toBeHidden(); await h.expectScrollUnlocked()
  expect((await record(page)).pending).toHaveLength(0)
})
