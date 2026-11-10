import { test, expect, mockBackends, emulateStandalone, Harness, E2E_USER } from "./fixtures"
import type { Page } from "@playwright/test"
import type { SlotOfflineRecord } from "../lib/collection/slot-offline-queue"

const collection = "22222222-2222-4222-8222-222222222222"
const entry = `/app/e2e-harness?signedIn=1&browserHost=1&binder=${collection}`
const button = (p: Page, name: string) => p.getByRole("button", { name, exact: true })
const dialog = (p: Page) => p.getByRole("dialog", { name: "Review slot removal", exact: true })
async function record(page: Page): Promise<SlotOfflineRecord> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((yes, no) => { const r = indexedDB.open("binderdex-offline"); r.onsuccess = () => yes(r.result); r.onerror = () => no(r.error) })
    const rows = await new Promise<unknown[]>((yes, no) => { const r = db.transaction("records").objectStore("records").getAll(); r.onsuccess = () => yes(r.result); r.onerror = () => no(r.error) })
    db.close()
    return rows.find(r => !!r && typeof r === "object" && "pending" in r) as SlotOfflineRecord
  })
}
async function select(page: Page, ids = [1, 2, 3, 4]) {
  await button(page, "Edit layout").click()
  await button(page, "Select several pockets").click()
  await expect(button(page, "Remove selected slots")).toBeDisabled()
  for (const id of ids) await button(page, `Select slot ${id}`).click()
  await button(page, "Remove selected slots").click()
  await expect(dialog(page)).toBeVisible()
}
async function confirm(page: Page) { await button(page, "Confirm slot removal").click() }

test.beforeEach(async ({ page, context, standalone, insets, baseURL }) => {
  if (standalone) await emulateStandalone(page, insets)
  await mockBackends(page, context, { signedIn: true, baseURL })
  // Synthetic catalog/session/RPC only. Actual component, host, HTTP bridge, complete reads and IDB.
  await context.addCookies([{ name: "hf-storage-fixture", value: `remove-${crypto.randomUUID()}`, url: baseURL! }])
})

test("bulk consequences, duplicate/raw/graded/unknown retention and one atomic confirmed HTTP request", async ({ page, insets }) => {
  const bodies: { commands: { kind: string; slots: { slot: { id: string } }[] }[] }[] = []
  await page.route("**/app/e2e-harness/storage/inventory", async route => { bodies.push(route.request().postDataJSON()); await route.continue() })
  await page.goto(entry)
  await expect(button(page, "Remove selected slots")).toHaveCount(0)
  await expect(button(page, "Remove selected slot")).toHaveCount(0)
  await expect.poll(async () => (await record(page))?.snapshot?.items.length).toBe(4)
  const before = (await record(page)).snapshot!
  const browse = await page.getByRole("region", { name: "Layout editing", exact: true }).boundingBox()
  await select(page)
  await expect(dialog(page)).toContainText("Slots to remove: 4 · Targets to remove: 1 · Explicit wants to remove: 1 · Owned copies becoming Unassigned: 4")
  await expect(dialog(page)).toContainText("Want to remove: Synthetic explicit want")
  await expect(dialog(page)).toContainText("Recorded graded copy, metadata retained")
  await expect(dialog(page)).toContainText("unknown printing")
  expect(bodies).toHaveLength(0); expect((await record(page)).pending).toHaveLength(0)
  const h = new Harness(page, insets, true)
  await h.expectWithinSafeViewport(dialog(page)); await h.expectNoHorizontalOverflow()
  for (const name of ["Confirm slot removal", "Cancel removal", "Close slot removal"]) {
    await h.expectMinTapTarget(button(page, name), 36); await h.expectHittable(button(page, name))
  }
  console.log("removal geometry", test.info().project.name, JSON.stringify({ browse, review: await dialog(page).boundingBox() }))
  await button(page, "Confirm slot removal").evaluate(el => { (el as HTMLButtonElement).click(); (el as HTMLButtonElement).click() })
  await expect.poll(async () => (await record(page))?.receipts.length).toBe(1)
  expect(bodies).toHaveLength(1)
  expect(bodies[0].commands).toHaveLength(1)
  expect(bodies[0].commands[0].kind).toBe("removeSlots")
  expect(bodies[0].commands[0].slots.map(s => s.slot.id)).toEqual([0, 1, 2, 3].map(n => `synthetic-slot-${n}`))
  const after = (await record(page)).snapshot!
  expect(after.items).toEqual(before.items)
  expect(after.placements).toHaveLength(0)
  expect(after.binders[0].slots).toEqual(before.binders[0].slots.slice(4))
  expect(after.binders[0].presetManifest).toEqual(before.binders[0].presetManifest)
  expect(after.collections[0].id).toBe(collection)
  await expect(button(page, "Undo")).toHaveCount(0)
})

