import { test as base, expect, type Page, type Route } from "@playwright/test"
import { mockBackends, emulateStandalone, SAFE_AREA, E2E_USER, Harness } from "./fixtures"
import { inventoryBrowseFixture, inventoryBrowseCatalog, inventoryBrowseLayouts } from "../tests/fixtures/inventory-browse"

const alpha = "22222222-2222-4222-8222-222222222222"
const trades = "33333333-3333-4333-8333-333333333333"
const id = (value: string) => value === "alpha" ? alpha : trades
const layouts = inventoryBrowseLayouts.map(l => ({ ...l, collectionId: id(l.collectionId) }))
const entry = `/app/e2e-harness?signedIn=1&browserHost=1&binder=${alpha}`
// Synthetic remote/auth evidence only. Client shell, SW, page teardown and IDB are real.
async function inventory(route: Route) {
  const snapshot = inventoryBrowseFixture(5), url = new URL(route.request().url())
  snapshot.ownerUserId = E2E_USER.id
  snapshot.items.forEach(i => { i.ownerUserId = E2E_USER.id })
  snapshot.collections.forEach(c => { c.ownerUserId = E2E_USER.id; c.id = id(c.id) })
  snapshot.binders.forEach(b => { b.ownerUserId = E2E_USER.id; b.collectionId = id(b.collectionId); b.slots.forEach(s => { s.ownerUserId = E2E_USER.id; s.collectionId = b.collectionId }) })
  snapshot.placements.forEach(p => { p.collectionId = id(p.collectionId) })
  await route.fulfill({ headers: { "Cache-Control": "private, no-store" }, json: { version: 2, requestId: url.searchParams.get("requestId"),
    scope: { actorUserId: E2E_USER.id, ownerUserId: E2E_USER.id, authSessionId: "synthetic-e2e-auth-session", sessionId: url.searchParams.get("sessionId") },
    snapshot, navigation: { catalog: inventoryBrowseCatalog, layouts }, evidence: { inventoryRevision: 1, items: snapshot.items.length,
      placements: snapshot.placements.length, collections: snapshot.collections.length, binders: snapshot.binders.length,
      slots: snapshot.binders.reduce((n, b) => n + b.slots.length, 0), storage: snapshot.binders.map(b => ({ collectionId: b.collectionId, collectionVersion: 1, layoutRevision: 1, slotCount: b.slots.length })) } } })
}
const test = base.extend({ serviceWorkers: "allow" })
test.beforeEach(async ({ page, context, baseURL }, info) => {
  if (info.project.metadata?.standalone) await emulateStandalone(page, SAFE_AREA)
  await mockBackends(context, context, { signedIn: true, baseURL })
  await context.route("**/app/api/inventory?*", inventory)
})
async function prepare(page: Page) {
  await page.goto(entry)
  await expect(page.getByRole("combobox", { name: "Collection", exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(async () => Boolean(navigator.serviceWorker.controller) && Boolean(await caches.match("/app/app-shell"))
    && Boolean(JSON.parse(localStorage.getItem("binderdex_start_v1") ?? "null")?.native)), { timeout: 60000 }).toBe(true)
}
async function queueRecords(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((yes, no) => { const r = indexedDB.open("binderdex-offline"); r.onsuccess = () => yes(r.result); r.onerror = () => no(r.error) })
    return new Promise<unknown[]>((yes, no) => { const r = db.transaction("records").objectStore("records").getAll(); r.onsuccess = () => { db.close(); yes(r.result.filter(v => v?.version === 1 && Array.isArray(v.pending))) }; r.onerror = () => no(r.error) })
  })
}
const offlineAbort = (route: Route) => route.abort("internetdisconnected")
async function relaunch(page: Page, standalone: boolean, path = "/app") {
  const context = page.context()
  // No mounted React view, document state or page HTTP cache survives this boundary.
  await page.close()
  await context.setOffline(true)
  await context.route("**/rest/v1/**", offlineAbort)
  await context.route("**/auth/v1/**", offlineAbort)
  const reopened = await context.newPage()
  if (standalone) await emulateStandalone(reopened, SAFE_AREA)
  const cdp = await context.newCDPSession(reopened)
  await cdp.send("Network.enable")
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true })
  await cdp.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  if (standalone) await cdp.send("Emulation.setSafeAreaInsetsOverride" as never, { insets: SAFE_AREA } as never)
  await reopened.goto(path)
  return reopened
}

