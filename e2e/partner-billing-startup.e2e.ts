import { test, expect, mockBackends, emulateStandalone, Harness, E2E_USER } from "./fixtures"
import type { Page } from "@playwright/test"
import type { SlotOfflineRecord } from "../lib/collection/slot-offline-queue"

// Synthetic partnership, billing and storage answers. Actual app host, trusted HTTP read, IDB queue.
const owner = "11111111-1111-4111-8111-111111111111"
const entry = "/app/e2e-harness?signedIn=1&browserHost=1&view=inventory"
const membership = [{ id: "synthetic-grading-partnership", owner_user_id: owner, user1_id: owner, user2_id: E2E_USER.id }]
async function records(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((yes, no) => { const r = indexedDB.open("binderdex-offline"); r.onsuccess = () => yes(r.result); r.onerror = () => no(r.error) })
    const rows = await new Promise<unknown[]>((yes, no) => { const r = db.transaction("records").objectStore("records").getAll(); r.onsuccess = () => yes(r.result); r.onerror = () => no(r.error) })
    db.close()
    return rows.filter(v => !!v && typeof v === "object" && "pending" in v)
  }) as Promise<SlotOfflineRecord[]>
}
const shared = async (page: Page) => (await records(page)).find(r => r.scope.ownerUserId === owner)
const paused = (page: Page) => page.getByRole("status").filter({ hasText: "Shared collection paused" })

test.beforeEach(async ({ page, context, standalone, insets, baseURL }) => {
  if (standalone) await emulateStandalone(page, insets)
  await mockBackends(page, context, { signedIn: true, baseURL })
})

test("lapsed owner plan opens the partner's own storage, keeps shared intent on device, and recovers", async ({ page, context, baseURL, insets }) => {
  const paidId = `grading-partner-${crypto.randomUUID()}`
  await context.addCookies([{ name: "hf-storage-fixture", value: paidId, url: baseURL! }])
  let partnerships: "ok" | "fail" = "ok", allowed = true
  await page.route("**/rest/v1/partnerships*", route => partnerships === "ok" ? route.fulfill({ json: membership })
    : route.fulfill({ status: 503, json: { code: "57014", message: "synthetic membership timeout" } }))
  await page.route("**/rest/v1/rpc/billing_partner_allowed", route => route.fulfill({ json: allowed }))
  // Shared-owner uploads stay unknown, so the edit is retained exactly as queued.
  const uploads: string[] = []
  await page.route("**/app/e2e-harness/storage/inventory", route => { uploads.push(route.request().headers()["x-binder-owner"] ?? ""); return route.fulfill({ status: 503, json: { error: { code: "storage_unavailable", message: "synthetic", requestId: crypto.randomUUID() } } }) })

  // Paid partner: the shared owner's copy, one edit retained on device.
  await page.goto(entry)
  await page.locator('[data-item-id="synthetic-grading-1"]').click()
  await page.getByRole("dialog", { name: "Owned copy details" }).getByRole("button", { name: "Edit grading", exact: true }).click()
  const grading = page.getByRole("dialog", { name: "Edit copy grading" })
  await grading.getByLabel("Recorded grade", { exact: true }).fill("9")
  await grading.getByRole("button", { name: "Save on device", exact: true }).click()
  await expect.poll(async () => (await shared(page))?.pending.length).toBe(1)
  const queued = JSON.stringify((await shared(page))!.pending.map(p => p.intent))
  await expect.poll(() => uploads.filter(o => o === owner).length).toBeGreaterThan(0)

  // Lapsed plan: fresh checks select the actor's own storage; nothing goes to the shared owner.
  allowed = false
  await context.addCookies([{ name: "hf-storage-fixture", value: `grading-partner-paused-${crypto.randomUUID()}`, url: baseURL! }])
  await page.reload()
  uploads.length = 0
  await expect(paused(page)).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('[data-item-id="synthetic-grading-1"]')).not.toBeVisible()
  await expect(page.getByRole("alert").filter({ hasText: "Could not open storage" })).not.toBeVisible()
  const h = new Harness(page, insets, true)
  await h.expectNoHorizontalOverflow()
  await h.expectWithinSafeViewport(paused(page))
  await page.waitForTimeout(1_000)
  expect(uploads.filter(o => o === owner)).toEqual([])
  expect(JSON.stringify((await shared(page))!.pending.map(p => p.intent))).toBe(queued)
  expect((await records(page)).find(r => r.scope.ownerUserId === E2E_USER.id)?.pending ?? []).toEqual([])

  // Membership read failure: a retry page, never a reset, a fallback or shared data.
  partnerships = "fail"
  await page.reload()
  const retry = page.getByRole("status").filter({ hasText: "Could not check your collection access" })
  await expect(retry).toBeVisible({ timeout: 20_000 })
  await expect(paused(page)).not.toBeVisible()
  await h.expectMinTapTarget(page.getByRole("button", { name: "Try again", exact: true }))
  expect(await page.evaluate(() => sessionStorage.getItem("holofolder-startup-reset-v2"))).toBeNull()
  await page.getByRole("button", { name: "Try again", exact: true }).click()
  await expect(retry).toBeVisible({ timeout: 20_000 })
  expect(JSON.stringify((await shared(page))!.pending.map(p => p.intent))).toBe(queued)

  // Restored plan and membership: the shared copy and its original edit come back.
  partnerships = "ok"; allowed = true
  await context.addCookies([{ name: "hf-storage-fixture", value: paidId, url: baseURL! }])
  await page.getByRole("button", { name: "Try again", exact: true }).click()
  await expect(page.locator('[data-item-id="synthetic-grading-1"]')).toBeVisible({ timeout: 20_000 })
  await expect(paused(page)).not.toBeVisible()
  expect(JSON.stringify((await shared(page))!.pending.map(p => p.intent))).toBe(queued)
})

test("desktop paused-partner notice fits the existing header", async ({ page, context, baseURL }, info) => {
  test.skip(info.project.name !== "browser-390x844", "one desktop pass")
  await page.setViewportSize({ width: 1280, height: 800 })
  await context.addCookies([{ name: "hf-storage-fixture", value: `grading-partner-paused-${crypto.randomUUID()}`, url: baseURL! }])
  await page.route("**/rest/v1/partnerships*", route => route.fulfill({ json: membership }))
  await page.route("**/rest/v1/rpc/billing_partner_allowed", route => route.fulfill({ json: false }))
  await page.goto(entry)
  await expect(paused(page)).toBeVisible({ timeout: 20_000 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath("paused-partner-desktop.png") })
})
