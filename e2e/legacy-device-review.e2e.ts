import { readFileSync } from "node:fs"
import { test, expect } from "./fixtures"

const queueKey = "pokemon_collection_pending_ops_v1"
const actor = "00000000-0000-4000-8000-0000000000e2"
const binder = "e2e00000-0000-4000-8000-000000000001"
const second = "e2e00000-0000-4000-8000-000000000002"
const recipient = { kind: "account", actorUserId: actor, ownerUserId: actor, binderId: binder }
// Synthetic records, including an unknown future protocol, duplicate IDs and wanted printings.
const item = { id: "synthetic", pokemon_id: 25, pokemon_name: "Synthetic Pikachu", card_id: "synthetic-card", card_name: "Synthetic reviewed card", status: "collected", wanted_cards: [], collected_at: "2026-11-10", card_language: "en", card_finish: "normal" }
const record = { id: "historical-id", type: "upsert", pokemonId: 25, item, base: null, queuedAt: "original-time" }

async function seed(page: import("@playwright/test").Page, raw: string) {
  await page.addInitScript(({ queueKey, raw }) => {
    if (!sessionStorage.getItem("legacy-seeded")) { localStorage.setItem(queueKey, raw); sessionStorage.setItem("legacy-seeded", "yes") }
  }, { queueKey, raw })
  await page.goto(`/app/e2e-harness?signedIn=1&binders=1`)
}

