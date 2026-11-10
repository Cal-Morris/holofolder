import type { Page, Route } from "@playwright/test"
import { test, expect, mockBackends, emulateStandalone, E2E_USER, Harness, collectionPicker, chooseCollection } from "./fixtures"
import { inventoryBrowseFixture, inventoryBrowseCatalog, inventoryBrowseLayouts } from "../tests/fixtures/inventory-browse"

// Synthetic ids, owner and share server. No hosted share or identity writes.
const alpha = "22222222-2222-4222-8222-222222222222"
const trades = "33333333-3333-4333-8333-333333333333"
const slotId = (n: number) => `44444444-4444-4444-8444-${String(n).padStart(12, "0")}`
const storageId = (id: string) => id === "alpha" ? alpha : trades
const layouts = inventoryBrowseLayouts.map(l => ({ ...l, collectionId: storageId(l.collectionId) }))

function syntheticSnapshot() {
  const snapshot = inventoryBrowseFixture(5)
  snapshot.ownerUserId = E2E_USER.id
  snapshot.items.forEach(i => { i.ownerUserId = E2E_USER.id })
  snapshot.collections.forEach(c => { c.ownerUserId = E2E_USER.id; c.id = storageId(c.id) })
  snapshot.binders.forEach(b => { b.ownerUserId = E2E_USER.id; b.slots.forEach(s => { s.ownerUserId = E2E_USER.id }) })
  const slots = new Map(snapshot.binders.flatMap((b, i) => b.slots.map((s, n) => [s.id, slotId(i * 100 + n)] as const)))
  snapshot.binders.forEach(b => { b.collectionId = storageId(b.collectionId); b.slots.forEach(s => { s.id = slots.get(s.id)!; s.collectionId = b.collectionId }) })
  snapshot.placements.forEach(p => { p.collectionId = storageId(p.collectionId); p.slotId = slots.get(p.slotId)! })
  return snapshot
}
async function fulfillInventory(route: Route) {
  const url = new URL(route.request().url()), snapshot = syntheticSnapshot()
  await route.fulfill({ headers: { "Cache-Control": "private, no-store" }, json: { version: 2,
    requestId: url.searchParams.get("requestId"), scope: { actorUserId: E2E_USER.id, ownerUserId: E2E_USER.id,
      authSessionId: "synthetic-e2e-auth-session", sessionId: url.searchParams.get("sessionId") }, snapshot,
    navigation: { catalog: inventoryBrowseCatalog, layouts },
    evidence: { inventoryRevision: snapshot.inventoryRevision, items: snapshot.items.length, placements: snapshot.placements.length,
      collections: snapshot.collections.length, binders: snapshot.binders.length, slots: snapshot.binders.reduce((n, b) => n + b.slots.length, 0),
      storage: snapshot.binders.map(b => ({ collectionId: b.collectionId, collectionVersion: 1, layoutRevision: b.layoutRevision, slotCount: b.slots.length })) } } })
}

type Share = { token: string; is_enabled: boolean; show_prices: boolean }
/** In-memory stand-in for /app/api/binder-share and /app/api/binder-identity, recording every request. */
async function shareServer(page: Page, { deny = false } = {}) {
  const shares = new Map<string, Share>(), slugs = new Map<string, string>()
  const requests: Array<{ method: string; binderId: string | null; showPrices?: boolean }> = []
  const gates = new Map<string, Promise<void>>()
  const path = (binderId: string, share: Share) => slugs.has(binderId) ? `/@synthetic-owner/${slugs.get(binderId)}` : `/app/share/${share.token}`
  await page.route("**/app/api/binder-share**", async route => {
    const request = route.request(), method = request.method()
    const body = method === "POST" ? request.postDataJSON() as { binderId?: string; showPrices?: boolean } : null
    const binderId = body ? body.binderId ?? null : new URL(request.url()).searchParams.get("binderId")
    requests.push({ method, binderId, ...(body && typeof body.showPrices === "boolean" ? { showPrices: body.showPrices } : {}) })
    if (method === "GET" && binderId && gates.has(binderId)) await gates.get(binderId)
    if (!binderId || deny) return route.fulfill({ status: 404, json: { error: "Binder not found" } })
    let share = shares.get(binderId)
    if (method === "POST") {
      share = { token: share?.token ?? `synthetic${binderId.slice(0, 4)}`, is_enabled: true, show_prices: body?.showPrices ?? share?.show_prices ?? false }
      shares.set(binderId, share)
    } else if (method === "DELETE" && share) {
      share = { ...share, is_enabled: false }
      shares.set(binderId, share)
    }
    return route.fulfill({ json: { share: share ? { ...share, path: path(binderId, share) } : null } })
  })
  await page.route("**/app/api/binder-identity**", async route => {
    const request = route.request()
    const binderId = request.method() === "PATCH" ? (request.postDataJSON() as { binderId: string }).binderId : new URL(request.url()).searchParams.get("binderId")!
    if (request.method() === "PATCH") slugs.set(binderId, (request.postDataJSON() as { slug: string }).slug)
    return route.fulfill({ json: { username: "synthetic-owner", slug: slugs.get(binderId) ?? null, canEdit: true, available: true } })
  })
  return { shares, requests, hold: (binderId: string) => {
    let release!: () => void
    gates.set(binderId, new Promise<void>(resolve => { release = resolve }))
    return () => { gates.delete(binderId); release() }
  } }
}

