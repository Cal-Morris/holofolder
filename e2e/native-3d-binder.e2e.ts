import { test, expect as baseExpect, E2E_USER } from './fixtures';
import { defaultBinderDesign } from '../lib/binder-design';

// The 3D binder renders on SwiftShader in CI and can take ~10 s to open and settle a spread.
const expect = baseExpect.configure({ timeout: 30_000 });
test.describe.configure({ timeout: 90_000 });

test.describe('native 3D binder', () => {
  test.use({ signedIn: true });
  test.beforeEach(async ({ harness }) => {
    await harness.page.route('**/app/api/binder-appearance', (route) =>
      route.fulfill({ json: { ownerId: E2E_USER.id, design: defaultBinderDesign(), revision: 1 } }),
    );
  });

  test('@matrix enters from the header, turns with the keyboard and exits to the same 2D page', async ({ harness }) => {
    const { page } = harness;
    const toggle = page.getByTestId('app-header').getByRole('button', { name: '3D view', exact: true });
    await harness.setDimension('3D');
    await harness.expectMinTapTarget(toggle);
    const preview = page.getByRole('region', { name: 'Your 3D slot binder' }),
      stage = preview.getByTestId('binder-3d-stage');
    await expect(stage).toHaveAttribute('data-opening-state', 'settled');
    await expect(stage).toHaveAttribute('data-right-cards', '2');
    await harness.expectNoHorizontalOverflow();
    await harness.expectWithinSafeViewport(preview.getByRole('button', { name: 'Next 3D binder spread' }));
    await preview.getByRole('group', { name: 'Interactive 3D binder' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(stage).toHaveAttribute('data-current-page', '2');
    await expect(stage).toHaveAttribute('aria-busy', 'false');
    await harness.setDimension('2D');
    await expect(preview).toHaveCount(0);
    await expect(page.getByRole('spinbutton', { name: 'Binder page number' }).filter({ visible: true })).toHaveValue(
      '2',
    );
    await expect(harness.slot(17)).toBeVisible();
    // Other storage views stay 2D and don't offer the toggle; the binder reopens in 3D.
    await harness.setDimension('3D');
    await harness.listTab().click();
    await expect(toggle).toHaveCount(0);
    await expect(preview).toHaveCount(0);
    await harness.dock().getByRole('button', { name: 'Binder', exact: true }).click();
    await expect(stage).toHaveAttribute('data-opening-state', 'settled');
  });

  test('opens offline from the saved binder', async ({ harness }) => {
    const { page } = harness;
    // Once fetched (the idle warm-up does this too), 3D reopens offline from the device's binder and appearance.
    await harness.setDimension('3D');
    await expect(page.getByTestId('binder-3d-stage')).toHaveAttribute('data-opening-state', 'settled');
    await harness.setDimension('2D');
    await page.context().setOffline(true);
    await harness.setDimension('3D');
    const preview = page.getByRole('region', { name: 'Your 3D slot binder' }),
      stage = preview.getByTestId('binder-3d-stage');
    await expect(stage).toHaveAttribute('data-opening-state', 'settled');
    await expect(preview.getByText('Ordered slots / 2 cards placed', { exact: true })).toBeVisible();
    await expect(stage).toHaveAttribute('data-right-cards', '2');
    await preview.getByRole('button', { name: 'Next 3D binder spread' }).click();
    await expect(stage).toHaveAttribute('data-current-page', '2');
    await expect(preview.getByRole('status')).toHaveCount(0);
  });

  test('reduced motion opens and turns without animating', async ({ harness }) => {
    const { page } = harness;
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await harness.setDimension('3D');
    const preview = page.getByRole('region', { name: 'Your 3D slot binder' }),
      stage = preview.getByTestId('binder-3d-stage');
    await expect(stage).toHaveAttribute('data-opening-state', 'settled');
    await stage.evaluate((element) => {
      const states: string[] = [];
      new MutationObserver(() => states.push(element.dataset.openingState ?? '')).observe(element, {
        attributeFilter: ['data-opening-state'],
      });
      Object.assign(element, { openingStates: states });
    });
    const views = preview.getByRole('group', { name: '3D binder views' });
    await views.getByRole('button', { name: 'Cover', exact: true }).click();
    await views.getByRole('button', { name: 'Inside', exact: true }).click();
    await preview.getByRole('button', { name: 'Next 3D binder spread' }).click();
    await expect(stage).toHaveAttribute('data-current-page', '2');
    await expect(stage).toHaveAttribute('aria-busy', 'false');
    const states = await stage.evaluate((element) => Reflect.get(element, 'openingStates') as string[]);
    expect(states.filter((state) => state !== 'settled')).toEqual([]);
  });
});
