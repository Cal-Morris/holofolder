import { test, expect } from './fixtures';

test.use({ signedIn: true });

for (const dismissal of ['close', 'escape', 'back', 'backdrop', 'swipe'] as const) {
  test(`full-screen card returns to details after ${dismissal}`, async ({ harness }) => {
    await harness.page.goto(`${harness.path}&cardArtwork=1`);
    const detail = await harness.openCardDetail();
    const opener = detail.getByRole('button', { name: 'View Bulbasaur full screen' });
    await expect(opener).toBeVisible();
    const preview = (await opener.boundingBox())!;
    await opener.click();
    const viewer = harness.page.getByRole('dialog', { name: 'Bulbasaur full screen' });
    await expect(viewer).toBeVisible();
    const image = viewer.getByRole('img', { name: 'Bulbasaur', exact: true });
    await expect(image).toBeVisible();
    const box = (await image.boundingBox())!;
    expect(box.height).toBeGreaterThan(preview.height * 3);
    expect(box.y).toBeGreaterThanOrEqual(harness.insets.top);
    expect(box.y + box.height).toBeLessThanOrEqual(harness.viewport.height - harness.insets.bottom);
    const close = viewer.getByRole('button', { name: 'Close full-screen card' });
    await harness.expectWithinSafeViewport(close);
    await harness.expectMinTapTarget(close, 44);
    await harness.expectHittable(close);
    await harness.expectNoHorizontalOverflow();
    if (dismissal === 'close') await close.click();
    if (dismissal === 'escape') await harness.page.keyboard.press('Escape');
    if (dismissal === 'back') await harness.page.goBack();
    if (dismissal === 'backdrop') await harness.page.mouse.click(4, harness.viewport.height / 2);
    if (dismissal === 'swipe') await harness.swipeDown(viewer);
    await expect(viewer).not.toBeVisible();
    await expect(detail).toBeVisible();
    await expect(opener).toBeFocused();
    await detail.getByRole('button', { name: 'Close card details' }).click();
    await expect(detail).not.toBeVisible();
    await harness.expectScrollUnlocked();
  });
}

test('search card details can show the card full screen', async ({ harness }) => {
  await harness.page.keyboard.press('ControlOrMeta+k');
  const quick = harness.page.getByRole('dialog', { name: 'Quick mode', exact: true });
  await expect(quick).toBeVisible();
  await quick.getByRole('searchbox').fill('charm');
  await quick
    .getByRole('region', { name: 'Cards' })
    .getByRole('button', { name: /^Charmander, 151 /i })
    .first()
    .click();
  await quick.getByRole('button', { name: 'More details' }).click();
  const details = harness.page.getByRole('dialog', { name: /charmander/i });
  await details.getByRole('button', { name: 'View Charmander full screen' }).click();
  const viewer = harness.page.getByRole('dialog', { name: 'Charmander full screen', exact: true });
  await expect(viewer).toBeVisible();
  await harness.page.keyboard.press('Escape');
  await expect(viewer).not.toBeVisible();
  await expect(details).toBeVisible();
});

test('viewer opens offline on desktop and traps focus', async ({ harness }) => {
  await harness.page.setViewportSize({ width: 1280, height: 800 });
  await harness.page.goto(`${harness.path}&cardArtwork=1`);
  const detail = await harness.openCardDetail();
  const opener = detail.getByRole('button', { name: 'View Bulbasaur full screen' });
  await expect(opener.getByRole('img')).toBeVisible();
  await harness.page.context().setOffline(true);
  await opener.click();
  const viewer = harness.page.getByRole('dialog', { name: 'Bulbasaur full screen', exact: true });
  await expect(viewer).toBeVisible();
  const close = viewer.getByRole('button', { name: 'Close full-screen card' });
  await harness.page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await harness.page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await close.click();
  await expect(opener).toBeFocused();
  await harness.page.context().setOffline(false);
});

test('unavailable image explains the failure and stays dismissible in dark mode', async ({ harness }) => {
  await harness.page.emulateMedia({ colorScheme: 'dark' });
  await harness.page.keyboard.press('ControlOrMeta+k');
  const quick = harness.page.getByRole('dialog', { name: 'Quick mode', exact: true });
  await quick.getByRole('searchbox').fill('charm');
  await quick
    .getByRole('region', { name: 'Cards' })
    .getByRole('button', { name: /^Charmander, 151 /i })
    .first()
    .click();
  await quick.getByRole('button', { name: 'More details' }).click();
  const detail = harness.page.getByRole('dialog', { name: /charmander/i });
  await harness.page.route('**/api/card-image-proxy?**', (route) => route.abort());
  await detail.getByRole('button', { name: 'View Charmander full screen' }).click();
  const viewer = harness.page.getByRole('dialog', { name: 'Charmander full screen', exact: true });
  await expect(viewer.getByRole('status')).toContainText("This card image isn't available");
  const close = viewer.getByRole('button', { name: 'Close full-screen card' });
  await harness.expectHittable(close);
  await close.click();
  await expect(detail).toBeVisible();
});

test('full-screen card tilts towards the pointer and settles when it leaves', async ({ harness }) => {
  await harness.page.goto(`${harness.path}&cardArtwork=1`);
  const detail = await harness.openCardDetail();
  await detail.getByRole('button', { name: 'View Bulbasaur full screen' }).click();
  const viewer = harness.page.getByRole('dialog', { name: 'Bulbasaur full screen' });
  const image = viewer.getByRole('img', { name: 'Bulbasaur', exact: true });
  await expect(image).toBeVisible();
  const box = (await image.boundingBox())!;
  const card = image.locator('xpath=ancestor::div[contains(@class, "trading-card")][1]');
  const tilt = () => card.evaluate((node: HTMLElement) => node.style.getPropertyValue('--card-ry'));
  await harness.page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.5);
  await expect.poll(tilt).not.toBe('');
  expect(Number.parseFloat(await tilt())).toBeGreaterThan(0);
  await harness.page.mouse.move(4, 4);
  await expect.poll(tilt).toBe('');
  await expect(viewer).toBeVisible();
});
