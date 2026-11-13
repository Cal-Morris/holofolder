import { test, expect } from './fixtures';

// Guests: signed-in (native) binders have no header View options; their view is the Collection view picker.
test.use({ signedIn: false });

for (const width of [768, 1024, 1280, 1440]) {
  test(`desktop toolbar fits at ${width}px without scrolling`, async ({ harness }, testInfo) => {
    await harness.page.setViewportSize({ width, height: 900 });
    const search = harness.page.locator('nav').first().getByRole('button', { name: 'Search', exact: true });
    const toolbar = harness.page.getByTestId('app-header');
    await expect(search).toBeVisible();
    const size = await toolbar.evaluate((element) => ({ width: element.clientWidth, content: element.scrollWidth }));
    expect(size.content).toBeLessThanOrEqual(size.width);
    expect((await toolbar.boundingBox())!.height, 'header stays compact').toBeLessThanOrEqual(
      (width >= 1280 ? 80 : 125) + harness.insets.top,
    );
    await expect(toolbar.getByRole('combobox')).toHaveCount(0);
    const opener = toolbar.getByRole('button', { name: 'View', exact: true });
    await opener.click();
    const menu = harness.page.getByRole('dialog', { name: 'View options', exact: true });
    await expect(menu).toBeVisible();
    await harness.expectWithinSafeViewport(menu);
    if (width === 1024 && testInfo.project.name === 'browser-375x667') {
      await testInfo.attach('desktop-view-menu', {
        body: await harness.page.screenshot({ path: testInfo.outputPath('view-options.png') }),
        contentType: 'image/png',
      });
    }
    expect((await menu.boundingBox())!.height, 'View menu stays compact').toBeLessThanOrEqual(440);
    expect((await menu.boundingBox())!.width).toBeLessThanOrEqual(340);
    await harness.expectMinTapTarget(menu.getByRole('button', { name: 'Close view options', exact: true }), 36);
    await expect(menu.getByRole('group', { name: 'Binder display' })).toBeVisible();
    await harness.expectHittable(menu.getByRole('button', { name: '3D', exact: true }));
    await menu.getByRole('combobox', { name: 'Generation', exact: true }).selectOption('2');
    await expect(harness.page.getByRole('spinbutton', { name: 'Binder page number' })).toHaveValue('10');
    await harness.page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(opener).toBeFocused();
    await harness.expectScrollUnlocked();
    await opener.click();
    await expect(menu.getByRole('combobox', { name: 'Generation', exact: true })).toHaveValue('2');
    await menu.getByRole('button', { name: 'Close view options', exact: true }).click();
    await expect(menu).toHaveCount(0);
    await opener.click();
    await harness.page.goBack();
    await expect(menu).toHaveCount(0);
    await opener.click();
    await harness.tapBackdrop(menu);
    await expect(menu).toHaveCount(0);
    await harness.expectScrollUnlocked();
    if (width === 1024 && testInfo.project.name === 'browser-375x667') {
      await harness.page.getByRole('button', { name: 'More', exact: true }).click();
      await harness.page.getByRole('menuitem', { name: 'Light mode', exact: true }).click();
      await opener.click();
      await harness.expectHittable(menu.getByRole('button', { name: '3D', exact: true }));
      await testInfo.attach('desktop-view-menu-light', {
        body: await harness.page.screenshot({ path: testInfo.outputPath('view-options-light.png') }),
        contentType: 'image/png',
      });
      await menu.getByRole('button', { name: 'Close view options', exact: true }).click();
    }
  });
}
