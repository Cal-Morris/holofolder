import { test, expect, mockBackends, emulateStandalone, Harness, storageAction, closeStorage, openStorage, collectionPicker, viewPicker, chooseCollection, chooseView } from "./fixtures"
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
  await (await storageAction(page, "New storage")).click()
  const dialog = page.getByRole("dialog", { name: "New storage", exact: true })
  await dialog.getByRole("textbox", { name: "Storage name" }).fill(name)
  await dialog.getByRole("combobox", { name: "Starting arrangement" }).selectOption(mode)
  return dialog
}
async function confirm(page: Page) {
  await page.getByRole("button", { name: "Review storage", exact: true }).click()
  await page.getByRole("button", { name: "Confirm create storage", exact: true }).click()
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
  await h.expectMinTapTarget(dialog.getByRole("button", { name: "Review storage", exact: true }))
  await h.expectWithinSafeViewport(dialog); await h.expectNoHorizontalOverflow()
  if (mode === "blank") await test.info().attach("creation-layout.json", { contentType: "application/json", body: JSON.stringify({ viewport: page.viewportSize(), insets, sheet: await dialog.boundingBox(), opener: await page.getByRole("button", { name: "Storage", exact: true }).boundingBox(), dock: await h.dock().boundingBox() }) })
  expect(await dialog.getByRole("combobox", { name: "Starting arrangement" }).locator('option[value="set"]').isDisabled()).toBe(false)
  if (mode === "blank") {
    await dialog.getByRole("textbox", { name: "Storage name" }).focus(); await page.keyboard.press("Enter")
    expect((await record(page))?.pending).toHaveLength(0)
    await page.getByRole("button", { name: "Confirm create storage", exact: true }).click()
  } else await confirm(page)
  await expect.poll(async () => (await record(page))?.receipts.length).toBe(1)
  const r = (await record(page))!, id = r.receipts[0].intent.request.collectionId
  expect(r.snapshot.collections.find(c => c.id === id)?.name).toBe("Synthetic copied binder")
  expect(r.snapshot.binders.find(b => b.collectionId === id)?.slots).toHaveLength(count)
  expect(r.snapshot.binders.find(b => b.collectionId === id)?.slots.every(s => s.inventoryItemId === null && s.wantedCards.length === 0)).toBe(true)
  expect(r.snapshot.items).toHaveLength(0); expect(legacy).toBe(0)
  await expect(collectionPicker(page)).toHaveAttribute("data-value", id)
  await page.reload()
  await expect(collectionPicker(page)).toHaveAttribute("data-value", id)
})
test("creation device acceptance is pending, lost reply/reload exactly replays and fresh read ACKs", async ({ page }) => {
  const bodies: string[] = []
  let lost = true, fresh = false
  await page.route("**/app/e2e-harness/storage/creation", async route => {
    bodies.push(route.request().postData()!); const response = await route.fetch()
    if (lost) { lost = false; await route.abort("failed") } else { fresh = true; await route.fulfill({ response }) }
  })
  await page.goto(entry); const draft = await open(page)
  await draft.getByRole("combobox", { name: "Storage kind" }).selectOption("custom")
  await draft.getByRole("textbox", { name: "Location (optional)" }).fill("Synthetic private shelf")
  await confirm(page)
  await expect.poll(async () => (await record(page))?.pending[0]?.status).toBe("unavailable")
  expect((await record(page))?.snapshot.collections).toHaveLength(1)
  await expect(page.getByRole("dialog", { name: "New storage", exact: true })).toContainText("Creation pending sync")
  await page.reload()
  await expect.poll(async () => (await record(page))?.receipts.length).toBe(1)
  expect(bodies).toHaveLength(2); expect(bodies[0]).toBe(bodies[1]); expect(fresh).toBe(true)
  // Reload owns navigation, an old creation cannot redirect the new document.
  await expect(collectionPicker(page)).toHaveAttribute("data-value", "22222222-2222-4222-8222-222222222222")
})
for (const status of [402, 403, 409]) test(`creation ${status} retains intent and fences new work without discard/rebase`, async ({ page }) => {
  await page.route("**/app/e2e-harness/storage/creation", route => route.fulfill({ status, json: { error: { code: "synthetic-denial", message: "Synthetic", requestId: "synthetic" } } }))
  await page.goto(entry); await open(page); await confirm(page)
  await expect.poll(async () => (await record(page))?.pending[0]?.status).toBe(status === 402 ? "billing" : status === 403 ? "blocked" : "unavailable")
  await page.getByRole("button", { name: "Close new storage", exact: true }).click()
  await expect(await storageAction(page, "New storage")).toBeDisabled(); await closeStorage(page)
  await expect(page.getByRole("button", { name: "Use current storage", exact: true })).toHaveCount(0)
  expect((await record(page))?.receipts).toHaveLength(0)
})
test("cached startup is read-only, overlay dismissals keep dock and keyboard usable", async ({ page, insets }) => {
  await page.goto(entry)
  const dialog = await open(page)
  const h = new Harness(page, insets, true)
  await h.expectHittable(dialog.getByRole("button", { name: "Close new storage", exact: true }))
  await page.keyboard.press("Escape")
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Storage", exact: true })).toBeFocused()
  await open(page); await page.goBack(); await expect(dialog).toHaveCount(0)
  await open(page); await h.tapBackdrop(dialog); await expect(dialog).toHaveCount(0)
  await open(page); await h.swipeDown(dialog); await expect(dialog).toHaveCount(0)
  await open(page); await page.getByRole("button", { name: "Inventory", exact: true }).click(); await expect(dialog).toHaveCount(0)
  await page.route("**/app/e2e-harness/storage/inventory?*", route => route.abort("failed"))
  await page.reload()
  await expect(await storageAction(page, "New storage")).toBeDisabled(); await closeStorage(page)
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
  await page.goto(entry); const draft = await open(page, "generation")
  await draft.getByRole("combobox", { name: "Storage kind" }).selectOption("custom")
  await draft.getByRole("textbox", { name: "Location (optional)" }).fill("Synthetic private shelf")
  await page.getByRole("button", { name: "Review storage", exact: true }).click()
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
  await page.getByRole("button", { name: "Confirm create storage", exact: true }).click()
  await expect(page.getByRole("dialog", { name: "New storage", exact: true })).toContainText("Retry this same creation")
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
  await page.getByRole("button", { name: "Close new storage", exact: true }).click()
  await page.getByRole("navigation", { name: "Binder navigation" }).getByRole("button", { name: "More", exact: true }).click()
  await page.getByRole("menuitem", { name: "National Dex", exact: true }).click()
  release()
  await expect.poll(async () => (await record(page))?.receipts.length).toBe(1)
  await expect(collectionPicker(page)).toHaveAttribute("data-value", "22222222-2222-4222-8222-222222222222")
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
  await page.getByRole("button", { name: "Close new storage", exact: true }).click()
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
  await expect(page.getByRole("button", { name: "Storage", exact: true })).toHaveCount(0)
  release()
  await expect.poll(async () => (await record(page))?.pending[0]?.status).toBe("sending")
  expect((await record(page))?.receipts).toHaveLength(0)
})

