/* eslint-disable react-hooks/rules-of-hooks -- Playwright fixtures call `use`, not a React hook. */
import { test as base, expect, type BrowserContext, type Page, type Locator } from "@playwright/test"

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

type MockCard = {
  id: string
  localId: string
  name: string
  image: string
  set: { id: string; name: string; officialCardCount: number; releaseDate: string }
  rarity: string
  variants: Record<string, boolean>
  dexIds: number[]
}

function mockCard(dexId: number, name: string, setId: string, setName: string, localId: string, total: number, releaseDate: string, rarity: string, variants: Record<string, boolean>): MockCard {
  return {
    id: `${setId}-${localId}`,
    localId,
    name,
    image: `https://assets.tcgdex.net/en/mock/${setId}/${localId}/high.webp`,
    set: { id: setId, name: setName, officialCardCount: total, releaseDate },
    rarity,
    variants,
    dexIds: [dexId],
  }
}

/** Printings served by the mocked TCG mirror (/api/tcgdex-cache and /api/tcg-card-search). */
export const MOCK_CARDS: MockCard[] = [
  mockCard(1, "Bulbasaur", "base1", "Base Set", "44", 102, "1999-01-09", "Common", { normal: true, firstEdition: true }),
  mockCard(1, "Bulbasaur", "sv03.5", "151", "001", 165, "2023-09-22", "Common", { normal: true, reverse: true }),
  mockCard(1, "Bulbasaur", "sv03.5", "151", "166", 165, "2023-09-22", "Illustration Rare", { holo: true }),
  mockCard(1, "Bulbasaur", "me02", "Phantasmal Flames", "001", 94, "2025-11-14", "Common", { normal: true, reverse: true }),
  mockCard(1, "Bulbasaur", "swsh12pt5", "Crown Zenith", "001", 159, "2023-01-20", "Common", { normal: true, reverse: true }),
  mockCard(1, "Bulbasaur", "me05", "Pitch Black", "001", 84, "2026-07-17", "Common", { normal: true, reverse: true }),
  mockCard(4, "Charmander", "base1", "Base Set", "46", 102, "1999-01-09", "Common", { normal: true, firstEdition: true }),
  mockCard(4, "Charmander", "sv03.5", "151", "004", 165, "2023-09-22", "Common", { normal: true, reverse: true }),
  mockCard(4, "Charmander", "sv03.5", "151", "168", 165, "2023-09-22", "Illustration Rare", { holo: true }),
  mockCard(5, "Charmeleon", "sv03.5", "151", "005", 165, "2023-09-22", "Uncommon", { normal: true, reverse: true }),
  mockCard(6, "Charizard ex", "sv03.5", "151", "006", 165, "2023-09-22", "Double Rare", { holo: true }),
]

const CARD_PALETTE = ["#2563eb", "#16a34a", "#dc2626", "#9333ea", "#ea580c", "#0891b2"]

function placeholderSvg(label: string, seed: number) {
  const color = CARD_PALETTE[seed % CARD_PALETTE.length]
  const safe = label.replace(/[^a-zA-Z0-9 #./-]/g, "").slice(0, 24)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="245" height="342" viewBox="0 0 245 342"><rect width="245" height="342" rx="14" fill="${color}"/><rect x="12" y="12" width="221" height="318" rx="10" fill="#f8fafc" opacity="0.9"/><rect x="24" y="48" width="197" height="140" rx="6" fill="${color}" opacity="0.35"/><text x="122" y="230" font-family="sans-serif" font-size="20" font-weight="700" text-anchor="middle" fill="#0f172a">${safe}</text></svg>`
}

/** Make the page look like an installed PWA (display-mode: standalone, navigator.standalone, safe areas). */
export async function emulateStandalone(page: Page, insets: typeof SAFE_AREA) {
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

/**
 * Mock every backend the binder talks to. `target` is the page, or the browser context when a service
 * worker is active (only context routes see the worker's own requests).
 */
export async function mockBackends(target: Page | BrowserContext, context: BrowserContext, { signedIn, baseURL }: { signedIn: boolean; baseURL?: string }) {
  await target.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => route.abort())
  await target.route("**/api/card-prices**", async (route) => {
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
  await target.route("**/api/tcgdex-cache**", (route) => {
    const pokemonId = Number(new URL(route.request().url()).searchParams.get("pokemonId"))
    const cards = MOCK_CARDS.filter((card) => card.dexIds.includes(pokemonId)).map(({ dexIds: _dexIds, ...card }) => card)
    return route.fulfill({ json: { cards, source: "mirror" } })
  })
  await target.route("**/api/tcg-card-search**", (route) => {
    const query = (new URL(route.request().url()).searchParams.get("q") ?? "").toLowerCase().trim()
    const [first, second] = query.split(/\s+/)
    const cards = MOCK_CARDS.filter((card) => {
      const haystack = `${card.name} ${card.set.name} ${card.set.id} ${card.id}`.toLowerCase()
      if (!haystack.includes(first)) return false
      return !second || card.localId.replace(/^0+/, "") === second.replace(/^#/, "").split("/")[0].replace(/^0+/, "")
    })
    return route.fulfill({ json: { cards } })
  })
  // Placeholder art for card images and Pokémon artwork (external hosts are otherwise blocked).
  await target.route(/^https:\/\/(assets\.tcgdex\.net|raw\.githubusercontent\.com)\//, (route) => {
    const url = route.request().url()
    const card = MOCK_CARDS.find((candidate) => url.includes(`/${candidate.set.id}/${candidate.localId}/`))
    const label = card ? `${card.name} ${card.localId}` : (url.match(/(\d+)\.png$/)?.[1] ? `#${url.match(/(\d+)\.png$/)![1]}` : "card")
    return route.fulfill({ contentType: "image/svg+xml", body: placeholderSvg(label, card ? MOCK_CARDS.indexOf(card) : label.length) })
  })
  await target.route("**/api/card-image-proxy**", (route) => {
    const source = new URL(route.request().url()).searchParams.get("url") ?? ""
    const label = source.match(/(\d+)\.png$/)?.[1] ? `#${source.match(/(\d+)\.png$/)![1]}` : "card"
    return route.fulfill({ contentType: "image/svg+xml", body: placeholderSvg(label, label.length) })
  })
  await target.route("**/api/tcg-set-slots**", (route) => route.fulfill({ json: { sets: [], selectedSet: null, slots: [] } }))

  if (signedIn) {
    const storageKey = `sb-${new URL(SUPABASE_URL).hostname.split(".")[0]}-auth-token`
    await context.addCookies([{ name: storageKey, value: fakeSessionCookieValue(), url: baseURL ?? "http://localhost:3210" }])
  }
  // Mock the Supabase API: auth returns the e2e user, the collection returns the seeded rows,
  // every other table read is empty and writes succeed.
  await target.route(`${SUPABASE_URL}/**`, async (route) => {
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
    await expect(this.page.locator("button[data-dex-id=\"1\"]").first()).toBeVisible()
  }

  async openCardDetail() {
    await this.page.locator("button[data-dex-id=\"1\"]").first().click()
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
      await emulateStandalone(page, insets)
    }

    await mockBackends(page, page.context(), { signedIn, baseURL })

    const harness = new Harness(page, insets, signedIn)
    await harness.open()
    await use(harness)
  },
})

export { expect }
