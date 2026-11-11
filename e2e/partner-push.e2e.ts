import { test, expect, E2E_USER, SUPABASE_URL } from './fixtures'

const partnership = { id: '00000000-0000-4000-8000-000000000010', owner_user_id: E2E_USER.id, user1_id: E2E_USER.id, user2_id: '00000000-0000-4000-8000-000000000011' }

test.describe('partner acquisition intent', () => {
  test.use({ signedIn: true })
  test('device controls explain opt-in and let you revoke a registered device without prompting', async ({ harness }) => {
    const { page } = harness
    let deleted = ''
    await page.route('**/app/api/push/subscriptions', async route => {
      if (route.request().method() === 'DELETE') {
        deleted = route.request().postDataJSON().id
        return route.fulfill({ status: 204, body: '' })
      }
      return route.fulfill({ json: { configured: true, devices: deleted ? [] : [{ id: partnership.id, endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic', label: 'Other phone' }] } })
    })
    await page.getByRole('button', { name: 'More', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Settings', exact: true }).click()
    const settings = page.getByRole('dialog', { name: 'Settings' })
    await settings.getByRole('button', { name: 'Account', exact: true }).click()
    const controls = settings.getByRole('region', { name: 'Notifications' })
    await expect(controls).toContainText('Get an alert when your price checks finish')
    await expect(controls).toContainText('marks a wanted card Got.')
    await expect(controls).toContainText('Enable this separately on each device.')
    await expect(controls.getByText('Other phone', { exact: true })).toBeVisible()
    const remove = controls.getByRole('button', { name: 'Remove Other phone' })
    await remove.scrollIntoViewIfNeeded()
    await harness.expectMinTapTarget(remove, 36)
    await remove.click()
    await expect.poll(() => deleted).toBe(partnership.id)
    await expect(controls.getByText('Other phone', { exact: true })).toHaveCount(0)
    await harness.expectNoHorizontalOverflow()
  })
})

test.describe('notification permission', () => {
  test.use({ signedIn: true })
  test('requests permission only on a tap, explains denial, then enrolls the granted device', async ({ harness }) => {
    const { page } = harness
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'userAgent', { value: 'Synthetic desktop notification browser' })
      let permission = 'denied'
      let requests = 0
      let subscribed = false
      const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic', unsubscribe: async () => { subscribed = false; return true }, toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic', keys: { p256dh: 'synthetic', auth: 'synthetic' } }) }
      Object.defineProperty(Notification, 'requestPermission', { value: async () => { requests++; return permission } })
      Object.defineProperty(navigator.serviceWorker, 'getRegistration', { value: async (scope: string) => { if (scope !== '/app') throw new Error('Wrong worker scope'); return ({ active: {}, pushManager: { getSubscription: async () => subscribed ? subscription : null, subscribe: async () => { subscribed = true; return subscription } } }) } })
      Object.assign(window, { pushTest: { requests: () => requests, grant: () => { permission = 'granted' } } })
    })
    let enrolled = false
    let testsSent = 0
    let rejectTest = false
    await page.route('**/app/api/push/test', async route => {
      expect(enrolled).toBe(true)
      expect(route.request().postDataJSON()).toEqual({ id: partnership.id })
      const binding = await page.evaluate(() => new Promise<string | undefined>((resolve, reject) => {
        const request = indexedDB.open('binderdex-offline', 1)
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result
          const read = db.transaction('records').objectStore('records').get('push:account')
          read.onsuccess = () => { resolve(read.result?.userId); db.close() }
        }
      }))
      expect(binding).toBe(E2E_USER.id)
      testsSent++
      return route.fulfill({ status: rejectTest ? 502 : 200, json: rejectTest ? { error: 'Test notification could not be sent. Your device is still registered; try again.' } : { sent: true } })
    })
    await page.route('**/app/api/push/subscriptions', async route => {
      if (route.request().method() === 'POST') { enrolled = true; return route.fulfill({ json: { id: partnership.id } }) }
      if (route.request().method() === 'DELETE') return route.fulfill({ status: 204, body: '' })
      return route.fulfill({ json: { configured: true, devices: enrolled ? [{ id: partnership.id, endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic', label: 'This device' }] : [] } })
    })
    await page.reload()
    await page.getByRole('button', { name: 'More', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Settings', exact: true }).click()
    const settings = page.getByRole('dialog', { name: 'Settings' })
    await settings.getByRole('button', { name: 'Account', exact: true }).click()
    const controls = settings.getByRole('region', { name: 'Notifications' })
    const enable = controls.getByRole('button', { name: 'Enable on this device' })
    await expect(enable).toBeVisible()
    const requests = () => page.evaluate(() => (window as unknown as { pushTest: { requests(): number } }).pushTest.requests())
    expect(await requests()).toBe(0)
    expect(testsSent).toBe(0)
    await enable.click()
    await expect(controls.getByRole('status')).toContainText('Notifications are blocked')
    expect(await requests()).toBe(1)
    expect(enrolled).toBe(false)
    expect(testsSent).toBe(0)
    await page.evaluate(() => (window as unknown as { pushTest: { grant(): void } }).pushTest.grant())
    await enable.click()
    await expect.poll(() => enrolled).toBe(true)
    await expect(controls.getByRole('status')).toContainText('Test notification sent')
    expect(testsSent).toBe(1)
    expect(await requests()).toBe(2)
    const retry = controls.getByRole('button', { name: 'Send test notification' })
    await harness.expectMinTapTarget(retry, 36)
    rejectTest = true
    await retry.click()
    await expect(controls.getByRole('status')).toContainText('Test notification could not be sent')
    await expect(retry).toBeEnabled()
    expect(testsSent).toBe(2)
    rejectTest = false
    await retry.click()
    await expect(controls.getByRole('status')).toContainText('Test notification sent')
    expect(testsSent).toBe(3)
    expect(await requests()).toBe(2)
    await harness.expectNoHorizontalOverflow()
  })
})

test.describe('installed Show mode notification prompt', () => {
  test.use({ signedIn: true })
  test('offers setup without requesting permission and opens the Account controls', async ({ harness }, testInfo) => {
    test.skip(!testInfo.project.metadata.standalone, 'Contextual prompt is for installed apps.')
    const { page } = harness
    await page.addInitScript(() => { Object.defineProperty(Notification, 'permission', { get: () => 'default' }) })
    await page.route(`${SUPABASE_URL}/rest/v1/partnerships**`, route => route.fulfill({ json: partnership }))
    await page.route('**/app/api/push/subscriptions', route => route.fulfill({ json: { configured: true, devices: [] } }))
    await page.reload()
    await expect.poll(() => page.evaluate(id => localStorage.getItem(`binderdex:push-membership:v1:${id}`), E2E_USER.id)).toContain(partnership.id)
    await page.getByRole('button', { name: 'Show mode', exact: true }).click()
    const prompt = page.getByRole('region', { name: 'Partner updates at the show' })
    await expect(prompt).toBeVisible()
    await harness.expectMinTapTarget(prompt.getByRole('button', { name: 'Set up' }), 36)
    await prompt.getByRole('button', { name: 'Set up' }).click()
    const settings = page.getByRole('dialog', { name: 'Settings' })
    await expect(settings.getByRole('button', { name: 'Account', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(settings.getByRole('region', { name: 'Notifications' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(prompt).toHaveCount(0)
    await harness.expectNoHorizontalOverflow()
  })
})

test('opening a read-only binder preserves this device’s signed-in notification binding', async ({ harness }) => {
  const { page } = harness
  await page.evaluate(async userId => {
    const request = indexedDB.open('binderdex-offline', 1)
    await new Promise<void>((resolve, reject) => {
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('records')) request.result.createObjectStore('records') }
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const transaction = db.transaction('records', 'readwrite')
        transaction.objectStore('records').put({ userId }, 'push:account')
        transaction.oncomplete = () => { db.close(); resolve() }
      }
    })
  }, E2E_USER.id)
  await page.goto('/app/e2e-harness?readOnly=1')
  await expect(page.getByText('Shared binder', { exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => new Promise<string | undefined>((resolve, reject) => {
    const request = indexedDB.open('binderdex-offline', 1)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      const read = db.transaction('records').objectStore('records').get('push:account')
      read.onsuccess = () => { resolve(read.result?.userId); db.close() }
    }
  }))).toBe(E2E_USER.id)
})
