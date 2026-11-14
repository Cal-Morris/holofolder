import { test, expect, emulateStandalone, Harness } from './fixtures';

test.beforeEach(async ({ page, standalone, insets }) => {
  if (standalone) await emulateStandalone(page, insets);
});

// /app/auth/login is a static server page with a client form island, so the form is in the HTML.
test('the sign-in form is in the prerendered HTML', async ({ request }) => {
  const response = await request.get('/app/auth/login');
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html).toContain('Start your binder');
  expect(html).toContain('Continue with email');
});

test('the sign-in form switches between magic link and password', async ({ page }) => {
  await page.goto('/app/auth/login');
  await expect(page.getByRole('heading', { name: 'Start your binder' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with email' })).toBeVisible();
  await page.getByRole('button', { name: 'Use a password instead' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByPlaceholder('Confirm password')).toBeVisible();
  await page.getByRole('button', { name: 'Email me a sign-in link instead' }).click();
  await expect(page.getByRole('button', { name: 'Continue with email' })).toBeVisible();
});

test('a recovery link without a recovery session explains that the link has expired', async ({ page }) => {
  // The test server has no Supabase session, so the recovery check fails.
  await page.goto('/app/auth/login?mode=recovery');
  await expect(page.getByRole('heading', { name: 'Set a new password' })).toBeVisible();
  await expect(page.getByText(/invalid or has expired|Could not reach/)).toBeVisible();
});

test('the branded sign-in controls fit safely in both device themes', { tag: '@matrix' }, async ({ page, insets }) => {
  const layout = new Harness(page, insets);
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await page.goto('/app/auth/login');
    await expect(page.getByRole('link', { name: 'Holo Folder', exact: true })).toBeVisible();
    await expect
      .poll(() =>
        page
          .getByRole('link', { name: 'Holo Folder', exact: true })
          .locator('img')
          .evaluate((image: HTMLImageElement) => image.naturalWidth),
      )
      .toBeGreaterThan(0);
    await expect(page.getByRole('main')).toHaveCSS('background-color', 'rgb(7, 7, 10)');
    const submit = page.getByRole('button', { name: 'Continue with email' });
    await expect(submit).toHaveClass(/holo-action/);
    await layout.expectWithinSafeViewport(submit);
    await layout.expectMinTapTarget(submit, 48);
    await layout.expectNoHorizontalOverflow();

    await page.getByRole('button', { name: 'Use a password instead' }).click();
    await expect(page.getByRole('textbox', { name: 'Email address' })).toBeVisible();
    await layout.expectMinTapTarget(page.getByRole('button', { name: 'Forgot password?' }));
    await layout.expectMinTapTarget(page.getByRole('button', { name: 'Create account', exact: true }));
    await layout.expectNoHorizontalOverflow();
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(page.getByLabel('Confirm password', { exact: true })).toBeVisible();
    await layout.expectMinTapTarget(page.getByRole('button', { name: 'Create account', exact: true }), 48);
    await layout.expectNoHorizontalOverflow();
  }
});
