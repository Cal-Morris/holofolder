import { test, expect, openSettingsPage, storageAction } from './fixtures';

test('binder settings retain page colours and expose the 3D studio', async ({ harness }) => {
  await harness.page.locator('nav').first().getByRole('button', { name: 'More', exact: true }).click();
  await harness.page.getByRole('menuitem', { name: 'Settings' }).click();
  const settings = await openSettingsPage(harness.page.getByRole('dialog', { name: /settings/i }), 'Layout');
  const studio = settings.getByRole('link', { name: /customise binder/i });
  await expect(studio).toHaveAttribute('href', '/app/studio');
  await harness.expectMinTapTarget(studio);
  await harness.expectWithinSafeViewport(studio);
  await openSettingsPage(settings, 'Appearance');
  await expect(settings.getByRole('spinbutton', { name: 'From page' })).toHaveValue('1');
  await settings.getByRole('button', { name: 'Ruby', exact: true }).click();
  await expect(settings.getByRole('button', { name: 'Reset to binder colour', exact: true })).toBeVisible();
  const hex = settings.getByRole('textbox', { name: 'Hex colour' });
  await hex.fill('#3366ff');
  await hex.press('Enter');
  await expect(hex).toHaveValue('#3366ff');
  await settings.getByRole('button', { name: 'Reset to binder colour', exact: true }).click();
  await expect(settings.getByRole('button', { name: 'Reset to binder colour', exact: true })).toBeHidden();
  await harness.expectNoHorizontalOverflow();
});

test('printing browser keeps a physical card outline at every size', async ({ harness }) => {
  const detail = await harness.openCardDetail();
  await detail.getByRole('button', { name: /all bulbasaur cards/i }).click();
  const dialog = harness.page.getByRole('dialog', { name: /all bulbasaur cards/i });
  const card = dialog.locator('.trading-card').first();
  await expect(card).toBeVisible();
  const dimensions = await card.evaluate((element) => {
    const { width, height } = element.getBoundingClientRect();
    return { ratio: width / height, radius: getComputedStyle(element).borderRadius };
  });
  expect(dimensions.ratio).toBeCloseTo(63 / 88, 2);
  expect(dimensions.radius).toBe('4.76% / 3.41%');
  await harness.expectNoHorizontalOverflow();
});

test.describe('signed-in native binder', () => {
  test.use({ signedIn: true });

  test('owner can change binder colour and finish glints', async ({ harness }) => {
    await (await storageAction(harness.page, 'Appearance')).click();
    const settings = harness.page.getByRole('dialog', { name: /settings/i });
    await expect(settings.getByRole('switch', { name: 'Toggle card finish glints' })).toBeEnabled();
    await settings.getByRole('button', { name: 'Ruby', exact: true }).click();
    await expect(settings.getByRole('button', { name: 'Reset to binder colour', exact: true })).toBeVisible();
  });
});
