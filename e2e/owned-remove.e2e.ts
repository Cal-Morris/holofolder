import type { Page, TestInfo } from "@playwright/test"
import { expect, test, type Harness } from "./fixtures"
import { FakeCollectionServer, setNetwork } from "./collection-server"

type WantedRow = { card_id: string; card_language?: string; card_finish?: string }

/** Optional screenshots for reviews: set OWNED_REMOVE_SCREENS_DIR to a folder. */
async function snap(page: Page, testInfo: TestInfo, name: string) {
  const dir = process.env.OWNED_REMOVE_SCREENS_DIR
  if (!dir) return
  await page.screenshot({ path: `${dir}/owned-remove-${name}-${testInfo.project.name}.png` })
}

async function openDetail(page: Page, dexId: number) {
  await page.locator(`button[data-dex-id="${dexId}"]`).first().click()
  const dialog = page.getByRole("dialog", { name: /details$/i })
  await expect(dialog).toBeVisible()
  return dialog
}

function removeSheet(page: Page, name: string) {
  return page.getByRole("dialog", { name: new RegExp(`^remove ${name}$`, "i") })
}

const undoSnackbar = (page: Page) => page.getByTestId("undo-snackbar")

async function openList(harness: Harness) {
  await harness.dock().getByRole("button", { name: "List", exact: true }).click()
  // The list view is loaded on demand; the first open can be slow while several browsers share one server.
  await expect(harness.page.getByTestId("view-scroller")).toBeVisible({ timeout: 20_000 })
}

