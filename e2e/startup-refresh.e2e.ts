import type { Page, Route } from "@playwright/test"
import type { InventorySnapshot } from "../lib/domain/inventory"
import { test, expect, mockBackends, emulateStandalone, E2E_USER } from "./fixtures"

// Synthetic full National Dex binder: 1025 slots on a 4x4 layout, 900 owned. Never real owner data.
const binderId = "55555555-5555-4555-8555-555555555555"
const SLOTS = 1025
const slotId = (n: number) => `66666666-6666-4666-8666-${String(n).padStart(12, "0")}`
function fullDexSnapshot(owned = 900): InventorySnapshot {
  const ownerUserId = E2E_USER.id
  const items = Array.from({ length: owned }, (_, i) => ({ id: `copy-${String(i + 1).padStart(5, "0")}`, ownerUserId,
    identity: { kind: "pokemon" as const, pokemonId: i + 1 }, grading: null, acquiredAt: null, version: 1 }))
  return { ownerUserId, inventoryRevision: 1, items,
    placements: items.map((item, i) => ({ inventoryItemId: item.id, collectionId: binderId, slotId: slotId(i), version: 1 })),
    collections: [{ id: binderId, ownerUserId, name: "National dex", kind: "binder", defaultPresentation: "binder", version: 1 }],
    binders: [{ ownerUserId, collectionId: binderId, layoutRevision: 1, presetManifest: null,
      slots: Array.from({ length: SLOTS }, (_, n) => ({ id: slotId(n), ownerUserId, collectionId: binderId,
        target: { kind: "pokemon" as const, pokemonId: n + 1 }, inventoryItemId: items[n]?.id ?? null, wantedCards: [],
        status: n < owned ? "collected" as const : null, version: 1, presetOrigin: null })) }] }
}
async function fulfill(route: Route, snapshot = fullDexSnapshot()) {
  const url = new URL(route.request().url())
  await route.fulfill({ headers: { "Cache-Control": "private, no-store" }, json: { version: 2,
    requestId: url.searchParams.get("requestId"), scope: { actorUserId: E2E_USER.id, ownerUserId: E2E_USER.id,
      authSessionId: "synthetic-e2e-auth-session", sessionId: url.searchParams.get("sessionId") }, snapshot,
    navigation: { catalog: [], layouts: [{ collectionId: binderId, layoutRevision: 1, rows: 4, cols: 4 }] },
    evidence: { inventoryRevision: snapshot.inventoryRevision, items: snapshot.items.length, placements: snapshot.placements.length,
      collections: snapshot.collections.length, binders: snapshot.binders.length, slots: SLOTS,
      storage: [{ collectionId: binderId, collectionVersion: 1, layoutRevision: 1, slotCount: SLOTS }] } } })
}
/** Delays every inventory read by `delay` ms (the transport itself is out of scope here). */
async function routeInventory(page: Page, delay = 0, snapshot?: InventorySnapshot) {
  await page.unroute("**/app/e2e-harness/storage/inventory?*")
  let reads = 0
  await page.route("**/app/e2e-harness/storage/inventory?*", async route => { reads++; if (delay) await new Promise(r => setTimeout(r, delay)); await fulfill(route, snapshot).catch(() => {}) })
  return () => reads
}
// Records, from navigation start, when the skeleton and the binder's slots are on screen.
async function recordTransitions(page: Page) {
  await page.addInitScript(() => {
    const log: { t: number; state: string }[] = []
    let last = ""
    const sample = () => {
      const state = document.querySelector('[data-slot-id][aria-label$=", Owned"]') ? "cards" : document.querySelector("[data-slot-id]") ? "binder" : document.querySelector('[data-testid="binder-skeleton"]') ? "skeleton"
        : `other:${document.querySelector("main [role=status], main [role=alert]")?.textContent?.slice(0, 30) ?? ""}`
      if (state !== last) { last = state; log.push({ t: Math.round(performance.now()), state }) }
    }
    ;(window as unknown as { __startup: typeof log }).__startup = log
    new MutationObserver(sample).observe(document, { subtree: true, childList: true })
  })
}
const transitions = (page: Page) => page.evaluate(() => (window as unknown as { __startup: { t: number; state: string }[] }).__startup)
const entry = `/app/e2e-harness?signedIn=1&browserHost=1&binder=${binderId}`
const slot = (page: Page, n: number) => page.locator(`[data-slot-id="${slotId(n)}"]`)

test.beforeEach(async ({ page, context, standalone, insets, baseURL }) => {
  if (standalone) await emulateStandalone(page, insets)
  await mockBackends(page, context, { signedIn: true, baseURL })
  await recordTransitions(page)
})