test("single selected slot has exact confirmation, cancel leaves Browse unchanged", async ({ page, insets }) => {
  await page.goto(entry)
  const slot = page.locator('[data-slot-id="synthetic-slot-0"]')
  await slot.click()
  await expect(button(page, "Remove selected slot")).toHaveCount(0)
  await button(page, "Close slot details").click()
  await button(page, "Edit layout").click(); await slot.click()
  await button(page, "Remove selected slot").click()
  const review = page.getByRole("region", { name: "Review slot removal", exact: true })
  await expect(review).toContainText("Slots to remove: 1 · Targets to remove: 1 · Explicit wants to remove: 1 · Owned copies becoming Unassigned: 1")
  const h = new Harness(page, insets, true)
  await h.expectHittable(button(page, "Confirm slot removal"))
  await h.expectMinTapTarget(button(page, "Confirm slot removal"), 36)
  await button(page, "Cancel removal").click()
  expect((await record(page)).pending).toHaveLength(0)
  await button(page, "Remove selected slot").click(); await confirm(page)
  await expect.poll(async () => (await record(page))?.receipts.length).toBe(1)
  expect((await record(page)).snapshot!.placements).toHaveLength(3)
  expect((await record(page)).snapshot!.items).toHaveLength(4)
})

test("local IDB abort retains exact reviewed operation, timestamp, versions and order for retry", async ({ page }) => {
  let body = ""
  await page.route("**/app/e2e-harness/storage/inventory", async route => { body = route.request().postData()!; await route.continue() })
  await page.goto(entry); await select(page)
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put; let aborted = false
    IDBObjectStore.prototype.put = function(value, key) {
      const request = key === undefined ? put.call(this, value) : put.call(this, value, key)
      if (value?.pending?.[0]?.intent && !aborted) { aborted = true; sessionStorage.setItem("aborted-removal", JSON.stringify(value.pending[0].intent)); this.transaction.abort() }
      return request
    }
  })
  await confirm(page); await expect(button(page, "Retry same removal")).toBeVisible()
  expect(body).toBe(""); expect((await record(page)).pending).toHaveLength(0)
  const original = await page.evaluate(() => JSON.parse(sessionStorage.getItem("aborted-removal")!))
  await button(page, "Retry same removal").click()
  await expect.poll(async () => (await record(page))?.receipts.length).toBe(1)
  expect(JSON.parse(body)).toEqual(original.request)
  expect((await record(page)).receipts[0].intent).toEqual(original)
})

test("unknown committed reply survives cached reload, exact retry and fresh complete ACK", async ({ page }) => {
  let failRead = false
  const bodies: string[] = []
  await page.route("**/app/e2e-harness/storage/inventory", async route => {
    bodies.push(route.request().postData()!); const response = await route.fetch()
    if (bodies.length === 1) { failRead = true; await route.abort("failed") } else await route.fulfill({ response })
  })
  await page.route("**/app/e2e-harness/storage/inventory?*", route => failRead ? route.abort("failed") : route.continue())
  await page.goto(entry); await select(page); await confirm(page)
  await expect.poll(async () => (await record(page))?.pending[0]?.status).toBe("unavailable")
  const original = (await record(page)).pending[0].intent
  await expect(button(page, "Use current storage")).toHaveCount(0)
  await button(page, "Done").click(); await page.reload()
  await expect(button(page, "Edit layout")).not.toBeVisible()
  expect((await record(page)).pending[0].intent).toEqual(original)
  expect((await record(page)).receipts).toHaveLength(0)
  failRead = false
  // The existing sender may complete an exact automatic replay as this control remounts.
  await button(page, "Retry pending sync").evaluateAll(buttons => (buttons[0] as HTMLButtonElement | undefined)?.click())
  await expect.poll(async () => (await record(page))?.receipts.length).toBe(1)
  expect(new Set(bodies).size).toBe(1)
  expect((await record(page)).snapshot!.items).toHaveLength(4)
})

