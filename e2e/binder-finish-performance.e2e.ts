import { test, expect, SEEDED_COLLECTION, SUPABASE_URL } from "./fixtures"

test.use({ signedIn: true })

test("phone page turns retain finish glints without creating per-card WebGL contexts", async ({ harness }) => {
  const { page } = harness
  const settings = { binderRows: 4, binderCols: 4, binderSlotGlareEnabled: true, cardFinishEffectsEnabled: true }
  await page.addInitScript(settings => {
    localStorage.setItem("pokemon_binder_settings", JSON.stringify(settings))
    const original = HTMLCanvasElement.prototype.getContext
    const counts = { finishContexts: 0 }
    ;(window as unknown as { __finishRendering: typeof counts }).__finishRendering = counts
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof original>) {
      if (this.hasAttribute("data-card-finish") && String(args[0]).startsWith("webgl")) counts.finishContexts++
      return Reflect.apply(original, this, args)
    } as typeof original
  }, settings)
  await page.route("**/app/api/settings", route => route.fulfill({ json: { settings } }))
  // Synthetic two-page holo collection; production defaults enable the same visual effects.
  const rows = Array.from({ length: 32 }, (_, index) => ({ ...SEEDED_COLLECTION[0], pokemon_id: index + 1, card_id: `synthetic-holo-${index}`, card_finish: "holo", card_image: `https://assets.tcgdex.net/en/mock/holo/${index}/high.webp` }))
  await page.route(`${SUPABASE_URL}/rest/v1/pokemon_collection**`, route => route.fulfill({ json: rows }))
  await page.goto(harness.path)
  for (const target of [1, 2, 1]) {
    if (target === 2) await page.getByRole("button", { name: "Next binder page", exact: true }).click()
    else if (await page.getByRole("spinbutton", { name: "Binder page number" }).inputValue() !== "1") await page.getByRole("button", { name: "Previous binder page", exact: true }).click()
    await expect(page.locator(".card-finish-layer.card-finish-holo")).toHaveCount(16)
    expect(await page.evaluate(() => (window as unknown as { __finishRendering: { finishContexts: number } }).__finishRendering.finishContexts)).toBe(0)
    await harness.expectHittable(page.getByRole("button", { name: "Next binder page", exact: true }))
    await harness.expectNoHorizontalOverflow()
  }
})
