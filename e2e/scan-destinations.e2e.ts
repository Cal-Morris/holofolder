import { test, expect } from "./fixtures"
import type { Page } from "@playwright/test"

const review = (page: Page) => page.getByRole("dialog", { name: "Review scan destinations" })
const control = (page: Page, mode: string) => page.evaluate(mode => window.dispatchEvent(new CustomEvent("synthetic-scan-control", { detail: mode })), mode)
const photo = async (page: Page) => {
  await page.getByRole("button", { name: "Page scan", exact: true }).click()
  // Synthetic detector consumes no image pixels. The real component freezes scope before invoking it.
  await page.getByLabel("Page photo", { exact: true }).setInputFiles({ name: "synthetic-page.png", mimeType: "image/png", buffer: Buffer.from("synthetic") })
}
const choose = async (page: Page, cell: number, card: string, slot: string) => {
  await page.getByRole("combobox", { name: `Card for cell ${cell}`, exact: true }).selectOption(`${card}:en`)
  await page.getByRole("combobox", { name: `Copy for cell ${cell}`, exact: true }).selectOption("raw")
  await page.getByRole("combobox", { name: `Destination for cell ${cell}`, exact: true }).selectOption(`slot:${slot}`)
}

test.describe("native scan acceptance, synthetic device only", () => {
  test.beforeEach(async ({ harness }) => {
    const { page } = harness
    await page.addInitScript(() => {
      const canvas = document.createElement("canvas")
      canvas.width = 640; canvas.height = 480
      const draw = () => { const context = canvas.getContext("2d")!; context.fillStyle = "#123456"; context.fillRect(0, 0, 640, 480) }
      draw(); window.setInterval(draw, 100)
      Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => canvas.captureStream(10) } })
      // Synthetic OCR, not a camera accuracy claim.
      Object.assign(window, { TextDetector: class { async detect() { return [{ rawValue: "Trainer Supporter Trainer 1/100" }] } } })
    })
    await page.goto("/app/e2e-harness/scan-destinations")
    await expect(page.getByRole("button", { name: "Page scan", exact: true })).toBeVisible()
  })

  test("shuffled page cells retain IDs, occupancy never owns, non-dex target/free assignments commit together", async ({ harness }) => {
    const { page } = harness
    await photo(page)
    const dialog = review(page)
    await expect(dialog.getByRole("region", { name: "Cell 1", exact: true })).toContainText("slot-a")
    await expect(dialog.getByRole("region", { name: "Cell 6", exact: true })).toContainText("slot-f")
    await expect(page.getByLabel("Pending scan count")).toHaveText("0")
    await expect(dialog.getByRole("button", { name: "Confirm scan draft" })).toBeDisabled()
    await choose(page, 1, "synthetic-energy", "slot-g")
    const options = await page.getByRole("combobox", { name: "Destination for cell 1", exact: true }).locator("option").allTextContents()
    expect(options.join(" ")).not.toContain("slot-a")
    await choose(page, 6, "synthetic-trainer", "slot-f")
    await harness.expectWithinSafeViewport(dialog)
    await harness.expectNoHorizontalOverflow()
    for (const name of ["Cancel", "Confirm scan draft", "Close scan review"]) {
      const button = dialog.getByRole("button", { name, exact: true })
      await harness.expectMinTapTarget(button, 36)
      await harness.expectWithinSafeViewport(button)
      await harness.expectHittable(button)
    }
    const box = (await dialog.boundingBox())!
    console.log("scan review geometry", test.info().project.name, JSON.stringify(box))
    await dialog.getByRole("button", { name: "Confirm scan draft" }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByLabel("Pending scan count")).toHaveText("1")
    await expect(page.getByText("slot-a: empty", { exact: true })).toBeVisible()
    await expect(page.getByText(/^slot-f:/)).not.toHaveText("slot-f: empty")
    await page.reload()
    await expect(page.getByLabel("Pending scan count")).toHaveText("1")
  })

  test("camera page capture goes through the same review without saving occupancy", async ({ harness }) => {
    const { page } = harness
    await page.getByRole("button", { name: "Page scan", exact: true }).click()
    await expect(page.getByRole("button", { name: "Capture page", exact: true })).toBeEnabled()
    await page.getByRole("button", { name: "Capture page", exact: true }).click()
    await expect(review(page)).toBeVisible()
    await expect(page.getByLabel("Pending scan count")).toHaveText("0")
    await review(page).getByRole("button", { name: "Cancel", exact: true }).click()
    await expect(page.getByLabel("Pending scan count")).toHaveText("0")
  })

  test("online native card lookup requests non-Pokémon results and still requires explicit selection", async ({ harness }) => {
    const { page } = harness
    await control(page, "online")
    const calls: string[] = []
    await page.route("**/app/api/tcg-card-search**", route => {
      calls.push(route.request().url())
      expect(new URL(route.request().url()).searchParams.get("includeNonPokemon")).toBe("1")
      return route.fulfill({ json: { cards: [{ id: "synthetic-trainer", name: "Trainer", dexIds: [], localId: "1", language: "en", set: { id: "synthetic", name: "Synthetic set" } }] } })
    })
    await page.getByRole("button", { name: "Card scan", exact: true }).click()
    await expect(page.getByRole("button", { name: "Read card", exact: true })).toBeEnabled()
    await page.getByRole("button", { name: "Read card", exact: true }).click()
    await expect(review(page)).toBeVisible()
    await expect(page.getByRole("combobox", { name: "Card for cell 1", exact: true })).toHaveValue("")
    expect(calls.length).toBe(1)
    await choose(page, 1, "synthetic-trainer", "slot-g")
    await review(page).getByRole("button", { name: "Confirm scan draft" }).click()
    await expect(page.getByLabel("Pending scan count")).toHaveText("1")
  })

  test("new lookup identity reaches the queue target check without a second catalog request", async ({ harness }) => {
    const { page } = harness
    await control(page, "online")
    await page.route("**/app/api/tcg-card-search**", route => route.fulfill({ json: { cards: [
      { id: "synthetic-new-snorlax", name: "Synthetic new Snorlax", dexIds: [143], localId: "1", language: "en", set: { id: "synthetic", name: "Synthetic set" } },
    ] } }))
    await page.getByRole("button", { name: "Card scan", exact: true }).click()
    await expect(page.getByRole("button", { name: "Read card", exact: true })).toBeEnabled()
    await page.getByRole("button", { name: "Read card", exact: true }).click()
    await expect(review(page)).toBeVisible()
    await choose(page, 1, "synthetic-new-snorlax", "slot-b")
    await review(page).getByRole("button", { name: "Confirm scan draft" }).click()
    await expect(page.getByLabel("Pending scan count")).toHaveText("1")
    await expect(page.getByText("slot-a: empty", { exact: true })).toBeVisible()
  })

  for (const mode of ["reorder", "grid", "owner", "session"]) test(`rejects ${mode} change during review`, async ({ harness }) => {
    const { page } = harness
    await photo(page)
    await choose(page, 1, "synthetic-snorlax-a", "slot-b")
    await page.getByRole("checkbox", { name: "Skip cell 6" }).check()
    await control(page, mode)
    await expect(review(page).getByRole("alert")).toContainText("changed")
    await expect(review(page).getByRole("button", { name: "Confirm scan draft" })).toBeDisabled()
    await expect(page.getByLabel("Pending scan count")).toHaveText("0")
  })

  test("repeat species never defaults to first row, retry keeps exact operation after storage failure", async ({ harness }) => {
    const { page } = harness
    await photo(page)
    await page.getByRole("combobox", { name: "Card for cell 1", exact: true }).selectOption("synthetic-snorlax-a:en")
    await expect(page.getByRole("combobox", { name: "Destination for cell 1", exact: true })).toHaveValue("")
    await page.getByRole("combobox", { name: "Copy for cell 1", exact: true }).selectOption("raw")
    await page.getByRole("combobox", { name: "Destination for cell 1", exact: true }).selectOption("slot:slot-b")
    await page.getByRole("checkbox", { name: "Skip cell 6" }).check()
    await control(page, "fail")
    await review(page).getByRole("button", { name: "Confirm scan draft" }).click()
    await expect(review(page).getByRole("alert")).toContainText("Could not save")
    await expect(page.getByLabel("Pending scan count")).toHaveText("0")
    const attempt = await page.getByLabel("Scan attempts").textContent()
    await review(page).getByRole("button", { name: "Retry same draft" }).click()
    await expect(page.getByLabel("Pending scan count")).toHaveText("1")
    await expect(page.getByLabel("Scan attempts")).toHaveText(`${attempt},${attempt}`)
    await expect(page.getByText("slot-a: empty", { exact: true })).toBeVisible()
    await expect(page.getByText(/^slot-b:/)).not.toHaveText("slot-b: empty")
  })

  test("offline cached card scan enters explicit review without legacy callback or network lookup", async ({ harness }) => {
    const { page } = harness
    const lookups: string[] = []
    page.on("request", request => { if (/tcg-card-search|api\/inventory|api\/binder-slots/.test(request.url())) lookups.push(request.url()) })
    await page.context().setOffline(true)
    await page.getByRole("button", { name: "Card scan", exact: true }).click()
    await expect(page.getByRole("button", { name: "Read card", exact: true })).toBeEnabled()
    await page.getByRole("button", { name: "Read card", exact: true }).click()
    await expect(review(page)).toBeVisible()
    await choose(page, 1, "synthetic-trainer", "slot-g")
    await review(page).getByRole("button", { name: "Confirm scan draft" }).click()
    await expect(page.getByLabel("Pending scan count")).toHaveText("1")
    expect(lookups).toEqual([])
  })

  test("uncached occupancy stays unresolved and cancellation saves no partial results", async ({ harness }) => {
    const { page } = harness
    await control(page, "unknown")
    await photo(page)
    await expect(review(page).getByText(/Unidentified content/)).toHaveCount(2)
    await expect(review(page).getByRole("button", { name: "Confirm scan draft" })).toBeDisabled()
    await review(page).getByRole("button", { name: "Cancel", exact: true }).click()
    await expect(review(page)).toHaveCount(0)
    await expect(page.getByLabel("Pending scan count")).toHaveText("0")
  })

  test("cancel during detection ignores late results", async ({ harness }) => {
    const { page } = harness
    await control(page, "defer")
    await photo(page)
    await expect(page.getByRole("dialog", { name: "Scan stable page" }).getByRole("status")).toContainText("Reading page")
    await page.getByRole("button", { name: "Close page scanner" }).click()
    await page.evaluate(() => window.dispatchEvent(new Event("synthetic-scan-release")))
    await expect(review(page)).toHaveCount(0)
    await expect(page.getByLabel("Pending scan count")).toHaveText("0")
    await harness.expectScrollUnlocked()
  })

  test("layout change while detection is pending cannot use new positional occupants", async ({ harness }) => {
    const { page } = harness
    await control(page, "defer")
    await photo(page)
    await expect(page.getByRole("dialog", { name: "Scan stable page" }).getByRole("status")).toContainText("Reading page")
    await control(page, "reorder")
    await page.evaluate(() => window.dispatchEvent(new Event("synthetic-scan-release")))
    await expect(review(page).getByRole("alert")).toContainText("changed")
    await expect(review(page).getByRole("button", { name: "Confirm scan draft" })).toBeDisabled()
    await expect(page.getByLabel("Pending scan count")).toHaveText("0")
  })

  for (const dismiss of ["escape", "back", "backdrop", "swipe"] as const) test(`review dismissal by ${dismiss} never saves`, async ({ harness }) => {
    const { page } = harness
    await photo(page)
    await expect(review(page)).toBeVisible()
    if (dismiss === "escape") await page.keyboard.press("Escape")
    if (dismiss === "back") await page.goBack()
    if (dismiss === "backdrop") await harness.tapBackdrop(review(page))
    if (dismiss === "swipe") await harness.swipeDown(review(page))
    await expect(review(page)).toHaveCount(0)
    await expect(page.getByLabel("Pending scan count")).toHaveText("0")
    await harness.expectScrollUnlocked()
  })
})


test("scanner harness requires a loopback request hostname", async ({ request }) => {
  const local = await request.get("/app/e2e-harness/scan-destinations")
  expect(local.status()).toBe(200)
  const remote = await request.get("/app/e2e-harness/scan-destinations", { headers: { Host: "synthetic-remote.example" } })
  const denied = await remote.text()
  expect(denied).not.toContain("Synthetic scan destinations")
  // The static Suspense shell has streamed before request-time notFound resolves.
  expect(denied).toContain("NEXT_HTTP_ERROR_FALLBACK;404")
  expect(denied).toContain("noindex")
})
