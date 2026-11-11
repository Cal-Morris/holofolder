import { test, expect, mockBackends, emulateStandalone, E2E_USER, Harness, collectionPicker, viewPicker, chooseCollection } from "./fixtures"
import { inventoryBrowseFixture, inventoryBrowseCatalog, inventoryBrowseLayouts } from "../tests/fixtures/inventory-browse"

const alpha = "22222222-2222-4222-8222-222222222222"
const trades = "33333333-3333-4333-8333-333333333333"
const slotId = (n: number) => `44444444-4444-4444-8444-${String(n).padStart(12, "0")}`
const storageId = (id: string) => id === "alpha" ? alpha : trades
const layouts = inventoryBrowseLayouts.map(l => ({ ...l, collectionId: storageId(l.collectionId) }))

// Synthetic remote ownership/auth evidence, actual BinderApp, HTTP reconstruction and IndexedDB.
function syntheticSnapshot() {
  const snapshot = inventoryBrowseFixture(5)
  snapshot.ownerUserId = E2E_USER.id
  snapshot.items.forEach(i => { i.ownerUserId = E2E_USER.id })
  snapshot.collections.forEach(c => { c.ownerUserId = E2E_USER.id })
  snapshot.binders.forEach(b => { b.ownerUserId = E2E_USER.id; b.slots.forEach(s => { s.ownerUserId = E2E_USER.id }) })
  const slots = new Map(snapshot.binders.flatMap((b, i) => b.slots.map((s, n) => [s.id, slotId(i * 100 + n)] as const)))
  snapshot.collections.forEach(c => { c.id = storageId(c.id) })
  snapshot.binders.forEach(b => { b.collectionId = storageId(b.collectionId); b.slots.forEach(s => { s.id = slots.get(s.id)!; s.collectionId = b.collectionId }) })
  snapshot.placements.forEach(p => { p.collectionId = storageId(p.collectionId); p.slotId = slots.get(p.slotId)! })
  return snapshot
}
async function fulfillInventory(route: import("@playwright/test").Route, catalog = inventoryBrowseCatalog, snapshot = syntheticSnapshot()) {
    const url = new URL(route.request().url())
    await route.fulfill({ headers: { "Cache-Control": "private, no-store" }, json: { version: 2,
      requestId: url.searchParams.get("requestId"), scope: { actorUserId: E2E_USER.id, ownerUserId: E2E_USER.id,
        authSessionId: "synthetic-e2e-auth-session", sessionId: url.searchParams.get("sessionId") }, snapshot,
      navigation: { catalog, layouts },
      evidence: { inventoryRevision: snapshot.inventoryRevision, items: snapshot.items.length, placements: snapshot.placements.length,
        collections: snapshot.collections.length, binders: snapshot.binders.length, slots: snapshot.binders.reduce((n, b) => n + b.slots.length, 0),
        storage: snapshot.binders.map(b => ({ collectionId: b.collectionId, collectionVersion: 1, layoutRevision: b.layoutRevision, slotCount: b.slots.length })) } } })
}
test.beforeEach(async ({ page, context, standalone, insets, baseURL }) => {
  if (standalone) await emulateStandalone(page, insets)
  await mockBackends(page, context, { signedIn: true, baseURL })
  await page.route("**/app/e2e-harness/storage/inventory?*", route => fulfillInventory(route))
})
const entry = "/app/e2e-harness?signedIn=1&browserHost=1"
// The app opens on the binder; tests that start from Inventory name it in the link.
const inventoryEntry = `${entry}&view=inventory`
const nav = (page: import("@playwright/test").Page) => page.getByRole("navigation", { name: "Main navigation", exact: true })