test.describe("explicit device review", () => {
  test.use({ signedIn: true })
  for (const source of ["historical", "guest"]) test(`${source} needs explicit binder and acceptance, preserves exact data and uses a new bound action`, async ({ harness }) => {
    const { page } = harness
    const raw = `\n [\n ${JSON.stringify({ ...record, ...(source === "guest" ? { intentProtocol: 1, origin: { kind: "guest", workspaceId: "synthetic-workspace", localBinderId: "guest-default" } } : {}) }, null, 2)}\n ] \n`
    const writes: Record<string, unknown>[] = []
    await page.route("**/app/api/collection/review-destination**", route => {
      const selected = new URL(route.request().url()).searchParams.get("binderId")
      return route.fulfill({ json: { recipient: { ...recipient, binderId: selected }, memberIds: [actor], binders: [{ id: binder, name: "My binder" }, { id: second, name: "Trades" }], ...(selected ? { collection: [] } : {}) } })
    })
    await page.route("**/app/api/collection", async route => {
      const body = route.request().postDataJSON(); writes.push(body)
      return route.fulfill({ json: { item: { ...item, id: "saved-synthetic" } } })
    })
    await seed(page, raw)
    await expect(page.getByRole("region", { name: "Device changes" })).toBeVisible()
    await page.getByRole("button", { name: "Keep on this device", exact: true }).click()
    expect(writes).toHaveLength(0)
    await page.getByRole("button", { name: "Review changes", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "Review device changes" })
    await expect(dialog.getByRole("combobox", { name: "Destination binder" })).toHaveValue("")
    await expect(dialog.getByText(source === "guest" ? /Guest workspace/ : /Older changes, original account unknown/)).toBeVisible()
    await expect(dialog.getByRole("checkbox")).toBeDisabled()
    const [download] = await Promise.all([page.waitForEvent("download"), dialog.getByRole("button", { name: "Download original data" }).click()])
    expect(readFileSync((await download.path())!, "utf8")).toBe(raw)
    await dialog.getByRole("combobox").selectOption(second)
    await expect(dialog.getByRole("checkbox")).toBeEnabled()
    await dialog.getByRole("checkbox").check()
    const add = dialog.getByRole("button", { name: "Add 1 reviewed changes to Trades" })
    await harness.expectMinTapTarget(add, 36)
    await harness.expectWithinSafeViewport(add)
    await harness.expectNoHorizontalOverflow()
    expect(writes).toHaveLength(0)
    await add.click()
    await expect.poll(() => writes.length).toBe(1)
    expect(writes[0].recipient).toEqual({ ...recipient, binderId: second })
    expect(writes[0].operationId).not.toBe(record.id)
    const retained = await page.evaluate(queueKey => JSON.parse(localStorage.getItem(queueKey)!), queueKey)
    expect(retained.find((entry: { legacyQueueSource?: unknown }) => entry.legacyQueueSource).legacyQueueSource.raw).toBe(raw)
    await expect(dialog.getByText(/Original data is retained/)).toBeVisible()
    await dialog.getByRole("button", { name: "Close device changes" }).click()
    await page.reload()
    expect(writes).toHaveLength(1)
  })
  test("reload invalidates choices; cancel and every dismissal preserve evidence without upload", async ({ harness }) => {
    const { page } = harness
    let writes = 0, reads = 0
    await page.route("**/app/api/collection/review-destination**", route => {
      reads++
      const selected = new URL(route.request().url()).searchParams.get("binderId")
      return route.fulfill({ json: { recipient: { ...recipient, binderId: selected }, memberIds: [actor, "synthetic-partner"], binders: [{ id: binder, name: "My binder" }], ...(selected ? { collection: [item] } : {}) } })
    })
    await page.route("**/app/api/collection", route => { writes++; return route.fulfill({ json: { item } }) })
    const raw = JSON.stringify([record, { ...record, id: "unknown-future", pokemonId: 99, future: true }])
    await seed(page, raw)
    await page.getByRole("button", { name: "Review changes", exact: true }).click()
    let dialog = page.getByRole("dialog", { name: "Review device changes" })
    await dialog.getByRole("combobox").selectOption(binder)
    await expect(dialog.getByText(/Everyone with access/)).toBeVisible()
    await expect(dialog.getByText(/Unresolved:/)).toBeVisible()
    await dialog.getByRole("checkbox", { name: "Replace this destination row" }).check()
    await dialog.getByRole("button", { name: "Reload destination" }).click()
    await expect(dialog.getByRole("checkbox")).not.toBeChecked()
    await dialog.getByRole("button", { name: "Cancel upload" }).click()
    await expect(dialog.getByText(/A request already sent may still complete/)).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(dialog).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => !!history.state?.__holofolderOverlay)).toBe(false)
    for (const dismissal of ["back", "backdrop", "swipe", "dock"]) {
      await test.step(`dismiss with ${dismissal}`, async () => {
      await page.getByRole("button", { name: "Review changes", exact: true }).click()
      dialog = page.getByRole("dialog", { name: "Review device changes" })
      await expect(dialog).toBeVisible()
      await expect.poll(() => page.evaluate(() => !!history.state?.__holofolderOverlay)).toBe(true)
      const close = dialog.getByRole("button", { name: "Close device changes" })
      await harness.expectMinTapTarget(close, 36); await harness.expectWithinSafeViewport(close)
      if (dismissal === "back") await page.goBack()
      if (dismissal === "backdrop") await harness.tapBackdrop(dialog)
      if (dismissal === "swipe") await harness.swipeDown(dialog)
      if (dismissal === "dock") await harness.dock().getByRole("button", { name: "Search", exact: true }).click()
      await expect(dialog).toHaveCount(0)
      if (dismissal === "dock") await page.keyboard.press("Escape")
      await expect.poll(() => page.evaluate(() => !!history.state?.__holofolderOverlay)).toBe(false)
      })
    }
    expect(writes).toBe(0); expect(reads).toBeGreaterThan(0)
    expect(await page.evaluate(queueKey => JSON.parse(localStorage.getItem(queueKey)!)[0].legacyQueueSource.raw, queueKey)).toBe(raw)
  })
  test("a lost recovery reply keeps the new request and stops replay after reload", async ({ harness }) => {
    const { page } = harness
    let writes = 0
    await page.route("**/app/api/collection/review-destination**", route => {
      const selected = new URL(route.request().url()).searchParams.get("binderId")
      return route.fulfill({ json: { recipient: { ...recipient, binderId: selected }, memberIds: [actor], binders: [{ id: binder, name: "My binder" }], ...(selected ? { collection: [] } : {}) } })
    })
    await page.route("**/app/api/collection", route => { writes++; return route.fulfill({ status: 200, body: "truncated reply" }) })
    await seed(page, JSON.stringify([record]))
    await page.getByRole("button", { name: "Review changes", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "Review device changes" })
    await dialog.getByRole("combobox").selectOption(binder)
    await dialog.getByRole("checkbox").check()
    await dialog.getByRole("button", { name: "Add 1 reviewed changes to My binder" }).click()
    await expect.poll(() => page.evaluate(queueKey => JSON.parse(localStorage.getItem(queueKey)!).find((entry: { recipientPause?: string }) => entry.recipientPause)?.recipientPause, queueKey)).toBe("delivery_unknown")
    const before = await page.evaluate(queueKey => localStorage.getItem(queueKey), queueKey)
    await dialog.getByRole("button", { name: "Close device changes" }).click()
    await page.reload()
    await page.evaluate(() => window.dispatchEvent(new Event("online")))
    expect(writes).toBe(1)
    expect(await page.evaluate(queueKey => localStorage.getItem(queueKey), queueKey)).toBe(before)
  })
})

