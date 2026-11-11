import { test, expect, type Harness } from "./fixtures"

async function openSearch(harness: Harness) {
  await harness.dock().getByRole("button", { name: "Search", exact: true }).click()
  const dialog = harness.page.getByRole("dialog", { name: /search pokemon/i })
  await expect(dialog).toBeVisible()
  return dialog
}

test.describe("recently viewed cards", () => {

  test("cards opened from search are listed on an empty search, reopen at the printing and can be cleared", async ({ harness }) => {
    const page = harness.page
    let dialog = await openSearch(harness)
    await expect(dialog.getByRole("region", { name: "Recently viewed cards" })).toHaveCount(0)

    await dialog.getByRole("textbox").fill("charm")
    await dialog.getByRole("region", { name: /card results/i }).getByRole("button", { name: /charmander 168\/165 151/i }).click()
    await expect(page.getByRole("dialog", { name: /all charmander cards/i })).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog", { name: /all charmander cards/i })).toBeHidden()

    // Survives a reload: the list lives on the device.
    await page.reload()
    dialog = await openSearch(harness)
    const recent = dialog.getByRole("region", { name: "Recently viewed cards" })
    await expect(recent).toBeVisible()
    const hit = recent.getByRole("button", { name: /charmander 168\/165 151/i })
    await expect(hit).toBeVisible()
    await harness.expectNoHorizontalOverflow()
    await page.screenshot({ path: `/tmp/recent-cards-${page.viewportSize()!.width}.png` })

    // Typing hides the strip so results stay first.
    await dialog.getByRole("textbox").fill("bulba")
    await expect(recent).toHaveCount(0)
    await dialog.getByRole("textbox").fill("")
    await expect(recent).toBeVisible()

    await hit.click()
    const browser = page.getByRole("dialog", { name: /all charmander cards/i })
    await expect(browser).toBeVisible()
    await expect(browser.locator('[data-card-id="sv03.5-168"]')).toBeInViewport()
    await page.keyboard.press("Escape")

    dialog = await openSearch(harness)
    const clear = dialog.getByRole("button", { name: "Clear recently viewed cards" })
    await harness.expectMinTapTarget(clear)
    await clear.click()
    await expect(dialog.getByRole("region", { name: "Recently viewed cards" })).toHaveCount(0)
    expect(await page.evaluate(() => window.localStorage.getItem("binderdex:recent-cards:v1"))).toBeNull()
  })
})
