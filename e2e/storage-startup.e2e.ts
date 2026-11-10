import { test, expect, mockBackends, emulateStandalone, Harness, E2E_USER } from "./fixtures"
import type { Page, Route } from "@playwright/test"
import type { InventorySnapshot } from "../lib/domain/inventory"

const collection = "22222222-2222-4222-8222-222222222222"
const entry = `/app/e2e-harness?signedIn=1&browserHost=1&binder=${collection}&view=inventory`

// Synthetic identities and private HTTP evidence at the reported owner's size, real app/session/IDB/worker.
function snapshot(): InventorySnapshot {
  const ownerUserId = E2E_USER.id
  const collections: InventorySnapshot["collections"] = Array.from({ length: 3 }, (_, n) => ({
    id: n ? `synthetic-collection-${n}` : collection, ownerUserId, name: `Synthetic storage ${n}`,
    kind: "binder", defaultPresentation: "binder", version: 1,
  }))
  const items: InventorySnapshot["items"] = Array.from({ length: 655 }, (_, n) => ({
    id: `synthetic-copy-${n}`, ownerUserId, identity: { kind: "pokemon", pokemonId: n % 1025 + 1 },
    grading: null, acquiredAt: null, version: 1, legacySource: { original: ["00007", null, { preserved: true }] },
  }))
  const placements = items.map((item, n) => ({ inventoryItemId: item.id, collectionId: collections[n % 3].id,
    slotId: `synthetic-slot-${n % 3}-${Math.floor(n / 3)}`, version: 1 }))
  return { ownerUserId, inventoryRevision: 1, items, placements, collections, binders: collections.map((c, b) => ({
    ownerUserId, collectionId: c.id, layoutRevision: 1, presetManifest: null,
    slots: Array.from({ length: 1025 }, (_, n) => ({ id: `synthetic-slot-${b}-${n}`, ownerUserId, collectionId: c.id,
      inventoryItemId: items[n * 3 + b]?.id ?? null, target: { kind: "pokemon", pokemonId: n + 1 },
      status: items[n * 3 + b] ? "collected" : null, wantedCards: [], version: 1, presetOrigin: null })),
  })) }
}
async function inventory(route: Route) {
  const s = snapshot(), url = new URL(route.request().url())
  await route.fulfill({ headers: { "Cache-Control": "private, no-store" }, json: {
    version: 2, requestId: url.searchParams.get("requestId"), scope: { actorUserId: E2E_USER.id, ownerUserId: E2E_USER.id,
      authSessionId: "synthetic-e2e-auth-session", sessionId: url.searchParams.get("sessionId") }, snapshot: s,
    navigation: { catalog: [], layouts: s.binders.map(b => ({ collectionId: b.collectionId, layoutRevision: 1, rows: 3, cols: 3 })) },
    evidence: { inventoryRevision: 1, items: 655, placements: 655, collections: 3, binders: 3, slots: 3075,
      storage: s.binders.map(b => ({ collectionId: b.collectionId, collectionVersion: 1, layoutRevision: 1, slotCount: 1025 })) },
  } })
}
async function records(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((yes, no) => { const r = indexedDB.open("binderdex-offline"); r.onsuccess = () => yes(r.result); r.onerror = () => no(r.error) })
    const rows = await new Promise<unknown[]>((yes, no) => { const r = db.transaction("records").objectStore("records").getAll(); r.onsuccess = () => yes(r.result); r.onerror = () => no(r.error) })
    db.close(); return rows
  })
}
test.use({ serviceWorkers: "allow" })
test.beforeEach(async ({ page, context, standalone, insets, baseURL }) => {
  if (standalone) await emulateStandalone(page, insets)
  await mockBackends(context, context, { signedIn: true, baseURL })
  await context.route("**/app/e2e-harness/storage/inventory?*", route => inventory(route))
})

async function ready(page: Page) {
  await expect(page.getByRole("button", { name: "Refresh storage", exact: true })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole("button", { name: "New storage", exact: true })).toBeEnabled()
}

test("fresh storage opens representative owner through actual worker and saves all copies and slots", async ({ page, insets }) => {
  await page.goto(entry)
  await ready(page)
  await page.evaluate(async () => { await navigator.serviceWorker.register("/app/sw.js", { scope: "/app/" }); await navigator.serviceWorker.ready })
  await expect.poll(() => page.evaluate(async () => !!navigator.serviceWorker.controller && !!await caches.match("/app/app-shell"))).toBe(true)
  await page.reload(); await ready(page)
  const rows = await records(page)
  const record = rows.find((r): r is { snapshot: InventorySnapshot } => !!r && typeof r === "object" && "snapshot" in r)
  expect(record?.snapshot).toEqual(snapshot())
  await new Harness(page, insets, true).expectNoHorizontalOverflow()
  expect(await page.evaluate(async () => {
    const keys = await (await caches.open("binderdex-v6-shell")).keys()
    return keys.some(k => /\/e2e-harness|\/api\/inventory/.test(k.url))
  })).toBe(false)
})

