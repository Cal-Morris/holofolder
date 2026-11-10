import type { SlotOfflineRecord } from '../lib/collection/slot-offline-queue'
import { test, expect, mockBackends, emulateStandalone, Harness, storageAction, closeStorage } from "./fixtures"
import type { Page } from "@playwright/test"
const entry = "/app/e2e-harness?signedIn=1&browserHost=1&binder=22222222-2222-4222-8222-222222222222"
const card = { id: "synthetic-native-trainer", localId: "7", name: "Synthetic Native Trainer", language: "en", dexIds: [],
  set: { id: "synthetic-native", name: "Synthetic native set" }, variants: { normal: true } }
async function records(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((yes, no) => { const r = indexedDB.open("binderdex-offline"); r.onsuccess = () => yes(r.result); r.onerror = () => no(r.error) })
    const rows = await new Promise<unknown[]>((yes, no) => { const r = db.transaction("records").objectStore("records").getAll(); r.onsuccess = () => yes(r.result); r.onerror = () => no(r.error) })
    db.close(); return rows.find(r => !!r && typeof r === "object" && "pending" in r) as SlotOfflineRecord | undefined
  })
}
async function lookup(page: Page) {
  await expect(await storageAction(page, "Backup")).toBeVisible(); await closeStorage(page)
  await page.getByRole("navigation", { name: "Main navigation", exact: true }).getByRole("button", { name: "Search", exact: true }).click()
  await page.getByRole("textbox", { name: "Search Pokémon, cards, sets, artists or dex number" }).fill("Synthetic Native Trainer")
  await page.getByRole("button", { name: /^Synthetic Native Trainer .*Wanted ×3/ }).click()
  await expect(page.getByRole("heading", { name: "Synthetic Native Trainer", exact: true }).first()).toBeVisible()
}
test.beforeEach(async ({ page, context, standalone, insets, baseURL }) => {
  if (standalone) await emulateStandalone(page, insets)
  await mockBackends(page, context, { signedIn: true, baseURL })
  await context.addCookies([{ name: "hf-storage-fixture", value: `native-consumer-${crypto.randomUUID()}`, url: baseURL! }])
  await page.route("**/app/api/tcg-card-search**", route => route.fulfill({ json: { cards: [card] } }))
})
for (const accepted of [false, true]) test(`real host exact non-Pokémon lookup preserves duplicate wanted destinations and ${accepted ? "ACKs a fresh read" : "retains a lost reply"}`, async ({ page, insets }) => {
  const bodies: unknown[] = [], legacy: string[] = []
  let release!: () => void
  const barrier = new Promise<void>(yes => { release = yes })
  await page.route("**/app/e2e-harness/storage/inventory", async route => {
    bodies.push(route.request().postDataJSON())
    const response = await route.fetch()
    await barrier
    if (accepted) await route.fulfill({ response })
    else await route.abort("failed")
  })
  page.on("request", r => { if (r.method() !== "GET" && /\/api\/(collection|binders)(?:[/?]|$)/.test(r.url())) legacy.push(r.url()) })
  await page.goto(entry); await lookup(page)
  const wants = page.getByRole("region", { name: "Native wanted destinations" })
  await expect(wants).toContainText("3 explicit entries")
  await expect(wants.getByRole("combobox")).toHaveCount(3)
  await wants.getByRole("combobox").nth(1).selectOption("synthetic-native-copy-1")
  await wants.getByRole("button", { name: "Use this wanted destination" }).nth(1).click()
  await expect.poll(async () => (await records(page))?.pending.length).toBe(1)
  const intent = (await records(page))!.pending[0].intent
  if (intent.kind !== "inventory") throw new Error("Expected the native inventory command")
  const pending = intent.request.commands[0]
  expect(pending).toMatchObject({ kind: "assign", selection: { kind: "existing", inventoryItemId: "synthetic-native-copy-1" },
    destination: { slot: { id: "synthetic-slot-0" } }, fulfillWant: { index: 1, expected: { wanted_by: ["00000000-0000-4000-8000-0000000000e2"] } } })
  await expect.poll(() => bodies.length).toBeGreaterThan(0)
  release()
  if (accepted) {
    await expect.poll(async () => (await records(page))?.receipts.length).toBe(1)
    const current = (await records(page))!
    expect(current.pending).toHaveLength(0)
    expect(current.snapshot?.placements).toContainEqual(expect.objectContaining({ inventoryItemId: "synthetic-native-copy-1", slotId: "synthetic-slot-0" }))
    expect(current.snapshot?.binders[0].slots[0].wantedCards).toHaveLength(1)
  } else {
    await expect.poll(async () => (await records(page))?.pending[0]?.status).toBe("unavailable")
    expect((await records(page))?.pending[0].intent).toEqual(intent)
    expect((await records(page))?.receipts).toHaveLength(0)
  }
  expect(legacy).toEqual([])
  await new Harness(page, insets, true).expectNoHorizontalOverflow()
})
test("exact native lookup closes on account teardown without sending ownership commands", async ({ page }) => {
  let sends = 0
  page.on("request", r => { if (r.method() === "POST" && r.url().endsWith("/storage/inventory")) sends++ })
  await page.goto(entry); await lookup(page)
  await page.evaluate(() => { const c = new BroadcastChannel("sb-127-auth-token"); c.postMessage({ event: "SIGNED_OUT", session: null }); c.close() })
  await expect(page.getByRole("region", { name: "Native wanted destinations" })).toHaveCount(0)
  expect(sends).toBe(0)
})


test("actual QuickMode Show lookup receives native duplicate wanted destinations without legacy purchases", async ({ page }) => {
  let sends = 0
  page.on("request", r => { if (r.method() === "POST" && r.url().endsWith("/storage/inventory")) sends++ })
  await page.goto(entry)
  await expect(await storageAction(page, "Backup")).toBeVisible(); await closeStorage(page)
  await page.keyboard.press("Control+k")
  const quick = page.getByRole("dialog", { name: "Quick mode", exact: true })
  await quick.getByRole("searchbox").fill("card show")
  await quick.getByRole("button", { name: /^Show mode/ }).click()
  await quick.getByRole("searchbox").fill("")
  const wants = quick.getByRole("region", { name: "Native wanted destinations" })
  await expect(wants).toContainText("3 explicit entries")
  await wants.getByRole("button", { name: "Check price", exact: true }).first().click()
  await expect(quick.getByRole("region", { name: "Native wanted destinations" })).toContainText("3 explicit entries")
  await expect(quick.getByRole("button", { name: /Mark got|Add to owned|Bought/ })).toHaveCount(0)
  expect(sends).toBe(0)
})
