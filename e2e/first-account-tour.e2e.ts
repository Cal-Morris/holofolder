import { test, expect, mockBackends, emulateStandalone, Harness, settingsRow } from './fixtures';

// Synthetic RPC/auth transport with the actual BinderApp and browser session. `tour=1` asks for the tour.
const entry = '/app/e2e-harness?signedIn=1&browserHost=1&binder=22222222-2222-4222-8222-222222222222&tour=1';

test.beforeEach(async ({ page, context, standalone, insets, baseURL }) => {
  if (standalone) await emulateStandalone(page, insets);
  await mockBackends(page, context, { signedIn: true, baseURL });
  await context.addCookies([{ name: 'hf-storage-fixture', value: `tour-${crypto.randomUUID()}`, url: baseURL! }]);
});

test(
  'the tour runs slides then coach marks once, and stays away after reload',
  { tag: '@matrix' },
  async ({ page, insets }) => {
    const h = new Harness(page, insets, true);
    await page.goto(entry);
    const slides = page.getByRole('dialog', { name: 'Welcome to Holo Folder' });
    await expect(slides).toBeVisible();
    await expect(slides.getByRole('heading', { name: 'Binders, your way' })).toBeVisible();
    await h.expectWithinSafeViewport(slides.getByRole('button', { name: 'Next', exact: true }));
    await h.expectNoHorizontalOverflow();
    for (const name of ['Skip', 'Next', 'Close tour'])
      await h.expectMinTapTarget(slides.getByRole('button', { name, exact: true }));

    for (let i = 0; i < 4; i++) await slides.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(slides.getByText('5 of 5')).toBeVisible();
    await slides.getByRole('button', { name: 'Show me around' }).click();
    await expect(slides).toHaveCount(0);

    const dock = page.locator('[data-dock]');
    const seen: string[] = [];
    for (;;) {
      const mark = page.getByRole('dialog', { name: /^Tour: / });
      await expect(mark).toBeVisible();
      seen.push((await mark.getAttribute('aria-label'))!.replace('Tour: ', ''));
      await h.expectWithinSafeViewport(mark);
      // The card sits above the dock, never on it.
      const [card, bar] = await Promise.all([mark.boundingBox(), dock.boundingBox()]);
      expect(card!.y + card!.height).toBeLessThanOrEqual(bar!.y);
      const done = mark.getByRole('button', { name: 'Done', exact: true });
      if (await done.count()) {
        await done.click();
        break;
      }
      await expect(mark.getByRole('button', { name: 'Skip tour' })).toBeVisible();
      await mark.getByRole('button', { name: 'Next', exact: true }).click();
    }
    expect(seen).toEqual(expect.arrayContaining(['Your binders', 'Search', 'Inventory', 'Wanted', 'Browse']));
    await expect(page.getByRole('dialog', { name: /^Tour: / })).toHaveCount(0);
    await h.expectScrollUnlocked();

    await page.reload();
    await expect(dock.getByRole('button', { name: 'Wanted' })).toBeVisible();
    // Give the session time to read the flag; the tour would open straight away if it were still due.
    await page.waitForTimeout(1000);
    await expect(page.getByRole('dialog', { name: 'Welcome to Holo Folder' })).toHaveCount(0);
  },
);

test('Escape skips the whole tour, and Settings replays it', async ({ page, insets }) => {
  const h = new Harness(page, insets, true);
  await page.goto(entry);
  const slides = page.getByRole('dialog', { name: 'Welcome to Holo Folder' });
  await expect(slides).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(slides).toHaveCount(0);
  await h.expectScrollUnlocked();

  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  await settingsRow(page.getByRole('dialog', { name: 'Settings' }), 'Replay tour').click();
  await expect(slides).toBeVisible();
  await slides.getByRole('button', { name: 'Skip', exact: true }).click();
  await expect(slides).toHaveCount(0);
});

test('waits for the first-binder wizard, then follows it', async ({ page }) => {
  await page.goto(`${entry}&onboarding=1`);
  const wizard = page.getByRole('dialog').filter({ hasText: 'Set up your first binder' });
  await expect(wizard).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Welcome to Holo Folder' })).toHaveCount(0);
  await wizard.getByRole('button', { name: 'Skip for now', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Welcome to Holo Folder' })).toBeVisible();
});