test("previously cached native pending layout survives genuine page close and offline shell relaunch", async ({ page }, info) => {
  await prepare(page)
  await page.getByRole("button", { name: "Edit layout", exact: true }).click()
  await page.locator('[data-slot-id="alpha-empty-0"]').click()
  await page.getByRole("button", { name: "Insert free slot before", exact: true }).click()
  await expect(page.getByText(/Pending sync/).first()).toBeVisible()
  const before = await queueRecords(page)
  const reopened = await relaunch(page, Boolean(info.project.metadata?.standalone), `/app?binder=${alpha}`)
  await expect(reopened.getByText(/Cached only. Access will be checked/)).toBeVisible({ timeout: 30000 })
  await expect(reopened.getByText(/1 pending edit retained/)).toBeVisible()
  await expect(reopened.getByRole("button", { name: "Edit layout", exact: true })).not.toBeVisible()
  await expect(reopened.getByRole("button", { name: "Done", exact: true })).not.toBeVisible()
  await expect(reopened.getByRole("combobox", { name: "Collection", exact: true })).toHaveValue(alpha)
  expect(await queueRecords(reopened)).toEqual(before)
  const standalone = Boolean(info.project.metadata?.standalone), h = new Harness(reopened, standalone ? SAFE_AREA : { top: 0, bottom: 0, left: 0, right: 0 }, true)
  await h.expectNoHorizontalOverflow()
  const dock = reopened.getByRole("navigation", { name: "Main navigation", exact: true })
  for (const name of ["Binder", "Inventory"]) {
    const button = dock.getByRole("button", { name, exact: true })
    await h.expectMinTapTarget(button); await h.expectWithinSafeViewport(button); await h.expectHittable(button)
  }
  await dock.getByRole("button", { name: "Inventory", exact: true }).click()
  await expect(reopened.getByRole("searchbox", { name: "Search inventory" })).toBeVisible()
  await expect(reopened.getByRole("status").filter({ hasText: /^Cached only/ })).toBeVisible()
})

test("offline cached inventory closes before reconnect can reuse stale owner scope", async ({ page, context }, info) => {
  await prepare(page)
  const before = await queueRecords(page)
  const reopened = await relaunch(page, Boolean(info.project.metadata?.standalone))
  await expect(reopened.getByText(/Cached only. Access will be checked/)).toBeVisible({ timeout: 30000 })
  let membershipChecks = 0, staleResponses = 0
  await context.route("**/rest/v1/partnerships*", route => { membershipChecks++; return route.fulfill({ json: [{ id: "synthetic-relinked", owner_user_id: trades, user1_id: E2E_USER.id, user2_id: trades }] }) })
  // Even a well-formed old-owner response matching the new request ID must be rejected.
  await context.route("**/app/api/inventory?*", route => { staleResponses++; return inventory(route) })
  await context.unroute("**/rest/v1/**", offlineAbort)
  await context.unroute("**/auth/v1/**", offlineAbort)
  await context.setOffline(false)
  const cdp = await context.newCDPSession(reopened)
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  await reopened.evaluate(() => window.dispatchEvent(new Event("online")))
  await expect(reopened.getByText(/Cached only. Access will be checked/)).not.toBeVisible()
  await expect(reopened.getByRole("list", { name: "Owned copies" })).not.toBeVisible()
  await expect(reopened.getByRole("status").filter({ hasText: /Saved storage is paused/ })).toBeVisible()
  await expect.poll(() => membershipChecks).toBeGreaterThan(0)
  await expect.poll(() => staleResponses).toBeGreaterThan(0)
  await expect(reopened.getByText("Inventory unavailable", { exact: true })).toBeVisible()
  expect(await queueRecords(reopened)).toEqual(before)
})

test("cold native startup with shell but no canonical snapshot gives a clear fallback", async ({ page }, info) => {
  await page.context().route("**/app/api/inventory?*", route => route.fulfill({ status: 503, json: { error: "synthetic-unavailable" } }))
  await prepare(page)
  const reopened = await relaunch(page, Boolean(info.project.metadata?.standalone))
  await expect(reopened.getByRole("status").filter({ hasText: /Saved native storage is unavailable/ })).toBeVisible({ timeout: 30000 })
  await expect(reopened.getByRole("searchbox", { name: "Search inventory" })).not.toBeVisible()
  expect(await queueRecords(reopened)).toEqual([])
})