async function changeAccount(page: import("@playwright/test").Page, userId = "00000000-0000-4000-8000-0000000000b2") {
  await page.evaluate(userId => {
    const name = document.cookie.split(";").map(value => value.trim().split("=")[0]).find(name => /^sb-.*-auth-token$/.test(name))!
    const encoded = document.cookie.split(";").map(value => value.trim()).find(value => value.startsWith(name + "="))!.slice(name.length + 1)
    const decode = (value: string) => JSON.parse(atob(value.replace(/-/g, "+").replace(/_/g, "/")))
    const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
    const session = decode(encoded.slice("base64-".length))
    session.user = { ...session.user, id: userId }
    const token = session.access_token.split(".")
    token[1] = encode({ ...decode(token[1]), sub: session.user.id })
    session.access_token = token.join(".")
    document.cookie = `${name}=base64-${encode(session)}; path=/; SameSite=Lax`
    const channel = new BroadcastChannel(name)
    channel.postMessage({ event: "SIGNED_IN", session: { ...session, user: { id: userId, aud: "authenticated", role: "authenticated", email: "synthetic-b@example.test", app_metadata: {}, user_metadata: {} } } })
    channel.close()
  }, userId)
}
test.describe("auth changes during legacy work", () => {
  test.use({ signedIn: true })
  for (const returnToA of [false, true]) test(`a stale direct response cannot ACK after A to B${returnToA ? " to A" : ""}`, async ({ harness }) => {
    const { page } = harness
    await page.goto("/app/e2e-harness?signedIn=1&binders=1")
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    let calls = 0
    await page.route("**/app/api/collection", async route => {
      calls++; await held
      await route.fulfill({ json: { item: { ...item, pokemon_id: 4, card_finish: "holo" } } })
    })
    await page.locator('button[data-dex-id="4"]').first().click()
    const detail = page.getByRole("dialog", { name: /details$/i })
    await detail.locator("summary").filter({ hasText: "Card & variant" }).click()
    await detail.getByRole("button", { name: "Holo", exact: true }).click()
    await expect.poll(() => calls).toBe(1)
    const before = await page.evaluate(queueKey => JSON.parse(localStorage.getItem(queueKey)!).find((op: { id?: string }) => op.id), queueKey)
    expect(before.origin).toEqual(recipient)
    await changeAccount(page)
    // Account switching clears the old optimistic edit and establishes a different owner.
    await page.keyboard.press("Escape")
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("pokemon_collection_snapshot_v1") ?? "{}").ownerUserId)).toBe("00000000-0000-4000-8000-0000000000b2")
    if (returnToA) {
      await changeAccount(page, actor)
      await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("pokemon_collection_snapshot_v1") ?? "{}").ownerUserId)).toBe(actor)
    }
    release()
    await expect.poll(() => page.evaluate(queueKey => JSON.parse(localStorage.getItem(queueKey)!).find((op: { id?: string }) => op.id)?.id, queueKey)).toBe(before.id)
    const after = await page.evaluate(queueKey => JSON.parse(localStorage.getItem(queueKey)!).find((op: { id?: string }) => op.id), queueKey)
    expect(after.origin).toEqual(recipient); expect(after.original).toEqual(before.original)
    expect(calls).toBe(1)
    expect(await page.getByRole("region", { name: "Device changes" }).count()).toBe(0)
  })
  test("changing account during final review verification cancels acceptance and preserves the source", async ({ harness }) => {
    const { page } = harness
    let writes = 0, selectedReads = 0, release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    await page.route("**/app/api/collection/review-destination**", async route => {
      const selected = new URL(route.request().url()).searchParams.get("binderId")
      if (selected && ++selectedReads === 2) await held
      return route.fulfill({ json: { recipient: { ...recipient, binderId: selected }, memberIds: [actor], binders: [{ id: binder, name: "My binder" }], ...(selected ? { collection: [] } : {}) } })
    })
    await page.route("**/app/api/collection", route => { writes++; return route.fulfill({ json: { item } }) })
    const raw = JSON.stringify([record])
    await seed(page, raw)
    await page.getByRole("button", { name: "Review changes", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "Review device changes" })
    await dialog.getByRole("combobox").selectOption(binder)
    await dialog.getByRole("checkbox").check()
    await dialog.getByRole("button", { name: "Add 1 reviewed changes to My binder" }).click()
    await expect.poll(() => selectedReads).toBe(2)
    await changeAccount(page)
    await expect(dialog).toHaveCount(0)
    release()
    expect(writes).toBe(0)
    expect(await page.evaluate(queueKey => JSON.parse(localStorage.getItem(queueKey)!)[0].legacyQueueSource.raw, queueKey)).toBe(raw)
    expect(await page.evaluate(queueKey => JSON.parse(localStorage.getItem(queueKey)!).some((op: { recoverySource?: unknown }) => op.recoverySource), queueKey)).toBe(false)
  })
})

