import { test, expect } from '@playwright/test'

test.use({ viewport: { width: 1440, height: 1000 }, isMobile: false, hasTouch: false })

test('desktop docs reserve a left sidebar and load the full Fumadocs typography', async ({ page }) => {
  await page.goto('/app/docs')
  const sidebar = page.locator('#nd-sidebar')
  const article = page.locator('#nd-page')
  await expect(sidebar).toBeVisible()
  const nav = await sidebar.boundingBox()
  const content = await article.boundingBox()
  expect(nav!.x).toBeLessThan(50)
  expect(content!.x).toBeGreaterThanOrEqual(nav!.x + nav!.width - 1)
  const heading = page.getByRole('heading', { name: /Choose your connection/ })
  expect(await heading.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(20)
  expect(await page.locator('th').first().evaluate(el => parseFloat(getComputedStyle(el).paddingLeft))).toBeGreaterThanOrEqual(8)
  await expect(page.locator('.docs-brand img').first()).toHaveAttribute('src', /^\/app\/holofolder-mark\.png(?:\?|$)/)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
