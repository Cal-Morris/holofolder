import { test, expect, mockBackends, emulateStandalone, Harness } from "./fixtures"
import type { Page } from "@playwright/test"

// Synthetic RPC/auth transport. Actual BinderApp, HTTP bridge, complete reads and IndexedDB.
const entry = "/app/e2e-harness?signedIn=1&browserHost=1&binder=22222222-2222-4222-8222-222222222222"
type Intent = { kind: string; request: { operationId: string; collectionId: string; slotIds: string[]; manifest: { entries: { target: unknown }[] } }; context: unknown }
async function record(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((yes, no) => { const r = indexedDB.open("binderdex-offline"); r.onsuccess = () => yes(r.result); r.onerror = () => no(r.error) })
    const rows = await new Promise<unknown[]>((yes, no) => { const r = db.transaction("records").objectStore("records").getAll(); r.onsuccess = () => yes(r.result); r.onerror = () => no(r.error) })
    db.close()
    return rows.find(v => !!v && typeof v === "object" && "pending" in v) as { pending: { status: string; intent: Intent }[]; receipts: { operationId: string; intent: Intent }[]; snapshot: { collections: { id: string; name: string }[]; binders: { collectionId: string; slots: { target: unknown; inventoryItemId: string | null; wantedCards: unknown[] }[] }[]; items: unknown[] } } | undefined
  })
}
async function open(page: Page, mode = "blank", name = "Synthetic copied binder") {
  await page.getByRole("button", { name: "New binder", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "New binder", exact: true })
  await dialog.getByRole("textbox", { name: "New binder name" }).fill(name)
  await dialog.getByRole("combobox", { name: "Starting arrangement" }).selectOption(mode)
  return dialog
}
async function confirm(page: Page) {
  await page.getByRole("button", { name: "Review binder", exact: true }).click()
  await page.getByRole("button", { name: "Confirm create binder", exact: true }).click()
}
test.beforeEach(async ({ page, context, standalone, insets, baseURL }) => {
  if (standalone) await emulateStandalone(page, insets)
  await mockBackends(page, context, { signedIn: true, baseURL })
  await context.addCookies([{ name: "hf-storage-fixture", value: `creation-${crypto.randomUUID()}`, url: baseURL! }])
})
for (const [mode, count] of [["blank", 0], ["national", 1025], ["generation", 151], ["species", 2]] as const) test(`actual host creates ${mode} with ${count} exact copied targets and no ownership`, async ({ page, insets }) => {
  let legacy = 0
  await page.route("**/app/api/binders", async route => { if (route.request().method() !== "GET") legacy++; await route.continue() })
  await page.goto(entry)
  const dialog = await open(page, mode)
  if (mode === "species") {
    await dialog.getByRole("textbox", { name: "Find species" }).fill("Snorlax")
    await dialog.getByRole("button", { name: "Snorlax", exact: true }).click()
    await dialog.getByRole("textbox", { name: "Find species" }).fill("Pikachu")
    await dialog.getByRole("button", { name: "Pikachu", exact: true }).click()
  }
  await expect(dialog.getByLabel("Target preview")).toContainText(`${count} targets`)
  const h = new Harness(page, insets, true)
  await h.expectMinTapTarget(dialog.getByRole("button", { name: "Review binder", exact: true }))
  await h.expectWithinSafeViewport(dialog); await h.expectNoHorizontalOverflow()
  if (mode === "blank") await test.info().attach("creation-layout.json", { contentType: "application/json", body: JSON.stringify({ viewport: page.viewportSize(), insets, sheet: await dialog.boundingBox(), opener: await page.getByRole("button", { name: "New binder", exact: true }).boundingBox(), dock: await h.dock().boundingBox() }) })
  expect(await dialog.getByRole("combobox", { name: "Starting arrangement" }).locator('option[value="set"]').isDisabled()).toBe(true)
  if (mode === "blank") {
    await dialog.getByRole("textbox", { name: "New binder name" }).focus(); await page.keyboard.press("Enter")
    expect((await record(page))?.pending).toHaveLength(0)
    await page.getByRole("button", { name: "Confirm create binder", exact: true }).click()
  } else await confirm(page)
  await expect.poll(async () => (await record(page))?.receipts.length).toBe(1)
  const r = (await record(page))!, id = r.receipts[0].intent.request.collectionId
  expect(r.snapshot.collections.find(c => c.id === id)?.name).toBe("Synthetic copied binder")
  expect(r.snapshot.binders.find(b => b.collectionId === id)?.slots).toHaveLength(count)
  expect(r.snapshot.binders.find(b => b.collectionId === id)?.slots.every(s => s.inventoryItemId === null && s.wantedCards.length === 0)).toBe(true)
  expect(r.snapshot.items).toHaveLength(0); expect(legacy).toBe(0)
  await expect(page.getByRole("combobox", { name: "Collection", exact: true })).toHaveValue(id)
  await page.reload()
  await expect(page.getByRole("combobox", { name: "Collection", exact: true })).toHaveValue(id)
})
test("creation device acceptance is pending, lost reply/reload exactly replays and fresh read ACKs", async ({ page }) => {
  const bodies: string[] = []
  let lost = true, fresh = false
  await page.route("**/app/e2e-harness/storage/creation", async route => {
    bodies.push(route.request().postData()!); const response = await route.fetch()
    if (lost) { lost = false; await route.abort("failed") } else { fresh = true; await route.fulfill({ response }) }
  })
  await page.goto(entry); await open(page); await confirm(page)
  await expect.poll(async () => (await record(page))?.pending[0]?.status).toBe("unavailable")
  expect((await record(page))?.snapshot.collections).toHaveLength(1)
  await expect(page.getByRole("dialog", { name: "New binder", exact: true })).toContainText("Creation pending sync")
  await page.reload()
  await expect.poll(async () => (await record(page))?.receipts.length).toBe(1)
  expect(bodies).toHaveLength(2); expect(bodies[0]).toBe(bodies[1]); expect(fresh).toBe(true)
  // Reload owns navigation, an old creation cannot redirect the new document.
  await expect(page.getByRole("combobox", { name: "Collection", exact: true })).toHaveValue("22222222-2222-4222-8222-222222222222")
})
for (const status of [402, 403, 409]) test(`creation ${status} retains intent and fences new work without discard/rebase`, async ({ page }) => {
  await page.route("**/app/e2e-harness/storage/creation", route => route.fulfill({ status, json: { error: { code: "synthetic-denial", message: "Synthetic", requestId: "synthetic" } } }))
  await page.goto(entry); await open(page); await confirm(page)
  await expect.poll(async () => (await record(page))?.pending[0]?.status).toBe(status === 402 ? "billing" : status === 403 ? "blocked" : "unavailable")
  await page.getByRole("button", { name: "Close new binder", exact: true }).click()
  await expect(page.getByRole("button", { name: "New binder", exact: true })).toBeDisabled()
  await expect(page.getByRole("button", { name: "Use current storage", exact: true })).toHaveCount(0)
  expect((await record(page))?.receipts).toHaveLength(0)
})
test("cached startup is read-only, overlay dismissals keep dock and keyboard usable", async ({ page, insets }) => {
  await page.goto(entry)
  const dialog = await open(page)
  const h = new Harness(page, insets, true)
  await h.expectHittable(dialog.getByRole("button", { name: "Close new binder", exact: true }))
  await page.keyboard.press("Escape")
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole("button", { name: "New binder", exact: true })).toBeFocused()
  await open(page); await page.goBack(); await expect(dialog).toHaveCount(0)
  await open(page); await h.tapBackdrop(dialog); await expect(dialog).toHaveCount(0)
  await open(page); await h.swipeDown(dialog); await expect(dialog).toHaveCount(0)
  await open(page); await page.getByRole("button", { name: "Inventory", exact: true }).click(); await expect(dialog).toHaveCount(0)
  await page.route("**/app/e2e-harness/storage/inventory?*", route => route.abort("failed"))
  await page.reload()
  await expect(page.getByRole("button", { name: "New binder", exact: true })).toBeDisabled()
  await h.expectNoHorizontalOverflow()
})

