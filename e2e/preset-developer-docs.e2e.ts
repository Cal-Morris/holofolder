import { test, expect, emulateStandalone, SAFE_AREA } from './fixtures';

test('copied preset help, both references and agent exports stay readable', async ({ page, request }, info) => {
  if (info.project.metadata.standalone) await emulateStandalone(page, SAFE_AREA);
  await page.goto('/app/docs/preset-previews');
  await expect(page.getByRole('heading', { name: 'Copied preset previews', exact: true })).toBeVisible();
  await expect(
    page.getByText('Preset discovery and previews use the trusted developer key/OAuth boundaries.', { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Creation and identity boundaries/ })).toBeAttached();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 500));
  const search = page.getByRole('button', { name: 'Open Search', exact: true });
  await expect(search).toBeVisible();
  expect((await search.boundingBox())!.y).toBeGreaterThanOrEqual(info.project.metadata.standalone ? SAFE_AREA.top : 0);
  for (const [slug, heading] of [
    ['list-storage-presets', 'List storage presets'],
    ['preview-storage-preset', 'Preview storage preset'],
  ]) {
    await page.goto(`/app/docs/reference/collection/${slug}`);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expect(page.getByText('Required permissions:', { exact: false }).first()).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const markdown = await request.get(`/app/docs/markdown/reference/collection/${slug}`);
    expect(markdown.ok()).toBe(true);
    expect(await markdown.text()).not.toContain('"x-admission": "staged"');
  }
  const markdown = await request.get('/app/docs/markdown/preset-previews');
  expect(markdown.ok()).toBe(true);
  expect(await markdown.text()).toContain('Preset entry IDs are provenance labels');
  const full = await request.get('/app/docs/llms-full.txt');
  const content = await full.text();
  expect(content).toContain('"operationId": "list_storage_presets"');
  expect(content).toContain('"operationId": "preview_storage_preset"');
});
