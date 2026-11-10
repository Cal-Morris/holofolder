import { test, expect, mockBackends, emulateStandalone, Harness } from "./fixtures"
import { fulfillWantedInventory, wantedEntry, wantedSnapshot, WANT_COLLECTION, WANT_TOTAL } from "./native-wanted-layout-fixture"
import { inventoryProjectionCatalog } from "../tests/fixtures/inventory-browse"
import type { Page } from "@playwright/test"
import type { SlotOfflineRecord } from "../lib/collection/slot-offline-queue"

// Native Wanted tab with a synthetic 483 entry inventory (see native-wanted-layout-fixture.ts). No hosted data.
let total = WANT_TOTAL
test.beforeEach(async ({ page, context, standalone, insets, baseURL }) => {
  total = WANT_TOTAL
  if (standalone) await emulateStandalone(page, insets)
  await mockBackends(page, context, { signedIn: true, baseURL })
  await page.route("**/app/e2e-harness/storage/inventory?*", route => fulfillWantedInventory(route, total))
  // Writes never leave the page: the pending command stays queued on the device.
  await page.route("**/app/e2e-harness/storage/inventory", route => route.abort("failed"))
})

const open = async (page: Page) => {
  await page.goto(wantedEntry)
  await page.getByRole("button", { name: "Wanted", exact: true }).filter({ visible: true }).click()
  return page.getByRole("region", { name: "Wanted cards", exact: true })
}
// What the fixture says should be on screen, so assertions are exact rather than "some".
function expected() {
  const slots = wantedSnapshot().binders.find(b => b.collectionId === WANT_COLLECTION)!.slots
  const wants = slots.flatMap(s => s.wantedCards.map(w => ({ w, occupied: !!s.inventoryItemId })))
  return { all: wants.length, occupied: wants.filter(x => x.occupied).length, occupiedWithCard: wants.filter(x => x.occupied && x.w.card_language).length,
    editable: wants.filter(x => !x.occupied && x.w.card_finish && x.w.card_language).length,
    // A want with no recorded language shows as "Unknown card", never as English.
    trainers: wants.filter(x => x.w.card_id === "synthetic-trainer" && x.w.card_language).length }
}

for (const width of [1280, 1920]) test(`desktop ${width}px: bounded multi-column compact rows, every entry kept, no occupied sentence`, async ({ page }, info) => {
  test.skip(info.project.name !== "browser-390x844", "desktop geometry runs once, on the default browser project")
  await page.setViewportSize({ width, height: width === 1280 ? 900 : 1080 })
  const wants = await open(page)
  const rows = wants.getByRole("listitem")
  const want = expected()
  expect(want.all).toBe(WANT_TOTAL)
  await expect(rows).toHaveCount(WANT_TOTAL)
  await expect(wants).toContainText(`${WANT_TOTAL} wanted cards`)
  // Duplicates of one card at different destinations are all present, each with its own destination label.
  await expect(wants.getByText("Synthetic Trainer", { exact: true })).toHaveCount(want.trainers)
  const first = (await rows.nth(0).boundingBox())!, second = (await rows.nth(1).boundingBox())!, third = (await rows.nth(2).boundingBox())!
  const section = (await wants.boundingBox())!
  expect(second.y, "second entry sits beside the first, so the list has several columns").toBeCloseTo(first.y, 0)
  expect(third.y, "xl desktop has three columns").toBeCloseTo(first.y, 0)
  expect(third.x + third.width - first.x, "list content is bounded").toBeLessThanOrEqual(1152)
  if (width > 1280) expect(first.x, "centred, not screen wide").toBeGreaterThan(200)
  expect(section.width).toBeLessThanOrEqual(1152)
  expect(first.height, "compact rows").toBeLessThanOrEqual(240)
  expect(first.height).toBeGreaterThanOrEqual(90)
  const art = (await rows.nth(0).getByRole("img").boundingBox())!
  expect(art.width, "readable artwork, well above the old 44px").toBeGreaterThanOrEqual(64)
  expect(art.height).toBeGreaterThanOrEqual(88)
  // Occupied destinations are a normal state: no repeated instruction, a quiet Owned tag, and no add controls.
  await expect(wants).not.toContainText("This pocket is occupied")
  await expect(wants.getByText("Owned", { exact: true })).toHaveCount(want.occupied)
  await expect(rows.filter({ hasText: "Owned" }).getByRole("combobox")).toHaveCount(0)
  await expect(rows.filter({ hasText: "Owned" }).getByRole("button", { name: "Add to collection" })).toHaveCount(0)
  await expect(rows.filter({ hasText: "Owned" }).getByRole("button", { name: "Check price" })).toHaveCount(want.occupiedWithCard)
  // Add controls exist exactly for unoccupied entries with a known printing and language.
  await expect(wants.getByRole("combobox")).toHaveCount(want.editable)
  await expect(wants.getByRole("button", { name: "Add to collection" })).toHaveCount(want.editable)
  await expect(wants.getByText("Unknown card", { exact: true }).first()).toBeAttached()
  await expect(wants.getByText(/^Unknown finish/).first()).toBeAttached()
  await expect(wants.getByText(/Japanese/).first()).toBeAttached()
  await new Harness(page, { top: 0, bottom: 0, left: 0, right: 0 }, true).expectNoHorizontalOverflow()
})

