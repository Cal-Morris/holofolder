import { test, expect } from '@playwright/test';
import { emulateStandalone, SAFE_AREA } from './fixtures';

test.beforeEach(async ({ page }, info) => {
  if (info.project.metadata.standalone) await emulateStandalone(page, SAFE_AREA);
});

test('signed-in developers create a key in the docs using the existing permissions and expiry flow', async ({
  page,
}) => {
  // Synthetic credential and account metadata only; no real keys are created.
  const id = '00000000-0000-4000-8000-000000000077';
  const key = `hf_${id}.${'s'.repeat(43)}`;
  let exists = false,
    creates = 0;
  await page.route('**/app/api/developer/keys', async (route) => {
    if (route.request().method() === 'POST') {
      const input = route.request().postDataJSON();
      expect(input.name).toBe('Docs export');
      expect(input.expiryDays).toBe(30);
      expect(input.permissions.every((permission: string) => permission.endsWith(':read'))).toBe(true);
      creates++;
      exists = true;
      await route.fulfill({ status: 201, json: { key } });
      return;
    }
    if (route.request().method() === 'DELETE') {
      exists = false;
      await route.fulfill({ json: { revoked: true } });
      return;
    }
    await route.fulfill({
      json: {
        canCreate: true,
        keys: exists
          ? [
              {
                id,
                name: 'Docs export',
                permissions: ['catalog:read'],
                created_at: '2026-11-08T00:00:00Z',
                expires_at: '2026-12-08T00:00:00Z',
              },
            ]
          : [],
      },
    });
  });
  await page.goto('/app/docs/api-keys');
  const manager = page.getByRole('region', { name: 'API key management' });
  await manager.getByRole('textbox', { name: 'Key name' }).fill('Docs export');
  await manager.getByRole('combobox', { name: 'Expires after' }).selectOption('30');
  await manager.getByRole('button', { name: 'Create API key', exact: true }).click();
  await expect(manager.getByLabel('New API key')).toHaveText(key);
  await expect(manager.getByRole('button', { name: 'Create API key', exact: true })).toBeDisabled();
  expect(
    await page.evaluate(
      (secret) =>
        [...Object.values(localStorage), ...Object.values(sessionStorage)].some((value) => value.includes(secret)),
      key,
    ),
  ).toBe(false);
  expect(await (await page.request.get('/app/docs/api-keys')).text()).not.toContain(key);
  await manager.getByRole('button', { name: 'Hide key', exact: true }).click();
  await expect(manager.getByLabel('New API key')).toHaveCount(0);
  await page.reload();
  await expect(manager.getByRole('button', { name: 'Revoke Docs export' })).toBeVisible();
  await expect(manager.getByLabel('New API key')).toHaveCount(0);
  await manager.getByRole('button', { name: 'Revoke Docs export' }).click();
  await expect(manager.getByRole('button', { name: 'Revoke Docs export' })).toHaveCount(0);
  expect(creates).toBe(1);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('signed-out readers can sign in from the docs without loading the binder', async ({ page }, info) => {
  await page.route('**/app/api/developer/keys', (route) =>
    route.fulfill({ status: 401, json: { error: { message: 'Sign in to manage developer access.' } } }),
  );
  await page.goto('/app/docs/api-keys');
  const manager = page.getByRole('region', { name: 'API key management' });
  await manager.getByRole('button', { name: 'Sign in to create a key' }).click();
  const dialog = page.getByRole('dialog', { name: 'Welcome, sign in' });
  await expect(dialog).toBeVisible();
  const close = dialog.getByRole('button', { name: 'Close sign in' });
  const bounds = await close.boundingBox();
  expect(bounds!.width).toBeGreaterThanOrEqual(36);
  expect(bounds!.height).toBeGreaterThanOrEqual(36);
  expect(bounds!.y).toBeGreaterThanOrEqual(info.project.metadata.standalone ? SAFE_AREA.top : 0);
  await close.click();
  await expect(dialog).toHaveCount(0);
  await manager.getByRole('button', { name: 'Sign in to create a key' }).click();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await manager.getByRole('button', { name: 'Sign in to create a key' }).click();
  await page.goBack();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/app\/docs\/api-keys$/);
});

test('ineligible accounts keep the paid-access gate and key-limit failures remain actionable', async ({ page }) => {
  await page.route('**/app/api/developer/keys', (route) => route.fulfill({ json: { canCreate: false, keys: [] } }));
  await page.goto('/app/docs/api-keys');
  const manager = page.getByRole('region', { name: 'API key management' });
  await expect(manager.getByText(/Premium or lifetime access is required/)).toBeVisible();
  await expect(manager.getByRole('button', { name: 'Create API key', exact: true })).toHaveCount(0);
  await page.route('**/app/api/developer/keys', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ status: 409, json: { error: { message: 'Synthetic key limit: revoke an existing key.' } } })
      : route.fulfill({ json: { canCreate: true, keys: [] } }),
  );
  await page.reload();
  await manager.getByRole('textbox', { name: 'Key name' }).fill('Docs export');
  await manager.getByRole('button', { name: 'Create API key', exact: true }).click();
  await expect(manager.getByRole('alert')).toHaveText('Synthetic key limit: revoke an existing key.');
  await expect(manager.getByRole('textbox', { name: 'Key name' })).toHaveValue('Docs export');
});
