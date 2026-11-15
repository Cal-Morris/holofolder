import { test, expect, E2E_USER, openSettingsPage } from './fixtures';

test.use({ signedIn: true });

test('@matrix signup trial shows its terms and expires offline without losing the collection', async ({
  harness,
}, info) => {
  const { page } = harness;
  // Synthetic account entitlement, no payment provider or real database requests.
  const trialEndsAt = new Date(Date.now() + 60_000).toISOString();
  await page.route('**/app/api/billing', (route) =>
    route.fulfill({
      json: {
        access: {
          ownerUserId: E2E_USER.id,
          tier: 'paid',
          source: 'trial',
          trialEndsAt,
          paidThrough: null,
          savedCardCount: 2,
          cardLimit: null,
          freeCardLimit: 100,
          freeBinderLimit: 1,
          enforced: true,
        },
        canManage: true,
        hasBillingAccount: false,
      },
    }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event('holofolder-refresh-billing')));
  // Free and trial owners get a standing Upgrade button in the header, straight to Plan & billing.
  const upgrade = page.getByTestId('header-upgrade');
  await page.getByTestId('app-header').screenshot({ path: `test-results/header/${info.project.name}.png` });
  await harness.expectMinTapTarget(upgrade);
  await harness.expectHittable(upgrade);
  await upgrade.click();
  const dialog = page.getByRole('dialog', { name: /settings/i });
  const plan = dialog.getByRole('region', { name: 'Holo Folder plan' });
  await expect(plan.getByRole('heading', { name: '7-day Premium trial' })).toBeVisible();
  await expect(plan).toContainText('No payment details needed');
  await expect(plan).toContainText("you won't be charged automatically");
  await expect(plan.getByRole('button', { name: 'Manage billing', exact: true })).toHaveCount(0);
  const monthly = plan.getByRole('button', { name: /\/ month/ });
  await monthly.scrollIntoViewIfNeeded();
  await harness.expectMinTapTarget(monthly);
  await harness.expectWithinSafeViewport(monthly);
  await harness.expectHittable(monthly);
  await harness.expectNoHorizontalOverflow();
  await plan.screenshot({ path: `test-results/plan/${info.project.name}.png` });

  await page.context().setOffline(true);
  await page.clock.setSystemTime(new Date(Date.parse(trialEndsAt) + 1));
  await page.evaluate(() => window.dispatchEvent(new Event('holofolder-refresh-billing')));
  await expect(plan.getByRole('heading', { name: 'Unlock Holo Folder' })).toBeVisible();
  await expect(plan).toContainText('2 of 100 free entries saved');
  await harness.expectNoHorizontalOverflow();
});

test('@matrix invite rewards show the granted month and the owner invite link', async ({ harness }, info) => {
  const { page } = harness;
  // Synthetic grant and invite link, no real database requests.
  const grantedUntil = new Date(Date.now() + 20 * 86_400_000).toISOString();
  await page.route('**/app/api/billing', (route) =>
    route.fulfill({
      json: {
        access: {
          ownerUserId: E2E_USER.id,
          tier: 'paid',
          source: 'grant',
          trialEndsAt: null,
          grantedUntil,
          paidThrough: null,
          savedCardCount: 12,
          cardLimit: null,
          freeCardLimit: 2_147_483_647,
          freeBinderLimit: 1,
          enforced: true,
        },
        canManage: true,
        hasBillingAccount: false,
      },
    }),
  );
  await page.route('**/app/api/referrals', (route) =>
    route.fulfill({
      json: { url: 'https://holofolder.com/app/invite/abcde23456', rewarded: 1, pending: 2, cap: 12, rewardDays: 30 },
    }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event('holofolder-refresh-billing')));
  await page.getByTestId('app-header').getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  await openSettingsPage(dialog, 'Plan & billing');
  const plan = dialog.getByRole('region', { name: 'Holo Folder plan' });
  await expect(plan.getByRole('heading', { name: 'Holo Folder Premium' })).toBeVisible();
  await expect(plan).toContainText('Free Premium from invites until');
  await expect(plan).toContainText("you won't be charged");
  const invite = dialog.getByRole('region', { name: 'Invite a friend' });
  await expect(invite).toContainText('https://holofolder.com/app/invite/abcde23456');
  await expect(invite).toContainText('1 of 12 free months earned, 2 friends yet to save 10 cards.');
  const copy = invite.getByRole('button', { name: 'Copy invite link', exact: true });
  await copy.scrollIntoViewIfNeeded();
  await harness.expectMinTapTarget(copy);
  await harness.expectWithinSafeViewport(copy);
  await harness.expectHittable(copy);
  await harness.expectNoHorizontalOverflow();
  await invite.screenshot({ path: `test-results/invite/${info.project.name}.png` });
});