test("phone: one comfortable column, no overflow, 36px targets, nothing under the dock, long names stay inside", async ({ page, insets }) => {
  const wants = await open(page)
  const rows = wants.getByRole("listitem")
  await expect(rows).toHaveCount(WANT_TOTAL)
  const h = new Harness(page, insets, true)
  await h.expectNoHorizontalOverflow()
  const a = (await rows.nth(0).boundingBox())!, b = (await rows.nth(1).boundingBox())!
  expect(b.y, "single column").toBeGreaterThan(a.y + a.height - 1)
  const art = (await rows.nth(0).getByRole("img").boundingBox())!
  expect(art.width, "phone artwork is not smaller than before").toBeGreaterThanOrEqual(44)
  const choice = wants.getByRole("combobox").first()
  await choice.scrollIntoViewIfNeeded()
  await h.expectMinTapTarget(choice)
  await h.expectMinTapTarget(wants.getByRole("button", { name: "Add to collection" }).first())
  await h.expectMinTapTarget(rows.first().getByRole("button", { name: "Check price" }))
  await h.expectWithinSafeViewport(choice)
  await h.expectHittable(choice)
  // Long card name wraps inside its tile; it never escapes the row.
  const long = rows.filter({ hasText: "extraordinarily long card display name" }).first()
  await long.scrollIntoViewIfNeeded()
  const row = (await long.boundingBox())!, name = (await long.locator("p").first().boundingBox())!
  expect(name.x + name.width).toBeLessThanOrEqual(row.x + row.width)
  await h.expectNoHorizontalOverflow()
  // The end of the list stays reachable above the dock.
  // Rows outside the viewport use an estimated height until they render, so keep scrolling until the height stops changing.
  expect(await wants.evaluate(async el => {
    const scroller = el.parentElement as HTMLElement
    let last = -1
    for (let i = 0; i < 30; i++) {
      scroller.scrollTop = scroller.scrollHeight
      await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))
      if (scroller.scrollHeight === last && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) return true
      last = scroller.scrollHeight
    }
    return false
  })).toBe(true)
  await h.expectWithinSafeViewport(rows.last())
  await h.expectHittable(rows.last())
})

async function records(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((yes, no) => { const r = indexedDB.open("binderdex-offline"); r.onsuccess = () => yes(r.result); r.onerror = () => no(r.error) })
    const rows = await new Promise<unknown[]>((yes, no) => { const r = db.transaction("records").objectStore("records").getAll(); r.onsuccess = () => yes(r.result); r.onerror = () => no(r.error) })
    db.close(); return rows.find(r => !!r && typeof r === "object" && "pending" in r) as SlotOfflineRecord | undefined
  })
}

