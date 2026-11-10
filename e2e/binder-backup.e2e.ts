import { readFile } from "node:fs/promises"
import { test, expect, type Harness } from "./fixtures"

async function openBackup(harness: Harness) {
  const { page } = harness
  await page.getByRole("button", { name: "More", exact: true }).click()
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true })
  await dialog.getByRole("button", { name: "Account", exact: true }).click()
  return dialog.getByRole("button", { name: "Download backup", exact: true })
}

// Synthetic harness collections only; all backends are mocked by the fixture.
test("a guest can download the binder on screen and read-only shares hide the backup", async ({ harness }) => {
  const { page } = harness
  const button = await openBackup(harness)
  const downloading = page.waitForEvent("download")
  await button.click()
  const backup = JSON.parse(await readFile((await (await downloading).path())!, "utf8"))
  expect(backup.binder.id).toBeNull()
  expect(backup.collection.map((row: { pokemon_id: number }) => row.pokemon_id).sort((a: number, b: number) => a - b)).toEqual([1, 4])
  await page.goto("/app/e2e-harness?readOnly=1")
  await expect(harness.dock()).toBeVisible()
  await page.getByRole("button", { name: "More", exact: true }).click()
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click()
  expect(await page.getByRole("button", { name: "Download backup", exact: true }).count()).toBe(0)
  expect(await page.getByRole("button", { name: "Account", exact: true }).count()).toBe(0)
})