for (const kind of ["binder", "custom"]) test(`${kind} current free allowance blocks confirmation without a legacy request`, async ({ page }) => {
  await page.route("**/app/api/billing", route => route.fulfill({ json: { access: { ownerUserId: "00000000-0000-4000-8000-0000000000e2", tier: "free", source: "free", paidThrough: null, savedCardCount: 0, freeCardLimit: 100, freeBinderLimit: 1, enforced: true }, canManage: true } }))
  await page.goto(entry)
  await (await storageAction(page, "New storage")).click()
  const dialog = page.getByRole("dialog", { name: "New storage", exact: true })
  await dialog.getByRole("combobox", { name: "Storage kind" }).selectOption(kind)
  await expect(dialog).toContainText("Your collection allowance is full")
  await dialog.getByRole("textbox", { name: "Storage name" }).fill("No bypass")
  await expect(dialog.getByRole("button", { name: "Review storage", exact: true })).toBeDisabled()
  expect((await record(page))?.pending).toHaveLength(0)
})

for (const discarded of [false, true]) test(`native creation respects ${discarded ? "explicit discarded" : "unresolved"} recovery in actual IDB`, async ({ page }) => {
  await page.goto(entry)
  await expect(await storageAction(page, "New storage")).toBeEnabled(); await closeStorage(page)
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
  const button = await storageAction(page, "New storage")
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
    await expect(collectionPicker(page)).toHaveAttribute("data-value", ids[index])
  }
  const r = (await record(page))!, copies = ids.map(id => r.snapshot.binders.find(b => b.collectionId === id)!)
  expect(ids[0]).not.toBe(ids[1])
  expect(copies.map(b => b.slots.map(s => s.target))).toEqual([[{ kind: "pokemon", pokemonId: 143 }], [{ kind: "pokemon", pokemonId: 25 }]])
  expect(r.receipts[0].intent.request.slotIds[0]).not.toBe(r.receipts[1].intent.request.slotIds[0])
  expect(r.snapshot.items).toHaveLength(0)
})

