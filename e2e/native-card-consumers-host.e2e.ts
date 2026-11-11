import type { SlotOfflineRecord } from '../lib/collection/slot-offline-queue'
import { test, expect, mockBackends, emulateStandalone, Harness, storageAction, closeStorage } from "./fixtures"
import type { Page } from "@playwright/test"
// Internal ids, storage evidence and staging copy must never reach the screen.
const raw = /explicit entries|Saved storage evidence|Unknown exact printing|wanted entry|Use this wanted destination|Add a new raw copy|Draft handed|synthetic-slot|synthetic-native-copy|22222222-2222/
const entry = "/app/e2e-harness?signedIn=1&browserHost=1&binder=22222222-2222-4222-8222-222222222222"
const card = { id: "synthetic-native-trainer", localId: "7", name: "Synthetic Native Trainer", language: "en", dexIds: [],
  set: { id: "synthetic-native", name: "Synthetic native set" }, variants: { normal: true } }
async function records(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((yes, no) => { const r = ((q) => (q.onupgradeneeded = () => { if (!q.result.objectStoreNames.contains("records")) q.result.createObjectStore("records") }, q))(indexedDB.open("binderdex-offline", 1)); r.onsuccess = () => yes(r.result); r.onerror = () => no(r.error) })
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
  const wants = page.getByRole("region", { name: "On your want list" })
  await expect(wants.getByRole("heading", { name: "On your want list · 3 cards" })).toBeVisible()
  await expect(wants.getByRole("listitem")).toHaveCount(3)
  await expect(wants.getByText("Synthetic native set · #7", { exact: true })).toHaveCount(3)
  await expect(wants).not.toContainText(raw)
  await expect(wants.getByRole("combobox")).toHaveCount(3)
  await wants.getByRole("combobox").nth(1).selectOption("synthetic-native-copy-1")
  await expect(wants.getByRole("combobox").nth(1)).not.toContainText(raw)
  await wants.getByRole("button", { name: "Add to collection" }).nth(1).click()
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
  await expect(wants).not.toContainText(raw)
  expect(legacy).toEqual([])
  await new Harness(page, insets, true).expectNoHorizontalOverflow()
})
test("exact native lookup closes on account teardown without sending ownership commands", async ({ page }) => {
  let sends = 0
  page.on("request", r => { if (r.method() === "POST" && r.url().endsWith("/storage/inventory")) sends++ })
  await page.goto(entry); await lookup(page)
  await page.evaluate(() => { const c = new BroadcastChannel("sb-127-auth-token"); c.postMessage({ event: "SIGNED_OUT", session: null }); c.close() })
  await expect(page.getByRole("region", { name: "On your want list" })).toHaveCount(0)
  expect(sends).toBe(0)
})


for (const desktop of [false, true]) test(`actual QuickMode Show Hunting and lookup show readable wanted cards and keep the Show panels ${desktop ? "desktop" : "phone"}`, async ({ page, insets }, info) => {
  test.skip(desktop && info.project.name !== "browser-390x844", "One desktop check")
  if (desktop) await page.setViewportSize({ width: 1440, height: 1000 })
  let sends = 0
  page.on("request", r => { if (r.method() === "POST" && r.url().endsWith("/storage/inventory")) sends++ })
  await page.goto(entry)
  await expect(await storageAction(page, "Backup")).toBeVisible(); await closeStorage(page)
  await page.keyboard.press("Control+k")
  const quick = page.getByRole("dialog", { name: "Quick mode", exact: true })
  await quick.getByRole("searchbox").fill("card show")
  await quick.getByRole("button", { name: /^Show mode/ }).click()
  await quick.getByRole("searchbox").fill("")
  await expect(quick.getByRole("region", { name: "Show budget" })).toBeVisible()
  const wants = quick.getByRole("region", { name: "Hunting" })
  await expect(wants.getByRole("heading", { name: "Hunting · 3 cards" })).toBeVisible()
  await expect(wants.getByText("Synthetic Native Trainer", { exact: true })).toHaveCount(3)
  await expect(wants).not.toContainText(raw)
  const h = new Harness(page, insets, true)
  const check = wants.getByRole("button", { name: "Check price", exact: true }).first()
  await h.expectMinTapTarget(check)
  await h.expectHittable(check)
  await h.expectNoHorizontalOverflow()
  await check.click()
  const lookupWants = quick.getByRole("region", { name: "On your want list" })
  await expect(lookupWants.getByRole("heading", { name: "On your want list · 3 cards" })).toBeVisible()
  await expect(lookupWants).not.toContainText(raw)
  await expect(quick.getByRole("button", { name: /Mark got|Add to owned|Bought/ })).toHaveCount(0)
  expect(sends).toBe(0)
})
