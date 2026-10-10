import { test, expect, E2E_USER, SEEDED_COLLECTION, SUPABASE_URL } from "./fixtures"
import { defaultBinderDesign } from "../lib/binder-design"

test.describe("Dashboard binder appearance", () => {
  test.use({ signedIn: true })

  test("loads cloud appearance on reload and shows real National Dex slots in 3D", async ({ harness }) => {
    const { page } = harness
    // Synthetic cloud appearance, deliberately different from the settings defaults.
    const design = defaultBinderDesign()
    design.name = "Cal's archive"
    design.pageColor = "#aa2244"
    design.surfaces.cover.words = "My collection"
    await page.route("**/api/binder-appearance", route => route.fulfill({ json: { ownerId: E2E_USER.id, design, revision: 1 } }))
    // Synthetic printing artwork supplied by the existing image-proxy fixture.
    await page.route(`${SUPABASE_URL}/rest/v1/pokemon_collection**`, route => route.fulfill({ json: SEEDED_COLLECTION.map(item => ({ ...item, card_image: `https://assets.tcgdex.net/en/base/base1/${item.pokemon_id === 1 ? "44" : "46"}/high.webp` })) }))
    await page.goto("/e2e-harness?signedIn=1&cardArtwork=1")
    const display = page.getByRole("group", { name: "Binder display" })
    await expect(display.getByRole("button", { name: "2D", exact: true })).toHaveAttribute("aria-pressed", "true")
    await expect(page.locator('[data-binder-page="1"] > div').first()).toHaveCSS("background-image", /rgb\(170, 34, 68\)/)
    await harness.expectMinTapTarget(display.getByRole("button", { name: "3D", exact: true }))
    await display.getByRole("button", { name: "3D", exact: true }).click()
    const preview = page.getByRole("region", { name: "Your 3D National Dex binder" })
    await expect(preview).toHaveAttribute("data-binder-name", "Cal's archive")
    await expect(preview.getByText("National Dex / 2 cards placed", { exact: true })).toBeVisible()
    await expect(preview.getByRole("list", { name: "Cards on this spread" }).getByRole("listitem")).toHaveText(["Bulbasaur, slot 1", "Charmander, slot 4"])
    await expect(preview.getByRole("link", { name: "Customize in Studio" })).toHaveAttribute("href", "/studio")
    await expect(preview.getByTestId("binder-3d-stage")).toHaveAttribute("data-right-cards", "2")
    const next = preview.getByRole("button", { name: "Next 3D binder spread" })
    await harness.expectMinTapTarget(next)
    await next.scrollIntoViewIfNeeded()
    await harness.expectHittable(next)
    await harness.expectWithinSafeViewport(next)
    await next.click()
    await expect(preview.getByText("No placed cards on this spread", { exact: true })).toBeVisible()
    await harness.expectNoHorizontalOverflow()
    await expect(harness.dock()).toBeVisible()
    await display.getByRole("button", { name: "2D", exact: true }).click()
    await expect(page.locator('button[data-dex-id="1"]').first()).toBeVisible()
    await page.reload()
    await display.getByRole("button", { name: "3D", exact: true }).click()
    await expect(preview).toHaveAttribute("data-binder-name", "Cal's archive")
    await expect(preview.getByRole("list", { name: "Cards on this spread" }).getByRole("listitem")).toHaveText(["Bulbasaur, slot 1", "Charmander, slot 4"])
  })

  test("3D failure keeps collection editing accessible in 2D", async ({ harness }) => {
    const { page } = harness
    await page.route("**/api/binder-appearance", route => route.fulfill({ json: { ownerId: E2E_USER.id, design: null, revision: 0 } }))
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext
      Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { configurable: true, value: function(this: HTMLCanvasElement, context: string, ...args: unknown[]) {
        return context.includes("webgl") ? null : Reflect.apply(original, this, [context, ...args])
      } })
    })
    await page.reload()
    await page.getByRole("button", { name: "3D", exact: true }).click()
    await expect(page.getByRole("status").filter({ hasText: "3D preview unavailable" })).toBeVisible()
    await page.getByRole("button", { name: "2D", exact: true }).click()
    await expect(page.locator('button[data-dex-id="1"]').first()).toBeVisible()
    await harness.expectNoHorizontalOverflow()
  })
})
