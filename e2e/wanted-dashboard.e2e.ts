import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures"
import { FakeCollectionServer } from "./collection-server"

const SQUIRTLE = 7

/** Want Squirtle's 151 printing through the detail sheet and the card selector. */
async function wantSquirtle(page: Page, server: FakeCollectionServer) {
  await page.locator(`button[data-dex-id="${SQUIRTLE}"]`).first().click()
  const detail = page.getByRole("dialog", { name: /squirtle details/i })
  await detail.getByRole("button", { name: /^(want card|add wanted|track wanted)$/i }).click()
  const selector = page.getByRole("dialog", { name: /card selector/i })
  await selector.getByRole("button", { name: "Want card Squirtle from 151", exact: true }).click()
  await expect(selector).toHaveCount(0)
  await expect.poll(() => server.rows.get(SQUIRTLE)?.status).toBe("wishlisted")
}

test.describe("want-list dashboard", () => {
  test.use({ signedIn: true })

  test("lists wanted cards and jumps back to the binder page", async ({ harness }) => {
    const { page } = harness
    const server = new FakeCollectionServer()
    await server.install(page)

    await harness.dock().getByRole("button", { name: "Wanted", exact: true }).click()
    await expect(page.getByText("No wanted cards yet")).toBeVisible()

    await harness.dock().getByRole("button", { name: "Binder", exact: true }).click()
    await wantSquirtle(page, server)

    await harness.dock().getByRole("button", { name: "Wanted", exact: true }).click()
    await expect(page.getByRole("heading", { name: "Buying dashboard" })).toBeVisible()
    await expect(page.getByRole("heading", { name: /^1 cards, sorted for buying$/ })).toBeVisible()
    const main = page.getByTestId("main-content")
    await expect(main.getByRole("button", { name: "Share list" })).toBeVisible()

    await main.getByRole("button", { name: "Page", exact: true }).click()
    await expect(page.getByRole("dialog", { name: /squirtle details/i })).toBeVisible()
  })
})