test("selected catalog printings persist in order, repeat targets are independent and unknown evidence is disabled", async ({ page }) => {
  const { syntheticSlotPickerSnapshot } = await import("../tests/fixtures/slot-picker")
  const cards = syntheticSlotPickerSnapshot().cards
  await page.route("**/app/api/tcg-card-search**", route => route.fulfill({ json: { cards: [cards[1], cards[0], { ...cards[0], id: "synthetic-no-language", name: "Synthetic unknown language", language: undefined }] } }))
  await page.goto(entry)
  const dialog = await open(page, "printings")
  await dialog.getByRole("textbox", { name: "Find catalog printings" }).fill("Synthetic")
  await expect(dialog.getByRole("button", { name: /^Synthetic unknown language/ })).toBeDisabled()
  const buttons = dialog.getByLabel("Printing results").getByRole("button")
  await buttons.nth(0).click(); await buttons.nth(1).click(); await buttons.nth(1).click()
  await expect(dialog.getByLabel("Target preview")).toContainText("3 targets")
  await confirm(page)
  await expect.poll(async () => (await record(page))?.receipts.length).toBe(1)
  const r = (await record(page))!, request = r.receipts[0].intent.request
  expect(request.manifest.entries.map(e => e.target)).toEqual([cards[1], cards[0], cards[0]].map(c => ({ kind: "card", cardId: c.id, language: "en" })))
  expect(new Set(request.slotIds).size).toBe(3); expect(r.snapshot.items).toHaveLength(0)
})
test("IDB transaction abort retries original IDs/time before first durable handoff", async ({ page }) => {
  await page.goto(entry); await open(page, "generation")
  await page.getByRole("button", { name: "Review binder", exact: true }).click()
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put
    const attempts: unknown[] = []
    Object.assign(window, { syntheticCreationAttempts: attempts })
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === "records" && value?.pending?.[0]?.intent?.kind === "creation") {
        attempts.push(structuredClone(value.pending[0].intent))
        if (attempts.length === 1) throw new Error("synthetic IDB transaction abort")
      }
      return put.call(this, value, key)
    }
  })
  await page.getByRole("button", { name: "Confirm create binder", exact: true }).click()
  await expect(page.getByRole("dialog", { name: "New binder", exact: true })).toContainText("Retry this same creation")
  expect((await record(page))?.pending).toHaveLength(0)
  await page.getByRole("button", { name: "Retry saving creation", exact: true }).click()
  await expect.poll(async () => (await record(page))?.receipts.length).toBe(1)
  const attempts = await page.evaluate(() => (window as unknown as { syntheticCreationAttempts: Intent[] }).syntheticCreationAttempts)
  expect(attempts.length).toBeGreaterThanOrEqual(2); expect(attempts[0]).toEqual(attempts[1])
})
test("later user navigation wins while accepted creation waits for fresh complete read", async ({ page }) => {
  let release!: () => void, replied!: () => void
  const barrier = new Promise<void>(yes => { release = yes }), sent = new Promise<void>(yes => { replied = yes })
  await page.route("**/app/e2e-harness/storage/creation", async route => {
    const response = await route.fetch(); replied(); await barrier; await route.fulfill({ response })
  })
  await page.goto(entry); await open(page); await confirm(page); await sent
  await page.getByRole("button", { name: "Close new binder", exact: true }).click()
  await page.getByRole("button", { name: "National Dex", exact: true }).click()
  release()
  await expect.poll(async () => (await record(page))?.receipts.length).toBe(1)
  await expect(page.getByRole("combobox", { name: "Collection", exact: true })).toHaveValue("22222222-2222-4222-8222-222222222222")
  expect(new URL(page.url()).searchParams.get("view")).toBe("dex")
})

