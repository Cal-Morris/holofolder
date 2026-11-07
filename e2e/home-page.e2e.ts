import { test, expect, emulateStandalone, mockBackends, SAFE_AREA } from "./fixtures"

test.beforeEach(async ({ page, baseURL }, testInfo) => {
  if (testInfo.project.metadata.standalone) await emulateStandalone(page, SAFE_AREA)
  await mockBackends(page, page.context(), { signedIn: false, baseURL })
  await page.goto("/app/home")
})

test("homepage keeps real cards, app entry and studio navigation", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "Show us your binder." })).toBeVisible()
  const pricing=page.getByRole("article",{name:"Early access pricing"})
  await expect(pricing.getByText("Free",{exact:true})).toBeVisible()
  await expect(pricing.getByText("No subscription fee during early access.",{exact:true})).toBeVisible()
  await expect(pricing.getByRole("button",{name:"Start collecting",exact:true})).toBeVisible()
  const fan = page.getByRole("region", { name: "Featured Pokémon cards" })
  await expect(fan.getByRole("img", { name: "Bulbasaur, 151, 166 / 165" })).toBeVisible()
  await expect(page.getByRole("link", { name: "Try the binder studio" })).toHaveAttribute("href", "/app/studio")
  await expect(page.getByTestId("card-data-attribution")).toBeVisible()
  await expect(page.getByRole("heading", { name: /What’s that.*card worth/ })).toBeVisible()
  for (const name of ["Check the sources.", "See how prices move.", "Keep an eye on wanted cards."]) {
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible()
  }
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Welcome, sign in" })
  await expect(dialog).toBeVisible()
  const email = dialog.getByPlaceholder("you@example.com")
  await email.fill("collector@example.com")
  for (const dark of [true, false]) {
    await page.evaluate((enabled) => document.documentElement.classList.toggle("dark", enabled), dark)
    for (const element of [dialog.getByRole("heading", { name: "Welcome", exact: true }), email]) {
      await expect.poll(() => element.evaluate((node) => {
        const canvas = document.createElement("canvas")
        canvas.width = canvas.height = 1
        const context = canvas.getContext("2d")!
        const parents = []
        for (let parent: Element | null = node; parent; parent = parent.parentElement) parents.unshift(parent)
        context.fillStyle = "white"
        context.fillRect(0, 0, 1, 1)
        for (const parent of parents) {
          context.fillStyle = getComputedStyle(parent).backgroundColor
          context.fillRect(0, 0, 1, 1)
        }
        const background = context.getImageData(0, 0, 1, 1).data.slice(0, 3)
        context.fillStyle = getComputedStyle(node).color
        context.fillRect(0, 0, 1, 1)
        const foreground = context.getImageData(0, 0, 1, 1).data.slice(0, 3)
        const luminance = (channels: Uint8ClampedArray) => {
          const values = Array.from(channels, (value) => {
            const channel = value / 255
            return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4
          })
          return values[0] * .2126 + values[1] * .7152 + values[2] * .0722
        }
        const a = luminance(background), b = luminance(foreground)
        return (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
      }), { message: `${dark ? "dark" : "light"} auth text contrast` }).toBeGreaterThanOrEqual(4.5)
    }
  }
  await expect(email).toHaveValue("collector@example.com")
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test("featured cards support manual cycling and respect reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.reload()
  const fan = page.getByRole("region", { name: "Featured Pokémon cards" })
  await expect(page.getByTestId("featured-card-name")).toHaveText("Bulbasaur")
  await page.waitForTimeout(4700)
  await expect(page.getByTestId("featured-card-name")).toHaveText("Bulbasaur")
  for (const name of ["Charmander", "Squirtle", "Venusaur ex", "Charizard ex", "Blastoise ex", "Bulbasaur"]) {
    await fan.getByRole("button", { name: "Next featured card" }).click()
    await expect(page.getByTestId("featured-card-name")).toHaveText(name)
  }
  await fan.getByRole("button", { name: "Previous featured card" }).click()
  await expect(page.getByTestId("featured-card-name")).toHaveText("Blastoise ex")
  await fan.getByRole("button", { name: "Pause featured cards" }).click()
  await expect(fan.getByRole("button", { name: "Play featured cards" })).toHaveAttribute("aria-pressed", "true")
  for (const image of await fan.getByRole("img").all()) {
    await expect(image).toHaveAttribute("src", /^\/app\/api\/card-image-proxy\?url=/)
  }
  for (const button of await fan.getByRole("button").all()) {
    const bounds = await button.boundingBox()
    expect(bounds!.width).toBeGreaterThanOrEqual(36)
    expect(bounds!.height).toBeGreaterThanOrEqual(36)
  }
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})