async function rejectionFixture(context: import("@playwright/test").BrowserContext, baseURL: string) {
  await context.addCookies([{ name: "hf-storage-fixture", value: `creation-rejection-${crypto.randomUUID()}`, url: baseURL }])
}
async function terminal(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((yes, no) => { const r = indexedDB.open("binderdex-offline"); r.onsuccess = () => yes(r.result); r.onerror = () => no(r.error) })
    const rows = await new Promise<unknown[]>((yes, no) => { const r = db.transaction("records").objectStore("records").getAll(); r.onsuccess = () => yes(r.result); r.onerror = () => no(r.error) })
    db.close(); return rows.find(r => !!r && typeof r === "object" && "pending" in r && "scope" in r) as unknown as { pending: { intent: Intent; lease: unknown; conflict: { creationProof?: unknown; current?: unknown; rejected: boolean } }[]; creationDiscards?: { intent: Intent; proof: unknown; resolution: string }[]; receipts: unknown[]; snapshot: { inventoryRevision: number; collections: { name: string }[] } }
  })
}
test("093 proof survives historical replay/reload, explicit discard preserves later edit and requires new review/IDs", async ({ page, context, baseURL, insets }) => {
  await rejectionFixture(context, baseURL!)
  const bodies: string[] = [], proofs: unknown[] = []
  let lose = true
  await page.route("**/app/e2e-harness/storage/creation", async route => {
    bodies.push(route.request().postData()!)
    const response = await route.fetch(), body = await response.json()
    if (body.error?.rejection) proofs.push(body.error.rejection)
    if (lose) { lose = false; await route.abort("failed") } else await route.fulfill({ response })
  })
  await page.goto(entry); await open(page, "generation"); await confirm(page)
  await expect.poll(async () => (await record(page))?.pending[0]?.status).toBe("unavailable")
  const original = (await record(page))!.pending[0].intent
  await page.reload()
  const discard = page.getByRole("button", { name: "Discard rejected creation", exact: true })
  await expect(discard).toBeVisible()
  const savedProof = (await terminal(page)).pending[0].conflict.creationProof
  expect(bodies[0]).toBe(bodies[1]); expect(proofs[0]).toEqual(proofs[1])
  await page.reload(); await expect(discard).toBeVisible()
  expect((await terminal(page)).pending[0].conflict.creationProof).toEqual(savedProof)
  await expect(page.getByRole("button", { name: "Rebase saved edit", exact: true })).toHaveCount(0)
  const h = new Harness(page, insets, true)
  await h.expectMinTapTarget(discard); await h.expectWithinSafeViewport(discard); await h.expectNoHorizontalOverflow()
  await discard.click()
  await expect.poll(async () => (await terminal(page)).creationDiscards?.length).toBe(1)
  const discarded = await terminal(page)
  expect(discarded.pending).toHaveLength(0); expect(discarded.receipts).toHaveLength(0)
  expect(discarded.creationDiscards![0]).toEqual({ intent: original, proof: savedProof, resolution: "discarded" })
  expect(discarded.snapshot.collections[0].name).toBe("Synthetic later edit")
  await open(page); await page.getByRole("button", { name: "Review storage", exact: true }).click()
  expect((await record(page))?.pending).toHaveLength(0)
  await page.getByRole("button", { name: "Confirm create storage", exact: true }).click()
  await expect.poll(async () => (await record(page))?.receipts.length).toBe(1)
  const next = (await record(page))!.receipts[0].intent
  expect(next.request.operationId).not.toBe(original.request.operationId)
  expect(next.request.collectionId).not.toBe(original.request.collectionId)
  expect((await terminal(page)).creationDiscards![0].proof).toEqual(savedProof)
})
for (const mutation of ["family", "delivery", "operation", "proof", "auth", "generic"] as const) test(`actual creation rejects ${mutation} spoof without discard`, async ({ page, context, baseURL }) => {
  await rejectionFixture(context, baseURL!)
  await page.route("**/app/e2e-harness/storage/creation", async route => {
    const response = await route.fetch(), body = await response.json(), headers = { ...response.headers() }
    if (mutation === "family") headers["x-storage-family"] = "inventory"
    if (mutation === "delivery") headers["x-storage-delivery"] = "other-delivery"
    if (mutation === "operation") headers["x-storage-operation"] = "other-operation"
    if (mutation === "proof") body.error.rejection.operationId = "other-operation"
    if (mutation === "generic") delete body.error.rejection
    if (mutation === "auth") {
      await page.evaluate(() => { const c = new BroadcastChannel("sb-127-auth-token"); c.postMessage({ event: "SIGNED_OUT", session: null }); c.close() })
      await expect(page.getByRole("button", { name: "Storage", exact: true })).toHaveCount(0)
    }
    await route.fulfill({ response, headers, json: body }).catch(() => {})
  })
  await page.goto(entry); await open(page); await confirm(page)
  if (mutation === "auth") await expect.poll(async () => (await record(page))?.pending[0]?.status).toBe("sending")
  else await expect.poll(async () => (await record(page))?.pending[0]?.status).toBe("unavailable")
  await expect(page.getByRole("button", { name: "Discard rejected creation", exact: true })).toHaveCount(0)
  expect((await terminal(page)).pending[0].conflict?.creationProof).toBeUndefined()
  expect((await record(page))?.receipts).toHaveLength(0)
})
test("creation proof is durable before failed fresh read; IDB discard abort keeps exact proof", async ({ page, context, baseURL }) => {
  await rejectionFixture(context, baseURL!)
  let rejected = false, failRead = true
  await page.route("**/app/e2e-harness/storage/creation", async route => { const response = await route.fetch(); rejected = true; await route.fulfill({ response }) })
  await page.route("**/app/e2e-harness/storage/inventory?*", async route => { if (rejected && failRead) await route.abort("failed"); else await route.continue() })
  await page.goto(entry); await open(page); await confirm(page)
  await page.getByRole("button", { name: "Close new storage", exact: true }).click()
  const discard = page.getByRole("button", { name: "Discard rejected creation", exact: true })
  await expect(discard).toBeVisible()
  const retained = (await terminal(page)).pending[0]
  await discard.click()
  await expect(page.getByRole("status").filter({ hasText: "Could not discard" })).toBeVisible()
  expect((await terminal(page)).pending[0].conflict.creationProof).toEqual(retained.conflict.creationProof)
  failRead = false
  await page.reload(); await expect(discard).toBeVisible()
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function(value, key) {
      if (this.name === "records" && value?.creationDiscards?.length) { IDBObjectStore.prototype.put = put; throw new Error("synthetic discard IDB abort") }
      return put.call(this, value, key)
    }
  })
  await discard.click()
  await expect(page.getByRole("status").filter({ hasText: "Could not discard" })).toBeVisible()
  expect((await terminal(page)).pending[0].intent).toEqual(retained.intent)
  expect((await terminal(page)).creationDiscards).toBeUndefined()
  await discard.click()
  await expect.poll(async () => (await terminal(page)).creationDiscards?.length).toBe(1)
  expect((await terminal(page)).creationDiscards![0].proof).toEqual(retained.conflict.creationProof)
})

