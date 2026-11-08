import { test, expect, E2E_USER } from './fixtures'

test.use({ signedIn: true })

test('signup trial shows its terms and expires offline without losing the collection', async ({ harness }) => {
  const { page } = harness
  // Synthetic account entitlement, no payment provider or real database requests.
  const trialEndsAt = new Date(Date.now() + 60_000).toISOString()
  await page.route('**/app/api/billing', route => route.fulfill({ json: {
    access: { ownerUserId: E2E_USER.id, tier: 'paid', source: 'trial', trialEndsAt, paidThrough: null, savedCardCount: 2, cardLimit: null, freeCardLimit: 100, freeBinderLimit: 1, enforced: true },
    canManage: true, hasBillingAccount: false,
  } }))
  await page.evaluate(() => window.dispatchEvent(new Event('holofolder-refresh-billing')))
  await page.getByTestId('app-header').getByRole('button', { name: 'More', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Settings' }).click()
  const dialog = page.getByRole('dialog', { name: /settings/i })
  await dialog.getByRole('button', { name: 'Account', exact: true }).click()
  const plan = dialog.getByRole('region', { name: 'Holo Folder plan' })
  await expect(plan.getByRole('heading', { name: '7-day Premium trial' })).toBeVisible()
  await expect(plan).toContainText('No payment details needed')
  await expect(plan).toContainText("you won't be charged automatically")
  await expect(plan.getByRole('button', { name: 'Manage billing', exact: true })).toHaveCount(0)
  const monthly = plan.getByRole('button', { name: '£3.99 / month', exact: true })
  await monthly.scrollIntoViewIfNeeded()
  await harness.expectMinTapTarget(monthly)
  await harness.expectWithinSafeViewport(monthly)
  await harness.expectHittable(monthly)
  await harness.expectNoHorizontalOverflow()

  await page.context().setOffline(true)
  await page.clock.setSystemTime(new Date(Date.parse(trialEndsAt) + 1))
  await page.evaluate(() => window.dispatchEvent(new Event('holofolder-refresh-billing')))
  await expect(plan.getByRole('heading', { name: 'Unlock Holo Folder' })).toBeVisible()
  await expect(plan).toContainText('2 of 100 free entries saved')
  await harness.expectNoHorizontalOverflow()
})