test.describe("remove an owned card", () => {
  test.use({ signedIn: true })

  test("detail sheet: owned, then moved back to Wanted, then undo restores the exact printing", async ({ harness }, testInfo) => {
    const { page } = harness
    const server = new FakeCollectionServer()
    await server.install(page)

    // Make the owned card a holo first, so undo has a non-default variant to restore.
    let detail = await openDetail(page, 4)
    await detail.getByRole("button", { name: "Holo", exact: true }).click()
    await expect.poll(() => server.rows.get(4)?.card_finish).toBe("holo")
    const ownedRow = { ...server.rows.get(4)! }

    const remove = detail.getByRole("button", { name: "Remove", exact: true })
    await harness.expectMinTapTarget(remove)
    await remove.click()
    const sheet = removeSheet(page, "charmander")
    await expect(sheet).toBeVisible()
    const toWanted = sheet.getByRole("button", { name: /move back to wanted/i })
    const removeCompletely = sheet.getByRole("button", { name: /remove completely/i })
    await harness.expectMinTapTarget(toWanted)
    await harness.expectMinTapTarget(removeCompletely)
    await harness.expectWithinSafeViewport(toWanted)
    await harness.expectHittable(toWanted)
    await harness.expectNoHorizontalOverflow()
    await snap(page, testInfo, "sheet")

    await toWanted.click()
    await expect(sheet).toHaveCount(0)

    // One write: the slot is wanted, the owned card is gone and is now the first wanted card.
    await expect.poll(() => server.rows.get(4)?.status).toBe("wishlisted")
    const wantedRow = server.rows.get(4)!
    expect(wantedRow.card_id).toBeNull()
    expect((wantedRow.wanted_cards as WantedRow[])[0]).toEqual(expect.objectContaining({ card_id: "base1-46", card_language: "en", card_finish: "holo" }))
    expect(server.writes.filter((write) => write.status === 200).map((write) => write.method)).toEqual(["POST", "POST"])

    // The detail sheet now shows the wanted state.
    detail = page.getByRole("dialog", { name: /details$/i })
    await expect(detail.getByRole("button", { name: "Clear", exact: true })).toBeVisible()
    await expect(detail.getByRole("button", { name: "Remove", exact: true })).toHaveCount(0)

    const snackbar = undoSnackbar(page)
    await expect(snackbar).toContainText(/charmander moved back to wanted/i)
    const undo = snackbar.getByRole("button", { name: "Undo", exact: true })
    await harness.expectMinTapTarget(undo)
    await harness.expectHittable(undo)
    await snap(page, testInfo, "undo")
    await undo.click()
    await expect(snackbar).toHaveCount(0)

    // Owned again with the same card, finish, language and status; the wanted list is as it was.
    await expect.poll(() => server.rows.get(4)?.status).toBe("collected")
    const restored = server.rows.get(4)!
    for (const key of ["card_id", "card_name", "card_set", "card_language", "card_finish", "status"] as const) {
      expect(restored[key], key).toEqual(ownedRow[key])
    }
    expect(restored.wanted_cards).toEqual([])
    await expect(detail.getByRole("button", { name: "Remove", exact: true })).toBeVisible()
    await expect(detail.getByRole("button", { name: "Holo", exact: true })).toHaveAttribute("aria-pressed", "true")
  })

  test("list view: owned, then wanted, then undo; remove completely also undoes", async ({ harness }) => {
    const { page } = harness
    const server = new FakeCollectionServer()
    await server.install(page)
    await openList(harness)

    const owned = page.getByRole("button", { name: /^owned: remove bulbasaur$/i })
    await expect(owned).toBeVisible()
    await harness.expectMinTapTarget(owned)
    await owned.click()
    const sheet = removeSheet(page, "bulbasaur")
    await sheet.getByRole("button", { name: /move back to wanted/i }).click()
    await expect(owned).toHaveCount(0)
    await expect(undoSnackbar(page)).toContainText(/bulbasaur moved back to wanted/i)
    await expect.poll(() => server.rows.get(1)?.status).toBe("wishlisted")
    expect((server.rows.get(1)!.wanted_cards as WantedRow[]).map((card) => card.card_id)).toEqual(["base1-44"])
    await undoSnackbar(page).getByRole("button", { name: "Undo", exact: true }).click()
    await expect.poll(() => server.rows.get(1)?.status).toBe("collected")
    expect(server.rows.get(1)!.card_id).toBe("base1-44")
    expect(server.rows.get(1)!.wanted_cards).toEqual([])
    await expect(owned).toBeVisible()

    // Remove completely deletes the slot; undo puts it back.
    await owned.click()
    await removeSheet(page, "bulbasaur").getByRole("button", { name: /remove completely/i }).click()
    await expect.poll(() => server.rows.has(1)).toBe(false)
    await expect(undoSnackbar(page)).toContainText(/bulbasaur removed/i)
    await undoSnackbar(page).getByRole("button", { name: "Undo", exact: true }).click()
    await expect.poll(() => server.rows.get(1)?.card_id).toBe("base1-44")
    expect(server.rows.get(1)!.status).toBe("collected")
    await expect(owned).toBeVisible()
  })

  test("cancel leaves the card owned and writes nothing", async ({ harness }) => {
    const { page } = harness
    const server = new FakeCollectionServer()
    await server.install(page)
    const detail = await openDetail(page, 1)
    await detail.getByRole("button", { name: "Remove", exact: true }).click()
    const sheet = removeSheet(page, "bulbasaur")
    await expect(sheet).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(sheet).toHaveCount(0)
    await expect(page.getByRole("dialog", { name: /details$/i })).toBeVisible()
    expect(server.writes).toEqual([])
  })

  test("offline: move to Wanted and undo go through the offline queue and leave the server row unchanged", async ({ harness }) => {
    const { page } = harness
    const server = new FakeCollectionServer()
    await server.install(page)

    const detail = await openDetail(page, 1)
    await setNetwork(page, true)
    await detail.getByRole("button", { name: "Remove", exact: true }).click()
    await removeSheet(page, "bulbasaur").getByRole("button", { name: /move back to wanted/i }).click()
    await expect(detail.getByRole("button", { name: "Clear", exact: true })).toBeVisible()
    const queued = await page.evaluate(() => JSON.parse(localStorage.getItem("pokemon_collection_pending_ops_v1") ?? "[]"))
    expect(queued).toHaveLength(1)
    expect(queued[0].item.status).toBe("wishlisted")

    await undoSnackbar(page).getByRole("button", { name: "Undo", exact: true }).click()
    await expect(detail.getByRole("button", { name: "Remove", exact: true })).toBeVisible()
    expect(server.writes, "nothing is sent while offline").toEqual([])

    await setNetwork(page, false)
    await expect.poll(() => page.evaluate(() => localStorage.getItem("pokemon_collection_pending_ops_v1")), { timeout: 20_000 }).toBe("[]")
    expect(server.rows.get(1)).toEqual(expect.objectContaining({ status: "collected", card_id: "base1-44", card_finish: "normal", card_language: "en" }))
    expect(server.writes.filter((write) => write.method === "DELETE")).toEqual([])
  })
})
