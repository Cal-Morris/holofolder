import { test, expect } from "./fixtures"
import { syntheticSlotPickerSnapshot } from "../tests/fixtures/slot-picker"

test.describe("explicit stable-slot picker", () => {
  test.use({ signedIn: true })
  test.beforeEach(async ({ harness }) => {
    const { page } = harness
    // Entirely synthetic catalog, grades and ownership, with no database executor.
    const { cards } = syntheticSlotPickerSnapshot()
    await page.route("**/app/api/tcg-card-search**", route => {
      const params = new URL(route.request().url()).searchParams
      expect(params.get("includeNonPokemon")).toBe("1")
      const q = params.get("q")?.toLowerCase() ?? ""
      return route.fulfill({ json: { cards: cards.filter(c => `${c.id} ${c.name}`.toLowerCase().includes(q)) } })
    })
    await page.route("**/app/api/card-prices", route => route.fulfill({ json: { prices: [] } }))
    await page.goto("/app/e2e-harness?signedIn=1&slots=picker&rows=2&cols=4")
  })
  const details = (page: import("@playwright/test").Page) => page.getByRole("dialog", { name: /details$/ })

  test("selects non-dex card for only the selected slot with no write transport", async ({ harness }) => {
    const { page } = harness
    const writes: string[] = []
    page.on("request", r => { if (/\/api\/(inventory|binder-slots|collection)(\?|$)/.test(r.url()) && r.method() !== "GET") writes.push(r.url()) })
    await page.locator('button[data-slot-id="slot-g"]').click()
    const dialog = details(page)
    await dialog.getByRole("button", { name: "Choose card", exact: true }).click()
    await dialog.getByRole("textbox", { name: "Search slot catalog" }).fill("Trainer")
    await dialog.getByRole("button", { name: /^Trainer ·/ }).click()
    await dialog.getByRole("button", { name: "Normal", exact: true }).click()
    await expect(page.getByLabel("Synthetic draft count")).toHaveText("1")
    await expect(dialog).toContainText("Owned copy")
    await expect(dialog).toContainText("Internal draft only")
    await expect(page.locator('button[data-slot-id="slot-c"]')).toHaveAccessibleName("Trainer, Owned")
    await harness.expectWithinSafeViewport(dialog)
    await harness.expectNoHorizontalOverflow()
    const box = (await dialog.boundingBox())!, dock = (await harness.dock().boundingBox())!
    expect(box.y + box.height).toBeLessThanOrEqual(dock.y)
    console.log("picker geometry", test.info().project.name, JSON.stringify({ sheet: box, dockTop: dock.y }))
    for (const action of await dialog.getByRole("button").all()) await harness.expectMinTapTarget(action, 36)
    expect(writes).toEqual([])
  })

  test("rejects mismatched target and cancels without emitting a draft", async ({ harness }) => {
    const { page } = harness
    await page.locator('button[data-slot-id="slot-e"]').click()
    const dialog = details(page)
    await dialog.getByRole("button", { name: "Choose card", exact: true }).click()
    await dialog.getByRole("textbox", { name: "Search slot catalog" }).fill("Energy")
    await dialog.getByRole("button", { name: /^Energy ·/ }).click()
    await dialog.getByRole("button", { name: "Normal", exact: true }).click()
    await expect(dialog.getByRole("alert")).toContainText("does not match")
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
    await expect(page.getByLabel("Synthetic draft count")).toHaveText("0")
    await expect(page.locator('button[data-slot-id="slot-e"]')).toHaveAccessibleName("snorlax, Unfilled target")
  })

  test("incompatible occupied target preserves contents; remove target and clear differ", async ({ harness }) => {
    const { page } = harness
    await page.locator('button[data-slot-id="slot-a"]').click()
    const dialog = details(page)
    await dialog.getByRole("button", { name: "Change target", exact: true }).click()
    await dialog.getByRole("textbox", { name: "Search slot catalog" }).fill("pikachu")
    await dialog.getByRole("button", { name: "Target Pokémon: pikachu", exact: true }).click()
    await expect(dialog.getByRole("alert")).toContainText("clear contents first")
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
    await expect(dialog).toContainText("item-a")
    await expect(page.getByLabel("Synthetic draft count")).toHaveText("0")
    await dialog.getByRole("button", { name: "Remove target", exact: true }).click()
    await expect(dialog).toContainText("item-a")
    await expect(dialog.getByRole("button", { name: "Set target", exact: true })).toBeVisible()
    await dialog.getByRole("button", { name: "Clear contents", exact: true }).click()
    await expect(dialog).toContainText("no target or owned copy")
    await expect(page.getByLabel("Synthetic draft count")).toHaveText("2")
    await harness.closeControl(dialog).click()
    await page.locator('button[data-slot-id="slot-b"]').click()
    await details(page).getByRole("button", { name: "Clear contents", exact: true }).click()
    await expect(details(page)).toContainText("Unfilled target")
    await expect(details(page).getByRole("button", { name: "Remove target", exact: true })).toBeVisible()
  })

  test("recorded Raw and grade choices retain item IDs without leaking certificate or labels", async ({ harness }) => {
    const { page } = harness
    await page.locator('button[data-slot-id="slot-g"]').click()
    const dialog = details(page)
    await dialog.getByRole("button", { name: "Choose card", exact: true }).click()
    await dialog.getByRole("textbox", { name: "Search slot catalog" }).fill("Snorlax A")
    await dialog.getByRole("button", { name: /^Snorlax A ·/ }).click()
    await dialog.getByRole("button", { name: "Normal", exact: true }).click()
    await expect(dialog.getByRole("button", { name: "Select Raw", exact: true })).toBeVisible()
    await expect(dialog).toContainText("Already placed in Synthetic binder")
    await expect(dialog).not.toContainText("PRIVATE")
    await dialog.getByRole("button", { name: "Select PSA 9", exact: true }).click()
    await expect(dialog).toContainText("unassigned-grade")
    await expect(dialog).toContainText("PSA")
    await expect(dialog).not.toContainText("PRIVATE")
    await expect(page.getByLabel("Synthetic draft count")).toHaveText("1")
  })

  test("cached non-dex cards cannot suppress legacy offline Pokemon corrections", async ({ harness, context }) => {
    const { page } = harness
    // Complete a real interaction before using the effect-installed keyboard shortcut.
    await page.locator('button[data-slot-id="slot-g"]').click()
    await harness.closeControl(details(page)).click()
    await expect(details(page)).toHaveCount(0)
    await page.keyboard.press("Control+k")
    const quick = page.getByRole("dialog", { name: "Quick mode" })
    await expect(quick).toBeVisible()
    await quick.getByRole("button", { name: "Close quick mode", exact: true }).click()
    const fixture = syntheticSlotPickerSnapshot().cards
    const cards = [{ ...fixture[0], name: "Bulbasaur", dexIds: [1] }, { ...fixture[2], name: "Bulbasaurr", dexIds: [] }]
    await page.evaluate(async cards => {
      const cache = await caches.open("synthetic-picker-data")
      await cache.put("/app/api/tcg-card-search?q=bulbasaurr&includeNonPokemon=1", new Response(JSON.stringify({ cards }), { headers: { "content-type": "application/json" } }))
    }, cards)
    await context.setOffline(true)
    await page.keyboard.press("Control+k")
    await expect(quick).toBeVisible()
    await quick.getByRole("searchbox").fill("synthetic bulbasaurr")
    await expect(quick.getByRole("button", { name: /^Bulbasaur, Synthetic set/ })).toBeVisible()
    await expect(quick.getByRole("status").filter({ hasText: "Showing cards for" })).toContainText("bulbasaur")
    await context.setOffline(false)
  })

  test("cached non-dex cards work offline and missing coverage is explicit", async ({ harness, context }) => {
    const { page } = harness
    const energy = { ...syntheticSlotPickerSnapshot().cards.find(c => c.name === "Energy")!, language: undefined }
    await page.evaluate(async card => {
      const cache = await caches.open("synthetic-picker-data")
      await cache.put("/app/api/tcg-card-search?q=energy", new Response(JSON.stringify({ cards: [card] }), { headers: { "content-type": "application/json" } }))
    }, energy)
    // Warm the existing dynamically loaded detail before disconnecting.
    await page.locator('button[data-slot-id="slot-g"]').click()
    await expect(details(page)).toBeVisible()
    await context.setOffline(true)
    await expect(details(page)).toHaveCount(0)
    await page.locator('button[data-slot-id="slot-g"]').click()
    const dialog = details(page)
    await dialog.getByRole("button", { name: "Choose card", exact: true }).click()
    const search = dialog.getByRole("textbox", { name: "Search slot catalog" })
    await search.fill("uncached")
    await expect(dialog).toContainText("Uncached catalog coverage is unavailable offline")
    await expect(dialog).toContainText("No matching cached or available catalog cards")
    await search.fill("Energy")
    await dialog.getByRole("button", { name: /^Energy ·/ }).click()
    await dialog.getByRole("button", { name: "Normal", exact: true }).click()
    await expect(page.getByLabel("Synthetic draft count")).toHaveText("1")
    await expect(dialog).toContainText("Owned copy")
    await expect(dialog).toContainText("Unknown language")
    await context.setOffline(false)
  })

  test("every sheet dismissal cancels selection above the dock without drafts", async ({ harness }) => {
    const { page } = harness
    const open = async () => {
      await page.locator('button[data-slot-id="slot-g"]').click()
      const dialog = details(page)
      await dialog.getByRole("button", { name: "Set target", exact: true }).click()
      await dialog.getByRole("textbox", { name: "Search slot catalog" }).fill("Snorlax")
      await harness.expectWithinSafeViewport(dialog)
      await harness.expectMinTapTarget(harness.closeControl(dialog), 36)
      await harness.expectHittable(harness.closeControl(dialog))
      return dialog
    }
    let dialog = await open()
    await harness.closeControl(dialog).click()
    await expect(dialog).toHaveCount(0)
    dialog = await open()
    await page.keyboard.press("Escape")
    await expect(dialog).toHaveCount(0)
    dialog = await open()
    await page.goBack()
    await expect(dialog).toHaveCount(0)
    expect(page.url()).toContain("e2e-harness")
    dialog = await open()
    await harness.tapBackdrop(dialog)
    await expect(dialog).toHaveCount(0)
    dialog = await open()
    await harness.swipeDown(dialog)
    await expect(dialog).toHaveCount(0)
    dialog = await open()
    await harness.dock().getByRole("button", { name: "List", exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByLabel("Synthetic draft count")).toHaveText("0")
    await harness.expectScrollUnlocked()
    await harness.expectNoHorizontalOverflow()
  })
  test("single-finish ordinary selection hands off immediately, raw groups use the stable copy", async ({ harness }) => {
    const { page } = harness
    const card = { ...syntheticSlotPickerSnapshot().cards.find(c => c.name === "Energy")!, variants: { normal: true } }
    await page.route("**/app/api/tcg-card-search**", route => route.fulfill({ json: { cards: [card] } }))
    await page.locator('button[data-slot-id="slot-g"]').click()
    let dialog = details(page)
    await dialog.getByRole("button", { name: "Choose card", exact: true }).click()
    await dialog.getByRole("textbox", { name: "Search slot catalog" }).fill("Energy")
    await dialog.getByRole("button", { name: /^Energy ·/ }).click()
    await expect(page.getByLabel("Synthetic draft count")).toHaveText("1")
    await dialog.getByRole("button", { name: "Clear contents", exact: true }).click()
    await page.unroute("**/app/api/tcg-card-search**")
    const snorlax = syntheticSlotPickerSnapshot().cards[0]
    await page.route("**/app/api/tcg-card-search**", route => route.fulfill({ json: { cards: [snorlax] } }))
    dialog = details(page)
    await dialog.getByRole("button", { name: "Choose card", exact: true }).click()
    await dialog.getByRole("textbox", { name: "Search slot catalog" }).fill("Snorlax")
    await dialog.getByRole("button", { name: /^Snorlax A ·/ }).click()
    await dialog.getByRole("button", { name: "Normal", exact: true }).click()
    await dialog.getByRole("button", { name: "Select Raw", exact: true }).click()
    await expect(dialog).toContainText("unassigned-a")
    await expect(page.getByLabel("Synthetic draft count")).toHaveText("3")
  })

  test("provider-confirmed finish and requested catalog language survive selection", async ({ harness }) => {
    const { page } = harness
    // Synthetic Japanese catalog record and provider-confirmed standard finish quotes.
    const card = { ...syntheticSlotPickerSnapshot().cards[2], language: "ja", variants: { normal: true } }
    const requested: string[] = []
    await page.route("**/app/api/tcg-card-search**", route => {
      requested.push(new URL(route.request().url()).searchParams.get("language") ?? "missing")
      return route.fulfill({ json: { cards: [card] } })
    })
    await page.route("**/app/api/card-prices", route => route.fulfill({ json: { prices: [{ cardId: card.id, language: "ja", gbpAmount: 1, updatedAt: "2026-11-09T00:00:00Z", finishPrices: [
      { cardId: card.id, language: "ja", finish: "normal", variantKey: "normal", gbpAmount: 1 },
      { cardId: card.id, language: "ja", finish: "reverse_holo", variantKey: "reverse-holofoil", gbpAmount: 2 },
    ] }] } }))
    await page.locator('button[data-slot-id="slot-g"]').click()
    const dialog = details(page)
    await dialog.getByRole("button", { name: "Choose card", exact: true }).click()
    await dialog.getByRole("combobox", { name: "Catalog language" }).selectOption("ja")
    await dialog.getByRole("textbox", { name: "Search slot catalog" }).fill("Trainer")
    await dialog.getByRole("button", { name: /^Trainer ·/ }).click()
    await dialog.getByRole("button", { name: "Reverse", exact: true }).click()
    await expect(page.getByLabel("Synthetic draft count")).toHaveText("1")
    await expect(dialog).toContainText("ja · reverse holo")
    expect(requested).toContain("ja")
  })

  test("read-only staged boundaries expose no picker controls", async ({ harness }) => {
    const { page } = harness
    await page.goto("/app/e2e-harness?signedIn=1&slots=picker&readOnly=1&rows=2&cols=4")
    await page.locator('button[data-slot-id="slot-g"]').click()
    await expect(details(page)).toBeVisible()
    await expect(details(page).getByRole("button", { name: /Choose card|Set target|Clear contents/ })).toHaveCount(0)
    await expect(page.getByLabel("Synthetic draft count")).toHaveText("0")
  })

  test("same-document owner and binder switches cancel unfinished selection", async ({ harness }) => {
    const { page } = harness
    for (const kind of ["owner", "binder"]) {
      await page.locator('button[data-slot-id="slot-g"]').click()
      const dialog = details(page)
      await dialog.getByRole("button", { name: "Choose card", exact: true }).click()
      await dialog.getByRole("textbox", { name: "Search slot catalog" }).fill("Snorlax A")
      await dialog.getByRole("button", { name: /^Snorlax A ·/ }).click()
      await expect(dialog.getByRole("button", { name: "Normal", exact: true })).toBeVisible()
      await page.evaluate(kind => window.dispatchEvent(new CustomEvent("synthetic-slot-scope-change", { detail: kind })), kind)
      await expect(dialog).toHaveCount(0)
      await expect(page.getByLabel("Synthetic draft count")).toHaveText("0")
      await page.locator('button[data-slot-id="slot-g"]').click()
      await expect(details(page).getByRole("button", { name: "Choose card", exact: true })).toBeVisible()
      await harness.closeControl(details(page)).click()
    }
  })

  test("long custom grading labels wrap without overflow and remain tappable", async ({ harness }) => {
    const { page } = harness
    const name = "CustomGrader".repeat(16)
    await page.locator('button[data-slot-id="slot-g"]').click()
    const dialog = details(page)
    await dialog.getByRole("button", { name: "Choose card", exact: true }).click()
    await page.evaluate(name => window.dispatchEvent(new CustomEvent("synthetic-slot-grading-change", { detail: name })), name)
    await dialog.getByRole("textbox", { name: "Search slot catalog" }).fill("Snorlax A")
    await dialog.getByRole("button", { name: /^Snorlax A ·/ }).click()
    await dialog.getByRole("button", { name: "Normal", exact: true }).click()
    const choice = dialog.getByRole("button", { name: `Select ${name} 9`, exact: true })
    await expect(choice).toBeVisible()
    await harness.expectMinTapTarget(choice, 36)
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    await harness.expectNoHorizontalOverflow()
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
    await expect(page.getByLabel("Synthetic draft count")).toHaveText("0")
  })

  test("long catalog labels wrap without overflow and remain tappable", async ({ harness }) => {
    const { page } = harness
    const card = { ...syntheticSlotPickerSnapshot().cards[2], name: `Trainer${"X".repeat(180)}`, set: { id: "synthetic", name: "Set".repeat(80) } }
    await page.route("**/app/api/tcg-card-search**", route => route.fulfill({ json: { cards: [card] } }))
    await page.locator('button[data-slot-id="slot-g"]').click()
    const dialog = details(page)
    await dialog.getByRole("button", { name: "Choose card", exact: true }).click()
    await dialog.getByRole("textbox", { name: "Search slot catalog" }).fill("Trainer")
    const hit = dialog.getByRole("button", { name: new RegExp(`^${card.name}`) })
    await expect(hit).toBeVisible()
    await harness.expectMinTapTarget(hit, 36)
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    await harness.expectNoHorizontalOverflow()
    await hit.click()
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
    await expect(page.getByLabel("Synthetic draft count")).toHaveText("0")
  })

  test("sets a printing target on the explicit free slot without creating ownership", async ({ harness }) => {
    const { page } = harness
    await page.locator('button[data-slot-id="slot-g"]').click()
    const dialog = details(page)
    await dialog.getByRole("button", { name: "Set target", exact: true }).click()
    await dialog.getByRole("textbox", { name: "Search slot catalog" }).fill("Trainer")
    await dialog.getByRole("button", { name: /^Trainer ·/ }).click()
    await dialog.getByRole("button", { name: "Normal", exact: true }).click()
    await dialog.getByRole("button", { name: "Set printing target", exact: true }).click()
    await expect(page.getByLabel("Synthetic draft count")).toHaveText("1")
    await expect(dialog).toContainText("Unfilled target, no owned copy assigned")
    await expect(dialog.getByRole("button", { name: "Change target", exact: true })).toBeVisible()
    await expect(page.locator('button[data-slot-id="slot-g"]')).toHaveAccessibleName("Trainer, Unfilled target")
  })

})
