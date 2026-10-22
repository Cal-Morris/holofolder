import { expect, test } from "./fixtures"

test.describe("camera scanner", () => {
  test.use({ signedIn: true })

  test("opens from a slot, reports a missing camera and closes", async ({ harness }) => {
    const { page } = harness
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: { getUserMedia: () => Promise.reject(new Error("No camera in this test.")) },
      })
    })
    await harness.open()

    await page.locator('button[data-dex-id="1"]').first().click()
    const detail = page.getByRole("dialog", { name: /bulbasaur details/i })
    await expect(detail).toBeVisible()
    await detail.locator("summary").filter({ hasText: "Collection options" }).click()
    await detail.getByRole("button", { name: "Scan card", exact: true }).click()

    const scanner = page.getByRole("dialog", { name: "Page scanner" })
    await expect(scanner).toBeVisible()
    await expect(scanner.getByText("Slot Sweep")).toBeVisible()
    await expect(scanner.getByText("No camera in this test.")).toBeVisible()

    await scanner.getByRole("button", { name: "Close page scanner" }).click()
    await expect(scanner).toHaveCount(0)
    await harness.expectScrollUnlocked()
  })
})
