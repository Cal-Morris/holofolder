import { mkdir, writeFile } from "node:fs/promises"
import type { TestInfo } from "@playwright/test"
import { test, expect, mockBackends, emulateStandalone, E2E_USER, Harness } from "./fixtures"
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

async function checkToolbar(page: import("@playwright/test").Page, insets: { top: number; bottom: number; left: number; right: number }, info: TestInfo, name: string) {
  await page.goto(`/app/e2e-harness?signedIn=1&browserHost=1&binder=${alpha}&view=binder`)
  const picker = page.getByRole("combobox", { name: "Collection", exact: true })
  const view = page.getByRole("combobox", { name: "Collection view", exact: true })
  const edit = page.getByRole("button", { name: "Edit layout", exact: true })
  await expect(picker).toHaveValue(alpha)
  await expect(edit).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  const sample = () => page.evaluate(() => {
    const elements = [document.body, document.querySelector('[data-testid="app-header"]'), document.querySelector('[data-testid="app-header"] span.truncate'),
      document.querySelector('select[aria-label="Collection"]'), document.querySelector('select[aria-label="Collection view"]'),
      ...Array.from(document.querySelectorAll("button")).filter(e => ["Show"].includes(e.textContent?.trim() ?? "") || ["Edit layout", "Scan page", "Scan card", "Storage"].includes(e.getAttribute("aria-label") ?? ""))]
    return elements.filter((e): e is HTMLElement => e instanceof HTMLElement).map(e => {
      const s = getComputedStyle(e), r = e.getBoundingClientRect()
      return { name: e.getAttribute("aria-label") ?? e.textContent?.trim().slice(0, 30), tag: e.tagName,
        font: s.fontFamily, size: s.fontSize, weight: s.fontWeight, line: s.lineHeight,
        x: r.x, y: r.y, width: r.width, height: r.height }
    })
  })
  await mkdir(info.outputDir, { recursive: true })
  const measurements = info.outputPath(`${name}.json`), screenshot = info.outputPath(`${name}.png`)
  await writeFile(measurements, JSON.stringify(await sample(), null, 2))
  await page.screenshot({ path: screenshot })
  await info.attach("computed styles", { path: measurements, contentType: "application/json" })
  await info.attach("toolbar", { path: screenshot, contentType: "image/png" })
  const font = await page.locator("body").evaluate(e => getComputedStyle(e).fontFamily)
  for (const control of [picker, view, edit, ...["Scan page", "Scan card", "Storage"].map(name => page.getByRole("button", { name, exact: true }))]) {
    await expect(control).toHaveCSS("font-family", font)
    const h = new Harness(page, insets, true)
    await h.expectMinTapTarget(control)
    await h.expectWithinSafeViewport(control)
    await h.expectHittable(control)
  }
  await expect(picker).toHaveCSS("font-size", "14px")
  await expect(picker).toHaveCSS("font-weight", "600")
  await expect(view).toHaveCSS("font-size", "12px")
  await expect(view).toHaveCSS("font-weight", "500")
  // Edit layout is a compact icon in the binder actions row, not its own row.
  const storage = page.getByRole("button", { name: "Storage", exact: true })
  const [editBox, storageBox] = [await edit.boundingBox(), await storage.boundingBox()]
  expect(Math.abs(editBox!.y + editBox!.height / 2 - (storageBox!.y + storageBox!.height / 2))).toBeLessThanOrEqual(1)
  expect(editBox!.width).toBe(storageBox!.width)
  await expect(edit).toHaveAttribute("title", "Edit layout")
  await expect(edit).toHaveAttribute("aria-pressed", "false")
  await expect(page.getByTestId("main-content").getByRole("button", { name: "Edit layout", exact: true })).toHaveCount(0)
  const h = new Harness(page, insets, true)
  await h.expectNoHorizontalOverflow()
  // Native select labels must stay bounded even with a realistic long collection name.
  await page.route("**/app/e2e-harness/storage/inventory?*", route => {
    const snapshot = syntheticSnapshot()
    snapshot.collections[0].name = "Japanese illustration rares and special art favourites"
    return fulfillInventory(route, inventoryBrowseCatalog, snapshot)
  })
  await page.reload()
  await expect(picker).toHaveValue(alpha)
  await expect(picker.locator("option").first()).toHaveText("Japanese illustration rares and special art favourites")
  await expect(edit).toBeVisible()
  await h.expectNoHorizontalOverflow()
  for (const theme of ["light", "dark"]) {
    await page.evaluate(theme => document.documentElement.classList.toggle("dark", theme === "dark"), theme)
    await h.expectHittable(edit)
    await h.expectNoHorizontalOverflow()
  }
  await edit.click()
  const done = page.getByRole("button", { name: "Done", exact: true })
  await expect(done).toBeVisible()
  await expect(page.getByRole("status").filter({ hasText: /^Editing layout$/ })).toBeVisible()
  await expect(edit).toHaveCount(0)
  await h.expectNoHorizontalOverflow()
  await done.click()
  await expect(edit).toBeVisible()
  await edit.focus()
  await page.keyboard.press("Enter")
  await expect(done).toBeVisible()
  await done.click()
  await expect(edit).toBeVisible()
  await view.selectOption("list")
  await expect(view).toHaveValue("list")
  await picker.selectOption(trades)
  await expect(picker).toHaveValue(trades)
  await h.expectNoHorizontalOverflow()
}

test("native toolbar inherits the app font and compact control hierarchy", async ({ page, insets }, info) => {
  await checkToolbar(page, insets, info, info.project.name)
})
test("native toolbar keeps desktop typography and controls", async ({ page }, info) => {
  test.skip(info.project.name !== "browser-390x844", "one desktop check")
  await page.setViewportSize({ width: 1440, height: 900 })
  await checkToolbar(page, { top: 0, bottom: 0, left: 0, right: 0 }, info, "desktop-1440x900")
})
