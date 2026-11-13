import { test, expect, emulateStandalone, mockBackends } from './fixtures';

test.beforeEach(async ({ page, standalone, insets, baseURL }) => {
  if (standalone) await emulateStandalone(page, insets);
  await mockBackends(page, page.context(), { signedIn: false, baseURL });
  await page.goto('/app/e2e-harness/toast');
  await expect(page.getByRole('heading', { name: 'Toast harness' })).toBeVisible();
});

for (const mode of ['modal', 'non-modal'] as const) {
  test(`a toast from a ${mode} sheet sits above its footer, and its Undo works by keyboard`, async ({ page }) => {
    await page.getByRole('button', { name: `Open ${mode} sheet` }).click();
    const sheet = page.getByRole('dialog', { name: `${mode} sheet` });
    const footer = sheet.locator('footer');
    await sheet.getByRole('button', { name: 'Save', exact: true }).click();
    const toast = page.locator('[data-toaster]');
    await expect(toast).toHaveText(/^Synthetic change saved\s*Undo$/);
    // A modal dialog is in the top layer with the page inert behind it, so the toast renders inside it.
    await expect(sheet.locator('[data-toaster]')).toHaveCount(mode === 'modal' ? 1 : 0);
    const undo = toast.getByRole('button', { name: 'Undo', exact: true });
    await expect(undo).toBeVisible();
    const box = (await toast.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual((await footer.boundingBox())!.y);
    expect(box.y).toBeGreaterThanOrEqual(0);
    // Tab reaches Undo from inside the sheet's focus trap; Enter runs it and the toast goes.
    await sheet.getByRole('button', { name: 'Save', exact: true }).focus();
    for (let presses = 0; presses < 10 && !(await undo.evaluate((el) => el === document.activeElement)); presses++)
      await page.keyboard.press('Tab');
    await expect(undo).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(toast).toBeEmpty();
    await expect(page.getByLabel('Undone count')).toHaveText('1');
    await expect(sheet).toBeVisible();
  });
}
