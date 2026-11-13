import { test, expect } from './fixtures';

for (const shared of [false, true]) {
  test(
    `signed-out ${shared ? 'shared' : 'own'} binder offers sign-up in the header`,
    { tag: '@matrix' },
    async ({ harness, page }, testInfo) => {
      if (shared) await page.goto('/app/e2e-harness?readOnly=1');
      const header = page.getByTestId('app-header');
      console.log(JSON.stringify({ project: testInfo.project.name, shared, header: await header.boundingBox() }));
      const join = header.getByRole('button', { name: 'Join now', exact: true });
      await expect(join).toBeVisible();
      await harness.expectMinTapTarget(join);
      await harness.expectWithinSafeViewport(join);
      await harness.expectHittable(join);
      await harness.expectNoHorizontalOverflow();
      const title = header.getByText(shared ? 'Shared binder' : 'Holo Folder', { exact: true });
      expect(await title.evaluate((el) => el.scrollWidth <= el.clientWidth), 'binder title fits beside Join now').toBe(
        true,
      );
      for (const control of await header.locator('button:visible, input:visible').all())
        await harness.expectMinTapTarget(control);
      await expect(header.getByRole('button', { name: 'Show mode', exact: true })).toHaveCount(0);

      await join.click();
      const signup = page.getByRole('dialog', { name: 'Create account', exact: true });
      await expect(signup).toBeVisible();
      await expect(signup.getByPlaceholder('Confirm password', { exact: true })).toBeVisible();
      await harness.expectWithinSafeViewport(harness.closeControl(signup));
      await harness.closeControl(signup).click();

      await header.getByRole('button', { name: 'More', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Show mode', exact: true }).click();
      await expect(header).toContainText('Show mode on');
      await expect(join).toBeVisible();
      await harness.expectNoHorizontalOverflow();
      await header.getByRole('button', { name: 'More', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Exit show mode', exact: true }).click();

      if (!shared) {
        await header.getByRole('button', { name: 'More', exact: true }).click();
        await page.getByRole('menuitem', { name: 'Sign in', exact: true }).click();
        const signin = page.getByRole('dialog', { name: 'Welcome, sign in', exact: true });
        await expect(signin).toBeVisible();
        await expect(signin.getByPlaceholder('Confirm password', { exact: true })).toHaveCount(0);
        await page.keyboard.press('Escape');
        await join.click();
        await expect(signup.getByPlaceholder('Confirm password', { exact: true })).toBeVisible();
        await page.keyboard.press('Escape');
      }

      for (const name of ['List', 'Wanted', 'Browse', 'Binder']) {
        await harness.dock().getByRole('button', { name, exact: true }).click();
        await expect(join).toBeVisible();
        await harness.expectHittable(join);
        await harness.expectNoHorizontalOverflow();
      }
      await page.evaluate(() => document.documentElement.classList.remove('dark'));
      await expect(join).toBeVisible();
      await harness.expectHittable(join);
      await page.screenshot({ path: `/tmp/guest-join/${testInfo.project.name}-${shared ? 'shared' : 'own'}.png` });
    },
  );
}

test.describe('signed-in viewer', () => {
  test.use({ signedIn: true });
  for (const shared of [false, true]) {
    test(`${shared ? 'shared' : 'own'} binder keeps Show without Join now`, async ({ harness, page }) => {
      const billingRequests: string[] = [];
      if (shared) {
        page.on('request', (request) => {
          if (new URL(request.url()).pathname === '/app/api/billing') billingRequests.push(request.url());
        });
        await page.goto('/app/e2e-harness?signedIn=1&readOnly=1&partner=1');
      }
      const header = page.getByTestId('app-header');
      await expect(header.getByRole('button', { name: 'Show mode', exact: true })).toBeVisible();
      await expect(header.getByRole('button', { name: 'Join now', exact: true })).toHaveCount(0);
      await harness.expectNoHorizontalOverflow();
      if (shared) expect(billingRequests).toEqual([]);
    });
  }
});

test('guest header fits desktop navigation', async ({ harness, page }, info) => {
  test.skip(info.project.name !== 'browser-390x844', 'desktop layout runs once');
  await page.setViewportSize({ width: 1280, height: 900 });
  const join = page.getByTestId('app-header').getByRole('button', { name: 'Join now', exact: true });
  await expect(join).toBeVisible();
  await harness.expectWithinSafeViewport(join);
  await harness.expectHittable(join);
  await harness.expectNoHorizontalOverflow();
});

test('guest edits ask to create an account and leave the collection alone', async ({ harness, page }) => {
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET' && new URL(request.url()).pathname.startsWith('/app/api/collection'))
      writes.push(request.url());
  });
  const signup = page.getByRole('dialog', { name: 'Create account', exact: true });
  const openDetail = async (dexId: number, name: RegExp) => {
    await page.locator(`button[data-dex-id="${dexId}"]`).first().click();
    const detail = page.getByRole('dialog', { name });
    await expect(detail).toBeVisible();
    return detail;
  };
  const expectSignup = async () => {
    await expect(signup).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await harness.closeControl(signup).click();
    await expect(signup).toHaveCount(0);
  };

  await (await openDetail(2, /ivysaur details/i)).getByRole('button', { name: 'Add owned card', exact: true }).click();
  await expectSignup();
  await (
    await openDetail(1, /bulbasaur details/i)
  )
    .getByRole('button', { name: 'Remove owned card', exact: true })
    .click();
  await expectSignup();

  await harness.dock().getByRole('button', { name: 'List', exact: true }).click();
  await page.getByRole('button', { name: 'Add card for ivysaur', exact: true }).click();
  await expectSignup();

  await harness.dock().getByRole('button', { name: 'Binder', exact: true }).click();
  await expect(
    (await openDetail(2, /ivysaur details/i)).getByRole('button', { name: 'Add owned card', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(
    (await openDetail(1, /bulbasaur details/i)).getByRole('button', { name: 'Change owned card', exact: true }),
  ).toBeVisible();
  expect(writes).toEqual([]);
  const keys = await page.evaluate(() => Object.keys(localStorage));
  expect(keys.filter((key) => key.startsWith('pokemon_collection') || key.startsWith('binderdex_legacy'))).toEqual([]);
});
