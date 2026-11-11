import type { Locator } from "@playwright/test"
import { test, expect, openSettingsPage, SEEDED_COLLECTION, SUPABASE_URL } from "./fixtures"

test.use({ signedIn: true })

async function expectCoverContentsFit(cover: Locator) {
  const clipped = await cover.evaluate(element => {
    const bounds = element.firstElementChild!.getBoundingClientRect()
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    const outside: string[] = []
    while (walker.nextNode()) {
      if (!walker.currentNode.textContent?.trim()) continue
      const range = document.createRange()
      range.selectNodeContents(walker.currentNode)
      for (const rect of range.getClientRects()) {
        if (rect.width && (rect.left < bounds.left || rect.right > bounds.right || rect.top < bounds.top || rect.bottom > bounds.bottom)) outside.push(walker.currentNode.textContent)
      }
    }
    return outside
  })
  expect(clipped).toEqual([])
}

test("inside cover keeps collection progress and value readable on phones", async ({ harness }) => {
  const { page } = harness
  await harness.openViewOptions()
  await page.getByRole("button", { name: "Spread preview" }).click()
  await page.getByRole("button", { name: "Close view options", exact: true }).click()
  const cover = page.getByRole("region", { name: "Inside cover", exact: true })
  await expect(cover).toBeVisible()
  await expect(cover.getByRole("progressbar", { name: "Collection completion" })).toHaveAttribute("aria-valuenow", "0")
  await expect(cover.getByText("2 / 1025", { exact: true })).toBeVisible()
  await expect(cover.getByText("1023", { exact: true })).toBeVisible()
  await expect(cover.getByText("Tracked value", { exact: true })).toBeVisible()
  await harness.expectWithinSafeViewport(cover)
  await harness.expectNoHorizontalOverflow()
  const overflow = await cover.evaluate(element => ({ x: element.scrollWidth - element.clientWidth, y: element.scrollHeight - element.clientHeight }))
  expect(overflow).toEqual({ x: 0, y: 0 })
  await expectCoverContentsFit(cover)
  await page.screenshot({ path: test.info().outputPath("inside-cover-dark.png") })
  await page.getByTestId("app-header").getByRole("button", { name: "More", exact: true }).click()
  await page.getByRole("menuitem", { name: "Light mode", exact: true }).click()
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(247, 246, 251)")
  await expectCoverContentsFit(cover)
  await harness.expectNoHorizontalOverflow()
  await page.screenshot({ path: test.info().outputPath("inside-cover-light.png") })
  await page.getByTestId("app-header").getByRole("button", { name: "More", exact: true }).click()
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click()
  const settings = await openSettingsPage(page.getByRole("dialog", { name: "Settings", exact: true }), "Layout")
  await settings.getByRole("button", { name: "3x4 12 slots", exact: true }).click()
  await harness.closeControl(settings).click()
  await expect(cover.getByText("3 × 4 pockets", { exact: false })).toBeVisible()
  await expect.poll(() => cover.evaluate(element => element.clientHeight / element.clientWidth)).toBeLessThan(1.15)
  await expectCoverContentsFit(cover)
  await page.screenshot({ path: test.info().outputPath("inside-cover-3x4.png") })
})

test("desktop cover shows real progress, price caveats and works offline in light mode", async ({ harness }, testInfo) => {
  test.skip(testInfo.project.name !== "browser-390x844", "One desktop viewport complements the six phone layouts")
  const { page } = harness
  await page.setViewportSize({ width: 1440, height: 1000 })
  // Synthetic collection for layout verification, not real ownership or card pricing.
  await page.route(`${SUPABASE_URL}/rest/v1/pokemon_collection**`, route => route.fulfill({ json: Array.from({ length: 653 }, (_, index) => ({ ...SEEDED_COLLECTION[0], id: `synthetic-${index}`, pokemon_id: index + 1, pokemon_name: `Synthetic ${index + 1}`, card_finish: index < 272 ? "reverse_holo" : "normal" })) }))
  await page.reload()
  const cover = page.getByRole("region", { name: "Inside cover", exact: true })
  await expect(cover.getByRole("heading", { name: "Your collection, beautifully kept." })).toBeVisible()
  await expect(cover.getByRole("progressbar", { name: "Collection completion" })).toHaveAttribute("aria-valuenow", "64")
  await expect(cover.getByText("653 / 1025", { exact: true })).toBeVisible()
  await expect(cover.getByText("372", { exact: true })).toBeVisible()
  await expect(cover.getByText("Tracked value", { exact: true })).toBeVisible()
  await expect(cover.getByText(/272 finish estimates/)).toBeVisible()
  await expectCoverContentsFit(cover)
  await harness.expectWithinSafeViewport(cover)
  await harness.expectNoHorizontalOverflow()
  await page.screenshot({ path: testInfo.outputPath("inside-cover-desktop.png") })
  await page.getByTestId("app-header").getByRole("button", { name: "More", exact: true }).click()
  await page.getByRole("menuitem", { name: "Light mode", exact: true }).click()
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(247, 246, 251)")
  await page.context().setOffline(true)
  await expect(cover.getByText("653 / 1025", { exact: true })).toBeVisible()
  await harness.expectNoHorizontalOverflow()
  await page.screenshot({ path: testInfo.outputPath("inside-cover-desktop-light-offline.png") })
})
