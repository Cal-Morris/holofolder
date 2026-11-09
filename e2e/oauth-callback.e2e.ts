import type { Page } from '@playwright/test'
import { test, expect, emulateStandalone } from './fixtures'

// Synthetic OAuth responses, no live accounts or authorization codes.
const callback = `http://localhost:1455/auth/callback?code=synthetic-${'x'.repeat(500)}&state=synthetic%2Bstate%2Fvalue`
const consentPath = '/app/oauth/consent?authorization_id=synthetic'

async function mockConsent(page: Page, redirectUri = 'http://localhost:1455/auth/callback') {
 await page.route('**/app/api/oauth/authorization?**', route => route.fulfill({ json: {
  client: { id: 'synthetic-client', name: 'Synthetic remote client' }, redirectUri, scope: 'email', eligible: true,
 } }))
}

test.beforeEach(async ({ page, standalone, insets }) => {
 if (standalone) await emulateStandalone(page, insets)
})

test('remote approval retains the exact callback and copies it without navigating', async ({ page, insets }) => {
 await page.emulateMedia({ colorScheme: 'light' })
 await mockConsent(page)
 await page.addInitScript(() => {
  let copied = ''
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
   writeText: async (value: string) => { copied = value }, readText: async () => copied,
  } })
 })
 let decisionCount = 0
 await page.route('**/app/api/oauth/decision', async route => {
  decisionCount++
  const body = route.request().postDataJSON()
  expect(body.decision).toBe('approve')
  expect(body.permissions.every((permission: string) => permission.endsWith(':read'))).toBe(true)
  await route.fulfill({ json: { redirectUrl: callback } })
 })
 await page.goto(consentPath)
 await page.getByRole('checkbox', { name: 'My client is on another machine' }).check()
 await page.getByRole('button', { name: 'Approve access' }).click()
 await expect(page.getByRole('textbox', { name: 'Callback URL' })).toHaveValue(callback)
 await expect(page.getByRole('button', { name: 'Approve access' })).toHaveCount(0)
 await page.getByRole('button', { name: 'Copy callback URL' }).click()
 await expect(page.getByRole('status')).toHaveText('Callback URL copied. Return to your agent to finish.')
 expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(callback)
 await expect(page).toHaveURL(new RegExp(`${consentPath.replace('?', '\\?')}$`))
 expect(decisionCount).toBe(1)
 await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
 for (const name of ['Copied callback URL', 'Open on this device']) {
  const button = page.getByRole('button', { name })
  await button.scrollIntoViewIfNeeded()
  const box = await button.boundingBox()
  expect(box!.height).toBeGreaterThanOrEqual(36)
  expect(box!.y).toBeGreaterThanOrEqual(insets.top)
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height - insets.bottom + 1)
 }
})

test('remote denial keeps the error callback selectable when clipboard access fails', async ({ page }) => {
 await mockConsent(page, 'http://[::1]:1455/auth/callback')
 const denied = 'http://[::1]:1455/auth/callback?error=access_denied&state=synthetic-state'
 await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
  writeText: async () => { throw new Error('Synthetic clipboard denial') },
 } }))
 await page.route('**/app/api/oauth/decision', async route => {
  expect(route.request().postDataJSON().decision).toBe('deny')
  await route.fulfill({ json: { redirectUrl: denied } })
 })
 await page.goto(consentPath)
 await page.getByRole('checkbox', { name: 'My client is on another machine' }).check()
 await page.getByRole('button', { name: 'Deny', exact: true }).click()
 await page.getByRole('button', { name: 'Copy callback URL' }).click()
 await expect(page.getByRole('alert').filter({ hasText: 'Copy unavailable' })).toHaveText('Copy unavailable. Select and copy the callback URL.')
 const field = page.getByRole('textbox', { name: 'Callback URL' })
 await expect(field).toHaveValue(denied)
 await field.focus()
 expect(await field.evaluate(node => (node as HTMLTextAreaElement).selectionEnd - (node as HTMLTextAreaElement).selectionStart)).toBe(denied.length)
})

test('local approval still redirects immediately without opting into remote handoff', async ({ page }) => {
 await mockConsent(page)
 await page.route('**/app/api/oauth/decision', route => route.fulfill({ json: { redirectUrl: callback } }))
 await page.route('http://localhost:1455/**', route => route.fulfill({ contentType: 'text/html', body: 'Synthetic client received callback' }))
 await page.goto(consentPath)
 await expect(page.getByRole('checkbox', { name: 'My client is on another machine' })).not.toBeChecked()
 await page.getByRole('button', { name: 'Approve access' }).click()
 await expect(page).toHaveURL(callback)
})

test('already-approved loopback callback offers local completion or remote handoff', async ({ page }) => {
 await page.route('**/app/api/oauth/authorization?**', route => route.fulfill({ json: { redirectUrl: callback } }))
 await page.route('http://localhost:1455/**', route => route.fulfill({ contentType: 'text/html', body: 'Synthetic client received callback' }))
 await page.goto(consentPath)
 await expect(page.getByRole('textbox', { name: 'Callback URL' })).toHaveValue(callback)
 await page.getByRole('button', { name: 'Open on this device' }).click()
 await expect(page).toHaveURL(callback)
})

test('HTTPS callbacks continue without loopback controls', async ({ page }) => {
 const hosted = 'https://synthetic-client.example/callback?code=synthetic&state=synthetic'
 await mockConsent(page, hosted)
 await page.route('**/app/api/oauth/decision', route => route.fulfill({ json: { redirectUrl: hosted } }))
 await page.route('https://synthetic-client.example/**', route => route.fulfill({ contentType: 'text/html', body: 'Synthetic hosted client' }))
 await page.goto(consentPath)
 await expect(page.getByRole('button', { name: 'Approve access' })).toBeEnabled()
 await expect(page.getByRole('checkbox', { name: 'My client is on another machine' })).toHaveCount(0)
 await page.getByRole('button', { name: 'Approve access' }).click()
 await expect(page).toHaveURL(hosted)
})
