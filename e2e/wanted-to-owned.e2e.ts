import { expect, test } from './fixtures';

test.describe('sharing the want list', () => {
  test.use({ signedIn: true });

  test('Share list hands over the want list as text, grouped by set', async ({ harness }) => {
    const { page } = harness;
    // Record what would be shared or copied; whether the share sheet or the clipboard is used depends on the device.
    await page.addInitScript(() => {
      const record = (text: string) => {
        (window as unknown as { __wantedShare?: string }).__wantedShare = text;
      };
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async (data: ShareData) => record(data.text ?? ''),
      });
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async (text: string) => record(text) },
      });
    });
    await harness.open();
    await harness.dock().getByRole('button', { name: 'Wanted', exact: true }).click();
    const share = page.getByRole('button', { name: 'Share list', exact: true });
    await expect(share).toBeVisible();
    expect((await share.boundingBox())!.height).toBeGreaterThanOrEqual(36);
    await share.click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __wantedShare?: string }).__wantedShare ?? ''))
      .toContain('Want list · 1 card');
    const text = await page.evaluate(() => (window as unknown as { __wantedShare?: string }).__wantedShare ?? '');
    expect(text).toContain('\n151\n• Squirtle 007/165 · JA');
    await harness.expectNoHorizontalOverflow();
  });
});
