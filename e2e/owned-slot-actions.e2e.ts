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
test("an owned pocket opens the card's details, with no slot or draft form", async ({ page }) => {
  await page.goto(entry)
  await page.locator('[data-slot-id="synthetic-slot-0"]').click()
  const dialog = page.getByRole("dialog", { name: /details$/ })
  await expect(dialog.getByRole("heading", { name: "Synthetic Owned Bulbasaur" })).toBeVisible()
  await expect(dialog.getByText(/Edit slot|Change target|Remove target|Unassigned|Pending sync|Saved on device/)).toHaveCount(0)
  await expect(dialog.locator("[data-slot-picker]")).toHaveCount(0)
})

test("Take out of this pocket saves through the durable queue, syncs and keeps the card", async ({ page }) => {
  await page.goto(entry)
  await page.locator('[data-slot-id="synthetic-slot-0"]').click()
  const dialog = page.getByRole("dialog", { name: /details$/ })
  await expect(dialog).toContainText("Synthetic Owned Bulbasaur")
  await dialog.getByRole("button", { name: "More card options" }).click()
  await dialog.getByRole("menuitem", { name: /Take out of this pocket/ }).click()
  await expect.poll(async () => (await record(page))?.receipts.length, { timeout: 15_000 }).toBe(1)
  expect((await record(page))!.receipts[0].outcome).toBe("acknowledged")
  // It finishes on the binder: no leftover sheet and no status line once the server has confirmed.
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(page.locator("[data-sync-state]")).toHaveCount(0)
  await expect(page.getByText(/Pending sync|Saved on device/)).toHaveCount(0)
})

test("Remove from collection confirms first, then removes that exact card through the durable queue", async ({ page }) => {
  const bodies: string[] = []
  await page.route("**/app/e2e-harness/storage/inventory", async route => { if (route.request().method() === "POST") bodies.push(route.request().postData() ?? ""); await route.continue() })
  await page.goto(entry)
  await page.locator('[data-slot-id="synthetic-slot-0"]').click()
  const dialog = page.getByRole("dialog", { name: /details$/ })
  await dialog.getByRole("button", { name: "More card options" }).click()
  await dialog.getByRole("menuitem", { name: /Remove from collection/ }).click()
  const confirm = dialog.getByRole("region", { name: "Remove card" })
  await expect(confirm).toContainText("Remove Synthetic Owned Bulbasaur from your collection?")
  expect((await record(page))?.pending ?? []).toHaveLength(0)
  // Keep it changes nothing.
  await confirm.getByRole("button", { name: "Keep it" }).click()
  await expect(confirm).toHaveCount(0)
  expect(bodies).toHaveLength(0)
  await dialog.getByRole("button", { name: "More card options" }).click()
  await dialog.getByRole("menuitem", { name: /Remove from collection/ }).click()
  await dialog.getByRole("region", { name: "Remove card" }).getByRole("button", { name: "Remove card" }).click()
  await expect.poll(async () => (await record(page))?.receipts.length, { timeout: 15_000 }).toBe(1)
  expect((await record(page))!.receipts[0].outcome).toBe("acknowledged")
  // One request, and it is the owned-copy removal rather than taking the card out of its pocket.
  expect(bodies).toHaveLength(1)
  expect(bodies[0]).toContain("removeOwned")
  await expect(page.getByRole("dialog")).toHaveCount(0)
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
  await dialog.getByRole("button", { name: "More card options" }).click()
  await dialog.getByRole("menuitem", { name: /Take out of this pocket/ }).click()
  // Before the fix this failed at once (inactive-or-unavailable-session) and blamed device storage.
  await page.waitForTimeout(500)
  expect((await record(page))?.receipts ?? []).toHaveLength(0)
  release()
  await expect.poll(async () => (await record(page))?.receipts.length, { timeout: 15_000 }).toBe(1)
  expect((await record(page))!.receipts[0].outcome).toBe("acknowledged")
  // (Next keeps one empty route announcer alert at the top of the page; only the app's own alerts count.)
  await expect(page.locator('main [role="alert"], [role="dialog"] [role="alert"]')).toHaveCount(0)
})
