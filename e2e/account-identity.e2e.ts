import { test, expect, E2E_USER, SUPABASE_URL } from './fixtures'
import type { Harness } from './fixtures'

async function openAccount(harness: Harness) {
  const { page } = harness
  await page.getByRole('button', { name: 'More', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await dialog.getByRole('button', { name: 'Account', exact: true }).click()
  return dialog
}

test.describe('account identity', () => {
  test.use({ signedIn: true })
  test('saves the Supabase display name and a distinct URL username, and retains both on reopening', async ({ harness }) => {
    const { page } = harness
    // Synthetic account metadata, no real auth or database writes.
    let metadata = { ...E2E_USER.user_metadata }
    let username: string | null = null
    await page.route(`${SUPABASE_URL}/auth/v1/user**`, async route => {
      if (route.request().method() === 'PUT') metadata = { ...metadata, ...route.request().postDataJSON().data }
      await route.fulfill({ json: { ...E2E_USER, user_metadata: metadata } })
    })
    await page.route('**/app/api/account-identity', async route => {
      if (route.request().method() === 'PATCH') username = route.request().postDataJSON().username
      await route.fulfill({ json: { username } })
    })
    let dialog = await openAccount(harness)
    await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Cal Morris')
    const saveName = dialog.getByRole('button', { name: 'Save name', exact: true })
    await harness.expectMinTapTarget(saveName)
    await saveName.click()
    await expect(dialog.getByRole('status').filter({ hasText: 'Name saved.' })).toBeVisible()
    expect(metadata).toMatchObject({ display_name: 'Cal Morris', name: 'Cal Morris' })
    const usernameInput = dialog.getByRole('textbox', { name: 'Username', exact: true })
    await expect(usernameInput).toBeEnabled()
    await usernameInput.fill('CaL')
    const saveUsername = dialog.getByRole('button', { name: 'Save username', exact: true })
    await saveUsername.scrollIntoViewIfNeeded()
    await harness.expectMinTapTarget(saveUsername)
    await saveUsername.click()
    await expect(dialog.getByRole('status').filter({ hasText: 'Username saved.' })).toBeVisible()
    await expect(usernameInput).toHaveValue('cal')
    await harness.expectNoHorizontalOverflow()
    await dialog.getByRole('button', { name: 'Close settings' }).click()
    await page.reload()
    dialog = await openAccount(harness)
    await expect(dialog.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Cal Morris')
    await expect(dialog.getByRole('textbox', { name: 'Username', exact: true })).toHaveValue('cal')
  })

  test('shows invalid and taken usernames and allows retry after a failed name save', async ({ harness }) => {
    const { page } = harness
    await page.route('**/app/api/account-identity', route => route.fulfill(route.request().method() === 'PATCH' ? { status: 409, json: { error: 'That username is already taken.' } } : { json: { username: null } }))
    await page.route(`${SUPABASE_URL}/auth/v1/user**`, route => route.fulfill({ status: 500, json: { message: 'Synthetic save failure' } }))
    const dialog = await openAccount(harness)
    await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Cal')
    await dialog.getByRole('button', { name: 'Save name', exact: true }).click()
    await expect(dialog.getByRole('status').filter({ hasText: 'Could not save your name.' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Save name', exact: true })).toBeEnabled()
    const input = dialog.getByRole('textbox', { name: 'Username', exact: true })
    await expect(input).toBeEnabled()
    await input.fill('c/')
    await dialog.getByRole('button', { name: 'Save username', exact: true }).click()
    await expect(dialog.getByRole('status').filter({ hasText: 'Use 3–30 letters' })).toBeVisible()
    await input.fill('taken')
    await dialog.getByRole('button', { name: 'Save username', exact: true }).click()
    await expect(dialog.getByRole('status').filter({ hasText: 'That username is already taken.' })).toBeVisible()
    await expect(input).toHaveValue('taken')
    await harness.expectNoHorizontalOverflow()
  })

  test('keeps name editing available if the username schema is unavailable and disables saves offline', async ({ harness }) => {
    const { page } = harness
    await page.route('**/app/api/account-identity', route => route.fulfill({ status: 503, json: { error: 'Usernames are not available yet. Try again later.' } }))
    const dialog = await openAccount(harness)
    await expect(dialog.getByRole('status').filter({ hasText: 'Usernames are not available yet.' })).toBeVisible()
    await expect(dialog.getByRole('textbox', { name: 'Username', exact: true })).toBeDisabled()
    await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Cal')
    await expect(dialog.getByRole('button', { name: 'Save name', exact: true })).toBeEnabled()
    await page.context().setOffline(true)
    await expect(dialog.getByRole('button', { name: 'Save name', exact: true })).toBeDisabled()
    await expect(dialog.getByRole('status').filter({ hasText: 'Connect to the internet' })).toBeVisible()
    await page.context().setOffline(false)
  })
})
