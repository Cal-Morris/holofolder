import { readFile } from "node:fs/promises"
import { test, expect, mockBackends, emulateStandalone, Harness, E2E_USER, storageAction, chooseCollection } from "./fixtures"
import type { Page } from "@playwright/test"
import { parseBinderBackupV2 } from "../lib/binder-backup-v2"
const collection = "22222222-2222-4222-8222-222222222222"
const entry = `/app/e2e-harness?signedIn=1&browserHost=1&binder=${collection}`
const dialog = (page: Page) => page.getByRole("dialog", { name: "Collection data backup", exact: true })
async function open(page: Page) {
  await (await storageAction(page, "Backup")).click()
  await expect(dialog(page)).toBeVisible()
  return dialog(page)
}
async function download(page: Page) {
  const event = page.waitForEvent("download")
  await dialog(page).getByRole("button", { name: "Download collection data", exact: true }).click()
  const file = await event
  const text = await readFile((await file.path())!, "utf8")
  return { text, backup: parseBinderBackupV2(text) }
}
async function records(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((yes, no) => { const r = ((q) => (q.onupgradeneeded = () => { if (!q.result.objectStoreNames.contains("records")) q.result.createObjectStore("records") }, q))(indexedDB.open("binderdex-offline", 1)); r.onsuccess = () => yes(r.result); r.onerror = () => no(r.error) })
    const rows = await new Promise<unknown[]>((yes, no) => { const r = db.transaction("records").objectStore("records").getAll(); r.onsuccess = () => yes(r.result); r.onerror = () => no(r.error) })
    db.close(); return rows
  })
}

test.beforeEach(async ({ page, context, standalone, insets, baseURL }) => {
  if (standalone) await emulateStandalone(page, insets)
  await mockBackends(page, context, { signedIn: true, baseURL })
  await context.addCookies([{ name: "hf-storage-fixture", value: `backup-${crypto.randomUUID()}`, url: baseURL! }])
})

test("real host downloads complete scoped data and private fields, local immutable preview performs no writes or provider lookup", async ({ page, insets }) => {
  // Synthetic HTTP authority, real private reader/browser host, real IDB and actual downloaded bytes.
  await page.goto(entry); const d = await open(page)
  const h = new Harness(page, insets, true)
  const close = d.getByRole("button", { name: "Close backup" })
  await h.expectMinTapTarget(close); await h.expectWithinSafeViewport(close); await h.expectHittable(close)
  const panel = (await d.boundingBox())!, dock = (await h.dock().boundingBox())!
  expect(panel.y + panel.height).toBeLessThanOrEqual(dock.y)
  const { backup, text } = await download(page)
  expect(backup.scope).toBe("all-inventory"); expect(backup.collections).toHaveLength(2)
  expect(backup.items).toHaveLength(3); expect(backup.placements).toHaveLength(2)
  expect(backup.items.map(i => i.id)).toEqual(["synthetic-backup-copy-0", "synthetic-backup-copy-1", "synthetic-backup-copy-2"])
  expect(backup.items[0].grading?.certificate).toBe("00001234")
  expect(backup.items[1].grading?.certificate).toBe("00001234")
  expect(backup.binders[0].presetManifest?.source.version).toBe("original-v1")
  expect(backup.binders[0].slots.map(s => s.id)).toEqual([0, 1, 2, 3].map(n => `synthetic-slot-${n}`))
  expect(backup.binders[0].slots[0].target).toEqual({ kind: "card", cardId: "synthetic-unknown-printing" })
  expect(backup.binders[0].slots[1].wantedCards[0].wantedRoles).toEqual(["owner"])
  expect(backup.binders[0].slots[2].target).toBeNull()
  expect(backup.layouts?.map(l => [l.rows, l.cols])).toEqual([[2, 2], [1, 4]])
  expect(text).not.toContain("00000000-0000-4000-8000-0000000000e2")
  expect(text).not.toContain("authSessionId")
  await d.getByRole("combobox", { name: "Export scope" }).selectOption("collection")
  const selected = await download(page)
  expect(selected.backup.items).toHaveLength(1); expect(selected.backup.collections).toHaveLength(1)
  const before = await records(page), requests: string[] = []
  page.on("request", request => {
    if (request.method() !== "GET" || /tcgdex|card-search|card-prices|image-proxy/.test(request.url())) requests.push(request.url())
  })
  await d.getByLabel("Select backup file").setInputFiles({ name: "private-backup.json", mimeType: "application/json", buffer: Buffer.from(text) })
  const preview = d.getByRole("region", { name: "Backup preview" })
  await expect(preview).toContainText("2 collections, 3 distinct copies, 1 Unassigned, 2 placements")
  await expect(preview).toContainText("2 Unknown")
  await expect(preview).toContainText("3 overlapping copy IDs")
  await expect(preview).not.toContainText("00001234")
  await expect(preview).not.toContainText("Synthetic private label")
  await expect(preview).toContainText("Nothing has been saved or restored")
  expect(await records(page)).toEqual(before); expect(requests).toEqual([])
  await expect(d.getByRole("button", { name: /execute|restore|confirm import/i })).toHaveCount(0)
  await h.expectNoHorizontalOverflow()
  await d.getByRole("combobox", { name: "Export scope" }).selectOption("all-inventory")
  await expect(preview).toHaveCount(0)
})