test.beforeEach(async ({ page, context, standalone, insets, baseURL }) => {
  if (standalone) await emulateStandalone(page, insets)
  await mockBackends(page, context, { signedIn: true, baseURL })
  await page.route("**/app/e2e-harness/storage/inventory?*", route => fulfillInventory(route))
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => { (window as unknown as { copied: string }).copied = text } } })
  })
})

const more = (page: Page) => page.getByRole("button", { name: "More", exact: true })
const menuItem = (page: Page, name: string) => page.getByRole("menu", { name: "More" }).getByRole("menuitem", { name, exact: true })
const picker = (page: Page) => collectionPicker(page)

async function ownerShareFlow(page: Page, insets: { top: number; bottom: number; left: number; right: number }) {
  const server = await shareServer(page)
  const h = new Harness(page, insets, true)
  await page.goto(`/app/e2e-harness?signedIn=1&browserHost=1&binder=${alpha}&view=binder`)
  await expect(picker(page)).toHaveAttribute("data-value", alpha)
  await expect.poll(() => server.requests.some(r => r.method === "GET" && r.binderId === alpha)).toBe(true)

  // Header: create then copy, bound to the selected native collection.
  await more(page).click()
  const create = menuItem(page, "Create share link")
  await expect(create).toBeVisible()
  await h.expectMinTapTarget(create)
  await h.expectWithinSafeViewport(create)
  await create.click()
  await expect(page.getByRole("dialog", { name: "More" }).getByRole("status")).toHaveText("Read-only share link is live.")
  expect(server.requests.filter(r => r.method === "POST")).toEqual([{ method: "POST", binderId: alpha }])
  await menuItem(page, "Copy share link").click()
  await expect(page.getByRole("dialog", { name: "More" }).getByRole("status")).toHaveText("Share link copied.")
  expect(await page.evaluate(() => (window as unknown as { copied: string }).copied)).toMatch(/\/app\/share\/synthetic2222$/)
  await h.expectNoHorizontalOverflow()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog", { name: "More" })).toHaveCount(0)

  // Settings Share tab: public name, show prices and revoke, all for the same collection.
  await more(page).click()
  await menuItem(page, "Settings").click()
  const settings = page.getByRole("dialog", { name: "Settings" })
  await settings.getByRole("button", { name: "Share", exact: true }).click()
  await expect(settings.getByText(/\/app\/share\/synthetic2222$/)).toBeVisible()
  const slug = settings.getByLabel("Binder slug")
  await expect(slug).toBeEnabled()
  await slug.fill("synthetic-alpha")
  await settings.getByRole("button", { name: "Save", exact: true }).click()
  await expect(settings.getByText("Binder address saved.")).toBeVisible()
  // The public identity change reloads the share path.
  await expect(settings.getByText("holofolder.com/@synthetic-owner/synthetic-alpha").first()).toBeVisible()
  const prices = settings.getByRole("switch", { name: "Show prices on shared binder" })
  await expect(prices).not.toBeChecked()
  await h.expectMinTapTarget(prices)
  await prices.click()
  await expect(prices).toBeChecked()
  expect(server.requests.filter(r => r.method === "POST").at(-1)).toEqual({ method: "POST", binderId: alpha, showPrices: true })
  expect(server.shares.get(alpha)?.show_prices).toBe(true)
  await prices.click()
  await expect(prices).not.toBeChecked()
  expect(server.shares.get(alpha)?.show_prices).toBe(false)
  await h.expectNoHorizontalOverflow()
  await settings.getByRole("button", { name: "Disable link", exact: true }).click()
  await expect(settings.getByText("Read-only share link disabled.")).toBeVisible()
  await expect(settings.getByRole("button", { name: "Generate read-only share link" })).toBeVisible()
  expect(server.requests.filter(r => r.method === "DELETE")).toEqual([{ method: "DELETE", binderId: alpha }])
  expect(server.shares.get(alpha)?.is_enabled).toBe(false)
  const close = settings.getByRole("button", { name: "Close settings" })
  await h.expectMinTapTarget(close)
  await close.click()
  await expect(settings).toHaveCount(0)

  // Switching collection rescopes every action to the new collection, never the previous or a default one.
  await chooseCollection(page, trades)
  await expect(picker(page)).toHaveAttribute("data-value", trades)
  await expect.poll(() => server.requests.some(r => r.method === "GET" && r.binderId === trades)).toBe(true)
  await more(page).click()
  await menuItem(page, "Create share link").click()
  await expect(menuItem(page, "Copy share link")).toBeVisible()
  expect(server.requests.filter(r => r.method === "POST").at(-1)).toEqual({ method: "POST", binderId: trades })
  expect(server.shares.get(alpha)?.is_enabled).toBe(false)
  expect(server.requests.every(r => r.binderId === alpha || r.binderId === trades)).toBe(true)
}