test("featured cards shuffle without replacing scans and gather within the hero", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" })
  const fan = page.getByRole("region", { name: "Featured Pokémon cards" })
  const stage = page.getByTestId("featured-card-stage")
  const deck = stage.locator(":scope > div")
  await stage.scrollIntoViewIfNeeded()
  // Motion starts disabled until the browser preference and stage visibility are applied.
  await expect.poll(() => deck.evaluate((element) => (element as HTMLElement).style.transform)).not.toBe("")
  const scans = fan.locator("[data-card-id]")
  await expect(scans).toHaveCount(6)
  await scans.evaluateAll((elements) => elements.forEach((element) => element.setAttribute("data-stable-node", "yes")))
  await fan.getByRole("button", { name: "Next featured card" }).click()
  await expect(page.getByTestId("featured-card-name")).toHaveText("Charmander")
  await expect.poll(() => stage.evaluate((element) => element.getAnimations({ subtree: true }).some((animation) => animation.playState === "running"))).toBe(true)
  await fan.getByRole("button", { name: "Next featured card" }).click()
  await fan.getByRole("button", { name: "Previous featured card" }).click()
  await expect(page.getByTestId("featured-card-name")).toHaveText("Charmander")
  await expect.poll(() => stage.evaluate((element) => element.getAnimations({ subtree: true }).some((animation) => animation.playState === "running"))).toBe(false)
  await expect(fan.locator("[data-stable-node=yes]")).toHaveCount(6)
  const before = await deck.evaluate((element) => getComputedStyle(element).transform)
  await stage.evaluate(element => window.scrollBy(0, Math.max(100, element.getBoundingClientRect().top - innerHeight * .2)))
  await expect.poll(() => deck.evaluate((element) => getComputedStyle(element).transform)).not.toBe(before)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await expect(stage).toHaveCSS("overflow-x", "clip")
  await fan.getByRole("button", { name: "Pause featured cards" }).click()
  const stopped = await deck.evaluate((element) => getComputedStyle(element).transform)
  await page.evaluate(() => window.scrollBy(0, 50))
  await expect(deck).toHaveCSS("transform", stopped)
  await fan.getByRole("button", { name: "Play featured cards" }).click()
  await fan.getByRole("button", { name: "Next featured card" }).focus()
  await page.keyboard.press("Enter")
  await expect(page.getByTestId("featured-card-name")).toHaveText("Squirtle")
  expect(await stage.evaluate((element) => element.getAnimations({ subtree: true }).some((animation) => animation.playState === "running"))).toBe(false)
})

const navigationLinks = [
  ["Collection tracking", "#collection"],
  ["Price tracking", "#prices"],
  ["Card wishlisting", "#wishlisting"],
  ["Card scanning", "#scanning"],
  ["Share your collection", "#sharing"],
  ["Partner collections", "#partners"],
  ["Offline access", "#offline"],
  ["Binder Studio", "/app/studio"],
  ["Pricing", "#pricing"],
]

