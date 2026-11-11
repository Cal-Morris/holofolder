import { test, expect, openSettingsPage, type Harness } from './fixtures';

test.use({ signedIn: true });

async function settings(harness: Harness) {
  await harness.page.getByRole('button', { name: 'More', exact: true }).click();
  await harness.page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  return harness.page.getByRole('dialog', { name: 'Settings', exact: true });
}

// Synthetic identity backends, intentionally not availability claims against real accounts.
test('owner explicitly saves account username and binder slug, then gets the saved public address', async ({
  harness,
  page,
}) => {
  let username = 'synthetic-old';
  let slug: string | null = null;
  await page.route('**/app/api/account-identity', async (route) => {
    if (route.request().method() === 'PATCH') username = route.request().postDataJSON().username;
    await route.fulfill({ json: { username, available: true } });
  });
  await page.route('**/app/api/binder-identity**', async (route) => {
    if (route.request().method() === 'PATCH') slug = route.request().postDataJSON().slug;
    await route.fulfill({ json: { username, slug, available: true, canEdit: true } });
  });
  await page.route('**/app/api/binder-share**', (route) =>
    route.fulfill({
      json: {
        share: {
          token: 'synthetic-token',
          is_enabled: true,
          path: slug ? `/@${username}/${slug}` : '/app/share/synthetic-token',
        },
      },
    }),
  );
  await page.goto('/app/e2e-harness?signedIn=1&binders=1');
  const dialog = await settings(harness);
  await openSettingsPage(dialog, 'Profile');
  const account = dialog.getByRole('region', { name: 'Your profile' });
  await expect(account.getByLabel('Username', { exact: true })).toHaveValue(username);
  await account.getByLabel('Username', { exact: true }).fill('Synthetic-New');
  await expect(account).toContainText('stop previous named links working');
  await account.getByRole('button', { name: 'Save username', exact: true }).click();
  await expect(account.getByRole('status')).toHaveText('Username saved.');
  expect(username).toBe('synthetic-new');
  await openSettingsPage(dialog, 'Sharing');
  const binder = dialog.getByRole('region', { name: 'Binder address' });
  await expect(binder.getByLabel('Binder slug')).toBeEnabled();
  await binder.getByLabel('Binder slug').fill('National');
  await binder.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(binder).toContainText('holofolder.com/@synthetic-new/national');
  await expect(dialog.getByRole('button', { name: 'Copy link', exact: true })).toBeEnabled();
  await harness.expectNoHorizontalOverflow();
});

test('partner sees owner address but cannot rename it, unavailable schema preserves token sharing', async ({
  harness,
  page,
}) => {
  await page.route('**/app/api/binder-identity**', (route) =>
    route.fulfill({ json: { username: 'synthetic-owner', slug: 'national', canEdit: false, available: true } }),
  );
  await page.route('**/app/api/binder-share**', (route) =>
    route.fulfill({
      json: { share: { token: 'synthetic-token', is_enabled: true, path: '/app/share/synthetic-token' } },
    }),
  );
  await page.route('**/app/api/account-identity', (route) =>
    route.fulfill({ status: 503, json: { error: 'Usernames are not available yet' } }),
  );
  await page.goto('/app/e2e-harness?signedIn=1&binders=1&partner=1');
  const dialog = await settings(harness);
  await openSettingsPage(dialog, 'Sharing');
  const binder = dialog.getByRole('region', { name: 'Binder address' });
  await expect(binder.getByLabel('Binder slug')).toHaveValue('national');
  await expect(binder.getByLabel('Binder slug')).toBeDisabled();
  await expect(binder).toContainText('Only the binder owner');
  await openSettingsPage(dialog, 'Profile');
  await expect(dialog.getByRole('region', { name: 'Your profile' })).toContainText('Usernames are not available yet');
  await openSettingsPage(dialog, 'Sharing');
  await expect(dialog.getByRole('button', { name: 'Copy link', exact: true })).toBeEnabled();
});

// Synthetic share preferences, persisted by the mocked owner API.
test('share pricing defaults off and owner can enable and disable it', async ({ harness, page }) => {
  let showPrices = false;
  await page.route('**/app/api/binder-share**', async (route) => {
    if (route.request().method() === 'POST') showPrices = route.request().postDataJSON().showPrices;
    await route.fulfill({
      json: {
        share: {
          token: 'synthetic-token',
          is_enabled: true,
          show_prices: showPrices,
          path: '/app/share/synthetic-token',
        },
      },
    });
  });
  await page.goto('/app/e2e-harness?signedIn=1&binders=1');
  const dialog = await settings(harness);
  await openSettingsPage(dialog, 'Sharing');
  const toggle = dialog.getByRole('switch', { name: 'Show prices on shared binder' });
  await expect(toggle).not.toBeChecked();
  await harness.expectMinTapTarget(toggle, 36);
  await toggle.click();
  await expect(toggle).toBeChecked();
  expect(showPrices).toBe(true);
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  expect(showPrices).toBe(false);
  await harness.expectNoHorizontalOverflow();
});

test('shared binder without pricing cannot load prices or expose price details', async ({ harness, page }) => {
  const priceRequests: string[] = [];
  await page.goto('/app/e2e-harness?readOnly=1&cardArtwork=1');
  page.on('request', (request) => {
    if (request.url().includes('/api/card-prices')) priceRequests.push(request.url());
  });
  const controls = await harness.openViewOptions();
  await expect(controls.getByRole('button', { name: 'Prices', exact: true })).toHaveCount(0);
  await harness.closeControl(controls).click();
  await harness.openCardDetail();
  await expect(page.getByText('Price details', { exact: true })).toHaveCount(0);
  expect(priceRequests).toEqual([]);
  await harness.expectNoHorizontalOverflow();
});

test('shared binder with pricing enabled retains the pricing view', async ({ harness, page }) => {
  await page.goto('/app/e2e-harness?readOnly=1&sharePrices=1&cardArtwork=1');
  const controls = await harness.openViewOptions();
  await expect(controls.getByRole('button', { name: /^(Prices|Loading prices)/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await harness.closeControl(controls).click();
  await harness.openCardDetail();
  await expect(page.getByText('Price details', { exact: true })).toBeVisible();
});
