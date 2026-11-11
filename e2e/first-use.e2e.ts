import { test, expect, SUPABASE_URL } from './fixtures';

test('email explains account creation and keeps password signup available', async ({ harness }) => {
  const { page } = harness;
  await page.goto('/app/auth/login');
  await expect(page.getByRole('heading', { name: 'Start your binder' })).toBeVisible();
  await expect(
    page.getByText('New here? We’ll create your account. Already collecting? We’ll sign you in.'),
  ).toBeVisible();
  const email = page.getByRole('textbox', { name: 'Email address' });
  // Synthetic account; no email is sent.
  let signupAllowed = false;
  await page.route(`${SUPABASE_URL}/auth/v1/otp**`, (route) => {
    signupAllowed = route.request().postDataJSON().create_user === true;
    return route.fulfill({ json: {} });
  });
  await email.fill('synthetic-collector@example.test');
  const submit = page.getByRole('button', { name: 'Continue with email' });
  await harness.expectMinTapTarget(submit);
  await harness.expectNoHorizontalOverflow();
  await submit.click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  expect(signupAllowed).toBe(true);
  await page.getByRole('button', { name: 'Use a different email' }).click();
  await page.getByRole('button', { name: 'Password', exact: true }).click();
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByPlaceholder('Confirm password')).toBeVisible();
});

test.describe('signed-in first use', () => {
  test.use({ signedIn: true });

  test('empty binder prioritizes adding a card and keeps Show mode in More', async ({ harness }) => {
    const { page } = harness;
    await page.route(`${SUPABASE_URL}/rest/v1/pokemon_collection**`, (route) => route.fulfill({ json: [] }));
    await page.goto('/app/e2e-harness?signedIn=1&binders=3&binder=e2e00000-0000-4000-8000-000000000004');
    await expect(page.getByText('Tap a pocket to add your first card')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Binder value' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'At a card show?' })).toHaveCount(0);
    const pocket = page.getByRole('button', { name: 'A1 Bulbasaur #0001', exact: true });
    await harness.expectWithinSafeViewport(pocket);
    await harness.expectMinTapTarget(pocket);
    await expect(pocket.getByText('A1', { exact: true })).toBeHidden();
    await expect(page.getByTestId('app-header').getByRole('button', { name: 'Show mode', exact: true })).toHaveCount(0);
    await harness.expectNoHorizontalOverflow();
    const binderTab = harness.dock().getByRole('button', { name: 'Binder', exact: true });
    await expect(binderTab).toBeVisible();
    await harness.expectWithinSafeViewport(binderTab);
    await harness.expectHittable(binderTab);
    await page.screenshot({ path: `/tmp/holofolder-first-use-${test.info().project.name}.png` });
    await pocket.click();
    await expect(harness.dialogs().first()).toBeVisible();
    await page.getByRole('button', { name: 'Close card details', exact: true }).click();
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Show mode', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Show mode' })).toBeVisible();
  });
});