test("matching historical receipt cannot ACK an old complete read", async ({ page }) => {
  let original: unknown, sent = false, stale = true
  await page.route("**/app/e2e-harness/storage/inventory?*", async route => {
    const response = await route.fetch(), body = await response.json()
    if (!original) original = body
    const old = original as { snapshot: unknown; evidence: unknown; navigation: unknown }
    await route.fulfill({ response, json: sent && stale ? { ...body, snapshot: old.snapshot, evidence: old.evidence, navigation: old.navigation } : body })
  })
  await page.route("**/app/e2e-harness/storage/creation", async route => { sent = true; await route.continue() })
  await page.goto(entry); await open(page); await confirm(page)
  await expect.poll(async () => (await record(page))?.pending[0]?.status).toBe("unavailable")
  expect((await record(page))?.receipts).toHaveLength(0)
  expect((await record(page))?.snapshot.collections).toHaveLength(1)
  stale = false
  await page.getByRole("button", { name: "Close new binder", exact: true }).click()
  await page.getByRole("button", { name: "Retry pending sync", exact: true }).click()
  await expect.poll(async () => (await record(page))?.receipts.length).toBe(1)
})
test("auth teardown during creation retains sending lease and rejects the late response", async ({ page }) => {
  let release!: () => void, started!: () => void
  const barrier = new Promise<void>(yes => { release = yes }), sending = new Promise<void>(yes => { started = yes })
  await page.route("**/app/e2e-harness/storage/creation", async route => {
    const response = await route.fetch(); started(); await barrier; await route.fulfill({ response }).catch(() => {})
  })
  await page.goto(entry); await open(page); await confirm(page); await sending
  await page.evaluate(() => {
    const channel = new BroadcastChannel("sb-127-auth-token")
    channel.postMessage({ event: "SIGNED_OUT", session: null }); channel.close()
  })
  await expect(page.getByRole("button", { name: "New binder", exact: true })).toHaveCount(0)
  release()
  await expect.poll(async () => (await record(page))?.pending[0]?.status).toBe("sending")
  expect((await record(page))?.receipts).toHaveLength(0)
})

