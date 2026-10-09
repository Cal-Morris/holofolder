/* eslint-disable react-hooks/rules-of-hooks -- Playwright fixtures call `use`, not a React hook. */
import { test as base, expect, type Page, type Locator } from "@playwright/test"

export const SAFE_AREA = { top: 59, bottom: 34, left: 0, right: 0 }

export const E2E_USER = {
  id: "00000000-0000-4000-8000-0000000000e2",
  aud: "authenticated",
  role: "authenticated",
  email: "e2e@binderdex.test",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {},
  created_at: "2026-01-01T00:00:00.000Z",
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54399"

const SEEDED_COLLECTION = [
  { id: "e2e-1", user_id: E2E_USER.id, pokemon_id: 1, pokemon_name: "bulbasaur", card_id: "base1-44", card_name: "Bulbasaur", card_set: "Base Set", card_language: "en", card_finish: "normal", wanted_cards: [], status: "collected", collected_at: "2026-01-01T00:00:00.000Z" },
  { id: "e2e-4", user_id: E2E_USER.id, pokemon_id: 4, pokemon_name: "charmander", card_id: "base1-46", card_name: "Charmander", card_set: "Base Set", card_language: "en", card_finish: "normal", wanted_cards: [], status: "collected", collected_at: "2026-01-01T00:00:00.000Z" },
]

function base64Url(value: string) {
  return Buffer.from(value).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/** A locally valid (unsigned) Supabase session so the browser client treats the user as signed in. */
function fakeSessionCookieValue() {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600
  const accessToken = [
    base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" })),
    base64Url(JSON.stringify({ sub: E2E_USER.id, aud: "authenticated", role: "authenticated", exp: expiresAt, email: E2E_USER.email })),
    "e2e",
  ].join(".")
  const session = { access_token: accessToken, token_type: "bearer", expires_in: 3600, expires_at: expiresAt, refresh_token: "e2e-refresh", user: E2E_USER }
  return `base64-${base64Url(JSON.stringify(session))}`
}

type Fixtures = {
  signedIn: boolean
  standalone: boolean
  insets: typeof SAFE_AREA
  harness: Harness
}

export class Harness {
  constructor(readonly page: Page, readonly insets: typeof SAFE_AREA, readonly signedIn = false) {}

  get path() {
    return this.signedIn ? "/e2e-harness?signedIn=1" : "/e2e-harness"
  }

  get viewport() {
    return this.page.viewportSize()!
  }

  /** Visible dialogs (modals, sheets, popover panels). */
  dialogs() {
    return this.page.locator("[role=dialog]:visible")
  }

  dock() {
    return this.page.getByRole("navigation", { name: "Main navigation" })
  }

  async open() {
    await this.page.goto(this.path)
    await expect(this.dock()).toBeVisible({ timeout: 30_000 })
    await expect(this.page.locator("button", { hasText: "#0001" }).first()).toBeVisible()
  }

  async openCardDetail() {
    await this.page.locator("button", { hasText: "#0001" }).first().click()
    const dialog = this.page.getByRole("dialog", { name: /bulbasaur/i })
    await expect(dialog).toBeVisible()
    return dialog
  }

  closeControl(dialog: Locator) {
    return dialog.getByRole("button", { name: /^close/i }).first()
  }

  /** Assert a locator is fully inside the visible area (excluding the simulated safe areas). */
  async expectWithinSafeViewport(locator: Locator) {
    const box = await locator.boundingBox()
    expect(box, "element should be rendered").not.toBeNull()
    const { width, height } = this.viewport
    expect(box!.y, "top edge should be below the status bar / safe area").toBeGreaterThanOrEqual(this.insets.top - 0.5)
    expect(box!.x).toBeGreaterThanOrEqual(-0.5)
    expect(box!.x + box!.width).toBeLessThanOrEqual(width + 0.5)
    expect(box!.y + box!.height, "bottom edge should be above the home indicator").toBeLessThanOrEqual(height - this.insets.bottom + 0.5)
  }

  /** The element at the centre of `locator` must be the locator itself (i.e. not covered). */
  async expectHittable(locator: Locator) {
    const box = await locator.boundingBox()
    expect(box).not.toBeNull()
    const hit = await locator.evaluate((element, point) => {
      const top = document.elementFromPoint(point.x, point.y)
      return Boolean(top && (top === element || element.contains(top)))
    }, { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 })
    expect(hit, "element should not be covered by another layer").toBe(true)
  }

  async expectMinTapTarget(locator: Locator, min = 36) {
    const box = await locator.boundingBox()
    expect(box).not.toBeNull()
    expect(Math.round(box!.width)).toBeGreaterThanOrEqual(min)
    expect(Math.round(box!.height)).toBeGreaterThanOrEqual(min)
  }

  async expectNoHorizontalOverflow() {
    const overflow = await this.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  }

  async expectScrollUnlocked() {
    await expect.poll(() => this.page.evaluate(() => ({
      body: getComputedStyle(document.body).overflow,
      html: getComputedStyle(document.documentElement).overflow,
    }))).toEqual(expect.objectContaining({ body: expect.not.stringMatching(/hidden/), html: expect.not.stringMatching(/hidden/) }))
  }

  /** Tap the backdrop at a point that is outside the dialog, header and dock. */
  async tapBackdrop(dialog: Locator) {
    const box = (await dialog.boundingBox())!
    const { width, height } = this.viewport
    const candidates = [
      { x: 4, y: Math.round(height * 0.3) },
      { x: width - 4, y: Math.round(height * 0.3) },
      { x: Math.round(width / 2), y: Math.max(box.y - 12, this.insets.top + 4) },
    ]
    for (const point of candidates) {
      const insideDialog = point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height
      if (insideDialog) continue
      const isBackdrop = await this.page.evaluate(({ x, y }) => {
        const element = document.elementFromPoint(x, y) as HTMLElement | null
        return Boolean(element?.closest("[data-overlay-backdrop]"))
      }, point)
      if (isBackdrop) {
        await this.page.mouse.click(point.x, point.y)
        return
      }
    }
    throw new Error("No backdrop area found outside the dialog")
  }

  /** Drag the sheet grabber/header downwards like a swipe-to-dismiss gesture. */
  async swipeDown(dialog: Locator) {
    const grabber = dialog.locator("[data-sheet-grabber]").first()
    await expect(grabber, "bottom sheet should have a swipe grabber").toBeVisible()
    const box = (await grabber.boundingBox())!
    const x = box.x + box.width / 2
    const y = box.y + Math.min(box.height / 2, 10)
    await this.page.mouse.move(x, y)
    await this.page.mouse.down()
    for (let step = 1; step <= 8; step += 1) {
      await this.page.mouse.move(x, y + step * 25)
    }
    await this.page.mouse.up()
  }
}

export const test = base.extend<Fixtures>({
  signedIn: [false, { option: true }],
  standalone: [async ({}, use, testInfo) => {
    await use(Boolean(testInfo.project.metadata?.standalone))
  }, { option: true }],
  insets: async ({ standalone }, use) => {
    await use(standalone ? SAFE_AREA : { top: 0, bottom: 0, left: 0, right: 0 })
  },
  harness: async ({ page, standalone, insets, signedIn, baseURL }, use) => {
    if (standalone) {
      await page.addInitScript(() => {
        const originalMatchMedia = window.matchMedia.bind(window)
        window.matchMedia = (query: string) => {
          if (query.includes("display-mode: standalone")) {
            return { ...originalMatchMedia("(min-width: 0px)"), media: query, matches: true } as MediaQueryList
          }
          return originalMatchMedia(query)
        }
        Object.defineProperty(window.navigator, "standalone", { value: true, configurable: true })
      })
      const session = await page.context().newCDPSession(page)
      await session.send("Emulation.setSafeAreaInsetsOverride" as never, { insets } as never).catch(() => undefined)
      await session.send("Emulation.setEmulatedMedia", { features: [{ name: "display-mode", value: "standalone" }] }).catch(() => undefined)
    }

    await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => route.abort())
    await page.route("**/api/card-prices**", async (route) => {
      const body = route.request().postDataJSON?.() ?? {}
      const lookups: Array<{ cardId: string; language?: string }> = Array.isArray(body?.cards) ? body.cards : []
      const now = Date.now()
      await route.fulfill({
        json: {
          prices: lookups.map((lookup) => ({
            cardId: lookup.cardId,
            language: lookup.language ?? "en",
            gbpAmount: 0.2,
            marketGbpAmount: 0.2,
            goodGbpAmount: 0.02,
            lowGbpAmount: 0.02,
            highGbpAmount: 0.23,
            confidence: "low",
            sourcePrices: [
              { source: "tcgplayer", label: "TCGplayer", variantLabel: "Normal", marketGbpAmount: 0.2, lowGbpAmount: 0.02, originalMarketAmount: 0.26, originalLowAmount: 0.03, originalCurrency: "USD", updatedAt: new Date(now - 86_400_000).toISOString() },
              { source: "cardmarket", label: "Cardmarket", variantLabel: "Trend", marketGbpAmount: 0.05, lowGbpAmount: 0.02, originalMarketAmount: 0.06, originalLowAmount: 0.02, originalCurrency: "EUR", updatedAt: new Date(now - 86_400_000).toISOString() },
            ],
            trendPoints: [
              { label: "30d", source: "cardmarket", gbpAmount: 0.3, originalAmount: 0.35, originalCurrency: "EUR" },
              { label: "7d", source: "cardmarket", gbpAmount: 0.12, originalAmount: 0.14, originalCurrency: "EUR" },
              { label: "1d", source: "cardmarket", gbpAmount: 0.06, originalAmount: 0.07, originalCurrency: "EUR" },
              { label: "Trend", source: "cardmarket", gbpAmount: 0.05, originalAmount: 0.06, originalCurrency: "EUR" },
            ],
            buySignal: { status: "good", label: "Good time", reason: "Current trend is 82% below 30d average." },
            originalAmount: 0.26,
            originalCurrency: "USD",
            source: "tcgplayer",
            variantLabel: "Normal",
            updatedAt: new Date(now - 86_400_000).toISOString(),
            fxDate: null,
            fetchedAt: now,
          })),
        },
      })
    })
    await page.route("**/api/tcgdex-cache**", (route) => route.fulfill({ json: { cards: [] } }))
    await page.route("**/api/tcg-set-slots**", (route) => route.fulfill({ json: { sets: [], selectedSet: null, slots: [] } }))

    if (signedIn) {
      const storageKey = `sb-${new URL(SUPABASE_URL).hostname.split(".")[0]}-auth-token`
      await page.context().addCookies([{ name: storageKey, value: fakeSessionCookieValue(), url: baseURL ?? "http://localhost:3210" }])
    }
    // Mock the Supabase API: auth returns the e2e user, the collection returns the seeded rows,
    // every other table read is empty and writes succeed.
    await page.route(`${SUPABASE_URL}/**`, async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      if (url.pathname.startsWith("/auth/v1/user")) {
        return signedIn ? route.fulfill({ json: E2E_USER }) : route.fulfill({ status: 401, json: { message: "no session" } })
      }
      if (url.pathname.startsWith("/auth/v1/")) {
        return route.fulfill({ json: {} })
      }
      if (url.pathname === "/rest/v1/pokemon_collection" && request.method() === "GET") {
        return route.fulfill({ json: SEEDED_COLLECTION })
      }
      if (request.method() === "GET" || request.method() === "HEAD") {
        return route.fulfill({ json: [] })
      }
      return route.fulfill({ json: [] })
    })

    const harness = new Harness(page, insets, signedIn)
    await harness.open()
    await use(harness)
  },
})

export { expect }