for (const source of ["Search", "Quick mode"]) test(`actual host ${source} opens the exact set from Binder and restores it with history`, async ({ page, insets }) => {
  // Synthetic catalogue data, deliberately distinct from the recent/default sets.
  const set = { id: "synthetic-search-set", name: "Synthetic Search Set" }
  const card = { id: `${set.id}-1`, localId: "1", name: "Synthetic Bulbasaur", language: "en", set }
  await page.route("**/app/api/tcg-card-search**", route => route.fulfill({ json: { cards: [] } }))
  await page.route("**/app/api/tcg-set-slots**", route => {
    const params = new URL(route.request().url()).searchParams
    return route.fulfill({ json: params.get("setId") === set.id
      ? { sets: [set], selectedSet: set, cards: [card], slots: [{ dexId: 1, pokemonName: "bulbasaur", cards: [card] }] }
      : { sets: params.has("query") ? [set] : [], selectedSet: null, slots: [] } })
  })
  await page.goto(`${entry}&binder=${alpha}&page=2`)
  const collection = collectionPicker(page)
  await expect(collection).toHaveAttribute("data-value", alpha)
  await expect(page.locator(`[data-slot-id="${slotId(9)}"]`)).toBeVisible()
  await nav(page).getByRole("button", { name: "Search", exact: true }).click()
  if (source === "Quick mode") await page.getByRole("button", { name: "Quick mode", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: source === "Search" ? /search pokemon/i : "Quick mode" })
  await dialog.getByRole(source === "Search" ? "textbox" : "searchbox").fill(set.name)
  const hit = dialog.getByRole("button", { name: /^Open set Synthetic Search Set/ })
  const h = new Harness(page, insets, true)
  await h.expectMinTapTarget(hit)
  await hit.click()
  await expect(dialog).toBeHidden()
  const selected = page.getByRole("button", { name: `Remove ${set.name}`, exact: true })
  await expect(selected).toBeVisible()
  await expect(page.getByRole("group", { name: "Set checklist" })).toBeVisible()
  await h.expectNoHorizontalOverflow()
  await page.goBack()
  await expect(collection).toHaveAttribute("data-value", alpha)
  await expect(page.locator(`[data-slot-id="${slotId(9)}"]`)).toBeVisible()
  await page.goForward()
  await expect(selected).toBeVisible()
  await nav(page).getByRole("button", { name: "Binder", exact: true }).click()
  await expect(collection).toHaveAttribute("data-value", alpha)
  await expect(page.locator(`[data-slot-id="${slotId(9)}"]`)).toBeVisible()
})

test("actual BinderApp dock, fresh stable location, back and deep links", async ({ page, insets }) => {
  await page.goto(inventoryEntry)
  await expect(page.getByRole("searchbox", { name: "Search inventory" })).toBeVisible()
  await page.getByRole("searchbox", { name: "Search inventory" }).fill("base set")
  await page.locator('[data-item-id="copy-00001"]').click()
  await page.getByRole("button", { name: "Go to pocket", exact: true }).click()
  await expect(collectionPicker(page)).toHaveAttribute("data-value", alpha)
  await expect(page.locator(`[data-slot-id="${slotId(9)}"]`)).toHaveAttribute("aria-pressed", "true")
  await page.goBack()
  await expect(page.getByRole("searchbox", { name: "Search inventory" })).toHaveValue("base set")
  const h = new Harness(page, insets, true)
  for (const name of ["Search", "Binder", "Inventory", "Wanted", "Browse"]) {
    const button = nav(page).getByRole("button", { name, exact: true })
    await h.expectMinTapTarget(button); await h.expectWithinSafeViewport(button); await h.expectHittable(button)
  }
  await h.expectNoHorizontalOverflow()
  // Settings and Sign out live in the normal header More menu, not in extra rows above the binder.
  const more = page.getByRole("navigation", { name: "Binder navigation" }).getByRole("button", { name: "More", exact: true })
  await h.expectMinTapTarget(more); await h.expectWithinSafeViewport(more); await h.expectHittable(more)
  await more.click()
  await expect(page.getByRole("menuitem", { name: "Sign out", exact: true })).toBeVisible()
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click()
  await expect(page.getByRole("dialog", { name: /Settings/i })).toBeVisible()
  await nav(page).getByRole("button", { name: "Inventory", exact: true }).click()
  await expect(page.getByRole("dialog")).not.toBeVisible()
  await page.goto(`${entry}&binder=${alpha}&slot=${slotId(11)}&view=slabs`)
  await expect(viewPicker(page)).toHaveAttribute("data-value", "binder")
  await expect(page.getByRole("status").filter({ hasText: "Slabs view is not available" })).toBeVisible()
  await expect(page.locator(`[data-slot-id="${slotId(11)}"]`)).toBeVisible()
  await page.getByRole("navigation", { name: "Binder navigation" }).getByRole("button", { name: "More", exact: true }).click()
  await page.getByRole("menuitem", { name: "National Dex", exact: true }).click()
  await expect(nav(page).getByRole("button", { name: "Inventory", exact: true })).toBeVisible()
})

