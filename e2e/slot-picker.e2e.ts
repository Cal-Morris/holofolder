import { test, expect, Harness, mockBackends, emulateStandalone } from "./fixtures"
import { syntheticSlotPickerSnapshot } from "../tests/fixtures/slot-picker"

test.describe("explicit stable-slot picker", () => {
  test.use({ signedIn: true, harness: async ({ page, context, standalone, insets, baseURL }, provide) => {
    if (standalone) await emulateStandalone(page, insets)
    await mockBackends(page, context, { signedIn: true, baseURL })
    // These staged specs open their explicit synthetic slot surface, not authenticated startup.
    await provide(new Harness(page, insets, true))
  } })
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
    if (page.viewportSize()!.width >= 1024) await expect(page.getByRole("region", { name: "Inside cover", exact: true })).toBeVisible()
  })
  const details = (page: import("@playwright/test").Page) => page.getByRole("dialog", { name: /details$/ })
  const sheet = (page: import("@playwright/test").Page, name: string) => page.getByRole("dialog", { name, exact: true })
  const variant = (page: import("@playwright/test").Page) => sheet(page, "Which variant?")
  const count = (page: import("@playwright/test").Page) => page.getByLabel("Synthetic draft count")
  /** Structural slot controls live only in deliberate layout editing. */
  const editLayout = async (page: import("@playwright/test").Page) => {
    await page.getByRole("region", { name: "Layout editing", exact: true }).getByRole("button", { name: "Edit layout", exact: true }).click()
    await expect(page.getByRole("region", { name: "Layout editing", exact: true })).toContainText("Editing layout")
  }
  const cardOptions = async (dialog: import("@playwright/test").Locator) => {
    const options = dialog.locator("details").filter({ has: dialog.page().getByText("Card options", { exact: true }) })
    if ((await options.getAttribute("open")) === null) await options.locator("summary").click()
  }
  const search = async (page: import("@playwright/test").Page, slotId: string, query: string) => {
    await page.locator(`button[data-slot-id="${slotId}"]`).click()
    const dialog = details(page)
    await dialog.getByRole("textbox", { name: "Search slot catalog" }).fill(query)
    return dialog
  }

  test("card-first detail keeps slot controls secondary and supports image zoom", async ({ harness }) => {
    const { page } = harness
    await page.locator('button[data-slot-id="slot-a"]').click()
    const dialog = details(page)
    await expect(dialog.getByRole("heading", { name: "Snorlax A", exact: true })).toBeVisible()
    await expect(dialog).toContainText("Synthetic set · #1")
    await expect(dialog).toContainText("English")
    await expect(dialog).not.toContainText("item-a")
    await expect(dialog).not.toContainText("acceptance")
    await expect(dialog.getByRole("button", { name: "Change target", exact: true })).not.toBeVisible()
    const preview = dialog.getByRole("button", { name: "View Snorlax A full screen" })
    await expect(preview.getByRole("img")).toBeVisible()
    await harness.expectWithinSafeViewport(dialog)
    await harness.expectHittable(preview)
    await harness.expectNoHorizontalOverflow()
    console.log("card detail geometry", test.info().project.name, JSON.stringify(await dialog.boundingBox()))
    await preview.click()
    const zoom = page.getByRole("dialog", { name: "Snorlax A full screen", exact: true })
    await expect(zoom).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(zoom).toHaveCount(0)
    await expect(dialog).toBeVisible()
    await harness.closeControl(dialog).click()
    await expect(dialog).toHaveCount(0)
    await harness.expectScrollUnlocked()
  })

  test("a free pocket pick saves through the variant sheet and closes, with no write transport", async ({ harness }) => {
    const { page } = harness
    const writes: string[] = []
    page.on("request", r => { if (/\/api\/(inventory|binder-slots|collection)(\?|$)/.test(r.url()) && r.method() !== "GET") writes.push(r.url()) })
    const dialog = await search(page, "slot-g", "Trainer")
    await harness.expectWithinSafeViewport(dialog)
    const box = (await dialog.boundingBox())!, dock = (await harness.dock().boundingBox())!
    expect(box.y + box.height).toBeLessThanOrEqual(dock.y)
    for (const action of await dialog.locator("button:visible").all()) await harness.expectMinTapTarget(action, 36)
    await dialog.getByRole("button", { name: /^Trainer ·/ }).click()
    await expect(count(page)).toHaveText("0")
    await harness.expectWithinSafeViewport(variant(page).getByRole("button").last())
    await variant(page).getByRole("button", { name: /^Add Normal/ }).click()
    await expect(count(page)).toHaveText("1")
    await expect(dialog).toHaveCount(0)
    await harness.expectNoHorizontalOverflow()
    await harness.expectScrollUnlocked()
    expect(writes).toEqual([])
  })

  test("a card that does not match the pocket's target is refused in plain words, nothing saved", async ({ harness }) => {
    const { page } = harness
    const dialog = await search(page, "slot-f", "Energy")
    await dialog.getByRole("button", { name: /^Energy ·/ }).click()
    await variant(page).getByRole("button", { name: /^Add Normal/ }).click()
    const failed = sheet(page, "Couldn't add this card")
    await expect(failed.getByRole("alert")).toContainText("doesn't match")
    await expect(failed.getByRole("button", { name: "Try again", exact: true })).toHaveCount(0)
    await failed.getByRole("button", { name: "Back to cards", exact: true }).first().click()
    await expect(failed).toHaveCount(0)
    await expect(dialog).toBeVisible()
    await expect(count(page)).toHaveText("0")
    await expect(page.locator('button[data-slot-id="slot-f"]')).toHaveAccessibleName("Trainer, Unfilled target")
  })

  test("a failed save keeps the exact draft and Try again resends it", async ({ harness }) => {
    const { page } = harness
    await page.locator('button[data-slot-id="slot-g"]').click()
    await harness.closeControl(details(page)).click()
    await page.evaluate(() => window.dispatchEvent(new Event("synthetic-layout-reject-once")))
    const dialog = await search(page, "slot-g", "Trainer")
    await dialog.getByRole("button", { name: /^Trainer ·/ }).click()
    await variant(page).getByRole("button", { name: /^Add Normal/ }).click()
    const failed = sheet(page, "Couldn't add this card")
    await expect(failed.getByRole("alert")).toBeVisible()
    await expect(failed).not.toContainText(/storage|draft/i)
    await harness.expectWithinSafeViewport(failed.getByRole("button").last())
    for (const action of await failed.locator("button:visible").all()) await harness.expectMinTapTarget(action, 36)
    const rejected = JSON.parse(await page.getByLabel("Synthetic rejected draft").textContent() ?? "null")
    await failed.getByRole("button", { name: "Try again", exact: true }).click()
    await expect(count(page)).toHaveText("1")
    const saved = JSON.parse(await page.getByLabel("Synthetic latest draft").textContent() ?? "null")
    expect(saved.intent.request.operationId).toBe(rejected.intent.request.operationId)
    await expect(dialog).toHaveCount(0)
  })

  test("target edits live in layout editing: incompatible target keeps contents; remove target and clear differ", async ({ harness }) => {
    const { page } = harness
    await page.locator('button[data-slot-id="slot-a"]').click()
    await expect(details(page).getByRole("button", { name: "Change target", exact: true })).toHaveCount(0)
    await cardOptions(details(page))
    await expect(details(page).getByRole("button", { name: "Move card to Unassigned", exact: true })).toBeVisible()
    await harness.closeControl(details(page)).click()
    await editLayout(page)
    await page.locator('button[data-slot-id="slot-a"]').click()
    const dialog = details(page)
    await dialog.getByRole("button", { name: "Change target", exact: true }).click()
    await dialog.getByRole("textbox", { name: "Search slot catalog" }).fill("pikachu")
    await dialog.getByRole("button", { name: "Target Pokémon: pikachu", exact: true }).click()
    await expect(dialog.getByRole("alert")).toContainText("Unassigned first")
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
    await expect(dialog).not.toContainText("item-a")
    await expect(count(page)).toHaveText("0")
    await dialog.getByRole("button", { name: "Remove target", exact: true }).click()
    await expect(dialog.getByRole("button", { name: "Set target", exact: true })).toBeVisible()
    await dialog.getByRole("button", { name: "Move card to Unassigned", exact: true }).click()
    await expect(dialog).toContainText("Free slot, Empty spacer")
    await expect(count(page)).toHaveText("2")
    await harness.closeControl(dialog).click()
    await page.locator('button[data-slot-id="slot-b"]').click()
    await details(page).getByRole("button", { name: "Move card to Unassigned", exact: true }).click()
    await expect(details(page)).toContainText("Unfilled target")
    await expect(details(page).getByRole("button", { name: "Remove target", exact: true })).toBeVisible()
  })

  test("recorded Raw and grade choices retain item IDs without leaking certificate or labels", async ({ harness }) => {
    const { page } = harness
    const dialog = await search(page, "slot-g", "Snorlax A")
    await dialog.getByRole("button", { name: /^Snorlax A ·/ }).click()
    await variant(page).getByRole("button", { name: /^Add Normal/ }).click()
    const copy = sheet(page, "Which copy?")
    await expect(copy.getByRole("button", { name: "Use my raw copy", exact: true })).toBeVisible()
    await expect(copy).not.toContainText("PRIVATE")
    await copy.getByRole("button", { name: "Use my PSA 9", exact: true }).click()
    await expect(page.getByLabel("Synthetic latest draft")).toContainText("unassigned-grade")
    await expect(count(page)).toHaveText("1")
    await expect(page.getByText("PRIVATE")).toHaveCount(0)
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
    const dialog = await search(page, "slot-g", "uncached")
    await expect(dialog).toContainText("Uncached catalog coverage is unavailable offline")
    await expect(dialog).toContainText("No matching cached or available catalog cards")
    await dialog.getByRole("textbox", { name: "Search slot catalog" }).fill("Energy")
    await dialog.getByRole("button", { name: /^Energy ·/ }).click()
    await variant(page).getByRole("button", { name: /^Add Normal/ }).click()
    await expect(count(page)).toHaveText("1")
    // Unknown language stays unknown, never guessed.
    expect(JSON.parse(await page.getByLabel("Synthetic latest draft").textContent() ?? "null").intent.request.commands[0].selection.identity.language).toBeUndefined()
    await context.setOffline(false)
  })

  test("every dismissal of the layout target editor cancels above the dock without drafts", async ({ harness }) => {
    const { page } = harness
    await editLayout(page)
    const open = async () => {
      await page.locator('button[data-slot-id="slot-a"]').click()
      const dialog = details(page)
      await dialog.getByRole("button", { name: "Change target", exact: true }).click()
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
    await page.evaluate(() => window.history.back())
    await expect(dialog).toHaveCount(0)
    expect(page.url()).toContain("e2e-harness")
    dialog = await open()
    await harness.tapBackdrop(dialog)
    await expect(dialog).toHaveCount(0)
    dialog = await open()
    await harness.swipeDown(dialog)
    await expect(dialog).toHaveCount(0)
    await expect(count(page)).toHaveText("0")
    await harness.expectScrollUnlocked()
    await harness.expectNoHorizontalOverflow()
  })

  test("single-finish selection saves at once, an unplaced raw copy is reused by explicit choice", async ({ harness }) => {
    const { page } = harness
    const card = { ...syntheticSlotPickerSnapshot().cards.find(c => c.name === "Energy")!, variants: { normal: true } }
    await page.route("**/app/api/tcg-card-search**", route => route.fulfill({ json: { cards: [card] } }))
    let dialog = await search(page, "slot-g", "Energy")
    await dialog.getByRole("button", { name: /^Energy ·/ }).click()
    await expect(count(page)).toHaveText("1")
    await expect(variant(page)).toHaveCount(0)
    await expect(dialog).toHaveCount(0)
    await page.unroute("**/app/api/tcg-card-search**")
    const snorlax = syntheticSlotPickerSnapshot().cards[0]
    await page.route("**/app/api/tcg-card-search**", route => route.fulfill({ json: { cards: [snorlax] } }))
    // The owned pocket's card-first detail can still move the copy out, which frees the pocket again.
    await page.locator('button[data-slot-id="slot-g"]').click()
    await cardOptions(details(page))
    await details(page).getByRole("button", { name: "Move card to Unassigned", exact: true }).click()
    await expect(count(page)).toHaveText("2")
    await harness.closeControl(details(page)).click()
    dialog = await search(page, "slot-g", "Snorlax")
    await dialog.getByRole("button", { name: /^Snorlax A ·/ }).click()
    await variant(page).getByRole("button", { name: /^Add Normal/ }).click()
    await sheet(page, "Which copy?").getByRole("button", { name: "Use my raw copy", exact: true }).click()
    await expect(page.getByLabel("Synthetic latest draft")).toContainText("unassigned-a")
    await expect(count(page)).toHaveText("3")
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
    await dialog.getByRole("combobox", { name: "Catalog language" }).selectOption("ja")
    await dialog.getByRole("textbox", { name: "Search slot catalog" }).fill("Trainer")
    await dialog.getByRole("button", { name: /^Trainer ·/ }).click()
    await variant(page).getByRole("button", { name: /^Add Reverse/ }).click()
    await expect(count(page)).toHaveText("1")
    expect(JSON.parse(await page.getByLabel("Synthetic latest draft").textContent() ?? "null").intent.request.commands[0].selection.identity).toMatchObject({ language: "ja", finish: "reverse_holo" })
    expect(requested).toContain("ja")
  })

  test("read-only staged boundaries expose no picker controls", async ({ harness }) => {
    const { page } = harness
    await page.goto("/app/e2e-harness?signedIn=1&slots=picker&readOnly=1&rows=2&cols=4")
    await page.locator('button[data-slot-id="slot-g"]').click()
    await expect(details(page)).toBeVisible()
    await expect(details(page).getByRole("button", { name: /Choose card|Set target|Clear contents|Edit slot/ })).toHaveCount(0)
    await expect(details(page).getByRole("textbox", { name: "Search slot catalog" })).toHaveCount(0)
    await harness.closeControl(details(page)).click()
    // An empty species target is read-only too: its card-first detail opens, never the selector.
    await page.locator('button[data-slot-id="slot-e"]').click()
    await expect(details(page)).toContainText("Unfilled target")
    await expect(page.getByRole("dialog", { name: "Card selector" })).toHaveCount(0)
    await expect(page.getByLabel("Synthetic draft count")).toHaveText("0")
  })

  test("same-document owner and binder switches cancel unfinished selection", async ({ harness }) => {
    const { page } = harness
    for (const kind of ["owner", "binder"]) {
      const dialog = await search(page, "slot-g", "Snorlax A")
      await dialog.getByRole("button", { name: /^Snorlax A ·/ }).click()
      await expect(variant(page)).toBeVisible()
      await page.evaluate(kind => window.dispatchEvent(new CustomEvent("synthetic-slot-scope-change", { detail: kind })), kind)
      await expect(dialog).toHaveCount(0)
      await expect(variant(page)).toHaveCount(0)
      await expect(count(page)).toHaveText("0")
      await page.locator('button[data-slot-id="slot-g"]').click()
      await expect(details(page).getByRole("textbox", { name: "Search slot catalog" })).toBeVisible()
      await harness.closeControl(details(page)).click()
    }
  })

  test("long custom grading labels wrap without overflow and remain tappable", async ({ harness }) => {
    const { page } = harness
    const name = "CustomGrader".repeat(16)
    await page.locator('button[data-slot-id="slot-g"]').click()
    const dialog = details(page)
    await page.evaluate(name => window.dispatchEvent(new CustomEvent("synthetic-slot-grading-change", { detail: name })), name)
    await dialog.getByRole("textbox", { name: "Search slot catalog" }).fill("Snorlax A")
    await dialog.getByRole("button", { name: /^Snorlax A ·/ }).click()
    await variant(page).getByRole("button", { name: /^Add Normal/ }).click()
    const copy = sheet(page, "Which copy?")
    const choice = copy.getByRole("button", { name: `Use my ${name} 9`, exact: true })
    await expect(choice).toBeVisible()
    await harness.expectMinTapTarget(choice, 36)
    expect(await copy.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    await harness.expectNoHorizontalOverflow()
    await copy.getByRole("button", { name: "Back to cards", exact: true }).click()
    await expect(copy).toHaveCount(0)
    await expect(count(page)).toHaveText("0")
  })

  test("long catalog labels wrap without overflow and remain tappable", async ({ harness }) => {
    const { page } = harness
    const card = { ...syntheticSlotPickerSnapshot().cards[2], name: `Trainer${"X".repeat(180)}`, set: { id: "synthetic", name: "Set".repeat(80) } }
    await page.route("**/app/api/tcg-card-search**", route => route.fulfill({ json: { cards: [card] } }))
    const dialog = await search(page, "slot-g", "Trainer")
    const hit = dialog.getByRole("button", { name: new RegExp(`^${card.name}`) })
    await expect(hit).toBeVisible()
    await harness.expectMinTapTarget(hit, 36)
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    await harness.expectNoHorizontalOverflow()
    await hit.click()
    expect(await variant(page).evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    await variant(page).getByRole("button", { name: "Back to cards", exact: true }).click()
    await expect(count(page)).toHaveText("0")
  })

  test("sets a printing target in layout editing without creating ownership", async ({ harness }) => {
    const { page } = harness
    await editLayout(page)
    await page.locator('button[data-slot-id="slot-g"]').click()
    const dialog = details(page)
    await dialog.getByRole("button", { name: "Set target", exact: true }).click()
    await dialog.getByRole("textbox", { name: "Search slot catalog" }).fill("Trainer")
    await dialog.getByRole("button", { name: /^Trainer ·/ }).click()
    await dialog.getByRole("button", { name: "Normal", exact: true }).click()
    await dialog.getByRole("button", { name: "Set printing target", exact: true }).click()
    await expect(count(page)).toHaveText("1")
    await expect(dialog).toContainText("Unfilled target")
    await expect(page.locator('button[data-slot-id="slot-g"]')).toHaveAccessibleName("Trainer, Unfilled target")
  })


  // Synthetic Snorlax printings served as the species list (normal and holo, so the finish is an explicit choice).
  const snorlaxList = () => syntheticSlotPickerSnapshot().cards.filter(c => c.id.startsWith("synthetic-snorlax")).map(({ dexIds: _dexIds, ...card }) => card)
  const routeSnorlax = (page: import("@playwright/test").Page, cards: object[] = snorlaxList()) => page.route("**/app/api/tcgdex-cache**", route => route.fulfill({ json: { cards, source: "mirror" } }))
  const selector = (page: import("@playwright/test").Page) => page.getByRole("dialog", { name: "Card selector" })
  const draft = async (page: import("@playwright/test").Page) => JSON.parse(await page.getByLabel("Synthetic latest draft").textContent() ?? "null")

  test("an empty species pocket opens the card selector directly, already showing that species", async ({ harness }) => {
    const { page } = harness
    await routeSnorlax(page)
    const writes: string[] = []
    page.on("request", r => { if (/\/api\/(inventory|binder-slots|collection)(\?|$)/.test(r.url()) && r.method() !== "GET") writes.push(r.url()) })
    await page.locator('button[data-slot-id="slot-e"]').click()
    const dialog = selector(page)
    await expect(dialog.getByRole("button", { name: "Add card Snorlax A from Synthetic set" })).toBeVisible()
    await expect(dialog.getByRole("button", { name: "Add card Snorlax B from Synthetic set" })).toBeVisible()
    await expect(details(page)).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Choose card", exact: true })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Edit slot", exact: true })).toHaveCount(0)
    await expect(dialog.getByText("Unfilled target")).toHaveCount(0)
    // Wanted mode and "mark owned without card" are legacy collection writes, so a native pocket never shows them.
    await expect(dialog.getByRole("group", { name: "Picker mode" })).toHaveCount(0)
    await expect(dialog.getByRole("heading", { name: /Add card for Snorlax/ })).toHaveCount(1)
    await harness.expectWithinSafeViewport(dialog)
    await harness.expectMinTapTarget(harness.closeControl(dialog), 36)
    await harness.expectHittable(harness.closeControl(dialog))
    await harness.expectNoHorizontalOverflow()
    await expect(page.getByLabel("Synthetic draft count")).toHaveText("0")
    expect(writes).toEqual([])
  })

  test("selecting a species card saves the same slot-scoped assign and closes the selector", async ({ harness }) => {
    const { page } = harness
    await routeSnorlax(page)
    await page.locator('button[data-slot-id="slot-e"]').click()
    const dialog = selector(page)
    await dialog.getByRole("button", { name: "Add card Snorlax B from Synthetic set" }).click()
    // Normal and holo both exist, so the finish is asked and never guessed. Nothing is saved before the choice.
    await expect(count(page)).toHaveText("0")
    await variant(page).getByRole("button", { name: /^Add Holo/ }).click()
    await expect(count(page)).toHaveText("1")
    await expect(dialog).toHaveCount(0)
    await expect(details(page)).toHaveCount(0)
    const latest = await draft(page)
    expect(latest.scope).toEqual({ ownerUserId: "synthetic-owner", collectionId: "00000000-0000-4000-8000-000000000366", slotId: "slot-e" })
    const [command] = latest.intent.request.commands
    expect(command).toMatchObject({ kind: "assign", occupied: "cancel", fulfillWant: null, destination: { slot: { id: "slot-e", version: 1, inventoryItemId: null, itemVersion: null, placementVersion: null } } })
    expect(command.selection).toMatchObject({ kind: "catalog", identity: { kind: "card", cardId: "synthetic-snorlax-b", language: "en", finish: "holo" } })
    await expect(page.locator('button[data-slot-id="slot-e"]')).toHaveAccessibleName("Snorlax B, Owned")
    await harness.expectScrollUnlocked()
  })

  test("a selector pick with a graded copy asks which copy in the picker's sheet", async ({ harness }) => {
    const { page } = harness
    await routeSnorlax(page)
    await page.locator('button[data-slot-id="slot-e"]').click()
    await selector(page).getByRole("button", { name: "Add card Snorlax A from Synthetic set" }).click()
    await variant(page).getByRole("button", { name: /^Add Normal/ }).click()
    // The synthetic owner holds an unplaced raw copy and an unplaced PSA 9 copy of this printing.
    const copy = sheet(page, "Which copy?")
    await expect(copy.getByRole("button", { name: "Use my raw copy", exact: true })).toBeVisible()
    await expect(copy.getByRole("button", { name: "Use my PSA 9", exact: true })).toBeVisible()
    await expect(details(page)).toHaveCount(0)
    await harness.expectWithinSafeViewport(copy.getByRole("button").last())
    for (const action of await copy.locator("button:visible").all()) await harness.expectMinTapTarget(action, 36)
    await expect(count(page)).toHaveText("0")
    await harness.swipeDown(copy)
    await expect(copy).toHaveCount(0)
    await expect(selector(page)).toBeVisible()
    await expect(count(page)).toHaveText("0")
    await selector(page).getByRole("button", { name: "Add card Snorlax A from Synthetic set" }).click()
    await variant(page).getByRole("button", { name: /^Add Normal/ }).click()
    await sheet(page, "Which copy?").getByRole("button", { name: "Use my PSA 9", exact: true }).click()
    await expect(count(page)).toHaveText("1")
    await expect(selector(page)).toHaveCount(0)
    expect((await draft(page)).intent.request.commands[0].selection).toMatchObject({ kind: "existing", inventoryItemId: "unassigned-grade" })
  })


  // Synthetic exact want on the empty Snorlax target: Snorlax A, English, normal.
  const addWant = async (page: import("@playwright/test").Page) => {
    // The listener installs on hydration, so repeat until the harness reports the want.
    await expect(async () => {
      await page.evaluate(() => window.dispatchEvent(new CustomEvent("synthetic-slot-wants", { detail: [{ card_id: "synthetic-snorlax-a", card_language: "en", card_finish: "normal" }] })))
      await expect(page.getByLabel("Synthetic want count")).toHaveText("1", { timeout: 500 })
    }).toPass()
  }

  test("a pick that matches a slot want asks before fulfilling it, and fulfils only on that choice", async ({ harness }) => {
    const { page } = harness
    await routeSnorlax(page)
    await addWant(page)
    await page.locator('button[data-slot-id="slot-e"]').click()
    await selector(page).getByRole("button", { name: "Add card Snorlax A from Synthetic set" }).click()
    await variant(page).getByRole("button", { name: /^Add Normal/ }).click()
    const copy = sheet(page, "Which copy?")
    const want = copy.getByRole("button", { name: /^Found my wanted Snorlax A/ })
    await expect(want).toHaveAttribute("aria-pressed", "false")
    await expect(count(page)).toHaveText("0")
    await want.click()
    await copy.getByRole("button", { name: "Use my raw copy", exact: true }).click()
    await expect(count(page)).toHaveText("1")
    const [command] = (await draft(page)).intent.request.commands
    expect(command.fulfillWant).toMatchObject({ index: 0, expected: { card_id: "synthetic-snorlax-a", card_language: "en", card_finish: "normal" } })
    expect(command.destination.slot.id).toBe("slot-e")
  })


  test("a pick that matches no slot want saves without fulfilling anything", async ({ harness }) => {
    const { page } = harness
    await routeSnorlax(page)
    await addWant(page)
    await page.locator('button[data-slot-id="slot-e"]').click()
    await selector(page).getByRole("button", { name: "Add card Snorlax B from Synthetic set" }).click()
    await page.getByRole("dialog", { name: "Which variant?" }).getByRole("button", { name: /^Add Normal/ }).click()
    await expect(page.getByLabel("Synthetic draft count")).toHaveText("1")
    expect((await draft(page)).intent.request.commands[0].fulfillWant).toBeNull()
  })

  test("the selector has no structural controls; they live in layout editing", async ({ harness }) => {
    const { page } = harness
    await routeSnorlax(page)
    await page.locator('button[data-slot-id="slot-e"]').click()
    const dialog = selector(page)
    await expect(dialog.getByRole("button", { name: "Add card Snorlax A from Synthetic set" })).toBeVisible()
    await expect(dialog.getByRole("button", { name: "More options", exact: true })).toHaveCount(0)
    await expect(page.getByRole("button", { name: /Edit slot|Change target|Remove target/ })).toHaveCount(0)
    await harness.closeControl(dialog).click()
    await editLayout(page)
    await page.locator('button[data-slot-id="slot-e"]').click()
    const edit = details(page)
    await expect(selector(page)).toHaveCount(0)
    await expect(edit.getByRole("button", { name: "Change target", exact: true })).toBeVisible()
    await edit.getByRole("button", { name: "Remove target", exact: true }).click()
    await expect(count(page)).toHaveText("1")
    await expect(page.locator('button[data-slot-id="slot-e"]')).toHaveAccessibleName("Free slot, Empty spacer")
    await harness.closeControl(edit).click()
    await expect(edit).toHaveCount(0)
    await harness.expectScrollUnlocked()
  })


  test("the species selector dismisses by X, Escape, back and backdrop without saving", async ({ harness }) => {
    const { page } = harness
    await routeSnorlax(page)
    const open = async () => {
      await page.locator('button[data-slot-id="slot-e"]').click()
      const dialog = selector(page)
      await expect(dialog.getByRole("button", { name: "Add card Snorlax A from Synthetic set" })).toBeVisible()
      return dialog
    }
    await test.step("X", async () => { const d = await open(); await harness.closeControl(d).click(); await expect(d).toHaveCount(0); return d })
    await test.step("Escape", async () => { const d = await open(); await page.keyboard.press("Escape"); await expect(d).toHaveCount(0); return d })
    await test.step("back", async () => { const d = await open(); await page.evaluate(() => window.history.back()); await expect(d).toHaveCount(0); expect(page.url()).toContain("e2e-harness"); return d })
    await test.step("backdrop", async () => { const d = await open(); await harness.tapBackdrop(d); await expect(d).toHaveCount(0); return d })
    await expect(page.getByLabel("Synthetic draft count")).toHaveText("0")
    await expect(page.locator('button[data-slot-id="slot-e"]')).toHaveAccessibleName("snorlax, Unfilled target")
    await harness.expectScrollUnlocked()
  })

  test("an owner or binder switch closes the open selector and never retargets", async ({ harness }) => {
    const { page } = harness
    await routeSnorlax(page)
    for (const kind of ["owner", "binder"]) {
      await page.locator('button[data-slot-id="slot-e"]').click()
      const dialog = selector(page)
      await expect(dialog.getByRole("button", { name: "Add card Snorlax A from Synthetic set" })).toBeVisible()
      await page.evaluate(kind => window.dispatchEvent(new CustomEvent("synthetic-slot-scope-change", { detail: kind })), kind)
      await expect(dialog).toHaveCount(0)
      await expect(page.getByLabel("Synthetic draft count")).toHaveText("0")
    }
  })

  test("a free pocket lands in catalog search with one plain heading, and every dismissal cancels", async ({ harness }) => {
    const { page } = harness
    const open = async () => {
      await page.locator('button[data-slot-id="slot-g"]').click()
      const dialog = details(page)
      await expect(dialog.getByRole("textbox", { name: "Search slot catalog" })).toBeVisible()
      return dialog
    }
    let dialog = await open()
    await expect(dialog.getByRole("heading", { name: "Add a card", exact: true })).toHaveCount(1)
    await expect(dialog.getByRole("heading")).toHaveCount(1)
    await expect(dialog.getByRole("button", { name: /Choose card|Edit slot|Set target|Cancel/ })).toHaveCount(0)
    await expect(dialog.getByText(/Empty slot|Empty spacer|Unfilled target/)).toHaveCount(0)
    await harness.expectWithinSafeViewport(dialog)
    for (const action of await dialog.locator("button:visible").all()) await harness.expectMinTapTarget(action, 36)
    await harness.expectNoHorizontalOverflow()
    await harness.closeControl(dialog).click()
    await expect(dialog).toHaveCount(0)
    dialog = await open()
    await page.keyboard.press("Escape")
    await expect(dialog).toHaveCount(0)
    dialog = await open()
    await page.evaluate(() => window.history.back())
    await expect(dialog).toHaveCount(0)
    dialog = await open()
    await harness.tapBackdrop(dialog)
    await expect(dialog).toHaveCount(0)
    dialog = await open()
    await harness.swipeDown(dialog)
    await expect(dialog).toHaveCount(0)
    await expect(count(page)).toHaveText("0")
    await harness.expectScrollUnlocked()
  })

  test("a card-target pocket lands in search under its card's name", async ({ harness }) => {
    const { page } = harness
    await page.locator('button[data-slot-id="slot-f"]').click()
    const dialog = details(page)
    await expect(dialog.getByRole("textbox", { name: "Search slot catalog" })).toBeVisible()
    await expect(dialog.getByRole("heading", { name: "Add card for Trainer", exact: true })).toHaveCount(1)
    await expect(dialog.getByText("Unfilled target")).toHaveCount(0)
    await expect(dialog.getByRole("button", { name: /Choose card|Edit slot/ })).toHaveCount(0)
  })


  test("an owned pocket keeps the card-first detail and never opens the selector", async ({ harness }) => {
    const { page } = harness
    await routeSnorlax(page)
    await page.locator('button[data-slot-id="slot-a"]').click()
    await expect(details(page).getByRole("heading", { name: "Snorlax A", exact: true })).toBeVisible()
    await expect(selector(page)).toHaveCount(0)
    await expect(details(page).getByRole("textbox", { name: "Search slot catalog" })).toHaveCount(0)
  })
})
