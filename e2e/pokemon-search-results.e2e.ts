import { test, expect, mockBackends, emulateStandalone, storageAction, closeStorage, Harness } from "./fixtures"
import type { Page } from "@playwright/test"
import { POKEMON_CATALOG, formatPokemonDisplayName } from "../lib/pokemon-catalog"

// Real BinderApp host on the native storage fixture (#572 leaves the old signed-in generic harness unusable).
const entry = "/app/e2e-harness?signedIn=1&browserHost=1&binder=22222222-2222-4222-8222-222222222222"
const shots = process.env.SEARCH_SHOTS
const last = POKEMON_CATALOG[POKEMON_CATALOG.length - 1]

test.beforeEach(async ({ page, context, standalone, insets, baseURL }) => {
  if (standalone) await emulateStandalone(page, insets)
  await mockBackends(page, context, { signedIn: true, baseURL })
  await context.addCookies([{ name: "hf-storage-fixture", value: `native-search-${crypto.randomUUID()}`, url: baseURL! }])
})

async function openSearch(page: Page) {
  await page.goto(entry)
  await expect(await storageAction(page, "Backup")).toBeVisible(); await closeStorage(page)
  // Phones use the dock; desktop has the header's binder navigation.
  await page.getByRole("navigation", { name: /^(Main|Binder) navigation$/ }).getByRole("button", { name: "Search", exact: true }).first().click()
  const dialog = page.getByRole("dialog", { name: "Search Pokemon" })
  const rows = dialog.locator("[data-result-index]")
  await expect(rows.first()).toBeVisible()
  return { dialog, rows, list: rows.first().locator("xpath=..") }
}

/** Scrolls the result list to its end until nothing more loads (the sentinel mounts the next rows). */
async function scrollToEnd(page: Page, list: ReturnType<Page["locator"]>, more: ReturnType<Page["locator"]>) {
  for (let i = 0; i < 40 && await more.count(); i++) {
    await list.evaluate((el) => { el.scrollTop = el.scrollHeight })
    await page.waitForTimeout(50)
  }
  await expect(more).toHaveCount(0)
  await list.evaluate((el) => { el.scrollTop = el.scrollHeight })
}

test("empty-query All list scrolls past #60 to the last Pokémon, a bounded chunk at a time", async ({ page, insets }, info) => {
  const { dialog, rows, list } = await openSearch(page)
  const more = dialog.getByRole("button", { name: /^Show more Pokémon/ })
  await expect(rows).toHaveCount(60)
  await expect(more).toHaveText(`Show more Pokémon (${POKEMON_CATALOG.length - 60} more)`)

  await list.evaluate((el) => { el.scrollTop = el.scrollHeight })
  await expect(rows.nth(60)).toContainText("Poliwhirl")
  await expect(rows.nth(60)).toContainText("#61")
  await expect.poll(() => rows.count()).toBeLessThanOrEqual(180)
  if (shots) await page.screenshot({ path: `${shots}/after-60-${info.project.name}.png` })

  await scrollToEnd(page, list, more)
  await expect(rows).toHaveCount(POKEMON_CATALOG.length)
  await expect(rows.last()).toContainText(formatPokemonDisplayName(last.name))
  await expect(rows.last()).toContainText(`#${last.id}`)
  await expect(rows.last()).toBeInViewport()
  const h = new Harness(page, insets, true)
  await h.expectNoHorizontalOverflow()
  await h.expectMinTapTarget(rows.last().getByRole("button", { name: `All ${formatPokemonDisplayName(last.name)} cards` }))
  if (shots) await page.screenshot({ path: `${shots}/final-${info.project.name}.png` })
})

test("query and filter changes start the list over and every match stays reachable", async ({ page, insets }, info) => {
  const { dialog, rows, list } = await openSearch(page)
  const input = dialog.getByRole("textbox")
  const more = dialog.getByRole("button", { name: /^Show more Pokémon/ })
  await list.evaluate((el) => { el.scrollTop = el.scrollHeight })
  await expect.poll(() => rows.count()).toBeGreaterThan(60)

  // A broad query: 40 rows first, the rest behind "Show more" (card/set hits stay just below).
  await input.fill("an")
  await expect(rows).toHaveCount(40)
  await expect(more).toBeVisible()
  const total = 40 + Number(/\((\d+) more\)/.exec(await more.innerText())![1])
  await more.click()
  await expect(rows).toHaveCount(Math.min(80, total))
  if (shots) await page.screenshot({ path: `${shots}/query-more-${info.project.name}.png` })
  while (await more.count()) await more.click()
  await expect(rows).toHaveCount(total)

  // Narrowing the query resets to the first chunk; an exact late match is found.
  await input.fill(last.name)
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText(`#${last.id}`)

  // Filter change: back to the first chunk of that filter, and its end is reachable.
  await input.fill("")
  await dialog.getByRole("button", { name: /^Missing/ }).click()
  await expect(dialog.getByRole("button", { name: /^Missing/ })).toHaveAttribute("aria-pressed", "true")
  const missing = Number((await dialog.getByRole("button", { name: /^Missing/ }).innerText()).replace(/\D/g, ""))
  await expect(rows).toHaveCount(Math.min(60, missing))
  await scrollToEnd(page, list, more)
  await expect(rows).toHaveCount(missing)
  await new Harness(page, insets, true).expectNoHorizontalOverflow()
})

test("arrow keys move past the first 60 rows, keep the active row in view, and Enter selects it", async ({ page }, info) => {
  const { dialog, rows } = await openSearch(page)
  const input = dialog.getByRole("textbox")
  await input.focus()
  for (let i = 0; i < 61; i++) await input.press("ArrowDown")
  const active = rows.nth(60)
  await expect(active).toContainText("Poliwhirl")
  await expect(active).toHaveClass(/bg-primary\/20/)
  await expect(active).toBeInViewport()
  await expect(active.getByRole("button", { name: "Go to page 16" })).toBeVisible()
  await expect(dialog.locator("[data-result-index].bg-primary\\/20")).toHaveCount(1)
  if (shots) await page.screenshot({ path: `${shots}/keyboard-${info.project.name}.png` })
  await input.press("ArrowUp")
  await expect(rows.nth(59)).toHaveClass(/bg-primary\/20/)
  await input.press("ArrowDown")
  await input.press("Enter")
  await expect(dialog).toBeHidden()
  // Selection lands on the row's own page (#61 at four pockets a page), as its "Page 16" label says.
  await expect(page.getByRole("spinbutton", { name: "Binder page number" })).toHaveValue("16")
  if (shots) await page.screenshot({ path: `${shots}/selected-${info.project.name}.png` })
})

test("desktop search reaches the final Pokémon without overflow", async ({ page, insets }, info) => {
  test.skip(info.project.name !== "browser-390x844", "One desktop check")
  await page.setViewportSize({ width: 1440, height: 1000 })
  const { dialog, rows, list } = await openSearch(page)
  await scrollToEnd(page, list, dialog.getByRole("button", { name: /^Show more Pokémon/ }))
  await expect(rows.last()).toContainText(`#${last.id}`)
  await expect(rows.last()).toBeInViewport()
  await new Harness(page, insets, true).expectNoHorizontalOverflow()
  if (shots) await page.screenshot({ path: `${shots}/desktop-final.png` })
})
