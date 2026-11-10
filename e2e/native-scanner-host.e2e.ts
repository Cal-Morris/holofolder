import { test, expect, mockBackends, emulateStandalone, Harness, E2E_USER } from "./fixtures"
import type { Page } from "@playwright/test"
const collection = "22222222-2222-4222-8222-222222222222"
const entry = `/app/e2e-harness?signedIn=1&browserHost=1&binder=${collection}`
const review = (page: Page) => page.getByRole("dialog", { name: "Review scan destinations" })
async function record(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((yes, no) => { const r = indexedDB.open("binderdex-offline"); r.onsuccess = () => yes(r.result); r.onerror = () => no(r.error) })
    const rows = await new Promise<unknown[]>((yes, no) => { const r = db.transaction("records").objectStore("records").getAll(); r.onsuccess = () => yes(r.result); r.onerror = () => no(r.error) })
    db.close()
    return rows.find((r): r is { pending: { status: string; intent: { request: { operationId: string; commands: unknown[] } } }[]; receipts: unknown[] } => !!r && typeof r === "object" && "pending" in r)
  })
}
async function cardReview(page: Page) {
  await page.getByRole("button", { name: "Scan card", exact: true }).click()
  await page.getByRole("button", { name: "Type instead", exact: true }).click()
  await expect(review(page)).toBeVisible()
}
async function choose(page: Page, cell: number, card: string, slot: number) {
  await page.getByRole("combobox", { name: `Card for cell ${cell}`, exact: true }).selectOption(`synthetic-${card}:en`)
  await page.getByRole("combobox", { name: `Copy for cell ${cell}`, exact: true }).selectOption("raw")
  await page.getByRole("combobox", { name: `Destination for cell ${cell}`, exact: true }).selectOption(`synthetic-slot-${slot}`)
}
test.beforeEach(async ({ page, context, standalone, insets, baseURL }) => {
  if (standalone) await emulateStandalone(page, insets)
  await mockBackends(page, context, { signedIn: true, baseURL })
  await context.addCookies([{ name: "hf-storage-fixture", value: `scan-${crypto.randomUUID()}`, url: baseURL! }])
  await page.addInitScript(() => {
    // Synthetic camera only. No physical device or recognition accuracy claim.
    const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 480
    const draw = () => { const c = canvas.getContext("2d")!; c.fillStyle = "#234567"; c.fillRect(0, 0, 640, 480) }
    draw(); setInterval(draw, 100)
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => canvas.captureStream(10) } })
    Object.assign(window, { TextDetector: class { async detect() { return [{ rawValue: "Synthetic trainer 1/100" }] } } })
  })
})
test("real host manual Energy uses explicit free destination and durable HTTP fresh ACK", async ({ page, insets }) => {
  let sends = 0, after = false, reads = 0
  await page.route("**/app/e2e-harness/storage/inventory", async route => { sends++; const response = await route.fetch(); after = true; await route.fulfill({ response }) })
  await page.route("**/app/e2e-harness/storage/inventory?*", async route => { if (after) reads++; await route.continue() })
  await page.goto(entry); await cardReview(page)
  await choose(page, 1, "energy", 2)
  const options = await page.getByRole("combobox", { name: "Destination for cell 1", exact: true }).locator("option").allTextContents()
  expect(options.join()).not.toContain("synthetic-slot-0")
  const h = new Harness(page, insets, true)
  await h.expectWithinSafeViewport(review(page)); await h.expectNoHorizontalOverflow()
  for (const name of ["Cancel", "Confirm scan draft", "Close scan review"]) {
    const button = review(page).getByRole("button", { name, exact: true })
    await h.expectMinTapTarget(button, 36); await h.expectHittable(button)
  }
  await review(page).getByRole("button", { name: "Confirm scan draft" }).click()
  await expect(review(page)).toHaveCount(0)
  await expect.poll(async () => (await record(page))?.receipts.length).toBe(1)
  expect(sends).toBe(1); expect(reads).toBeGreaterThan(0)
  await page.reload()
  await expect(page.locator('[data-slot-id="synthetic-slot-2"]')).toContainText("Synthetic energy")
  expect((await record(page))?.pending.length).toBe(0)
})
test("lost inventory reply survives modal close/reload and retries exact original request", async ({ page }) => {
  const requests: string[] = []
  await page.route("**/app/e2e-harness/storage/inventory", async route => {
    requests.push(route.request().postData()!)
    const response = await route.fetch()
    if (requests.length === 1) await route.abort("failed"); else await route.fulfill({ response })
  })
  await page.goto(entry); await cardReview(page); await choose(page, 1, "trainer", 3)
  await review(page).getByRole("button", { name: "Confirm scan draft" }).click()
  await expect.poll(async () => (await record(page))?.pending[0]?.status).toBe("unavailable")
  await page.reload()
  await expect.poll(async () => (await record(page))?.receipts.length).toBe(1)
  expect(requests).toHaveLength(2); expect(requests[0]).toBe(requests[1])
})
test("repeated species never preselect first destination; cancel creates no intent", async ({ page }) => {
  await page.goto(entry); await cardReview(page)
  await page.getByRole("combobox", { name: "Card for cell 1", exact: true }).selectOption("synthetic-snorlax:en")
  const target = page.getByRole("combobox", { name: "Destination for cell 1", exact: true })
  await expect(target).toHaveValue("")
  await expect(target.locator('option[value="synthetic-slot-0"]')).toHaveCount(1)
  await expect(target.locator('option[value="synthetic-slot-1"]')).toHaveCount(1)
  await choose(page, 1, "snorlax", 1)
  await review(page).getByRole("button", { name: "Cancel", exact: true }).click()
  expect((await record(page))?.pending).toHaveLength(0)
  await cardReview(page); await choose(page, 1, "snorlax", 1)
  await review(page).getByRole("button", { name: "Confirm scan draft" }).click()
  await expect.poll(async () => (await record(page))?.receipts.length).toBe(1)
  await expect(page.locator('[data-slot-id="synthetic-slot-1"]')).toContainText("Synthetic snorlax")
  await expect(page.locator('[data-slot-id="synthetic-slot-0"]')).not.toContainText("Synthetic snorlax")
})
test("cached startup stays read-only and explains reconnect before scanner acceptance", async ({ page, context }) => {
  await page.goto(entry)
  await expect(page.getByRole("button", { name: "Scan card", exact: true })).toBeEnabled()
  await context.setOffline(true)
  await expect(page.getByRole("button", { name: "Scan card", exact: true })).toBeDisabled()
  await expect(page.getByText(/Reconnect and refresh complete storage before scanning/)).toBeVisible()
  expect((await record(page))?.pending).toHaveLength(0)
})
for (const change of ["signout", "account", "owner"] as const) test(`${change} teardown discards unconfirmed review without queue writes`, async ({ page }) => {
  await page.goto(entry); await cardReview(page); await choose(page, 1, "trainer", 3)
  if (change === "owner") await page.route("**/rest/v1/partnerships*", route => route.fulfill({ json: [{ id: "synthetic-membership", owner_user_id: "33333333-3333-4333-8333-333333333333", user1_id: E2E_USER.id, user2_id: "33333333-3333-4333-8333-333333333333" }] }))
  await page.evaluate(({ change, user }) => {
    const channel = new BroadcastChannel("sb-127-auth-token")
    channel.postMessage(change === "signout" ? { event: "SIGNED_OUT", session: null } : { event: change === "account" ? "SIGNED_IN" : "TOKEN_REFRESHED", session: { user: change === "account" ? { ...user, id: "55555555-5555-4555-8555-555555555555" } : user } }); channel.close()
  }, { change, user: E2E_USER })
  await expect(review(page)).toHaveCount(0)
  expect((await record(page))?.pending).toHaveLength(0)
})
async function pageReview(page: Page, deferred = false) {
  await page.getByRole("button", { name: "Scan page", exact: true }).click()
  await page.getByLabel("Page photo", { exact: true }).setInputFiles({ name: "synthetic-page.json", mimeType: "image/png",
    buffer: Buffer.from(JSON.stringify({ deferred, cells: [{ index: 3, row: 1, col: 1, occupied: true }, { index: 0, row: 0, col: 0, occupied: true }] })) })
}
test("inserted free pocket page maps captured IDs and confirms Energy plus trainer atomically", async ({ page }) => {
  const bodies: { commands: { kind: string; destination?: { slot: { id: string } } }[] }[] = []
  await page.route("**/app/e2e-harness/storage/inventory", async route => { bodies.push(route.request().postDataJSON()); await route.continue() })
  await page.goto(`${entry}&scanFixture=1`)
  await page.getByRole("button", { name: "Edit layout", exact: true }).click()
  await page.locator('[data-slot-id="synthetic-slot-0"]').click()
  await page.getByRole("button", { name: "Insert free slot before", exact: true }).click()
  await expect.poll(async () => (await record(page))?.receipts.length).toBe(1)
  await page.getByRole("dialog").getByRole("button", { name: "Done", exact: true }).click()
  const inserted = await page.locator('[data-slot-id]').first().getAttribute("data-slot-id")
  expect(inserted).not.toBe("synthetic-slot-0")
  await pageReview(page)
  await expect(review(page).getByRole("region", { name: "Cell 1", exact: true })).toContainText(inserted!)
  await expect(review(page).getByRole("region", { name: "Cell 4", exact: true })).toContainText("synthetic-slot-2")
  await page.getByRole("combobox", { name: "Card for cell 1", exact: true }).selectOption("synthetic-energy:en")
  await page.getByRole("combobox", { name: "Copy for cell 1", exact: true }).selectOption("raw")
  await page.getByRole("combobox", { name: "Destination for cell 1", exact: true }).selectOption(inserted!)
  await choose(page, 4, "trainer", 2)
  expect(bodies).toHaveLength(0)
  await review(page).getByRole("button", { name: "Confirm scan draft" }).click()
  await expect.poll(async () => (await record(page))?.receipts.length).toBe(2)
  expect(bodies).toHaveLength(1)
  expect(bodies[0].commands.map(c => c.kind)).toEqual(["assign", "assign"])
  expect(bodies[0].commands.map(c => c.destination!.slot.id)).toEqual([inserted, "synthetic-slot-2"])
  await expect(page.locator('[data-slot-id="synthetic-slot-0"]')).not.toContainText("Synthetic energy")
})
for (const change of ["layout", "grid"] as const) test(`${change} changes during actual capture require new explicit review`, async ({ page }) => {
  let changed = false
  await page.route("**/app/e2e-harness/storage/inventory?*", async route => {
    const response = await route.fetch(), body = await response.json()
    if (changed) {
      const binder = body.snapshot.binders[0]
      binder.layoutRevision++
      if (change === "layout") binder.slots.reverse()
      body.navigation.layouts[0].layoutRevision = binder.layoutRevision
      if (change === "grid") { body.navigation.layouts[0].rows = 1; body.navigation.layouts[0].cols = 4 }
      body.evidence.storage[0].layoutRevision = binder.layoutRevision
    }
    await route.fulfill({ response, json: body })
  })
  await page.goto(`${entry}&scanFixture=1`); await pageReview(page, true)
  await expect(page.getByText("Reading page… No results saved.")).toBeVisible()
  changed = true
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")))
  await expect.poll(async () => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(yes => { const r = indexedDB.open("binderdex-offline"); r.onsuccess = () => yes(r.result) })
    const rows = await new Promise<{ snapshot?: { binders: { layoutRevision: number }[] } }[]>(yes => { const r = db.transaction("records").objectStore("records").getAll(); r.onsuccess = () => yes(r.result) }); db.close()
    return rows.find(r => r.snapshot)?.snapshot?.binders[0].layoutRevision
  })).toBe(5)
  await page.evaluate(() => window.dispatchEvent(new Event("synthetic-host-scan-release")))
  await expect(review(page).getByText(/layout or grid changed/)).toBeVisible()
  await expect(review(page).getByRole("button", { name: "Confirm scan draft" })).toBeDisabled()
  expect((await record(page))?.pending).toHaveLength(0)
})
test("unknown and ambiguous capture never infer ownership; explicit page cancel saves nothing", async ({ page }) => {
  await page.goto(`${entry}&scanFixture=1`); await pageReview(page)
  await expect(review(page).getByRole("button", { name: "Confirm scan draft" })).toBeDisabled()
  for (const cell of [1, 4]) await expect(page.getByRole("combobox", { name: `Card for cell ${cell}`, exact: true })).toHaveValue("")
  await choose(page, 1, "energy", 2)
  await expect(review(page).getByRole("button", { name: "Confirm scan draft" })).toBeDisabled()
  await review(page).getByRole("button", { name: "Cancel", exact: true }).click()
  expect((await record(page))?.pending).toHaveLength(0)
})
test("unknown catalog capture stays unresolved without guesses", async ({ page }) => {
  await page.route("**/app/e2e-harness/storage/inventory?*", async route => { const response = await route.fetch(), body = await response.json(); body.navigation.catalog = []; await route.fulfill({ response, json: body }) })
  await page.goto(entry); await cardReview(page)
  await expect(review(page).getByText(/Unidentified content/)).toBeVisible()
  await expect(review(page).getByRole("button", { name: "Confirm scan draft" })).toBeDisabled()
  await review(page).getByRole("button", { name: "Cancel", exact: true }).click()
  expect((await record(page))?.pending).toHaveLength(0)
})
test("actual host ambiguous OCR requires explicit catalog and destination review", async ({ page }) => {
  await page.route("**/app/api/tcg-card-search**", route => route.fulfill({ json: { cards: ["trainer", "energy"].map(kind => ({
    id: `synthetic-${kind}`, name: `Synthetic ${kind}`, localId: "1", language: "en", dexIds: [], set: { id: "synthetic", name: "Synthetic scanner set" },
  })) } }))
  await page.goto(entry); await page.getByRole("button", { name: "Scan card", exact: true }).click()
  await expect(page.getByRole("button", { name: "Read card", exact: true })).toBeEnabled()
  await page.getByRole("button", { name: "Read card", exact: true }).click()
  await expect(review(page)).toBeVisible()
  await expect(page.getByRole("combobox", { name: "Card for cell 1", exact: true })).toHaveValue("")
  await expect(review(page).getByRole("button", { name: "Confirm scan draft" })).toBeDisabled()
  await review(page).getByRole("button", { name: "Cancel", exact: true }).click()
  expect((await record(page))?.pending).toHaveLength(0)
})
for (const stage of ["page", "card", "review"] as const) test(`actual host ${stage} uses safe bounds and every shared dismissal`, async ({ page, insets }) => {
  await page.goto(`${entry}&scanFixture=1`)
  const h = new Harness(page, insets, true)
  const open = async () => {
    if (stage === "review") await cardReview(page)
    else await page.getByRole("button", { name: stage === "page" ? "Scan page" : "Scan card", exact: true }).click()
    return page.getByRole("dialog", { name: stage === "page" ? "Scan stable page" : stage === "card" ? "Scan a card" : "Review scan destinations", exact: true })
  }
  for (const dismissal of ["close", "escape", "back", "backdrop", "swipe", "dock"]) {
    const dialog = await open()
    await h.expectWithinSafeViewport(dialog); await h.expectNoHorizontalOverflow()
    const close = dialog.getByRole("button", { name: stage === "page" ? "Close page scanner" : stage === "card" ? "Close scanner" : "Close scan review", exact: true })
    await h.expectMinTapTarget(close, 36); await h.expectHittable(close)
    if (dismissal === "close") {
      console.log("native host scanner bounds", test.info().project.name, stage, JSON.stringify(await dialog.boundingBox()))
      await close.click()
    }
    if (dismissal === "escape") await page.keyboard.press("Escape")
    if (dismissal === "back") await page.goBack()
    if (dismissal === "backdrop") await h.tapBackdrop(dialog)
    if (dismissal === "swipe") await h.swipeDown(dialog)
    if (dismissal === "dock") await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Inventory", exact: true }).click()
    await expect(dialog).toHaveCount(0); await h.expectScrollUnlocked()
  }
  expect((await record(page))?.pending).toHaveLength(0)
})
test("real IDB abort shows no acceptance and retry persists the same confirmed request", async ({ page }) => {
  let sent = ""
  await page.route("**/app/e2e-harness/storage/inventory", async route => { sent = route.request().postData()!; await route.continue() })
  await page.goto(entry); await cardReview(page); await choose(page, 1, "energy", 2)
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put
    let aborted = false
    IDBObjectStore.prototype.put = function(value, key) {
      const request = key === undefined ? original.call(this, value) : original.call(this, value, key)
      if (value?.pending?.[0]?.intent && !aborted) {
        aborted = true
        sessionStorage.setItem("synthetic-aborted-scan-request", JSON.stringify(value.pending[0].intent.request))
        this.transaction.abort()
      }
      return request
    }
  })
  await review(page).getByRole("button", { name: "Confirm scan draft" }).click()
  const retry = review(page).getByRole("button", { name: "Retry same draft", exact: true })
  await expect(retry).toBeVisible()
  expect((await record(page))?.pending).toHaveLength(0); expect(sent).toBe("")
  const original = await page.evaluate(() => sessionStorage.getItem("synthetic-aborted-scan-request"))
  await retry.click()
  await expect(review(page)).toHaveCount(0)
  await expect.poll(async () => (await record(page))?.receipts.length).toBe(1)
  expect(JSON.parse(sent)).toEqual(JSON.parse(original!))
})
test("duplicate page copies keep distinct IDs through lost reply and exact durable retry", async ({ page }) => {
  const requests: { operationId: string; commands: { kind: string; itemId?: string; selection?: { inventoryItemId: string } }[] }[] = []
  await page.route("**/app/e2e-harness/storage/inventory", async route => {
    requests.push(route.request().postDataJSON())
    const response = await route.fetch()
    if (requests.length === 1) await route.abort("failed"); else await route.fulfill({ response })
  })
  await page.goto(`${entry}&scanFixture=1`); await pageReview(page)
  await choose(page, 1, "snorlax", 0); await choose(page, 4, "snorlax", 1)
  await review(page).getByRole("button", { name: "Confirm scan draft" }).click()
  await expect.poll(async () => (await record(page))?.pending[0]?.status).toBe("unavailable")
  const original = (await record(page))?.pending[0].intent.request
  await page.reload()
  await expect.poll(async () => (await record(page))?.receipts.length).toBe(1)
  expect(requests).toHaveLength(2); expect(requests[0]).toEqual(requests[1]); expect(requests[0]).toEqual(original)
  expect(requests[0].commands.map(c => c.kind)).toEqual(["assign", "add", "assign"])
  const copies = requests[0].commands.filter(c => c.kind === "assign").map(c => c.selection!.inventoryItemId)
  expect(new Set(copies).size).toBe(2)
  expect(copies[0]).toBe("synthetic-copy-snorlax")
  expect(copies[1]).toBe(requests[0].commands[1].itemId)
  for (const slot of [0, 1]) await expect(page.locator(`[data-slot-id="synthetic-slot-${slot}"]`)).toContainText("Synthetic snorlax")
})
test("empty native page explains unsupported append before capture", async ({ page }) => {
  await page.route("**/app/e2e-harness/storage/inventory?*", async route => {
    const response = await route.fetch(), body = await response.json()
    body.snapshot.binders[0].slots = []; body.evidence.slots = 0; body.evidence.storage[0].slotCount = 0
    await route.fulfill({ response, json: body })
  })
  await page.goto(entry)
  await expect(page.getByRole("button", { name: "Scan page", exact: true })).toBeDisabled()
  await expect(page.getByText("Add free slots in Edit layout before scanning. Append and assign from a scan is unavailable.")).toBeVisible()
  expect((await record(page))?.pending).toHaveLength(0)
})
