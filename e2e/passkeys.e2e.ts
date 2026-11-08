import { generateKeyPairSync } from 'node:crypto'
import { test, expect, SUPABASE_URL, E2E_USER } from './fixtures'

test.describe('passkeys', () => {
  test.use({ signedIn: true })
  test('registers a passkey, lists it and removes it without overflowing on phones', async ({ harness }) => {
    const { page } = harness
    // Synthetic WebAuthn challenge and server responses, no real account writes.
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('WebAuthn.enable')
    await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } })
    let registered = false
    let verified = false
    await page.route(`${SUPABASE_URL}/auth/v1/passkeys**`, async route => {
      const path = new URL(route.request().url()).pathname
      if (path.endsWith('/registration/options')) return route.fulfill({ json: { challenge_id: 'synthetic-challenge', options: {
        challenge: 'c3ludGhldGljLWNoYWxsZW5nZQ', rp: { id: 'localhost', name: 'Synthetic Holo Folder' },
        user: { id: 'c3ludGhldGljLXVzZXI', name: 'synthetic@example.test', displayName: 'Synthetic collector' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }], authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      } } })
      if (path.endsWith('/registration/verify')) {
        const body = route.request().postDataJSON()
        expect(body.challenge_id).toBe('synthetic-challenge')
        expect(body.credential.response.attestationObject).toBeTruthy()
        verified = true
        registered = true
        return route.fulfill({ json: { id: 'synthetic-passkey', created_at: '2026-11-08T12:00:00Z' } })
      }
      if (route.request().method() === 'DELETE') { registered = false; return route.fulfill({ status: 204 }) }
      return route.fulfill({ json: registered ? [{ id: 'synthetic-passkey', friendly_name: 'Aleksandra’s iCloud Keychain passkey', created_at: '2026-11-08T12:00:00Z' }] : [] })
    })
    await page.getByRole('button', { name: 'More', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Settings', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await dialog.getByRole('button', { name: 'Account', exact: true }).click()
    const section = dialog.getByRole('region', { name: 'Passkeys', exact: true })
    const add = section.getByRole('button', { name: 'Add a passkey', exact: true })
    await add.scrollIntoViewIfNeeded()
    await harness.expectMinTapTarget(add)
    await add.click()
    await expect(section.getByText('Passkey added.')).toBeVisible()
    expect(verified).toBe(true)
    await expect(section.getByText('Aleksandra’s iCloud Keychain passkey')).toBeVisible()
    const remove = section.getByRole('button', { name: 'Remove Aleksandra’s iCloud Keychain passkey' })
    await remove.scrollIntoViewIfNeeded()
    await harness.expectMinTapTarget(remove)
    await remove.click()
    await section.getByRole('button', { name: 'Confirm removal' }).click()
    await expect(section.getByText('Passkey removed.')).toBeVisible()
    await harness.expectNoHorizontalOverflow()
    await page.context().setOffline(true)
    await expect(add).toBeDisabled()
    await page.context().setOffline(false)
  })
})

test('cancelled passkey sign-in leaves email and password available', async ({ harness }) => {
  const { page } = harness
  await page.evaluate(() => {
    Object.defineProperty(navigator.credentials, 'get', { configurable: true, value: () => Promise.reject(new DOMException('Synthetic cancellation', 'NotAllowedError')) })
  })
  await page.route(`${SUPABASE_URL}/auth/v1/passkeys/authentication/options`, route => route.fulfill({ json: { challenge_id: 'synthetic-challenge', options: { challenge: 'c3ludGhldGljLWNoYWxsZW5nZQ', rpId: 'localhost', userVerification: 'required' } } }))
  await page.getByRole('button', { name: 'More', exact: true }).click()
  await page.getByRole('menuitem', { name: /Sign in/ }).click()
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Welcome', exact: true }) })
  const signIn = dialog.getByRole('button', { name: 'Sign in with a passkey' })
  await harness.expectMinTapTarget(signIn)
  await signIn.click()
  await expect(dialog.getByRole('status')).toContainText('Passkey sign-in was cancelled')
  await expect(signIn).toBeEnabled()
  await expect(dialog.getByRole('button', { name: 'Password', exact: true })).toBeVisible()
  await harness.expectNoHorizontalOverflow()
})


test('signs in with a virtual passkey and persists the Supabase session', async ({ harness }) => {
  const { page } = harness
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } })
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  await cdp.send('WebAuthn.addCredential', { authenticatorId, credential: { credentialId: Buffer.from('synthetic-credential').toString('base64'), isResidentCredential: true, rpId: 'localhost', privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'), userHandle: Buffer.from('synthetic-user').toString('base64'), signCount: 0 } })
  await page.route(`${SUPABASE_URL}/auth/v1/passkeys/authentication/options`, route => route.fulfill({ json: { challenge_id: 'synthetic-challenge', options: { challenge: 'c3ludGhldGljLWNoYWxsZW5nZQ', rpId: 'localhost', userVerification: 'required' } } }))
  let verified = false
  await page.route(`${SUPABASE_URL}/auth/v1/passkeys/authentication/verify`, async route => {
    const body = route.request().postDataJSON()
    expect(body.challenge_id).toBe('synthetic-challenge')
    expect(body.credential.response.signature).toBeTruthy()
    verified = true
    const token = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({ sub: E2E_USER.id, aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url'), 'synthetic'].join('.')
    await route.fulfill({ json: { access_token: token, refresh_token: 'synthetic-refresh', token_type: 'bearer', expires_in: 3600, user: E2E_USER } })
  })
  await page.goto('/app/auth/login')
  const button = page.getByRole('button', { name: 'Sign in with a passkey' })
  await harness.expectMinTapTarget(button)
  await button.click()
  await expect.poll(() => verified).toBe(true)
  await expect.poll(async () => (await page.context().cookies()).some(cookie => cookie.name.includes('auth-token'))).toBe(true)
})
