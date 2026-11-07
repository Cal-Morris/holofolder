import { test, expect, SUPABASE_URL, SEEDED_COLLECTION, placeholderSvg } from "./fixtures"

test.use({ signedIn: true })

for (const reducedMotion of [false, true]) test(`page handoff keeps complete previews, reduced motion ${reducedMotion}`, async ({ harness }, testInfo) => {
  const { page } = harness
  await page.emulateMedia({ reducedMotion: reducedMotion ? "reduce" : "no-preference" })
  // Synthetic owned/wanted printings across three pages, with deliberately staggered image responses.
  const collection = Array.from({ length: 48 }, (_, index) => {
    const id = index + 1
    const printing = { card_id: `synthetic-${id}`, card_name: `Synthetic ${id}`, card_image: `https://assets.tcgdex.net/en/mock/swipe/${id}/high.webp`, card_finish: "normal" }
    return { ...SEEDED_COLLECTION[0], id: `swipe-${id}`, pokemon_id: id, ...printing, wanted_cards: id % 2 ? [] : [{ ...printing, added_at: "2026-01-01T00:00:00Z" }] }
  })
  await page.route(`${SUPABASE_URL}/rest/v1/pokemon_collection**`, route => route.fulfill({ json: collection }))
  let release!: () => void
  const delayed = new Promise<void>(resolve => { release = resolve })
  await page.route("**/app/api/card-image-proxy**", async route => {
    const source = new URL(route.request().url()).searchParams.get("url") ?? ""
    const id = Number(source.match(/swipe\/(\d+)/)?.[1] ?? 1)
    if (id > 16) await delayed
    await route.fulfill({ contentType: "image/svg+xml", headers: { "cache-control": "public, max-age=3600" }, body: placeholderSvg(`Synthetic ${id}`, id) })
  })
  await page.reload({ waitUntil: "domcontentloaded" })
  await expect(page.locator('[data-dex-id="1"] img')).toHaveAttribute("alt", "Synthetic 1")
  await expect.poll(() => page.locator('[data-binder-page] img').evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true)
  const beforeBox = await page.locator("[data-binder-page]").boundingBox()
  await page.screenshot({ path: testInfo.outputPath("01-before.png") })
  const swipe = async (delta: number) => page.locator("[data-page-turn-ms]").evaluate((element, delta) => {
    for (const type of ["touchstart", "touchmove", "touchend"]) {
      const touch = new Touch({ identifier: 1, target: element, clientX: type === "touchstart" ? 180 : 180 + delta, clientY: 300 })
      element.dispatchEvent(new TouchEvent(type, { bubbles: true, touches: type === "touchend" ? [] : [touch], changedTouches: [touch] }))
    }
  }, delta)
  await swipe(-80)
  await expect(page.getByRole("status").filter({ hasText: "Loading page 2" })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath("02-pending.png") })
  const incomplete = await page.locator('[data-binder-page] img').evaluateAll(images => images.filter(image => !(image as HTMLImageElement).complete || !(image as HTMLImageElement).naturalWidth).length)
  await swipe(-80)
  await expect(page.getByRole("status").filter({ hasText: "Loading page 3" })).toBeVisible()
  await swipe(80)
  await expect(page.getByRole("status").filter({ hasText: "Loading page 2" })).toBeVisible()
  // Release even on the old implementation so the route never holds teardown open.
  release()
  expect(incomplete).toBe(0)
  await expect(page.locator('[data-binder-page="2"]')).toBeVisible()
  await expect.poll(() => page.locator('[data-binder-page] img').evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true)
  expect(await page.locator("[data-binder-page]").boundingBox()).toEqual(beforeBox)
  await page.screenshot({ path: testInfo.outputPath("03-ready.png") })
  await expect(page.getByRole("spinbutton", { name: "Binder page number" })).toHaveValue("2")
  // The return uses already decoded images; sample each browser frame through the handoff.
  const frames = await page.evaluate(async () => {
    const frames: { page: string | null; missing: number; opacity: string }[] = []
    ;(document.querySelector('button[aria-label="Previous binder page"]') as HTMLButtonElement).click()
    const start = performance.now()
    while (performance.now() - start < 350) {
      const grid = document.querySelector("[data-binder-page]")!
      frames.push({ page: grid.getAttribute("data-binder-page"), missing: Array.from(grid.querySelectorAll("img")).filter(img => !img.complete || !img.naturalWidth).length, opacity: getComputedStyle(grid).opacity })
      await new Promise(requestAnimationFrame)
    }
    return frames
  })
  await testInfo.attach("warm-turn-frames", { body: JSON.stringify(frames), contentType: "application/json" })
  expect(frames.every(frame => frame.missing === 0)).toBe(true)
  expect(frames.at(-1)?.page).toBe("1")
  await page.screenshot({ path: testInfo.outputPath("04-warm-return.png") })
  await harness.expectNoHorizontalOverflow()
})

test("failed destination images do not block navigation or a return to the cached page", async ({ harness }) => {
  const { page } = harness
  await page.route("**/app/api/card-image-proxy**", route => route.abort())
  await page.getByRole("button", { name: "Next binder page", exact: true }).click()
  await expect(page.locator('[data-binder-page="2"]')).toBeVisible()
  await expect(page.locator("[data-page-turn-ms]")).toHaveAttribute("aria-busy", "false")
  await page.getByRole("button", { name: "Previous binder page", exact: true }).click()
  await expect(page.locator('[data-binder-page="1"]')).toBeVisible()
  await harness.expectNoHorizontalOverflow()
})
