import { test, expect, emulateStandalone, SAFE_AREA } from './fixtures';

test('catalog identity help, Pokemon reference and physical-copy filters match discovery', async ({
  page,
  request,
}, info) => {
  if (info.project.metadata.standalone) await emulateStandalone(page, SAFE_AREA);
  await page.goto('/app/docs/contracts');
  await expect(page.getByRole('heading', { name: /^Card, copy and species identity/ })).toBeVisible();
  await expect(page.getByText('globally unique opaque application IDs', { exact: false })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto('/app/docs/reference/catalog/get-pokemon-set-slots');
  await expect(page.getByRole('heading', { name: 'Get pokemon set slots', exact: true })).toBeVisible();
  await expect(page.getByText('These are not stable storage slots.', { exact: false }).first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto('/app/docs/collection-history');
  await expect(page.getByText('inventoryItemId', { exact: false }).first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const spec = await (await request.get('/app/openapi.json')).json();
  expect(spec.paths['/pokemon/sets/{id}/slots'].get.operationId).toBe('get_pokemon_set_slots');
  expect(spec.paths['/legacy/pokemon/analytics']).toBeUndefined();
  expect(spec.paths['/imports/resolve']).toBeUndefined();
  expect(spec.paths['/collection']).toBeUndefined();
  const filters = spec.paths['/collection/audit'].get.parameters.map((p: { name: string }) => p.name);
  expect(filters).toContain('inventoryItemId');
  expect(filters).not.toContain('itemId');
  const markdown = await (await request.get('/app/docs/markdown/contracts')).text();
  expect(markdown).toContain('game: "pokemon"');
  expect(markdown).toContain('globally unique opaque application IDs');
  const full = await (await request.get('/app/docs/llms-full.txt')).text();
  expect(full).toContain('"operationId": "get_pokemon_set_slots"');
  expect(full).not.toContain('"operationId": "save_collection_item"');
});
