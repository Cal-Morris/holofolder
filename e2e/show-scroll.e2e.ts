import { test, expect, SUPABASE_URL } from "./fixtures"
import { HUNT_COLLECTION } from "./hunt-fixtures"

// Synthetic long want list: repeated printings across 100 Pokémon.
const collection = Array.from({ length: 100 }, (_, index) => ({
  ...HUNT_COLLECTION[0], id: `scroll-${index}`, pokemon_id: index + 1,
  pokemon_name: `pokemon ${index + 1}`,
  wanted_cards: Array.from({ length: 5 }, (_, card) => ({
    ...HUNT_COLLECTION[0].wanted_cards[0], card_id: `scroll-${index}-${card}`,
  })),
}))

test.use({ signedIn: true })
test("long Hunting list does not read layout on every touch move", async ({ harness }) => {
  const { page } = harness
  await page.route(`${SUPABASE_URL}/rest/v1/pokemon_collection**`, route =>
    route.request().method() === "GET" ? route.fulfill({ json: collection }) : route.fallback())
  await page.reload()
  await page.getByRole("button", { name: "Show mode", exact: true }).click()
  await page.keyboard.press("Control+k")
  await expect(page.getByRole("dialog", { name: "Quick mode" }).locator("..")).toHaveCSS("backdrop-filter", "none")
  const hunt = page.getByTestId("show-hunt")
  await expect(hunt.getByRole("heading", { name: /Hunting · 500 cards/ })).toBeVisible()
  const groups = hunt.locator('section[aria-label^="Hunting "]')
  await expect(groups).toHaveCount(100)
  await expect(groups.last()).toHaveCSS("content-visibility", "auto")
  expect(await groups.last().locator("button[data-standing]").last().evaluate(el => el.checkVisibility({ contentVisibilityAuto: true }))).toBe(false)
  const row = hunt.locator("button[data-standing]").first()
  const reads = await row.evaluate(element => {
    const original = window.getComputedStyle
    let reads = 0
    window.getComputedStyle = (...args) => { reads++; return original(...args) }
    const target = element.querySelector("img") ?? element
    const dispatch = (type: string, y: number) => target.dispatchEvent(new TouchEvent(type, {
      bubbles: true, cancelable: true,
      touches: [new Touch({ identifier: 1, target, clientX: 100, clientY: y })],
    }))
    try {
      dispatch("touchstart", 400)
      dispatch("touchmove", 395)
      const first = reads
      for (let step = 1; step <= 30; step++) dispatch("touchmove", 395 - step * 3)
      dispatch("touchend", 300)
      return { first, repeated: reads - first }
    } finally { window.getComputedStyle = original }
  })
  await test.info().attach("touch-layout-reads", { body: JSON.stringify(reads), contentType: "application/json" })
  expect(reads.repeated).toBe(0)
  // Exercise a real browser touch gesture too, including native hit testing over the artwork.
  const scroller = hunt.locator(".overflow-y-auto")
  await row.scrollIntoViewIfNeeded()
  const before = await scroller.evaluate(el => el.scrollTop)
  const box = (await row.boundingBox())!
  const cdp = await page.context().newCDPSession(page)
  const x = box.x + 25
  const y = box.y + box.height / 2
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] })
  for (let step = 1; step <= 8; step++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y - step * 10 }] })
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
  await cdp.detach()
  await expect.poll(() => scroller.evaluate(el => el.scrollTop)).toBeGreaterThan(before + 20)
  const last = hunt.locator("button[data-standing]").last()
  await groups.last().scrollIntoViewIfNeeded()
  await last.scrollIntoViewIfNeeded()
  await expect(last).toBeInViewport()
  expect(await groups.last().locator("button[data-standing]").last().evaluate(el => el.checkVisibility({ contentVisibilityAuto: true }))).toBe(true)
  // Once measured, revisiting a group must retain its height and expose its real card controls.
  const height = await groups.last().evaluate(el => el.getBoundingClientRect().height)
  await row.scrollIntoViewIfNeeded()
  await expect(row).toBeInViewport()
  await groups.last().scrollIntoViewIfNeeded()
  await last.scrollIntoViewIfNeeded()
  await expect(last).toBeInViewport()
  expect(await groups.last().evaluate(el => el.getBoundingClientRect().height)).toBeCloseTo(height, 0)
  await last.click()
  await expect(page.getByTestId("quick-card-check")).toBeVisible()
  await harness.expectNoHorizontalOverflow()
})


test("touch guard keeps axis changes, headers and native controls working", async ({ harness }) => {
  const { page } = harness
  await page.getByRole("button", { name: "Show mode", exact: true }).click()
  await page.keyboard.press("Control+k")
  await expect(page.getByTestId("show-hunt")).toBeVisible()
  const results = await page.getByTestId("show-hunt").evaluate(hunt => {
    const fixture = document.createElement("div")
    fixture.innerHTML = '<div style="overflow-x:auto;width:100px;height:40px"><div style="width:400px;height:20px"></div></div><div>Header</div><input type="range">'
    hunt.prepend(fixture)
    const rail = fixture.firstElementChild!.firstElementChild!
    const header = fixture.children[1]
    const range = fixture.children[2]
    const dispatch = (target: Element, type: string, x: number, y: number, count = 1) => target.dispatchEvent(new TouchEvent(type, {
      bubbles: true, cancelable: true,
      touches: Array.from({ length: count }, (_, identifier) => new Touch({ identifier, target, clientX: x, clientY: y })),
    }))
    const move = (target: Element, x: number, y: number, count = 1) => dispatch(target, "touchmove", x, y, count)
    try {
      dispatch(rail, "touchstart", 100, 100)
      const horizontal = move(rail, 60, 102)
      const vertical = move(rail, 102, 60)
      const horizontalAgain = move(rail, 50, 102)
      dispatch(header, "touchstart", 100, 100)
      const blocked = move(header, 100, 60)
      const pinch = move(header, 100, 60, 2)
      dispatch(range, "touchstart", 100, 100)
      const nativeControl = move(range, 60, 100)
      return { horizontal, vertical, horizontalAgain, blocked, pinch, nativeControl }
    } finally { fixture.remove() }
  })
  expect(results).toEqual({ horizontal: true, vertical: false, horizontalAgain: true, blocked: false, pinch: true, nativeControl: true })
})
