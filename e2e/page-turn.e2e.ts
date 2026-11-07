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
    await expect(harness.page.getByRole("dialog", { name: /quick actions$/i })).toBeVisible()
    await expect(harness.page.getByRole("dialog", { name: /details$/i })).toHaveCount(0)
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
    await page.route("**/app/api/card-image-proxy**", (route) => {
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

  test("bounds adjacent image decoding and retries after a failed prefetch", async ({ harness }) => {
    const page = harness.page
    await page.addInitScript(() => {
      const decode = HTMLImageElement.prototype.decode
      const stats = { active: 0, peak: 0, completed: 0, failed: false, retried: false }
      Object.assign(window, { prefetchStats: stats })
      HTMLImageElement.prototype.decode = async function () {
        if (this.fetchPriority !== "low") {
          if (stats.failed && this.src.includes("official-artwork%2F17.png")) stats.retried = true
          return decode.call(this)
        }
        stats.active += 1
        stats.peak = Math.max(stats.peak, stats.active)
        try {
          await new Promise(resolve => setTimeout(resolve, 40))
          if (this.src.includes("official-artwork%2F17.png")) {
            if (!stats.failed) { stats.failed = true; throw new Error("synthetic decode failure") }
            stats.retried = true
          }
          await decode.call(this)
          stats.completed += 1
        } finally { stats.active -= 1 }
      }
    })
    await page.reload()
    const stats = () => page.evaluate(() => (window as unknown as { prefetchStats: { peak: number; completed: number; retried: boolean } }).prefetchStats)
    await expect.poll(async () => (await stats()).completed).toBeGreaterThanOrEqual(15)
    expect((await stats()).peak).toBeLessThanOrEqual(4)
    await page.getByRole("button", { name: "Next binder page", exact: true }).click()
    await expect(page.getByRole("spinbutton", { name: "Binder page number" })).toHaveValue("2")
    await page.getByRole("button", { name: "Previous binder page", exact: true }).click()
    await expect.poll(async () => (await stats()).retried).toBe(true)
  })

  test("keeps the binder visible throughout a page turn", async ({ harness }) => {
    const page = harness.page
    const minimumOpacity = await page.getByTestId("mobile-header-pager").getByRole("button", { name: /^next binder/i }).evaluate(async (button) => {
      const binder = document.querySelector("[data-page-turn-ms]")!
      let minimum = 1
      const start = performance.now()
      ;(button as HTMLButtonElement).click()
      while (performance.now() - start < 300) {
        minimum = Math.min(minimum, Number(getComputedStyle(binder).opacity))
        await new Promise(requestAnimationFrame)
      }
      return minimum
    })
    expect(minimumOpacity).toBeGreaterThanOrEqual(0.85)
    await expect(page.getByRole("spinbutton", { name: "Binder page number" })).toHaveValue("2")
  })

  test("crossfades dock views without animating the dock", async ({ harness }) => {
    const animated = await harness.dock().getByRole("button", { name: "List", exact: true }).evaluate(async (button) => {
      ;(button as HTMLButtonElement).click()
      const start = performance.now()
      while (performance.now() - start < 2000) {
        const animations = document.getAnimations()
        if (animations.some((animation) => animation instanceof CSSAnimation && animation.animationName === "binder-content-in")) return true
        await new Promise(requestAnimationFrame)
      }
      return false
    })
    expect(animated).toBe(true)
    await harness.expectHittable(harness.dock().getByRole("button", { name: "Binder", exact: true }))
    await harness.expectNoHorizontalOverflow()
  })

  test("page turns keep live content interactive without waiting for snapshots", async ({ harness }) => {
    const page = harness.page
    await page.evaluate(() => {
      document.startViewTransition = () => { throw new Error("Page turns must not capture snapshots") }
    })
    for (const direction of ["Next", "Previous"]) {
      await page.getByRole("button", { name: `${direction} binder page`, exact: true }).click()
      await expect(page.getByRole("spinbutton", { name: "Binder page number" })).toHaveValue(direction === "Next" ? "2" : "1")
      await harness.expectHittable(page.locator("button[data-dex-id]").first())
      const transforms = await page.evaluate(() => document.getAnimations().flatMap(animation =>
        animation.effect instanceof KeyframeEffect ? animation.effect.getKeyframes().filter(frame => "transform" in frame) : [],
      ))
      expect(transforms).toEqual([])
    }
  })

  test("rapid page turns and dock taps keep the latest destination", async ({ harness }) => {
    const page = harness.page
    const pager = page.getByTestId("mobile-header-pager")
    const input = page.getByRole("spinbutton", { name: "Binder page number" })
    await pager.getByRole("button", { name: /^next binder/i }).click()
    await expect(input).toHaveValue("2")
    await pager.evaluate((element) => {
      ;(element.querySelector('button[aria-label="Previous binder page"]') as HTMLButtonElement).click()
      ;(element.querySelector('button[aria-label="Next binder page"]') as HTMLButtonElement).click()
    })
    await expect(input).toHaveValue("2")
    await harness.dock().evaluate((element) => {
      const buttons = Array.from(element.querySelectorAll("button"))
      buttons.find((button) => button.getAttribute("aria-label") === "Browse")!.click()
      buttons.find((button) => button.getAttribute("aria-label") === "List")!.click()
      buttons.find((button) => button.getAttribute("aria-label") === "Binder")!.click()
    })
    await expect(input).toHaveValue("2")
    await expect.poll(() => page.evaluate(() => document.documentElement.hasAttribute("data-binder-motion"))).toBe(false)
    await expect(input).toHaveValue("2")
    await harness.expectNoHorizontalOverflow()
  })

  test("returning to the previous page keeps the latest destination", async ({ harness }) => {
    const page = harness.page
    await page.evaluate(() => {
      const start = document.startViewTransition.bind(document)
      document.startViewTransition = (update) => start(async () => {
        await new Promise(resolve => setTimeout(resolve, 300))
        if (typeof update === "function") await update()
      })
    })
    await page.getByRole("button", { name: "Next binder page", exact: true }).click()
    await expect(page.getByRole("spinbutton", { name: "Binder page number" })).toHaveValue("2")
    const input = page.getByRole("spinbutton", { name: "Binder page number" })
    await input.fill("1")
    await input.press("Enter")
    await expect.poll(() => page.evaluate(() => document.documentElement.hasAttribute("data-binder-motion"))).toBe(false)
    await page.waitForTimeout(350)
    await expect(input).toHaveValue("1")
    await expect(page.locator('button[data-dex-id="1"]')).toBeVisible()
  })

  test("returning to the active tab cancels a pending view update", async ({ harness }) => {
    const page = harness.page
    await page.evaluate(() => {
      const start = document.startViewTransition.bind(document)
      document.startViewTransition = (update) => start(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100))
        if (typeof update === "function") await update()
      })
    })
    await harness.dock().getByRole("button", { name: "List", exact: true }).click()
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.binderMotion)).toBe("tab")
    await harness.dock().getByRole("button", { name: "Binder", exact: true }).dispatchEvent("click")
    await expect.poll(() => page.evaluate(() => document.documentElement.hasAttribute("data-binder-motion"))).toBe(false)
    await expect(page.getByRole("spinbutton", { name: "Binder page number" })).toBeVisible()
    await expect(page.getByRole("heading", { name: "List", exact: true })).toHaveCount(0)
  })

  test("older browsers navigate without blanking or stale callbacks", async ({ harness }) => {
    const page = harness.page
    await page.evaluate(() => Object.defineProperty(document, "startViewTransition", { value: undefined, configurable: true }))
    const pager = page.getByTestId("mobile-header-pager")
    const keyframes = await pager.getByRole("button", { name: /^next binder/i }).evaluate((button) => {
      ;(button as HTMLButtonElement).click()
      return document.getAnimations().flatMap(animation => animation.effect instanceof KeyframeEffect ? animation.effect.getKeyframes() : [])
    })
    expect(keyframes.some(frame => "transform" in frame)).toBe(false)
    await expect(page.getByRole("spinbutton", { name: "Binder page number" })).toHaveValue("2")
    await pager.getByRole("button", { name: /^previous binder/i }).click()
    await expect(page.getByRole("spinbutton", { name: "Binder page number" })).toHaveValue("1")
    await expect.poll(() => page.locator("[data-page-turn-ms]").evaluate((element) => Number(getComputedStyle(element.parentElement!).opacity))).toBe(1)
    await harness.dock().getByRole("button", { name: "List", exact: true }).click()
    await expect(page.locator('button[data-dex-id="1"]')).toHaveCount(0)
    await harness.expectNoHorizontalOverflow()
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
