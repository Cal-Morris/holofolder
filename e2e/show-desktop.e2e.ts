import { test, expect } from '@playwright/test';
import { mockBackends } from './fixtures';
import { mockCardPrices } from './price-fixtures';

// Show mode on a laptop or desktop: mouse and keyboard, wide window. The suite's projects are phones, so
// this file sets its own desktop context and runs once (on the browser-390 project).
const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

for (const viewport of [
  { width: 768, height: 800 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
]) {
  test.describe(`show mode on desktop ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport, isMobile: false, hasTouch: false, userAgent: DESKTOP_UA });

    test('the tinted header works with a mouse, header Search opens the finder, and the deal check opens beside the results', async ({
      page,
      baseURL,
    }) => {
      test.skip(test.info().project.name !== 'browser-390x844', 'desktop context: run once');
      await mockBackends(page, page.context(), { signedIn: true, baseURL });
      await mockCardPrices(page, { 'sv03.5-006': { market: 10, confidence: 'high' } });
      await page.goto('/app/e2e-harness?signedIn=1');
      await expect(page.locator('button[data-dex-id="1"]').first()).toBeVisible({ timeout: 30_000 });

      const header = page.getByTestId('app-header');
      const before = (await header.boundingBox())!.height;
      await page.getByRole('button', { name: 'Show mode', exact: true }).click();
      const banner = page.getByRole('region', { name: 'Show mode' });
      await expect(banner).toContainText('Show mode on');
      expect((await header.boundingBox())!.height).toBe(before);
      // Search stays in the primary navigation.
      await expect(banner.getByText('Screen stays on')).toBeHidden();

      // The header's own Search (desktop nav) opens Show mode's finder, like the phone dock does.
      await page.getByTestId('app-header').getByRole('button', { name: 'Search', exact: true }).last().click();
      const dialog = page.getByRole('dialog', { name: 'Quick mode' });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('heading', { name: 'Show mode' })).toBeVisible();
      // Results use the workspace until a card is selected.
      expect((await dialog.boundingBox())!.width).toBeGreaterThan(760);
      await expect(dialog.getByTestId('show-detail-pane')).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();

      // Ctrl+K and the navigation Search button both open the finder.
      await page.keyboard.press('Control+k');
      await expect(dialog).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await page.getByTestId('app-header').getByRole('button', { name: 'Search', exact: true }).click();
      await expect(dialog).toBeVisible();

      await dialog.getByRole('searchbox').fill('charizard');
      const result = dialog
        .getByRole('region', { name: 'Cards' })
        .getByRole('button', { name: /^Charizard ex, 151 / })
        .first();
      await result.click();
      const check = dialog.getByTestId('quick-card-check');
      await expect(check).toBeVisible();
      // The results stay put next to the check, so another card is one click away.
      await expect(result).toBeVisible();
      await expect(dialog.getByRole('searchbox')).toHaveValue('charizard');
      const resultBox = (await result.boundingBox())!;
      const checkBox = (await check.boundingBox())!;
      expect(checkBox.x).toBeGreaterThanOrEqual(resultBox.x + resultBox.width - 1);

      expect(await check.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      const asking = check.getByRole('textbox', { name: 'Asking price' });
      await expect(asking).toBeFocused();
      await asking.fill('7');
      await expect(check.getByTestId('deal-verdict')).toHaveAttribute('data-verdict', 'great');
      for (const name of ['Bought', 'Add owned', 'Want', 'Add to bundle']) {
        const button = check.getByRole('button', { name, exact: true });
        await expect(button).toBeVisible();
        const box = (await button.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(checkBox.x);
        expect(box.x + box.width).toBeLessThanOrEqual(checkBox.x + checkBox.width);
        expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 0.5);
      }

      // Back clears the check pane; the results are still there.
      await check.getByRole('button', { name: 'Back to results' }).click();
      await expect(check).toHaveCount(0);
      await expect(dialog.getByTestId('show-detail-pane')).toHaveCount(0);
      await expect(result).toBeVisible();

      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      const exit = banner.getByRole('button', { name: 'Exit show mode' });
      await exit.hover();
      await exit.click();
      await expect(banner).toHaveCount(0);
    });
  });
}
