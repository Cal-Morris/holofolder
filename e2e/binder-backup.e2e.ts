import { readFile } from "node:fs/promises"
import { test, expect, SEEDED_COLLECTION, SUPABASE_URL, type Harness } from "./fixtures"
import { setNetwork } from "./collection-server"

async function openBackup(harness: Harness) {
  const { page } = harness
  await page.getByRole("button", { name: "More", exact: true }).click()
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true })
  await dialog.getByRole("button", { name: "Account", exact: true }).click()
  return dialog.getByRole("button", { name: "Download backup", exact: true })
}

// Synthetic harness collections only; all backends are mocked by the fixture.
test.describe("signed-in backup", () => {
  test.use({ signedIn: true })

test("downloads the current binder's queued offline edit without changing the queue", async ({ harness }) => {
  const { page } = harness
  const trades = "e2e00000-0000-4000-8000-000000000002"
  await page.route(`${SUPABASE_URL}/rest/v1/pokemon_collection**`, route => route.fulfill({ json: SEEDED_COLLECTION.filter(row => row.pokemon_id === 4) }))
  await page.goto(`/e2e-harness?signedIn=1&binders=1&binder=${trades}`)
  await expect(harness.dock()).toBeVisible()
  const button = await openBackup(harness)
  await expect(button).toBeEnabled()
  await harness.expectMinTapTarget(button)
  await harness.expectNoHorizontalOverflow()
  await page.keyboard.press("Escape")
  await setNetwork(page, true)
  await page.locator('button[data-dex-id="4"]').first().click()
  const detail = page.getByRole("dialog", { name: /details$/i })
  await detail.locator("summary").filter({ hasText: "Card & variant" }).click()
  await detail.getByRole("button", { name: "Holo", exact: true }).click()
  await expect(detail.getByRole("button", { name: "Holo", exact: true })).toHaveAttribute("aria-pressed", "true")
  await page.keyboard.press("Escape")
  const queue = await page.evaluate(() => localStorage.getItem("pokemon_collection_pending_ops_v1"))
  expect(queue).toContain("holo")
  const downloadButton = await openBackup(harness)
  const downloading = page.waitForEvent("download")
  await downloadButton.click()
  const download = await downloading
  expect(download.suggestedFilename()).toMatch(/^binderdex-trades-.*\.json$/)
  const backup = JSON.parse(await readFile((await download.path())!, "utf8"))
  expect(backup.format).toBe("binderdex-binder-backup")
  expect(backup.version).toBe(1)
  expect(backup.binder).toMatchObject({ id: trades, name: "Trades" })
  expect(backup.collection).toHaveLength(1)
  expect(backup.collection[0]).toMatchObject({ pokemon_id: 4, card_finish: "holo" })
  expect(JSON.stringify(backup)).not.toMatch(/access_token|refresh_token|user_id|ownerUserId/)
  expect(await page.evaluate(() => localStorage.getItem("pokemon_collection_pending_ops_v1"))).toBe(queue)
})

})

test("empty local binder can download and read-only shares hide the backup", async ({ harness }) => {
  const { page } = harness
  const button = await openBackup(harness)
  const downloading = page.waitForEvent("download")
  await button.click()
  const backup = JSON.parse(await readFile((await (await downloading).path())!, "utf8"))
  expect(backup.binder.id).toBeNull()
  expect(backup.collection).toEqual([])
  await page.goto("/e2e-harness?readOnly=1")
  await expect(harness.dock()).toBeVisible()
  await page.getByRole("button", { name: "More", exact: true }).click()
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click()
  expect(await page.getByRole("button", { name: "Download backup", exact: true }).count()).toBe(0)
  expect(await page.getByRole("button", { name: "Account", exact: true }).count()).toBe(0)
})
