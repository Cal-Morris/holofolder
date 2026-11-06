import { test, expect, SUPABASE_URL, type Harness } from "./fixtures"
import { HUNT_COLLECTION } from "./hunt-fixtures"

// Synthetic wanted printings and sold/asking samples, never real card or sale data.
const wanted = Array.from({ length: 16 }, (_, index) => ({
  ...HUNT_COLLECTION[0].wanted_cards[0], card_id: `comps-fixture-${index}`, local_id: String(index),
}))

async function openConfirmation(harness: Harness) {
  const { page } = harness
  const requests: string[] = []
  await page.route("**/api/card-price-checks?**", async route => {
    const source = new URL(route.request().url()).searchParams.get("source")!
    requests.push(route.request().url())
    await route.fulfill({ json: { [source]: {
      summary: { kind: source === "ebay" ? "asking" : "sold", currency: "GBP", count: 2, median: 5, low: 4, high: 6 },
      checkedAt: new Date().toISOString(),
    }, errors: {} } })
  })
  await page.route(`${SUPABASE_URL}/rest/v1/pokemon_collection**`, route =>
    route.request().method() === "GET"
      ? route.fulfill({ json: [{ ...HUNT_COLLECTION[0], wanted_cards: wanted }] }) : route.fallback())
  await page.reload()
  // One of the 16 cards is already fresh for both sources: only 15 need refreshing.
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("binderdex-offline", 1)
      open.onsuccess = () => {
        const db = open.result
        const tx = db.transaction("records", "readwrite")
        for (const source of ["ebay", "soldcomps"]) tx.objectStore("records").put({
          summary: { kind: source === "ebay" ? "asking" : "sold", currency: "GBP", count: 2, median: 5, low: 4, high: 6 },
          checkedAt: new Date().toISOString(),
        }, `price-check:comps-fixture-0:holo:${source}`)
        tx.oncomplete = () => { db.close(); resolve() }
        tx.onerror = () => reject(tx.error)
      }
      open.onerror = () => reject(open.error)
    })
  })
  await page.getByRole("button", { name: "Show mode", exact: true }).click()
  await page.getByRole("region", { name: "Show mode" }).getByRole("button", { name: "Search", exact: true }).click()
  const quick = page.getByRole("dialog", { name: "Quick mode", exact: true })
  const opener = quick.getByRole("button", { name: "Check comps", exact: true })
  await opener.click()
  const dialog = page.getByRole("dialog", { name: "Check sold comps?", exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText("15 cards need a sold comps refresh.")
  expect(requests).toHaveLength(0)
  return { dialog, quick, opener, requests }
}

test.describe("Show comps confirmation", () => {
  test.use({ signedIn: true })

  test("fits the safe viewport in light and dark, with reachable actions", async ({ harness }) => {
    const { dialog } = await openConfirmation(harness)
    for (const dark of [false, true]) {
      await harness.page.evaluate(dark => document.documentElement.classList.toggle("dark", dark), dark)
      await harness.expectWithinSafeViewport(dialog)
      for (const button of [harness.closeControl(dialog), dialog.getByRole("button", { name: "Cancel", exact: true }), dialog.getByRole("button", { name: "Check comps", exact: true })]) {
        await harness.expectMinTapTarget(button, 48)
        await harness.expectHittable(button)
        await harness.expectWithinSafeViewport(button)
      }
      const box = (await dialog.boundingBox())!
      expect(box.y + box.height).toBeLessThanOrEqual(harness.viewport.height - harness.insets.bottom - 54)
      await harness.expectNoHorizontalOverflow()
      await harness.page.screenshot({ path: test.info().outputPath(`confirmation-${dark ? "dark" : "light"}.png`) })
    }
  })

  test("confirmation starts the batch, fresh cached cards stay skipped", async ({ harness }) => {
    const { dialog, quick, requests } = await openConfirmation(harness)
    await dialog.getByRole("button", { name: "Check comps", exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(quick.getByTestId("show-check-comps").getByRole("status")).toHaveText("Sold comps ready for 16/16 cards.")
    expect(requests).toHaveLength(30)
    expect(requests.some(url => new URL(url).searchParams.get("cardId") === "comps-fixture-0")).toBe(false)
    // All checks are pinned now, so a repeat run needs neither confirmation nor requests.
    await quick.getByRole("button", { name: "Check comps", exact: true }).click()
    await expect(quick.getByTestId("show-check-comps").getByRole("status")).toHaveText("Sold comps ready for 16/16 cards.")
    await expect(dialog).toBeHidden()
    expect(requests).toHaveLength(30)
  })

  test("Stop still aborts a confirmed batch before further requests", async ({ harness }) => {
    const { dialog, quick } = await openConfirmation(harness)
    let requests = 0
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    await harness.page.route("**/api/card-price-checks?**", async route => {
      requests += 1
      await held
      await route.fulfill({ json: { ebay: null, soldcomps: null, errors: {} } }).catch(() => {})
    })
    await dialog.getByRole("button", { name: "Check comps", exact: true }).click()
    await expect.poll(() => requests).toBe(2)
    await quick.getByRole("button", { name: "Stop checking comps", exact: true }).click()
    release()
    await expect(quick.getByRole("button", { name: "Check comps", exact: true })).toBeVisible()
    await expect(quick.getByRole("progressbar")).toHaveCount(0)
    expect(requests).toBe(2)
  })

  for (const method of ["Cancel", "X", "backdrop", "Escape", "back", "swipe", "dock"] as const) {
    test(`${method} dismisses without starting any requests`, async ({ harness }) => {
      const { dialog, quick, opener, requests } = await openConfirmation(harness)
      if (method === "Cancel") await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
      if (method === "X") await harness.closeControl(dialog).click()
      if (method === "backdrop") await harness.tapBackdrop(dialog)
      if (method === "Escape") await harness.page.keyboard.press("Escape")
      if (method === "back") await harness.page.goBack()
      if (method === "swipe") await harness.swipeDown(dialog)
      // Quick mode covers the dock, so dispatch its tab change to exercise closeAllOverlays.
      if (method === "dock") await harness.dock().getByRole("button", { name: "List", exact: true }).dispatchEvent("click")
      await expect(dialog).toBeHidden()
      if (method === "dock") {
        await expect(quick).toBeHidden()
        await harness.expectScrollUnlocked()
      } else {
        await expect(quick).toBeVisible()
        await expect(quick.getByTestId("show-check-comps").getByRole("status")).toHaveText("Check comps cancelled.")
        await expect(opener).toBeFocused()
        await harness.page.keyboard.press("Escape")
        await expect(quick).toBeHidden()
        await harness.expectScrollUnlocked()
      }
      await expect(harness.page).toHaveURL(/\/e2e-harness/)
      expect(requests).toHaveLength(0)
    })
  }

  test("going offline disables confirmation and starts no requests", async ({ harness }) => {
    const { dialog, quick, requests } = await openConfirmation(harness)
    await harness.page.context().setOffline(true)
    await expect(dialog.getByRole("button", { name: "Check comps", exact: true })).toBeDisabled()
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
    await expect(quick.getByRole("button", { name: "Check comps", exact: true })).toBeDisabled()
    expect(requests).toHaveLength(0)
  })
})
