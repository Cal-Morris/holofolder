import { test, expect } from './fixtures';

test.describe('card detail sheet on phones', () => {
  test('uses the full height above the dock, the full width and shows a large card preview', async ({ harness }) => {
    const dialog = await harness.openCardDetail();
    const dockTop = (await harness.dock().locator(':scope > div').first().boundingBox())!.y;
    const box = (await dialog.boundingBox())!;
    expect(box.y + box.height, 'sheet must not cover the dock').toBeLessThanOrEqual(dockTop + 0.5);
    expect(dockTop - (box.y + box.height), 'sheet hugs the dock').toBeLessThanOrEqual(10);
    expect(box.y).toBeGreaterThanOrEqual(harness.insets.top - 0.5);
    const { width } = harness.viewport;
    expect(box.width).toBeGreaterThanOrEqual(Math.min(width - 16, 448) - 1);
    const preview = dialog.locator('img').first();
    await expect(preview).toBeVisible();
    expect((await preview.boundingBox())!.height, 'card preview is readable').toBeGreaterThanOrEqual(64);
    await harness.expectNoHorizontalOverflow();
    await harness.expectHittable(harness.dock().getByRole('button', { name: 'List', exact: true }));
  });

  test('all cards view also hugs the dock', async ({ harness }) => {
    const detail = await harness.openCardDetail();
    await detail.getByRole('button', { name: /all bulbasaur cards/i }).click();
    const dialog = harness.page.getByRole('dialog', { name: /all bulbasaur cards/i });
    await expect(dialog).toBeVisible();
    const dockTop = (await harness.dock().locator(':scope > div').first().boundingBox())!.y;
    const box = (await dialog.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(dockTop + 0.5);
    expect(dockTop - (box.y + box.height)).toBeLessThanOrEqual(10);
  });
});

test.describe('card detail actions on phones', () => {
  for (const dexId of [1, 2]) {
    test(`primary actions are visible without scrolling (dex #${dexId})`, async ({ harness }) => {
      await harness.page.locator(`button[data-dex-id="${dexId}"]`).first().click();
      const dialog = harness.page.getByRole('dialog', { name: /details$/i });
      await expect(dialog).toBeVisible();
      const sheet = (await dialog.boundingBox())!;
      for (const name of [/^(change|add) owned card$/i, /^add (another )?wanted card$/i, /^next$/i]) {
        const button = dialog.getByRole('button', { name }).first();
        await expect(button).toBeVisible();
        const box = (await button.boundingBox())!;
        expect(box.y, `${name} below the sheet header`).toBeGreaterThanOrEqual(sheet.y);
        expect(box.y + box.height, `${name} visible without scrolling`).toBeLessThanOrEqual(
          sheet.y + sheet.height + 0.5,
        );
        await harness.expectHittable(button);
      }
      if (dexId === 1) {
        const market = dialog.getByText('Market', { exact: true });
        await expect(market).toBeVisible();
        const box = (await market.boundingBox())!;
        expect(box.y + box.height, 'market price stays visible before expanding details').toBeLessThanOrEqual(
          sheet.y + sheet.height + 0.5,
        );
      }
    });
  }
});

test.describe('card detail expanded information', () => {
  test('keeps card controls reachable and the close button fixed while scrolling', async ({ harness }) => {
    const dialog = await harness.openCardDetail();
    const close = dialog.getByRole('button', { name: 'Close card details' });
    await dialog.locator('summary').filter({ hasText: 'Card & variant' }).click();
    await expect(dialog.getByText('Current card', { exact: true })).toBeVisible();
    const finish = dialog.getByRole('button', { name: 'Reverse', exact: true });
    await finish.scrollIntoViewIfNeeded();
    await harness.expectHittable(finish);
    await harness.expectMinTapTarget(finish, 32);
    await dialog.locator('summary').filter({ hasText: 'Collection options' }).click();
    const initialClose = (await close.boundingBox())!;
    const scanner = dialog.getByRole('button', { name: 'Scan card', exact: true });
    await scanner.scrollIntoViewIfNeeded();
    await harness.expectHittable(scanner);
    await harness.expectMinTapTarget(scanner, 36);
    await expect(dialog.getByRole('button', { name: 'Fav', exact: true })).toBeVisible();
    expect((await close.boundingBox())!.y).toBeCloseTo(initialClose.y, 0);
    await harness.expectWithinSafeViewport(close);
    await harness.expectHittable(close);
    await harness.expectNoHorizontalOverflow();
    await close.click();
    await expect(dialog).not.toBeVisible();
    await harness.expectScrollUnlocked();
  });
});

for (const viewport of [
  { width: 1169, height: 731 },
  { width: 1280, height: 800 },
]) {
  test(`desktop card details stay inside ${viewport.width}x${viewport.height} when expanded`, async ({ harness }) => {
    await harness.page.setViewportSize(viewport);
    await harness.page.locator('button[data-dex-id="1"]').first().click();
    const dialog = harness.page.getByRole('dialog', { name: /bulbasaur details/i });
    await expect(dialog).toBeVisible();
    for (const label of ['Card & variant', 'Collection options']) {
      await dialog.locator('summary').filter({ hasText: label }).click();
    }
    await expect
      .poll(async () => {
        const box = (await dialog.boundingBox())!;
        return box.y + box.height;
      })
      .toBeLessThanOrEqual(viewport.height - 15);
    await harness.expectHittable(dialog.getByRole('button', { name: 'Close card details' }));
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  });
}
