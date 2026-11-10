import { test, expect, mockBackends, emulateStandalone } from "./fixtures"
import type { Page } from "@playwright/test"
// Real BrowserCollectionSession, IDB queue and HTTP storage bridge over a synthetic ledger (tests/fixtures/storage-command-harness.ts).
const collection = "22222222-2222-4222-8222-222222222222"
const entry = `/app/e2e-harness?signedIn=1&browserHost=1&binder=${collection}`
async function record(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((yes, no) => { const r = indexedDB.open("binderdex-offline"); r.onsuccess = () => yes(r.result); r.onerror = () => no(r.error) })
    const rows = await new Promise<unknown[]>((yes, no) => { const r = db.transaction("records").objectStore("records").getAll(); r.onsuccess = () => yes(r.result); r.onerror = () => no(r.error) }); db.close()
    return rows.find((r): r is { pending: { status: string; conflict: unknown }[]; receipts: { outcome: string }[] } => !!r && typeof r === "object" && "pending" in r) ?? null
  })
}
test.beforeEach(async ({ page, context, standalone, insets, baseURL }) => {
  if (standalone) await emulateStandalone(page, insets)
  await mockBackends(page, context, { signedIn: true, baseURL })
  await context.addCookies([{ name: "hf-storage-fixture", value: `owned-${crypto.randomUUID()}`, url: baseURL! }])
})
for (const action of ["Move card to Unassigned", "Remove target"] as const) test(`owned pocket: ${action} saves through the durable queue and syncs`, async ({ page }) => {
  await page.goto(entry)
  await page.locator('[data-slot-id="synthetic-slot-0"]').click()
  const dialog = page.getByRole("dialog", { name: /details$/ })
  await expect(dialog).toContainText("Synthetic Owned Bulbasaur")
  const edit = dialog.locator("summary").filter({ hasText: /Edit slot|Card options/ })
  if (await edit.count()) await edit.click()
  await dialog.getByRole("button", { name: action, exact: true }).click()
  await expect.poll(async () => (await record(page))?.receipts.length, { timeout: 15_000 }).toBe(1)
  await expect(dialog.getByRole("alert")).toHaveCount(0)
  expect((await record(page))!.receipts[0].outcome).toBe("acknowledged")
})

test("an owned-pocket action during a routine focus refresh waits for it and saves", async ({ page }) => {
  let hold = false, release!: () => void
  const gate = new Promise<void>(yes => { release = yes })
  await page.route("**/app/e2e-harness/storage/inventory?*", async route => { if (hold) await gate; await route.continue() })
  await page.goto(entry)
  await page.locator('[data-slot-id="synthetic-slot-0"]').click()
  const dialog = page.getByRole("dialog", { name: /details$/ })
  await expect(dialog).toContainText("Synthetic Owned Bulbasaur")
  hold = true
  await page.evaluate(() => window.dispatchEvent(new Event("focus")))
  const options = dialog.locator("summary").filter({ hasText: /Edit slot|Card options/ })
  if (await options.count()) await options.click()
  await dialog.getByRole("button", { name: "Move card to Unassigned", exact: true }).click()
  // Before the fix this failed at once (inactive-or-unavailable-session) and blamed device storage.
  await page.waitForTimeout(500)
  expect((await record(page))?.receipts ?? []).toHaveLength(0)
  release()
  await expect.poll(async () => (await record(page))?.receipts.length, { timeout: 15_000 }).toBe(1)
  expect((await record(page))!.receipts[0].outcome).toBe("acknowledged")
  await expect(dialog.getByRole("alert")).toHaveCount(0)
})