test("partner exports the entire shared owner collection with verified wanted roles", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "hf-storage-fixture", value: `backup-partner-${crypto.randomUUID()}`, url: baseURL! }])
  const owner = "11111111-1111-4111-8111-111111111111"
  await page.route("**/rest/v1/partnerships*", route => route.fulfill({ json: [{ id: "synthetic-grading-partnership", owner_user_id: owner, user1_id: owner, user2_id: E2E_USER.id }] }))
  await page.goto(entry); await open(page)
  const { backup } = await download(page)
  expect(backup.items).toHaveLength(3); expect(backup.collections).toHaveLength(2)
  expect([...(backup.binders[0].slots[1].wantedCards[0].wantedRoles ?? [])].sort()).toEqual(["owner", "partner"])
})

test("malformed, future, oversized and private-asset files fail closed without saved success", async ({ page }) => {
  await page.goto(entry); const d = await open(page), { backup } = await download(page)
  for (const [name, contents, error] of [
    ["broken.json", "{", /Invalid JSON/],
    ["future.json", JSON.stringify({ ...backup, version: 99 }), /Unsupported backup/],
    ["duplicate.json", JSON.stringify({ ...backup, items: [...backup.items, backup.items[0]] }), /Invalid v2/],
    ["big.json", " ".repeat(10 * 1024 * 1024 + 1), /10 MiB/],
    ["assets.json", JSON.stringify({ ...backup, items: backup.items.map(i => i.grading ? { ...i, grading: { ...i.grading, label: { variant: null, assetIds: ["synthetic-private-label"] } } } : i) }), /#390/],
  ] as const) {
    await d.getByLabel("Select backup file").setInputFiles({ name, mimeType: "application/json", buffer: Buffer.from(contents) })
    await expect(d.getByRole("status")).toContainText(error)
    await expect(d.getByRole("region", { name: "Backup preview" })).toHaveCount(0)
  }
})

test("offline, pending IDB edits and unsupported assets refuse export", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "hf-storage-fixture", value: `backup-assets-${crypto.randomUUID()}`, url: baseURL! }])
  await page.goto(entry); let d = await open(page)
  await d.getByRole("button", { name: "Download collection data", exact: true }).click()
  await expect(d.getByRole("status")).toContainText(/#390/)
  await context.setOffline(true); await page.evaluate(() => window.dispatchEvent(new Event("offline")))
  await expect(d.getByRole("button", { name: "Download collection data", exact: true })).toBeDisabled()
  await expect(d.getByLabel("Select backup file")).toBeDisabled()
  await d.getByRole("button", { name: "Close backup" }).click()
  await page.route("**/app/e2e-harness/storage/slots", route => route.abort("failed"))
  await context.setOffline(false); await page.evaluate(() => window.dispatchEvent(new Event("online")))
  await page.getByRole("button", { name: "Edit layout", exact: true }).click()
  await page.locator('[data-slot-id="synthetic-slot-2"]').click()
  await page.getByRole("button", { name: "Insert free slot before", exact: true }).click()
  await page.getByRole("dialog").getByRole("button", { name: "Done", exact: true }).click()
  await expect.poll(async () => (await records(page)).some(r => !!r && typeof r === "object" && "pending" in r && (r.pending as unknown[]).length > 0)).toBe(true)
  // The sender is unavailable, so the real retained IDB intent remains unresolved.
  d = await open(page)
  await expect(d.getByRole("button", { name: "Download collection data", exact: true })).toBeDisabled()
  await expect(d).toContainText("pending edits, creation or recovery")
})

