import { test, expect } from './fixtures';

test.describe('Revisit deals', () => {
  test.use({ signedIn: true, locale: 'en-GB' });
  test('saves an asking price and stall note, reopens offline and removes it', async ({ harness }) => {
    const { page } = harness;
    await page.getByRole('button', { name: 'Show mode', exact: true }).click();
    await harness.dock().getByRole('button', { name: 'Search', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Quick mode' });
    await dialog.getByRole('searchbox').fill('charizard');
    await dialog.getByRole('button', { name: /^Charizard ex, 151 006\/165/ }).click();
    const check = dialog.getByTestId('quick-card-check');
    await check.getByRole('textbox', { name: 'Asking price', exact: true }).fill('8');
    await check.getByRole('textbox', { name: 'Asking price', exact: true }).press('Enter');
    await check.getByRole('textbox', { name: 'Stall or condition note' }).fill('Table 14, corner whitening');
    const save = check.getByRole('button', { name: 'Save for later', exact: true });
    await save.scrollIntoViewIfNeeded();
    await harness.expectMinTapTarget(save, 36);
    await save.click();
    await expect(check).toContainText('Saved on this device');
    await page.keyboard.press('Escape');
    await page.reload();
    await harness.dock().getByRole('button', { name: 'Search', exact: true }).click();
    const list = dialog.getByRole('region', { name: 'Revisit deals' });
    await expect(list).toContainText('Table 14, corner whitening');
    await expect(list).toContainText('£8.00');
    // This harness blocks service workers: load the lazy checker again after reload before going offline.
    await list.getByRole('button', { name: /^Revisit Charizard ex/ }).click();
    await expect(check.getByRole('textbox', { name: 'Asking price', exact: true })).toHaveValue('8');
    await check.getByRole('button', { name: 'Back to results' }).click();
    await page.context().setOffline(true);
    await list.getByRole('button', { name: /^Revisit Charizard ex/ }).click();
    await expect(check.getByRole('textbox', { name: 'Asking price', exact: true })).toHaveValue('8');
    await expect(check.getByRole('textbox', { name: 'Stall or condition note' })).toHaveValue(
      'Table 14, corner whitening',
    );
    await harness.expectNoHorizontalOverflow();
    await check.getByRole('button', { name: 'Back to results' }).click();
    await list.getByRole('button', { name: 'Remove Charizard ex from revisit list' }).click();
    await expect(list).toHaveCount(0);
    await page.context().setOffline(false);
  });
  test('reports blocked storage and leaves the note editable', async ({ harness }) => {
    const { page } = harness;
    await page.getByRole('button', { name: 'Show mode', exact: true }).click();
    await harness.dock().getByRole('button', { name: 'Search', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Quick mode' });
    await dialog.getByRole('searchbox').fill('charizard');
    await dialog.getByRole('button', { name: /^Charizard ex, 151 006\/165/ }).click();
    const check = dialog.getByTestId('quick-card-check');
    await page.evaluate(() => {
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith('holofolder:show-revisit:'))
          throw new DOMException('Synthetic storage failure', 'QuotaExceededError');
        set.call(this, key, value);
      };
    });
    const note = check.getByRole('textbox', { name: 'Stall or condition note' });
    await note.fill('Table 14');
    await check.getByRole('button', { name: 'Save for later', exact: true }).click();
    await expect(check).toContainText('Not saved. Device storage is full or unavailable.');
    await expect(note).toHaveValue('Table 14');
    await expect(check.getByRole('button', { name: 'Save for later', exact: true })).toBeEnabled();
  });
});
