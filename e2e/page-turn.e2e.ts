import { test, expect } from "./fixtures"

const PLACEHOLDER = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><rect width="240" height="240" fill="#16a34a"/></svg>`
const artworkMarker = (dexId: number) => `official-artwork%2F${dexId}.png`

test.describe("binder page turn", () => {
  test("small finger movement still allows a long press", async ({ harness }) => {
    const slot = harness.page.locator('button[data-dex-id="1"]').first()
    await slot.evaluate(async (element) => {
      const touch = new Touch({ identifier: 1, target: element, clientX: 100, clientY: 100 })
      element.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, touches: [touch], changedTouches: [touch] }))
      const moved = new Touch({ identifier: 1, target: element, clientX: 101, clientY: 100 })
      element.dispatchEvent(new TouchEvent("touchmove", { bubbles: true, touches: [moved], changedTouches: [moved] }))
      await new Promise((resolve) => setTimeout(resolve, 450))
      element.dispatchEvent(new TouchEvent("touchend", { bubbles: true, touches: [], changedTouches: [moved] }))
    })
    await expect(harness.page.getByRole("button", { name: "Close quick actions" })).toBeVisible()
    await slot.dispatchEvent("click", { detail: 1 })
    await expect(harness.page.getByRole("button", { name: "Close quick actions" })).toBeVisible()
    await expect(harness.dialogs()).toHaveCount(0)
  })

  test("swipes do not select cards, including delayed clicks and slow drags", async ({ harness }) => {
    const page = harness.page
    const pageInput = page.getByRole("spinbutton", { name: "Binder page number" })
    for (const deltaX of [-80, 80, -25]) {
      const slot = page.locator("button[data-dex-id]").first()
      await slot.evaluate(async (element, deltaX) => {
        const box = element.getBoundingClientRect()
        const startX = box.x + box.width / 2
        const y = box.y + box.height / 2
        const dispatch = (type: string, x: number) => {
          const touch = new Touch({ identifier: 1, target: element, clientX: x, clientY: y })
          element.dispatchEvent(new TouchEvent(type, {
            bubbles: true, touches: type === "touchend" ? [] : [touch], changedTouches: [touch],
          }))
        }
        dispatch("touchstart", startX)
        dispatch("touchmove", startX + deltaX)
        // A slow drag must cancel the card's 400 ms long press.
        await new Promise((resolve) => setTimeout(resolve, 450))
        dispatch("touchend", startX + deltaX)
      }, deltaX)
      await expect(page.getByRole("button", { name: "Close quick actions" })).toHaveCount(0)
      await expect(pageInput).toHaveValue(deltaX === -80 ? "2" : "1")
      // Model a compatibility click arriving after the old 150 ms swipe guard expires.
      await page.waitForTimeout(200)
      await page.locator("button[data-dex-id]").first().dispatchEvent("click", { detail: 1 })
      await expect(harness.dialogs()).toHaveCount(0)
    }
    // Starting a fresh tap must release the guard.
    await page.locator('button[data-dex-id="1"]').first().tap()
    await expect(page.getByRole("dialog", { name: /bulbasaur/i })).toBeVisible()
  })

  test("prefetches and decodes the next page's slot images before the turn", async ({ harness }) => {
    const page = harness.page
    const requested: string[] = []
    await page.route("**/api/card-image-proxy**", (route) => {
      requested.push(route.request().url())
      return route.fulfill({ contentType: "image/svg+xml", headers: { "cache-control": "public, max-age=3600" }, body: PLACEHOLDER })
    })
    await page.reload()
    await expect(harness.dock()).toBeVisible()
    await expect(page.locator('button[data-dex-id="1"]').first()).toBeVisible()

    // Page 2 (dex #17-#32) is not on screen, but its grid-size artwork is fetched once page 1 settles.
    await expect.poll(() => [17, 32].every((dexId) => requested.some((url) => url.includes(artworkMarker(dexId)))), { timeout: 5_000 }).toBe(true)
    await expect(page.locator('button[data-dex-id="17"]')).toHaveCount(0)
    const prefetched = requested.find((url) => url.includes(artworkMarker(17)))!
    expect(prefetched).toContain("&w=240")

    await harness.page.getByTestId("mobile-header-pager").getByRole("button", { name: /^next binder/i }).click()
    const slotImage = page.locator('button[data-dex-id="17"] img').first()
    await expect(slotImage).toBeVisible()
    // The grid renders exactly the URL that was prefetched...
    expect(new URL(await slotImage.evaluate((img: HTMLImageElement) => img.currentSrc || img.src)).href).toBe(new URL(prefetched).href)
    // ...and it is ready almost immediately after the turn.
    await expect.poll(() => slotImage.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0), { timeout: 400 }).toBe(true)
  })

  test("is quick, with a snappy ease-out", async ({ harness }) => {
    const binder = harness.page.locator("[data-page-turn-ms]")
    const ms = Number(await binder.getAttribute("data-page-turn-ms"))
    expect(ms).toBeGreaterThan(0)
    expect(ms).toBeLessThanOrEqual(100)
    const style = await binder.evaluate((element) => getComputedStyle(element))
    expect(parseFloat(style.transitionDuration) * 1000).toBeLessThanOrEqual(100)
    expect(style.transitionTimingFunction).toContain("cubic-bezier")

    const pageInput = harness.page.getByRole("spinbutton", { name: "Binder page number" })
    await harness.page.getByTestId("mobile-header-pager").getByRole("button", { name: /^next binder/i }).click()
    await expect(pageInput).toHaveValue("2", { timeout: 400 })
  })

  test("is instant with prefers-reduced-motion", async ({ harness }) => {
    await harness.page.emulateMedia({ reducedMotion: "reduce" })
    const binder = harness.page.locator("[data-page-turn-ms]")
    await expect(binder).toHaveAttribute("data-page-turn-ms", "0")
    const pageInput = harness.page.getByRole("spinbutton", { name: "Binder page number" })
    await harness.page.getByTestId("mobile-header-pager").getByRole("button", { name: /^next binder/i }).click()
    await expect(pageInput).toHaveValue("2", { timeout: 150 })
    // Never faded out.
    expect(await binder.evaluate((element) => getComputedStyle(element).opacity)).toBe("1")
  })
})
