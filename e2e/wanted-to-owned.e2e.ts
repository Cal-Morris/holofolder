import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures"
import { FakeCollectionServer, setNetwork } from "./collection-server"

type WantedRow = { card_id: string }

const SQUIRTLE = 7

function slot(page: Page) {
  return page.locator(`button[data-dex-id="${SQUIRTLE}"]`).first()
}

async function openDetail(page: Page) {
  await slot(page).click()
  const dialog = page.getByRole("dialog", { name: /squirtle details/i })
  await expect(dialog).toBeVisible()
  return dialog
}

async function pickFromSelector(page: Page, action: "Add card" | "Want card", setName: string) {
  const selector = page.getByRole("dialog", { name: /card selector/i })
  await expect(selector).toBeVisible()
  const button = selector.getByRole("button", { name: `${action} Squirtle from ${setName}`, exact: true })
  await expect(button).toBeVisible()
  await button.click()
  await expect(selector).toHaveCount(0)
}

/** Make Squirtle a wanted slot through the UI: Want card → pick the printing. */
async function wantSquirtle(page: Page, server: FakeCollectionServer, setName: string, cardId: string) {
  const detail = await openDetail(page)
  await detail.getByRole("button", { name: /^(want card|add wanted|track wanted)$/i }).click()
  await pickFromSelector(page, "Want card", setName)
  await expect.poll(() => server.rows.get(SQUIRTLE)?.status).toBe("wishlisted")
  expect((server.rows.get(SQUIRTLE)!.wanted_cards as WantedRow[]).map((card) => card.card_id)).toEqual([cardId])
  await expect(slot(page).getByText("Wanted", { exact: true })).toBeVisible()
}

const CASES = [
  { label: "a normal set", setName: "151", cardId: "sv03.5-007" },
  { label: "30th Celebration", setName: "30th Celebration", cardId: "30th-007" },
  { label: "30th Classic Collection", setName: "30th Classic Collection", cardId: "30th-c-003" },
] as const

test.describe("adding a card to a wanted slot", () => {
  test.use({ signedIn: true })

  for (const { label, setName, cardId } of CASES) {
    test(`the wanted card from ${label} becomes owned`, async ({ harness }) => {
      const { page } = harness
      const server = new FakeCollectionServer()
      await server.install(page)
      await wantSquirtle(page, server, setName, cardId)

      const detail = await openDetail(page)
      await detail.getByRole("button", { name: "Add card", exact: true }).click()
      await pickFromSelector(page, "Add card", setName)

      await expect.poll(() => server.rows.get(SQUIRTLE)?.status).toBe("collected")
      const row = server.rows.get(SQUIRTLE)!
      expect(row.card_id).toBe(cardId)
      expect(row.wanted_cards, "the wanted printing is fulfilled").toEqual([])

      // The slot reads as owned, not wanted, and stays that way after the next refresh.
      await expect(slot(page).getByText("Owned", { exact: true })).toBeVisible()
      await expect(slot(page).getByText(/^Wanted?$/)).toHaveCount(0)
      await page.evaluate(() => window.dispatchEvent(new Event("online")))
      await page.waitForTimeout(500)
      await expect(slot(page).getByText("Owned", { exact: true })).toBeVisible()
      const reopened = await openDetail(page)
      await expect(reopened.getByRole("button", { name: "Remove", exact: true })).toBeVisible()
      await harness.expectNoHorizontalOverflow()
    })
  }

  test("adding a different printing to a wanted slot fills the slot", async ({ harness }) => {
    const { page } = harness
    const server = new FakeCollectionServer()
    await server.install(page)
    await wantSquirtle(page, server, "30th Celebration", "30th-007")

    const detail = await openDetail(page)
    await detail.getByRole("button", { name: "Add card", exact: true }).click()
    await pickFromSelector(page, "Add card", "30th Classic Collection")

    await expect.poll(() => server.rows.get(SQUIRTLE)?.status).toBe("collected")
    expect(server.rows.get(SQUIRTLE)!.card_id).toBe("30th-c-003")
    expect(server.rows.get(SQUIRTLE)!.wanted_cards).toEqual([])
    await expect(slot(page).getByText("Owned", { exact: true })).toBeVisible()
  })

  test("an owned slot keeps an upgrade wanted card when a different printing is added", async ({ harness }) => {
    const { page } = harness
    const server = new FakeCollectionServer()
    await server.install(page)

    // Own the 151 printing, then want the 30th Celebration one as an upgrade.
    let detail = await openDetail(page)
    await detail.getByRole("button", { name: "Add card", exact: true }).click()
    await pickFromSelector(page, "Add card", "151")
    await expect.poll(() => server.rows.get(SQUIRTLE)?.card_id).toBe("sv03.5-007")
    detail = await openDetail(page)
    await detail.getByRole("button", { name: /^(want card|add wanted|track wanted)$/i }).click()
    await pickFromSelector(page, "Want card", "30th Celebration")
    await expect.poll(() => (server.rows.get(SQUIRTLE)?.wanted_cards as WantedRow[] | undefined)?.length).toBe(1)

    // Getting the upgrade itself clears it from the wanted list.
    detail = await openDetail(page)
    await detail.getByRole("button", { name: /^(edit card|add card)$/i }).first().click()
    await pickFromSelector(page, "Add card", "30th Celebration")
    await expect.poll(() => server.rows.get(SQUIRTLE)?.card_id).toBe("30th-007")
    expect(server.rows.get(SQUIRTLE)!.status).toBe("collected")
    expect(server.rows.get(SQUIRTLE)!.wanted_cards).toEqual([])
    await expect(slot(page).getByText("Owned", { exact: true })).toBeVisible()
  })

  test("offline: a wanted 30th Classic Collection slot becomes owned and syncs as owned", async ({ harness }) => {
    const { page } = harness
    const server = new FakeCollectionServer()
    await server.install(page)
    await wantSquirtle(page, server, "30th Classic Collection", "30th-c-003")

    const detail = await openDetail(page)
    await setNetwork(page, true)
    await detail.getByRole("button", { name: "Add card", exact: true }).click()
    await pickFromSelector(page, "Add card", "30th Classic Collection")
    await expect(slot(page).getByText("Owned", { exact: true })).toBeVisible()
    const queued = await page.evaluate(() => JSON.parse(localStorage.getItem("pokemon_collection_pending_ops_v1") ?? "[]"))
    expect(queued).toHaveLength(1)
    expect(queued[0].item).toEqual(expect.objectContaining({ status: "collected", card_id: "30th-c-003", wanted_cards: [] }))

    await setNetwork(page, false)
    await expect.poll(() => page.evaluate(() => localStorage.getItem("pokemon_collection_pending_ops_v1")), { timeout: 20_000 }).toBe("[]")
    expect(server.rows.get(SQUIRTLE)).toEqual(expect.objectContaining({ status: "collected", card_id: "30th-c-003", wanted_cards: [] }))
    await expect(slot(page).getByText("Owned", { exact: true })).toBeVisible()
  })
})