test("native owners create, copy, rename, price and revoke the selected collection's share link", async ({ page, insets }) => {
  await ownerShareFlow(page, insets)
})

test("native owner share controls keep desktop layout", async ({ page }, info) => {
  test.skip(info.project.name !== "browser-390x844", "one desktop check")
  await page.setViewportSize({ width: 1440, height: 900 })
  await ownerShareFlow(page, { top: 0, bottom: 0, left: 0, right: 0 })
})

test("a stale share response from the previous collection never lands on the new one", async ({ page }, info) => {
  test.skip(info.project.name !== "browser-390x844", "scope fence is viewport independent")
  const server = await shareServer(page)
  server.shares.set(alpha, { token: "syntheticalpha", is_enabled: true, show_prices: true })
  const release = server.hold(alpha)
  await page.goto(`/app/e2e-harness?signedIn=1&browserHost=1&binder=${alpha}&view=binder`)
  await expect(picker(page)).toHaveAttribute("data-value", alpha)
  await expect.poll(() => server.requests.some(r => r.method === "GET" && r.binderId === alpha)).toBe(true)
  await chooseCollection(page, trades)
  await expect.poll(() => server.requests.some(r => r.method === "GET" && r.binderId === trades)).toBe(true)
  release()
  await more(page).click()
  await expect(menuItem(page, "Create share link")).toBeVisible()
  await expect(menuItem(page, "Copy share link")).toHaveCount(0)
})

test("share controls need a selected collection and surface server permission denial", async ({ page }, info) => {
  test.skip(info.project.name !== "browser-390x844", "permission gates are viewport independent")
  const server = await shareServer(page, { deny: true })
  await page.goto(`/app/e2e-harness?signedIn=1&browserHost=1&view=inventory`)
  await more(page).click()
  await expect(menuItem(page, "Settings")).toBeVisible()
  await expect(menuItem(page, "Create share link")).toHaveCount(0)
  await menuItem(page, "Settings").click()
  await expect(page.getByRole("dialog", { name: "Settings" }).getByRole("button", { name: "Share", exact: true })).toHaveCount(0)
  expect(server.requests).toEqual([])
  await page.keyboard.press("Escape")

  await page.goto(`/app/e2e-harness?signedIn=1&browserHost=1&binder=${alpha}&view=binder`)
  await expect(picker(page)).toHaveAttribute("data-value", alpha)
  await expect.poll(() => server.requests.some(r => r.method === "GET" && r.binderId === alpha)).toBe(true)
  await more(page).click()
  await menuItem(page, "Create share link").click()
  await expect.poll(() => server.requests.filter(r => r.method === "POST")).toEqual([{ method: "POST", binderId: alpha }])
  await expect(page.getByRole("dialog", { name: "More" }).getByRole("status")).toHaveText("Binder not found")
  await expect(menuItem(page, "Create share link")).toBeVisible()
  expect(server.requests.every(r => r.binderId === alpha)).toBe(true)
})
