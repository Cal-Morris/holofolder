import type { Page } from "@playwright/test"
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
    await harness.openViewOptions()
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
    await harness.openViewOptions()
    await display.getByRole("button", { name: "2D", exact: true }).click()
    await page.getByRole("button", { name: "Close view options", exact: true }).click()
    await expect(page.locator('button[data-dex-id="17"]').first()).toBeVisible()
    await page.reload()
    await harness.openViewOptions()
    await display.getByRole("button", { name: "3D", exact: true }).click()
    await expect(preview).toHaveAttribute("data-binder-name", "Cal's archive")
    await expect(preview.getByTestId("binder-3d-stage")).toHaveAttribute("data-current-page", "2")
    await expect(preview.getByText("No placed cards on this spread", { exact: true })).toBeVisible()
  })

  test("2D and 3D share navigation, layout and the saved page", async ({ harness }) => {
    const { page } = harness
    // Synthetic Studio layout differs from the active binder's 4x4 grid.
    const design = { ...defaultBinderDesign(), rows: 3, cols: 3, pageCount: 200 }
    await page.route("**/api/binder-appearance", route => route.fulfill({ json: { ownerId: E2E_USER.id, design, revision: 1 } }))
    await page.goto("/e2e-harness?signedIn=1&cardArtwork=1")
    const pageNumber = page.getByRole("spinbutton", { name: "Binder page number", exact: true }).filter({ visible: true })
    await pageNumber.fill("3")
    await pageNumber.press("Enter")
    await expect(page).toHaveURL(/page=3/)
    await harness.openViewOptions()
    await page.getByRole("button", { name: "3D", exact: true }).click()
    const preview = page.getByRole("region", { name: "Your 3D National Dex binder" })
    const stage = preview.getByTestId("binder-3d-stage")
    await expect(stage).toHaveAttribute("data-current-page", "3")
    await expect(stage).toHaveAttribute("data-current-spread", "2-3")
    await expect(preview.getByText("65 pages", { exact: true })).toBeVisible()
    await preview.getByRole("button", { name: "Next 3D binder spread" }).click()
    await expect(stage).toHaveAttribute("data-current-page", "4")
    await expect(page).toHaveURL(/page=4/)
    await harness.openViewOptions()
    await page.getByRole("button", { name: "2D", exact: true }).click()
    await page.getByRole("button", { name: "Close view options", exact: true }).click()
    await expect(pageNumber).toHaveValue("4")
    await expect(page.locator('button[data-dex-id="49"]').first()).toBeVisible()
    await page.reload()
    await expect(pageNumber).toHaveValue("4")
    await pageNumber.fill("65")
    await pageNumber.press("Enter")
    await expect(page).toHaveURL(/page=65/)
    await harness.openViewOptions()
    await page.getByRole("button", { name: "3D", exact: true }).click()
    await expect(stage).toHaveAttribute("data-current-spread", "64-65")
    await expect(preview.getByRole("button", { name: "Next 3D binder spread" })).toBeDisabled()
    await preview.getByRole("button", { name: "Previous 3D binder spread" }).click()
    await expect(stage).toHaveAttribute("data-current-page", "62")
    await harness.openViewOptions()
    await page.getByRole("button", { name: "2D", exact: true }).click()
    await page.getByRole("button", { name: "Close view options", exact: true }).click()
    await expect(pageNumber).toHaveValue("62")
    await harness.expectNoHorizontalOverflow()
  })

  test("explicit 3D navigation survives switching back with a generation filter", async ({ harness }) => {
    const { page } = harness
    await harness.openViewOptions()
    const controls = page.getByRole("dialog", { name: "View options", exact: true })
    await controls.getByRole("combobox").selectOption("2")
    await controls.getByRole("button", { name: "Close view options", exact: true }).click()
    await expect(page.getByRole("spinbutton", { name: "Binder page number", exact: true }).filter({ visible: true })).toHaveValue("10")
    await harness.openViewOptions()
    await page.getByRole("button", { name: "3D", exact: true }).click()
    const preview = page.getByRole("region", { name: "Your 3D National Dex binder" })
    await expect(preview.getByTestId("binder-3d-stage")).toHaveAttribute("data-current-page", "10")
    await preview.getByRole("button", { name: "Previous 3D binder spread" }).click()
    await expect(preview.getByTestId("binder-3d-stage")).toHaveAttribute("data-current-page", "8")
    await harness.openViewOptions()
    await page.getByRole("button", { name: "2D", exact: true }).click()
    await page.getByRole("button", { name: "Close view options", exact: true }).click()
    await expect(page.getByRole("spinbutton", { name: "Binder page number", exact: true }).filter({ visible: true })).toHaveValue("8")
    await expect(page).toHaveURL(/page=8/)
  })

  test("collection refresh keeps the shared page with a status filter", async ({ harness }) => {
    const { page } = harness
    await harness.openViewOptions()
    await page.getByRole("dialog", { name: "View options", exact: true }).getByRole("button", { name: "Upgrades", exact: true }).click()
    await harness.openViewOptions()
    await page.getByRole("button", { name: "3D", exact: true }).click()
    const preview = page.getByRole("region", { name: "Your 3D National Dex binder" })
    await expect(preview.getByTestId("binder-3d-stage")).toHaveAttribute("data-current-page", "1")
    await preview.getByRole("button", { name: "Next 3D binder spread" }).click()
    await expect(preview.getByTestId("binder-3d-stage")).toHaveAttribute("data-current-page", "2")
    const refreshed = page.waitForResponse(response => response.url().includes("/rest/v1/pokemon_collection"))
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")))
    await refreshed
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    await expect(preview.getByTestId("binder-3d-stage")).toHaveAttribute("data-current-page", "2")
    await harness.openViewOptions()
    await page.getByRole("button", { name: "2D", exact: true }).click()
    await page.getByRole("button", { name: "Close view options", exact: true }).click()
    await expect(page.getByRole("spinbutton", { name: "Binder page number", exact: true }).filter({ visible: true })).toHaveValue("2")
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
    await harness.openViewOptions()
    await page.getByRole("button", { name: "3D", exact: true }).click()
    await expect(page.getByRole("status").filter({ hasText: "3D preview unavailable" })).toBeVisible()
    await harness.openViewOptions()
    await page.getByRole("button", { name: "2D", exact: true }).click()
    await page.getByRole("button", { name: "Close view options", exact: true }).click()
    await expect(page.locator('button[data-dex-id="1"]').first()).toBeVisible()
    await harness.expectNoHorizontalOverflow()
  })

  test("account changes hide cached artwork until the new partner owner resolves", async ({ harness }) => {
    const { page } = harness
    const partner = { ...E2E_USER, id: "00000000-0000-4000-8000-0000000000b2", email: "partner@holofolder.test" }
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
    await harness.openViewOptions()
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
    await switchAccount(page, partner)
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

  test("a collection refresh in flight during an account change never shows the previous account's cards", async ({ harness }) => {
    const { page } = harness
    const partner = { ...E2E_USER, id: "00000000-0000-4000-8000-0000000000b3", email: "partner2@holofolder.test" }
    const partnerOwner = "00000000-0000-4000-8000-0000000000c3"
    await page.route("**/api/binder-appearance", route => route.fulfill({ json: { ownerId: route.request().headers()["x-binder-owner"], design: defaultBinderDesign(), revision: 1 } }))
    await page.reload()
    await harness.openViewOptions()
    await page.getByRole("button", { name: "3D", exact: true }).click()
    const preview = page.getByRole("region", { name: "Your 3D National Dex binder" })
    const spread = preview.getByRole("list", { name: "Cards on this spread" }).getByRole("listitem")
    await expect(spread).toHaveCount(2)

    // Hold the next refresh of the signed-in account's collection (the periodic tick) until after the switch.
    let releaseRefresh!: () => void
    const refreshReleased = new Promise<void>(resolve => { releaseRefresh = resolve })
    let refreshHeld = false
    await page.route(`${SUPABASE_URL}/rest/v1/pokemon_collection**`, async route => {
      const owner = new URL(route.request().url()).searchParams.get("user_id")
      if (owner === `eq.${E2E_USER.id}`) {
        refreshHeld = true
        await refreshReleased
        return route.fulfill({ json: SEEDED_COLLECTION })
      }
      return route.fulfill({ json: [] })
    })
    await expect.poll(() => refreshHeld, { timeout: 15_000 }).toBe(true)

    let releaseOwner!: () => void
    const ownerReleased = new Promise<void>(resolve => { releaseOwner = resolve })
    let ownerLookupStarted = false
    await page.route(`${SUPABASE_URL}/rest/v1/partnerships**`, async route => {
      if (!route.request().url().includes(partner.id)) return route.fulfill({ json: [] })
      ownerLookupStarted = true
      await ownerReleased
      return route.fulfill({ json: [{ owner_user_id: partnerOwner }] })
    })
    await page.route(`${SUPABASE_URL}/auth/v1/user**`, route => route.fulfill({ json: partner }))
    await switchAccount(page, partner)
    try {
      await expect.poll(() => ownerLookupStarted).toBe(true)
      await expect(spread).toHaveCount(0)
      // The old refresh now answers with the previous account's cards; they must not appear.
      releaseRefresh()
      await page.evaluate(() => new Promise<void>(resolve => setTimeout(() => requestAnimationFrame(() => resolve()), 500)))
      await expect(spread).toHaveCount(0)
    } finally { releaseRefresh(); releaseOwner() }
    // The new owner's (empty) collection loads; still none of the previous account's cards.
    await page.evaluate(() => new Promise<void>(resolve => setTimeout(resolve, 500)))
    await expect(spread).toHaveCount(0)
  })
})

/** Sign in as another account in this tab, the way Supabase announces a session change. */
async function switchAccount(page: Page, partner: typeof E2E_USER) {
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
}
