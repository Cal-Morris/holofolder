import { test, expect } from '@playwright/test'
import { emulateStandalone, SAFE_AREA } from './fixtures'

test.beforeEach(async ({ page }, info) => {
  if (info.project.metadata.standalone) await emulateStandalone(page, SAFE_AREA)
})

test('API key guide has readable typography, code blocks and visible AI onboarding', async ({ page }) => {
  await page.goto('/app/docs/api-keys')
  const title = page.getByRole('heading', { name: 'API keys', exact: true })
  await expect(title).toBeVisible()
  expect(await title.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(30)
  const section = page.getByRole('heading', { name: /Authentication/ })
  expect(await section.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(20)
  await expect(page.getByRole('link', { name: /Connect an AI assistant/ }).first()).toBeVisible()
  expect(await page.locator('pre').first().evaluate(el => parseFloat(getComputedStyle(el).paddingTop))).toBeGreaterThanOrEqual(12)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('docs search finds setup guides and keeps direct-origin navigation working', async ({ page }) => {
  await page.goto('/app/docs')
  await page.getByRole('button', { name: /Search/ }).first().click()
  await page.getByRole('combobox', { name: 'Search' }).fill('Claude')
  await page.getByRole('option', { name: /Claude/ }).first().click()
  await expect(page).toHaveURL(/\/app\/docs\/agents\/claude/)
  await expect(page.getByRole('heading', { name: 'Claude', exact: true })).toBeVisible()
})

test('native API explorer sends an authenticated request and displays its response', async ({ page }) => {
  await page.route('**/app/api/v1/cards?**', async route => {
    expect(route.request().headers().authorization).toBe('Bearer hf_SYNTHETIC.docs-test')
    await route.fulfill({ json: { data: [], nextCursor: null, requestId: 'synthetic-docs-check' } })
  })
  await page.goto('/app/docs/reference/catalog/list-cards')
  await expect(page.getByRole('heading', { name: 'Search cards', exact: true })).toBeVisible()
  await page.getByRole('button', { name: /Try in Playground/ }).click()
  await page.getByLabel('API key', { exact: true }).fill('hf_SYNTHETIC.docs-test')
  await page.getByRole('spinbutton', { name: 'limit', exact: true }).fill('10')
  await page.getByRole('button', { name: /Send/ }).click()
  await expect(page.getByText('synthetic-docs-check', { exact: false })).toBeVisible()
  expect(await page.evaluate(() => Object.values(localStorage).some(value => value.includes('hf_SYNTHETIC.docs-test')))).toBe(false)
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('sticky docs navigation stays below the status bar and resource groups appear once', async ({ page }, info) => {
  await page.goto('/app/docs/api-keys')
  await page.evaluate(() => window.scrollTo(0, 600))
  const search = page.getByRole('button', { name: 'Open Search', exact: true })
  await expect(search).toBeVisible()
  const bounds = await search.boundingBox()
  expect(bounds!.y).toBeGreaterThanOrEqual(info.project.metadata.standalone ? SAFE_AREA.top : 0)
  await page.getByRole('button', { name: 'Open Sidebar', exact: true }).click()
  await expect(page.locator('#nd-sidebar-mobile').getByRole('button', { name: 'Catalog', exact: true })).toHaveCount(1)
  const drawer = await page.locator('#nd-sidebar-mobile').boundingBox()
  expect(drawer!.y).toBeGreaterThanOrEqual(info.project.metadata.standalone ? SAFE_AREA.top : 0)
  expect(drawer!.y + drawer!.height).toBeLessThanOrEqual(page.viewportSize()!.height - (info.project.metadata.standalone ? SAFE_AREA.bottom : 0))
})
