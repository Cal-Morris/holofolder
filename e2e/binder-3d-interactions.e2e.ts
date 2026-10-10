import { PerspectiveCamera, Vector3 } from "three"
import { test, expect, E2E_USER, SEEDED_COLLECTION, SUPABASE_URL } from "./fixtures"
import { binderDimensions, binderPocket, BINDER_PAGE, BINDER_LAYERS, defaultBinderDesign } from "../lib/binder-design"

test.describe("3D binder gestures", () => {
  test.use({ signedIn: true })
  test("preloads neighbours, swipes both ways, pans while zoomed and opens Pokémon details", async ({ harness }) => {
    const { page } = harness
    const design = defaultBinderDesign()
    await page.route("**/api/binder-appearance", route => route.fulfill({ json: { ownerId: E2E_USER.id, design, revision: 1 } }))
    // Synthetic artwork and a card on the next spread to verify preloading before navigation.
    const collection = [...SEEDED_COLLECTION, { ...SEEDED_COLLECTION[0], pokemon_id: 18, pokemon_name: "Pidgeot", card_id: "base1-8", card_name: "Pidgeot" }]
    await page.route(`${SUPABASE_URL}/rest/v1/pokemon_collection**`, route => route.fulfill({ json: collection.map(item => ({ ...item, card_image: `https://assets.tcgdex.net/en/base/base1/${item.pokemon_id === 18 ? "8" : "44"}/high.webp` })) }))
    const preload = page.waitForRequest(request => request.url().includes("card-image-proxy") && decodeURIComponent(request.url()).includes("/8/high.webp"))
    await page.goto("/e2e-harness?signedIn=1&cardArtwork=1")
    await page.getByRole("button", { name: "3D", exact: true }).click()
    const stage = page.getByTestId("binder-3d-stage"), canvas = stage.locator("canvas")
    await expect(stage).toHaveAttribute("data-current-page", "1")
    await expect(stage).toHaveAttribute("data-opening-state", "settled")
    await preload
    await canvas.scrollIntoViewIfNeeded()
    const touch = await page.context().newCDPSession(page)
    const swipe = async (dx: number) => {
      const box = (await canvas.boundingBox())!
      const x = box.x + box.width / 2, y = box.y + box.height / 2
      await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1 }] })
      await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + dx, y, id: 1 }] })
      await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
    }
    await swipe(-70)
    await expect(stage).toHaveAttribute("data-current-page", "2")
    await swipe(70)
    await expect(stage).toHaveAttribute("data-current-page", "1")
    // Project the real first pocket centre, so this tests canvas hit detection rather than an alternate button.
    const box = (await canvas.boundingBox())!, dimensions = binderDimensions(Math.max(design.pageCount, Math.ceil(1025 / (design.rows * design.cols))))
    const distance = Math.max(box.width < 450 ? 10 : 8, dimensions.coverZ * 3 + 6)
    const camera = new PerspectiveCamera(34, box.width / box.height, .1, 100)
    camera.position.set(-1.12, 2.5, distance + 1);camera.lookAt(-1.12, 0, 0);camera.updateMatrixWorld()
    const pocket = binderPocket(design.rows, design.cols, 0, 1)
    const point = new Vector3(BINDER_PAGE.hingeX + pocket.x, pocket.y, dimensions.stack / 2 + BINDER_LAYERS.backing / 2 + BINDER_LAYERS.card + BINDER_LAYERS.film).project(camera)
    await canvas.tap({ position: { x: (point.x + 1) * box.width / 2, y: (1 - point.y) * box.height / 2 } })
    const dialog = page.getByRole("dialog", { name: /bulbasaur.*details/i })
    await expect(dialog).toBeVisible()
    await harness.closeControl(dialog).click()
    await canvas.scrollIntoViewIfNeeded()
    const panBox = (await canvas.boundingBox())!, x = panBox.x + panBox.width / 2, y = panBox.y + panBox.height / 2
    await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x - 25, y, id: 1 }, { x: x + 25, y, id: 2 }] })
    await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x - 45, y, id: 1 }, { x: x + 45, y, id: 2 }] })
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
    const zoomed = await canvas.screenshot()
    await swipe(-30)
    await expect(stage).toHaveAttribute("data-current-page", "1")
    expect((await canvas.screenshot()).equals(zoomed)).toBe(false)
    const panned = await canvas.screenshot()
    await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x - 25, y, id: 1 }, { x: x + 25, y, id: 2 }] })
    await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x - 10, y: y + 10, id: 1 }, { x: x + 40, y: y + 10, id: 2 }] })
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
    expect((await canvas.screenshot()).equals(panned)).toBe(false)
    await expect(stage).toHaveAttribute("data-current-page", "1")
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await harness.expectNoHorizontalOverflow()
    await expect(harness.dock()).toBeVisible()
  })

  test("keeps the current spread visible while adjacent artwork loads and survives rapid turns", async ({ harness }) => {
    const { page } = harness
    await page.route("**/api/binder-appearance", route => route.fulfill({ json: { ownerId: E2E_USER.id, design: defaultBinderDesign(), revision: 1 } }))
    // Synthetic second-spread printing with a deliberately delayed image.
    await page.route(`${SUPABASE_URL}/rest/v1/pokemon_collection**`, route => route.fulfill({ json: [...SEEDED_COLLECTION, { ...SEEDED_COLLECTION[0], pokemon_id: 18, card_id: "base1-8", card_image: "https://assets.tcgdex.net/en/base/base1/8/high.webp" }] }))
    let release!: () => void
    const loaded = new Promise<void>(resolve => { release = resolve })
    let requested = false
    await page.route("**/api/card-image-proxy?**", async route => {
      if (decodeURIComponent(route.request().url()).includes("/8/high.webp")) { requested = true;await loaded }
      await route.fallback()
    })
    await page.goto("/e2e-harness?signedIn=1&cardArtwork=1")
    await page.getByRole("button", { name: "3D", exact: true }).click()
    const stage = page.getByTestId("binder-3d-stage"), preview = page.getByRole("region", { name: "Your 3D National Dex binder" })
    await expect(stage).toHaveAttribute("data-current-page", "1")
    await expect(stage).toHaveAttribute("data-opening-state", "settled")
    await expect.poll(() => requested).toBe(true)
    const initial = await stage.locator("canvas").screenshot()
    try {
      await preview.getByRole("button", { name: "Next 3D binder spread" }).click()
      await expect(stage).toHaveAttribute("aria-busy", "true")
      await expect(stage).toHaveAttribute("data-current-page", "1")
      expect((await stage.locator("canvas").screenshot()).equals(initial)).toBe(true)
    } finally { release() }
    await expect(stage).toHaveAttribute("data-current-page", "2")
    await expect(stage).toHaveAttribute("data-left-cards", "1")
    await preview.getByRole("button", { name: "Next 3D binder spread" }).click()
    await preview.getByRole("button", { name: "Next 3D binder spread" }).click()
    await preview.getByRole("button", { name: "Previous 3D binder spread" }).click()
    await expect(stage).toHaveAttribute("data-current-page", "4")
    await expect(stage).toHaveAttribute("aria-busy", "false")
  })

})
