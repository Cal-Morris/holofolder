import { test, expect, mockBackends, emulateStandalone, Harness, E2E_USER } from "./fixtures"
import type { Page } from "@playwright/test"
import type { SlotOfflineRecord } from "../lib/collection/slot-offline-queue"

test.use({ actionTimeout: 10_000 })
const collection = "22222222-2222-4222-8222-222222222222"
const entry = `/app/e2e-harness?signedIn=1&browserHost=1&binder=${collection}`
const copy = "synthetic-raw-copy-0"
// Synthetic catalog/auth/RPC/audit results only. Actual app host, IDB, HTTP bridge and fresh reads.
async function record(page: Page): Promise<SlotOfflineRecord> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((yes, no) => { const r = indexedDB.open("binderdex-offline"); r.onsuccess = () => yes(r.result); r.onerror = () => no(r.error) })
    const rows = await new Promise<unknown[]>((yes, no) => { const r = db.transaction("records").objectStore("records").getAll(); r.onsuccess = () => yes(r.result); r.onerror = () => no(r.error) })
    db.close()
    return rows.find(r => !!r && typeof r === "object" && "pending" in r) as SlotOfflineRecord
  })
}
async function inventory(page: Page) {
  await page.getByRole("navigation", { name: "Main navigation", exact: true }).getByRole("button", { name: "Inventory", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Inventory", exact: true })).toBeVisible()
}
async function open(page: Page) { await page.goto(entry); await inventory(page); await expect(page.getByRole("button", { name: "Add owned card", exact: true })).toBeVisible() }
async function detail(page: Page, itemId = copy) { await page.locator(`[data-item-id="${itemId}"]`).click(); return page.getByRole("dialog", { name: "Owned copy details" }) }
async function confirm(page: Page, receipts: number) {
  await page.getByRole("button", { name: "Confirm change", exact: true }).click()
  await expect.poll(async () => (await record(page))?.receipts.length).toBe(receipts)
  await expect(page.getByRole("button", { name: "Add owned card", exact: true })).toBeVisible()
}
async function selectAdd(page: Page) {
  await page.getByRole("button", { name: "Add owned card", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Add owned raw copy" })
  await dialog.getByRole("textbox", { name: "Search slot catalog" }).fill("Synthetic")
  await dialog.getByRole("button", { name: /^Synthetic raw card ·/ }).click()
  return dialog
}
async function place(page: Page, itemId: string, slotId: string, receipts: number) {
  const dialog = await detail(page, itemId)
  await dialog.getByRole("button", { name: /^(Assign|Move) copy$/ }).click()
  await dialog.getByRole("combobox", { name: "Compatible empty slot" }).selectOption(slotId)
  await dialog.getByRole("button", { name: "Review placement" }).click()
  await expect(dialog).toContainText(`slot ${slotId}`)
  await confirm(page, receipts)
}
test.beforeEach(async ({ page, context, standalone, insets, baseURL }) => {
  if (standalone) await emulateStandalone(page, insets)
  await mockBackends(page, context, { signedIn: true, baseURL })
  await context.addCookies([{ name: "hf-storage-fixture", value: `raw-${crypto.randomUUID()}`, url: baseURL! }])
  await page.route("**/app/api/tcg-card-search**", route => route.fulfill({ json: { cards: [{ id: "synthetic-raw", name: "Synthetic raw card", localId: "1", language: "en", set: { id: "synthetic", name: "Synthetic raw set" }, dexIds: [143] }] } }))
})

test("duplicate-aware add, exact assign/move/unassign/remove and current-read ACK", async ({ page, insets }) => {
  const sent: unknown[] = []
  await page.route("**/app/e2e-harness/storage/inventory", async route => { sent.push(route.request().postDataJSON()); await route.continue() })
  await open(page)
  let dialog = await selectAdd(page)
  await expect(dialog).toContainText("You already own 3 copies")
  await expect(dialog).toContainText("Finish unknown")
  await dialog.getByRole("button", { name: "Inspect copy synthetic-raw-copy-1", exact: true }).click()
  dialog = page.getByRole("dialog", { name: "Owned copy details" })
  await expect(dialog).toContainText("synthetic-raw-copy-1")
  await dialog.getByRole("button", { name: "Close copy details" }).click()
  dialog = await selectAdd(page)
  await dialog.getByRole("button", { name: "Add another raw copy" }).click()
  await expect(dialog).toContainText("distinct raw copy as Unassigned")
  const h = new Harness(page, insets, true)
  await h.expectWithinSafeViewport(dialog)
  await h.expectMinTapTarget(dialog.getByRole("button", { name: "Confirm change" }))
  await h.expectHittable(dialog.getByRole("button", { name: "Confirm change" }))
  await confirm(page, 1)
  const added = (await record(page)).snapshot!.items.find(i => ![copy, "synthetic-raw-copy-1", "synthetic-raw-copy-2", "synthetic-raw-unknown"].includes(i.id))!
  expect(added.grading).toBeNull(); expect(added.identity).toEqual({ kind: "card", cardId: "synthetic-raw", language: "en" })
  expect((await record(page)).snapshot!.placements.some(p => p.inventoryItemId === added.id)).toBe(false)
  await place(page, added.id, "synthetic-slot-1", 2)
  await place(page, added.id, "synthetic-other-slot", 3)
  dialog = await detail(page, added.id)
  await dialog.getByRole("button", { name: "Unassign copy", exact: true }).click()
  await expect(dialog).toContainText("Ownership stays unchanged")
  await confirm(page, 4)
  dialog = await detail(page, added.id)
  await dialog.getByRole("button", { name: "Remove owned copy", exact: true }).click()
  await expect(dialog).toContainText("Ownership decreases by one")
  await expect(dialog).toContainText("No storage slot changes")
  await dialog.getByRole("button", { name: "Cancel change" }).click()
  expect(sent).toHaveLength(4)
  await dialog.getByRole("button", { name: "Remove owned copy", exact: true }).click()
  await confirm(page, 5)
  expect((await record(page)).snapshot!.items).toHaveLength(4)
  expect((await record(page)).snapshot!.items.some(i => i.id === added.id)).toBe(false)
  expect((await record(page)).snapshot!.items.filter(i => i.id.startsWith("synthetic-raw-copy"))).toHaveLength(3)
  await h.expectNoHorizontalOverflow()
})

test("assigned removal previews exact consequences and composes existing Activity recovery", async ({ page }) => {
  const activityScope = { accountId: E2E_USER.id, ownerId: E2E_USER.id, membershipKey: JSON.stringify([null, E2E_USER.id]), memberIds: [E2E_USER.id] }
  await page.route("**/app/api/collection-activity**", route => {
    const query = new URL(route.request().url()).searchParams
    const event = { id: "104", recorded_at: "2026-11-10T12:00:00Z", format_version: 1, actor_kind: "user", actor_user_id: E2E_USER.id, source: "app", action: "inventory.removeOwned",
      affected_entities: { inventoryItemIds: [copy], collectionIds: [collection], slotIds: ["synthetic-slot-0"] },
      changes: [{ table: "inventory_items", id: copy, before: { identity: { kind: "card", cardId: "synthetic-raw" } }, after: null }] }
    return route.fulfill({ json: query.has("scope") ? { scope: activityScope } : { scope: activityScope, data: [event], nextCursor: null, syncedAt: "2026-11-10T12:01:00Z" } })
  })
  let loseRecovery = true
  await page.route("**/app/e2e-harness/storage/recovery?*", async route => {
    const response = await route.fetch()
    if (new URL(route.request().url()).searchParams.get("operation") === "recovery.apply" && loseRecovery) {
      loseRecovery = false; return route.abort("failed")
    }
    await route.fulfill({ response })
  })
  await open(page)
  const before = (await record(page)).snapshot!
  const dialog = await detail(page)
  await dialog.getByRole("button", { name: "Remove owned copy", exact: true }).click()
  await expect(dialog).toContainText(`Copy ${copy}`)
  await expect(dialog).toContainText("Its placement is cleared")
  await expect(dialog).toContainText("former slot, target, wants and order remain")
  await expect(dialog).toContainText("Activity")
  await confirm(page, 1)
  expect((await record(page)).snapshot!.items).toHaveLength(before.items.length - 1)
  await page.getByRole("button", { name: "Activity", exact: true }).click()
  const activity = page.getByRole("dialog", { name: "Collection Activity", exact: true })
  await expect(activity.getByRole("button", { name: "Undo", exact: true })).toHaveCount(0)
  await activity.getByRole("checkbox", { name: `Restore ${copy} as Unassigned` }).check()
  await activity.getByRole("button", { name: "Review recovery", exact: true }).click()
  await activity.getByRole("button", { name: "Confirm recovery", exact: true }).click()
  await expect.poll(async () => (await record(page)).recovery?.length).toBe(1)
  await expect(activity.getByRole("button", { name: "Retry exact recovery" })).toBeVisible()
  await activity.getByRole("button", { name: "Close Activity" }).click()
  await expect(page.getByRole("button", { name: "Add owned card", exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: "Activity", exact: true }).click()
  await activity.getByRole("button", { name: "Retry exact recovery" }).click()
  await expect.poll(async () => (await record(page)).recovery?.[0]?.synchronized).toBe(true)
  const restored = (await record(page)).snapshot!
  expect(restored.items.find(i => i.id === copy)).toEqual(before.items.find(i => i.id === copy))
  expect(restored.placements.some(p => p.inventoryItemId === copy)).toBe(false)
})

test("unknown identity can move only to free slots and remains unknown after unassign", async ({ page }) => {
  await open(page)
  let dialog = await detail(page, "synthetic-raw-unknown")
  await expect(dialog).toContainText("Language unknown")
  await expect(dialog).toContainText("Finish unknown")
  await dialog.getByRole("button", { name: "Assign copy", exact: true }).click()
  await expect(dialog.getByRole("option", { name: /synthetic-slot-2/ })).toHaveCount(0)
  await dialog.getByRole("combobox").selectOption("synthetic-slot-1")
  await dialog.getByRole("button", { name: "Review placement" }).click()
  await confirm(page, 1)
  dialog = await detail(page, "synthetic-raw-unknown")
  await dialog.getByRole("button", { name: "Unassign copy", exact: true }).click()
  await confirm(page, 2)
  expect((await record(page)).snapshot!.items.find(i => i.id === "synthetic-raw-unknown")!.identity).toEqual({ kind: "card", cardId: "synthetic-unknown" })
  dialog = await detail(page, "synthetic-raw-copy-2")
  await expect(dialog.getByRole("button", { name: /^(Assign copy|Move copy|Unassign copy|Remove owned copy)$/ })).toHaveCount(0)
})

test("committed add with lost reply survives cached reload with exact original intent", async ({ page }) => {
  let lost = true, failRead = false
  const bodies: string[] = []
  await page.route("**/app/e2e-harness/storage/inventory", async route => {
    bodies.push(route.request().postData()!)
    const response = await route.fetch()
    if (lost) { lost = false; failRead = true; await route.abort("failed") } else await route.fulfill({ response })
  })
  await page.route("**/app/e2e-harness/storage/inventory?*", async route => { if (failRead) await route.abort("failed"); else await route.continue() })
  await open(page)
  const dialog = await selectAdd(page)
  await dialog.getByRole("button", { name: "Add another raw copy" }).click()
  await dialog.getByRole("button", { name: "Confirm change" }).click()
  await expect.poll(async () => (await record(page))?.pending[0]?.status).toBe("unavailable")
  const original = (await record(page)).pending[0].intent
  await page.reload(); await inventory(page)
  await expect(page.getByRole("button", { name: "Add owned card", exact: true })).toHaveCount(0)
  await expect(page.getByText(/Cached only. Showing saved copies/)).toBeVisible()
  expect((await record(page)).pending[0].intent).toEqual(original)
  expect((await record(page)).receipts).toHaveLength(0)
  failRead = false
  await page.getByRole("button", { name: "Retry pending sync" }).click()
  await expect.poll(async () => (await record(page))?.receipts.length).toBe(1)
  expect(new Set(bodies).size).toBe(1)
  expect((await record(page)).snapshot!.items).toHaveLength(5)
})

for (const status of [409, 402, 403, 503]) test(`${status} retains exact raw intent and fences new actions`, async ({ page }) => {
  let reject = true
  const bodies: string[] = []
  await page.route("**/app/e2e-harness/storage/inventory", async route => {
    bodies.push(route.request().postData()!)
    if (reject) await route.fulfill({ status, json: { error: { code: "synthetic-error", message: "Synthetic", requestId: "synthetic" } } })
    else await route.continue()
  })
  await open(page)
  const dialog = await detail(page)
  await dialog.getByRole("button", { name: "Unassign copy", exact: true }).click()
  await dialog.getByRole("button", { name: "Confirm change" }).click()
  await expect.poll(async () => (await record(page))?.pending[0]?.status).toBe(status === 409 ? "conflict" : status === 402 ? "billing" : status === 403 ? "blocked" : "unavailable")
  const original = (await record(page)).pending[0].intent
  await expect(page.getByRole("button", { name: "Add owned card", exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Use current storage" })).toHaveCount(0)
  reject = false
  await page.getByRole("button", { name: "Retry pending sync" }).click()
  await expect.poll(async () => (await record(page))?.receipts.length).toBe(1)
  expect((await record(page)).receipts[0].intent).toEqual(original)
  expect(new Set(bodies).size).toBe(1)
})

for (const change of ["signout", "account", "owner"] as const) test(`${change} teardown retains in-flight raw command and lease without late ACK`, async ({ page }) => {
  let release!: () => void, started!: () => void
  const barrier = new Promise<void>(yes => { release = yes }), sending = new Promise<void>(yes => { started = yes })
  await page.route("**/app/e2e-harness/storage/inventory", async route => { const response = await route.fetch(); started(); await barrier; await route.fulfill({ response }).catch(() => {}) })
  await open(page)
  const dialog = await detail(page)
  await dialog.getByRole("button", { name: "Unassign copy", exact: true }).click()
  await dialog.getByRole("button", { name: "Confirm change" }).click(); await sending
  const original = (await record(page)).pending[0].intent
  if (change === "owner") await page.route("**/rest/v1/partnerships*", route => route.fulfill({ json: [{ id: "synthetic-membership", owner_user_id: "33333333-3333-4333-8333-333333333333", user1_id: E2E_USER.id, user2_id: "33333333-3333-4333-8333-333333333333" }] }))
  await page.evaluate(({ change, user }) => { const channel = new BroadcastChannel("sb-127-auth-token")
    channel.postMessage(change === "signout" ? { event: "SIGNED_OUT", session: null } : { event: change === "account" ? "SIGNED_IN" : "TOKEN_REFRESHED", session: { user: change === "account" ? { ...user, id: "55555555-5555-4555-8555-555555555555" } : user } }); channel.close()
  }, { change, user: E2E_USER })
  await expect(page.getByRole("heading", { name: "Inventory", exact: true })).not.toBeVisible()
  release()
  await expect.poll(async () => (await record(page)).pending[0]?.status).toBe("sending")
  expect((await record(page)).pending[0].intent).toEqual(original)
  expect((await record(page)).receipts).toHaveLength(0)
})

test("local IDB failure retries the same add ID, operation and preview", async ({ page }) => {
  await open(page)
  const dialog = await selectAdd(page)
  await dialog.getByRole("button", { name: "Add another raw copy" }).click()
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function(value, key) {
      if (typeof key === "string" && key.startsWith("slot-intent:") && value.pending.length) {
        IDBObjectStore.prototype.put = put
        document.documentElement.dataset.failedRawIntent = JSON.stringify(value.pending[0].intent)
        throw new DOMException("Synthetic quota", "QuotaExceededError")
      }
      return put.call(this, value, key)
    }
  })
  await dialog.getByRole("button", { name: "Confirm change" }).click()
  await expect(dialog.getByRole("alert")).toContainText("Retry this same request")
  const original = JSON.parse((await page.locator("html").getAttribute("data-failed-raw-intent"))!)
  await confirm(page, 1)
  expect((await record(page)).receipts[0].intent).toEqual(original)
})

test("add and copy review use shared sheet dismissals, safe targets and dock clearance", async ({ page, insets }) => {
  await open(page)
  const h = new Harness(page, insets, true)
  const add = async () => { await page.getByRole("button", { name: "Add owned card", exact: true }).click(); const d = page.getByRole("dialog", { name: "Add owned raw copy" }); await expect(d).toBeVisible(); return d }
  let d = await add()
  const close = d.getByRole("button", { name: "Close add owned card" })
  await h.expectMinTapTarget(close); await h.expectHittable(close); await h.expectWithinSafeViewport(d)
  const box = (await d.boundingBox())!, dock = (await h.dock().boundingBox())!
  expect(box.y + box.height).toBeLessThanOrEqual(dock.y)
  const geometry = { viewport: page.viewportSize(), insets, sheet: box, close: await close.boundingBox(), dockTop: dock.y, dockGap: dock.y - box.y - box.height }
  console.log("raw ownership sheet geometry", test.info().project.name, JSON.stringify(geometry))
  await test.info().attach("raw-ownership-layout.json", { contentType: "application/json", body: JSON.stringify(geometry) })
  await close.click(); await expect(d).toBeHidden()
  d = await add(); await page.keyboard.press("Escape"); await expect(d).toBeHidden()
  d = await add(); await h.tapBackdrop(d); await expect(d).toBeHidden()
  d = await add(); await h.swipeDown(d); await expect(d).toBeHidden()
  d = await add(); await page.goBack(); await expect(d).toBeHidden()
  d = await add(); await h.dock().getByRole("button", { name: "Binder", exact: true }).click(); await expect(d).toBeHidden()
  await inventory(page)
  d = await detail(page); await d.getByRole("button", { name: "Remove owned copy", exact: true }).click()
  await h.expectWithinSafeViewport(d); await h.expectNoHorizontalOverflow()
  await h.expectWithinSafeViewport(d.getByRole("button", { name: "Confirm change" })); await h.expectHittable(d.getByRole("button", { name: "Confirm change" }))
  await page.keyboard.press("Escape"); await expect(d).toBeHidden()
  expect((await record(page)).pending).toHaveLength(0)
})

test("current partner authority edits the resolved owner's exact raw copy", async ({ page, context, baseURL }) => {
  const owner = "11111111-1111-4111-8111-111111111111"
  await context.addCookies([{ name: "hf-storage-fixture", value: `raw-partner-${crypto.randomUUID()}`, url: baseURL! }])
  await page.route("**/rest/v1/partnerships*", route => route.fulfill({ json: [{ id: "synthetic-raw-partnership", owner_user_id: owner, user1_id: owner, user2_id: E2E_USER.id }] }))
  await open(page)
  const dialog = await detail(page)
  await dialog.getByRole("button", { name: "Unassign copy", exact: true }).click()
  await confirm(page, 1)
  expect((await record(page)).snapshot!.ownerUserId).toBe(owner)
  expect((await record(page)).snapshot!.items.every(i => i.ownerUserId === owner)).toBe(true)
  expect((await record(page)).snapshot!.placements.some(p => p.inventoryItemId === copy)).toBe(false)
})

test("pending creation fences Inventory ownership without changing the creation lane", async ({ page }) => {
  await page.route("**/app/e2e-harness/storage/creation", route => route.fulfill({ status: 503, json: { error: "Synthetic unavailable creation" } }))
  await open(page)
  await page.getByRole("button", { name: "New storage", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "New storage", exact: true })
  await dialog.getByRole("textbox", { name: "Storage name" }).fill("Synthetic pending creation")
  await dialog.getByRole("button", { name: "Review storage", exact: true }).click()
  await dialog.getByRole("button", { name: "Confirm create storage", exact: true }).click()
  await expect.poll(async () => (await record(page)).pending[0]?.intent.kind).toBe("creation")
  const original = (await record(page)).pending[0].intent
  await dialog.getByRole("button", { name: "Close new storage", exact: true }).click()
  await expect(page.getByRole("button", { name: "Add owned card", exact: true })).toHaveCount(0)
  const owned = await detail(page)
  await expect(owned.getByRole("button", { name: "Unassign copy", exact: true })).toHaveCount(0)
  expect((await record(page)).pending[0].intent).toEqual(original)
})

test("two real tabs preserve the first copy command and lease while stale confirmation cannot replace it", async ({ page, context, baseURL, standalone, insets }) => {
  let release!: () => void, started!: () => void
  const barrier = new Promise<void>(yes => { release = yes }), sending = new Promise<void>(yes => { started = yes })
  let sends = 0
  await context.route("**/app/e2e-harness/storage/inventory", async route => { sends++; const response = await route.fetch(); started(); await barrier; await route.fulfill({ response }).catch(() => {}) })
  await open(page)
  const other = await context.newPage()
  if (standalone) await emulateStandalone(other, insets)
  await mockBackends(other, context, { signedIn: true, baseURL })
  await open(other)
  const d = await detail(page), second = await detail(other)
  await d.getByRole("button", { name: "Unassign copy", exact: true }).click()
  await second.getByRole("button", { name: "Unassign copy", exact: true }).click()
  await d.getByRole("button", { name: "Confirm change", exact: true }).click(); await sending
  const original = (await record(page)).pending[0].intent
  const button = second.getByRole("button", { name: "Confirm change", exact: true })
  if (await button.isVisible()) await button.click()
  expect((await record(other)).pending).toHaveLength(1)
  expect((await record(other)).pending[0].intent).toEqual(original)
  expect(sends).toBe(1)
  release()
  await expect.poll(async () => (await record(page)).receipts.length).toBe(1)
  await other.close()
})

test("a synchronized add reopens from IDB when all fresh inventory reads fail and remains read-only", async ({ page }) => {
  await open(page)
  const dialog = await selectAdd(page)
  await dialog.getByRole("button", { name: "Add another raw copy" }).click()
  await confirm(page, 1)
  const snapshot = (await record(page)).snapshot!
  await page.route("**/app/e2e-harness/storage/inventory?*", route => route.abort("failed"))
  await page.reload(); await inventory(page)
  await expect(page.getByText(/Cached only. Showing saved copies/)).toBeVisible()
  await expect(page.getByRole("button", { name: "Add owned card", exact: true })).toHaveCount(0)
  expect((await record(page)).snapshot).toEqual(snapshot)
  expect((await record(page)).snapshot!.items).toHaveLength(5)
  const d = await detail(page)
  await expect(d.getByRole("button", { name: "Remove owned copy", exact: true })).toHaveCount(0)
})