test("Add to collection for an unoccupied known entry hands off the same want, and the saved notice stays in view", async ({ page, insets }) => {
  const wants = await open(page)
  // The second explicit want in the first pocket: a Pikachu with a known finish and language, no spare copy, so a new copy.
  const label = "Copy for Page 1 · Pocket 1 · Wanted card 2"
  const choice = wants.getByRole("combobox", { name: label, exact: true })
  await choice.selectOption("new")
  const row = wants.getByRole("listitem").filter({ has: page.getByRole("combobox", { name: label, exact: true }) })
  await expect(row).toContainText("Synthetic Pikachu")
  await row.getByRole("button", { name: "Add to collection" }).click()
  await expect.poll(async () => (await records(page))?.pending.length).toBe(1)
  const intent = (await records(page))!.pending[0].intent
  if (intent.kind !== "inventory") throw new Error("Expected the native inventory command")
  expect(intent.request.commands[0]).toMatchObject({ kind: "assign", selection: { kind: "catalog", identity: { cardId: "synthetic-pikachu", language: "en", finish: "holo" } },
    destination: { slot: { id: "synthetic-want-slot-0" } }, fulfillWant: { index: 1, expected: { card_id: "synthetic-pikachu" } } })
  const notice = wants.getByRole("status")
  await expect(notice).toHaveText("Saved on device, awaiting sync")
  // Scroll far away: the notice is sticky, so the user still sees the outcome from anywhere in the long list.
  await wants.getByRole("listitem").last().scrollIntoViewIfNeeded()
  await new Harness(page, insets, true).expectWithinSafeViewport(notice)
})

test("an occupied destination never offers or performs Add to collection", async ({ page }) => {
  const wants = await open(page)
  // Slot 1 is occupied (every third pocket): its only entry is the Pikachu at Page 1 · Pocket 2.
  const owned = wants.getByRole("listitem").filter({ hasText: "Page 1 · Pocket 2 · Wanted card 1" })
  await expect(owned).toHaveCount(1)
  await expect(owned.getByText("Owned", { exact: true })).toBeVisible()
  await expect(owned.getByRole("combobox")).toHaveCount(0)
  await expect(owned.getByRole("button", { name: "Add to collection" })).toHaveCount(0)
  await expect(owned.getByRole("button", { name: "Check price" })).toBeVisible()
  expect((await records(page))?.pending ?? []).toHaveLength(0)
})

test("empty state", async ({ page, insets }) => {
  total = 0
  const wants = await open(page)
  await expect(wants).toContainText("0 wanted cards")
  await expect(wants.getByText("No wanted cards yet", { exact: true })).toBeVisible()
  await expect(wants.getByRole("listitem")).toHaveCount(0)
  await new Harness(page, insets, true).expectNoHorizontalOverflow()
})

// The focused harness mounts the same Wanted presentation over a synthetic read, including the cached and unavailable reads.
test.describe("cached and unavailable reads", () => {
  const harness = "/app/e2e-harness/native-card-consumers?mode=wanted&selected=1"
  test.beforeEach(async ({ page }) => {
    const cards = inventoryProjectionCatalog.map(c => ({ ...c.card, dexIds: [...c.pokemonIds ?? []], variants: { normal: true } }))
    await page.route("**/app/api/tcg-card-search**", route => route.fulfill({ json: { cards } }))
  })
  test("cached read is read-only and keeps every entry and Check price", async ({ page, insets }) => {
    await page.goto(`${harness}&cached=1`)
    const wants = page.getByRole("region", { name: "Wanted cards", exact: true })
    await expect(wants).toContainText("Saved wanted cards, read-only while offline.")
    await expect(wants.getByRole("listitem")).toHaveCount(3)
    await expect(wants.getByRole("combobox")).toHaveCount(0)
    await expect(wants.getByRole("button", { name: "Add to collection" })).toHaveCount(0)
    await new Harness(page, insets, false).expectNoHorizontalOverflow()
  })
  test("unavailable read says so and lists nothing", async ({ page }) => {
    await page.goto(`${harness}&unavailable=1`)
    const wants = page.getByRole("region", { name: "Wanted cards", exact: true })
    await expect(wants.getByRole("status")).toHaveText("Could not load wanted cards. Reconnect and try again.")
    await expect(wants.getByRole("listitem")).toHaveCount(0)
  })
})
