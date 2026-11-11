import { test, expect, mockBackends, emulateStandalone, Harness, E2E_USER } from "./fixtures"
import type { Page } from "@playwright/test"
test.use({ actionTimeout: 10_000 })
const collection = "22222222-2222-4222-8222-222222222222"
const entry = `/app/e2e-harness?signedIn=1&browserHost=1&binder=${collection}`
async function record(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((yes, no) => { const r = ((q) => (q.onupgradeneeded = () => { if (!q.result.objectStoreNames.contains("records")) q.result.createObjectStore("records") }, q))(indexedDB.open("binderdex-offline", 1)); r.onsuccess = () => yes(r.result); r.onerror = () => no(r.error) })
    const rows = await new Promise<unknown[]>((yes, no) => { const r = db.transaction("records").objectStore("records").getAll(); r.onsuccess = () => yes(r.result); r.onerror = () => no(r.error) })
    db.close()
    return rows.find((v): v is { pending: { status: string; attempts: number; intent: { request: { operationId: string } } }[]; receipts: { operationId: string; outcome: string }[] } => !!v && typeof v === "object" && "pending" in v) ?? null
  })
}
// Layout is edited on the pockets: select one, then Add an empty pocket before it. That is one real slots command.
const layout = (page: Page) => page.getByRole("region", { name: "Layout editing", exact: true })
// The page only says something about a change that has not been accepted yet (offline, or still being retried).
const notSaved = (page: Page) => page.locator("[data-sync-state]")
// A held change (conflict, billing or access) is sent again only when asked, from its notice.
const retry = (page: Page) => page.getByRole("button", { name: /^Try (again|now)$/ })
async function edit(page: Page) {
  await expect(page.getByRole("button", { name: "Edit layout", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Edit layout", exact: true }).click()
  await page.locator('[data-slot-id="synthetic-slot-0"]').click()
  await layout(page).getByRole("button", { name: "Add", exact: true }).click()
  await layout(page).getByRole("menuitem", { name: "Before the selection" }).click()
}
test.beforeEach(async ({ page, context, standalone, insets, baseURL }) => {
  if (standalone) await emulateStandalone(page, insets)
  await mockBackends(page, context, { signedIn: true, baseURL })
  await context.addCookies([{ name: "hf-storage-fixture", value: crypto.randomUUID(), url: baseURL! }])
})
test("actual host sends through HTTP bridge then fresh all-stream read before ACK", async ({ page, insets }) => {
  let commands = 0, afterReply = false, freshReads = 0
  await page.route("**/app/e2e-harness/storage/slots", async route => { commands++; const response = await route.fetch(); afterReply = true; await route.fulfill({ response }) })
  await page.route("**/app/e2e-harness/storage/inventory?*", async route => { if (afterReply) freshReads++; await route.continue() })
  await page.goto(entry)
  await edit(page)
  await expect.poll(async () => (await record(page))?.receipts.length).toBe(1)
  expect(commands).toBe(1); expect(freshReads).toBeGreaterThan(0)
  expect((await record(page))?.receipts[0].outcome).toBe("acknowledged")
  await page.reload()
  await expect(page.getByRole("button", { name: "Edit layout", exact: true })).toBeVisible()
  expect((await record(page))?.pending).toHaveLength(0)
  const h = new Harness(page, insets, true)
  await h.expectNoHorizontalOverflow()
})
test("committed but lost reply survives reload and exact retry without duplicate commit", async ({ page }) => {
  const ids: string[] = []
  let lost = true
  await page.route("**/app/e2e-harness/storage/slots", async route => {
    ids.push(route.request().headers()["x-storage-operation"])
    const response = await route.fetch()
    if (lost) { lost = false; await route.abort("failed") } else await route.fulfill({ response })
  })
  await page.goto(entry); await edit(page)
  await expect.poll(async () => (await record(page))?.pending[0]?.status).toBe("unavailable")
  const original = (await record(page))!.pending[0].intent.request.operationId
  expect((await record(page))?.receipts).toHaveLength(0)
  await page.reload()
  await expect.poll(async () => (await record(page))?.receipts.length).toBe(1)
  expect(ids).toEqual([original, original])
})
test("a matching receipt shows as saved before the background read finishes", async ({ page }) => {
  let replied = false, release!: () => void
  const held = new Promise<void>(yes => { release = yes })
  await page.route("**/app/e2e-harness/storage/slots", async route => { const response = await route.fetch(); replied = true; await route.fulfill({ response }) })
  await page.route("**/app/e2e-harness/storage/inventory?*", async route => { if (replied) await held; await route.continue() })
  await page.goto(entry); await edit(page)
  await expect.poll(async () => (await record(page))?.pending[0]?.status).toBe("acknowledged")
  await expect(notSaved(page)).toBeHidden()
  expect((await record(page))?.receipts).toHaveLength(0)
  release()
  await expect.poll(async () => (await record(page))?.receipts.length).toBe(1)
  expect((await record(page))?.pending).toHaveLength(0)
})
test("a stale complete read cannot settle or roll back an acknowledged save; a later fresh read settles it", async ({ page }) => {
  let original: unknown, commands = 0, stale = true
  await page.route("**/app/e2e-harness/storage/inventory?*", async route => {
    const response = await route.fetch(), body = await response.json()
    if (!original) original = body
    if (commands && stale) {
      const old = original as { snapshot: unknown; evidence: unknown; navigation: unknown }
      await route.fulfill({ response, json: { ...body, snapshot: old.snapshot, evidence: old.evidence, navigation: old.navigation } })
    } else await route.fulfill({ response })
  })
  await page.route("**/app/e2e-harness/storage/slots", async route => { commands++; await route.continue() })
  await page.goto(entry); await edit(page)
  await expect.poll(async () => (await record(page))?.pending[0]?.status).toBe("acknowledged")
  expect((await record(page))?.receipts).toHaveLength(0)
  await layout(page).getByRole("button", { name: "Done", exact: true }).click()
  await expect(retry(page)).toHaveCount(0)
  await expect(notSaved(page)).toHaveCount(0)
  stale = false
  await expect.poll(async () => (await record(page))?.receipts.length).toBe(1)
  expect(commands).toBe(1)
})
for (const change of ["signout", "account", "owner"] as const) test(`${change} teardown during in-flight command retains lease and rejects late response`, async ({ page }) => {
  // The new synthetic owner has no harness storage, so its startup fails; keep the one-time cache reset from deleting the record under test.
  if (change === "owner") await page.addInitScript(() => sessionStorage.setItem("holofolder-startup-reset-v2", "1"))
  let release!: () => void, started!: () => void, delivered!: () => void
  const barrier = new Promise<void>(yes => { release = yes }), sending = new Promise<void>(yes => { started = yes }), replied = new Promise<void>(yes => { delivered = yes })
  await page.route("**/app/e2e-harness/storage/slots", async route => { const response = await route.fetch(); started(); await barrier; await route.fulfill({ response }).catch(() => {}); delivered() })
  await page.goto(entry); await edit(page); await sending
  if (change === "owner") await page.route("**/rest/v1/partnerships*", route => route.fulfill({ json: [{ id: "synthetic-membership", owner_user_id: "33333333-3333-4333-8333-333333333333", user1_id: E2E_USER.id, user2_id: "33333333-3333-4333-8333-333333333333" }] }))
  await page.evaluate(({ change, user }) => { const channel = new BroadcastChannel("sb-127-auth-token")
    channel.postMessage(change === "signout" ? { event: "SIGNED_OUT", session: null } : { event: change === "account" ? "SIGNED_IN" : "TOKEN_REFRESHED", session: { user: change === "account" ? { ...user, id: "55555555-5555-4555-8555-555555555555" } : user } }); channel.close()
  }, { change, user: E2E_USER })
  await expect(page.getByRole("button", { name: "Edit layout", exact: true })).not.toBeVisible()
  // The same account's token refresh is a benign recheck: the open scope stays current until the check proves
  // the owner changed, and a reply inside that window is accepted. Release only once the new owner is established.
  if (change === "owner") await expect(page.getByRole("alert").filter({ hasText: "Could not open storage" })).toBeVisible()
  release(); await replied
  for (let check = 0; check < 5; check++) {
    await page.waitForTimeout(100)
    const state = await record(page)
    expect(state?.pending[0]?.status).toBe("sending"); expect(state?.receipts).toHaveLength(0)
  }
})
test("unclassified 409 retains command for exact retry without cancellation or replacement", async ({ page }) => {
  let sends = 0
  await page.route("**/app/e2e-harness/storage/slots", async route => { sends++; await route.fulfill({ status: 409, json: { error: { code: "storage_conflict", message: "Synthetic conflict", requestId: "synthetic" } } }) })
  await page.goto(entry); await edit(page)
  await expect.poll(async () => (await record(page))?.pending[0]?.status).toBe("conflict")
  await layout(page).getByRole("button", { name: "Done", exact: true }).click()
  await retry(page).click()
  await expect.poll(() => sends).toBe(2)
  expect((await record(page))?.receipts).toHaveLength(0)
})
test("reordered success reply cannot ACK actual IDB; exact operation retry resolves", async ({ page }) => {
  const ids: string[] = []
  await page.route("**/app/e2e-harness/storage/slots", async route => {
    ids.push(route.request().headers()["x-storage-operation"])
    const response = await route.fetch(), body = await response.json()
    await route.fulfill({ response, json: ids.length === 1 ? { ...body, operationId: "another-operation" } : body })
  })
  await page.goto(entry); await edit(page)
  await expect.poll(async () => (await record(page))?.pending[0]?.status).toBe("unavailable")
  expect((await record(page))?.receipts).toHaveLength(0)
  await expect.poll(async () => (await record(page))?.receipts.length).toBe(1)
  expect(ids).toHaveLength(2); expect(ids[0]).toBe(ids[1])
})
test("crash reload retains sending lease then replays exact ID after lease expiry", async ({ page }) => {
  let release!: () => void, started!: () => void
  const barrier = new Promise<void>(yes => { release = yes }), sending = new Promise<void>(yes => { started = yes })
  const ids: string[] = []
  await page.route("**/app/e2e-harness/storage/slots", async route => {
    ids.push(route.request().headers()["x-storage-operation"])
    const response = await route.fetch()
    if (ids.length === 1) { started(); await barrier }
    await route.fulfill({ response }).catch(() => {})
  })
  await page.goto(entry); await edit(page); await sending
  expect((await record(page))?.pending[0]?.status).toBe("sending")
  // A new document represents process restart. Advance only that document's clock beyond the persisted lease.
  await page.addInitScript(() => { const now = Date.now.bind(Date); Date.now = () => now() + 61_000 })
  await page.reload(); release()
  await expect.poll(async () => (await record(page))?.receipts.length).toBe(1)
  expect(ids).toHaveLength(2); expect(ids[0]).toBe(ids[1])
})
test("offline enqueue stays durable then reconnect sends; billing/permanent errors need explicit retry", async ({ page, context }) => {
  let status = 402
  const ids: string[] = []
  await page.route("**/app/e2e-harness/storage/slots", async route => {
    ids.push(route.request().headers()["x-storage-operation"])
    if (status === 200) await route.continue()
    else await route.fulfill({ status, json: { error: { code: "synthetic-rejection", message: "Synthetic", requestId: "synthetic" } } })
  })
  await page.goto(entry)
  await expect(page.getByRole("button", { name: "Edit layout", exact: true })).toBeVisible()
  // Warm the existing lazy sheet before disconnecting; this is in-process IDB sync proof, not cold SW relaunch.
  await page.getByRole("button", { name: "Edit layout", exact: true }).click()
  await page.locator('[data-slot-id="synthetic-slot-0"]').click()
  await expect(layout(page).getByRole("button", { name: "Add", exact: true })).toBeVisible()
  await context.setOffline(true)
  // Evidence downgrade ends transient selection; reopen the warmed sheet in the saved collection.
  await page.getByRole("navigation", { name: "Main navigation", exact: true }).getByRole("button", { name: "Inventory", exact: true }).click()
  await page.getByRole("navigation", { name: "Main navigation", exact: true }).getByRole("button", { name: "Binder", exact: true }).click()
  await edit(page)
  await expect.poll(async () => (await record(page))?.pending[0]?.status).toBe("pending"); expect(ids).toHaveLength(0)
  await context.setOffline(false)
  await expect.poll(async () => (await record(page))?.pending[0]?.status).toBe("billing")
  await page.getByRole("navigation", { name: "Main navigation", exact: true }).getByRole("button", { name: "Inventory", exact: true }).click()
  status = 403
  await retry(page).click()
  await expect.poll(async () => (await record(page))?.pending[0]?.status).toBe("blocked")
  status = 200
  await retry(page).click()
  await expect.poll(async () => (await record(page))?.receipts.length).toBe(1)
  expect(new Set(ids).size).toBe(1)
})

test("terminal rejection persists through reload and refresh failure, then explicit current-state cancellation", async ({ page, insets }) => {
  let concurrent = false, rejectRead = false
  const ids: string[] = []
  await page.route("**/app/e2e-harness/storage/slots", async route => {
    const body = route.request().postDataJSON()
    ids.push(body.operationId)
    if (!concurrent) {
      concurrent = true
      const operationId = "synthetic-concurrent-change"
      const response = await route.fetch({ headers: { ...route.request().headers(), "x-storage-operation": operationId }, postData: JSON.stringify({ ...body, operationId,
        commands: [{ kind: "create", ids: ["synthetic-concurrent-slot"], beforeSlotId: null }] }) })
      expect(response.status()).toBe(200)
    }
    const response = await route.fetch()
    expect(response.status()).toBe(409)
    rejectRead = true
    await route.fulfill({ response })
  })
  await page.route("**/app/e2e-harness/storage/inventory?*", async route => {
    if (rejectRead) await route.abort("failed"); else await route.continue()
  })
  await page.goto(entry); await edit(page)
  await expect.poll(async () => (await record(page))?.pending[0]?.status).toBe("conflict")
  // A change the server turned down asks what to do. Until the collection has been read again, the only
  // choice is to check it; keeping the collection as it is comes after that read.
  const check = page.getByRole("button", { name: "Check my collection" })
  await expect(check).toBeVisible()
  await expect(page.getByRole("button", { name: "Keep my collection as it is" })).not.toBeVisible()
  // A failed check keeps the rejected change and its choice.
  await check.click()
  await expect(check).toBeVisible()
  expect((await record(page))?.receipts).toHaveLength(0)
  // An online startup needs a fresh read (a failed one is its own error screen), so the reload reads.
  rejectRead = false
  await page.reload()
  // The rejected change survived. Once the collection has been read (on startup, or by checking it from
  // this device's saved copy) the choice comes back.
  expect((await record(page))?.pending[0]?.status).toBe("conflict")
  const applyAgain = page.getByRole("button", { name: "Apply my change again" })
  await expect(async () => {
    if (await check.isVisible()) await check.click()
    await expect(applyAgain).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 15_000 })
  const useCurrent = page.getByRole("button", { name: "Keep my collection as it is" })
  await expect(useCurrent).toBeVisible()
  const h = new Harness(page, insets, true)
  await h.expectMinTapTarget(useCurrent); await h.expectHittable(useCurrent); await h.expectNoHorizontalOverflow()
  await useCurrent.click()
  await expect.poll(async () => (await record(page))?.receipts[0]?.outcome).toBe("cancelled")
  expect((await record(page))?.pending).toHaveLength(0)
  expect(ids).toHaveLength(1)
})
