import { test, expect } from '@playwright/test';
import { emulateStandalone, SAFE_AREA } from './fixtures';
import type { BinderDesign } from '../lib/binder-design';

// Synthetic image fixtures test framing and persistence; they never imply owned cards.
const image = `<svg xmlns="http://www.w3.org/2000/svg" width="315" height="440"><rect width="315" height="440" fill="#c9c9cb"/><rect x="18" y="18" width="279" height="404" rx="12" fill="#644c71"/><text x="40" y="80" fill="white">SYNTHETIC TEST</text></svg>`;
test.beforeEach(async ({ page }, info) => {
  if (info.project.metadata.standalone) await emulateStandalone(page, SAFE_AREA);
  await page.route('**/app/api/card-image-proxy?**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/svg+xml', body: image }),
  );
});
test('studio retains artwork framing, supports cancel and page colours', async ({ page }) => {
  await page.goto('/app/studio');
  await expect(page).toHaveTitle('Binder Studio · Holo Folder');
  await expect(page.getByRole('button', { name: 'Save appearance', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Preview collection')).toHaveValue('sample');
  await expect(page.getByRole('group', { name: 'Preview angle' }).getByRole('button')).toHaveCount(5);
  await expect(page.getByRole('img', { name: /^3D binder, swipe to turn pages/ })).toBeVisible();
  await page.getByRole('button', { name: 'Zip hardware', exact: true }).click();
  await page.getByRole('group', { name: 'Preview angle' }).getByRole('button', { name: 'Front', exact: true }).click();
  await page.locator('.studio-stage canvas').click();
  await expect(page.getByRole('heading', { name: 'Front cover', exact: true })).toBeVisible();
  if (!(await page.getByLabel('Words', { exact: true }).isVisible()))
    await page
      .locator('summary')
      .filter({ hasText: /^Lettering/ })
      .click();
  await page.getByLabel('Words', { exact: true }).fill('Test binder');
  await page.getByText('Choose Pokémon card artwork', { exact: true }).click();
  await page.getByRole('button', { name: 'Use Bulbasaur 166 / 165 artwork', exact: true }).click();
  await page.getByLabel('Artwork zoom', { exact: true }).fill('2');
  await page.getByLabel('Horizontal placement', { exact: true }).fill('0.5');
  await page.locator('.studio-crop').press('ArrowLeft');
  await expect(page.getByLabel('Horizontal placement', { exact: true })).toHaveValue('0.47');
  await page.locator('.studio-crop').press('ArrowRight');
  await page.getByRole('button', { name: 'Save appearance', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Saved on this device\./ })).toBeVisible();
  if (!(await page.getByLabel('Words', { exact: true }).isVisible()))
    await page
      .locator('summary')
      .filter({ hasText: /^Lettering/ })
      .click();
  await page.getByLabel('Words', { exact: true }).fill('Discard this');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByLabel('Words', { exact: true })).toHaveValue('Test binder');
  await page.reload();
  await expect(page.getByLabel('Words', { exact: true })).toHaveValue('Test binder');
  await expect(page.getByLabel('Artwork zoom', { exact: true })).toHaveValue('2');
  await expect(page.getByLabel('Horizontal placement', { exact: true })).toHaveValue('0.5');
  await page.getByRole('button', { name: 'Pocket pages', exact: true }).click();
  await page.getByLabel('This page colour', { exact: true }).fill('#aa2244');
  await page.getByLabel('Page count', { exact: true }).fill('1');
  await expect(page.getByRole('button', { name: 'Next preview page', exact: true })).toBeDisabled();
  await page.getByLabel('Page count', { exact: true }).fill('40');
  await page.getByLabel('Preview page face', { exact: true }).fill('40');
  await expect(page.getByText('Page 40', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next preview page', exact: true })).toBeDisabled();
  await page.getByLabel('Preview page face', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Save appearance', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Saved on this device\./ })).toBeVisible();
  const savedPages = await readSavedRecord(page);
  expect(savedPages?.design.pageCount).toBe(40);
  expect(savedPages?.design.pageColors['1']).toBe('#aa2244');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Save appearance', exact: true })).toBeEnabled();
  expect(await readSavedRecord(page)).toEqual(savedPages);
  await page.getByRole('button', { name: 'Pocket pages', exact: true }).click();
  await expect(page.getByLabel('This page colour', { exact: true })).toHaveValue('#aa2244');
  await expect(page.getByLabel('Page count', { exact: true })).toHaveValue('40');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('valid upload survives reload and storage failure preserves draft', async ({ page }) => {
  await page.goto('/app/studio');
  await expect(page.getByRole('button', { name: 'Save appearance', exact: true })).toBeEnabled();
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 300;
    c.height = 400;
    const x = c.getContext('2d')!;
    x.fillStyle = '#aa2244';
    x.fillRect(0, 0, 300, 400);
    return c.toDataURL('image/png').split(',')[1];
  });
  await page.evaluate(() => {
    const original = window.createImageBitmap;
    const gate = new Promise<void>((resolve) => {
      (window as Window & { releaseArtwork?: () => void }).releaseArtwork = resolve;
    });
    Object.defineProperty(window, 'createImageBitmap', {
      configurable: true,
      value: async (image: ImageBitmapSource, options?: ImageBitmapOptions) => {
        await gate;
        return original(image, options);
      },
    });
  });
  await page
    .getByLabel('Upload artwork', { exact: true })
    .setInputFiles({ name: 'synthetic-art.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  if (!(await page.getByLabel('Words', { exact: true }).isVisible()))
    await page
      .locator('summary')
      .filter({ hasText: /^Lettering/ })
      .click();
  await page.getByLabel('Words', { exact: true }).fill('Edited during decode');
  await page.evaluate(() => (window as Window & { releaseArtwork?: () => void }).releaseArtwork?.());
  await expect(page.getByLabel('Artwork zoom', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Words', { exact: true })).toHaveValue('Edited during decode');
  await page.getByLabel('Artwork zoom', { exact: true }).fill('3');
  await page.getByRole('button', { name: 'Save appearance', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Saved on this device\./ })).toBeVisible();
  const beforeReload = await readSavedRecord(page);
  expect(beforeReload?.design.surfaces.cover.frame.zoom).toBe(3);
  expect(beforeReload?.design.surfaces.cover.artwork).toMatch(/^upload:/);
  expect(Object.values(beforeReload?.uploads ?? {}).some((blob) => blob.type === 'image/png' && blob.size > 0)).toBe(
    true,
  );
  await page.reload();
  await expect(page.getByRole('button', { name: 'Save appearance', exact: true })).toBeEnabled();
  expect(await readSavedRecord(page)).toEqual(beforeReload);
  await expect(page.getByLabel('Artwork zoom', { exact: true })).toHaveValue('3');
  await page.evaluate(() => {
    indexedDB.open = () => {
      throw new Error('Synthetic storage failure');
    };
  });
  if (!(await page.getByLabel('Words', { exact: true }).isVisible()))
    await page
      .locator('summary')
      .filter({ hasText: /^Lettering/ })
      .click();
  await page.getByLabel('Words', { exact: true }).fill('Unsaved stays');
  await page.getByRole('button', { name: 'Save appearance', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Synthetic storage failure' })).toBeVisible();
  await expect(page.getByLabel('Words', { exact: true })).toHaveValue('Unsaved stays');
});

test('WebGL unavailable leaves appearance controls and saving usable', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: function (this: HTMLCanvasElement, context: string, ...args: unknown[]) {
        return context.includes('webgl') ? null : Reflect.apply(original, this, [context, ...args]);
      },
    });
  });
  await page.goto('/app/studio');
  await expect(page.getByRole('status').filter({ hasText: 'Your browser cannot open the 3D preview' })).toBeVisible();
  if (!(await page.getByLabel('Words', { exact: true }).isVisible()))
    await page
      .locator('summary')
      .filter({ hasText: /^Lettering/ })
      .click();
  await page.getByLabel('Words', { exact: true }).fill('Fallback appearance');
  await page.getByRole('button', { name: 'Save appearance', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Saved on this device\./ })).toBeVisible();
});

async function readSavedRecord(page: import('@playwright/test').Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('binderdex-appearance', 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    return new Promise<{ design: BinderDesign; uploads: Record<string, { size: number; type: string }> } | null>(
      (resolve) => {
        const tx = db.transaction('designs'),
          r = tx.objectStore('designs').get('guest-demo');
        r.onsuccess = () => {
          db.close();
          resolve(
            r.result
              ? {
                  design: r.result.design,
                  uploads: Object.fromEntries(
                    Object.entries(r.result.uploads).map(([key, blob]) => [
                      key,
                      blob instanceof Blob ? { size: blob.size, type: blob.type } : { size: 0, type: 'invalid' },
                    ]),
                  ),
                }
              : null,
          );
        };
      },
    );
  });
}

test('physical page turns settle on paired faces and respect reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/app/studio');
  await expect(page.getByRole('button', { name: 'Save appearance', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Pocket pages', exact: true }).click();
  const stage = page.locator('.studio-stage');
  await expect(stage).toHaveAttribute('data-current-spread', '0-1');
  await expect(stage).toHaveAttribute('data-opening-state', 'settled');
  const next = page.getByRole('button', { name: 'Next preview page', exact: true });
  await next.click();
  await expect(stage).toHaveAttribute('aria-busy', 'true');
  await expect(stage).toHaveAttribute('data-current-page', '2');
  await expect(stage).toHaveAttribute('data-current-spread', '2-3');
  await expect(stage).toHaveAttribute('aria-busy', 'false');
  await page.getByLabel('Preview page face', { exact: true }).fill('3');
  await expect(stage).toHaveAttribute('data-current-page', '3');
  await expect(stage).toHaveAttribute('data-current-spread', '2-3');
  await next.click();
  await expect(stage).toHaveAttribute('aria-busy', 'true');
  await expect(stage).toHaveAttribute('data-current-page', '4');
  await expect(stage).toHaveAttribute('data-current-spread', '4-5');
  await page.getByRole('button', { name: 'Previous preview page', exact: true }).click();
  await expect(stage).toHaveAttribute('aria-busy', 'true');
  await expect(stage).toHaveAttribute('data-current-page', '2');
  await next.click();
  await next.click();
  await next.click();
  await expect(stage).toHaveAttribute('data-current-page', '8');
  await expect(stage).toHaveAttribute('data-current-spread', '8-9');
  await expect(stage).toHaveAttribute('aria-busy', 'false');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByLabel('Preview page face', { exact: true }).fill('1');
  await expect(stage).toHaveAttribute('data-current-page', '1');
  await next.click();
  await expect(stage).toHaveAttribute('data-current-page', '2');
  await expect(stage).toHaveAttribute('aria-busy', 'false');
});

test('clicking a page turns its spread while orbit dragging does not', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/app/studio');
  await expect(page.getByRole('button', { name: 'Save appearance', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Pocket pages', exact: true }).click();
  const stage = page.locator('.studio-stage');
  await expect(stage).toHaveAttribute('data-opening-state', 'settled');
  await expect(stage).toHaveAttribute('data-current-spread', '0-1');
  const canvas = stage.locator('canvas');
  const bounds = await canvas.boundingBox();
  await canvas.click({ position: { x: bounds!.width * 0.68, y: bounds!.height * 0.5 } });
  await expect(stage).toHaveAttribute('aria-busy', 'true');
  await expect(stage).toHaveAttribute('data-current-spread', '2-3');
  await expect(stage).toHaveAttribute('aria-busy', 'false');
  await canvas.click({ position: { x: bounds!.width * 0.32, y: bounds!.height * 0.5 } });
  await expect(stage).toHaveAttribute('data-current-spread', '0-1');
  await expect(stage).toHaveAttribute('aria-busy', 'false');
  const liveBounds = await canvas.boundingBox();
  const x = liveBounds!.x + liveBounds!.width * 0.68,
    y = liveBounds!.y + liveBounds!.height * 0.5;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 35, y + 10, { steps: 5 });
  await page.mouse.move(x, y, { steps: 5 });
  await page.mouse.up();
  await expect(stage).toHaveAttribute('data-current-spread', '0-1');
});

test('curated presets preserve page settings and support undo and device saving', async ({ page }) => {
  await page.goto('/app/studio');
  await expect(page.getByRole('button', { name: 'Save appearance', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Pocket pages', exact: true }).click();
  await page.getByLabel('Page count', { exact: true }).fill('40');
  await page.getByLabel('This page colour', { exact: true }).fill('#aa2244');
  await page
    .locator('summary')
    .filter({ hasText: /^Presets$/ })
    .click();
  const presets = page.getByRole('group', { name: 'Binder appearance presets' });
  await expect(presets.getByRole('button')).toHaveCount(6);
  await expect
    .poll(() =>
      presets
        .locator('img')
        .evaluateAll((images) => images.every((image) => (image as HTMLImageElement).naturalWidth === 360)),
    )
    .toBe(true);
  await presets.getByRole('button', { name: 'Apply Ivory preset', exact: true }).click();
  await expect(presets.getByRole('button', { name: 'Apply Ivory preset', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page
    .locator('summary')
    .filter({ hasText: /^Lettering/ })
    .click();
  await page.getByLabel('Words', { exact: true }).fill('My favourites');
  await presets.getByRole('button', { name: 'Apply Mew preset', exact: true }).click();
  await expect(page.getByLabel('Words', { exact: true })).toHaveValue('My favourites');
  await expect(page.getByLabel('Artwork zoom', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByLabel('Artwork zoom', { exact: true })).toHaveCount(0);
  await presets.getByRole('button', { name: 'Apply Mew preset', exact: true }).click();
  await page.getByRole('button', { name: 'Save appearance', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Saved on this device\./ })).toBeVisible();
  const record = await readSavedRecord(page);
  expect(record?.design.pageCount).toBe(40);
  expect(record?.design.pageColors['1']).toBe('#aa2244');
  expect(record?.design.surfaces.cover.words).toBe('My favourites');
  expect(record?.design.surfaces.cover.artwork).toContain('193');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Save appearance', exact: true })).toBeEnabled();
  expect(await readSavedRecord(page)).toEqual(record);
  await expect(page.getByLabel('Artwork zoom', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
