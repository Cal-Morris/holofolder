import { test, expect, MOCK_CARDS } from "./fixtures"

test.use({ signedIn: true })

for (const picker of [false, true]) {
  test(`${picker ? "card picker" : "all cards"} stays opaque and open while scrolling`, async ({ harness }) => {
    const { page } = harness
    // Synthetic printings make the card grid scroll at every phone size.
    const cards = Array.from({ length: 80 }, (_, index) => ({ ...MOCK_CARDS[0], id: `scroll-${index}`, localId: String(index) }))
    await page.route("**/api/tcgdex-cache**", route => route.fulfill({ json: { cards } }))
    const detail = await harness.openCardDetail()
    await detail.getByRole("button", { name: picker ? /edit card|add card/i : /all bulbasaur cards/i }).first().click()
    const dialog = page.getByRole("dialog", { name: picker ? "Card selector" : "All Bulbasaur cards", exact: true })
    await expect(dialog).toBeVisible()
    const scroller = dialog.locator("div.overflow-y-auto").last()
    await expect.poll(() => scroller.evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(100)
    for (const dark of [false, true]) {
      await page.evaluate(dark => document.documentElement.classList.toggle("dark", dark), dark)
      const surface = await dialog.evaluate(element => {
        const style = getComputedStyle(element)
        return { background: style.backgroundColor, blur: style.backdropFilter }
      })
      expect(surface.background).not.toMatch(/\/|rgba\(/)
      expect(surface.blur).toBe("none")
      const frames = await scroller.evaluate(async element => {
        const dialog = element.closest('[role="dialog"]')!
        const samples: boolean[] = []
        for (let index = 0; index < 20; index++) {
          element.scrollTop = index % 2 ? element.scrollHeight : 0
          await new Promise(requestAnimationFrame)
          const box = dialog.getBoundingClientRect()
          samples.push(dialog.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)))
        }
        return samples
      })
      expect(frames.every(Boolean)).toBe(true)
      await expect(dialog).toBeVisible()
      await harness.expectHittable(harness.closeControl(dialog))
    }
  })
}