test("accepted HTTP reply alone is not fresh-read ACK", async ({ page }) => {
  let sent = false, failRead = true
  await page.route("**/app/e2e-harness/storage/inventory", async route => { const response = await route.fetch(); sent = true; await route.fulfill({ response }) })
  await page.route("**/app/e2e-harness/storage/inventory?*", route => sent && failRead ? route.abort("failed") : route.continue())
  await page.goto(entry); await select(page); await confirm(page)
  await expect.poll(async () => (await record(page))?.pending[0]?.status).toBe("unavailable")
  expect((await record(page)).receipts).toHaveLength(0)
  failRead = false; await page.reload()
  await expect.poll(async () => (await record(page))?.receipts.length).toBe(1)
})

test("partner stale revision rejects whole group and retains exact original request", async ({ page }) => {
  await page.route("**/app/e2e-harness/storage/inventory", async route => {
    const body = route.request().postDataJSON(), operationId = "synthetic-concurrent-layout"
    const changed = await route.fetch({ url: route.request().url().replace(/inventory$/, "slots"), headers: { ...route.request().headers(), "x-storage-operation": operationId }, postData: JSON.stringify({ operationId,
      inventoryRevision: body.inventoryRevision, collectionId: collection, collectionVersion: body.collections[0].version, layoutRevision: body.collections[0].layoutRevision,
      commands: [{ kind: "create", ids: ["synthetic-partner-slot"], beforeSlotId: null }] }) })
    expect(changed.status()).toBe(200)
    const response = await route.fetch(); expect(response.status()).toBe(409); await route.fulfill({ response })
  })
  await page.goto(entry); await select(page); await confirm(page)
  await expect.poll(async () => (await record(page))?.pending[0]?.status).toBe("conflict")
  expect((await record(page)).receipts).toHaveLength(0)
  const retained = (await record(page)).pending[0].intent
  expect(retained.kind !== "creation" && retained.request.commands).toHaveLength(1)
  expect((await record(page)).snapshot!.items).toHaveLength(4)
})

for (const change of ["signout", "account", "owner"] as const) test(`${change} retains in-flight removal, no late ACK`, async ({ page }) => {
  let release!: () => void, started!: () => void
  const barrier = new Promise<void>(yes => { release = yes }), sending = new Promise<void>(yes => { started = yes })
  await page.route("**/app/e2e-harness/storage/inventory", async route => { const response = await route.fetch(); started(); await barrier; await route.fulfill({ response }).catch(() => {}) })
  await page.goto(entry); await select(page); await confirm(page); await sending
  const original = (await record(page)).pending[0].intent
  if (change === "owner") await page.route("**/rest/v1/partnerships*", route => route.fulfill({ json: [{ id: "synthetic-membership", owner_user_id: "33333333-3333-4333-8333-333333333333", user1_id: E2E_USER.id, user2_id: "33333333-3333-4333-8333-333333333333" }] }))
  await page.evaluate(({ change, user }) => { const c = new BroadcastChannel("sb-127-auth-token")
    c.postMessage(change === "signout" ? { event: "SIGNED_OUT", session: null } : { event: change === "account" ? "SIGNED_IN" : "TOKEN_REFRESHED", session: { user: change === "account" ? { ...user, id: "55555555-5555-4555-8555-555555555555" } : user } }); c.close()
  }, { change, user: E2E_USER })
  await expect(dialog(page)).toHaveCount(0); await expect(button(page, "Edit layout")).not.toBeVisible()
  release()
  expect((await record(page)).pending[0].intent).toEqual(original)
  expect((await record(page)).receipts).toHaveLength(0)
})

test("cancel and every shared dismissal never remove, offline review cannot confirm", async ({ page, context, insets }) => {
  await page.goto(entry); await select(page)
  const h = new Harness(page, insets, true)
  for (const action of ["cancel", "close", "escape", "back", "backdrop", "swipe", "dock"]) {
    if (action !== "cancel") await button(page, "Remove selected slots").click()
    if (action === "cancel") await button(page, "Cancel removal").click()
    if (action === "close") await button(page, "Close slot removal").click()
    if (action === "escape") await page.keyboard.press("Escape")
    if (action === "back") await page.goBack()
    if (action === "backdrop") await h.tapBackdrop(dialog(page))
    if (action === "swipe") await h.swipeDown(dialog(page))
    if (action === "dock") await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Inventory", exact: true }).click()
    await expect(dialog(page)).toHaveCount(0); await h.expectScrollUnlocked()
  }
  expect((await record(page)).pending).toHaveLength(0)
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Binder", exact: true }).click()
  await select(page); await context.setOffline(true)
  await expect(button(page, "Confirm slot removal")).not.toBeEnabled()
  expect((await record(page)).pending).toHaveLength(0)
})

