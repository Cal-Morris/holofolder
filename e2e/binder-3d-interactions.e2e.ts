import { PerspectiveCamera, Vector3 } from "three"
import { binderCameraFrame } from "../lib/binder-camera"
import sharp from "sharp"
import { test, expect, E2E_USER, SEEDED_COLLECTION, SUPABASE_URL } from "./fixtures"
import { binderDimensions, binderPocket, BINDER_PAGE, BINDER_LAYERS, defaultBinderDesign } from "../lib/binder-design"

test.describe("3D binder gestures", () => {
  test.use({ signedIn: true })
  test("appearance refresh keeps settled 3D slots tappable", async ({ harness }) => {
    const { page } = harness, design = defaultBinderDesign()
    await page.route("**/app/api/binder-appearance", route => route.fulfill({ json: { ownerId: E2E_USER.id, design, revision: 1 } }))
    await page.reload()
    await harness.openViewOptions()
    await page.getByRole("button", { name: "3D", exact: true }).click()
    const stage = page.getByTestId("binder-3d-stage"), canvas = stage.locator("canvas")
    await expect(stage).toHaveAttribute("data-opening-state", "settled")
    await expect(stage).toHaveAttribute("aria-busy", "false")
    await canvas.scrollIntoViewIfNeeded()
    await stage.evaluate(element => {
      const busy: string[] = []
      new MutationObserver(() => { if (element.getAttribute("aria-busy") === "true") busy.push("busy") }).observe(element, { attributes: true, attributeFilter: ["aria-busy"] })
      Object.assign(element, { refreshBusyTransitions: busy })
    })
    const box = (await canvas.boundingBox())!, dimensions = binderDimensions(Math.max(design.pageCount, Math.ceil(1025 / (design.rows * design.cols))))
    const camera = new PerspectiveCamera(34, box.width / box.height, .1, 100), frame = binderCameraFrame("inside", box.width, box.height, dimensions.coverZ)
    camera.position.set(...frame.position); camera.lookAt(...frame.target); camera.updateMatrixWorld()
    const pocket = binderPocket(design.rows, design.cols, 0, 1)
    const point = new Vector3(BINDER_PAGE.hingeX + pocket.x, pocket.y, dimensions.stack / 2 + BINDER_LAYERS.backing / 2 + BINDER_LAYERS.card + BINDER_LAYERS.film).project(camera)
    await canvas.tap({ position: { x: (point.x + 1) * box.width / 2, y: (1 - point.y) * box.height / 2 } })
    const detail = page.getByRole("dialog", { name: /bulbasaur.*details/i })
    await expect(detail).toBeVisible()
    await harness.closeControl(detail).click()
    const changedDesign = { ...design, surfaces: { ...design.surfaces, cover: { ...design.surfaces.cover, words: "Synthetic changed cover" } } }
    await page.route("**/app/api/binder-appearance", route => route.fulfill({ json: { ownerId: E2E_USER.id, design: changedDesign, revision: 2 } }))
    const appearanceRefresh = page.waitForResponse(response => response.url().includes("/app/api/binder-appearance"))
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")))
    await appearanceRefresh
    await expect.poll(() => stage.evaluate(element => Reflect.get(element, "refreshBusyTransitions").length)).toBeGreaterThan(0)
    await expect(stage).toHaveAttribute("aria-busy", "false")
    await canvas.tap({ position: { x: (point.x + 1) * box.width / 2, y: (1 - point.y) * box.height / 2 } })
    await expect(detail).toBeVisible()
  })

  test("preloads neighbours, swipes both ways, pans while zoomed and opens Pokémon details", async ({ harness }) => {
    const { page } = harness
    const design = defaultBinderDesign()
    await page.route("**/app/api/binder-appearance", route => route.fulfill({ json: { ownerId: E2E_USER.id, design, revision: 1 } }))
    // Synthetic artwork and a card on the next spread to verify preloading before navigation.
    const collection = [...SEEDED_COLLECTION, { ...SEEDED_COLLECTION[0], pokemon_id: 18, pokemon_name: "Pidgeot", card_id: "base1-8", card_name: "Pidgeot" }]
    await page.route(`${SUPABASE_URL}/rest/v1/pokemon_collection**`, route => route.fulfill({ json: collection.map(item => ({ ...item, card_image: `https://assets.tcgdex.net/en/base/base1/${item.pokemon_id === 18 ? "8" : "44"}/high.webp` })) }))
    const preload = page.waitForRequest(request => request.url().includes("card-image-proxy") && decodeURIComponent(request.url()).includes("/8/high.webp"))
    await page.goto("/app/e2e-harness?signedIn=1&cardArtwork=1")
    await harness.openViewOptions()
    await page.getByRole("button", { name: "3D", exact: true }).click()
    const stage = page.getByTestId("binder-3d-stage"), canvas = stage.locator("canvas")
    // Software WebGL can take longer to build the first spread than to turn a page.
    await expect(stage).toHaveAttribute("data-current-page", "1", { timeout: 30_000 })
    await expect(stage).toHaveAttribute("data-opening-state", "settled")
    await preload
    await canvas.scrollIntoViewIfNeeded()
    const touch = await page.context().newCDPSession(page)
    const swipe = async (dx: number, dy = 0) => {
      const box = (await canvas.boundingBox())!
      const x = box.x + box.width / 2, y = box.y + box.height / 2
      await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1 }] })
      await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + dx, y: y + dy, id: 1 }] })
      // Hold still before lifting. A lift straight after an instant move starts a fling in Chromium,
      // and Chromium drops the next tap because it only cancels that fling.
      await new Promise(resolve => setTimeout(resolve, 120))
      await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + dx, y: y + dy, id: 1 }] })
      await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
    }
    await swipe(-70)
    await expect(stage).toHaveAttribute("data-current-page", "2")
    await expect(page).toHaveURL(/page=2/)
    await swipe(70)
    await expect(stage).toHaveAttribute("data-current-page", "1")
    await swipe(-50, 38)
    await expect(stage).toHaveAttribute("data-current-page", "2")
    // The accessible spread list exercises selection state independently of canvas hit detection below.
    const laterCard = page.getByRole("list", { name: "Cards on this spread" }).getByRole("button", { name: "Pidgeot, slot 18", exact: true })
    await expect(laterCard).toBeAttached()
    await laterCard.dispatchEvent("click")
    const laterDetails = page.getByRole("dialog", { name: "Pidgeot details", exact: true })
    await expect(laterDetails).toBeVisible()
    // The page-selection cleanup runs in requestAnimationFrame, so wait through it before asserting persistence.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    await expect(laterDetails).toBeVisible()
    await harness.closeControl(laterDetails).click()
    await expect(laterDetails).toHaveCount(0)
    await canvas.scrollIntoViewIfNeeded()
    await swipe(50, 38)
    await expect(stage).toHaveAttribute("data-current-page", "1")
    await expect(stage).toHaveAttribute("aria-busy", "false")
    // Project the real first pocket centre, so this tests canvas hit detection rather than an alternate button.
    const box = (await canvas.boundingBox())!, dimensions = binderDimensions(Math.max(design.pageCount, Math.ceil(1025 / (design.rows * design.cols))))
    const frame = binderCameraFrame("inside", box.width, box.height, dimensions.coverZ)
    const camera = new PerspectiveCamera(34, box.width / box.height, .1, 100)
    camera.position.set(...frame.position);camera.lookAt(...frame.target);camera.updateMatrixWorld()
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
    // Lift the second finger first, then the remaining finger.
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [{ x: x - 45, y, id: 1 }] })
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
    const zoomed = await canvas.screenshot()
    await swipe(-30)
    await expect(stage).toHaveAttribute("data-current-page", "1")
    expect((await canvas.screenshot()).equals(zoomed)).toBe(false)
    const zoomCamera = camera.clone()
    zoomCamera.position.sub(new Vector3(-1.3, 0, 0)).multiplyScalar(50 / 90).add(new Vector3(-1.3, 0, 0))
    zoomCamera.lookAt(-1.3, 0, 0);zoomCamera.updateMatrixWorld()
    const zoomPoint = new Vector3(BINDER_PAGE.hingeX + pocket.x, pocket.y, dimensions.stack / 2 + BINDER_LAYERS.backing / 2 + BINDER_LAYERS.card + BINDER_LAYERS.film).project(zoomCamera)
    // A cancelled contact must not leave the next tap in the old gesture.
    await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1 }] })
    await touch.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] })
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    await canvas.tap({ position: { x: (zoomPoint.x + 1) * panBox.width / 2 - 30, y: (1 - zoomPoint.y) * panBox.height / 2 } })
    await expect(page.getByRole("dialog", { name: /bulbasaur/i })).toBeVisible()
    await harness.closeControl(page.getByRole("dialog", { name: /bulbasaur/i })).click()
    const panned = await canvas.screenshot()
    await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x - 25, y, id: 1 }, { x: x + 25, y, id: 2 }] })
    await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x - 10, y: y + 10, id: 1 }, { x: x + 40, y: y + 10, id: 2 }] })
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
    expect((await canvas.screenshot()).equals(panned)).toBe(false)
    await expect(stage).toHaveAttribute("data-current-page", "1")
    await expect(page.getByRole("dialog")).toHaveCount(0)
    // Return to the fitted view after pinch/pan, then a fresh tap must still select a pocket.
    await harness.openViewOptions()
    await page.getByRole("button", { name: "2D", exact: true }).click()
    await page.getByRole("button", { name: "Close view options", exact: true }).click()
    await harness.openViewOptions()
    await page.getByRole("button", { name: "3D", exact: true }).click()
    await expect(stage).toHaveAttribute("data-opening-state", "settled")
    await expect(stage).toHaveAttribute("data-current-page", "1")
    await expect(stage).toHaveAttribute("aria-busy", "false")
    const freshBox = (await canvas.boundingBox())!
    const fx = freshBox.x + freshBox.width / 2, fy = freshBox.y + freshBox.height / 2
    await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: fx - 25, y: fy, id: 1 }, { x: fx + 25, y: fy, id: 2 }] })
    await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: fx - 45, y: fy, id: 1 }, { x: fx + 45, y: fy, id: 2 }] })
    await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: fx - 25, y: fy, id: 1 }, { x: fx + 25, y: fy, id: 2 }] })
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    const freshFrame = binderCameraFrame("inside", freshBox.width, freshBox.height, dimensions.coverZ)
    const freshCamera = new PerspectiveCamera(34, freshBox.width / freshBox.height, .1, 100)
    freshCamera.position.set(...freshFrame.position);freshCamera.lookAt(...freshFrame.target);freshCamera.updateMatrixWorld()
    const freshPoint = new Vector3(BINDER_PAGE.hingeX + pocket.x, pocket.y, dimensions.stack / 2 + BINDER_LAYERS.backing / 2 + BINDER_LAYERS.card + BINDER_LAYERS.film).project(freshCamera)
    await canvas.tap({ position: { x: (freshPoint.x + 1) * freshBox.width / 2, y: (1 - freshPoint.y) * freshBox.height / 2 } })
    await expect(page.getByRole("dialog", { name: /bulbasaur/i })).toBeVisible()
    await harness.expectNoHorizontalOverflow()
    await expect(harness.dock()).toBeVisible()
  })

  test("taps recover when a multi-touch gesture loses capture and ends outside the canvas", async ({ harness }) => {
    const { page } = harness, design = defaultBinderDesign()
    await page.route("**/app/api/binder-appearance", route => route.fulfill({ json: { ownerId: E2E_USER.id, design, revision: 1 } }))
    await harness.openViewOptions()
    await page.getByRole("button", { name: "3D", exact: true }).click()
    const stage = page.getByTestId("binder-3d-stage"), canvas = stage.locator("canvas")
    await expect(stage).toHaveAttribute("data-opening-state", "settled")
    await canvas.scrollIntoViewIfNeeded()
    const tapPocket = async () => {
      await expect(stage).toHaveAttribute("data-current-page", "1")
      await expect(stage).toHaveAttribute("aria-busy", "false")
      const fitted = (await canvas.boundingBox())!, dimensions = binderDimensions(Math.max(design.pageCount, Math.ceil(1025 / (design.rows * design.cols))))
      const camera = new PerspectiveCamera(34, fitted.width / fitted.height, .1, 100)
      const frame = binderCameraFrame("inside", fitted.width, fitted.height, dimensions.coverZ)
      camera.position.set(...frame.position)
      camera.lookAt(...frame.target);camera.updateMatrixWorld()
      const pocket = binderPocket(design.rows, design.cols, 0, 1)
      const point = new Vector3(BINDER_PAGE.hingeX + pocket.x, pocket.y, dimensions.stack / 2 + BINDER_LAYERS.backing / 2 + BINDER_LAYERS.card + BINDER_LAYERS.film).project(camera)
      await canvas.tap({ position: { x: (point.x + 1) * fitted.width / 2, y: (1 - point.y) * fitted.height / 2 } })
      return fitted
    }
    await tapPocket()
    const initialDetails = page.getByRole("dialog", { name: /bulbasaur.*details/i })
    await expect(initialDetails).toBeVisible()
    await harness.closeControl(initialDetails).click()
    await canvas.evaluate(element => {
      const pointers: number[] = []
      element.addEventListener("pointerdown", event => pointers.push((event as PointerEvent).pointerId), { capture: true })
      Object.assign(element, { releaseTouches: () => pointers.forEach(id => element.releasePointerCapture(id)) })
    })
    const touch = await page.context().newCDPSession(page), box = (await canvas.boundingBox())!
    const x = box.x + box.width / 2, y = box.y + 10
    await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x - 25, y, id: 1 }, { x: x + 25, y, id: 2 }] })
    await canvas.evaluate(element => Reflect.get(element, "releaseTouches")())
    await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x - 25, y: box.y - 10, id: 1 }, { x: x + 25, y: box.y - 10, id: 2 }] })
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
    // Reset only the camera, preserving the renderer's pointer trackers.
    const views = page.getByRole("group", { name: "3D binder views" })
    await views.getByRole("button", { name: "Cover", exact: true }).click()
    await views.getByRole("button", { name: "Inside", exact: true }).click()
    await expect(stage).toHaveAttribute("data-opening-state", "settled")
    await canvas.scrollIntoViewIfNeeded()
    const fitted = await tapPocket()
    const details = page.getByRole("dialog", { name: /bulbasaur.*details/i })
    await expect(details).toBeVisible()
    await harness.closeControl(details).click()
    const sx = fitted.x + fitted.width / 2, sy = fitted.y + fitted.height / 2
    await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: sx, y: sy, id: 1 }] })
    await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: sx - 50, y: sy, id: 1 }] })
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
    await expect(stage).toHaveAttribute("data-current-page", "2")
  })

  test("2D swipes survive returning from 3D and ignore multi-touch", async ({ harness }) => {
    const { page } = harness
    await harness.openViewOptions()
    await page.getByRole("button", { name: "3D", exact: true }).click()
    await expect(page.getByTestId("binder-3d-stage").locator("canvas")).toBeVisible()
    await harness.openViewOptions()
    await page.getByRole("button", { name: "2D", exact: true }).click()
    await page.getByRole("button", { name: "Close view options", exact: true }).click()
    const grid = page.locator("[data-page-turn-ms]")
    await expect(grid).toBeVisible()
    const touch = await page.context().newCDPSession(page)
    const box = (await grid.boundingBox())!, x = box.x + box.width / 2, y = box.y + box.height / 2
    const pageNumber = page.getByRole("spinbutton", { name: "Binder page number" })
    for (const { dx, dy } of [{ dx: -90, dy: 0 }, { dx: 90, dy: 0 }, { dx: -50, dy: 38 }, { dx: 50, dy: 38 }]) {
      await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1 }] })
      await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + dx, y: y + dy, id: 1 }] })
      await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
      await expect(pageNumber).toHaveValue(dx < 0 ? "2" : "1")
      await expect(harness.dialogs()).toHaveCount(0)
    }
    await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1 }, { x: x + 25, y, id: 2 }] })
    await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x - 80, y, id: 1 }, { x: x + 40, y, id: 2 }] })
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
    await expect(pageNumber).toHaveValue("1")
    // Synthetic touch events also cover engines that keep delivering touchend during a pinch.
    await grid.evaluate(element => {
      const first = new Touch({ identifier: 1, target: element, clientX: 200, clientY: 100 })
      const second = new Touch({ identifier: 2, target: element, clientX: 240, clientY: 100 })
      const moved = new Touch({ identifier: 1, target: element, clientX: 120, clientY: 100 })
      element.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, touches: [first, second], changedTouches: [first, second] }))
      element.dispatchEvent(new TouchEvent("touchmove", { bubbles: true, touches: [moved, second], changedTouches: [moved] }))
      element.dispatchEvent(new TouchEvent("touchend", { bubbles: true, touches: [second], changedTouches: [moved] }))
      element.dispatchEvent(new TouchEvent("touchend", { bubbles: true, touches: [], changedTouches: [second] }))
    })
    await page.waitForTimeout(150) // Allow an incorrectly queued page turn to commit.
    await expect(pageNumber).toHaveValue("1")
  })

  test("keeps the current spread visible while adjacent artwork loads and survives rapid turns", async ({ harness }) => {
    const { page } = harness
    await page.route("**/app/api/binder-appearance", route => route.fulfill({ json: { ownerId: E2E_USER.id, design: defaultBinderDesign(), revision: 1 } }))
    // Synthetic second-spread printing with a deliberately delayed image.
    await page.route(`${SUPABASE_URL}/rest/v1/pokemon_collection**`, route => route.fulfill({ json: [...SEEDED_COLLECTION, { ...SEEDED_COLLECTION[0], pokemon_id: 18, card_id: "base1-8", card_image: "https://assets.tcgdex.net/en/base/base1/8/high.webp" }] }))
    let release!: () => void
    const loaded = new Promise<void>(resolve => { release = resolve })
    let requested = false
    await page.route("**/app/api/card-image-proxy?**", async route => {
      if (decodeURIComponent(route.request().url()).includes("/8/high.webp")) { requested = true;await loaded }
      await route.fallback()
    })
    await page.clock.install()
    await page.goto("/app/e2e-harness?signedIn=1&cardArtwork=1")
    await harness.openViewOptions()
    await page.getByRole("button", { name: "3D", exact: true }).click()
    const stage = page.getByTestId("binder-3d-stage"), preview = page.getByRole("region", { name: "Your 3D National Dex binder" })
    await expect(stage).toHaveAttribute("data-current-page", "1")
    await expect(stage).toHaveAttribute("data-opening-state", "settled")
    await expect.poll(() => requested).toBe(true)
    await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now() + 100)))
    // Compare rendered pages without the overlay button's browser compositing.
    const screenshotOptions = { style: 'button[aria-label="Fit binder"] { visibility: hidden !important; }' }
    const initial = await stage.locator("canvas").screenshot(screenshotOptions)
    const artworkResponse = page.waitForResponse(response => decodeURIComponent(response.url()).includes("card-image-proxy") && decodeURIComponent(response.url()).includes("/8/high.webp"))
    try {
      await preview.getByRole("button", { name: "Next 3D binder spread" }).click()
      await page.clock.runFor(100)
      await expect(stage).toHaveAttribute("aria-busy", "true")
      await expect(stage).toHaveAttribute("data-current-page", "1")
      const pending = await stage.locator("canvas").screenshot(screenshotOptions)
      const [before, after] = await Promise.all([initial, pending].map(buffer => sharp(buffer).raw().toBuffer({ resolveWithObject: true })))
      expect(after.info).toEqual(before.info)
      // Allow one colour level of compositing noise without accepting a page flash.
      let maxDifference = 0
      for (let index = 0; index < before.data.length; index++) maxDifference = Math.max(maxDifference, Math.abs(before.data[index] - after.data[index]))
      expect(maxDifference).toBeLessThanOrEqual(1)
    } finally {
      // Observe the turn being scheduled, then interrupt before its first animation frame.
      await stage.evaluate(element => {
        const schedule = window.requestAnimationFrame.bind(window)
        window.requestAnimationFrame = callback => {
          element.setAttribute("data-turn-frame-requested", "true")
          return schedule(callback)
        }
      })
      release()
    }
    await (await artworkResponse).finished()
    await expect(stage).toHaveAttribute("data-turn-frame-requested", "true")
    await expect(stage).toHaveAttribute("data-current-page", "1")
    await expect(stage).toHaveAttribute("aria-busy", "true")
    await preview.getByRole("button", { name: "Cover", exact: true }).evaluate(button => (button as HTMLButtonElement).click())
    await expect(stage).toHaveAttribute("data-current-page", "2")
    await expect(stage).toHaveAttribute("data-left-cards", "1")
    await expect(stage).toHaveAttribute("data-preloaded-spreads", /(?:^|,)4(?:,|$)/)
    await page.clock.resume()
    await preview.getByRole("button", { name: "Inside", exact: true }).click()
    await expect(stage).toHaveAttribute("data-opening-state", "settled")
    await preview.getByRole("button", { name: "Next 3D binder spread" }).click()
    await preview.getByRole("button", { name: "Next 3D binder spread" }).click()
    await preview.getByRole("button", { name: "Previous 3D binder spread" }).click()
    await expect(stage).toHaveAttribute("data-current-page", "4")
    await expect(stage).toHaveAttribute("aria-busy", "false")
  })

})

