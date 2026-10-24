import type { Page } from "@playwright/test"
import { test, expect, SUPABASE_URL, type Harness } from "./fixtures"
import { HUNT_COLLECTION, HUNT_PRICES } from "./hunt-fixtures"
import { mockCardPrices } from "./price-fixtures"

// Show mode's Scan: the camera is a canvas stream, and the text reader is a stand-in for the system one
// (window.TextDetector) that "reads" whatever the test sets in window.__scanText.

const SCREENS = process.env.E2E_SCREENSHOT_DIR

async function screenshot(harness: Harness, name: string) {
  if (SCREENS && test.info().project.name.startsWith("standalone-390")) await harness.page.screenshot({ path: `${SCREENS}/quick-${name}.png` })
}

type CameraMode = "ok" | "denied"

async function fakeCamera(page: Page, { camera = "ok", reader = true }: { camera?: CameraMode; reader?: boolean } = {}) {
  await page.addInitScript(([cameraMode, withReader]) => {
    const w = window as unknown as Record<string, unknown>
    w.__scanText = ""
    w.__scanReads = 0
    const canvas = document.createElement("canvas")
    canvas.width = 1280
    canvas.height = 720
    const context = canvas.getContext("2d")!
    const draw = () => {
      context.fillStyle = "#1f2937"
      context.fillRect(0, 0, 1280, 720)
      context.fillStyle = "#facc15"
      context.fillRect(510, 70, 260, 580)
    }
    draw()
    window.setInterval(draw, 100)
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: () => cameraMode === "denied"
          ? Promise.reject(new DOMException("Permission denied", "NotAllowedError"))
          : Promise.resolve(canvas.captureStream(10)),
      },
    })
    if (withReader) {
      w.TextDetector = class {
        async detect() {
          w.__scanReads = (w.__scanReads as number) + 1
          const text = String(w.__scanText ?? "")
          return text ? [{ rawValue: text }] : []
        }
      }
    } else {
      delete w.TextDetector
    }
  }, [camera, reader] as const)
}

const setCardText = (page: Page, text: string) => page.evaluate((value) => { (window as unknown as Record<string, unknown>).__scanText = value }, text)

const banner = (harness: Harness) => harness.page.getByRole("region", { name: "Show mode" })
const quickDialog = (harness: Harness) => harness.page.getByRole("dialog", { name: "Quick mode" })
const scanner = (harness: Harness) => harness.page.getByRole("dialog", { name: "Scan a card" })

async function seed(harness: Harness) {
  const { page } = harness
  await page.route(`${SUPABASE_URL}/rest/v1/pokemon_collection**`, (route) =>
    route.request().method() === "GET" ? route.fulfill({ json: HUNT_COLLECTION }) : route.fallback())
  await mockCardPrices(page, HUNT_PRICES)
  await page.reload()
  await expect(page.locator('button[data-dex-id="1"]').first()).toBeVisible()
}

async function openScanner(harness: Harness) {
  if (!(await banner(harness).isVisible())) await harness.page.getByRole("button", { name: "Show mode", exact: true }).click()
  await banner(harness).getByRole("button", { name: "Search", exact: true }).click()
  const dialog = quickDialog(harness)
  await expect(dialog).toBeVisible()
  const scan = dialog.getByRole("button", { name: "Scan a card" })
  await expect(scan).toHaveText("Scan")
  await harness.expectMinTapTarget(scan, 44)
  await harness.expectWithinSafeViewport(scan)
  await harness.expectHittable(scan)
  await scan.click()
  await expect(scanner(harness)).toBeVisible()
  return dialog
}