for (const race of ["scope", "stale", "lease"] as const) test(`creation discard fences ${race} during separately fresh read`, async ({ page, context, baseURL }) => {
  await rejectionFixture(context, baseURL!)
  let original: { snapshot: unknown; evidence: unknown; navigation: unknown } | undefined, inject = false
  await page.route("**/app/e2e-harness/storage/inventory?*", async route => {
    const response = await route.fetch(), body = await response.json()
    original ??= body
    if (inject) {
      if (race === "scope") body.scope.ownerUserId = "other-owner"
      if (race === "stale") Object.assign(body, { snapshot: original!.snapshot, evidence: original!.evidence, navigation: original!.navigation })
      if (race === "lease") await page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((yes, no) => { const r = indexedDB.open("binderdex-offline"); r.onsuccess = () => yes(r.result); r.onerror = () => no(r.error) })
        await new Promise<void>((yes, no) => {
          const tx = db.transaction("records", "readwrite"), cursor = tx.objectStore("records").openCursor()
          cursor.onsuccess = () => { const c = cursor.result; if (!c) return; const r = c.value; if (r?.pending?.[0]?.intent?.kind === "creation") { r.pending[0].lease = { id: "synthetic-racing-tab", until: 0 }; c.update(r) }; c.continue() }
          tx.oncomplete = () => yes(); tx.onerror = tx.onabort = () => no(tx.error)
        }); db.close()
      })
    }
    await route.fulfill({ response, json: body })
  })
  await page.goto(entry); await open(page); await confirm(page)
  await page.getByRole("button", { name: "Close new storage", exact: true }).click()
  const discard = page.getByRole("button", { name: "Discard rejected creation", exact: true })
  await expect(discard).toBeVisible()
  await expect.poll(async () => !!(await terminal(page)).pending[0].conflict.current).toBe(true)
  const retained = (await terminal(page)).pending[0]
  inject = true; await discard.click()
  await expect(page.getByRole("status").filter({ hasText: "Could not discard" })).toBeVisible()
  expect((await terminal(page)).pending[0].intent).toEqual(retained.intent)
  expect((await terminal(page)).pending[0].conflict.creationProof).toEqual(retained.conflict.creationProof)
  expect((await terminal(page)).creationDiscards).toBeUndefined()
  inject = false; await discard.click()
  await expect.poll(async () => (await terminal(page)).creationDiscards?.length).toBe(1)
})

