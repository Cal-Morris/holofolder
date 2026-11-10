import { test, expect, mockBackends, emulateStandalone, E2E_USER, storageAction, closeStorage, viewPicker } from "./fixtures"
import type { Page } from "@playwright/test"

// Synthetic transport, real native creation, owner-scoped complete reads and durable record.
const entry = "/app/e2e-harness?signedIn=1&browserHost=1&binder=22222222-2222-4222-8222-222222222222"
async function saved(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((yes, no) => { const r = indexedDB.open("binderdex-offline"); r.onsuccess = () => yes(r.result); r.onerror = () => no(r.error) })
    const rows = await new Promise<unknown[]>((yes, no) => { const r = db.transaction("records").objectStore("records").getAll(); r.onsuccess = () => yes(r.result); r.onerror = () => no(r.error) })
    db.close()
    return rows.find(r => !!r && typeof r === "object" && "pending" in r && "scope" in r) as {
      scope: { ownerUserId: string; accountId: string }; pending: unknown[]; legacy: unknown[]; receipts: { intent: { request: { collectionId: string; kind: string; location: string | null } } }[];
      snapshot: { items: unknown[]; placements: unknown[]; collections: { id: string; kind: string; location: string | null }[]; binders: { collectionId: string }[] }
    }
  })
}
test.beforeEach(async ({ page, context, standalone, insets, baseURL }) => {
  if (standalone) await emulateStandalone(page, insets)
  await mockBackends(page, context, { signedIn: true, baseURL })
  await context.addCookies([{ name: "hf-storage-fixture", value: `creation-${crypto.randomUUID()}`, url: baseURL! }])
})
async function review(page: Page) {
  await (await storageAction(page, "New storage")).click()
  const dialog = page.getByRole("dialog", { name: "New storage", exact: true })
  await dialog.getByRole("combobox", { name: "Storage kind" }).selectOption("custom")
  await dialog.getByRole("textbox", { name: "Storage name" }).fill("Synthetic custom box")
  await dialog.getByRole("textbox", { name: "Location (optional)" }).fill("  Synthetic private shelf  ")
  await dialog.getByRole("button", { name: "Review storage", exact: true }).click()
  return dialog
}
test("partner creates Custom under shared owner without changing existing graded copies, targets or placements", async ({ page, context, baseURL }) => {
  const owner = "11111111-1111-4111-8111-111111111111"
  await context.addCookies([{ name: "hf-storage-fixture", value: `backup-partner-${crypto.randomUUID()}`, url: baseURL! }])
  await page.route("**/rest/v1/partnerships*", route => route.fulfill({ json: [{ id: "synthetic-grading-partnership", owner_user_id: owner, user1_id: owner, user2_id: E2E_USER.id }] }))
  await page.route("**/app/api/billing", route => route.fulfill({ json: { access: { ownerUserId: owner, tier: "paid", source: "perpetual", paidThrough: null, savedCardCount: 3, enforced: true }, canManage: false } }))
  await page.goto(entry)
  const dialog = await review(page), before = await saved(page)
  await dialog.getByRole("button", { name: "Confirm create storage", exact: true }).click()
  await expect.poll(async () => (await saved(page)).receipts.length).toBe(1)
  const after = await saved(page), request = after.receipts[0].intent.request
  expect(after.scope).toMatchObject({ ownerUserId: owner, accountId: E2E_USER.id })
  expect(request).toMatchObject({ kind: "custom", location: "Synthetic private shelf" })
  expect(after.snapshot.items).toEqual(before.snapshot.items)
  expect(after.snapshot.placements).toEqual(before.snapshot.placements)
  expect(after.snapshot.binders.filter(b => before.snapshot.binders.some(old => old.collectionId === b.collectionId))).toEqual(before.snapshot.binders)
  expect(after.snapshot.collections.find(c => c.id === request.collectionId)).toMatchObject({ kind: "custom", location: "Synthetic private shelf" })
  await expect(viewPicker(page)).toHaveAttribute("data-value", "list")
})
test("retained legacy work arriving during Custom review fences confirmation and survives reload", async ({ page }) => {
  await page.goto(entry)
  const dialog = await review(page)
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((yes, no) => { const r = indexedDB.open("binderdex-offline"); r.onsuccess = () => yes(r.result); r.onerror = () => no(r.error) })
    await new Promise<void>((yes, no) => {
      const tx = db.transaction("records", "readwrite"), cursor = tx.objectStore("records").openCursor()
      cursor.onsuccess = () => {
        const c = cursor.result; if (!c) return
        const r = c.value
        if (r?.scope && r?.pending) {
          r.legacy = [{ workspaceId: r.scope.workspaceId, collectionId: "22222222-2222-4222-8222-222222222222", rawSnapshot: null, rawQueue: "synthetic unresolved legacy bytes", mapping: [] }]
          c.update(r)
        }
        c.continue()
      }
      tx.oncomplete = () => yes(); tx.onerror = tx.onabort = () => no(tx.error)
    })
    db.close()
    const c = new BroadcastChannel("binderdex-slot-intent-v1"); c.postMessage("changed"); c.close()
  })
  await expect(dialog.getByRole("button", { name: "Confirm create storage", exact: true })).toBeDisabled()
  expect((await saved(page)).pending).toHaveLength(0)
  await page.reload()
  await expect(await storageAction(page, "New storage")).toBeDisabled(); await closeStorage(page)
  expect((await saved(page)).legacy).toHaveLength(1)
  expect((await saved(page)).receipts).toHaveLength(0)
})
