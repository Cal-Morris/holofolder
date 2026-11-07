import { test, expect, SUPABASE_URL, SEEDED_COLLECTION } from "./fixtures"

const MAIN = "e2e00000-0000-4000-8000-000000000001"
const TRADES = "e2e00000-0000-4000-8000-000000000002"

test.describe("Show duplicate protection", () => {
  test.use({ signedIn: true })

  test("names the destination and protects an occupied slot before Bought", async ({ harness }) => {
    const { page } = harness
    const writes: unknown[] = []
    await page.route("**/app/api/collection**", async route => {
      writes.push(route.request().postDataJSON())
      await route.fallback()
    })
    // Synthetic collection: the other binder owns the alternative Bulbasaur printing.
    await page.route(`${SUPABASE_URL}/rest/v1/pokemon_collection**`, route => {
      const other = new URL(route.request().url()).searchParams.get("binder_id")?.startsWith("neq.")
      return route.fulfill({ json: other ? [{ ...SEEDED_COLLECTION[0], binder_id: TRADES, card_id: "sv03.5-001", card_name: "Bulbasaur", card_finish: "normal" }] : SEEDED_COLLECTION.map(row => ({ ...row, binder_id: MAIN })) })
    })
    await page.goto("/app/e2e-harness?signedIn=1&binders=1")
    await page.getByRole("button", { name: "Show mode", exact: true }).click()
    await harness.dock().getByRole("button", { name: "Search", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "Quick mode" })
    await dialog.getByRole("searchbox").fill("bulbasaur")
    await dialog.getByRole("button", { name: /^Bulbasaur, 151 001\/165/ }).click()
    const check = dialog.getByTestId("quick-card-check")
    await expect(check).toContainText("Adds to My binder")
    await expect(check).toContainText("Already owned in Trades")
    const buy = check.getByRole("button", { name: "Bought", exact: true })
    await expect(buy).toBeDisabled()
    expect(writes).toHaveLength(0)
    const confirm = check.getByRole("checkbox", { name: /Replace .* in My binder/ })
    await confirm.check()
    await expect(buy).toBeEnabled()
    await harness.expectMinTapTarget(buy, 48)
    await harness.expectNoHorizontalOverflow()
    await confirm.uncheck()
    await expect(buy).toBeDisabled()
  })
  test("bundle replacement needs acknowledgement and cannot hold two printings for one slot", async ({ harness }) => {
    const { page } = harness
    await page.getByRole("button", { name: "Show mode", exact: true }).click()
    await harness.dock().getByRole("button", { name: "Search", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "Quick mode" })
    const search = dialog.getByRole("searchbox")
    await search.fill("bulbasaur")
    await dialog.getByRole("button", { name: /^Bulbasaur, 151 001\/165/ }).click()
    const check = dialog.getByTestId("quick-card-check")
    await check.getByRole("button", { name: "Add to bundle" }).click()
    await check.getByRole("button", { name: "Back to results" }).click()
    await dialog.getByRole("button", { name: /^Bundle · 1 card/ }).click()
    const bundle = dialog.getByTestId("quick-bundle")
    const buy = bundle.getByRole("button", { name: "Bought bundle" })
    await expect(buy).toBeDisabled()
    await bundle.getByRole("checkbox", { name: /Replace .* in this binder/ }).check()
    await expect(buy).toBeEnabled()
    await bundle.getByRole("button", { name: "Back to results" }).click()
    await search.fill("bulbasaur")
    await dialog.getByRole("button", { name: /^Bulbasaur, 151 166\/165/ }).click()
    await check.getByRole("button", { name: "Add to bundle" }).click()
    await check.getByRole("button", { name: "Back to results" }).click()
    await dialog.getByRole("button", { name: /^Bundle · 2 cards/ }).click()
    await expect(bundle).toContainText("Only one printing per Pokémon fits")
    await expect(buy).toBeDisabled()
    await harness.expectNoHorizontalOverflow()
  })

})
