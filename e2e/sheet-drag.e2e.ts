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
