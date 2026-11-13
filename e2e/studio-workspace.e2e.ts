import { test, expect } from './fixtures';

test('editing keeps the binder and save action in view', { tag: '@matrix' }, async ({ harness }) => {
  const { page } = harness;
  await page.goto('/app/e2e-harness/studio?theme=light');
  const save = page.getByRole('button', { name: 'Save appearance', exact: true });
  await expect(save).toBeEnabled();
  const stage = page.getByTestId('binder-3d-stage');
  await expect(stage).toHaveAttribute('data-current-page', '1');
  const before = await stage.boundingBox();
  await page.getByText('Binder setup', { exact: false }).click();
  await page.getByLabel('Binder name', { exact: true }).fill('My favourites');
  const after = await stage.boundingBox();
  await test.info().attach('workspace-layout', {
    body: JSON.stringify({ viewport: harness.viewport, insets: harness.insets, before, after }),
    contentType: 'application/json',
  });
  await page.screenshot({ path: test.info().outputPath('studio-workspace.png') });
  await harness.expectWithinSafeViewport(stage);
  await harness.expectWithinSafeViewport(save);
  await harness.expectHittable(save);
  await harness.expectMinTapTarget(save, 36);
  await harness.expectNoHorizontalOverflow();
  await page.getByText('Presets', { exact: true }).click();
  await page.getByRole('button', { name: 'Back cover', exact: true }).click();
  const heading = page.getByRole('heading', { name: 'Back cover', exact: true });
  await expect(heading).toBeVisible();
  await harness.expectHittable(heading);
});

test('appearance edits avoid offscreen GPU readback and retain the model', async ({ harness }) => {
  const { page } = harness;
  await page.addInitScript(() => {
    // Count real GPU work, forwarding every call to the browser implementation.
    const calls = { readbacks: 0, buffers: 0 };
    Object.assign(window, { studioGPU: calls });
    const read = WebGL2RenderingContext.prototype.readPixels;
    Object.defineProperty(WebGL2RenderingContext.prototype, 'readPixels', {
      value: function (...args: unknown[]) {
        calls.readbacks++;
        return Reflect.apply(read, this, args);
      },
    });
    const create = WebGL2RenderingContext.prototype.createBuffer;
    WebGL2RenderingContext.prototype.createBuffer = function () {
      calls.buffers++;
      return Reflect.apply(create, this, []);
    };
  });
  await page.goto('/app/e2e-harness/studio');
  const stage = page.getByTestId('binder-3d-stage');
  await expect(stage).toHaveAttribute('data-current-page', '1');
  await page.getByRole('button', { name: 'Zip hardware', exact: true }).click();
  await expect(stage).toHaveAttribute('data-opening-state', 'settled');
  const gpu = () =>
    page.evaluate(() => (window as Window & { studioGPU?: { readbacks: number; buffers: number } }).studioGPU!);
  const initial = await gpu();
  expect(initial.readbacks).toBe(0);
  await stage.evaluate((element) => {
    const complete = new Promise<void>((resolve) => {
      let busy = false;
      const observer = new MutationObserver((records) => {
        if (records.some((record) => record.oldValue === 'true')) busy = true;
        if (busy && element.getAttribute('aria-busy') === 'false') {
          observer.disconnect();
          resolve();
        }
      });
      observer.observe(element, { attributes: true, attributeFilter: ['aria-busy'], attributeOldValue: true });
    });
    Object.assign(window, { studioUpdate: complete });
  });
  await page.getByLabel('Zip teeth colour', { exact: true }).fill('#aa2244');
  await page.evaluate(() => (window as Window & { studioUpdate?: Promise<void> }).studioUpdate);
  expect((await gpu()).readbacks).toBe(0);
  expect((await gpu()).buffers).toBe(initial.buffers);
});

test('3D pages support keyboard navigation and fitting the view', async ({ harness }) => {
  const { page } = harness;
  await page.goto('/app/e2e-harness/studio');
  await page.getByRole('button', { name: 'Pocket pages', exact: true }).click();
  const stage = page.getByTestId('binder-3d-stage');
  await expect(stage).toHaveAttribute('data-opening-state', 'settled');
  const viewport = page.getByRole('group', { name: 'Interactive 3D binder', exact: true });
  await viewport.press('ArrowRight');
  await expect(stage).toHaveAttribute('data-current-page', '2');
  await viewport.press('ArrowLeft');
  await expect(stage).toHaveAttribute('data-current-page', '1');
  await page.getByRole('button', { name: 'Fit binder', exact: true }).click();
  await expect(stage).toHaveAttribute('data-current-page', '1');
});

test('artwork adjustment stays tucked away until requested', async ({ harness }) => {
  const { page } = harness;
  await page.goto('/app/e2e-harness/studio');
  await expect(page.getByRole('button', { name: 'Save appearance', exact: true })).toBeEnabled();
  await page.getByText('Presets', { exact: true }).click();
  await page.getByRole('button', { name: 'Apply Magikarp preset', exact: true }).click();
  await page.getByText('Presets', { exact: true }).click();
  const crop = page.getByLabel('Artwork crop preview, drag to position, arrow keys to move', { exact: true });
  await expect(crop).toBeHidden();
  const colour = page.getByLabel('Surface colour', { exact: true });
  await harness.expectMinTapTarget(colour, 36);
  await colour.fill('#223344');
  await expect(colour).toHaveValue('#223344');
  await page.getByText('Adjust artwork', { exact: false }).click();
  await expect(crop).toBeVisible();
  await page.getByRole('button', { name: 'Remove artwork', exact: true }).click();
  await expect(crop).toHaveCount(0);
  await expect(page.getByText('Upload artwork', { exact: true })).toBeVisible();
  await harness.expectNoHorizontalOverflow();
});
