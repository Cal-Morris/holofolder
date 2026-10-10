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

  test("account changes hide cached artwork until the new partner owner resolves", async ({ harness }) => {
    const { page } = harness
    const partner = { ...E2E_USER, id: "00000000-0000-4000-8000-0000000000b2", email: "partner@binderdex.test" }
    const partnerOwner = "00000000-0000-4000-8000-0000000000c2"
    const original = { ...defaultBinderDesign(), name: "Previous account archive" }
    const shared = { ...defaultBinderDesign(), name: "New partner archive" }
    const requestedOwners: string[] = []
    await page.route("**/api/binder-appearance", route => {
      const owner = route.request().headers()["x-binder-owner"]
      requestedOwners.push(owner)
      return route.fulfill({ json: { ownerId: owner, design: owner === partnerOwner ? shared : original, revision: 1 } })
    })
    await page.reload()
    await page.getByRole("button", { name: "3D", exact: true }).click()
    const preview = page.getByRole("region", { name: "Your 3D National Dex binder" })
    await expect(preview).toHaveAttribute("data-binder-name", original.name)

    let releaseOwner!: () => void
    const ownerReleased = new Promise<void>(resolve => { releaseOwner = resolve })
    let ownerLookupStarted = false
    let collectionLoaded = false
    await page.route(`${SUPABASE_URL}/rest/v1/partnerships**`, async route => {
      if (!route.request().url().includes(partner.id)) return route.fulfill({ json: [] })
      ownerLookupStarted = true
      await ownerReleased
      return route.fulfill({ json: { owner_user_id: partnerOwner } })
    })
    await page.route(`${SUPABASE_URL}/rest/v1/pokemon_collection**`, route => {
      if (new URL(route.request().url()).searchParams.get("user_id") === `eq.${partnerOwner}`) collectionLoaded = true
      return route.fulfill({ json: SEEDED_COLLECTION.map(item => ({ ...item, user_id: partnerOwner, card_image: `https://assets.tcgdex.net/en/base/base1/${item.pokemon_id === 1 ? "44" : "46"}/high.webp` })) })
    })
    await page.route(`${SUPABASE_URL}/auth/v1/user**`, route => route.fulfill({ json: partner }))
    const storageKey = `sb-${new URL(SUPABASE_URL).hostname.split(".")[0]}-auth-token`
    await page.evaluate(({ storageKey, partner }) => {
      const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
      const expiresAt = Math.floor(Date.now() / 1000) + 3600
      const session = {
        access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: partner.id, aud: "authenticated", role: "authenticated", exp: expiresAt, email: partner.email })}.synthetic`,
        token_type: "bearer", expires_in: 3600, expires_at: expiresAt, refresh_token: "synthetic-partner-refresh", user: partner,
      }
      document.cookie = `${storageKey}=base64-${encode(session)}; path=/; SameSite=Lax`
      const channel = new BroadcastChannel(storageKey)
      channel.postMessage({ event: "SIGNED_IN", session })
      channel.close()
    }, { storageKey, partner })
    try {
      await expect.poll(() => ownerLookupStarted).toBe(true)
      await expect(preview).not.toHaveAttribute("data-binder-name", original.name)
      await expect(preview.getByRole("list", { name: "Cards on this spread" }).getByRole("listitem")).toHaveCount(0)
      requestedOwners.length = 0
    } finally { releaseOwner() }
    await expect(preview).toHaveAttribute("data-binder-name", shared.name)
    await expect.poll(() => collectionLoaded).toBe(true)
    await expect(preview.getByTestId("binder-3d-stage")).toHaveAttribute("data-right-cards", "2")
    expect(requestedOwners).toContain(partnerOwner)
    expect(requestedOwners).not.toContain(E2E_USER.id)
    expect(requestedOwners).not.toContain(partner.id)
  })
})