test("missing grid metadata retains canonical pending bytes and refuses cached native rendering", async ({ page }, info) => {
  await prepare(page)
  await page.getByRole("button", { name: "Edit layout", exact: true }).click()
  await page.locator('[data-slot-id="alpha-empty-0"]').click()
  await page.getByRole("button", { name: "Insert free slot before", exact: true }).click()
  await expect(page.getByText(/Pending sync/).first()).toBeVisible()
  const before = await queueRecords(page)
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(yes => { const r = indexedDB.open("binderdex-offline"); r.onsuccess = () => yes(r.result) })
    await new Promise<void>(yes => { const tx = db.transaction("records", "readwrite"), store = tx.objectStore("records"), keys = store.getAllKeys(); keys.onsuccess = () => { for (const key of keys.result) if (String(key).startsWith("slot-navigation-v1:")) store.delete(key) }; tx.oncomplete = () => { db.close(); yes() } })
  })
  const reopened = await relaunch(page, Boolean(info.project.metadata?.standalone))
  await expect(reopened.getByRole("status").filter({ hasText: /Saved native storage is unavailable/ })).toBeVisible({ timeout: 30000 })
  expect(await queueRecords(reopened)).toEqual(before)
  await expect(reopened.getByRole("searchbox", { name: "Search inventory" })).not.toBeVisible()
})

test("expired cached JWT refuses native relaunch without deleting saved intent", async ({ page, context }, info) => {
  await prepare(page)
  const before = await queueRecords(page)
  const cookie = (await context.cookies()).find(c => c.name === "sb-127-auth-token")!
  const session = JSON.parse(Buffer.from(cookie.value.replace(/^base64-/, ""), "base64url").toString())
  const claims = JSON.parse(Buffer.from(session.access_token.split(".")[1], "base64url").toString())
  claims.exp = Math.floor(Date.now() / 1000) - 1
  session.access_token = `e30.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.synthetic-expired`
  await context.addCookies([{ ...cookie, value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}` }])
  const reopened = await relaunch(page, Boolean(info.project.metadata?.standalone))
  await expect(reopened.getByRole("status").filter({ hasText: /Saved native storage is unavailable/ })).toBeVisible({ timeout: 30000 })
  await expect(reopened.getByRole("list", { name: "Owned copies" })).not.toBeVisible()
  expect(await queueRecords(reopened)).toEqual(before)
})

test("cached auth account change closes the old private surface immediately", async ({ page }, info) => {
  await prepare(page)
  const before = await queueRecords(page)
  const reopened = await relaunch(page, Boolean(info.project.metadata?.standalone))
  await expect(reopened.getByText(/Cached only. Access will be checked/)).toBeVisible({ timeout: 30000 })
  await reopened.evaluate(user => {
    const channel = new BroadcastChannel("sb-127-auth-token")
    channel.postMessage({ event: "SIGNED_IN", session: { user: { ...user, id: "55555555-5555-4555-8555-555555555555" } } })
    channel.close()
  }, E2E_USER)
  await expect(reopened.getByText(/Cached only. Access will be checked/)).not.toBeVisible()
  await expect(reopened.getByRole("status").filter({ hasText: /Saved storage is paused/ })).toBeVisible()
  expect(await queueRecords(reopened)).toEqual(before)
})

test("evicted boot chunk gives a static reconnect notice and leaves canonical queue intact", async ({ page }, info) => {
  await prepare(page)
  const before = await queueRecords(page)
  await page.evaluate(async () => {
    const cache = await caches.open("binderdex-v6-shell"), shell = await cache.match("/app/app-shell")
    const path = (await shell!.text()).match(/<script[^>]+src="([^"]+)"/)![1].replaceAll("&amp;", "&")
    await cache.delete(path)
  })
  const reopened = await relaunch(page, Boolean(info.project.metadata?.standalone))
  await expect(reopened.getByRole("heading", { name: "Reconnect to open Holo Folder" })).toBeVisible()
  await expect(reopened.getByRole("status")).toContainText("Pending edits have not been removed")
  expect(await queueRecords(reopened)).toEqual(before)
})

test("first ever uncached offline launch cannot manufacture an executable shell", async ({ page, context }) => {
  await context.setOffline(true)
  await expect(page.goto("/app")).rejects.toThrow(/ERR_INTERNET_DISCONNECTED|ERR_FAILED/)
})