async function seedResetSentinels(page: Page) {
  await page.evaluate(async () => {
    localStorage.setItem("pokemon_collection_snapshot_v1", "synthetic cached snapshot")
    localStorage.setItem("sb-synthetic-auth-token", "synthetic credentials")
    await (await caches.open("binderdex-v6-shell")).put("/app/synthetic-reset-sentinel", new Response("synthetic offline executable"))
    await (await caches.open("unrelated-app-cache")).put("/unrelated-sentinel", new Response("unrelated"))
    const db = await new Promise<IDBDatabase>((yes, no) => { const r = indexedDB.open("binderdex-offline"); r.onsuccess = () => yes(r.result); r.onerror = () => no(r.error) })
    await new Promise<void>((yes, no) => { const tx = db.transaction("records", "readwrite"); tx.objectStore("records").put("synthetic offline data", "synthetic-reset-sentinel"); tx.oncomplete = () => yes(); tx.onerror = () => no(tx.error) })
    db.close()
  })
}
async function expectReset(page: Page) {
  expect(await page.evaluate(async () => ({
    guard: sessionStorage.getItem("holofolder-startup-reset-v1"), auth: localStorage.getItem("sb-synthetic-auth-token"),
    snapshot: localStorage.getItem("pokemon_collection_snapshot_v1"),
    executable: !!await caches.match("/app/synthetic-reset-sentinel"), unrelated: !!await caches.match("/unrelated-sentinel"),
  }))).toEqual({ guard: "1", auth: "synthetic credentials", snapshot: null, executable: false, unrelated: true })
  expect(await records(page)).not.toContain("synthetic offline data")
}

test("online startup failure resets only offline data, reloads once, then shows the actual error and manual retry", async ({ page, context, insets }) => {
  await page.goto(entry); await ready(page)
  await seedResetSentinels(page)
  const device = await page.evaluate(() => localStorage.getItem("holofolder-slot-device-v1"))
  await context.route("**/app/e2e-harness/storage/inventory?*", route => route.fulfill({ status: 503, json: { code: "inventory_not_initialized" } }))
  let navigations = 0
  page.on("request", request => { if (request.isNavigationRequest() && request.resourceType() === "document") navigations++ })
  await page.reload()
  await expect(page.getByRole("alert").filter({ hasText: "Could not open storage:" })).toHaveText("Could not open storage: inventory_not_initialized", { timeout: 20_000 })
  expect(navigations).toBe(2)
  await expectReset(page)
  expect(await page.evaluate(() => localStorage.getItem("holofolder-slot-device-v1"))).toBe(device)
  const retry = page.getByRole("button", { name: "Retry opening storage", exact: true })
  const h = new Harness(page, insets, true)
  await h.expectMinTapTarget(retry); await h.expectWithinSafeViewport(retry); await h.expectHittable(retry); await h.expectNoHorizontalOverflow()
  await context.route("**/app/e2e-harness/storage/inventory?*", route => inventory(route))
  await retry.click(); await ready(page)
  expect(navigations).toBe(3)
})

for (const stage of ["queue", "metadata", "save"] as const) test(`online stalled ${stage} transaction gets one bounded reset and fresh startup`, async ({ page }) => {
  await page.goto(entry); await ready(page)
  await seedResetSentinels(page)
  await page.addInitScript(stage => {
    if (sessionStorage.getItem("holofolder-startup-reset-v1")) return
    const original = IDBObjectStore.prototype.get
    IDBObjectStore.prototype.get = function(key) {
      const request = original.call(this, key)
      const match = typeof key === "string" && (stage === "metadata" ? key.startsWith("slot-navigation-v1:")
        : key.startsWith("slot-intent:") && this.transaction.mode === (stage === "save" ? "readwrite" : "readonly"))
      if (match) {
        document.documentElement.dataset.syntheticStorageHeld = stage
        const keepAlive = () => { original.call(this, "synthetic-keepalive").onsuccess = keepAlive }
        keepAlive()
      }
      return request
    }
  }, stage)
  await page.reload()
  await expect(page.locator("html")).toHaveAttribute("data-synthetic-storage-held", stage)
  await ready(page)
  await expectReset(page)
  const rows = await records(page)
  expect(rows.find((r): r is { snapshot: InventorySnapshot } => !!r && typeof r === "object" && "snapshot" in r)?.snapshot).toEqual(snapshot())
})

test("online complete-read timeout resets once, then stops with an error instead of looping", async ({ page, context }) => {
  await context.route("**/app/e2e-harness/storage/inventory?*", async () => { /* Synthetic dead network, cancelled when the document reloads. */ })
  await page.goto(entry)
  await expect(page.getByRole("alert").filter({ hasText: "Could not open storage:" })).toContainText("Account and storage startup timed out after 10 seconds", { timeout: 30_000 })
  await expect(page.getByRole("button", { name: "Retry opening storage", exact: true })).toBeVisible()
  expect(await page.evaluate(() => sessionStorage.getItem("holofolder-startup-reset-v1"))).toBe("1")
})

test("known-offline opening retains the representative cached view without an automatic reset", async ({ page, context }) => {
  await page.goto(entry); await ready(page)
  await page.evaluate(async () => { await navigator.serviceWorker.register("/app/sw.js", { scope: "/app/" }); await navigator.serviceWorker.ready })
  await expect.poll(() => page.evaluate(async () => !!navigator.serviceWorker.controller && !!await caches.match("/app/app-shell"))).toBe(true)
  const before = await records(page)
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole("status").filter({ hasText: "Cached only. Showing saved copies" }).first()).toBeVisible({ timeout: 15_000 })
  expect(await records(page)).toEqual(before)
  expect(await page.evaluate(() => sessionStorage.getItem("holofolder-startup-reset-v1"))).toBeNull()
})


test("cached view cannot hide a stalled checked account handoff indefinitely", async ({ page, context }) => {
  await page.goto(entry); await ready(page)
  await context.route("**/rest/v1/partnerships*", async () => { /* Synthetic stalled membership check. */ })
  await page.reload()
  await expect(page.getByText(/Saved on this device · Cached only/).first()).toBeVisible()
  await expect(page.getByRole("alert").filter({ hasText: "Could not open storage:" })).toContainText("Account and storage startup timed out after 10 seconds", { timeout: 30_000 })
  await expect(page.getByRole("button", { name: "Retry opening storage", exact: true })).toBeVisible()
  expect(await page.evaluate(() => sessionStorage.getItem("holofolder-startup-reset-v1"))).toBe("1")
})