test("staged 3D slots preserve copy identity, target labels and sparse/zero spreads", async ({ harness }) => {
  const { page } = harness
  await page.goto("/app/e2e-harness?slots=mixed&rows=2&cols=2")
  await harness.openViewOptions()
  await page.getByRole("button", { name: "3D", exact: true }).click()
  const stage = page.getByTestId("binder-3d-stage")
  await expect(stage).toHaveAttribute("data-opening-state", "settled")
  const closeView = page.getByRole("button", { name: "Close view options", exact: true })
  if (await closeView.isVisible()) await closeView.click()
  const spread = page.getByRole("list", { name: "Cards on this spread" })
  await expect(spread.getByRole("button", { name: /Snorlax A, Owned/ })).toHaveCount(1)
  await expect(spread.getByRole("button", { name: /Snorlax B, Owned/ })).toHaveCount(1)
  // Hit the second Snorlax pocket on the actual canvas, not a species shortcut.
  const canvas = stage.locator("canvas")
  await canvas.scrollIntoViewIfNeeded()
  const box = (await canvas.boundingBox())!, dimensions = binderDimensions(2)
  const camera = new PerspectiveCamera(34, box.width / box.height, .1, 100)
  const frame = binderCameraFrame("inside", box.width, box.height, dimensions.coverZ)
  camera.position.set(...frame.position); camera.lookAt(...frame.target); camera.updateMatrixWorld()
  const pocket = binderPocket(2, 2, 1, 1)
  const point = new Vector3(BINDER_PAGE.hingeX + pocket.x, pocket.y, dimensions.stack / 2 + BINDER_LAYERS.backing / 2 + BINDER_LAYERS.card + BINDER_LAYERS.film).project(camera)
  await canvas.tap({ position: { x: (point.x + 1) * box.width / 2, y: (1 - point.y) * box.height / 2 } })
  const detail = page.getByRole("dialog", { name: /Snorlax B.*details/ })
  await expect(detail).toHaveAttribute("data-slot-id", "slot-b")
  await expect(detail).toContainText("item-b")
  await harness.closeControl(detail).click()
  const preview = page.getByRole("region", { name: "Your 3D slot binder" })
  await preview.getByRole("button", { name: "Next 3D binder spread" }).click()
  await expect(stage).toHaveAttribute("data-current-page", "2")
  await expect(spread.getByRole("button", { name: /Unfilled target/ })).toHaveCount(2)
  await expect(spread.getByRole("button", { name: /Empty spacer/ })).toHaveCount(1)
  await expect(spread.getByRole("button")).toHaveCount(3)
  await spread.getByRole("button", { name: /Empty spacer/ }).evaluate(button => (button as HTMLButtonElement).click())
  await expect(page.getByRole("dialog", { name: /Empty spacer.*details/ })).toHaveAttribute("data-slot-id", "slot-g")
  await page.keyboard.press("Escape")
  await harness.expectNoHorizontalOverflow()
  await harness.expectWithinSafeViewport(stage)
  await page.goto("/app/e2e-harness?slots=empty")
  await harness.openViewOptions()
  await page.getByRole("button", { name: "3D", exact: true }).click()
  await expect(stage).toHaveAttribute("data-opening-state", "settled")
  await expect(page.getByRole("list", { name: "Cards on this spread" }).getByRole("button")).toHaveCount(0)
})