for (const mode of ["blank", "species"]) test(`custom ${mode} copies targets, private location and List default while presentation stays editable`, async ({ page, insets }) => {
  await page.goto(entry)
  const name = "X".repeat(40), location = "L".repeat(200)
  const dialog = await open(page, mode, name)
  const kind = dialog.getByRole("combobox", { name: "Storage kind" })
  expect(await kind.locator("option").allTextContents()).toEqual(["Binder", "Custom storage"])
  await kind.selectOption("custom")
  await dialog.getByRole("textbox", { name: "Location (optional)" }).fill(location)
  if (mode === "species") {
    await dialog.getByRole("textbox", { name: "Find species" }).fill("Snorlax")
    await dialog.getByRole("button", { name: "Snorlax", exact: true }).click()
  }
  const h = new Harness(page, insets, true), review = dialog.getByRole("button", { name: "Review storage", exact: true })
  await h.expectWithinSafeViewport(dialog); await h.expectNoHorizontalOverflow(); await h.expectMinTapTarget(review)
  await review.scrollIntoViewIfNeeded(); await h.expectHittable(review)
  await review.click()
  await expect(dialog).toContainText("Custom storage · Starts in List")
  await expect(dialog).toContainText(location)
  await dialog.getByRole("button", { name: "Back to preview" }).click()
  await expect(kind).toHaveValue("custom")
  await expect(dialog.getByRole("textbox", { name: "Location (optional)" })).toHaveValue(location)
  await expect(dialog.getByRole("textbox", { name: "Storage name" })).toHaveValue(name)
  await review.click()
  const submit = dialog.getByRole("button", { name: "Confirm create storage", exact: true })
  await h.expectWithinSafeViewport(submit); await h.expectMinTapTarget(submit); await h.expectHittable(submit)
  await h.expectNoHorizontalOverflow()
  await test.info().attach("custom-creation-layout.json", { contentType: "application/json", body: JSON.stringify({ viewport: page.viewportSize(), insets, sheet: await dialog.boundingBox(), confirm: await submit.boundingBox(), dock: await h.dock().boundingBox() }) })
  await submit.click()
  await expect.poll(async () => (await record(page))?.receipts.length).toBe(1)
  const r = (await record(page))!, request = r.receipts[0].intent.request
  expect(request).toMatchObject({ kind: "custom", defaultPresentation: "list", location, name })
  expect(r.snapshot.items).toHaveLength(0)
  expect(r.snapshot.binders.find(b => b.collectionId === request.collectionId)?.slots).toHaveLength(mode === "blank" ? 0 : 1)
  const collection = collectionPicker(page), view = viewPicker(page)
  await expect(collection).toHaveAttribute("data-value", request.collectionId)
  await expect(view).toHaveAttribute("data-value", "list")
  await chooseView(page, "binder"); await expect(view).toHaveAttribute("data-value", "binder")
  await page.reload(); await expect(view).toHaveAttribute("data-value", "binder")
  await chooseView(page, "list"); await page.reload(); await expect(view).toHaveAttribute("data-value", "list")
  expect((await record(page))!.receipts[0].intent).toEqual(r.receipts[0].intent)
})