test("fresh changed selection evidence blocks confirmation without silently updating the review", async ({ page }) => {
  let changed = false, sends = 0
  await page.route("**/app/e2e-harness/storage/inventory?*", async route => {
    const response = await route.fetch(), body = await response.json()
    if (changed) {
      body.snapshot.inventoryRevision++; body.evidence.inventoryRevision++
      body.snapshot.binders[0].layoutRevision++; body.navigation.layouts[0].layoutRevision++; body.evidence.storage[0].layoutRevision++
    }
    await route.fulfill({ response, json: body })
  })
  await page.route("**/app/e2e-harness/storage/inventory", route => { sends++; return route.continue() })
  await page.goto(entry); await select(page)
  changed = true
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")))
  await expect(dialog(page)).toContainText("This review is blocked")
  await expect(button(page, "Confirm slot removal")).toBeDisabled()
  expect(sends).toBe(0); expect((await record(page)).pending).toHaveLength(0)
})

test("supported Activity entry point stays truthful when removal history recovery is unavailable", async ({ page }) => {
  const scope = { accountId: E2E_USER.id, ownerId: E2E_USER.id, membershipKey: JSON.stringify([null, E2E_USER.id]), memberIds: [E2E_USER.id] }
  // Deliberately unsupported synthetic event, not an operation-to-event linkage or inverse proof.
  await page.route("**/app/api/collection-activity**", async route => {
    const query = new URL(route.request().url()).searchParams
    if (query.has("scope")) return route.fulfill({ json: { scope } })
    return route.fulfill({ json: { scope, data: [{ id: "102", recorded_at: "2026-11-10T12:00:00Z", format_version: 1,
      actor_kind: "user", actor_user_id: E2E_USER.id, source: "app", action: "inventory.removeSlots",
      affected_entities: { collectionIds: [collection], slotIds: ["synthetic-slot-0"] },
      changes: [{ table: "binder_slots", id: "synthetic-slot-0", before: { target: { kind: "pokemon", pokemonId: 143 } }, after: null }] }], nextCursor: null, syncedAt: "2026-11-10T12:01:00Z" } })
  })
  await page.goto(entry); await select(page); await confirm(page)
  await expect.poll(async () => (await record(page))?.receipts.length).toBe(1)
  await button(page, "Activity").click()
  const activity = page.getByRole("dialog", { name: "Collection Activity", exact: true })
  await activity.getByRole("button", { name: "Review recovery", exact: true }).click()
  await expect(activity).toContainText("private_assets_unverifiable")
  await expect(activity.getByRole("button", { name: "Confirm recovery", exact: true })).toHaveCount(0)
  expect((await record(page)).recovery ?? []).toHaveLength(0)
})

test("unsupported occupied group rejects whole before handoff, no truncation or automatic selection", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "hf-storage-fixture", value: `remove-bound-${crypto.randomUUID()}`, url: baseURL! }])
  let sends = 0
  await page.route("**/app/e2e-harness/storage/inventory", route => { sends++; return route.continue() })
  await page.goto(entry)
  await button(page, "Edit layout").click(); await button(page, "Select several pockets").click()
  const bulk = page.getByRole("region", { name: "Bulk layout actions", exact: true })
  await expect(bulk).toContainText("0 selected")
  await button(page, "Select page").click(); await button(page, "Next selection page").click()
  await button(page, "Select page").click(); await button(page, "Next selection page").click()
  await button(page, "Select page").click()
  await expect(bulk).toContainText("129 selected")
  await button(page, "Remove selected slots").click()
  await expect(dialog(page)).toContainText("entire selection is unsupported")
  await expect(button(page, "Confirm slot removal")).toHaveCount(0)
  expect(sends).toBe(0); expect((await record(page)).pending).toHaveLength(0)
})
