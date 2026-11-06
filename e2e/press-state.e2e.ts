import { test, expect, type Harness } from "./fixtures"
import type { Locator } from "@playwright/test"

type Pressed = { scale: string; filter: string; transition: string }

async function styles(target: Locator): Promise<Pressed> {
  return target.evaluate((element) => {
    const style = getComputedStyle(element)
    return { scale: style.scale, filter: style.filter, transition: `${style.transitionProperty}|${style.transitionDuration}` }
  })
}

/** Holds the pointer on `target` and returns its resting and pressed styles. */
async function press(harness: Harness, target: Locator) {
  await expect(target).toBeVisible()
  const rest = await styles(target)
  const box = (await target.boundingBox())!
  await harness.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await harness.page.mouse.down()
  // The press settles in under 100ms.
  await harness.page.waitForTimeout(100)
  const pressed = await styles(target)
  await harness.page.mouse.move(0, 0)
  await harness.page.mouse.up()
  return { rest, pressed }
}

function expectPressed({ rest, pressed }: { rest: Pressed; pressed: Pressed }, maxScale: number) {
  const scale = pressed.scale === "none" ? 1 : Number.parseFloat(pressed.scale)
  expect(scale).toBeLessThanOrEqual(maxScale)
  expect(scale).toBeGreaterThan(0.9)
  expect(pressed.filter).toContain("brightness(")
  // Pressed styling never changes the control's own transition.
  expect(pressed.transition).toBe(rest.transition)
  expect(rest.filter).not.toContain("brightness(0.9")
}

test.describe("pressed state", () => {
  test.use({ signedIn: true })

  test("dock buttons scale and dim while held", async ({ harness }) => {
    expectPressed(await press(harness, harness.dock().getByRole("button", { name: "List", exact: true })), 0.97)
  })

  test("binder slots press with their subtle scale", async ({ harness }) => {
    const result = await press(harness, harness.page.locator("button[data-dex-id=\"4\"]").first())
    expectPressed(result, 0.985)
  })

  test("sheet buttons and rows dim while held", async ({ harness }) => {
    const detail = await harness.openCardDetail()
    expectPressed(await press(harness, detail.getByRole("button", { name: /all bulbasaur cards/i })), 0.99)
  })

  test("releasing restores the resting style immediately", async ({ harness }) => {
    const target = harness.dock().getByRole("button", { name: "Browse", exact: true })
    await press(harness, target)
    const after = await styles(target)
    expect(after.filter).not.toContain("brightness(")
  })

  test.describe("reduced motion", () => {
    test.use({ reducedMotion: "reduce" })
    test("keeps the dim without any scale", async ({ harness }) => {
      const { pressed } = await press(harness, harness.dock().getByRole("button", { name: "List", exact: true }))
      expect(pressed.scale === "none" || Number.parseFloat(pressed.scale) === 1).toBe(true)
      expect(pressed.filter).toContain("brightness(")
    })
  })
})
