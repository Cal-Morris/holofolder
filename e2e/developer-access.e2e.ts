import { test, expect } from '@playwright/test';
import { emulateStandalone, SAFE_AREA } from './fixtures';

test('developer docs stay within the phone viewport with searchable mobile navigation', async ({ page }, info) => {
  if (info.project.metadata.standalone) await emulateStandalone(page, SAFE_AREA);
  await page.goto('/app/docs');
  await expect(page.getByRole('heading', { name: 'Build with your collection' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Open Sidebar' }).click();
  await page.getByRole('link', { name: 'AI & agents', exact: true }).first().click();
  await expect(page).toHaveURL(/\/app\/docs\/mcp$/);
  await expect(page.getByRole('heading', { name: 'AI & agents', exact: true }).first()).toBeVisible();
});
test('OAuth consent shows verified client details and keeps writes off by default', async ({ page }, info) => {
  if (info.project.metadata.standalone) await emulateStandalone(page, SAFE_AREA);
  await page.route('**/app/api/oauth/authorization?**', (route) =>
    route.fulfill({
      json: {
        client: {
          id: 'synthetic-client',
          name: 'Synthetic client with a very long name to check wrapping on mobile screens',
        },
        redirectUri: 'https://client.example.invalid/oauth/callback',
        scope: 'email',
        eligible: true,
      },
    }),
  );
  await page.goto('/app/oauth/consent?authorization_id=synthetic');
  await expect(page.getByRole('heading', { name: /Synthetic client/ })).toBeVisible();
  await expect(page.getByText('Redirects to client.example.invalid')).toBeVisible();
  const checkboxes = page.getByRole('checkbox');
  await expect(checkboxes).toHaveCount(11);
  expect(
    await checkboxes.evaluateAll((inputs) => inputs.filter((input) => (input as HTMLInputElement).checked).length),
  ).toBe(5);
  await expect(page.getByRole('button', { name: 'Approve access' })).toBeEnabled();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.route('**/app/api/oauth/decision', async (route) => {
    const body = route.request().postDataJSON();
    expect(body.decision).toBe('approve');
    expect(body.permissions.every((permission: string) => permission.endsWith(':read'))).toBe(true);
    await route.fulfill({ status: 503, json: { error: { message: 'Synthetic retry, no authorization issued.' } } });
  });
  await page.getByRole('button', { name: 'Approve access' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Synthetic retry' })).toHaveText(
    'Synthetic retry, no authorization issued.',
  );
});
test('signup trials cannot approve MCP access', async ({ page }) => {
  await page.route('**/app/api/oauth/authorization?**', (route) =>
    route.fulfill({
      json: {
        client: { id: 'synthetic-client', name: 'Synthetic trial client' },
        redirectUri: 'https://client.example.invalid/callback',
        scope: 'email',
        eligible: false,
      },
    }),
  );
  await page.goto('/app/oauth/consent?authorization_id=synthetic');
  await expect(page.getByRole('button', { name: 'Approve access' })).toBeDisabled();
  await expect(page.getByText(/Signup trials do not include it/)).toBeVisible();
});
