import { test, expect, mockBackends } from './fixtures';

test.use({ signedIn: true });

for (const theme of ['light', 'dark']) {
  test(`compact header and discoverable navigation, ${theme}`, async ({ harness }, info) => {
    const page = harness.page;
    await page.goto('/app/e2e-harness?signedIn=1&binders=1');
    await page.getByRole('button', { name: 'More', exact: true }).click();
    const themeAction = page.getByRole('menuitem', { name: theme === 'light' ? 'Light mode' : 'Dark mode' });
    if (await themeAction.isVisible()) await themeAction.click();
    else await page.keyboard.press('Escape');
    const header = page.getByTestId('app-header');
    await expect(header.getByTestId('binder-switcher-trigger')).toContainText('My binder');
    await expect(header.getByRole('group', { name: 'Binder cards' })).toHaveCount(0);
    await expect(harness.dock().getByRole('button', { name: 'Binder', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(harness.dock().getByRole('button', { name: 'Browse' })).toContainText('Browse');
    for (const button of await header.locator('button:visible, input:visible').all()) {
      await harness.expectMinTapTarget(button, 44);
      await harness.expectWithinSafeViewport(button);
      if (await button.isEnabled()) await harness.expectHittable(button);
    }
    const dock = harness.dock();
    const dockBox = (await dock.boundingBox())!;
    expect(dockBox.x).toBe(0);
    expect(dockBox.width).toBe(harness.viewport.width);
    expect(dockBox.height).toBe(54 + Math.max(harness.insets.bottom, 8));
    for (const button of await dock.getByRole('button').all()) {
      await harness.expectMinTapTarget(button, 44);
      await harness.expectWithinSafeViewport(button);
      if (await button.isEnabled()) await harness.expectHittable(button);
    }
    await page.screenshot({ path: `/tmp/native-chrome-${info.project.name}-${theme}.png` });
    await header.getByRole('button', { name: /Next binder/ }).click();
    await expect(header.getByRole('spinbutton')).not.toHaveValue('1');
    await header.getByRole('button', { name: /Previous binder/ }).click();
    await expect(header.getByRole('spinbutton')).toHaveValue('1');
    await header.getByRole('button', { name: 'View', exact: true }).click();
    const view = page.getByRole('dialog', { name: 'View options' });
    await expect(view).toBeVisible();
    await expect(view.getByRole('group', { name: 'Binder cards' })).toBeVisible();
    await expect(view.getByRole('group', { name: 'Binder display' })).toBeVisible();
    await view.getByRole('button', { name: 'Owned', exact: true }).click();
    await expect(view.getByRole('button', { name: 'Owned', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await view.getByRole('button', { name: 'Mixed', exact: true }).click();
    await harness.expectWithinSafeViewport(view.getByRole('button', { name: 'Close view options' }));
    await page.screenshot({ path: `/tmp/header-view-${info.project.name}-${theme}.png` });
    await harness.swipeDown(view);
    await expect(view).toBeHidden();
    await header.getByRole('button', { name: 'Show mode', exact: true }).click();
    const show = page.getByRole('region', { name: 'Show mode' });
    await expect(show).toBeVisible();
    await expect(header.getByTestId('header-show-mode')).toHaveCount(0);
    await expect(show.getByRole('button', { name: 'Exit show mode', exact: true })).toHaveCount(1);
    await harness.expectNoHorizontalOverflow();
    await page.screenshot({ path: `/tmp/header-after-${info.project.name}-${theme}.png` });
    console.log('header height', info.project.name, theme, (await header.boundingBox())!.height);
    await harness.dock().getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Quick mode' })).toBeVisible();
    await page.keyboard.press('Escape');
    await show.getByRole('button', { name: 'Exit show mode' }).click();
    const moreButton = header.getByRole('button', { name: 'More', exact: true });
    const more = page.getByRole('dialog', { name: 'More', exact: true });
    for (const dismiss of ['close', 'escape', 'back', 'backdrop', 'tab']) {
      await moreButton.click();
      await expect(more).toBeVisible();
      await harness.expectWithinSafeViewport(more);
      if (dismiss === 'close') await more.getByRole('button', { name: 'Close more' }).click();
      if (dismiss === 'escape') await page.keyboard.press('Escape');
      if (dismiss === 'back') await page.goBack();
      if (dismiss === 'backdrop') await harness.tapBackdrop(more);
      if (dismiss === 'tab') await harness.dock().getByRole('button', { name: 'Wanted', exact: true }).click();
      await expect(more).toBeHidden();
    }
    await harness.expectScrollUnlocked();
    await moreButton.click();
    await more.getByRole('menuitem', { name: 'Settings', exact: true }).click();
    await expect(more).toBeHidden();
    await expect(page.getByRole('dialog', { name: /settings/i })).toBeVisible();
  });
}

for (const width of [1280, 1440])
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`desktop ${width} ${colorScheme}`, async ({ browser, baseURL }, info) => {
      test.skip(info.project.name !== 'browser-390x844', 'desktop matrix runs once');
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        colorScheme,
        serviceWorkers: 'block',
      });
      const page = await context.newPage();
      await mockBackends(page, context, { signedIn: true, baseURL });
      await page.goto(`${baseURL}/app/e2e-harness?signedIn=1&binders=1`);
      await page.getByRole('button', { name: 'More', exact: true }).click();
      const themeAction = page.getByRole('menuitem', { name: colorScheme === 'light' ? 'Light mode' : 'Dark mode' });
      if (await themeAction.isVisible()) await themeAction.click();
      else await page.keyboard.press('Escape');
      const header = page.getByTestId('app-header');
      await expect(header.getByRole('button', { name: 'View', exact: true })).toBeVisible();
      await header.getByRole('button', { name: 'Show mode', exact: true }).click();
      await expect(page.getByRole('region', { name: 'Show mode' })).toBeVisible();
      expect((await header.boundingBox())!.height).toBeLessThan(125);
      await page.screenshot({ path: `/tmp/header-after-${width}-${colorScheme}.png` });
      await header.getByRole('button', { name: 'Browse', exact: true }).click();
      await expect(header.getByRole('button', { name: 'Browse', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(header.getByRole('button', { name: 'Pokémon', exact: true })).toHaveCount(0);
      await page.screenshot({ path: `/tmp/header-browse-${width}-${colorScheme}.png` });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await context.close();
    });
  }