test("an owner with cards in the binder has Show in the header on every view; an empty one keeps it in More", async ({ page, insets }) => {
  await page.goto(`${entry}&binder=${alpha}`)
  await expect(collectionPicker(page)).toBeVisible()
  const header = page.getByTestId("app-header"), show = header.getByRole("button", { name: "Show mode", exact: true })
  const h = new Harness(page, insets, true)
  for (const view of ["Binder", "Inventory", "Wanted", "Browse"]) {
    await nav(page).getByRole("button", { name: view, exact: true }).click()
    // The view remounts on arrival, so wait for the destination before measuring its header.
    await expect(nav(page).getByRole("button", { name: view, exact: true })).toHaveAttribute("aria-pressed", "true")
    await expect(show).toBeVisible()
    await h.expectMinTapTarget(show); await h.expectHittable(show); await h.expectNoHorizontalOverflow()
    const title = header.getByText("Holo Folder", { exact: true })
    expect(await title.evaluate(el => el.scrollWidth <= el.clientWidth), `title fits beside Show on ${view}`).toBe(true)
  }
  // With Show in the header, More does not repeat it. A signed-in owner is never asked to join.
  await header.getByRole("button", { name: "More", exact: true }).click()
  await expect(page.getByRole("menuitem", { name: "Show mode", exact: true })).toHaveCount(0)
  await expect(header.getByRole("button", { name: "Join now", exact: true })).toHaveCount(0)
  await page.keyboard.press("Escape")
  // The same binders with nothing owned: no header pill, and Show mode stays reachable from More.
  const empty = syntheticSnapshot()
  empty.items = []; empty.placements = []
  empty.binders.forEach(binder => binder.slots.forEach(slot => { slot.inventoryItemId = null; slot.status = null }))
  await page.route("**/app/e2e-harness/storage/inventory?*", route => fulfillInventory(route, inventoryBrowseCatalog, empty))
  await page.goto(`${entry}&binder=${alpha}`)
  await expect(collectionPicker(page)).toBeVisible()
  await expect(page.locator("button[data-slot-id]").first()).toBeVisible()
  await expect(show).toHaveCount(0)
  await header.getByRole("button", { name: "More", exact: true }).click()
  await expect(page.getByRole("menuitem", { name: "Show mode", exact: true })).toBeVisible()
})

test("online startup 503 resets once and reports the second failure", async ({ page }) => {
  await page.goto(inventoryEntry)
  await expect(page.getByRole("searchbox", { name: "Search inventory" })).toBeVisible()
  await page.route("**/app/e2e-harness/storage/inventory?*", route => route.fulfill({ status: 503, json: { error: "inventory_operations_staged" } }))
  await page.reload()
  await expect(page.getByRole("alert").filter({ hasText: "Could not open storage:" })).toHaveText("Could not open storage: inventory_operations_staged", { timeout: 20_000 })
  await expect(page.getByRole("searchbox", { name: "Search inventory" })).not.toBeVisible()
  await expect(page.getByRole("button", { name: "Retry opening storage", exact: true })).toBeVisible()
  expect(await page.evaluate(() => sessionStorage.getItem("holofolder-startup-reset-v2"))).toBe("1")
})