for (const viewport of [null, { width: 1300, height: 900 }]) test.describe(viewport ? "desktop" : "phone", () => {
  if (viewport) test.use({ viewport, isMobile: false, hasTouch: false })

  test("hard reload paints the saved binder at once and keeps it while the read is slow", async ({ page }, info) => {
    await routeInventory(page)
    await page.goto(entry)
    await expect(slot(page, 0)).toBeVisible({ timeout: 30_000 })
    // Let the first complete read land in IndexedDB.
    await expect.poll(() => page.evaluate(() => localStorage.getItem("binderdex_start_v1") ?? ""), { timeout: 10_000 }).not.toBe("")
    const reads = await routeInventory(page, 8_000)
    await page.reload()
    await page.waitForTimeout(9_500)
    expect(reads()).toBe(1)
    const log = await transitions(page)
    info.annotations.push({ type: "cached reload transitions", description: JSON.stringify(log) })
    console.log(`${info.title} ${viewport ? "desktop" : "phone"}: ${JSON.stringify(log)}`)
    // Saved cards paint well before the 8 s read, straight from the skeleton, and never go back to a skeleton or blank.
    const first = log.findIndex(s => s.state === "cards")
    expect(first).toBeGreaterThanOrEqual(0)
    expect(log[first].t).toBeLessThan(5_000)
    expect(log.slice(first).map(s => s.state)).toEqual(["cards"])
    expect(log.slice(0, first).map(s => s.state).filter(s => s !== "other:")).toEqual(["skeleton"])
  })

  test("cached online startup paints the binder with no cache or access-check banner", async ({ page }) => {
    await routeInventory(page)
    await page.goto(entry)
    await expect(slot(page, 0)).toBeVisible({ timeout: 30_000 })
    await expect.poll(() => page.evaluate(() => localStorage.getItem("binderdex_start_v1") ?? ""), { timeout: 10_000 }).not.toBe("")
    // Hold the checked membership and inventory reads so only the saved copy can paint.
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    await page.route("**/rest/v1/partnerships*", async route => { await held; await route.fallback().catch(() => {}) })
    await routeInventory(page, 8_000)
    await page.reload()
    await expect(page.locator('[data-slot-id][aria-label$=", Owned"]').first()).toBeVisible({ timeout: 5_000 })
    await expect(page.getByText(/Cached only|Access is being checked|Access will be checked|Saved on this device/)).toHaveCount(0)
    await expect(page.getByTestId("connection-chip")).toHaveCount(0)
    release()
  })

  test("refocus while starting never shows an account-check page or bounces the binder", async ({ page }) => {
    await routeInventory(page)
    await page.goto(entry)
    await expect(slot(page, 0)).toBeVisible({ timeout: 30_000 })
    await expect.poll(() => page.evaluate(() => localStorage.getItem("binderdex_start_v1") ?? ""), { timeout: 10_000 }).not.toBe("")
    await routeInventory(page, 3_000)
    await page.reload({ waitUntil: "commit" })
    for (let i = 0; i < 10; i++) {
      await page.evaluate(() => { window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")) }).catch(() => {})
      await page.waitForTimeout(100)
    }
    await page.waitForTimeout(3_500)
    const log = await transitions(page)
    expect(log.filter(s => s.state.startsWith("other:") && s.state !== "other:")).toEqual([])
    const first = log.findIndex(s => s.state === "cards")
    expect(first).toBeGreaterThanOrEqual(0)
    expect(log.slice(first).map(s => s.state)).toEqual(["cards"])
    await expect(slot(page, 0)).toBeVisible()
  })

  test("cold start without a saved copy shows one skeleton, then the binder", async ({ page }, info) => {
    await routeInventory(page, 2_000)
    await page.goto(entry)
    await expect(slot(page, 0)).toBeVisible({ timeout: 30_000 })
    const log = await transitions(page)
    console.log(`${info.title} ${viewport ? "desktop" : "phone"}: ${JSON.stringify(log)}`)
    // One loading state, then the cards: no flashes of the binder or skeleton in between.
    expect(log.filter(s => s.state === "cards")).toHaveLength(1)
    expect(log.at(-1)?.state).toBe("cards")
    expect(log.filter(s => s.state === "skeleton").length).toBeLessThanOrEqual(1)
    expect(log.filter(s => s.state.startsWith("other:") && s.state !== "other:")).toEqual([])
  })

  test("an empty binder starts cleanly and reloads from its saved copy", async ({ page }, info) => {
    const empty = fullDexSnapshot(0)
    await routeInventory(page, 0, empty)
    await page.goto(entry)
    await expect(slot(page, 0)).toBeVisible({ timeout: 30_000 })
    await expect.poll(() => page.evaluate(() => localStorage.getItem("binderdex_start_v1") ?? ""), { timeout: 10_000 }).not.toBe("")
    await routeInventory(page, 8_000, empty)
    await page.reload()
    await expect(slot(page, 0)).toBeVisible({ timeout: 5_000 })
    const log = await transitions(page)
    console.log(`${info.title} ${viewport ? "desktop" : "phone"}: ${JSON.stringify(log)}`)
    expect(log.filter(s => s.state === "binder")).toHaveLength(1)
  })

  test("refocus refreshes in the background without remounting the binder", async ({ page }) => {
    await routeInventory(page)
    await page.goto(entry)
    await expect(slot(page, 0)).toBeVisible({ timeout: 30_000 })
    await page.waitForTimeout(500)
    const reads = await routeInventory(page, 3_000)
    const marker = await slot(page, 0).evaluate(el => { (el as HTMLElement & { __kept?: boolean }).__kept = true; return true })
    expect(marker).toBe(true)
    await page.evaluate(() => { window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")) })
    await page.waitForTimeout(3_800)
    expect(reads()).toBeGreaterThanOrEqual(1)
    await expect(page.getByTestId("binder-skeleton")).toHaveCount(0)
    // The same DOM node survived the refresh: no remount, no skeleton, no blank.
    expect(await slot(page, 0).evaluate(el => Boolean((el as HTMLElement & { __kept?: boolean }).__kept))).toBe(true)
  })
})