test("mobile navigation exposes features and closes by every sheet dismissal", async ({ page, insets }) => {
  const opener = page.getByRole("button", { name: "Open navigation", exact: true })
  const dialog = page.getByRole("dialog", { name: "Explore Holo Folder" })
  await opener.click()
  await expect(opener).toHaveAttribute("aria-expanded", "true")
  await expect(dialog).toBeVisible()
  for (const [name, href] of navigationLinks) {
    await expect(dialog.getByRole("link", { name: new RegExp(`^${name}`) })).toHaveAttribute("href", href)
  }
  const close = dialog.getByRole("button", { name: "Close navigation" })
  const bounds = await close.boundingBox()
  expect(bounds!.width).toBeGreaterThanOrEqual(36)
  expect(bounds!.height).toBeGreaterThanOrEqual(36)
  expect(bounds!.y).toBeGreaterThanOrEqual(insets.top)
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height - insets.bottom)
  await close.click()
  await expect(dialog).toHaveCount(0)
  await expect(opener).toBeFocused()

  await opener.click()
  await page.keyboard.press("Escape")
  await expect(dialog).toHaveCount(0)
  await opener.click()
  await page.goBack()
  await expect(dialog).toHaveCount(0)
  await expect(page).toHaveURL(/\/app\/home$/)
  await opener.click()
  await page.locator("[data-overlay-backdrop]").click({ position: { x: 5, y: 5 } })
  await expect(dialog).toHaveCount(0)
  await opener.click()
  const header = dialog.getByRole("heading", { name: "Explore Holo Folder" }).locator("..")
  const headerBounds = await header.boundingBox()
  const x = headerBounds!.x + 30, y = headerBounds!.y + 20
  await page.mouse.move(x, y)
  await page.mouse.down()
  for (let step = 1; step <= 6; step++) await page.mouse.move(x, y + step * 24)
  await page.mouse.up()
  await expect(dialog).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe("hidden")
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test("feature links close navigation and arrive at the matching section", async ({ page }) => {
  const opener = page.getByRole("button", { name: "Open navigation", exact: true })
  const dialog = page.getByRole("dialog", { name: "Explore Holo Folder" })
  await opener.click()
  await dialog.getByRole("link", { name: /^Card wishlisting/ }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page).toHaveURL(/\/app\/home#wishlisting$/)
  await expect(page.getByRole("heading", { name: /^Card wishlisting\.?$/ })).toBeInViewport()
  await opener.click()
  await dialog.getByRole("link", { name: /^Pricing/ }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page).toHaveURL(/\/app\/home#pricing$/)
  await expect(page.getByRole("article", { name: "Early access pricing" })).toBeInViewport()
})

test("desktop Features offers the same product navigation", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "browser-390x844", "Desktop layout needs one representative browser project.")
  await page.setViewportSize({ width: 1280, height: 900 })
  const navigation = page.getByRole("navigation", { name: "Main navigation" })
  await expect(navigation.getByRole("button", { name: "Features", exact: true })).toBeVisible()
  await expect(navigation.getByRole("link", { name: "Pricing", exact: true })).toHaveAttribute("href", "#pricing")
  await navigation.getByRole("button", { name: "Features", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Explore Holo Folder" })
  await expect(dialog).toBeVisible()
  await dialog.getByRole("link", { name: /^Price tracking/ }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page).toHaveURL(/\/app\/home#prices$/)
  await expect(page.getByRole("heading", { name: /What’s that.*card worth/ })).toBeInViewport()
})

test("homepage offers a compact interactive 3D binder preview", async ({ page }) => {
  const preview = page.getByRole("group", { name: "Interactive Binder Studio preview" })
  await preview.scrollIntoViewIfNeeded()
  await expect(preview.locator("canvas")).toBeVisible()
  await preview.getByRole("button", { name: "Inside", exact: true }).click()
  await expect(preview.getByRole("button", { name: "Inside", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect(preview.locator(".studio-stage")).toHaveAttribute("data-current-spread", "0-1")
  await expect(preview.locator(".studio-stage")).toHaveAttribute("data-opening-state", "settled")
  await preview.getByRole("button", { name: "Next binder spread" }).click()
  await expect(preview.locator(".studio-stage")).toHaveAttribute("data-current-spread", "2-3")
  await expect(preview.locator(".studio-stage")).toHaveAttribute("data-left-cards", "9")
  await expect(preview.locator(".studio-stage")).toHaveAttribute("data-right-cards", "9")
  await preview.getByRole("button", { name: "Previous binder spread" }).click()
  await expect(preview.locator(".studio-stage")).toHaveAttribute("data-current-spread", "0-1")
  await preview.getByRole("button", { name: "Spine", exact: true }).click()
  await expect(preview.getByRole("button", { name: "Spine", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await preview.locator("summary").filter({hasText:/^Presets$/}).click()
  await preview.getByRole("button", { name: "Apply Magikarp preset", exact: true }).click()
  await expect(preview.getByRole("button", { name: "Apply Magikarp preset", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect(preview.getByRole("button", { name: "Cover", exact: true })).toHaveAttribute("aria-pressed", "true")
  await page.getByRole("link", { name: "Enter the binder studio" }).click()
  await expect(page).toHaveURL(/\/app\/studio$/)
})

test("Holo Folder branding fits mobile and installed app chrome", async ({ page, request }, testInfo) => {
  await expect(page).toHaveTitle("Holo Folder")
  await expect(page.getByRole("link", { name: "Holo Folder", exact: true })).toHaveCount(2)
  await expect(page.locator('meta[name="application-name"]')).toHaveAttribute("content", "Holo Folder")
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute("content", "Holo Folder")
  await expect(page.locator('meta[property="og:site_name"]')).toHaveAttribute("content", "Holo Folder")
  const response = await request.get("/app/manifest.webmanifest")
  expect(response.ok()).toBe(true)
  const manifest = await response.json()
  expect(manifest).toMatchObject({ name: "Holo Folder", short_name: "Holo Folder", start_url: "/app", display: "standalone" })
  expect(manifest.icons).toEqual(expect.arrayContaining([
    expect.objectContaining({ src: "/app/pwa-holo-cards-maskable-192.png", sizes: "192x192", purpose: "maskable" }),
    expect.objectContaining({ src: "/app/pwa-holo-cards-maskable-512.png", sizes: "512x512", purpose: "maskable" }),
  ]))
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", "/app/apple-touch-icon-holo-cards.png")
  const logo = page.getByRole("link", { name: "Holo Folder", exact: true }).first().locator("img")
  await expect(logo).toBeVisible()
  await expect(logo).toHaveAttribute("src", "/app/holo-card-mark.png")
  await expect.poll(() => logo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
  for (const dark of [true, false]) {
    await page.evaluate(enabled => document.documentElement.classList.toggle("dark", enabled), dark)
    const wordmark = page.getByRole("link", { name: "Holo Folder", exact: true }).first()
    await expect(wordmark).toBeVisible()
    const bounds = await wordmark.boundingBox()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await expect(page.locator("body")).not.toContainText(/BinderDex/i)
  await page.screenshot({ path: testInfo.outputPath("holo-card-home.png") })
})