test("pending real IDB edits survive Edit layout teardown, view changes and failed refresh", async ({ page }) => {
  // The command never reaches the server, so the edit stays queued on the device for the whole test.
  await page.route("**/app/e2e-harness/storage/**", route => route.request().method() === "GET" ? route.fallback() : route.abort("failed"))
  await page.goto(`${entry}&binder=${alpha}`)
  await expect(collectionPicker(page)).toBeVisible()
  await expect(page.getByRole("button", {name:"Edit layout", exact:true})).toBeVisible()
  await page.getByRole("button", { name: "Edit layout", exact: true }).click()
  await expect(page.getByRole("button", { name: "Done", exact: true })).toBeVisible()
  // Existing real layout command controls, not a harness write to the queue.
  await page.locator(`[data-slot-id="${slotId(0)}"]`).click()
  const layout = page.getByRole("region", { name: "Layout editing", exact: true })
  await layout.getByRole("button", { name: "Add", exact: true }).click()
  await layout.getByRole("menuitem", { name: "Before the selection" }).click()
  await expect(layout.getByRole("alert")).toHaveCount(0)
  await expect(page.locator("[data-sync-state]")).toBeVisible()
  await nav(page).getByRole("button", { name: "Inventory", exact: true }).click()
  await expect(page.getByRole("searchbox", { name: "Search inventory" })).toBeVisible()
  await page.goBack()
  await expect(page.getByRole("button", { name: "Edit layout", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Done", exact: true })).not.toBeVisible()
  await page.route("**/app/e2e-harness/storage/inventory?*", route => route.fulfill({ status: 503, json: { error: "inventory_operations_staged" } }))
  await page.reload()
  // A refused read at startup stops at the storage error page. The edit made before it is still on the device.
  await expect(page.getByRole("alert").filter({ hasText: "Could not open storage:" })).toBeVisible({ timeout: 20_000 })
  const record = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((yes, no) => { const r = ((q) => (q.onupgradeneeded = () => { if (!q.result.objectStoreNames.contains("records")) q.result.createObjectStore("records") }, q))(indexedDB.open("binderdex-offline", 1)); r.onsuccess = () => yes(r.result); r.onerror = () => no(r.error) })
    return new Promise<unknown[]>((yes, no) => { const r = db.transaction("records").objectStore("records").getAll(); r.onsuccess = () => { db.close(); yes(r.result) }; r.onerror = () => no(r.error) })
  })
  const queued = record.filter((entry): entry is { pending: { status: string; intent: { request: { operationId: string } } }[]; optimistic: { binders: { collectionId: string; slots: unknown[] }[] } } =>
    Boolean(entry && typeof entry === "object" && "pending" in entry))
  expect(queued).toHaveLength(1)
  expect(queued[0].pending).toHaveLength(1)
  expect(["pending", "sending", "unavailable"]).toContain(queued[0].pending[0].status)
  expect(queued[0].pending[0].intent.request.operationId).toMatch(/^[a-f0-9-]{36}$/)
  expect(queued[0].optimistic.binders.find(b => b.collectionId === alpha)?.slots).toHaveLength(13)
})

test("in-process offline view changes retain saved copies, List search and layout data", async ({ page, context }) => {
  await page.goto(`${entry}&binder=${alpha}&view=list`)
  await expect(page.getByRole("region", { name: "Collection slots" })).toBeVisible()
  await page.getByRole("searchbox", { name: "Filter collection" }).fill("charizard")
  await context.setOffline(true)
  await nav(page).getByRole("button", { name: "Inventory", exact: true }).click()
  // Offline, Inventory says it is showing the copy saved on this device.
  await expect(page.locator("[data-saved-state]")).toContainText("last saved on this device")
  await page.goBack()
  await expect(page.getByRole("searchbox", { name: "Filter collection" })).toHaveValue("charizard")
  await expect(page.getByRole("region", { name: "Collection slots" }).locator('[data-slot-id]')).toHaveCount(1)
  await context.setOffline(false)
})

test("auth lifecycle closes private detail and rejects an old in-flight location response", async ({ page }) => {
  await page.goto(inventoryEntry)
  await page.locator('[data-item-id="copy-00001"]').click()
  let release!: () => void
  const barrier = new Promise<void>(yes => { release = yes })
  let requested!: () => void
  const started = new Promise<void>(yes => { requested = yes })
  await page.route("**/app/e2e-harness/storage/inventory?*", async route => { requested(); await barrier; await route.fallback() })
  await page.getByRole("button", { name: "Go to pocket", exact: true }).click()
  await started
  await page.evaluate(() => {
    const seen = window as unknown as { closedOnce?: boolean }
    const note = () => { if (document.querySelector('[data-testid="binder-skeleton"]') || /Saved storage is paused/.test(document.body.innerText)) seen.closedOnce = true }
    new MutationObserver(note).observe(document.body, { childList: true, subtree: true })
  })
  await page.evaluate(() => {
    const channel = new BroadcastChannel("sb-127-auth-token")
    channel.postMessage({ event: "SIGNED_OUT", session: null })
    channel.close()
  })
  // The card's details close and the open view is torn down to the loading skeleton (or the paused notice).
  // That frame is short, so it is recorded as it happens instead of being looked for afterwards.
  await expect.poll(() => page.evaluate(() => (window as unknown as { closedOnce?: boolean }).closedOnce)).toBe(true)
  await expect(page.getByRole("dialog")).not.toBeVisible()
  release()
  // While the account is checked again this device's own saved copy may show, then Inventory reopens (or
  // stays paused). The location answer that was in flight when the session ended is dropped: it never
  // opens the pocket it was asked for, and the details stay closed.
  await expect(page.getByRole("searchbox", { name: "Search inventory" }).or(page.getByRole("status").filter({ hasText: "Saved storage is paused" }))).toBeVisible()
  await expect(page.locator("button[data-slot-id]")).toHaveCount(0)
  await expect(page.getByRole("dialog")).not.toBeVisible()
})

test("a same-owner response bound to another session never supplies private rows", async ({ page }) => {
  await page.route("**/app/e2e-harness/storage/inventory?*", async route => {
    await route.fulfill({ headers: { "Cache-Control": "private, no-store" }, json: { version: 2,
      requestId: new URL(route.request().url()).searchParams.get("requestId"), scope: { actorUserId: E2E_USER.id,
        ownerUserId: E2E_USER.id, authSessionId: "obsolete-auth-session", sessionId: "obsolete-device-lifecycle" }, snapshot: syntheticSnapshot() } })
  })
  await page.goto(inventoryEntry)
  await expect(page.getByText("Your cards couldn't be loaded", { exact: true })).toBeVisible()
  await expect(page.getByRole("list", { name: "Owned copies" })).not.toBeVisible()
  await page.getByRole("navigation", { name: "Binder navigation" }).getByRole("button", { name: "More", exact: true }).click()
  await page.getByRole("menuitem", { name: "National Dex", exact: true }).click()
  await expect(page.getByRole("button", { name: /Missing/ }).first()).toBeVisible()
})

test("owner membership changes cannot reuse the prior owner's cached inventory", async ({ page }) => {
  await page.goto(inventoryEntry)
  await expect(page.getByRole("searchbox", { name: "Search inventory" })).toBeVisible()
  await page.getByRole("searchbox", { name: "Search inventory" }).fill("old owner search")
  await page.route("**/rest/v1/partnerships*", route => route.fulfill({ json: [{ id: "synthetic-new-membership", owner_user_id: trades,
    user1_id: E2E_USER.id, user2_id: trades }] }))
  await page.evaluate(user => {
    const channel = new BroadcastChannel("sb-127-auth-token")
    channel.postMessage({ event: "TOKEN_REFRESHED", session: { user } })
    channel.close()
  }, E2E_USER)
  await expect(page.getByRole("list", { name: "Owned copies" })).not.toBeVisible()
  await expect(page.getByText("Your cards couldn't be loaded", { exact: true })).toBeVisible()
  await expect(page.getByRole("searchbox", { name: "Search inventory" })).not.toBeVisible()
})

test("another account cannot restore the previous account's private view", async ({ page }) => {
  await page.goto(inventoryEntry)
  await page.getByRole("searchbox", { name: "Search inventory" }).fill("private previous account")
  await page.evaluate(user => {
    const channel = new BroadcastChannel("sb-127-auth-token")
    channel.postMessage({ event: "SIGNED_IN", session: { user: { ...user, id: "55555555-5555-4555-8555-555555555555" } } })
    channel.close()
  }, E2E_USER)
  // Old cookie claims cannot admit a new actor, regardless of the saved navigation bytes.
  await expect(page.getByRole("list", { name: "Owned copies" })).not.toBeVisible()
  await expect(page.getByRole("searchbox", { name: "Search inventory" })).not.toBeVisible()
  // The private view closes to the loading skeleton, or the paused notice once the check fails.
  await expect(page.getByTestId("binder-skeleton").or(page.getByRole("status").filter({ hasText: "Saved storage is paused" }))).toBeVisible()
})

test("existing Wanted and Browse open under their own titles and survive return", async ({ page }) => {
  await page.goto(inventoryEntry)
  await expect(page.getByRole("searchbox", { name: "Search inventory" })).toBeVisible()
  await nav(page).getByRole("button", { name: "Wanted", exact: true }).click()
  await expect(nav(page).getByRole("button", { name: "Wanted", exact: true })).toHaveAttribute("aria-pressed", "true")
  // The page carries its own title; the row under the header is the binder picker only, with no second label.
  await expect(page.getByRole("heading", { name: "Wanted", exact: true, level: 1 })).toBeVisible()
  await expect(collectionPicker(page)).toBeVisible()
  await expect(page.getByText("National Dex", { exact: true })).toHaveCount(0)
  await nav(page).getByRole("button", { name: "Inventory", exact: true }).click()
  await expect(page.getByRole("searchbox", { name: "Search inventory" })).toBeVisible()
  await page.goBack()
  await expect(nav(page).getByRole("button", { name: "Wanted", exact: true })).toHaveAttribute("aria-pressed", "true")
  await page.reload()
  await expect(nav(page).getByRole("button", { name: "Wanted", exact: true })).toHaveAttribute("aria-pressed", "true")
  await nav(page).getByRole("button", { name: "Browse", exact: true }).click()
  await expect(page.getByRole("group", { name: "Browse perspective" })).toBeVisible()
})

test("malformed device preferences cannot break admission, read-only routes stay legacy", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("holofolder-slot-device-v1", "x".repeat(1000)))
  await page.goto(inventoryEntry)
  await expect(page.getByRole("searchbox", { name: "Search inventory" })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem("holofolder-slot-device-v1"))).toMatch(/^[a-f0-9-]{36}$/)
  await page.goto(`${entry}&readOnly=1`)
  await expect(page.getByRole("searchbox", { name: "Search inventory" })).not.toBeVisible()
  await expect(nav(page).getByRole("button", { name: "List", exact: true })).toBeVisible()
})


