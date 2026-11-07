import { test, expect, E2E_USER } from "./fixtures"
import { FakeCollectionServer, setNetwork } from "./collection-server"
import type { WantedCard } from "../lib/domain/cards"

// Synthetic wants deliberately share an ID across languages and finishes.
const normal: WantedCard = { card_id: "sv03.5-004", card_name: "Charmander", card_set: "151", card_language: "en", card_finish: "normal", added_at: "2026-01-01", wanted_by: [E2E_USER.id] }
const holo: WantedCard = { ...normal, card_finish: "holo" }
const japanese: WantedCard = { ...normal, card_language: "ja" }

test.describe("specific wanted card actions", () => {
  test.use({ signedIn: true })

  test("tapping a non-first want removes only that printing and Undo restores it", async ({ harness }, testInfo) => {
    const { page } = harness
    const server = new FakeCollectionServer()
    server.rows.set(4, { ...server.rows.get(4)!, wanted_cards: [normal, holo, japanese] })
    await server.install(page)
    await harness.open()
    await harness.dock().getByRole("button", { name: "Wanted", exact: true }).click()
    const row = page.getByTestId("wanted-row").filter({ hasText: "Holo" })
    await row.getByRole("button", { name: /^Open Charmander/ }).click()
    const detail = page.getByRole("dialog", { name: /details$/i })
    const remove = detail.getByRole("button", { name: "Remove from want list", exact: true }).first()
    await expect(remove).toBeVisible()
    await harness.expectMinTapTarget(remove, 36)
    await harness.expectWithinSafeViewport(remove)
    await page.screenshot({ path: testInfo.outputPath("wanted-card-actions.png") })
    await remove.click()
    await expect.poll(() => server.rows.get(4)?.wanted_cards).toEqual([normal, japanese])
    expect(server.rows.get(4)?.card_id).toBe("base1-46")
    await page.getByTestId("undo-snackbar").getByRole("button", { name: "Undo", exact: true }).click()
    await expect.poll(() => server.rows.get(4)?.wanted_cards).toEqual([normal, holo, japanese])
    await harness.expectNoHorizontalOverflow()
  })

  test("Show mode offers direct wanted removal and change without touching the owned card", async ({ harness }) => {
    const { page } = harness
    const server = new FakeCollectionServer()
    const savedHolo: WantedCard = { ...holo, rarity: "Ultra Rare" }
    server.rows.set(4, { ...server.rows.get(4)!, wanted_cards: [savedHolo] })
    await server.install(page)
    await harness.open()
    await page.getByRole("button", { name: "Show mode", exact: true }).click()
    await harness.dock().getByRole("button", { name: "Search", exact: true }).click()
    const quick = page.getByRole("dialog", { name: "Quick mode" })
    await quick.getByRole("button", { name: /Charmander, 151/ }).first().click()
    const check = quick.getByTestId("quick-card-check")
    await expect(check.getByRole("button", { name: "Change wanted card", exact: true })).toBeVisible()
    const remove = check.getByRole("button", { name: "Remove from want list", exact: true })
    await harness.expectMinTapTarget(remove, 36)
    await remove.click()
    await expect.poll(() => server.rows.get(4)?.wanted_cards).toEqual([])
    expect(server.rows.get(4)?.card_id).toBe("base1-46")
    await check.getByTestId("undo-snackbar").getByRole("button", { name: "Undo", exact: true }).click()
    await expect.poll(() => server.rows.get(4)?.wanted_cards).toEqual([savedHolo])
    await check.getByRole("button", { name: "Change wanted card", exact: true }).click()
    const picker = page.getByRole("dialog", { name: /card selector/i })
    await expect(picker).toBeVisible()
    await expect(quick).toBeHidden()
    await expect(picker.getByRole("button", { name: "Remove from want list", exact: true })).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(picker).toBeHidden()
    expect(server.rows.get(4)?.wanted_cards).toEqual([savedHolo])
  })

  for (const queued of [false, true]) test(`changing a wanted printing keeps owned, siblings, assignment and Undo${queued ? " after a transient failure" : ""}`, async ({ harness }) => {
    const { page } = harness
    const server = new FakeCollectionServer()
    server.rows.set(4, { ...server.rows.get(4)!, wanted_cards: [normal, holo, japanese] })
    if (queued) server.failNext.push({ method: "POST", pokemonId: 4, status: 503 })
    await server.install(page)
    await harness.open()
    await harness.dock().getByRole("button", { name: "Wanted", exact: true }).click()
    await page.getByTestId("wanted-row").filter({ hasText: "Holo" }).getByRole("button", { name: /^Open Charmander/ }).click()
    await page.getByRole("dialog", { name: /details$/i }).getByRole("button", { name: "Change wanted card", exact: true }).first().click()
    const picker = page.getByRole("dialog", { name: /card selector/i })
    await picker.getByRole("button", { name: "Want card Charmander from Base Set", exact: true }).click()
    await expect(picker).toBeHidden()
    await expect.poll(() => (server.rows.get(4)?.wanted_cards as WantedCard[])[1]?.card_id, { timeout: 20_000 }).toBe("base1-46")
    const wants = server.rows.get(4)?.wanted_cards as WantedCard[]
    expect(wants).toHaveLength(3)
    expect(wants[0]).toEqual(normal)
    expect(wants[2]).toEqual(japanese)
    expect(wants[1].wanted_by).toEqual(holo.wanted_by)
    expect(wants[1].added_at).toBe(holo.added_at)
    expect(server.rows.get(4)?.card_id).toBe("base1-46")
    expect(server.writes.filter(write => write.status === 200)).toHaveLength(1)
    await page.getByTestId("undo-snackbar").getByRole("button", { name: "Undo", exact: true }).click()
    await expect.poll(() => server.rows.get(4)?.wanted_cards).toEqual([normal, holo, japanese])
  })

  test("wanted-only removal keeps the other wants and queues safely offline", async ({ harness }) => {
    const { page } = harness
    const server = new FakeCollectionServer()
    server.rows.set(4, { ...server.rows.get(4)!, status: "wishlisted", card_id: null, card_name: null, wanted_cards: [normal, holo] })
    await server.install(page)
    await harness.open()
    await page.locator('button[data-dex-id="4"]').first().click()
    const detail = page.getByRole("dialog", { name: /details$/i })
    await setNetwork(page, true)
    await detail.getByRole("button", { name: "Remove from want list", exact: true }).first().click()
    await expect(detail.getByRole("button", { name: "Remove from want list", exact: true })).toHaveCount(1)
    await setNetwork(page, false)
    await expect.poll(() => server.rows.get(4)?.wanted_cards).toEqual([holo])
    expect(server.rows.get(4)?.status).toBe("wishlisted")
    await detail.getByRole("button", { name: "Remove from want list", exact: true }).click()
    await expect.poll(() => server.rows.has(4)).toBe(false)
    await page.getByTestId("undo-snackbar").getByRole("button", { name: "Undo", exact: true }).click()
    await expect.poll(() => server.rows.get(4)?.wanted_cards).toEqual([holo])
  })

  test("the card browser removes an explicitly labelled variant only", async ({ harness }) => {
    const { page } = harness
    const server = new FakeCollectionServer()
    server.rows.set(4, { ...server.rows.get(4)!, wanted_cards: [normal, holo, japanese] })
    await server.install(page)
    await harness.open()
    await page.locator('button[data-dex-id="4"]').first().click()
    await page.getByRole("button", { name: "All Charmander cards", exact: true }).click()
    const remove = page.getByRole("button", { name: /Remove from want list: Charmander 004\/165, English, Holo/ })
    await remove.click()
    await expect.poll(() => server.rows.get(4)?.wanted_cards).toEqual([normal, japanese])
    expect(server.rows.get(4)?.card_id).toBe("base1-46")
  })

  test("a hard removal failure keeps the wanted card and offers no Undo", async ({ harness }) => {
    const { page } = harness
    const server = new FakeCollectionServer()
    server.rows.set(4, { ...server.rows.get(4)!, wanted_cards: [normal] })
    server.failNext.push({ method: "POST", pokemonId: 4, status: 403 })
    await server.install(page)
    await harness.open()
    await page.locator('button[data-dex-id="4"]').first().click()
    const detail = page.getByRole("dialog", { name: /details$/i })
    await detail.getByRole("button", { name: "Remove from want list", exact: true }).click()
    await expect.poll(() => server.writes.map(write => write.status)).toEqual([403])
    await expect(detail.getByRole("button", { name: "Remove from want list", exact: true })).toBeVisible()
    expect(server.rows.get(4)?.wanted_cards).toEqual([normal])
    await expect(page.getByTestId("undo-snackbar")).toHaveCount(0)
  })

  test("Show card details retain the printing and allow wanted edits, owned edits and a slot jump", async ({ harness }) => {
    const { page } = harness
    const server = new FakeCollectionServer()
    const saved = { ...holo, rarity: "Ultra Rare" }
    server.rows.set(4, { ...server.rows.get(4)!, wanted_cards: [normal, saved] })
    await server.install(page)
    await harness.open()
    await page.getByRole("button", { name: "Show mode", exact: true }).click()
    await harness.dock().getByRole("button", { name: "Search", exact: true }).click()
    const quick = page.getByRole("dialog", { name: "Quick mode" })
    await quick.getByRole("button", { name: /Charmander, 151.*Holo/ }).click()
    await quick.getByRole("button", { name: "More details", exact: true }).click()
    const details = page.getByRole("region", { name: "Card details" })
    await expect(details).toContainText("Holo")
    await details.getByRole("button", { name: "Remove from want list", exact: true }).click()
    await expect.poll(() => server.rows.get(4)?.wanted_cards).toEqual([normal])
    expect(server.rows.get(4)?.card_id).toBe("base1-46")
    await details.getByRole("button", { name: "Add to want list", exact: true }).click()
    await expect.poll(() => (server.rows.get(4)?.wanted_cards as WantedCard[])[0]?.card_finish).toBe("holo")
    await details.getByRole("checkbox", { name: /Replace Charmander/ }).check()
    await details.getByRole("button", { name: "Add to owned", exact: true }).click()
    await expect.poll(() => server.rows.get(4)?.card_id).toBe(normal.card_id)
    expect(server.rows.get(4)?.card_finish).toBe("holo")
    await expect(page.getByRole("dialog", { name: "All Charmander cards" }).getByTestId("undo-snackbar").getByRole("button", { name: "Undo", exact: true })).toBeVisible()
    await expect(details.getByRole("button", { name: "Remove owned card", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Want Charmander 168/165", exact: true }).click()
    await expect(page.getByTestId("undo-snackbar")).toHaveCount(0)
    await expect.poll(() => (server.rows.get(4)?.wanted_cards as WantedCard[]).some(card => card.card_id === "sv03.5-168")).toBe(true)
    await details.getByRole("button", { name: "Jump to binder slot", exact: true }).click()
    await expect(page.getByRole("dialog", { name: "All Charmander cards" })).toBeHidden()
    await expect(page.getByRole("dialog", { name: "Charmander details" })).toBeVisible()
  })
})
