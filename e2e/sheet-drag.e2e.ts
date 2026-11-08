import { test, expect, type Harness } from "./fixtures"
import type { Locator } from "@playwright/test"

/** Drags a sheet's grabber by `distance` px over `steps` moves, waiting `pauseMs` between moves. */
async function drag(harness: Harness, dialog: Locator, distance: number, steps: number, pauseMs = 0, release = true) {
  const grabber = dialog.locator("[data-sheet-grabber]").first()
  const box = (await grabber.boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + Math.min(box.height / 2, 10)
  await harness.page.mouse.move(x, y)
  await harness.page.mouse.down()
  for (let step = 1; step <= steps; step += 1) {
    if (pauseMs) await harness.page.waitForTimeout(pauseMs)
    await harness.page.mouse.move(x, y + (distance * step) / steps)
  }
  if (release) await harness.page.mouse.up()
}

/**
 * A quick flick with controlled timing: real mouse moves are spaced by however long the
 * browser takes to answer, so under load they cannot reliably produce a fast gesture.
 */
async function flick(dialog: Locator, distance: number, durationMs: number) {
  await dialog.locator("[data-sheet-grabber]").first().evaluate(async (grabber, { distance, durationMs }) => {
    const rect = grabber.getBoundingClientRect()
    const x = rect.left + rect.width / 2
    const y = rect.top + Math.min(rect.height / 2, 10)
    const fire = (type: string, clientY: number) => grabber.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: "touch", isPrimary: true, button: type === "pointermove" ? -1 : 0, buttons: type === "pointerup" ? 0 : 1, clientX: x, clientY }))
    const wait = (ms: number) => { const until = performance.now() + ms; while (performance.now() < until) { /* spin: keep event timestamps exact */ } }
    fire("pointerdown", y)
    const steps = 4
    for (let step = 1; step <= steps; step += 1) {
      wait(durationMs / steps)
      fire("pointermove", y + (distance * step) / steps)
    }
    fire("pointerup", y + distance)
  }, { distance, durationMs })
}

test.describe("sheet drag to dismiss", () => {
  test("card detail follows the finger and snaps back on a slow short drag", async ({ harness }) => {
    const dialog = await harness.openCardDetail()
    const before = (await dialog.boundingBox())!
    await drag(harness, dialog, 50, 10, 30, false)
    await expect.poll(async () => (await dialog.boundingBox())!.y - before.y).toBeGreaterThan(30)
    await harness.page.mouse.up()
    await expect(dialog).toBeVisible()
    await expect.poll(async () => Math.abs((await dialog.boundingBox())!.y - before.y)).toBeLessThan(2)
  })

  test("card detail dismisses on a short fast flick", async ({ harness }) => {
    const dialog = await harness.openCardDetail()
    await flick(dialog, 48, 60)
    await expect(dialog).toBeHidden()
    await expect(harness.dialogs()).toHaveCount(0)
    await harness.expectScrollUnlocked()
  })

  test("all cards sheet dismisses on a flick and returns to the detail", async ({ harness }) => {
    const detail = await harness.openCardDetail()
    await detail.getByRole("button", { name: /all bulbasaur cards/i }).click()
    const sheet = harness.page.getByRole("dialog", { name: /all bulbasaur cards/i })
    await expect(sheet).toBeVisible()
    await flick(sheet, 48, 60)
    await expect(sheet).toBeHidden()
    await expect(harness.page.getByRole("dialog", { name: /bulbasaur details/i })).toBeVisible()
  })

  test("pulling a sheet up only rubber-bands a few pixels", async ({ harness }) => {
    const dialog = await harness.openCardDetail()
    const before = (await dialog.boundingBox())!
    await drag(harness, dialog, -300, 10, 0, false)
    const lifted = before.y - (await dialog.boundingBox())!.y
    expect(lifted).toBeGreaterThan(0)
    expect(lifted).toBeLessThanOrEqual(18)
    await harness.page.mouse.up()
    await expect(dialog).toBeVisible()
  })
})

for (const closing of [false, true]) {
  test(`a sheet can be caught during ${closing ? "dismissal" : "snap-back"} without jumping`, async ({ harness }) => {
    const dialog = await harness.openCardDetail()
    await expect(dialog.locator("[data-sheet-grabber]").first()).toHaveCSS("touch-action", "none")
    const result = await dialog.evaluate(async (sheet, closing) => {
      const grabber = sheet.querySelector<HTMLElement>("[data-sheet-grabber]")!
      const fire = (type: string, y: number) => grabber.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, isPrimary: true, pointerId: 9, pointerType: "touch", button: 0, clientY: y,
      }))
      fire("pointerdown", 100)
      fire("pointermove", closing ? 220 : 150)
      if (!closing) await new Promise(resolve => setTimeout(resolve, 100))
      fire("pointerup", closing ? 220 : 150)
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const before = sheet.getBoundingClientRect().y
      fire("pointerdown", 200)
      fire("pointermove", 210)
      const after = sheet.getBoundingClientRect().y
      fire("pointermove", -500)
      fire("pointercancel", -500)
      return { before, after }
    }, closing)
    expect(result.after - result.before).toBeCloseTo(10, 0)
    await expect(dialog).toBeVisible()
    await expect.poll(() => dialog.evaluate(sheet => getComputedStyle(sheet).translate)).toBe("none")
    await harness.expectWithinSafeViewport(harness.closeControl(dialog))
    await harness.expectNoHorizontalOverflow()
  })
}

test("another finger cannot take over or cancel a sheet drag", async ({ harness }) => {
  const dialog = await harness.openCardDetail()
  await expect(dialog.locator("[data-sheet-grabber]").first()).toHaveCSS("touch-action", "none")
  const distance = await dialog.evaluate(sheet => {
    const grabber = sheet.querySelector<HTMLElement>("[data-sheet-grabber]")!
    const fire = (type: string, pointerId: number, y: number) => grabber.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, isPrimary: true, pointerId, pointerType: "touch", button: 0, clientY: y,
    }))
    const before = sheet.getBoundingClientRect().y
    fire("pointerdown", 1, 100)
    fire("pointermove", 1, 130)
    fire("pointerdown", 2, 500)
    fire("pointercancel", 2, 500)
    fire("pointermove", 1, 150)
    const distance = sheet.getBoundingClientRect().y - before
    fire("pointercancel", 1, 150)
    return distance
  })
  expect(distance).toBeCloseTo(50, 0)
  await expect(dialog).toBeVisible()
})