test("actual host displays recorded languages and leaves ambiguous aliases unknown", async ({ page }) => {
  const snapshot = syntheticSnapshot()
  snapshot.items[1].identity = { kind: "card", cardId: "base1-4", language: "ja", finish: "holo" }
  snapshot.binders[0].slots[0].target = { kind: "card", cardId: "base1-4", language: "ja" }
  // Put the occupied cells and translated target on the first page of each real grid.
  snapshot.binders.forEach(b => { b.slots = [...b.slots.slice(9), ...b.slots.slice(0, 9)] })
  const en = { ...inventoryBrowseCatalog[0], pokemonIds: [6] }
  const ja = { ...en, card: { ...en.card, name: "Synthetic Japanese title", language: "ja" as const } }
  await page.route("**/app/e2e-harness/storage/inventory?*", route => fulfillInventory(route, [en, ja], snapshot))
  await page.goto(`${entry}&binder=${alpha}`)
  await expect(page.locator(`[data-slot-id="${slotId(9)}"]`)).toHaveAttribute("aria-label", /Charizard/)
  await expect(page.locator(`[data-slot-id="${slotId(0)}"]`)).toHaveAttribute("aria-label", /Synthetic Japanese title/)
  await chooseCollection(page, trades)
  await expect(page.locator(`[data-slot-id="${slotId(109)}"]`)).toHaveAttribute("aria-label", /Synthetic Japanese title/)
  await page.unroute("**/app/e2e-harness/storage/inventory?*")
  const conflicting = { ...en, card: { ...en.card, id: "synthetic-conflicting", aliasIds: ["base1-4"], name: "Synthetic ambiguous title" } }
  await page.route("**/app/e2e-harness/storage/inventory?*", route => fulfillInventory(route, [en, conflicting], snapshot))
  await page.goto(`${entry}&binder=${alpha}`)
  await expect(page.locator(`[data-slot-id="${slotId(9)}"]`)).toHaveAttribute("aria-label", /base1-4/)
  await expect(page.getByText("Synthetic ambiguous title", { exact: true })).toHaveCount(0)
})