test("current free allowance blocks confirmation without a legacy request", async ({ page }) => {
  await page.route("**/app/api/billing", route => route.fulfill({ json: { access: { ownerUserId: "00000000-0000-4000-8000-0000000000e2", tier: "free", source: "free", paidThrough: null, savedCardCount: 0, freeCardLimit: 100, freeBinderLimit: 1, enforced: true }, canManage: true } }))
  await page.goto(entry)
  await page.getByRole("button", { name: "New binder", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "New binder", exact: true })
  await expect(dialog).toContainText("Your collection allowance is full")
  await dialog.getByRole("textbox", { name: "New binder name" }).fill("No bypass")
  await expect(dialog.getByRole("button", { name: "Review binder", exact: true })).toBeDisabled()
  expect((await record(page))?.pending).toHaveLength(0)
})

for (const discarded of [false, true]) test(`native creation respects ${discarded ? "explicit discarded" : "unresolved"} recovery in actual IDB`, async ({ page }) => {
  await page.goto(entry)
  await expect(page.getByRole("button", { name: "New binder", exact: true })).toBeEnabled()
  await page.evaluate(async discarded => {
    const db = await new Promise<IDBDatabase>((yes, no) => { const r = indexedDB.open("binderdex-offline"); r.onsuccess = () => yes(r.result); r.onerror = () => no(r.error) })
    await new Promise<void>((yes, no) => {
      const tx = db.transaction("records", "readwrite"), store = tx.objectStore("records"), all = store.openCursor()
      all.onsuccess = () => {
        const cursor = all.result
        if (!cursor) return
        const r = cursor.value
        if (r?.pending && r?.scope) {
          r.recovery = [{ intent: { operation: "recovery.apply", request: { eventId: "101", restoreUnassignedItemIds: [], planVersion: 1, planToken: "a".repeat(64), operationId: "synthetic-retained-recovery", confirmed: true },
            context: { source: "app", clientId: r.scope.deviceId, clientOccurredAt: "2026-11-10T12:00:00Z" } }, receipt: null, synchronized: false, lease: null,
            ...(discarded ? { rejection: { outcome: "rejected", operationId: "synthetic-retained-recovery", code: "recovery_plan_conflict", inventoryRevision: r.snapshot.inventoryRevision }, resolution: "discarded" } : {}) }]
          cursor.update(r)
        }
        cursor.continue()
      }
      tx.oncomplete = () => yes(); tx.onerror = tx.onabort = () => no(tx.error)
    })
    db.close()
    const channel = new BroadcastChannel("binderdex-slot-intent-v1"); channel.postMessage("changed"); channel.close()
  }, discarded)
  const button = page.getByRole("button", { name: "New binder", exact: true })
  if (discarded) {
    await expect(button).toBeEnabled()
    await open(page); await confirm(page)
    await expect.poll(async () => (await record(page))?.receipts.length).toBe(1)
  } else {
    await expect(button).toBeDisabled()
    await expect(page.getByRole("button", { name: "Edit layout", exact: true })).toHaveCount(0)
  }
})

test("two binders from the same preset source retain independent copied species targets and IDs", async ({ page }) => {
  await page.goto(entry)
  const ids: string[] = []
  for (const [index, species] of ["Snorlax", "Pikachu"].entries()) {
    const dialog = await open(page, "species", `Synthetic copy ${index + 1}`)
    await dialog.getByRole("textbox", { name: "Find species" }).fill(species)
    await dialog.getByRole("button", { name: species, exact: true }).click()
    await confirm(page)
    await expect.poll(async () => (await record(page))?.receipts.length).toBe(index + 1)
    const receipt = (await record(page))!.receipts[index]
    ids.push(receipt.intent.request.collectionId)
    await expect(page.getByRole("combobox", { name: "Collection", exact: true })).toHaveValue(ids[index])
  }
  const r = (await record(page))!, copies = ids.map(id => r.snapshot.binders.find(b => b.collectionId === id)!)
  expect(ids[0]).not.toBe(ids[1])
  expect(copies.map(b => b.slots.map(s => s.target))).toEqual([[{ kind: "pokemon", pokemonId: 143 }], [{ kind: "pokemon", pokemonId: 25 }]])
  expect(r.receipts[0].intent.request.slotIds[0]).not.toBe(r.receipts[1].intent.request.slotIds[0])
  expect(r.snapshot.items).toHaveLength(0)
})