test.describe("Show mode: scan a card into the deal checker", () => {
  test.use({ signedIn: true })

  test("reads the name and number, opens the deal check, and takes an asking price", async ({ harness }) => {
    const { page } = harness
    await fakeCamera(page)
    await seed(harness)
    const dialog = await openScanner(harness)
    const scan = scanner(harness)
    const read = scan.getByRole("button", { name: "Read card" })
    await expect(read).toBeEnabled()
    for (const button of [read, scan.getByRole("button", { name: "Type instead" }), scan.getByRole("button", { name: "Close scanner" })]) {
      await harness.expectMinTapTarget(button, 44)
      await harness.expectWithinSafeViewport(button)
    }
    await harness.expectNoHorizontalOverflow()
    await screenshot(harness, "scan-camera")

    await setCardText(page, "STAGE 2 Evolves from Charmeleon\nCharizard ex HP 330\nillus. 5ban Graphics 006/165")
    await read.click()
    await expect(scan).toHaveCount(0)
    const check = dialog.getByTestId("quick-card-check")
    await expect(check).toBeVisible()
    await expect(check).toContainText("Charizard ex")
    await expect(check.getByTestId("quick-card-status")).toHaveText("Wanted")
    await expect(check.getByTestId("quick-card-market-price")).toHaveText("£50.00")

    const keypad = check.getByRole("group", { name: "Keypad" })
    const input = check.getByRole("textbox", { name: /price/i })
    while ((await input.inputValue()).length > 0) await keypad.getByRole("button", { name: "Delete digit" }).click()
    for (const digit of ["4", "0"]) await keypad.getByRole("button", { name: digit, exact: true }).click()
    await expect(check.getByTestId("deal-verdict")).toHaveAttribute("data-verdict", /.+/)
    await harness.expectNoHorizontalOverflow()
    await screenshot(harness, "scan-check")

    // Back lands on the search it read, so another printing is one tap away.
    await check.getByRole("button", { name: "Back to results" }).click()
    await expect(dialog.getByRole("searchbox")).toHaveValue("Charizard 6/165")
  })

  test("when it can't tell the printing, the search is typed in to pick from", async ({ harness }) => {
    const { page } = harness
    await fakeCamera(page)
    await seed(harness)
    const dialog = await openScanner(harness)
    await setCardText(page, "Charizard ex HP 330")
    await scanner(harness).getByRole("button", { name: "Read card" }).click()
    await expect(scanner(harness)).toHaveCount(0)
    await expect(dialog.getByRole("searchbox")).toHaveValue("Charizard")
    await expect(dialog.getByTestId("scan-notice")).toHaveText("Read “Charizard”. Pick the right printing below.")
    await expect(dialog.getByRole("button", { name: /^Charizard ex, 151 006\/165, Wanted/ })).toBeVisible()
    await expect(dialog.getByTestId("quick-card-check")).toHaveCount(0)
    await harness.expectNoHorizontalOverflow()
    // Typing takes over from the notice.
    await dialog.getByRole("searchbox").fill("charizard ex")
    await expect(dialog.getByTestId("scan-notice")).toHaveCount(0)
  })

  test("offline, it still reads and matches cards saved on this device", async ({ harness }) => {
    const { page } = harness
    await fakeCamera(page)
    await seed(harness)
    // The deal check is lazy-loaded (precached by the service worker in the app, blocked here):
    // scan once online, then the show's signal drops.
    const dialog = await openScanner(harness)
    await setCardText(page, "Charizard ex HP 330\n006/165")
    await scanner(harness).getByRole("button", { name: "Read card" }).click()
    const check = dialog.getByTestId("quick-card-check")
    await expect(check).toBeVisible()
    await check.getByRole("button", { name: "Back to results" }).click()

    await page.context().setOffline(true)
    await dialog.getByRole("button", { name: "Scan a card" }).click()
    await expect(scanner(harness).getByTestId("card-scan-status")).toContainText("Offline")
    await scanner(harness).getByRole("button", { name: "Read card" }).click()
    await expect(check).toBeVisible()
    await expect(check).toContainText("Charizard ex")
    await expect(check.getByTestId("quick-card-status")).toHaveText("Wanted")
    await screenshot(harness, "scan-offline-check")

    // A card that isn't on this device: what was read is typed in, with why.
    await check.getByRole("button", { name: "Back to results" }).click()
    await dialog.getByRole("button", { name: "Scan a card" }).click()
    await setCardText(page, "Charmeleon HP 90\n005/165")
    await scanner(harness).getByRole("button", { name: "Read card" }).click()
    await expect(dialog.getByRole("searchbox")).toHaveValue("Charmeleon 5/165")
    await expect(dialog.getByTestId("scan-notice")).toContainText("Offline, only cards saved on this device can be matched")
    await harness.expectNoHorizontalOverflow()
    await page.context().setOffline(false)
  })

  test("offline without a text reader, it falls back to typing", async ({ harness }) => {
    const { page } = harness
    await fakeCamera(page, { reader: false })
    await page.route(/cdn\.jsdelivr\.net|unpkg\.com|tessdata/, (route) => route.abort())
    await seed(harness)
    const dialog = await openScanner(harness)
    await page.context().setOffline(true)
    await expect(scanner(harness).getByTestId("card-scan-status")).toContainText("Offline")
    await scanner(harness).getByRole("button", { name: "Read card" }).click()
    await expect(scanner(harness)).toHaveCount(0, { timeout: 30_000 })
    await expect(dialog.getByTestId("scan-notice")).toHaveText("Couldn’t read the card offline. Type its name or number.")
    await expect(dialog.getByRole("searchbox")).toBeFocused()
    await harness.expectNoHorizontalOverflow()
    await screenshot(harness, "scan-offline-type")
    await page.context().setOffline(false)
  })

  test("with the camera off, it says why and Type instead goes back to search", async ({ harness }) => {
    const { page } = harness
    await fakeCamera(page, { camera: "denied" })
    await seed(harness)
    const dialog = await openScanner(harness)
    await expect(scanner(harness).getByTestId("card-scan-status")).toHaveText("Camera access is off. Allow it in Settings to scan.")
    await expect(scanner(harness).getByRole("button", { name: "Read card" })).toBeDisabled()
    await scanner(harness).getByRole("button", { name: "Type instead" }).click()
    await expect(scanner(harness)).toHaveCount(0)
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole("searchbox")).toBeFocused()
  })

  test("the want list's price check has Scan too", async ({ harness }) => {
    const { page } = harness
    await fakeCamera(page)
    await seed(harness)
    await harness.dock().getByRole("button", { name: "Wanted", exact: true }).click()
    const main = page.getByTestId("main-content")
    await main.getByRole("searchbox", { name: "Search want list" }).fill("charmeleon")
    await main.getByRole("button", { name: "Check price of any card", exact: true }).click()
    const dialog = quickDialog(harness)
    await expect(dialog.getByRole("heading", { name: "Price check" })).toBeVisible()
    await dialog.getByRole("button", { name: "Scan a card" }).click()
    await setCardText(page, "Charizard ex\n006/165")
    await scanner(harness).getByRole("button", { name: "Read card" }).click()
    await expect(dialog.getByTestId("quick-card-check")).toContainText("Charizard ex")
  })
})
