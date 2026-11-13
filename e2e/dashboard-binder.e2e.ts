import { test, expect as baseExpect, E2E_USER } from './fixtures';

// The 3D binder renders on SwiftShader in CI and can take ~10 s to open and settle a spread.
const expect = baseExpect.configure({ timeout: 30_000 });
test.describe.configure({ timeout: 90_000 });
import { defaultBinderDesign } from '../lib/binder-design';

test.describe('Dashboard binder appearance', () => {
  test.use({ signedIn: false });

  test('2D and 3D share navigation, layout and the saved page', async ({ harness }) => {
    const { page } = harness;
    // Synthetic Studio layout differs from the active binder's 4x4 grid.
    const design = { ...defaultBinderDesign(), rows: 3, cols: 3, pageCount: 200 };
    await page.route('**/app/api/binder-appearance', (route) =>
      route.fulfill({ json: { ownerId: E2E_USER.id, design, revision: 1 } }),
    );
    await page.goto('/app/e2e-harness?cardArtwork=1');
    const pageNumber = page
      .getByRole('spinbutton', { name: 'Binder page number', exact: true })
      .filter({ visible: true });
    await pageNumber.fill('3');
    await pageNumber.press('Enter');
    await expect(page).toHaveURL(/page=3/);
    await harness.openViewOptions();
    await page.getByRole('button', { name: '3D', exact: true }).click();
    const preview = page.getByRole('region', { name: 'Your 3D National Dex binder' });
    const stage = preview.getByTestId('binder-3d-stage');
    await expect(stage).toHaveAttribute('data-current-page', '3');
    await expect(stage).toHaveAttribute('data-current-spread', '2-3');
    await expect(preview.getByText('65 pages', { exact: true })).toBeVisible();
    await preview.getByRole('button', { name: 'Next 3D binder spread' }).click();
    await expect(stage).toHaveAttribute('data-current-page', '4');
    await expect(page).toHaveURL(/page=4/);
    await harness.openViewOptions();
    await page.getByRole('button', { name: '2D', exact: true }).click();
    await page.getByRole('button', { name: 'Close view options', exact: true }).click();
    await expect(pageNumber).toHaveValue('4');
    await expect(page.locator('button[data-dex-id="49"]').first()).toBeVisible();
    await page.reload();
    await expect(pageNumber).toHaveValue('4');
    await pageNumber.fill('65');
    await pageNumber.press('Enter');
    await expect(page).toHaveURL(/page=65/);
    await harness.openViewOptions();
    await page.getByRole('button', { name: '3D', exact: true }).click();
    await expect(stage).toHaveAttribute('data-current-spread', '64-65');
    await expect(preview.getByRole('button', { name: 'Next 3D binder spread' })).toBeDisabled();
    await preview.getByRole('button', { name: 'Previous 3D binder spread' }).click();
    await expect(stage).toHaveAttribute('data-current-page', '62');
    await harness.openViewOptions();
    await page.getByRole('button', { name: '2D', exact: true }).click();
    await page.getByRole('button', { name: 'Close view options', exact: true }).click();
    await expect(pageNumber).toHaveValue('62');
    await harness.expectNoHorizontalOverflow();
  });

  test('explicit 3D navigation survives switching back with a generation filter', async ({ harness }) => {
    const { page } = harness;
    await harness.openViewOptions();
    const controls = page.getByRole('dialog', { name: 'View options', exact: true });
    await controls.getByRole('combobox').selectOption('2');
    await controls.getByRole('button', { name: 'Close view options', exact: true }).click();
    await expect(
      page.getByRole('spinbutton', { name: 'Binder page number', exact: true }).filter({ visible: true }),
    ).toHaveValue('10');
    await harness.openViewOptions();
    await page.getByRole('button', { name: '3D', exact: true }).click();
    const preview = page.getByRole('region', { name: 'Your 3D National Dex binder' });
    await expect(preview.getByTestId('binder-3d-stage')).toHaveAttribute('data-current-page', '10');
    await preview.getByRole('button', { name: 'Previous 3D binder spread' }).click();
    await expect(preview.getByTestId('binder-3d-stage')).toHaveAttribute('data-current-page', '8');
    await harness.openViewOptions();
    await page.getByRole('button', { name: '2D', exact: true }).click();
    await page.getByRole('button', { name: 'Close view options', exact: true }).click();
    await expect(
      page.getByRole('spinbutton', { name: 'Binder page number', exact: true }).filter({ visible: true }),
    ).toHaveValue('8');
    await expect(page).toHaveURL(/page=8/);
  });

  test('3D failure keeps collection editing accessible in 2D', async ({ harness }) => {
    const { page } = harness;
    await page.route('**/app/api/binder-appearance', (route) =>
      route.fulfill({ json: { ownerId: E2E_USER.id, design: null, revision: 0 } }),
    );
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
        configurable: true,
        value: function (this: HTMLCanvasElement, context: string, ...args: unknown[]) {
          return context.includes('webgl') ? null : Reflect.apply(original, this, [context, ...args]);
        },
      });
    });
    await page.reload();
    await harness.openViewOptions();
    await page.getByRole('button', { name: '3D', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '3D preview unavailable' })).toBeVisible();
    await harness.openViewOptions();
    await page.getByRole('button', { name: '2D', exact: true }).click();
    await page.getByRole('button', { name: 'Close view options', exact: true }).click();
    await expect(page.locator('button[data-dex-id="1"]').first()).toBeVisible();
    await harness.expectNoHorizontalOverflow();
  });
});