test.describe("reviewed batch cancellation", () => {
  test.use({ signedIn: true })
  test("cancel stops remaining rows but cannot undo an in-flight write", async ({ harness }) => {
    const { page } = harness
    let calls = 0, release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    await page.route("**/app/api/collection/review-destination**", route => {
      const selected = new URL(route.request().url()).searchParams.get("binderId")
      return route.fulfill({ json: { recipient: { ...recipient, binderId: selected }, memberIds: [actor], binders: [{ id: binder, name: "My binder" }], ...(selected ? { collection: [] } : {}) } })
    })
    await page.route("**/app/api/collection", async route => { calls++; await held; return route.fulfill({ json: { item } }) })
    await seed(page, JSON.stringify([record, { ...record, id: "second-source", pokemonId: 7, item: { ...item, pokemon_id: 7, pokemon_name: "Synthetic Squirtle" } }]))
    await page.getByRole("button", { name: "Review changes", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "Review device changes" })
    await dialog.getByRole("combobox").selectOption(binder)
    await dialog.getByRole("checkbox").nth(0).check(); await dialog.getByRole("checkbox").nth(1).check()
    await dialog.getByRole("button", { name: "Add 2 reviewed changes to My binder" }).click()
    await expect.poll(() => calls).toBe(1)
    await dialog.getByRole("button", { name: "Cancel upload" }).click()
    await expect(dialog.getByText(/A request already sent may still complete/)).toBeVisible()
    release()
    await expect.poll(() => page.evaluate(queueKey => JSON.parse(localStorage.getItem(queueKey)!).filter((op: { recoverySource?: unknown }) => op.recoverySource).length, queueKey)).toBe(1)
    expect(calls).toBe(1)
    const remaining = await page.evaluate(queueKey => JSON.parse(localStorage.getItem(queueKey)!).find((op: { recoverySource?: unknown }) => op.recoverySource), queueKey)
    expect(remaining.pokemonId).toBe(7); expect(remaining.recipientPause).toBe("cancelled_review_upload")
    await dialog.getByRole("button", { name: "Close device changes" }).click()
    await page.reload(); await page.evaluate(() => window.dispatchEvent(new Event("online")))
    expect(calls).toBe(1)
  })
})

test.describe("review persistence failure", () => {
  test.use({ signedIn: true })
  test("failed acceptance leaves localStorage and the real IndexedDB mirror with original evidence and no replayable copy", async ({ harness }) => {
    const { page } = harness
    let writes = 0
    await page.route("**/app/api/collection/review-destination**", route => {
      const selected = new URL(route.request().url()).searchParams.get("binderId")
      return route.fulfill({ json: { recipient: { ...recipient, binderId: selected }, memberIds: [actor], binders: [{ id: binder, name: "My binder" }], ...(selected ? { collection: [] } : {}) } })
    })
    await page.route("**/app/api/collection", route => { writes++; return route.fulfill({ json: { item } }) })
    const raw = `\n[${JSON.stringify(record)}]\n`
    await seed(page, raw)
    await page.getByRole("button", { name: "Review changes", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "Review device changes" })
    await dialog.getByRole("combobox").selectOption(binder)
    await dialog.getByRole("checkbox").check()
    const before = await page.evaluate(queueKey => localStorage.getItem(queueKey), queueKey)
    const mirror = () => page.evaluate(() => new Promise<unknown[]>(resolve => {
      const open = indexedDB.open("binderdex-offline")
      open.onerror = () => resolve([])
      open.onsuccess = () => {
        const db = open.result
        if (!db.objectStoreNames.contains("records")) { db.close(); resolve([]); return }
        const request = db.transaction("records", "readonly").objectStore("records").get("collection")
        request.onsuccess = () => { db.close(); resolve(request.result?.pendingOperations ?? []) }
        request.onerror = () => { db.close(); resolve([]) }
      }
    }))
    await expect.poll(async () => JSON.stringify(await mirror())).toBe(before)
    await page.evaluate(queueKey => {
      const original = Storage.prototype.setItem
      Storage.prototype.setItem = function (key, value) {
        if (key === queueKey && value.includes('"recoverySource"')) throw new DOMException("Device storage is full", "QuotaExceededError")
        return original.call(this, key, value)
      }
    }, queueKey)
    await dialog.getByRole("button", { name: "Add 1 reviewed changes to My binder" }).click()
    await expect(dialog.getByText("Device storage is full", { exact: true })).toBeVisible()
    expect(writes).toBe(0)
    expect(await page.evaluate(queueKey => localStorage.getItem(queueKey), queueKey)).toBe(before)
    expect(JSON.stringify(await mirror())).toBe(before)
    await dialog.getByRole("button", { name: "Close device changes" }).click()
    await page.reload()
    expect(await page.evaluate(queueKey => JSON.parse(localStorage.getItem(queueKey)!)[0].legacyQueueSource.raw, queueKey)).toBe(raw)
    expect(writes).toBe(0)
  })
})