test("backup dialog dismisses every way, restores focus and revokes its artifact URLs", async ({ page, insets }) => {
  await page.addInitScript(() => {
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL)
    const active = new Set<string>(); Object.assign(window, { syntheticBackupUrls: active })
    URL.createObjectURL = blob => { const url = create(blob); active.add(url); return url }
    URL.revokeObjectURL = url => { active.delete(url); revoke(url) }
  })
  await page.goto(entry); const h = new Harness(page, insets, true)
  let d = await open(page); await download(page)
  await d.getByRole("button", { name: "Close backup" }).click(); await expect(d).toBeHidden()
  await expect(page.getByRole("button", { name: "Storage", exact: true })).toBeFocused()
  expect(await page.evaluate(() => (window as unknown as { syntheticBackupUrls: Set<string> }).syntheticBackupUrls.size)).toBe(0)
  d = await open(page); await page.keyboard.press("Escape"); await expect(d).toBeHidden()
  d = await open(page); await h.tapBackdrop(d); await expect(d).toBeHidden()
  d = await open(page); await h.swipeDown(d); await expect(d).toBeHidden()
  d = await open(page); await page.goBack(); await expect(d).toBeHidden(); expect(page.url()).toContain("/e2e-harness")
  d = await open(page); await h.dock().getByRole("button", { name: "Search", exact: true }).click(); await expect(d).toBeHidden()
  await page.keyboard.press("Escape"); await h.expectScrollUnlocked(); await h.expectNoHorizontalOverflow()
})

test("session teardown during fresh export read cancels late artifact and local preview state", async ({ page }) => {
  await page.goto(entry); const d = await open(page)
  let release!: () => void, started!: () => void
  const barrier = new Promise<void>(yes => { release = yes }), reading = new Promise<void>(yes => { started = yes })
  await page.route("**/app/e2e-harness/storage/inventory?*", async route => {
    const response = await route.fetch(); started(); await barrier; await route.fulfill({ response }).catch(() => {})
  })
  const artifacts: string[] = []; page.on("download", file => artifacts.push(file.suggestedFilename()))
  await d.getByRole("button", { name: "Download collection data", exact: true }).click(); await reading
  await page.evaluate(() => { const c = new BroadcastChannel("sb-127-auth-token"); c.postMessage({ event: "SIGNED_OUT", session: null }); c.close() })
  await expect(d).toBeHidden(); release()
  await expect(page.getByRole("button", { name: "Storage", exact: true })).toHaveCount(0)
  expect(artifacts).toEqual([])
})

test("navigation target and account teardown invalidate selected-file preview without retaining private labels", async ({ page }) => {
  await page.goto(entry); let d = await open(page)
  const { text } = await download(page)
  const select = async () => {
    await d.getByLabel("Select backup file").setInputFiles({ name: "private.json", mimeType: "application/json", buffer: Buffer.from(text) })
    await expect(d.getByRole("region", { name: "Backup preview" })).toBeVisible()
  }
  await select()
  await d.getByRole("button", { name: "Close backup" }).click()
  await chooseCollection(page, "33333333-3333-4333-8333-333333333333")
  d = await open(page)
  await expect(d.getByRole("region", { name: "Backup preview" })).toHaveCount(0)
  await select()
  await page.evaluate(() => { const c = new BroadcastChannel("sb-127-auth-token"); c.postMessage({ event: "SIGNED_OUT", session: null }); c.close() })
  await expect(d).toBeHidden()
  await expect(page.getByRole("region", { name: "Backup preview" })).toHaveCount(0)
})


test("pending native creation blocks export and file preview in the combined host", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "hf-storage-fixture", value: `creation-backup-${crypto.randomUUID()}`, url: baseURL! }])
  await page.route("**/app/e2e-harness/storage/creation", route => route.abort("failed"))
  await page.goto(entry)
  await (await storageAction(page, "New storage")).click()
  const creating = page.getByRole("dialog", { name: "New storage", exact: true })
  await creating.getByRole("textbox", { name: "Storage name" }).fill("Synthetic pending backup binder")
  await creating.getByRole("combobox", { name: "Starting arrangement" }).selectOption("blank")
  await creating.getByRole("button", { name: "Review storage", exact: true }).click()
  await creating.getByRole("button", { name: "Confirm create storage", exact: true }).click()
  await expect.poll(async () => (await records(page)).some(row => !!row && typeof row === "object" && "pending" in row
    && (row.pending as { intent: { kind: string } }[]).some(pending => pending.intent.kind === "creation"))).toBe(true)
  await creating.getByRole("button", { name: "Close new storage", exact: true }).click()
  const retained = (await records(page)).flatMap(row => row && typeof row === "object" && "pending" in row
    ? (row.pending as { intent: unknown }[]).map(pending => pending.intent) : [])
  const d = await open(page)
  await expect(d.getByRole("button", { name: "Download collection data", exact: true })).toBeDisabled()
  await expect(d.getByLabel("Select backup file")).toBeDisabled()
  await expect(d).toContainText("pending edits, creation or recovery")
  expect((await records(page)).flatMap(row => row && typeof row === "object" && "pending" in row
    ? (row.pending as { intent: unknown }[]).map(pending => pending.intent) : [])).toEqual(retained)
})