/** Sign in as another account in this tab, the way Supabase announces a session change. */

// Signed-in (native) binders have no View options, so these signed-in 3D flows can't open 3D yet (native parity gap, known failures).
test.describe('Dashboard binder appearance', () => {
  test.use({ signedIn: true });
  test('loads cloud appearance on reload and shows real National Dex slots in 3D', async ({ harness }) => {
    const { page } = harness;
    // Synthetic cloud appearance, deliberately different from the settings defaults.
    const design = defaultBinderDesign();
    design.name = "Cal's archive";
    design.pageColor = '#aa2244';
    design.surfaces.cover.words = 'My collection';
    await page.route('**/app/api/binder-appearance', (route) =>
      route.fulfill({ json: { ownerId: E2E_USER.id, design, revision: 1 } }),
    );
    await page.goto('/app/e2e-harness?signedIn=1&cardArtwork=1');
    await harness.openViewOptions();
    const display = page.getByRole('group', { name: 'Binder display' });
    await expect(display.getByRole('button', { name: '2D', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-binder-page="1"] > div').first()).toHaveCSS(
      'background-image',
      /rgb\(170, 34, 68\)/,
    );
    await harness.expectMinTapTarget(display.getByRole('button', { name: '3D', exact: true }));
    await display.getByRole('button', { name: '3D', exact: true }).click();
    const preview = page.getByRole('region', { name: 'Your 3D National Dex binder' });
    await expect(preview).toHaveAttribute('data-binder-name', "Cal's archive");
    await expect(preview.getByText('National Dex / 2 cards placed', { exact: true })).toBeVisible();
    await expect(preview.getByRole('list', { name: 'Cards on this spread' }).getByRole('listitem')).toHaveText([
      'Bulbasaur, slot 1',
      'Charmander, slot 4',
    ]);
    await expect(preview.getByRole('link', { name: 'Customize in Studio' })).toHaveAttribute('href', '/app/studio');
    await expect(preview.getByTestId('binder-3d-stage')).toHaveAttribute('data-right-cards', '2');
    const next = preview.getByRole('button', { name: 'Next 3D binder spread' });
    await harness.expectMinTapTarget(next);
    await next.scrollIntoViewIfNeeded();
    await harness.expectHittable(next);
    await harness.expectWithinSafeViewport(next);
    await next.click();
    await expect(preview.getByText('No placed cards on this spread', { exact: true })).toBeVisible();
    await harness.expectNoHorizontalOverflow();
    await expect(harness.dock()).toBeVisible();
    await harness.openViewOptions();
    await display.getByRole('button', { name: '2D', exact: true }).click();
    await page.getByRole('button', { name: 'Close view options', exact: true }).click();
    await expect(page.locator('button[data-dex-id="17"]').first()).toBeVisible();
    await page.reload();
    await harness.openViewOptions();
    await display.getByRole('button', { name: '3D', exact: true }).click();
    await expect(preview).toHaveAttribute('data-binder-name', "Cal's archive");
    await expect(preview.getByTestId('binder-3d-stage')).toHaveAttribute('data-current-page', '2');
    await expect(preview.getByText('No placed cards on this spread', { exact: true })).toBeVisible();
  });
});
