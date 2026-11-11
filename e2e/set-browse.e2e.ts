import { test, expect, placeholderSvg } from "./fixtures"

// Synthetic sets, not real TCG data: one with a logo, one with only a symbol, one with neither.
const SETS = [
  { id: "fx-new", name: "Fixture Storm", seriesName: "Fixture Era", officialCardCount: 120, releaseDate: "2026-05-01", logo: "https://assets.tcgdex.net/en/fx/fx-new/logo.png" },
  { id: "fx-mid", name: "Fixture Dawn", seriesName: "Fixture Era", officialCardCount: 80, releaseDate: "2026-01-01", symbol: "https://images.pokemontcg.io/fx-mid/symbol.png" },
  { id: "fx-old", name: "Fixture Classic", seriesName: "Fixture Origins", officialCardCount: 60, releaseDate: "2001-01-01" },
]

test.describe("Sets browse", () => {
  test("browses sets by series with artwork, searches, and opens a set", async ({ harness }) => {
    const { page } = harness
    const opened: string[] = []
    const images: string[] = []
    await page.route("**/app/api/card-image-proxy**", route => {
      images.push(new URL(route.request().url()).searchParams.get("url") ?? "")
      return route.fulfill({ contentType: "image/svg+xml", body: placeholderSvg("set", images.length) })
    })
    await page.route("**/app/api/tcg-set-slots**", route => {
      const params = new URL(route.request().url()).searchParams
      const set = SETS.find(entry => entry.id === params.get("setId"))
      if (set) opened.push(set.id)
      return route.fulfill({ json: set ? { sets: [set], selectedSet: set, slots: [] } : { sets: params.get("all") === "1" ? SETS : [], selectedSet: null, slots: [] } })
    })
    await harness.dock().getByRole("button", { name: "Browse", exact: true }).click()

    const series = page.getByRole("group", { name: "Filter sets by series" })
    await expect(series.getByRole("button")).toHaveText([/All series\s*3/, /Fixture Era\s*2/, /Fixture Origins\s*1/])
    await expect(page.getByRole("region", { name: "Fixture Era sets" }).getByRole("button")).toHaveText([/Fixture Storm/, /Fixture Dawn/])
    // Logo, then symbol, then a monogram; artwork only ever loads through the image proxy.
    await expect.poll(() => images.filter(url => url.includes("/fx-")).sort()).toEqual([SETS[0].logo, SETS[1].symbol].sort())
    await expect(page.getByRole("button", { name: "Fixture Classic", exact: true })).toContainText("FC")
    expect(await page.locator("details").count(), "no native disclosure triangles").toBe(0)
    await expect(page.getByText("Offline set tools")).toHaveCount(0)
    await harness.expectMinTapTarget(series.getByRole("button", { name: /Fixture Origins/ }))
    await harness.expectNoHorizontalOverflow()

    await series.getByRole("button", { name: /Fixture Origins/ }).click()
    await expect(page.getByRole("region", { name: "Fixture Era sets" })).toHaveCount(0)
    await series.getByRole("button", { name: /All series/ }).click()
    await page.getByRole("textbox", { name: "Search sets by name or code" }).fill("dawn")
    await expect(page.getByRole("region", { name: /sets$/ }).getByRole("button")).toHaveText([/Fixture Dawn/])
    await page.getByRole("button", { name: "Fixture Dawn", exact: true }).click()
    await expect(page.getByRole("button", { name: "Remove Fixture Dawn", exact: true })).toBeVisible()
    expect(opened).toEqual(["fx-mid"])
    await expect(series).toHaveCount(0)
    await harness.expectHittable(harness.dock().getByRole("button", { name: "Binder", exact: true }))
  })

  test("offline set tools live in Settings → Display", async ({ harness }) => {
    const { page } = harness
    await page.route("**/app/api/tcg-set-slots**", route => route.fulfill({ json: { sets: SETS, selectedSet: null, slots: [] } }))
    await page.locator("nav").first().getByRole("button", { name: "More", exact: true }).click()
    await page.getByRole("menuitem", { name: "Settings", exact: true }).click()
    const settings = page.getByRole("dialog", { name: /settings/i })
    await settings.getByRole("button", { name: "Display", exact: true }).click()
    const offline = settings.getByRole("region", { name: "Offline sets" })
    await offline.getByRole("searchbox", { name: "Find sets to save" }).fill("fixture")
    await offline.getByRole("button", { name: "Find", exact: true }).click()
    await expect(offline.getByRole("checkbox", { name: /Fixture Dawn/ })).toBeVisible()
    await expect(offline.getByRole("button", { name: "Check download size" })).toBeVisible()
    await harness.expectNoHorizontalOverflow()
  })

  test("the whole Pokémon row opens that species' cards", async ({ harness }) => {
    const { page } = harness
    await harness.dock().getByRole("button", { name: "Browse", exact: true }).click()
    await page.getByRole("group", { name: "Browse perspective" }).getByRole("button", { name: "Pokémon", exact: true }).click()
    await page.getByRole("searchbox", { name: "Search Pokémon by name or dex number" }).fill("#0001")
    const row = page.getByRole("list", { name: "Pokémon catalogue" }).getByRole("listitem")
    await expect(row.getByRole("button")).toHaveCount(1)
    await row.getByText("#0001").click()
    await expect(page.getByRole("dialog", { name: "All Bulbasaur cards", exact: true })).toBeVisible()
  })
})
