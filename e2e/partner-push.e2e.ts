import { test, expect, E2E_USER, SUPABASE_URL } from './fixtures'

const partnership = { id: '00000000-0000-4000-8000-000000000010', owner_user_id: E2E_USER.id, user1_id: E2E_USER.id, user2_id: '00000000-0000-4000-8000-000000000011' }

test.describe('partner acquisition intent', () => {
  test.use({ signedIn: true })
  test('Show mode Bought queues the original partner identity offline and sends it once on reconnect', async ({ harness }) => {
    const { page } = harness
    await page.route(`${SUPABASE_URL}/rest/v1/partnerships**`, route => route.fulfill({ json: partnership }))
    const writes: Record<string, unknown>[] = []
    await page.route('**/api/collection', async route => {
      const body = route.request().postDataJSON()
      writes.push(body)
      await route.fulfill({ json: { item: { user_id: E2E_USER.id, pokemon_id: body.pokemonId, pokemon_name: body.pokemonName, card_id: body.cardId, card_name: body.cardName, status: body.status, wanted_cards: body.wantedCards, card_language: body.cardLanguage, card_finish: body.cardFinish } } })
    })
    await page.route('**/api/push/recover', route => route.fulfill({ json: { started: 0 } }))
    await page.reload()
    await expect.poll(() => page.evaluate(id => localStorage.getItem(`binderdex:push-membership:v1:${id}`), E2E_USER.id)).toContain(partnership.id)
    await page.getByRole('button', { name: 'Show mode', exact: true }).click()
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    const quick = page.getByRole('dialog', { name: 'Quick mode' })
    await quick.getByRole('searchbox').fill('charizard')
    await quick.getByRole('region', { name: 'Cards' }).getByRole('button', { name: /^Charizard ex, 151 / }).first().click()
    const check = quick.getByTestId('quick-card-check')
    await expect(check).toBeVisible()
    await page.context().setOffline(true)
    await check.getByRole('textbox', { name: 'Asking price' }).fill('8')
    await check.getByRole('button', { name: 'Bought', exact: true }).click()
    await expect(check.getByTestId('quick-card-status')).toHaveText('Owned')
    const pending = () => page.evaluate(() => JSON.parse(localStorage.getItem('pokemon_collection_pending_ops_v1') ?? '[]'))
    await expect.poll(async () => (await pending())[0]?.acquisition?.partnershipId).toBe(partnership.id)
    const intent = (await pending())[0].acquisition
    expect(intent).toMatchObject({ actorId: E2E_USER.id, recipientId: partnership.user2_id, printingKey: 'sv03.5-006:en:double_rare' })
    expect(writes).toHaveLength(0)
    await page.context().setOffline(false)
    await expect.poll(() => writes.length).toBe(1)
    expect(writes[0].acquisition).toEqual(intent)
    await expect.poll(async () => (await pending()).length).toBe(0)
    await harness.expectNoHorizontalOverflow()
  })

  test('device controls explain opt-in and let you revoke a registered device without prompting', async ({ harness }) => {
    const { page } = harness
    let deleted = ''
    await page.route('**/api/push/subscriptions', async route => {
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
    const controls = settings.getByRole('region', { name: 'Partner notifications' })
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
      const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic', unsubscribe: async () => true, toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic', keys: { p256dh: 'synthetic', auth: 'synthetic' } }) }
      Object.defineProperty(Notification, 'requestPermission', { value: async () => { requests++; return permission } })
      Object.defineProperty(navigator.serviceWorker, 'getRegistration', { value: async () => ({ active: {}, pushManager: { getSubscription: async () => null, subscribe: async () => subscription } }) })
      Object.assign(window, { pushTest: { requests: () => requests, grant: () => { permission = 'granted' } } })
    })
    let enrolled = false
    await page.route('**/api/push/subscriptions', async route => {
      if (route.request().method() === 'POST') { enrolled = true; return route.fulfill({ json: { id: partnership.id } }) }
      if (route.request().method() === 'DELETE') return route.fulfill({ status: 204, body: '' })
      return route.fulfill({ json: { configured: true, devices: [] } })
    })
    await page.reload()
    await page.getByRole('button', { name: 'More', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Settings', exact: true }).click()
    const settings = page.getByRole('dialog', { name: 'Settings' })
    await settings.getByRole('button', { name: 'Account', exact: true }).click()
    const controls = settings.getByRole('region', { name: 'Partner notifications' })
    const enable = controls.getByRole('button', { name: 'Enable on this device' })
    await expect(enable).toBeVisible()
    const requests = () => page.evaluate(() => (window as unknown as { pushTest: { requests(): number } }).pushTest.requests())
    expect(await requests()).toBe(0)
    await enable.click()
    await expect(controls.getByRole('status')).toContainText('Notifications are blocked')
    expect(await requests()).toBe(1)
    expect(enrolled).toBe(false)
    await page.evaluate(() => (window as unknown as { pushTest: { grant(): void } }).pushTest.grant())
    await enable.click()
    await expect.poll(() => enrolled).toBe(true)
    await expect(controls.getByRole('status')).toContainText('This device will hear')
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
    await page.route('**/api/push/subscriptions', route => route.fulfill({ json: { configured: true, devices: [] } }))
    await page.reload()
    await expect.poll(() => page.evaluate(id => localStorage.getItem(`binderdex:push-membership:v1:${id}`), E2E_USER.id)).toContain(partnership.id)
    await page.getByRole('button', { name: 'Show mode', exact: true }).click()
    const prompt = page.getByRole('region', { name: 'Partner updates at the show' })
    await expect(prompt).toBeVisible()
    await harness.expectMinTapTarget(prompt.getByRole('button', { name: 'Set up' }), 36)
    await prompt.getByRole('button', { name: 'Set up' }).click()
    const settings = page.getByRole('dialog', { name: 'Settings' })
    await expect(settings.getByRole('button', { name: 'Account', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(settings.getByRole('region', { name: 'Partner notifications' })).toBeVisible()
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
  await page.goto('/e2e-harness?readOnly=1')
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
