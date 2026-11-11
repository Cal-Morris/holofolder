import { E2E_USER, SEEDED_COLLECTION, expect, test } from './fixtures';

const SQUIRTLE = 7;

test.describe('sharing the want list', () => {
  test.use({ signedIn: true });

  test('Share list hands over the want list as text, grouped by set', async ({ harness }) => {
    const { page } = harness;
    const wanted = {
      id: 'e2e-7',
      user_id: E2E_USER.id,
      pokemon_id: SQUIRTLE,
      pokemon_name: 'squirtle',
      status: 'wishlisted',
      collected_at: '2026-01-01T00:00:00.000Z',
      wanted_cards: [
        {
          card_id: 'sv03.5-007',
          card_name: 'Squirtle',
          card_set: '151',
          card_language: 'ja',
          card_finish: 'normal',
          local_id: '007',
          set_total: 165,
          added_at: '2026-02-01T00:00:00.000Z',
        },
      ],
    };
    await page.route(/\/rest\/v1\/pokemon_collection/, (route) =>
      route.request().method() === 'GET' ? route.fulfill({ json: [...SEEDED_COLLECTION, wanted] }) : route.fallback(),
    );
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
