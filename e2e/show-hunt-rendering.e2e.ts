import { test, expect, mockBackends, emulateStandalone } from './fixtures';

test('Hunting keeps WebKit rows rendered during native scrolling', async ({ page, standalone, insets, baseURL }) => {
  if (standalone) await emulateStandalone(page, insets);
  await mockBackends(page, page.context(), { signedIn: false, baseURL });
  await page.goto('/app/e2e-harness?showHunt=1');
  const hunt = page.getByTestId('show-hunt');
  await expect(hunt.getByRole('heading', { name: /500 cards/ })).toBeVisible();
  const groups = hunt.locator('section[aria-label^="Hunting "]');
  await expect(groups).toHaveCount(100);
  const webKit = await page.evaluate(() => CSS.supports('font', '-apple-system-body'));
  await expect(groups.last()).toHaveCSS('content-visibility', webKit ? 'visible' : 'auto');
  const last = groups.last().locator('button[data-standing]').last();
  expect(await last.evaluate((el) => el.checkVisibility({ contentVisibilityAuto: true }))).toBe(webKit);

  // Native wheel input exercises Safari's reveal path. scrollTop/geometry reads can mask its bug.
  await hunt.locator('.overflow-y-auto').hover();
  await page.mouse.wheel(0, 100000);
  await expect(last).toBeInViewport();
  await expect(last).toHaveText(/Fixture card 99-4/);
  await last.click();
  await expect(page.getByRole('status', { name: 'Picked card' })).toHaveText('scroll-99-4');
  await page.mouse.wheel(0, -100000);
  await expect(groups.first()).toBeInViewport();
  await page.mouse.wheel(0, 100000);
  await expect(last).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