test("membership signal closes actual private overlays and same-owner recheck uses a fresh epoch", async ({ page, context, insets }) => {
  const epochs: string[] = []
  await page.route("**/app/e2e-harness/storage/inventory?*", async route => {
    epochs.push(new URL(route.request().url()).searchParams.get("sessionId")!)
    await fulfillInventory(route)
  })
  await page.goto(inventoryEntry)
  await expect(page.getByRole("searchbox", { name: "Search inventory" })).toBeVisible()
  const oldEpoch = epochs.at(-1)
  await page.locator('[data-item-id="copy-00001"]').click()
  await expect(page.getByRole("dialog")).toBeVisible()
  // A real second same-origin document emits only phase+nonce storage events.
  const other = await context.newPage()
  await other.goto("/app/e2e-harness?signedIn=1")
  await other.evaluate(() => localStorage.setItem("holofolder-membership-lifecycle-v1", JSON.stringify(["pause", crypto.randomUUID()])))
  await expect(page.getByRole("dialog")).not.toBeVisible()
  await expect(page.getByRole("list", { name: "Owned copies" })).not.toBeVisible()
  await other.evaluate(() => localStorage.setItem("holofolder-membership-lifecycle-v1", JSON.stringify(["recheck", crypto.randomUUID()])))
  await expect(page.getByRole("searchbox", { name: "Search inventory" })).toBeVisible()
  expect(epochs.at(-1)).not.toBe(oldEpoch)
  const h = new Harness(page, insets, true)
  await h.expectNoHorizontalOverflow()
  await h.expectHittable(nav(page).getByRole("button", { name: "Inventory", exact: true }))
  await other.close()
})