for (const finishes of [false, true]) test(`set checklist durable ${finishes ? 'verified variants' : 'any finish'} scope survives lost reply, reopen and cached startup`, async ({ page, insets }) => {
  const { syntheticPresetCards, syntheticPresetSet, syntheticPresetPromo } = await import('../tests/fixtures/set-preset')
  await page.route('**/app/api/tcg-set-slots**', route => {
    const url = new URL(route.request().url()), promo = url.searchParams.get('setId') === 'synthetic-promos'
    return route.fulfill({ json: { sets: [syntheticPresetSet], selectedSet: url.searchParams.has('setId') ? promo ? syntheticPresetPromo.set : syntheticPresetSet : null,
      cards: promo ? [syntheticPresetPromo] : syntheticPresetCards, slots: [] } })
  })
  const bodies: string[] = []
  await page.route('**/app/e2e-harness/storage/creation', async route => {
    bodies.push(route.request().postData()!)
    const response = await route.fetch()
    if (bodies.length === 1) await route.abort('failed')
    else await route.fulfill({ response })
  })
  await page.goto(entry)
  const dialog = await open(page, 'set')
  await dialog.getByLabel('Find set preset').fill('synthetic')
  await dialog.getByRole('button', { name: 'Find set', exact: true }).click()
  await dialog.getByRole('button', { name: /Synthetic International/ }).click()
  if (finishes) {
    await dialog.getByRole('button', { name: /^Normal ·/ }).click()
    await dialog.getByRole('button', { name: /^Reverse holo ·/ }).click()
  }
  await dialog.getByText('Optional promos and exclusions', { exact: true }).click()
  await dialog.getByLabel('Promo set ID').fill('synthetic-promos')
  await dialog.getByRole('button', { name: 'Load promos', exact: true }).click()
  await dialog.getByRole('button', { name: /^Add promo/ }).click()
  await dialog.getByRole('button', { name: 'Exclude #2 Synthetic supporter', exact: true }).click()
  const preview = dialog.getByLabel('Copied set scope')
  await expect(preview).toContainText('1 selected promos; 1 exclusions')
  const h = new Harness(page, insets, true)
  await h.expectWithinSafeViewport(dialog); await h.expectNoHorizontalOverflow()
  await h.expectMinTapTarget(dialog.getByRole('button', { name: 'Review storage', exact: true }))
  await confirm(page)
  await expect.poll(async () => (await record(page))?.pending[0]?.status).toBe('unavailable')
  const original = (await record(page))!.pending[0].intent
  const manifest = original.request.manifest as unknown as { setScope: { finishes: string[]; language: string; excludedCardIds: string[]; promoCardIds: string[]; capturedAt: string }; entries: unknown[] }
  expect(manifest.setScope.finishes).toEqual(finishes ? ['normal','reverse_holo'] : [])
  expect(manifest.setScope.language).toBe('en')
  expect(manifest.setScope.excludedCardIds).toEqual(['synthetic-set-2'])
  expect(manifest.setScope.promoCardIds).toEqual(['synthetic-promo-1'])
  await page.reload()
  await expect.poll(async () => (await record(page))?.receipts.length).toBe(1)
  expect(bodies).toHaveLength(2); expect(bodies[0]).toBe(bodies[1])
  const saved = (await record(page))!, id = saved.receipts[0].intent.request.collectionId
  const binder = saved.snapshot.binders.find(b => b.collectionId === id) as unknown as { presetManifest: unknown }
  expect(binder.presetManifest).toEqual(manifest)
  await chooseCollection(page, id)
  await (await openStorage(page)).getByText('Saved checklist scope', { exact: true }).click()
  await expect(page.getByLabel('Copied set scope')).toContainText('1 selected promos; 1 exclusions')
  await expect(page.getByLabel('Copied set scope')).toContainText(manifest.setScope.capturedAt)
  await h.expectNoHorizontalOverflow()
  await page.route('**/app/e2e-harness/storage/inventory?*', route => route.abort('failed'))
  await page.reload()
  await expect(await storageAction(page, 'New storage')).toBeDisabled()
  await (await openStorage(page)).getByText('Saved checklist scope', { exact: true }).click()
  await expect(page.getByLabel('Copied set scope')).toContainText('1 selected promos; 1 exclusions')
  await expect(page.getByLabel('Copied set scope')).toContainText(manifest.setScope.capturedAt)
  expect((await record(page))!.snapshot.items).toHaveLength(0)
  await h.expectNoHorizontalOverflow()
})
