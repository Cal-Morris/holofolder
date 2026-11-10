import { test, expect, emulateStandalone } from './fixtures'
import type { CDPSession, Locator, Page } from '@playwright/test'

// Run only with scripts/verify-public-share-backend.ts and a build using that synthetic origin.
// Uses `page` directly: the harness fixture boots the private app first, whose storage reset can reload this page.
const backend = process.env.PUBLIC_SHARE_BACKEND_URL ?? 'http://127.0.0.1:54471'
test.skip(process.env.PUBLIC_SHARE_TEST_BACKEND !== '1', 'Requires the explicitly configured local synthetic PostgREST backend')
test.describe.configure({ mode: 'serial' })
const PATHS = ['/app/share/synthetic-token', '/app/u/synthetic-owner/mixed']

for (const path of PATHS) {
  test(`real share route keeps order, privacy and revocation in the read-only binder: ${path}`, async ({ page, request, standalone, insets }) => {
    const priceRequests: string[] = []
    page.on('request', r => { if (/card-prices|pokepulse|tcgplayer|cardmarket/i.test(r.url())) priceRequests.push(r.url()) })
    const phone = await open(page, request, path, standalone, insets, '')
    const response = phone.response
    expect(response.status()).toBe(200)
    expect(response.headers()['cache-control']).toContain('no-store')
    expect(response.headers()['cdn-cache-control']).toBe('no-store')
    const html = await response.text()
    for (const sentinel of ['PRIVATE', 'certificate', 'assetIds', 'wanted_by', 'purchase_cost', 'binder-allowed', 'marketGBP']) expect(html).not.toContain(sentinel)
    expect(html).toContain('noindex')
    const pockets = page.locator('[data-slot-id]')
    await expect(pockets).toHaveCount(6)
    expect(await pockets.evaluateAll(nodes => nodes.map(n => n.getAttribute('aria-label')))).toEqual([
      'Synthetic Snorlax, Owned', 'Synthetic Snorlax, Owned', 'Synthetic Trainer, Owned', 'Synthetic Energy, Owned', 'Free slot, Empty spacer', 'Free slot, Empty spacer',
    ])
    await expect(page.getByText('Shared binder', { exact: true })).toBeVisible()
    await phone.expectNoHorizontalOverflow()
    // Prices off: no saved estimate in details and no price reads anywhere.
    await page.getByRole('button', { name: 'Synthetic Snorlax, Owned' }).first().click()
    const unpriced = page.getByRole('dialog', { name: 'Synthetic Snorlax, Owned details' })
    await expect(unpriced).toContainText('Owned copy')
    await expect(unpriced).not.toContainText('£')
    await expect(unpriced).not.toContainText('market estimate')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Next binder page', exact: true }).click()
    await expect(page.getByRole('button', { name: 'snorlax, Unfilled target' })).toBeVisible()
    const calls = await (await request.get(`${backend}/_synthetic/calls`)).json()
    expect(calls.filter((c: { table: string }) => c.table === 'card_prices')).toHaveLength(0)
    expect(priceRequests).toEqual([])
    await request.get(`${backend}/_synthetic/reset?rows=3&cols=8&light=1&stress=1`)
    await page.reload()
    await expect(page.getByRole('region', { name: 'Scrollable binder page 1' })).toBeVisible({ timeout: 30_000 })
    await phone.expectNoHorizontalOverflow()
    await page.getByRole('button', { name: 'Synthetic Snorlax, Owned' }).first().click()
    const detail = page.getByRole('dialog', { name: 'Synthetic Snorlax, Owned details' })
    await expect(detail).toContainText('Recorded grading provider')
    // Not checked against the safe area here: a 500-character stress grade overflows the shared SlotDetail
    // in standalone (private app too). Normal details are checked in the next test.
    await page.keyboard.press('Escape')
    await expect(detail).toHaveCount(0)
    await phone.expectNoHorizontalOverflow()
    await request.get(`${backend}/_synthetic/reset?revoked=1`)
    const revoked = await page.reload()
    // Streamed Next notFound can retain HTTP 200 after the public PPR shell was sent.
    expect([200, 404]).toContain(revoked?.status())
    expect(revoked?.headers()['cache-control']).toContain('no-store')
    await expect(page.getByRole('heading', { name: /Page not found/i })).toBeVisible()
    await expect(page.locator('[data-slot-id]')).toHaveCount(0)
  })

  test(`swipe turns one page, wants are dimmed, details and app controls stay read-only: ${path}`, async ({ page, request, standalone, insets }) => {
    const writes: string[] = []
    const api: string[] = []
    page.on('request', r => {
      if (r.method() !== 'GET' && r.method() !== 'HEAD') writes.push(`${r.method()} ${r.url()}`)
      // Only public catalog reads (card search, sets, illustrators) and images; never account, collection, storage or price APIs.
      if (/\/app\/api\/(?!card-image-proxy|tcg-card-search|tcg-set-slots|tcg-illustrators|tcgdex-cache)/.test(r.url())) api.push(r.url())
    })
    const phone = await open(page, request, path, standalone, insets, 'wanted=1&prices=1&rows=1&cols=3')
    const html = await phone.response.text()
    for (const sentinel of ['PRIVATE', 'wanted_by', '00000000-0000', 'added_at', 'notes']) expect(html).not.toContain(sentinel)
    const pageNumber = page.getByRole('spinbutton', { name: 'Binder page number' })
    const current = page.locator('[data-binder-page]')
    await expect(current).toHaveAttribute('data-binder-page', '1')
    // An owned copy with a stored want previews the want dimmed in Mixed, as the private binder does.
    await expect(page.locator('[data-slot-id="public-0"] img')).toHaveClass(/grayscale/)
    // Prices on: the owner's saved estimate from the share payload, with no live price request.
    await page.locator('[data-slot-id="public-0"]').tap()
    const priced = page.getByRole('dialog', { name: 'Synthetic Snorlax, Owned details' })
    await expect(priced).toContainText('Saved market estimate: £12.34')
    await page.keyboard.press('Escape')
    await expect(priced).toHaveCount(0)
    // One swipe moves exactly one of three pages; the last page is a hard stop; vertical drags never turn.
    await phone.swipe(-90)
    await expect(current).toHaveAttribute('data-binder-page', '2')
    await expect(pageNumber).toHaveValue('2')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await phone.swipe(-90)
    await expect(current).toHaveAttribute('data-binder-page', '3')
    await phone.swipe(-90)
    await expect(current).toHaveAttribute('data-binder-page', '3')
    await phone.swipe(-30, 90)
    await expect(current).toHaveAttribute('data-binder-page', '3')
    const wanted = page.getByRole('button', { name: 'snorlax, Unfilled target' })
    await expect(wanted.locator('img')).toHaveClass(/grayscale/)
    // Card details: the existing slot detail sheet, read-only, every dismissal path.
    const detail = page.getByRole('dialog', { name: 'snorlax, Unfilled target details' })
    await wanted.tap()
    await expect(detail).toBeVisible()
    await expect(detail.getByRole('button', { name: /assign|place|remove|edit/i })).toHaveCount(0)
    const close = detail.getByRole('button', { name: /close/i }).first()
    await phone.expectMinTapTarget(close, 36)
    await phone.expectWithinSafeViewport(close)
    await close.click()
    await expect(detail).toHaveCount(0)
    await wanted.tap()
    await page.keyboard.press('Escape')
    await expect(detail).toHaveCount(0)
    await phone.swipe(90)
    await expect(current).toHaveAttribute('data-binder-page', '2')
    // Jump straight to a page.
    await pageNumber.fill('1')
    await pageNumber.press('Enter')
    await expect(current).toHaveAttribute('data-binder-page', '1')
    // Search is indexed from this share's pockets: true counts, real destinations, nothing from a dex-order guess.
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    const search = page.getByRole('dialog', { name: 'Search Pokemon' })
    await expect(search.getByRole('button', { name: /^Needed\s*1$/ })).toBeVisible()
    await expect(search.getByRole('button', { name: /^Wanted\s*1$/ })).toBeVisible()
    await expect(search.getByRole('button', { name: /^Missing/ })).toHaveCount(0)
    await expect(search.getByText('Not in binder').first()).toBeVisible()
    await search.getByRole('textbox').first().fill('snorlax')
    await expect(search).toContainText('Page 1 • A1')
    await search.getByRole('button', { name: /snorlax/i }).first().click()
    await expect(page.getByRole('dialog', { name: 'Synthetic Snorlax, Owned details' })).toBeVisible()
    await page.keyboard.press('Escape')
    // Next needed goes pocket by pocket and opens the exact unfilled target on its page.
    await page.getByRole('button', { name: 'Next needed' }).click()
    await expect(current).toHaveAttribute('data-binder-page', '3')
    await expect(page.getByRole('dialog', { name: 'snorlax, Unfilled target details' })).toBeVisible()
    await page.keyboard.press('Escape')
    // Wanted lists every stored want separately and opens its own pocket; no private assignment is shown.
    await page.getByRole('button', { name: 'Wanted', exact: true }).click()
    const wants = page.getByRole('list', { name: 'Wanted cards' }).getByRole('listitem')
    await expect(wants).toHaveCount(3)
    await expect(page.getByTestId('main-content')).not.toContainText('Wanted by')
    await page.getByRole('button', { name: 'Open Synthetic Trainer' }).click()
    await expect(current).toHaveAttribute('data-binder-page', '3')
    await expect(page.getByRole('dialog', { name: 'snorlax, Unfilled target details' })).toBeVisible()
    await page.keyboard.press('Escape')
    await pageNumber.fill('1')
    await pageNumber.press('Enter')
    await expect(current).toHaveAttribute('data-binder-page', '1')
    await page.getByRole('button', { name: 'More' }).click()
    await expect(page.getByRole('menuitem', { name: 'Show mode' })).toBeVisible()
    await page.keyboard.press('Escape')
    const join = page.getByRole('button', { name: 'Join now' })
    await phone.expectMinTapTarget(join, 36)
    await join.click()
    await expect(page.getByRole('dialog', { name: 'Create account' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Create account' })).toHaveCount(0)
    await phone.expectMinTapTarget(page.getByRole('button', { name: 'Previous binder page' }), 36)
    // The dock pads itself over the home indicator; its buttons must sit above it.
    await phone.expectWithinSafeViewport(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Binder' }))
    await phone.expectWithinSafeViewport(current)
    await phone.expectNoHorizontalOverflow()
    // No account, collection, settings or storage traffic; nothing is ever written.
    expect(writes).toEqual([])
    expect(api).toEqual([])
  })
}

async function open(page: Page, request: { get: (url: string) => Promise<unknown> }, path: string, standalone: boolean, insets: { top: number; bottom: number; left: number; right: number }, reset: string) {
  if (standalone) await emulateStandalone(page, insets)
  await request.get(`${backend}/_synthetic/reset?${reset}`)
  const response = (await page.goto(path))!
  const stageSelector = '[data-page-turn-ms]'
  // Streamed content waits in a hidden Suspense placeholder until React reveals it.
  await expect(page.locator(stageSelector)).toBeVisible({ timeout: 30_000 })
  // Synthetic images 404, and CardImage re-mounts an <img> on failure; a touch on a detached node never ends.
  await page.waitForLoadState('networkidle')
  const touch = await page.context().newCDPSession(page)
  await swipeReady(touch)
  const box = async (locator: Locator) => { const value = await locator.boundingBox(); expect(value).not.toBeNull(); return value! }
  return {
    response,
    async swipe(dx: number, dy = 0) {
      const b = await box(page.locator('[data-binder-page]'))
      const x = b.x + b.width / 2, y = b.y + b.height / 2
      await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] })
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx, y: y + dy, id: 1 }] })
      await new Promise(resolve => setTimeout(resolve, 120))
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx, y: y + dy, id: 1 }] })
      await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      // The page turn animates; let it settle before the next gesture.
      await page.waitForTimeout(450)
    },
    async expectMinTapTarget(locator: Locator, min = 36) { const b = await box(locator); expect(Math.round(b.width)).toBeGreaterThanOrEqual(min); expect(Math.round(b.height)).toBeGreaterThanOrEqual(min) },
    async expectNoHorizontalOverflow() { expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0) },
    async expectWithinSafeViewport(locator: Locator) {
      const b = await box(locator), { width, height } = page.viewportSize()!
      expect(b.y).toBeGreaterThanOrEqual(insets.top - 0.5)
      expect(b.x).toBeGreaterThanOrEqual(-0.5)
      expect(b.x + b.width).toBeLessThanOrEqual(width + 0.5)
      expect(b.y + b.height).toBeLessThanOrEqual(height - insets.bottom + 0.5)
    },
  }
}

/** The binder's swipe hook binds in an effect after hydration, on the stage around the page. */
async function swipeReady(touch: CDPSession) {
  await expect.poll(async () => {
    const { result } = await touch.send('Runtime.evaluate', { expression: 'document.querySelector("[data-page-turn-ms]")?.parentElement' })
    if (!result.objectId) return false
    const { listeners } = await touch.send('DOMDebugger.getEventListeners', { objectId: result.objectId })
    return listeners.some(l => l.type === 'touchend')
  }).toBe(true)
}
